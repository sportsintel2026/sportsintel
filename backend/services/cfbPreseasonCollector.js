"use strict";

// One-shot, shadow-only CFB preseason evidence collector. This module is deliberately
// absent from server.js, routes, crons, cfbModel, and predictionTracker. Running this
// file without the explicit execution flags prints the bounded plan and makes no
// provider or database calls.

const {
  CONTRACT_VERSION,
  QB_CATEGORIES,
  reconcileTeamIdentities,
  buildTeamPreseasonSnapshot,
} = require("./cfbPreseasonInput");
const { cfbNorm } = require("./teamKey");

const SEASON = 2026;
const COLLECTOR_VERSION = "cfb-preseason-collector-v1-2026-08-30";
const EXECUTION_CONFIRMATION = "CFB_2026_ONE_TIME_SHADOW_COLLECTION";
const TEAM_TABLE = "cfb_team_preseason_snapshots";
const INSERT_CHUNK_SIZE = 12;
const ESPN_TIMEOUT_MS = 12000;
const DEFAULT_POPULATION_BOUNDS = Object.freeze({ min: 120, max: 180 });
const MIN_SAFE_IDENTITY_RATE = 0.9;
const CFBD_SOURCE_VERSION = "cfbd-rest";
const ESPN_SOURCE_VERSION = "espn-core-site";

const REQUEST_PLAN = Object.freeze([
  Object.freeze({ provider: "cfbd", domain: "teams", endpoint: "/teams/fbs?year=2026", critical: true }),
  Object.freeze({ provider: "cfbd", domain: "roster", endpoint: "/roster?year=2026&classification=fbs" }),
  Object.freeze({ provider: "cfbd", domain: "returningProduction", endpoint: "/player/returning?year=2026" }),
  Object.freeze({ provider: "cfbd", domain: "transfers", endpoint: "/player/portal?year=2026" }),
  Object.freeze({ provider: "cfbd", domain: "talent", endpoint: "/talent?year=2026" }),
  Object.freeze({ provider: "cfbd", domain: "recruitingTeams", endpoint: "/recruiting/teams?year=2026" }),
  Object.freeze({ provider: "cfbd", domain: "recruitingPlayers", endpoint: "/recruiting/players?year=2026" }),
  Object.freeze({ provider: "cfbd", domain: "coaching", endpoint: "/coaches?year=2026" }),
  Object.freeze({ provider: "cfbd", domain: "externalRatings", endpoint: "/ratings/sp?year=2026" }),
  Object.freeze({
    provider: "espn",
    domain: "espnFbsMembership",
    endpoint: "https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/types/2/groups/80/teams?limit=200",
    critical: true,
  }),
  Object.freeze({
    provider: "espn",
    domain: "espnTeamCatalog",
    endpoint: "https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=900",
    critical: true,
  }),
]);

const PLANNED_CFBD_REQUESTS = REQUEST_PLAN.filter((row) => row.provider === "cfbd").length;
const PLANNED_ESPN_REQUESTS = REQUEST_PLAN.filter((row) => row.provider === "espn").length;
const inflight = new Map();

function assertSeason(season) {
  const value = Number(season);
  if (value !== SEASON) throw new Error(`collector is frozen to season ${SEASON}`);
  return value;
}

function cleanError(error) {
  return String(error?.message || error || "unknown provider error")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]");
}

function isoNow(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("collector clock returned an invalid timestamp");
  return date.toISOString();
}

function createRequestBudget(plan = REQUEST_PLAN) {
  const allowed = new Map(plan.map((row) => [`${row.provider}:${row.domain}`, row]));
  const used = new Set();
  const counts = { cfbd: 0, espn: 0 };
  const limits = {
    cfbd: plan.filter((row) => row.provider === "cfbd").length,
    espn: plan.filter((row) => row.provider === "espn").length,
  };

  async function request(provider, domain, operation) {
    const key = `${provider}:${domain}`;
    const planned = allowed.get(key);
    if (!planned) throw new Error(`unplanned provider request blocked: ${key}`);
    if (used.has(key)) throw new Error(`duplicate provider request blocked: ${key}`);
    if (counts[provider] >= limits[provider]) {
      throw new Error(`${provider} request budget exceeded before ${domain}`);
    }
    used.add(key);
    counts[provider]++;
    return operation(planned);
  }

  return Object.freeze({
    request,
    snapshot() {
      return Object.freeze({
        planned: Object.freeze({ ...limits, total: limits.cfbd + limits.espn }),
        actual: Object.freeze({ ...counts, total: counts.cfbd + counts.espn }),
        domains: Object.freeze([...used].sort()),
      });
    },
  });
}

async function fetchEspnJson(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ESPN_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "WizePicks-CFB-Preseason-Shadow/1.0",
      },
    });
    if (!response?.ok) throw new Error(`ESPN bulk identity request failed with HTTP ${response?.status || "unknown"}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function requestRecord(planned, retrievedAt, rows, error = null) {
  return Object.freeze({
    provider: planned.provider,
    domain: planned.domain,
    endpoint: planned.endpoint,
    critical: planned.critical === true,
    ok: !error,
    retrievedAt,
    count: Array.isArray(rows) ? rows.length : null,
    error: error ? cleanError(error) : null,
  });
}

function extractEspnTeams(membership, catalog) {
  const ids = (membership?.items || []).map((item) => {
    const match = String(item?.$ref || "").match(/teams\/(\d+)/);
    return match ? match[1] : null;
  }).filter(Boolean);
  if (!ids.length) throw new Error("ESPN FBS membership returned no durable team IDs");

  const idSet = new Set(ids);
  const catalogRows = catalog?.sports?.[0]?.leagues?.[0]?.teams || [];
  const byId = new Map();
  for (const wrapper of catalogRows) {
    const team = wrapper?.team;
    if (team?.id && idSet.has(String(team.id))) byId.set(String(team.id), team);
  }
  if (!byId.size) throw new Error("ESPN bulk team catalog did not resolve any FBS identities");

  return ids.map((id) => {
    const team = byId.get(id) || {};
    return Object.freeze({
      id,
      school: team.location || team.displayName || team.name || null,
      displayName: team.displayName || null,
      shortDisplayName: team.shortDisplayName || null,
      location: team.location || null,
      name: team.name || null,
      alternateNames: Object.freeze([
        team.displayName, team.shortDisplayName, team.location, team.name, team.abbreviation,
      ].filter(Boolean)),
    });
  });
}

function groupRows(rows, field) {
  const out = new Map();
  for (const row of rows || []) {
    const key = cfbNorm(row?.[field]);
    if (!key) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(row);
  }
  return out;
}

function uniqueRow(index, key) {
  const rows = index.get(cfbNorm(key)) || [];
  return rows.length === 1 ? rows[0] : null;
}

function sourceStamp({ provider, endpoint, version, retrievedAt, available }) {
  return Object.freeze({
    provider,
    endpoint,
    version,
    retrievedAt: retrievedAt || null,
    effectiveAt: null,
    season: SEASON,
    available: available === true,
    historicallyAsOfSafe: false,
  });
}

function combinedTeamsSource(records) {
  const rows = [records.teams, records.espnFbsMembership, records.espnTeamCatalog];
  const retrieved = rows.map((row) => row?.retrievedAt).filter(Boolean).sort().pop() || null;
  return sourceStamp({
    provider: "CFBD+ESPN",
    endpoint: rows.map((row) => row?.endpoint).filter(Boolean).join(" | "),
    version: `${CFBD_SOURCE_VERSION}+${ESPN_SOURCE_VERSION}`,
    retrievedAt: retrieved,
    available: rows.every((row) => row?.ok === true),
  });
}

function buildSources(records) {
  const from = (domain, provider = "CFBD") => sourceStamp({
    provider,
    endpoint: records[domain]?.endpoint || null,
    version: provider === "CFBD" ? CFBD_SOURCE_VERSION : ESPN_SOURCE_VERSION,
    retrievedAt: records[domain]?.retrievedAt || null,
    available: records[domain]?.ok === true,
  });
  return Object.freeze({
    teams: combinedTeamsSource(records),
    roster: from("roster"),
    returningProduction: from("returningProduction"),
    transfers: from("transfers"),
    talent: from("talent"),
    recruitingTeams: from("recruitingTeams"),
    recruitingPlayers: from("recruitingPlayers"),
    coaching: from("coaching"),
    externalRatings: from("externalRatings"),
  });
}

function identityCoverage(cfbdTeams, espnTeams, resolutions) {
  const safeByCfbd = new Map();
  const ambiguousCfbd = new Set();
  for (const row of resolutions) {
    if ((row.status === "exact" || row.status === "mapped") && row.cfbdTeamId) {
      safeByCfbd.set(String(row.cfbdTeamId), row);
    }
    if (row.status === "ambiguous") {
      for (const candidate of row.candidates || []) {
        if (candidate?.id) ambiguousCfbd.add(String(candidate.id));
      }
    }
  }
  const rows = cfbdTeams.map((team) => {
    const id = String(team?.id || "");
    if (safeByCfbd.has(id)) return safeByCfbd.get(id);
    return Object.freeze({
      status: ambiguousCfbd.has(id) ? "ambiguous" : "unmatched",
      espnTeamId: null,
      cfbdTeamId: id || null,
      espnTeamName: null,
      cfbdTeamName: team?.school || null,
      candidates: [],
      reason: ambiguousCfbd.has(id)
        ? "CFBD identity participated in an ambiguous ESPN reconciliation"
        : "no safe ESPN durable identity resolved to this CFBD FBS team",
    });
  });
  const usedEspnIds = new Set(resolutions
    .filter((row) => row.status === "exact" || row.status === "mapped")
    .map((row) => String(row.espnTeamId)));
  return Object.freeze({
    rows: Object.freeze(rows),
    espnFbsCount: espnTeams.length,
    espnUnresolvedCount: Math.max(0, espnTeams.length - usedEspnIds.size),
  });
}

async function fetchBulkInputs({ cfbdGet, fetchImpl, clock }) {
  const budget = createRequestBudget();
  const payloads = {};
  const records = {};

  for (const planned of REQUEST_PLAN) {
    let rows = null;
    let error = null;
    try {
      rows = await budget.request(planned.provider, planned.domain, async () => {
        if (planned.provider === "cfbd") return cfbdGet(planned.endpoint);
        return fetchEspnJson(planned.endpoint, fetchImpl);
      });
      if (planned.provider === "cfbd" && !Array.isArray(rows)) {
        throw new Error(`${planned.domain} returned a non-array CFBD payload`);
      }
      if (planned.domain === "teams" && rows.length === 0) {
        throw new Error("CFBD FBS team list returned zero rows");
      }
    } catch (caught) {
      error = caught;
      rows = planned.provider === "cfbd" ? [] : null;
    }
    const retrievedAt = isoNow(clock);
    payloads[planned.domain] = rows;
    records[planned.domain] = requestRecord(planned, retrievedAt, rows, error);
    const authenticationFailed = planned.provider === "cfbd" && /\b401\b/.test(String(error?.message || ""));
    const rateLimited = planned.provider === "cfbd" && /\b429\b/.test(String(error?.message || ""));
    if (error && (planned.critical || authenticationFailed || rateLimited)) {
      throw new Error(`critical ${planned.domain} collection failed: ${cleanError(error)}`);
    }
  }

  const espnTeams = extractEspnTeams(payloads.espnFbsMembership, payloads.espnTeamCatalog);
  return Object.freeze({ payloads: Object.freeze(payloads), records: Object.freeze(records), espnTeams, budget: budget.snapshot() });
}

function buildSnapshots({ bulk, snapshotAt, explicitTeamMappings = {} }) {
  const cfbdTeams = bulk.payloads.teams;
  const resolutions = reconcileTeamIdentities({
    espnTeams: bulk.espnTeams,
    cfbdTeams,
    explicitMappings: explicitTeamMappings,
  });
  const identity = identityCoverage(cfbdTeams, bulk.espnTeams, resolutions);
  const sources = buildSources(bulk.records);

  const roster = groupRows(bulk.payloads.roster, "team");
  const returning = groupRows(bulk.payloads.returningProduction, "team");
  const talent = groupRows(bulk.payloads.talent, "team");
  const recruitingTeams = groupRows(bulk.payloads.recruitingTeams, "team");
  const recruitingPlayers = groupRows(bulk.payloads.recruitingPlayers, "committedTo");
  const externalRatings = groupRows(bulk.payloads.externalRatings, "team");

  const snapshots = [];
  for (const resolution of resolutions) {
    if (resolution.status !== "exact" && resolution.status !== "mapped") continue;
    const teamName = resolution.cfbdTeamName;
    snapshots.push(buildTeamPreseasonSnapshot({
      season: SEASON,
      contractVersion: CONTRACT_VERSION,
      snapshotAt,
      identity: resolution,
      sources,
      rosterPlayers: roster.get(cfbNorm(teamName)) || [],
      returningProductionRow: uniqueRow(returning, teamName),
      transferRows: bulk.payloads.transfers,
      talentRow: uniqueRow(talent, teamName),
      recruitingTeamRows: recruitingTeams.get(cfbNorm(teamName)) || [],
      recruitingPlayerRows: recruitingPlayers.get(cfbNorm(teamName)) || [],
      coaches: bulk.payloads.coaching,
      externalRatingRow: uniqueRow(externalRatings, teamName),
      qbEvidence: { category: "unknown-unverified" },
    }));
  }
  return Object.freeze({ snapshots: Object.freeze(snapshots), resolutions: Object.freeze(resolutions), identity });
}

function countWhere(rows, predicate) {
  return rows.reduce((sum, row) => sum + (predicate(row) ? 1 : 0), 0);
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function detailedCoverage({ snapshots, identity, records, expectedFbsTeams }) {
  const sourceAvailable = (snapshot, name) => snapshot.sources[name]?.available === true;
  const domain = (available, present, reliable) => Object.freeze({
    sourceAvailable: countWhere(snapshots, available),
    teamEvidencePresent: countWhere(snapshots, present),
    reliablyUsable: countWhere(snapshots, reliable),
  });
  const domains = {
    roster: domain(
      (row) => sourceAvailable(row, "roster"),
      (row) => row.roster.playerCount > 0,
      (row) => row.quality.domains.roster.reliablyUsable,
    ),
    returningProduction: domain(
      (row) => sourceAvailable(row, "returningProduction"),
      (row) => row.returningProduction.recordFound,
      (row) => row.quality.domains.returningProduction.reliablyUsable,
    ),
    transfers: domain(
      (row) => sourceAvailable(row, "transfers"),
      (row) => row.transfers.arrivals.length + row.transfers.departures.length > 0,
      (row) => row.quality.domains.transfers.reliablyUsable,
    ),
    talent: domain(
      (row) => sourceAvailable(row, "talent"),
      (row) => !!row.talent.teamTalent,
      (row) => row.quality.domains.talent.reliablyUsable,
    ),
    recruiting: Object.freeze({
      teamSourceAvailable: countWhere(snapshots, (row) => sourceAvailable(row, "recruitingTeams")),
      playerSourceAvailable: countWhere(snapshots, (row) => sourceAvailable(row, "recruitingPlayers")),
      teamEvidencePresent: countWhere(snapshots, (row) => row.talent.recruitingTeams.length > 0),
      playerEvidencePresent: countWhere(snapshots, (row) => row.talent.recruitingPlayers.length > 0),
      reliablyUsable: countWhere(snapshots, (row) => row.quality.domains.recruiting.reliablyUsable),
    }),
    coaching: domain(
      (row) => sourceAvailable(row, "coaching"),
      (row) => row.coaching.identityStatus === "exact",
      (row) => row.quality.domains.coaching.reliablyUsable,
    ),
    externalRatings: Object.freeze({
      sourceAvailable: countWhere(snapshots, (row) => sourceAvailable(row, "externalRatings")),
      teamEvidencePresent: countWhere(snapshots, (row) => !!row.priorReferences.externalRating),
      researchOnly: true,
    }),
    quarterback: Object.freeze({
      evidencePresent: countWhere(snapshots, (row) => row.quarterback.category !== "unknown-unverified"),
      reliablyUsable: countWhere(snapshots, (row) => row.quality.domains.quarterback.reliablyUsable),
    }),
  };

  const transferRows = snapshots.flatMap((row) => [...row.transfers.arrivals, ...row.transfers.departures]);
  const qbDistribution = Object.fromEntries(QB_CATEGORIES.map((category) => [
    category,
    countWhere(snapshots, (row) => row.quarterback.category === category),
  ]));
  const identityDistribution = { exact: 0, mapped: 0, ambiguous: 0, unmatched: 0 };
  for (const row of identity.rows) identityDistribution[row.status]++;

  const reliableNames = ["roster", "returningProduction", "transfers", "talent", "recruiting", "coaching", "quarterback"];
  let ready = 0;
  let suspect = 0;
  let insufficient = 0;
  for (const row of snapshots) {
    const reliableCount = reliableNames.filter((name) => row.quality.domains[name].reliablyUsable).length;
    if (reliableCount === reliableNames.length) ready++;
    else if (reliableCount >= 4) suspect++;
    else insufficient++;
  }
  insufficient += Math.max(0, expectedFbsTeams - snapshots.length);

  const completeness = snapshots.map((row) => row.quality.completeness);
  const sourceNames = snapshots.length ? Object.keys(snapshots[0].sources) : [];
  const sourceMissingness = Object.fromEntries(sourceNames.map((name) => [name, Object.freeze({
    missing: countWhere(snapshots, (row) => !sourceAvailable(row, name)),
    missingRate: snapshots.length ? round(countWhere(snapshots, (row) => !sourceAvailable(row, name)) / snapshots.length) : null,
  })]));

  return Object.freeze({
    identity: Object.freeze({
      expectedFbsTeams,
      espnFbsTeams: identity.espnFbsCount,
      ...identityDistribution,
      storedSnapshots: snapshots.length,
      espnUnresolved: identity.espnUnresolvedCount,
      ambiguousTeams: identity.rows.filter((row) => row.status === "ambiguous").map((row) => row.cfbdTeamName),
      unmatchedTeams: identity.rows.filter((row) => row.status === "unmatched").map((row) => row.cfbdTeamName),
    }),
    domains: Object.freeze(domains),
    playerJoinQuality: Object.freeze({
      attempts: transferRows.length,
      durableExact: countWhere(transferRows, (row) => row.identity.status === "exact"),
      explicitMapped: countWhere(transferRows, (row) => row.identity.status === "mapped"),
      ambiguous: countWhere(transferRows, (row) => row.identity.status === "ambiguous"),
      rejectedNameOnly: countWhere(transferRows, (row) => row.identity.reason === "name-only player joins are not trusted"),
      unmatched: countWhere(transferRows, (row) => row.identity.status === "unmatched"),
    }),
    qbDistribution: Object.freeze(qbDistribution),
    quality: Object.freeze({
      averageCompleteness: completeness.length ? round(completeness.reduce((sum, value) => sum + value, 0) / completeness.length) : 0,
      medianCompleteness: round(median(completeness)),
      ratedInputReady: ready,
      suspect,
      insufficientMarketOnlyCandidate: insufficient,
      sourceMissingness: Object.freeze(sourceMissingness),
      missingEffectiveTimestampTeams: countWhere(snapshots, (row) => row.quality.missingEffectiveTimes.length > 0),
    }),
    providerDomains: Object.freeze(Object.fromEntries(Object.entries(records).map(([name, record]) => [name, Object.freeze({
      ok: record.ok,
      count: record.count,
      error: record.error,
    })]))),
  });
}

async function collectCfbPreseason(options = {}) {
  const season = assertSeason(options.season ?? SEASON);
  const key = `${season}`;
  if (inflight.has(key)) return inflight.get(key);
  const promise = (async () => {
    const clock = options.clock || (() => new Date());
    const cfbdGet = options.cfbdGet || require("./cfbdApi")._internal.cfbdGet;
    const fetchImpl = options.fetchImpl || global.fetch;
    if (typeof cfbdGet !== "function" || typeof fetchImpl !== "function") {
      throw new Error("collector provider clients are unavailable");
    }
    const bulk = await fetchBulkInputs({ cfbdGet, fetchImpl, clock });
    const bounds = options.populationBounds || DEFAULT_POPULATION_BOUNDS;
    if (bulk.payloads.teams.length < bounds.min || bulk.payloads.teams.length > bounds.max) {
      throw new Error(`CFBD FBS population ${bulk.payloads.teams.length} is outside safe bounds ${bounds.min}-${bounds.max}`);
    }
    if (bulk.espnTeams.length < bounds.min || bulk.espnTeams.length > bounds.max) {
      throw new Error(`ESPN FBS population ${bulk.espnTeams.length} is outside safe bounds ${bounds.min}-${bounds.max}`);
    }
    const snapshotAt = isoNow(clock);
    const built = buildSnapshots({
      bulk,
      snapshotAt,
      explicitTeamMappings: options.explicitTeamMappings || {},
    });
    const coverage = detailedCoverage({
      snapshots: built.snapshots,
      identity: built.identity,
      records: bulk.records,
      expectedFbsTeams: bulk.payloads.teams.length,
    });
    return Object.freeze({
      season,
      collectorVersion: COLLECTOR_VERSION,
      contractVersion: CONTRACT_VERSION,
      requestBudget: bulk.budget,
      callLog: Object.freeze(Object.values(bulk.records)),
      snapshots: built.snapshots,
      identityResolutions: built.identity.rows,
      coverage,
    });
  })();
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

function snapshotRow(snapshot) {
  return Object.freeze({
    season: snapshot.season,
    contract_version: snapshot.contractVersion,
    snapshot_at: snapshot.snapshotAt,
    team_name: snapshot.team.name,
    espn_team_id: String(snapshot.team.espnTeamId),
    cfbd_team_id: Number(snapshot.team.cfbdTeamId),
    identity_status: snapshot.team.identityStatus,
    identity_reason: snapshot.team.identityReason,
    sources: snapshot.sources,
    prior_references: snapshot.priorReferences,
    quarterback: snapshot.quarterback,
    roster: snapshot.roster,
    returning_production: snapshot.returningProduction,
    transfers: snapshot.transfers,
    talent: snapshot.talent,
    coaching: snapshot.coaching,
    quality: snapshot.quality,
    input_hash: snapshot.inputHash,
  });
}

function createSupabaseClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_KEY are required for persistence");
  }
  const { createClient } = require("@supabase/supabase-js");
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function tableCount(supabase, table, configure = (query) => query) {
  const query = configure(supabase.from(table).select("id", { count: "exact", head: true }));
  const { count, error } = await query;
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return Number(count || 0);
}

async function persistTeamSnapshots(supabase, snapshots) {
  if (!supabase || typeof supabase.from !== "function") throw new Error("service-role Supabase client is required");
  const rows = snapshots.map(snapshotRow);
  let accepted = 0;
  for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + INSERT_CHUNK_SIZE);
    const { data, error } = await supabase.from(TEAM_TABLE).upsert(chunk, {
      onConflict: "season,cfbd_team_id,contract_version,input_hash",
      ignoreDuplicates: true,
    }).select("id,season,cfbd_team_id,contract_version,input_hash,snapshot_at");
    if (error) throw new Error(`immutable team snapshot insert failed: ${error.message}`);
    accepted += Array.isArray(data) ? data.length : 0;
  }
  return Object.freeze({ attempted: rows.length, inserted: accepted });
}

async function verifyIsolationCounts(supabase) {
  return Object.freeze({
    teamSnapshots: await tableCount(supabase, TEAM_TABLE, (query) => query.eq("season", SEASON)),
    gameSnapshots: await tableCount(supabase, "cfb_game_input_snapshots", (query) => query.eq("season", SEASON)),
    linkedPredictions: await tableCount(supabase, "model_predictions", (query) => query.not("cfb_input_snapshot_id", "is", null)),
  });
}

async function runControlledCollection(options = {}) {
  assertSeason(options.season ?? SEASON);
  if (options.confirmation !== EXECUTION_CONFIRMATION) {
    throw new Error("controlled collection confirmation is required");
  }
  const collection = await collectCfbPreseason(options);
  if (collection.requestBudget.actual.cfbd !== PLANNED_CFBD_REQUESTS
      || collection.requestBudget.actual.espn !== PLANNED_ESPN_REQUESTS) {
    throw new Error("actual provider call count did not match the frozen bulk plan");
  }
  const safeIdentities = collection.coverage.identity.exact + collection.coverage.identity.mapped;
  const safeIdentityRate = collection.coverage.identity.expectedFbsTeams
    ? safeIdentities / collection.coverage.identity.expectedFbsTeams
    : 0;
  if (safeIdentityRate < MIN_SAFE_IDENTITY_RATE) {
    const error = new Error(`safe team identity coverage ${round(safeIdentityRate)} is below ${MIN_SAFE_IDENTITY_RATE}`);
    error.collection = collection;
    throw error;
  }
  if (!options.persist) return Object.freeze({ collection, persistence: null });

  const supabase = options.supabase || createSupabaseClient();
  const before = await verifyIsolationCounts(supabase);
  const first = await persistTeamSnapshots(supabase, collection.snapshots);
  const afterFirst = await verifyIsolationCounts(supabase);
  const retry = options.verifyIdempotency === false
    ? null
    : await persistTeamSnapshots(supabase, collection.snapshots);
  const afterRetry = await verifyIsolationCounts(supabase);
  if (afterFirst.teamSnapshots !== before.teamSnapshots + first.inserted) {
    throw new Error("team snapshot count did not match insert result");
  }
  if (afterFirst.gameSnapshots !== before.gameSnapshots || afterRetry.gameSnapshots !== before.gameSnapshots) {
    throw new Error("game snapshot isolation was violated");
  }
  if (afterFirst.linkedPredictions !== before.linkedPredictions || afterRetry.linkedPredictions !== before.linkedPredictions) {
    throw new Error("model_predictions snapshot-link isolation was violated");
  }
  if (afterRetry.teamSnapshots !== afterFirst.teamSnapshots) {
    throw new Error("duplicate retry changed immutable team snapshot count");
  }
  return Object.freeze({
    collection,
    persistence: Object.freeze({ before, first, afterFirst, retry, afterRetry }),
  });
}

function publicSummary(result) {
  const collection = result.collection || result;
  return Object.freeze({
    season: collection.season,
    collectorVersion: collection.collectorVersion,
    contractVersion: collection.contractVersion,
    requestBudget: collection.requestBudget,
    callLog: collection.callLog,
    coverage: collection.coverage,
    persistence: result.persistence || null,
  });
}

function parseArgs(argv) {
  const values = Object.fromEntries(argv.filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => arg.slice(2).split(/=(.*)/s).slice(0, 2)));
  return {
    execute: argv.includes("--execute"),
    persist: argv.includes("--persist"),
    season: Number(values.season || SEASON),
    confirmation: values.confirm || null,
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.execute) {
    console.log(JSON.stringify({
      shadowOnly: true,
      season: SEASON,
      collectorVersion: COLLECTOR_VERSION,
      plannedRequests: { cfbd: PLANNED_CFBD_REQUESTS, espn: PLANNED_ESPN_REQUESTS },
      domains: REQUEST_PLAN.map(({ provider, domain, endpoint }) => ({ provider, domain, endpoint })),
      note: "plan only; no provider or database calls were made",
    }, null, 2));
    return;
  }
  const result = await runControlledCollection({
    season: args.season,
    confirmation: args.confirmation,
    persist: args.persist,
  });
  console.log(JSON.stringify(publicSummary(result), null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: cleanError(error) }));
    process.exitCode = 1;
  });
}

module.exports = {
  SEASON,
  COLLECTOR_VERSION,
  EXECUTION_CONFIRMATION,
  TEAM_TABLE,
  REQUEST_PLAN,
  PLANNED_CFBD_REQUESTS,
  PLANNED_ESPN_REQUESTS,
  DEFAULT_POPULATION_BOUNDS,
  MIN_SAFE_IDENTITY_RATE,
  collectCfbPreseason,
  persistTeamSnapshots,
  verifyIsolationCounts,
  runControlledCollection,
  publicSummary,
  snapshotRow,
  _internal: {
    assertSeason,
    cleanError,
    createRequestBudget,
    extractEspnTeams,
    groupRows,
    uniqueRow,
    buildSources,
    identityCoverage,
    fetchBulkInputs,
    buildSnapshots,
    detailedCoverage,
    parseArgs,
    main,
  },
};
