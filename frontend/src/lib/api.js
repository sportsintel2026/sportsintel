import { createClient } from "@supabase/supabase-js";
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
const API_URL = import.meta.env.VITE_API_URL || "https://sportsintel-production.up.railway.app";
async function apiFetch(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = {
    "Content-Type": "application/json",
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...options.headers,
  };
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
// Existing — keep for now (NBA tab might use, plus boxscore detail later)
export const gamesApi = {
  getToday: (league) => apiFetch(`/api/games/${league}/today`),
  getBoxScore: (league, gameId) => apiFetch(`/api/games/${league}/${gameId}/boxscore`),
};
// Existing news API (still wired if you use it later)
export const newsApi = {
  getHeadlines: (sport) => apiFetch(`/api/news/headlines/${sport}`),
  getInjuries: (league) => apiFetch(`/api/news/${league}/injuries`),
};
// NEW — edges API for MLB analytics dashboard
export const edgesApi = {
  getMLB: () => apiFetch("/api/edges/mlb"),
  getNBA: () => apiFetch("/api/edges/nba"),
  getNFL: () => apiFetch("/api/edges/nfl"),
  getNBAProps: () => apiFetch("/api/edges/nba/props"),
  getOddsHistory: () => apiFetch("/api/edges/odds-history/mlb"),
  getMarketRead: () => apiFetch("/api/edges/market-read/mlb"),
  clearCache: () => apiFetch("/api/edges/cache", { method: "DELETE" }),
};
// NEW — player batting card (expand-on-tap under a prop player), read-only
export const playerCardApi = {
  getMLB: (playerId, opts = {}) => {
    const q = new URLSearchParams();
    if (opts.gameId) q.set("gameId", opts.gameId);
    if (opts.team) q.set("team", opts.team);
    if (opts.name) q.set("name", opts.name);
    const qs = q.toString();
    return apiFetch(`/api/player-card/mlb/${playerId}${qs ? `?${qs}` : ""}`);
  },
};
// NEW — consensus (Best Bets ∩ model edges), read-only
export const consensusApi = {
  getMLB: () => apiFetch("/api/consensus/mlb"),
};
// NEW — multi-book odds comparison (line-shopping page), read-only
export const oddsApi = {
  getMLB: () => apiFetch("/api/odds/mlb"),
};
// Live in-game win probability + moneyline edge
export const liveApi = {
  getMLB: () => apiFetch("/api/live/mlb"),
};
// NEW — live scores (MLB + NBA): lists + per-game detail (innings/quarters + player stats)
export const scoresApi = {
  getScores: (league) => apiFetch(`/api/scores/${league}`),
  getGameDetail: (league, gameId) => apiFetch(`/api/scores/${league}/${gameId}`),
  getStandings: (league) => apiFetch(`/api/scores/${league}/standings`),
};
// NEW — per-game matchups: projected lineups + batter-vs-pitcher (keyed by gamePk)
export const matchupsApi = {
  getMLB: (gameId) => apiFetch(`/api/matchups/mlb/${gameId}`),
};
export const subscriptionApi = {
  getMyPlan: () => apiFetch("/api/subscriptions/me"),
  checkout: (priceKey) => apiFetch("/api/subscriptions/checkout", {
    method: "POST",
    body: JSON.stringify({ priceKey }),
  }),
  portal: () => apiFetch("/api/subscriptions/portal", { method: "POST" }),
};
