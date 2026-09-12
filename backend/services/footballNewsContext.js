"use strict";

// Exact-identity, recording-only normalization for the active ESPN/RotoWire news
// sources. No news text can change a model output; ambiguous stories are dropped.

const WEEK_MS = 14 * 24 * 60 * 60 * 1000;
const CATEGORIES = Object.freeze({
  INJURY: "injury/status update",
  STARTER: "starter/depth-chart change",
  WORKLOAD: "workload/snap restriction",
  SUSPENSION: "suspension/discipline",
  QB: "QB change",
  SKILL: "RB/WR/TE role change",
  UNIT: "OL/defensive-unit change",
  COACHING: "coaching/play-calling change",
  CFB_ROSTER: "CFB transfer/roster/QB competition",
  OTHER: "other material football context",
});

function clean(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function exactName(value) {
  return String(value || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function add(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  if (!map.get(key).includes(value)) map.get(key).push(value);
}

function one(rows) {
  const unique = [...new Set(rows || [])];
  return unique.length === 1 ? unique[0] : null;
}

function oneTeam(rows) {
  const unique = new Map();
  for (const row of rows || []) {
    const key = row?.teamId ? `id:${row.teamId}` : row?.teamName ? `name:${exactName(row.teamName)}` : null;
    if (key && !unique.has(key)) unique.set(key, row);
  }
  return unique.size === 1 ? [...unique.values()][0] : null;
}

function gameRecords(records = [], capturedAt) {
  const capturedMs = Date.parse(capturedAt);
  return records.map((record) => {
    const event = record?.event || record?._injuryWeatherShadowInput?.event || null;
    const espnGame = record?.espnGame || record?._injuryWeatherShadowInput?.espnGame || null;
    const kickoffAt = event?.commenceTime || espnGame?.date || null;
    const kickoffMs = Date.parse(kickoffAt);
    if (!event?.eventId || !Number.isFinite(kickoffMs) || kickoffMs <= capturedMs) return null;
    return {
      eventId: String(event.eventId),
      espnGameId: clean(espnGame?.gameId),
      kickoffAt,
      home: {
        teamId: clean(espnGame?.home?.id),
        teamName: clean(event.homeTeam) || clean(espnGame?.home?.displayName),
      },
      away: {
        teamId: clean(espnGame?.away?.id),
        teamName: clean(event.awayTeam) || clean(espnGame?.away?.displayName),
      },
    };
  }).filter(Boolean);
}

function playerRecords({ league, availability = [], snapshots = [] } = {}) {
  if (league === "nfl") return availability.map((row) => ({
    playerId: clean(row?.playerId), playerName: clean(row?.playerName),
    teamId: clean(row?.teamId), teamName: clean(row?.teamName),
    position: clean(row?.position)?.toUpperCase() || null,
    unit: clean(row?.unit), starter: row?.starter === true ? true : row?.starter === false ? false : null,
  })).filter((row) => row.playerId && row.playerName && row.teamId);

  const rows = [];
  for (const snapshot of snapshots || []) {
    const teamId = clean(snapshot?.espn_team_id);
    const teamName = clean(snapshot?.team_name);
    for (const player of snapshot?.roster?.players || []) {
      const playerName = clean(`${player?.firstName || ""} ${player?.lastName || ""}`);
      const playerId = clean(player?.athleteId) || clean(player?.id);
      if (playerId && playerName && teamId) rows.push({
        playerId, playerName, teamId, teamName,
        position: clean(player?.position)?.toUpperCase() || null,
        unit: null, starter: null,
      });
    }
    const qb = snapshot?.quarterback;
    if (teamId && qb?.playerId && qb?.playerName && qb?.evidenceStatus === "confirmed") {
      rows.push({
        playerId: String(qb.playerId), playerName: qb.playerName, teamId, teamName,
        position: "QB", unit: "quarterback",
        starter: qb.category === "open-competition" || qb.category === "confirmed-unavailable" ? null : true,
      });
    }
  }
  const deduped = new Map();
  for (const row of rows) {
    const key = `${row.teamId}:${row.playerId}`;
    const prior = deduped.get(key);
    deduped.set(key, prior ? {
      ...prior,
      playerName: prior.playerName || row.playerName,
      position: prior.position || row.position,
      unit: prior.unit || row.unit,
      starter: prior.starter === true || row.starter === true ? true : prior.starter ?? row.starter,
    } : row);
  }
  return [...deduped.values()];
}

function buildIndexes(games, players) {
  const gameByEspnId = new Map();
  const gamesByTeamId = new Map();
  const gamesByTeamName = new Map();
  const teamById = new Map();
  const teamByName = new Map();
  for (const game of games) {
    if (game.espnGameId) add(gameByEspnId, game.espnGameId, game);
    for (const side of [game.home, game.away]) {
      if (side.teamId) {
        add(gamesByTeamId, side.teamId, game);
        add(teamById, side.teamId, side);
      }
      if (side.teamName) {
        add(gamesByTeamName, exactName(side.teamName), game);
        add(teamByName, exactName(side.teamName), side);
      }
    }
  }
  const playersById = new Map();
  const playersByName = new Map();
  for (const player of players) {
    add(playersById, player.playerId, player);
    add(playersByName, exactName(player.playerName), player);
  }
  return { gameByEspnId, gamesByTeamId, gamesByTeamName, teamById, teamByName, playersById, playersByName };
}

function identityCategories(item) {
  return Array.isArray(item?._identityCategories)
    ? item._identityCategories
    : Array.isArray(item?.identityCategories) ? item.identityCategories : [];
}

function categoryIds(categories, types, explicitField) {
  return categories.filter((row) => types.has(String(row?.type || "").toLowerCase()))
    .map((row) => clean(row?.[explicitField]) || clean(row?.id)).filter(Boolean);
}

function categoryDescriptions(categories, types) {
  return categories.filter((row) => types.has(String(row?.type || "").toLowerCase()))
    .map((row) => clean(row?.description)).filter(Boolean);
}

function resolveOneFromIds(ids, map) {
  const found = ids.flatMap((id) => map.get(id) || []);
  return one(found);
}

function resolveOneFromNames(names, map) {
  const found = names.flatMap((name) => map.get(exactName(name)) || []);
  return one(found);
}

function intersectGameSets(sets) {
  if (!sets.length) return [];
  return sets.slice(1).reduce((current, rows) => current.filter((game) => rows.includes(game)), [...sets[0]]);
}

function positionUnit(position) {
  const pos = String(position || "").toUpperCase();
  if (pos === "QB") return "quarterback";
  if (["RB", "HB", "FB"].includes(pos)) return "backfield";
  if (["WR", "TE"].includes(pos)) return "receiver";
  if (["C", "G", "OG", "LG", "RG", "T", "OT", "LT", "RT", "OL"].includes(pos)) return "offensive_line";
  if (["DE", "DT", "NT", "DL", "EDGE", "ED"].includes(pos)) return "defensive_front";
  if (["LB", "ILB", "OLB"].includes(pos)) return "linebacker";
  if (["CB", "DB", "S", "FS", "SS"].includes(pos)) return "secondary";
  return null;
}

function categoryFor(text, league, player) {
  const value = String(text || "").toLowerCase();
  const unit = player?.unit || positionUnit(player?.position);
  if (/suspend|disciplin|commissioner.?s exempt/.test(value)) return CATEGORIES.SUSPENSION;
  if (league === "cfb" && /transfer portal|transferred|roster change|qb competition|quarterback competition/.test(value)) return CATEGORIES.CFB_ROSTER;
  if (/play.?call|play caller|offensive coordinator|defensive coordinator|head coach|coach (fired|hired|change)/.test(value)) return CATEGORIES.COACHING;
  if (/snap (count|limit|restriction)|workload (limit|restriction)|limited workload|pitch count/.test(value)) return CATEGORIES.WORKLOAD;
  if ((player?.position === "QB" || /quarterback|\bqb\b/.test(value))
      && /start|bench|depth|competition|replace|ruled|status|injur|return/.test(value)) return CATEGORIES.QB;
  if (/depth chart|named (the )?starter|will start|benched|demoted|promoted to starter/.test(value)) return CATEGORIES.STARTER;
  if ((["offensive_line", "defensive_front", "linebacker", "secondary"].includes(unit)
      || /offensive line|o-line|defensive line|pass rush|linebacker|secondary/.test(value))
      && /starter|unit|line|secondary|rotation|replace|depth|injur/.test(value)) return CATEGORIES.UNIT;
  if (/injur|questionable|doubtful|game.?time decision|injured reserve|\bir\b|ruled out|inactive|limited practice|cleared|activated|return/.test(value)) return CATEGORIES.INJURY;
  if (["backfield", "receiver"].includes(unit) && /role|touch|target|carr|reps|starter|rotation/.test(value)) return CATEGORIES.SKILL;
  if (/released|waived|retir|trade|left team|personal matter/.test(value)) return CATEGORIES.OTHER;
  return null;
}

function statusFor(text, category) {
  const value = String(text || "").toLowerCase();
  if (/suspend/.test(value)) return "suspended";
  if (/injured reserve|\bir\b/.test(value)) return "injured-reserve";
  if (/doubtful/.test(value)) return "doubtful";
  if (/questionable/.test(value)) return "questionable";
  if (/game.?time decision/.test(value)) return "game-time-decision";
  if (/snap (count|limit|restriction)|limited workload|limited practice/.test(value)) return "limited";
  if (/\b(may|might|could|considering|possible|potential|uncertain)\b|expected to/.test(value)) return "change-unresolved";
  if (/ruled out|\bout\b|inactive/.test(value)) return "out";
  if (/named (the )?starter|will start/.test(value)) return "named-starter";
  if (/benched|demoted/.test(value)) return "benched";
  if (/cleared|activated|will return|returns? to/.test(value)) return "available";
  if (/competition|competing/.test(value)) return "competition-unresolved";
  if (category === CATEGORIES.COACHING) return "coaching-change";
  if (category === CATEGORIES.CFB_ROSTER) return "roster-change";
  return "material-update-status-unresolved";
}

function isConfirmed(status) {
  return new Set([
    "suspended", "injured-reserve", "out", "named-starter", "benched",
    "available", "coaching-change", "roster-change",
  ]).has(status);
}

function impactFor({ category, status, player }) {
  const unit = player?.unit || positionUnit(player?.position);
  const highImpact = category === CATEGORIES.QB
    || category === CATEGORIES.COACHING
    || (player?.position === "QB")
    || (player?.starter === true && [
      CATEGORIES.INJURY, CATEGORIES.STARTER, CATEGORIES.WORKLOAD,
      CATEGORIES.SUSPENSION, CATEGORIES.SKILL, CATEGORIES.UNIT, CATEGORIES.OTHER,
    ].includes(category))
    || category === CATEGORIES.UNIT
    || (player?.starter === true && ["offensive_line", "defensive_front", "linebacker", "secondary"].includes(unit));
  if (!highImpact) return "informational";
  return isConfirmed(status) ? "material" : "unresolved";
}

function resolveNewsItem({ item, league, indexes, capturedAt }) {
  const newsId = clean(item?.id);
  const publishedAt = clean(item?.published);
  const publishedMs = Date.parse(publishedAt);
  const capturedMs = Date.parse(capturedAt);
  if (!newsId || !Number.isFinite(publishedMs) || publishedMs > capturedMs || capturedMs - publishedMs > WEEK_MS) return null;

  const categories = identityCategories(item);
  const eventTypes = new Set(["event"]);
  const teamTypes = new Set(["team"]);
  const athleteTypes = new Set(["athlete", "player"]);
  const eventIds = categoryIds(categories, eventTypes, "eventId");
  const teamIds = categoryIds(categories, teamTypes, "teamId");
  const athleteIds = categoryIds(categories, athleteTypes, "athleteId");
  const teamNames = categoryDescriptions(categories, teamTypes);
  const athleteNames = [...categoryDescriptions(categories, athleteTypes), clean(item?.playerName)].filter(Boolean);

  const eventGame = resolveOneFromIds(eventIds, indexes.gameByEspnId);
  if (eventIds.length && !eventGame) return null;
  const idPlayer = resolveOneFromIds(athleteIds, indexes.playersById);
  const namePlayer = resolveOneFromNames(athleteNames, indexes.playersByName);
  if (athleteIds.length && !idPlayer) return null;
  if (athleteNames.length && !idPlayer && !namePlayer) return null;
  if (idPlayer && namePlayer && idPlayer !== namePlayer) return null;
  const player = idPlayer || namePlayer || null;

  const idTeam = oneTeam(teamIds.flatMap((id) => indexes.teamById.get(id) || []));
  const nameTeam = oneTeam(teamNames.flatMap((name) => indexes.teamByName.get(exactName(name)) || []));
  const playerTeam = player ? oneTeam(indexes.teamById.get(player.teamId) || []) : null;
  if ((teamIds.length && !idTeam) || (teamNames.length && !nameTeam) || (player && !playerTeam)) return null;
  const team = oneTeam([idTeam, nameTeam, playerTeam].filter(Boolean));
  if (!team) return null;

  const gameSets = [];
  const rows = team.teamId ? indexes.gamesByTeamId.get(team.teamId) : indexes.gamesByTeamName.get(exactName(team.teamName));
  if (rows?.length) gameSets.push(rows);
  const identityGames = eventGame ? [eventGame] : intersectGameSets(gameSets);
  const game = one(identityGames);
  if (!game) return null;
  if (!game.home.teamId || !game.away.teamId || ![game.home.teamId, game.away.teamId].includes(team.teamId)) return null;
  if (player && player.teamId && ![game.home.teamId, game.away.teamId].includes(player.teamId)) return null;

  const text = `${item?.headline || ""} ${item?.summary || ""}`;
  const category = categoryFor(text, league, player);
  if (!category) return null;
  const status = statusFor(text, category);
  const contextImpact = impactFor({ category, status, player });
  const durableEvent = eventIds.length > 0;
  const durableTeam = !!team?.teamId;
  const durablePlayer = !!idPlayer;
  const identityMethod = [
    durableEvent ? "espn-event-id" : null,
    durableTeam ? "espn-team-id" : null,
    durablePlayer ? "espn-athlete-id" : player ? "exact-roster-name-collision-guarded" : null,
  ].filter(Boolean).join("+") || "exact-team-to-single-upcoming-game";
  return {
    newsId,
    league,
    source: clean(item?.source),
    publishedAt,
    capturedAt,
    eventId: game.eventId,
    espnGameId: game.espnGameId,
    kickoffAt: game.kickoffAt,
    teamId: team?.teamId || null,
    teamName: team?.teamName || null,
    playerId: player?.playerId || null,
    playerName: player?.playerName || null,
    position: player?.position || null,
    unit: player?.unit || positionUnit(player?.position),
    category,
    statusChange: status,
    confidence: durableEvent && (durablePlayer || durableTeam || !player) ? "high" : "medium",
    confirmed: isConfirmed(status),
    unresolved: !isConfirmed(status),
    contextImpact,
    identityMethod,
    headline: clean(item?.headline),
    link: clean(item?.link),
  };
}

async function collectFootballNewsForGames({
  league, records = [], availability = [], snapshots = [],
  sourceLoader = null,
} = {}) {
  const leagueKey = String(league || "").toLowerCase();
  if (leagueKey !== "nfl" && leagueKey !== "cfb") throw new Error("football news context supports nfl/cfb only");
  const load = sourceLoader || require("../routes/news").getFootballContextNews;
  const loaded = await load(leagueKey);
  const capturedAt = loaded?.capturedAt || new Date().toISOString();
  const games = gameRecords(records, capturedAt);
  const players = playerRecords({ league: leagueKey, availability, snapshots });
  const indexes = buildIndexes(games, players);
  const byEvent = {};
  let ambiguousOrIrrelevant = 0;
  for (const item of loaded?.items || []) {
    const resolved = resolveNewsItem({ item, league: leagueKey, indexes, capturedAt });
    if (!resolved) { ambiguousOrIrrelevant++; continue; }
    const rows = byEvent[resolved.eventId] || [];
    if (!rows.some((row) => row.source === resolved.source && row.newsId === resolved.newsId)) rows.push(resolved);
    byEvent[resolved.eventId] = rows;
  }
  for (const rows of Object.values(byEvent)) rows.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  return {
    capturedAt,
    byEvent,
    meta: {
      available: Object.values(loaded?.sources || {}).some((source) => source?.available === true),
      sources: loaded?.sources || {},
      received: (loaded?.items || []).length,
      resolved: Object.values(byEvent).reduce((sum, rows) => sum + rows.length, 0),
      ambiguousOrIrrelevant,
      identityPolicy: "durable-provider-id-first; exact-name-only-and-collision-guarded fallback",
    },
  };
}

module.exports = {
  CATEGORIES,
  collectFootballNewsForGames,
  _internal: {
    clean, exactName, one, oneTeam, gameRecords, playerRecords, buildIndexes,
    identityCategories, categoryIds, categoryDescriptions, intersectGameSets,
    positionUnit, categoryFor, statusFor, isConfirmed, impactFor, resolveNewsItem,
  },
};
