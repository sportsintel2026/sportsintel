"use strict";

// Offline-only normalization of the already-cached Phase 2 CFBD returning-
// production payload. This script makes zero provider calls and joins only through
// the exact durable team identity mapping that passed Phase 2 validation.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { teamKey } = require("../services/teamKey");

const VERSION = "cfb-historical-phase3-input-v1-2026-08-31";
const EXPECTED_RAW_VERSION = "cfbd-percent-ppa-historical-v1-2026-08-31";
const EXPECTED_SEMANTIC_VERSION = "cfb-historical-percentppa-semantic-input-v1-2026-08-31";
const TARGET_SEASONS = Object.freeze([2021, 2022, 2023, 2024, 2025]);
const DEFAULT_RAW_PATH = "/Users/rolandogangcuangco/Downloads/wizepicks-cfb-percentppa-2021-2025.json";
const SEMANTIC_PATH = path.join(__dirname, "data", "cfb-historical-percentppa-semantic-input-v1.json");
const OUTPUT_PATH = path.join(__dirname, "data", "cfb-historical-phase3-input-v1.json");
const RP_FIELDS = Object.freeze([
  "percentPPA",
  "percentPassingPPA",
  "percentReceivingPPA",
  "percentRushingPPA",
  "usage",
  "passingUsage",
  "receivingUsage",
  "rushingUsage",
]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalHash(value) {
  return sha256(JSON.stringify(value));
}

function finite(value) {
  const number = Number(value);
  return value !== null && value !== "" && Number.isFinite(number) ? number : null;
}

function exactKey(season, name) {
  return `${season}:${teamKey(name, "cfb")}`;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildPhase3Input(rawPath = DEFAULT_RAW_PATH) {
  const rawBytes = fs.readFileSync(rawPath);
  const raw = JSON.parse(rawBytes.toString("utf8"));
  const semantic = loadJson(SEMANTIC_PATH);
  if (raw.version !== EXPECTED_RAW_VERSION) throw new Error(`unexpected raw version ${raw.version}`);
  if (semantic.version !== EXPECTED_SEMANTIC_VERSION) {
    throw new Error(`unexpected semantic version ${semantic.version}`);
  }
  if (raw.providerCallCount !== 5) throw new Error("expected the five-call cached Phase 2 payload");
  if (JSON.stringify(raw.targetSeasons) !== JSON.stringify(TARGET_SEASONS)) {
    throw new Error("raw target seasons changed");
  }

  const semanticByExactName = new Map();
  for (const row of semantic.rows || []) {
    const key = exactKey(row.season, row.cfbdTeamName);
    if (semanticByExactName.has(key)) throw new Error(`duplicate semantic team ${key}`);
    semanticByExactName.set(key, row);
  }

  const rows = [];
  const unmatched = [];
  for (const seasonBlock of raw.seasons || []) {
    const season = finite(seasonBlock.season);
    if (!TARGET_SEASONS.includes(season)) throw new Error(`unexpected season ${season}`);
    for (const row of seasonBlock.rows || []) {
      const semanticRow = semanticByExactName.get(exactKey(season, row.team));
      if (!semanticRow) {
        unmatched.push({ season, team: row.team });
        continue;
      }
      const normalized = {
        season,
        espnTeamId: String(semanticRow.espnTeamId),
        espnTeamName: semanticRow.espnTeamName,
        cfbdTeamName: row.team,
      };
      for (const field of RP_FIELDS) normalized[field] = finite(row[field]);
      rows.push(Object.freeze(normalized));
    }
  }
  rows.sort((left, right) => left.season - right.season
    || Number(left.espnTeamId) - Number(right.espnTeamId));
  if (unmatched.length) throw new Error(`raw rows lack exact durable identity: ${JSON.stringify(unmatched)}`);
  if (rows.length !== semantic.rows.length) {
    throw new Error(`identity coverage changed: ${rows.length} vs ${semantic.rows.length}`);
  }

  const body = {
    version: VERSION,
    source: {
      provider: "CollegeFootballData",
      endpoint: "/player/returning",
      cachedRawVersion: raw.version,
      cachedRawSha256: sha256(rawBytes),
      cachedAt: raw.fetchedAt,
      identityVersion: semantic.version,
      identityContentSha256: semantic.contentSha256,
      semantics: "CFBD returning production is offensive PPA/usage; no defensive returning-production field is present.",
    },
    targetSeasons: [...TARGET_SEASONS],
    providerBudget: {
      inheritedPhase2CfbdCalls: raw.providerCallCount,
      phase3NewCfbdCalls: 0,
      phase3MaximumAllowed: 60,
    },
    qbAudit: {
      directionalFeatureAvailable: false,
      reason: "No exact historical target-season starting-QB identity with a stable athlete ID is present; name-only and target-season usage joins are forbidden.",
    },
    transferAudit: {
      directionalFeatureAvailable: false,
      reason: "No cached 2021-2025 exact team-season portal aggregate exists; player-level name joins are forbidden and no speculative provider calls were consumed.",
    },
    fields: [...RP_FIELDS],
    rows,
  };
  return Object.freeze({ ...body, contentSha256: canonicalHash(body) });
}

function writePhase3Input(rawPath = process.argv[2] || DEFAULT_RAW_PATH, outputPath = OUTPUT_PATH) {
  const result = buildPhase3Input(rawPath);
  fs.writeFileSync(outputPath, `${JSON.stringify(result)}\n`);
  return Object.freeze({ outputPath, rows: result.rows.length, contentSha256: result.contentSha256 });
}

if (require.main === module) console.log(JSON.stringify(writePhase3Input(), null, 2));

module.exports = {
  VERSION,
  TARGET_SEASONS,
  RP_FIELDS,
  DEFAULT_RAW_PATH,
  SEMANTIC_PATH,
  OUTPUT_PATH,
  buildPhase3Input,
  writePhase3Input,
  _internal: { sha256, canonicalHash, finite, exactKey },
};
