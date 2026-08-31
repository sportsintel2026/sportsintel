"use strict";

// Offline-only CFB preseason input contract. This module has no provider, database,
// route, scheduler, or model imports. A future approved collector may pass already-
// fetched bulk payloads into these pure functions; nothing here can affect customer
// predictions or consume CFBD allowance.

const crypto = require("crypto");
const { cfbNorm } = require("./teamKey");

const CONTRACT_VERSION = "cfb-preseason-input-v1-2026-08-30";
const IDENTITY_STATES = Object.freeze(["exact", "mapped", "ambiguous", "unmatched"]);
const QB_CATEGORIES = Object.freeze([
  "returning-established-starter",
  "returning-roster-new-starter",
  "confirmed-transfer-starter",
  "freshman-new-starter",
  "open-competition",
  "confirmed-unavailable",
  "unknown-unverified",
]);

const RETURNING_FIELDS = Object.freeze([
  "totalPPA", "totalPassingPPA", "totalReceivingPPA", "totalRushingPPA",
  "percentPPA", "percentPassingPPA", "percentReceivingPPA", "percentRushingPPA",
  "usage", "passingUsage", "receivingUsage", "rushingUsage",
]);
const SOURCE_DOMAINS = Object.freeze([
  "teams", "roster", "returningProduction", "transfers", "talent",
  "recruitingTeams", "recruitingPlayers", "coaching", "externalRatings",
]);

function nullableNumber(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableInteger(value) {
  const number = nullableNumber(value);
  return number != null && Number.isInteger(number) ? number : null;
}

function nullableText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function isoTimestamp(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((out, key) => {
      if (value[key] !== undefined) out[key] = stableValue(value[key]);
      return out;
    }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function inputHash(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sortStable(rows) {
  return rows.sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
}

function sourceStamp(source = {}) {
  if (!source || typeof source !== "object") source = {};
  return Object.freeze({
    provider: nullableText(source.provider),
    endpoint: nullableText(source.endpoint),
    version: nullableText(source.version),
    retrievedAt: isoTimestamp(source.retrievedAt),
    effectiveAt: isoTimestamp(source.effectiveAt),
    season: nullableInteger(source.season),
    available: source.available === true,
    historicallyAsOfSafe: source.historicallyAsOfSafe === true,
  });
}

function canonicalTeamName(team) {
  return nullableText(team?.school || team?.displayName || team?.location || team?.name);
}

function teamNameKeys(team) {
  const names = [
    team?.school, team?.displayName, team?.shortDisplayName, team?.location, team?.name,
    ...(Array.isArray(team?.alternateNames) ? team.alternateNames : []),
  ];
  return [...new Set(names.map(cfbNorm).filter(Boolean))];
}

function reconcileTeamIdentities({ espnTeams = [], cfbdTeams = [], explicitMappings = {} } = {}) {
  const cfbdIdGroups = new Map();
  for (const team of cfbdTeams) {
    const id = nullableText(team?.id);
    if (!id) continue;
    if (!cfbdIdGroups.has(id)) cfbdIdGroups.set(id, []);
    cfbdIdGroups.get(id).push(team);
  }
  const espnIdCounts = new Map();
  for (const team of espnTeams) {
    const id = nullableText(team?.id);
    if (id) espnIdCounts.set(id, (espnIdCounts.get(id) || 0) + 1);
  }
  const cfbdById = new Map();
  const cfbdByName = new Map();
  for (const [index, team] of cfbdTeams.entries()) {
    const id = nullableText(team?.id);
    if (!id) continue;
    const duplicateProviderId = cfbdIdGroups.get(id).length > 1;
    if (!duplicateProviderId) cfbdById.set(id, team);
    for (const key of teamNameKeys(team)) {
      if (!cfbdByName.has(key)) cfbdByName.set(key, []);
      cfbdByName.get(key).push({ team, duplicateProviderId, token: `${id}:${index}` });
    }
  }

  const provisional = espnTeams.map((espnTeam) => {
    const espnId = nullableText(espnTeam?.id);
    if (!espnId) {
      return Object.freeze({
        status: "unmatched",
        espnTeamId: null,
        cfbdTeamId: null,
        espnTeamName: canonicalTeamName(espnTeam),
        cfbdTeamName: null,
        matchKey: null,
        candidates: [],
        reason: "ESPN durable team ID is missing",
      });
    }
    if (espnId && espnIdCounts.get(espnId) > 1) {
      return Object.freeze({
        status: "ambiguous",
        espnTeamId: espnId,
        cfbdTeamId: null,
        espnTeamName: canonicalTeamName(espnTeam),
        cfbdTeamName: null,
        matchKey: null,
        candidates: [],
        reason: "duplicate ESPN durable team ID",
      });
    }
    const mappedId = espnId ? nullableText(explicitMappings[espnId]) : null;
    if (mappedId) {
      const mapped = cfbdById.get(mappedId);
      const duplicateTarget = (cfbdIdGroups.get(mappedId) || []).length > 1;
      return Object.freeze({
        status: duplicateTarget ? "ambiguous" : mapped ? "mapped" : "unmatched",
        espnTeamId: espnId,
        cfbdTeamId: mapped && !duplicateTarget ? nullableText(mapped.id) : null,
        espnTeamName: canonicalTeamName(espnTeam),
        cfbdTeamName: mapped && !duplicateTarget ? canonicalTeamName(mapped) : null,
        matchKey: null,
        candidates: mapped && !duplicateTarget ? [] : (cfbdIdGroups.get(mappedId) || []).map((team) => ({
          id: mappedId,
          name: canonicalTeamName(team),
        })),
        reason: duplicateTarget ? "explicit mapping target has a duplicate CFBD durable ID"
          : mapped ? "explicit durable-ID mapping" : "explicit mapping target was absent",
      });
    }

    const exactKeys = teamNameKeys(espnTeam);
    const candidates = new Map();
    for (const key of exactKeys) {
      for (const candidate of cfbdByName.get(key) || []) candidates.set(candidate.token, candidate);
    }
    const values = [...candidates.values()];
    const duplicateProviderId = values.some((candidate) => candidate.duplicateProviderId);
    const status = values.length === 1 && !duplicateProviderId ? "exact" : values.length > 0 ? "ambiguous" : "unmatched";
    const matched = status === "exact" ? values[0].team : null;
    return Object.freeze({
      status,
      espnTeamId: espnId,
      cfbdTeamId: matched ? nullableText(matched.id) : null,
      espnTeamName: canonicalTeamName(espnTeam),
      cfbdTeamName: matched ? canonicalTeamName(matched) : null,
      matchKey: matched ? cfbNorm(canonicalTeamName(matched)) : null,
      candidates: values.map(({ team }) => ({ id: nullableText(team.id), name: canonicalTeamName(team) })),
      reason: status === "exact" ? "unique normalized provider-name identity"
        : status === "ambiguous" ? (duplicateProviderId
          ? "duplicate CFBD durable team ID"
          : "multiple durable CFBD identities share the exact normalized name")
          : "no exact name or explicit durable-ID mapping",
    });
  });

  // Enforce a one-to-one cross-provider map. Even individually exact names are not
  // safe if two ESPN identities converge on the same CFBD durable ID.
  const usesByCfbdId = new Map();
  for (const row of provisional) {
    if (!row.cfbdTeamId) continue;
    if (!usesByCfbdId.has(row.cfbdTeamId)) usesByCfbdId.set(row.cfbdTeamId, []);
    usesByCfbdId.get(row.cfbdTeamId).push(row);
  }
  return provisional.map((row) => {
    if (!row.cfbdTeamId || usesByCfbdId.get(row.cfbdTeamId).length === 1) return row;
    return Object.freeze({
      ...row,
      status: "ambiguous",
      cfbdTeamId: null,
      cfbdTeamName: null,
      matchKey: null,
      candidates: usesByCfbdId.get(row.cfbdTeamId).map((match) => ({
        id: row.cfbdTeamId,
        name: match.espnTeamName,
      })),
      reason: "multiple ESPN identities resolve to the same CFBD durable ID",
    });
  });
}

function reconcilePlayerIdentity(reference = {}, rosterPlayers = [], explicitMappings = {}) {
  const directId = nullableText(reference.playerId || reference.id || reference.athleteId);
  const rosterById = new Map();
  for (const player of rosterPlayers) {
    const id = nullableText(player?.id || player?.athleteId);
    if (!id) continue;
    if (!rosterById.has(id)) rosterById.set(id, []);
    rosterById.get(id).push(player);
  }
  if (directId && rosterById.get(directId)?.length === 1) {
    return Object.freeze({ status: "exact", playerId: directId, reason: "durable player ID" });
  }
  if (directId && rosterById.get(directId)?.length > 1) {
    return Object.freeze({ status: "ambiguous", playerId: null, reason: "duplicate roster player durable ID" });
  }

  const sourceKey = nullableText(reference.sourceKey);
  const mappedId = sourceKey ? nullableText(explicitMappings[sourceKey]) : null;
  if (mappedId && rosterById.get(mappedId)?.length === 1) {
    return Object.freeze({ status: "mapped", playerId: mappedId, reason: "explicit durable player mapping" });
  }
  if (mappedId && rosterById.get(mappedId)?.length > 1) {
    return Object.freeze({ status: "ambiguous", playerId: null, reason: "mapped roster player ID is duplicated" });
  }

  // CFBD portal rows do not carry a durable player ID. A matching name is useful for
  // ambiguity reporting only; it is never accepted as identity.
  const name = cfbNorm(reference.name || `${reference.firstName || ""} ${reference.lastName || ""}`);
  const nameMatches = name ? rosterPlayers.filter((player) => (
    cfbNorm(player?.name || `${player?.firstName || ""} ${player?.lastName || ""}`) === name
  )) : [];
  if (nameMatches.length) {
    return Object.freeze({
      status: "ambiguous",
      playerId: null,
      candidatePlayerIds: nameMatches.map((player) => nullableText(player?.id || player?.athleteId)).filter(Boolean).sort(),
      reason: "name-only player joins are not trusted",
    });
  }
  return Object.freeze({ status: "unmatched", playerId: null, candidatePlayerIds: [], reason: "no durable player identity" });
}

function adaptReturningProduction(row, source) {
  const values = {};
  const missingFields = [];
  for (const field of RETURNING_FIELDS) {
    values[field] = nullableNumber(row?.[field]);
    if (values[field] == null) missingFields.push(field);
  }
  return Object.freeze({
    available: source?.available === true,
    recordFound: !!row,
    team: nullableText(row?.team),
    conference: nullableText(row?.conference),
    season: nullableInteger(row?.season),
    values: Object.freeze(values),
    missingFields: Object.freeze(missingFields),
  });
}

function adaptRoster(players = [], source = {}) {
  const seen = new Set();
  let duplicateIdCount = 0;
  const rows = sortStable((players || []).map((player) => {
    const id = nullableText(player?.id || player?.athleteId);
    if (id && seen.has(id)) duplicateIdCount++;
    if (id) seen.add(id);
    return Object.freeze({
      id,
      athleteId: nullableText(player?.athleteId),
      firstName: nullableText(player?.firstName),
      lastName: nullableText(player?.lastName),
      position: nullableText(player?.position),
      year: nullableInteger(player?.year),
      height: nullableNumber(player?.height),
      weight: nullableNumber(player?.weight),
      recruitIds: Object.freeze((player?.recruitIds || []).map(nullableText).filter(Boolean).sort()),
    });
  }));
  const missingIdCount = rows.filter((player) => !player.id).length;
  return Object.freeze({
    available: source.available === true,
    players: Object.freeze(rows),
    playerCount: rows.length,
    durableIdCount: rows.length - missingIdCount,
    missingIdCount,
    duplicateIdCount,
  });
}

function transferRecord(row, direction, rosterPlayers, explicitPlayerMappings) {
  const identity = reconcilePlayerIdentity({
    playerId: row?.playerId,
    sourceKey: row?.sourceKey,
    firstName: row?.firstName,
    lastName: row?.lastName,
  }, rosterPlayers, explicitPlayerMappings);
  return Object.freeze({
    direction,
    firstName: nullableText(row?.firstName),
    lastName: nullableText(row?.lastName),
    position: nullableText(row?.position),
    origin: nullableText(row?.origin),
    destination: nullableText(row?.destination),
    transferDate: isoTimestamp(row?.transferDate),
    rating: nullableNumber(row?.rating),
    stars: nullableInteger(row?.stars),
    eligibility: nullableText(row?.eligibility),
    identity,
    priorUsage: identity.playerId ? (row?.priorUsage ?? null) : null,
    priorProduction: identity.playerId ? (row?.priorProduction ?? null) : null,
    recruitingPrior: identity.playerId ? (row?.recruitingPrior ?? null) : null,
  });
}

function adaptTransfers(rows, teamName, rosterPlayers = [], explicitPlayerMappings = {}, source = {}) {
  const teamKey = cfbNorm(teamName);
  const arrivals = [];
  const departures = [];
  for (const row of rows || []) {
    if (cfbNorm(row?.destination) === teamKey) arrivals.push(transferRecord(row, "arrival", rosterPlayers, explicitPlayerMappings));
    if (cfbNorm(row?.origin) === teamKey) departures.push(transferRecord(row, "departure", rosterPlayers, explicitPlayerMappings));
  }
  const all = [...arrivals, ...departures];
  return Object.freeze({
    available: source.available === true,
    arrivals: Object.freeze(sortStable(arrivals)),
    departures: Object.freeze(sortStable(departures)),
    ambiguousIdentityCount: all.filter((row) => row.identity.status === "ambiguous").length,
    unmatchedIdentityCount: all.filter((row) => row.identity.status === "unmatched").length,
    safelyJoinedCount: all.filter((row) => row.identity.status === "exact" || row.identity.status === "mapped").length,
  });
}

function adaptTalent({ talentRow, recruitingTeamRows = [], recruitingPlayerRows = [], sources = {} } = {}) {
  const recordCount = (talentRow ? 1 : 0) + recruitingTeamRows.length + recruitingPlayerRows.length;
  return Object.freeze({
    available: sources.talent?.available === true
      || sources.recruitingTeams?.available === true
      || sources.recruitingPlayers?.available === true,
    sourceAvailability: Object.freeze({
      talent: sources.talent?.available === true,
      recruitingTeams: sources.recruitingTeams?.available === true,
      recruitingPlayers: sources.recruitingPlayers?.available === true,
    }),
    recordCount,
    teamTalent: talentRow ? {
      year: nullableInteger(talentRow.year),
      talent: nullableNumber(talentRow.talent),
    } : null,
    recruitingTeams: Object.freeze(sortStable(recruitingTeamRows.map((row) => ({
      year: nullableInteger(row?.year),
      rank: nullableInteger(row?.rank),
      points: nullableNumber(row?.points),
    })))),
    recruitingPlayers: Object.freeze(sortStable(recruitingPlayerRows.map((row) => ({
      id: nullableText(row?.id),
      athleteId: nullableText(row?.athleteId),
      year: nullableInteger(row?.year),
      position: nullableText(row?.position),
      stars: nullableInteger(row?.stars),
      rating: nullableNumber(row?.rating),
      committedTo: nullableText(row?.committedTo),
    })))),
  });
}

function adaptCoaching(coaches, { season, cfbdTeamId, source = {} } = {}) {
  const candidates = [];
  for (const coach of coaches || []) {
    const seasons = (coach?.seasons || []).filter((item) => (
      nullableInteger(item?.year) === nullableInteger(season)
      && nullableText(item?.teamId) === nullableText(cfbdTeamId)
    ));
    for (const coachSeason of seasons) candidates.push({ coach, season: coachSeason });
  }
  if (candidates.length !== 1) {
    return Object.freeze({
      available: source.available === true,
      identityStatus: candidates.length > 1 ? "ambiguous" : "unmatched",
      headCoach: null,
      tenureYears: null,
      continuity: null,
    });
  }
  const { coach, season: current } = candidates[0];
  const teamSeasons = (coach.seasons || [])
    .filter((item) => nullableText(item?.teamId) === nullableText(cfbdTeamId) && nullableInteger(item?.year) <= season);
  return Object.freeze({
    available: source.available === true,
    identityStatus: "exact",
    headCoach: {
      id: nullableText(coach?.id),
      firstName: nullableText(coach?.firstName),
      lastName: nullableText(coach?.lastName),
    },
    tenureYears: teamSeasons.length,
    continuity: teamSeasons.some((item) => nullableInteger(item?.year) === season - 1),
    seasonRecord: {
      games: nullableInteger(current?.games),
      wins: nullableInteger(current?.wins),
      losses: nullableInteger(current?.losses),
    },
  });
}

function classifyQuarterback(evidence = {}) {
  const requested = QB_CATEGORIES.includes(evidence.category) ? evidence.category : "unknown-unverified";
  const confirmed = evidence.evidenceStatus === "confirmed";
  const playerId = nullableText(evidence.playerId);
  const source = nullableText(evidence.source);
  const effectiveAt = isoTimestamp(evidence.effectiveAt);
  const retrievedAt = isoTimestamp(evidence.retrievedAt);
  const confidence = nullableText(evidence.confidence);
  const playerRequired = new Set([
    "returning-established-starter", "returning-roster-new-starter",
    "confirmed-transfer-starter", "freshman-new-starter",
  ]);
  const identityTrusted = evidence.identityStatus === "exact" || evidence.identityStatus === "mapped";
  const evidenceComplete = confirmed
    && !!source
    && !!retrievedAt
    && !!effectiveAt
    && ["high", "medium", "low"].includes(confidence);
  const allowed = requested === "unknown-unverified"
    || (evidenceComplete && (!playerRequired.has(requested) || (!!playerId && identityTrusted)));
  const category = allowed ? requested : "unknown-unverified";
  return Object.freeze({
    category,
    playerId: category === "unknown-unverified" ? null : playerId,
    playerName: category === "unknown-unverified" ? null : nullableText(evidence.playerName),
    confidence: category === "unknown-unverified" ? "unknown" : confidence,
    evidenceStatus: category === "unknown-unverified" ? "unverified" : "confirmed",
    source: category === "unknown-unverified" ? null : source,
    retrievedAt: category === "unknown-unverified" ? null : retrievedAt,
    effectiveAt: category === "unknown-unverified" ? null : effectiveAt,
  });
}

function externalRatingReference(row, source = {}) {
  if (!row) return null;
  return Object.freeze({
    researchOnly: true,
    provider: nullableText(source.provider),
    season: nullableInteger(row.year),
    team: nullableText(row.team),
    rating: nullableNumber(row.rating),
    ranking: nullableInteger(row.ranking),
    sos: nullableNumber(row.sos),
  });
}

function qualityReport({ season, identity, roster, returningProduction, transfers, talent, coaching, qb, sources }) {
  const sourceReliablyUsable = (name) => (
    sources[name]?.available === true
    && sources[name]?.season === season
    && !!sources[name]?.retrievedAt
  );
  const domainStatus = {
    identity: {
      available: !!identity,
      reliablyUsable: sourceReliablyUsable("teams")
        && (identity?.status === "exact" || identity?.status === "mapped"),
    },
    roster: {
      available: roster.available,
      reliablyUsable: sourceReliablyUsable("roster")
        && roster.playerCount > 0
        && roster.missingIdCount === 0
        && roster.duplicateIdCount === 0,
    },
    returningProduction: {
      available: returningProduction.available,
      reliablyUsable: sourceReliablyUsable("returningProduction")
        && returningProduction.recordFound
        && returningProduction.missingFields.length === 0,
    },
    transfers: {
      available: transfers.available,
      reliablyUsable: sourceReliablyUsable("transfers")
        && transfers.ambiguousIdentityCount === 0
        && transfers.unmatchedIdentityCount === 0,
    },
    talent: {
      available: talent.sourceAvailability.talent,
      reliablyUsable: sourceReliablyUsable("talent") && !!talent.teamTalent,
    },
    recruiting: {
      available: talent.sourceAvailability.recruitingTeams && talent.sourceAvailability.recruitingPlayers,
      reliablyUsable: sourceReliablyUsable("recruitingTeams")
        && sourceReliablyUsable("recruitingPlayers")
        && talent.recruitingTeams.length > 0,
    },
    coaching: {
      available: coaching.available,
      reliablyUsable: sourceReliablyUsable("coaching") && coaching.identityStatus === "exact",
    },
    quarterback: {
      available: qb.category !== "unknown-unverified",
      reliablyUsable: qb.category !== "unknown-unverified" && qb.evidenceStatus === "confirmed",
    },
  };
  const statuses = Object.values(domainStatus);
  const missingSources = Object.entries(sources)
    .filter(([, stamp]) => !stamp.available)
    .map(([name]) => name).sort();
  const historicalBacktestUnsafeSources = Object.entries(sources)
    .filter(([, stamp]) => stamp.available && !stamp.historicallyAsOfSafe)
    .map(([name]) => name).sort();
  const missingRetrievalTimes = Object.entries(sources)
    .filter(([, stamp]) => stamp.available && !stamp.retrievedAt)
    .map(([name]) => name).sort();
  const missingEffectiveTimes = Object.entries(sources)
    .filter(([, stamp]) => stamp.available && !stamp.effectiveAt)
    .map(([name]) => name).sort();
  const missingSourceSeasons = Object.entries(sources)
    .filter(([, stamp]) => stamp.available && stamp.season == null)
    .map(([name]) => name).sort();
  const sourceSeasonMismatches = Object.entries(sources)
    .filter(([, stamp]) => stamp.available && stamp.season != null && stamp.season !== season)
    .map(([name]) => name).sort();
  return Object.freeze({
    domains: Object.freeze(domainStatus),
    availableCount: statuses.filter((status) => status.available).length,
    reliablyUsableCount: statuses.filter((status) => status.reliablyUsable).length,
    completeness: statuses.length ? statuses.filter((status) => status.reliablyUsable).length / statuses.length : 0,
    missingSources: Object.freeze(missingSources),
    historicalBacktestUnsafeSources: Object.freeze(historicalBacktestUnsafeSources),
    missingRetrievalTimes: Object.freeze(missingRetrievalTimes),
    missingEffectiveTimes: Object.freeze(missingEffectiveTimes),
    missingSourceSeasons: Object.freeze(missingSourceSeasons),
    sourceSeasonMismatches: Object.freeze(sourceSeasonMismatches),
    returningMissingFields: returningProduction.missingFields,
    ambiguousPlayerJoins: transfers.ambiguousIdentityCount,
    unmatchedPlayerJoins: transfers.unmatchedIdentityCount,
  });
}

function buildTeamPreseasonSnapshot(input = {}) {
  const season = nullableInteger(input.season);
  if (!season) throw new Error("season is required");
  const snapshotAt = isoTimestamp(input.snapshotAt);
  if (!snapshotAt) throw new Error("valid snapshotAt is required");
  const contractVersion = nullableText(input.contractVersion) || CONTRACT_VERSION;
  const identity = input.identity || { status: "unmatched" };
  if (!IDENTITY_STATES.includes(identity.status)) throw new Error("invalid team identity status");
  if (identity.status !== "exact" && identity.status !== "mapped") {
    throw new Error(`unsafe team identity cannot produce a preseason snapshot: ${identity.status}`);
  }
  if (!nullableText(identity.espnTeamId) || !nullableText(identity.cfbdTeamId)
      || !nullableText(identity.cfbdTeamName || identity.espnTeamName)) {
    throw new Error("safe team snapshot requires both durable provider IDs and a team name");
  }
  if (!(nullableInteger(identity.cfbdTeamId) > 0)) {
    throw new Error("safe team snapshot requires a positive numeric CFBD team ID");
  }

  const sourceNames = [...new Set([...SOURCE_DOMAINS, ...Object.keys(input.sources || {})])];
  const sources = Object.freeze(Object.fromEntries(sourceNames
    .map((name) => [name, sourceStamp(input.sources?.[name])])));
  for (const [name, source] of Object.entries(sources)) {
    if (source.retrievedAt && source.retrievedAt > snapshotAt) {
      throw new Error(`${name} retrieval time cannot be after snapshotAt`);
    }
    if (source.effectiveAt && source.effectiveAt > snapshotAt) {
      throw new Error(`${name} effective time cannot be after snapshotAt`);
    }
  }
  const returningProduction = adaptReturningProduction(input.returningProductionRow, sources.returningProduction);
  const roster = adaptRoster(input.rosterPlayers || [], sources.roster || {});
  const transfers = adaptTransfers(
    input.transferRows || [], identity.cfbdTeamName || identity.espnTeamName,
    input.rosterPlayers || [], input.explicitPlayerMappings || {}, sources.transfers || {}
  );
  const talent = adaptTalent({
    talentRow: input.talentRow,
    recruitingTeamRows: input.recruitingTeamRows || [],
    recruitingPlayerRows: input.recruitingPlayerRows || [],
    sources,
  });
  const coaching = adaptCoaching(input.coaches || [], {
    season, cfbdTeamId: identity.cfbdTeamId, source: sources.coaching || {},
  });
  const qb = classifyQuarterback(input.qbEvidence);
  if (qb.retrievedAt && qb.retrievedAt > snapshotAt) {
    throw new Error("quarterback evidence retrieval time cannot be after snapshotAt");
  }
  if (qb.effectiveAt && qb.effectiveAt > snapshotAt) {
    throw new Error("quarterback evidence effective time cannot be after snapshotAt");
  }
  const quality = qualityReport({ season, identity, roster, returningProduction, transfers, talent, coaching, qb, sources });

  const snapshot = {
    season,
    contractVersion,
    snapshotAt,
    team: {
      name: identity.cfbdTeamName || identity.espnTeamName || null,
      espnTeamId: identity.espnTeamId || null,
      cfbdTeamId: identity.cfbdTeamId || null,
      identityStatus: identity.status,
      identityReason: identity.reason || null,
    },
    sources,
    priorReferences: {
      wizePicks: input.priorWizePicksRating == null ? null : {
        season: nullableInteger(input.priorWizePicksRating.season),
        rating: nullableNumber(input.priorWizePicksRating.rating),
        formulaVersion: nullableText(input.priorWizePicksRating.formulaVersion),
      },
      externalRating: externalRatingReference(input.externalRatingRow, sources.externalRatings),
    },
    quarterback: qb,
    roster,
    returningProduction,
    transfers,
    talent,
    coaching,
    quality,
  };
  // Idempotency is based on the evidence itself. Collection/retry timestamps remain
  // stored as provenance, but snapshotAt and provider retrievedAt alone do not create a
  // new logical snapshot. Effective dates and source/model versions remain semantic.
  const semanticSnapshot = {
    ...snapshot,
    snapshotAt: undefined,
    sources: Object.fromEntries(Object.entries(snapshot.sources).map(([name, source]) => [name, {
      ...source,
      retrievedAt: undefined,
    }])),
    quarterback: {
      ...snapshot.quarterback,
      retrievedAt: undefined,
    },
  };
  return deepFreeze({ ...snapshot, inputHash: inputHash(semanticSnapshot) });
}

function buildCoverageReport(snapshots = [], expectedOrOptions = snapshots.length, identityRows = []) {
  const options = expectedOrOptions && typeof expectedOrOptions === "object"
    ? expectedOrOptions
    : { expectedFbsTeams: expectedOrOptions, identityResolutions: identityRows };
  const expected = Math.max(0, Number(options.expectedFbsTeams) || 0);
  const identityResolutions = Array.isArray(options.identityResolutions) && options.identityResolutions.length
    ? options.identityResolutions
    : snapshots.map((row) => ({ status: row.team.identityStatus }));
  const count = (predicate) => snapshots.filter(predicate).length;
  const identity = Object.fromEntries(IDENTITY_STATES.map((status) => [
    status,
    identityResolutions.filter((row) => row.status === status).length,
  ]));
  const domains = ["roster", "returningProduction", "transfers", "talent", "recruiting", "coaching", "quarterback"];
  const coverage = {};
  for (const domain of domains) {
    coverage[domain] = {
      available: count((row) => row.quality.domains[domain].available),
      reliablyUsable: count((row) => row.quality.domains[domain].reliablyUsable),
      availableRate: expected ? count((row) => row.quality.domains[domain].available) / expected : null,
      reliablyUsableRate: expected ? count((row) => row.quality.domains[domain].reliablyUsable) / expected : null,
    };
  }
  const sourceNames = [...new Set([
    ...SOURCE_DOMAINS,
    ...snapshots.flatMap((row) => Object.keys(row.sources)),
  ])];
  const expectedSourceSlots = expected * sourceNames.length;
  const availableSourceSlots = snapshots.reduce((sum, row) => (
    sum + sourceNames.filter((name) => row.sources[name]?.available).length
  ), 0);
  return Object.freeze({
    expectedFbsTeams: expected,
    snapshots: snapshots.length,
    identityEvaluated: identityResolutions.length,
    identity,
    rejectedIdentityCount: identity.ambiguous + identity.unmatched,
    safeSnapshotRate: expected ? snapshots.length / expected : null,
    coverage: Object.freeze(coverage),
    qbClassificationCoverage: coverage.quarterback,
    playerJoinAmbiguity: snapshots.reduce((sum, row) => sum + row.quality.ambiguousPlayerJoins, 0),
    playerJoinUnmatched: snapshots.reduce((sum, row) => sum + row.quality.unmatchedPlayerJoins, 0),
    averageCompleteness: snapshots.length
      ? snapshots.reduce((sum, row) => sum + row.quality.completeness, 0) / snapshots.length
      : 0,
    sourceAvailabilityRate: expectedSourceSlots ? availableSourceSlots / expectedSourceSlots : null,
    sourceMissingnessRate: expectedSourceSlots ? 1 - (availableSourceSlots / expectedSourceSlots) : null,
    expectedTeamMissingnessRate: expected ? Math.max(0, expected - snapshots.length) / expected : null,
  });
}

module.exports = {
  CONTRACT_VERSION,
  IDENTITY_STATES,
  QB_CATEGORIES,
  RETURNING_FIELDS,
  SOURCE_DOMAINS,
  reconcileTeamIdentities,
  reconcilePlayerIdentity,
  adaptReturningProduction,
  adaptRoster,
  adaptTransfers,
  adaptTalent,
  adaptCoaching,
  classifyQuarterback,
  externalRatingReference,
  buildTeamPreseasonSnapshot,
  buildCoverageReport,
  sourceStamp,
  stableStringify,
  inputHash,
  _internal: { nullableNumber, nullableInteger, nullableText, isoTimestamp, teamNameKeys, qualityReport, deepFreeze, sortStable },
};
