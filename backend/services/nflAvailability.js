// Shared, exact-identity NFL availability extraction.
//
// This module intentionally does not assign point values to an injury. ESPN's
// roster payload identifies the player, team, position and current report, but
// it does not reliably identify the starter, the replacement, or either
// player's on-field value. Those gaps are recorded explicitly for the shadow
// experiment instead of being replaced with position-based guesses.

const POSITION_UNIT = Object.freeze({
  QB: "quarterback",
  RB: "backfield", HB: "backfield", FB: "backfield",
  WR: "receiver", TE: "receiver",
  C: "offensive_line", G: "offensive_line", OG: "offensive_line",
  LG: "offensive_line", RG: "offensive_line",
  T: "offensive_line", OT: "offensive_line", LT: "offensive_line",
  RT: "offensive_line", OL: "offensive_line",
  DE: "defensive_front", DT: "defensive_front", NT: "defensive_front",
  DL: "defensive_front", EDGE: "defensive_front", ED: "defensive_front",
  LB: "linebacker", ILB: "linebacker", OLB: "linebacker",
  CB: "secondary", DB: "secondary", S: "secondary", FS: "secondary", SS: "secondary",
  K: "specialist", PK: "specialist", P: "specialist", LS: "specialist",
  KR: "specialist", PR: "specialist",
});

function clean(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function normalizeStatus(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value || value === "active") return "no-reported-injury";
  if (/injured reserve|\bir\b/.test(value)) return "injured-reserve";
  if (/physically unable|\bpup\b/.test(value)) return "pup";
  if (/suspend|commissioner.*exempt/.test(value)) return "suspended";
  if (/(^|\b)out(\b|$)/.test(value)) return "out";
  if (/doubtful/.test(value)) return "doubtful";
  if (/questionable/.test(value)) return "questionable";
  if (/limited/.test(value)) return "limited";
  if (/probable/.test(value)) return "probable";
  if (/day.?to.?day/.test(value)) return "day-to-day";
  return "other-reported";
}

function injuryRawStatus(athlete) {
  const injury = Array.isArray(athlete?.injuries) ? athlete.injuries[0] : null;
  return clean(injury?.status)
    || clean(injury?.type?.description)
    || clean(injury?.details?.fantasyStatus?.description)
    || null;
}

function extractNflAvailability(athlete, team = {}) {
  const playerId = clean(athlete?.id);
  const position = clean(athlete?.position?.abbreviation)?.toUpperCase() || null;
  const unit = position ? POSITION_UNIT[position] || null : null;
  if (!playerId || !unit) return null;

  const injury = Array.isArray(athlete?.injuries) ? athlete.injuries[0] : null;
  const statusRaw = injuryRawStatus(athlete);
  const status = normalizeStatus(statusRaw);
  const clearlyUnavailable = new Set(["injured-reserve", "pup", "suspended", "out"]);
  const uncertain = new Set(["doubtful", "questionable", "limited", "day-to-day"]);
  const starter = typeof athlete?.starter === "boolean" ? athlete.starter : null;

  return {
    playerId,
    playerName: clean(athlete?.fullName) || clean(athlete?.displayName),
    teamId: clean(team?.id),
    teamName: clean(team?.displayName) || clean(team?.name),
    teamAbbr: clean(team?.abbreviation),
    position,
    unit,
    reportedInjury: !!injury,
    status,
    statusRaw,
    clearlyUnavailable: clearlyUnavailable.has(status),
    uncertain: uncertain.has(status),
    bodyPart: clean(injury?.details?.type),
    bodyLocation: clean(injury?.details?.location),
    injuryDetail: clean(injury?.details?.detail),
    returnDate: clean(injury?.details?.returnDate),
    rosterActive: typeof athlete?.active === "boolean" ? athlete.active : null,
    starter,
    starterStatus: starter == null ? "unavailable" : "reported",
    roleUsage: null,
    importanceStatus: "unavailable",
    replacementPlayerId: null,
    replacementStatus: "unavailable",
    source: "espn-roster-athlete-id",
  };
}

function attachUsageContext(records, projectedPlayers, sourceSeason = null) {
  const byId = new Map((projectedPlayers || []).map((player) => [String(player.id), player]));
  return (records || []).map((record) => {
    const player = byId.get(String(record.playerId));
    const season = player?.season2025 || null;
    if (!season) return { ...record };
    return {
      ...record,
      roleUsage: {
        sourceSeason,
        gamesPlayed: season.gamesPlayed ?? null,
        passAttempts: season.passAtt ?? null,
        carries: season.rushAtt ?? null,
        targets: season.targets ?? null,
        rushingTouchdowns: season.rushTds ?? null,
        receivingTouchdowns: season.recTds ?? null,
      },
      // Usage establishes that the player had a role. It is not a point value,
      // snap share, starter designation, or replacement-quality estimate.
      importanceStatus: "partial-usage-only",
    };
  });
}

module.exports = {
  POSITION_UNIT,
  normalizeStatus,
  extractNflAvailability,
  attachUsageContext,
  _internal: { clean, injuryRawStatus },
};
