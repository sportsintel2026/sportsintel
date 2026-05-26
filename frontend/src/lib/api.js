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

export const gamesApi = {
  getToday: (league) => apiFetch(`/api/games/${league}/today`),
  getBoxScore: (league, gameId) => apiFetch(`/api/games/${league}/${gameId}/boxscore`),
};

export const newsApi = {
  getHeadlines: (sport) => apiFetch(`/api/news/headlines/${sport}`),
  getInjuries: (league) => apiFetch(`/api/news/${league}/injuries`),
};

export const subscriptionApi = {
  getMyPlan: () => apiFetch("/api/subscriptions/me"),
  checkout: (priceKey) => apiFetch("/api/subscriptions/checkout", {
    method: "POST",
    body: JSON.stringify({ priceKey }),
  }),
  portal: () => apiFetch("/api/subscriptions/portal", { method: "POST" }),
};
