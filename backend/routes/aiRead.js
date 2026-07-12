// aiRead.js :: WZ-AI-READ-2026-07-12
// The B read — the AI polish layer on top of the deterministic A read.
//
// It takes the pick's ALREADY-COMPUTED facts (the same signals on the card, plus the A read) and
// returns a natural 2-3 sentence scouting note. It is deliberately GROUNDED: the model is handed
// only these facts and told never to invent a number, so it cannot fabricate — it just phrases
// what the model already found.
//
// FULLY ISOLATED + FAIL-SAFE (this can never hurt the board):
//   - If ANTHROPIC_API_KEY is not set  -> { read: null }  (frontend keeps the A read)
//   - If the API errors / times out     -> { read: null }
//   - Nothing here is called by the board build; it's an on-demand endpoint hit when a card opens.
// CACHED in-memory by pick signature so each pick is generated at most once (cost control), and
// only picks a user actually opens ever generate a read.

const express = require("express");
const router = express.Router();
const axios = require("axios");

// One-line tunable. claude-sonnet-5 = richer prose (matches the mock); swap to
// "claude-haiku-4-5-20251001" to cut cost if volume grows.
const AI_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 320;
const TIMEOUT_MS = 9000;
const TTL_MS = 6 * 60 * 60 * 1000; // 6h
const CACHE = new Map();           // sig -> { read, at }

const SYSTEM = `You are a sharp professional MLB betting handicapper writing the one scouting "read" shown under a single pick on a premium analytics board. You are given the model's actual computed signals for one game.

Rules:
- Use ONLY the facts and numbers provided. Never invent a statistic, player name, injury, park, or figure that is not in the input.
- Cite the real drivers by name and connect them into a clear thesis for why this side is the play.
- Confident, professional voice, like a sharp defending a bet to other sharps. No hype words ("lock", "smash", "hammer"), no emojis, no clichés.
- Length matches substance: rich signals get 2-3 tight sentences; thin signals get ONE honest sentence. Never pad thin data with filler.
- If a signal cuts against the pick (e.g. money moving off our side), acknowledge it honestly rather than only cheerleading.
- Output only the read text. No preamble, no labels, no quotation marks.`;

function factLines(b) {
  const L = [];
  if (b.pick) L.push(`Pick: ${b.pick}${b.market ? " (" + b.market + ")" : ""}${b.odds ? " at " + b.odds : ""}`);
  if (b.matchup) L.push(`Matchup: ${b.matchup}`);
  if (b.model != null && b.market_pct != null) {
    L.push(`Model win ${b.model}% vs market ${b.market_pct}%${b.edge != null ? ", edge " + (b.edge >= 0 ? "+" : "") + b.edge + "%" : ""}`);
  }
  if (Array.isArray(b.lineMove) && b.lineMove.length >= 2) {
    const dir = b.moneyDir === 1 ? " (money moving toward our side)" : b.moneyDir === -1 ? " (money moving off our side)" : "";
    L.push(`Line move: ${b.lineMove[0]} to ${b.lineMove[1]}${dir}`);
  }
  if (Array.isArray(b.park) && b.park.length) L.push(`Park: ${b.park.join(", ")}`);
  if (b.weather) L.push(`Weather: ${b.weather}`);
  if (b.conviction) L.push(`Conviction: ${String(b.conviction).toUpperCase()}`);
  if (b.booksLean) {
    const bl = b.booksLean;
    const seg = (k, v) => (Array.isArray(v) ? `${k}: books ${v[0] || ""} on ${v[1] || ""} ${v[2] || ""}${v[3] ? " (agrees with us)" : " (differs from us)"}` : null);
    const parts = [seg("Win", bl.win), seg("Cover", bl.cover), seg("Total", bl.total)].filter(Boolean);
    if (parts.length) L.push(`Books lean: ${parts.join("; ")}`);
  }
  if (b.baseRead) L.push(`Model's plain read: ${b.baseRead}`);
  return L.join("\n");
}

router.post("/", async (req, res) => {
  try {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return res.json({ read: null, reason: "no-key" });

    const b = req.body || {};
    const sig = String(b.sig || (b.matchup || "") + "|" + (b.pick || "") + "|" + (b.baseRead || ""));
    const now = Date.now();
    const hit = CACHE.get(sig);
    if (hit && now - hit.at < TTL_MS) return res.json({ read: hit.read, cached: true });

    const facts = factLines(b);
    if (!facts) return res.json({ read: null, reason: "no-facts" });

    const r = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: AI_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        messages: [{ role: "user", content: "PICK CONTEXT (the model's computed signals):\n" + facts + "\n\nWrite the read." }],
      },
      { headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, timeout: TIMEOUT_MS }
    );

    const content = r.data && Array.isArray(r.data.content) ? r.data.content : [];
    const text = content.filter((x) => x && x.type === "text").map((x) => x.text).join("").trim();
    if (!text) return res.json({ read: null, reason: "empty" });

    CACHE.set(sig, { read: text, at: now });
    return res.json({ read: text });
  } catch (e) {
    return res.json({ read: null, reason: String((e && (e.response && e.response.status)) || (e && e.message) || e) });
  }
});

module.exports = router;
