import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

// Get auth token from Supabase session
async function getToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token;
}

// Base API fetch with auth header
async function apiFetch(path, options = {}) {
  const token = await getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }

  return res.json();
}

// ── Games ──────────────────────────────────────────────────────────────────────
export const gamesApi = {
  getToday: (league) => apiFetch(`/api/games/${league}/today`),
  getBoxScore: (league, gameId) => apiFetch(`/api/games/${league}/${gameId}/boxscore`),
  getH2H: (league, gameId, homeTeamId, awayTeamId) =>
    apiFetch(`/api/games/${league}/${gameId}/h2h?homeTeamId=${homeTeamId}&awayTeamId=${awayTeamId}`),
};

// ── Subscriptions ──────────────────────────────────────────────────────────────
export const subscriptionApi = {
  getMyPlan: () => apiFetch("/api/subscriptions/me"),
  checkout: (priceKey) =>
    apiFetch("/api/subscriptions/checkout", {
      method: "POST",
      body: JSON.stringify({ priceKey }),
    }),
  openPortal: () =>
    apiFetch("/api/subscriptions/portal", { method: "POST" }),
};
