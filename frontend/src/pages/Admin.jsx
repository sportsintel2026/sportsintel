import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { supabase, scoresApi } from "../lib/api";

const ADMIN_EMAIL = "r7002g@gmail.com";

// Sports offered when tagging an expert pick / parlay leg.
const SPORTS = [
  { id: "mlb",    label: "⚾ MLB" },
  { id: "nba",    label: "🏀 NBA" },
  { id: "nfl",    label: "🏈 NFL" },
  { id: "nhl",    label: "🏒 NHL" },
  { id: "ncaafb", label: "🏟️ CFB" },
  { id: "ncaamb", label: "🎓 CBB" },
];

// ── American odds helpers (match the Expert Picks page) ─────────────────────
function americanToDecimal(odds) {
  const n = Number(odds);
  if (!n || Number.isNaN(n)) return null;
  return n > 0 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
}
function decimalToAmerican(dec) {
  if (!dec || dec <= 1) return null;
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
}
function combinedAmerican(legs) {
  if (!legs || legs.length === 0) return null;
  let d = 1;
  for (const leg of legs) {
    const dec = americanToDecimal(leg.odds);
    if (dec == null) return null; // a leg is missing/blank odds
    d *= dec;
  }
  return decimalToAmerican(d);
}
function fmtOdds(v) {
  const n = Number(v);
  if (v === "" || v == null || Number.isNaN(n)) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

// ── Team/game picker ────────────────────────────────────────────────────────
// Schedules come from the scores feed, which currently covers MLB and NBA.
// Other sports fall back to typing the matchup in. Cached per league so we don't
// refetch for every leg.
const SCHEDULE_LEAGUES = new Set(["mlb", "nba"]);
const scheduleCache = {}; // league -> [{ value, label, id, away, home }]

function useSchedule(league) {
  const [games, setGames] = useState(scheduleCache[league] || null);
  useEffect(() => {
    let cancelled = false;
    if (!SCHEDULE_LEAGUES.has(league)) { setGames([]); return; }
    if (scheduleCache[league]) { setGames(scheduleCache[league]); return; }
    (async () => {
      try {
        const d = await scoresApi.getScores(league);
        const all = [...(d.live || []), ...(d.upcoming || []), ...(d.final || [])];
        const opts = all
          .filter((g) => g.away && g.home && g.away.abbrev && g.home.abbrev)
          .map((g) => {
            const away = g.away.abbrev, home = g.home.abbrev;
            const matchup = `${away} @ ${home}`;
            return {
              value: matchup,
              label: g.statusDetail ? `${matchup} · ${g.statusDetail}` : matchup,
              id: g.id != null ? String(g.id) : "",
              away,
              home,
            };
          });
        scheduleCache[league] = opts;
        if (!cancelled) setGames(opts);
      } catch (_) {
        if (!cancelled) setGames([]);
      }
    })();
    return () => { cancelled = true; };
  }, [league]);
  return games; // null = loading, [] = none, [...] = options
}

// Dropdown that quick-fills the matchup field from the day's scheduled games.
// Always visible for MLB/NBA (with Loading / No-games states) so it can't
// silently disappear; hidden only for sports that have no schedule feed.
// onPick(value) → matchup string (existing behaviour, unchanged).
// onGame(option) → optional: full game option { value, label, id, away, home }
//   so callers that need it (straight bets, for auto-grading) can capture the
//   game id + abbreviations. Callers that don't pass onGame are unaffected.
function GamePicker({ league, onPick, onGame }) {
  const sched = useSchedule(league);
  if (!SCHEDULE_LEAGUES.has(league)) return null; // no feed for this sport → type-in only
  const ready = Array.isArray(sched) && sched.length > 0;
  const placeholder =
    sched === null ? "Loading today's games…"
    : (Array.isArray(sched) && sched.length === 0) ? "No games to load — type below"
    : "⚡ Load today's game…";
  return (
    <select
      value=""
      disabled={!ready}
      onChange={(e) => {
        if (!e.target.value) return;
        onPick(e.target.value);
        if (onGame) {
          const opt = (Array.isArray(sched) ? sched : []).find((o) => o.value === e.target.value);
          if (opt) onGame(opt);
        }
      }}
      style={{ marginBottom: 8, opacity: ready ? 1 : 0.7 }}
    >
      <option value="">{placeholder}</option>
      {ready && sched.map((o, i) => <option key={i} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export default function AdminPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && user.email !== ADMIN_EMAIL) {
      navigate("/dashboard");
    }
  }, [user, navigate]);

  return (
    <div className="admin-wrap" style={{ minHeight: "100vh", background: "#080810", color: "#e2e8f0", fontFamily: "'Inter',system-ui,sans-serif", padding: 24 }}>
      <style>{`
        *{box-sizing:border-box}
        input,textarea,select{background:#0a0a14;border:1px solid #1a1a2e;color:#e2e8f0;border-radius:8px;padding:10px 12px;font-family:inherit;font-size:13px;width:100%;outline:none}
        input:focus,textarea:focus,select:focus{border-color:#ef4444}
        @media (max-width: 600px){
          .admin-wrap{padding:14px!important}
          .admin-3col{grid-template-columns:1fr!important}
        }
      `}</style>

      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 11, color: "#475569", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>Admin Panel</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>Expert Picks Manager</div>
          </div>
          <a href="/dashboard" style={{ color: "#475569", textDecoration: "none", fontSize: 13 }}>← Dashboard</a>
        </div>

        <ExpertPicksManager />
      </div>
    </div>
  );
}


// ============================================================================
// EXPERT PICKS MANAGER — writes to expert_picks (the Expert picks page).
// Supports straight bets and parlays (any number of legs), each tagged by sport.
// ============================================================================
function ExpertPicksManager() {
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  // Use Eastern date so it matches what the Expert picks page reads.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from("expert_picks").select("*").eq("date", today).maybeSingle();
        if (data?.picks) {
          const parsed = JSON.parse(data.picks);
          // normalize into editable form (result null -> "")
          setItems(parsed.map(normalizeForEdit));
        }
      } catch (e) {}
      setLoading(false);
    })();
  }, [today]);

  const save = async () => {
    setSaving(true);
    try {
      const cleaned = items.map(serializeForSave);
      const { error } = await supabase.from("expert_picks").upsert({
        date: today,
        picks: JSON.stringify(cleaned),
      }, { onConflict: "date" });
      if (error) throw error;
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      alert("Error saving expert picks: " + e.message);
    }
    setSaving(false);
  };

  const update = (i, patch) => {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    setItems(next);
  };
  const remove = (i) => setItems(items.filter((_, j) => j !== i));
  const addStraight = () => setItems([...items, { type: "straight", sport: "mlb", pick: "", game: "", odds: "", confidence: "HIGH", analysis: "", result: "", market: "moneyline", selection: "", line: "", gameId: "", awayAbbr: "", homeAbbr: "", pickEdited: false, gameEdited: false }]);
  const addParlay = () => setItems([...items, { type: "parlay", confidence: "HIGH", analysis: "", result: "", legs: [emptyLeg("mlb"), emptyLeg("nba")] }]);

  // leg helpers
  const updateLeg = (i, li, patch) => {
    const next = [...items];
    const legs = [...next[i].legs];
    legs[li] = { ...legs[li], ...patch };
    next[i] = { ...next[i], legs };
    setItems(next);
  };
  const addLeg = (i) => {
    const next = [...items];
    next[i] = { ...next[i], legs: [...next[i].legs, emptyLeg("mlb")] };
    setItems(next);
  };
  const removeLeg = (i, li) => {
    const next = [...items];
    next[i] = { ...next[i], legs: next[i].legs.filter((_, j) => j !== li) };
    setItems(next);
  };

  if (loading) return <div style={{ color: "#475569", fontSize: 13, padding: 20 }}>Loading...</div>;

  return (
    <div>
      <div style={{ background: "#ef444415", border: "1px solid #ef444430", borderRadius: 12, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#f87171" }}>
        🎯 These show on the <strong>Expert picks</strong> page · editing today ({today})
      </div>

      {items.length === 0 && (
        <div style={{ background: "#0a0a14", border: "1px dashed #1a1a2e", borderRadius: 14, padding: 28, textAlign: "center", color: "#475569", fontSize: 13, marginBottom: 16 }}>
          No expert picks for today yet. Add a straight bet or a parlay below.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 20 }}>
        {items.map((it, i) =>
          it.type === "parlay"
            ? <ParlayEditor key={i} item={it} index={i} update={update} remove={remove} updateLeg={updateLeg} addLeg={addLeg} removeLeg={removeLeg} />
            : <StraightEditor key={i} item={it} index={i} update={update} remove={remove} />
        )}
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <button onClick={addStraight} style={ghostBtn}>+ Add straight bet</button>
        <button onClick={addParlay} style={ghostBtn}>+ Add parlay</button>
      </div>

      <button onClick={save} disabled={saving}
        style={{ width: "100%", background: saved ? "#22c55e" : "#ef4444", color: "#fff", border: "none", borderRadius: 10, padding: "12px 32px", fontSize: 14, fontWeight: 700, cursor: saving ? "wait" : "pointer", fontFamily: "inherit", marginBottom: 28 }}>
        {saving ? "Saving..." : (saved ? "✓ Saved!" : "Save & Publish Expert Picks")}
      </button>

      <div style={{ background: "#0a0a14", border: "1px solid #1a1a2e", borderRadius: 12, padding: 16, fontSize: 12, color: "#475569", lineHeight: 1.6 }}>
        <strong style={{ color: "#e2e8f0" }}>Grading:</strong> after a game finishes, set each pick's <strong style={{ color: "#e2e8f0" }}>Result</strong> to Won / Lost / Push and Save.
        Your record and units on the Expert picks page update automatically — only graded picks count, so nothing is ever inflated.
        <br /><br />
        <strong style={{ color: "#1D9E75" }}>Auto-grade (MLB/NBA):</strong> on a straight bet, link a game from the dropdown and choose the bet type + side. Picks linked this way are set up to grade themselves automatically once that feature is switched on. Leaving them blank still works — you just grade those by hand. (Parlays are always graded by hand.)
      </div>
    </div>
  );
}

function StraightEditor({ item, index, update, remove }) {
  const market = item.market || "moneyline";
  const selectionOptions = market === "total"
    ? [{ v: "over", label: "Over" }, { v: "under", label: "Under" }]
    : [
        { v: "away", label: item.awayAbbr ? `${item.awayAbbr} (away)` : "Away team" },
        { v: "home", label: item.homeAbbr ? `${item.homeAbbr} (home)` : "Home team" },
      ];
  const linked = !!item.gameId && !!item.selection;

  // Build the human-readable pick label from the structured fields.
  const deriveLabel = (it) => {
    const m = it.market || "moneyline";
    if (m === "total") {
      const s = it.selection === "over" ? "Over" : it.selection === "under" ? "Under" : "";
      if (!s) return "";
      return it.line ? `${s} ${it.line}` : s;
    }
    const abbr = it.selection === "away" ? it.awayAbbr : it.selection === "home" ? it.homeAbbr : "";
    return abbr ? `${abbr} ML` : "";
  };

  // Apply a structured-field change, and auto-fill the Pick label / Game text
  // from it — UNLESS the owner has already typed over those fields by hand.
  const setStructured = (patch, matchup) => {
    const merged = { ...item, ...patch };
    const out = { ...patch };
    if (!item.pickEdited) {
      const lbl = deriveLabel(merged);
      if (lbl) out.pick = lbl;
    }
    if (matchup != null && !item.gameEdited) out.game = matchup;
    update(index, out);
  };

  return (
    <div style={{ background: "#0a0a14", border: "1px solid #1a1a2e", borderRadius: 14, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Straight bet</div>
        <button onClick={() => remove(index)} style={xBtn}>×</button>
      </div>
      <div className="admin-3col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <Label>Sport</Label>
          <select value={item.sport} onChange={e => update(index, { sport: e.target.value })}>
            {SPORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <Label>Confidence</Label>
          <select value={item.confidence} onChange={e => update(index, { confidence: e.target.value })}>
            <option>HIGH</option><option>MEDIUM</option><option>LOW</option>
          </select>
        </div>
        <div>
          <Label>Result</Label>
          <select value={item.result || ""} onChange={e => update(index, { result: e.target.value })}>
            <option value="">Pending</option>
            <option value="win">Won</option>
            <option value="loss">Lost</option>
            <option value="push">Push</option>
          </select>
        </div>
      </div>

      {/* Auto-grade link (MLB/NBA). Optional & additive — leave blank to grade by hand. */}
      <div style={{ borderLeft: "3px solid #1D9E75", borderRadius: 0, background: "#080810", padding: "14px 16px", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", background: "#0F6E5633", color: "#1D9E75", border: "1px solid #1D9E7555", borderRadius: 4, padding: "2px 8px" }}>AUTO-GRADE</span>
          <span style={{ fontSize: 11, color: linked ? "#1D9E75" : "#64748b" }}>
            {linked ? "✓ Linked — set up to grade itself (MLB/NBA)" : "Link a game + pick a side to set up auto-grading (MLB/NBA). Optional."}
          </span>
        </div>
        <div className="admin-3col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 0.8fr", gap: 12, marginBottom: 10 }}>
          <div>
            <Label>Bet type</Label>
            <select value={market} onChange={e => setStructured({ market: e.target.value, selection: "" })}>
              <option value="moneyline">Moneyline</option>
              <option value="total">Total (O/U)</option>
            </select>
          </div>
          <div>
            <Label>Side</Label>
            <select value={item.selection || ""} onChange={e => setStructured({ selection: e.target.value })}>
              <option value="">— pick side —</option>
              {selectionOptions.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <Label>Line</Label>
            <input
              value={item.line ?? ""}
              onChange={e => setStructured({ line: e.target.value })}
              placeholder={market === "total" ? "8.5" : "—"}
              disabled={market !== "total"}
              style={{ opacity: market === "total" ? 1 : 0.5 }}
            />
          </div>
        </div>
        <Label>Link game (loads today's MLB/NBA games)</Label>
        <GamePicker
          league={item.sport}
          onPick={() => {}}
          onGame={(opt) => setStructured({ gameId: opt.id, awayAbbr: opt.away, homeAbbr: opt.home, selection: "" }, opt.value)}
        />
        {item.gameId ? (
          <div style={{ fontSize: 10, color: "#475569" }}>Linked: {item.awayAbbr} @ {item.homeAbbr} (id {item.gameId})</div>
        ) : null}
      </div>

      <div className="admin-3col" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.7fr", gap: 12 }}>
        <div>
          <Label>Pick label (auto-fills · editable)</Label>
          <input value={item.pick} onChange={e => update(index, { pick: e.target.value, pickEdited: true })} placeholder="Dodgers ML" />
        </div>
        <div>
          <Label>Game / matchup (auto-fills · editable)</Label>
          <input value={item.game} onChange={e => update(index, { game: e.target.value, gameEdited: true })} placeholder="LAD @ SF" />
        </div>
        <div>
          <Label>Odds</Label>
          <input value={item.odds} onChange={e => update(index, { odds: e.target.value })} placeholder="-135" />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <Label>Analysis (optional)</Label>
        <textarea value={item.analysis} onChange={e => update(index, { analysis: e.target.value })} placeholder="Why you like it..." rows={2} style={{ resize: "vertical" }} />
      </div>
    </div>
  );
}

function ParlayEditor({ item, index, update, remove, updateLeg, addLeg, removeLeg }) {
  const combined = combinedAmerican(item.legs);
  return (
    <div style={{ background: "#0a0a14", border: "1px solid #ef444433", borderLeft: "3px solid #ef4444", borderRadius: 14, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Parlay · {item.legs.length} legs</div>
        <button onClick={() => remove(index)} style={xBtn}>×</button>
      </div>

      <Label>Legs</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        {item.legs.map((leg, li) => (
          <LegEditor key={li} leg={leg} index={index} li={li} updateLeg={updateLeg} removeLeg={removeLeg} canRemove={item.legs.length > 1} />
        ))}
      </div>

      <button onClick={() => addLeg(index)} style={{ ...ghostBtn, width: "100%", borderStyle: "dashed", marginBottom: 14 }}>+ Add another leg</button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#080810", border: "1px solid #1a1a2e", borderRadius: 8, padding: "10px 14px", marginBottom: 14 }}>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>Combined odds (auto)</span>
        <span style={{ fontSize: 18, fontWeight: 800, color: combined != null ? "#22c55e" : "#475569" }}>{fmtOdds(combined)}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <Label>Confidence</Label>
          <select value={item.confidence} onChange={e => update(index, { confidence: e.target.value })}>
            <option>HIGH</option><option>MEDIUM</option><option>LOW</option>
          </select>
        </div>
        <div>
          <Label>Result</Label>
          <select value={item.result || ""} onChange={e => update(index, { result: e.target.value })}>
            <option value="">Pending</option>
            <option value="win">Won</option>
            <option value="loss">Lost</option>
            <option value="push">Push</option>
          </select>
        </div>
      </div>
      <div>
        <Label>Analysis (optional)</Label>
        <textarea value={item.analysis} onChange={e => update(index, { analysis: e.target.value })} placeholder="Why you like this parlay..." rows={2} style={{ resize: "vertical" }} />
      </div>
    </div>
  );
}

function LegEditor({ leg, index, li, updateLeg, removeLeg, canRemove }) {
  return (
    <div style={{ background: "#080810", border: "1px solid #1a1a2e", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#ef444415", border: "1px solid #ef444440", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#ef4444" }}>{li + 1}</div>
        <div style={{ width: 130 }}>
          <select value={leg.sport} onChange={e => updateLeg(index, li, { sport: e.target.value })} style={{ padding: "7px 10px" }}>
            {SPORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }} />
        {canRemove && <button onClick={() => removeLeg(index, li)} style={xBtn}>×</button>}
      </div>
      <GamePicker league={leg.sport} onPick={(v) => updateLeg(index, li, { game: v })} />
      <div className="admin-3col" style={{ display: "grid", gridTemplateColumns: "1.6fr 1.1fr 0.7fr", gap: 8 }}>
        <input value={leg.pick} onChange={e => updateLeg(index, li, { pick: e.target.value })} placeholder="Dodgers ML" />
        <input value={leg.game} onChange={e => updateLeg(index, li, { game: e.target.value })} placeholder="LAD @ SF" />
        <input value={leg.odds} onChange={e => updateLeg(index, li, { odds: e.target.value })} placeholder="-135" />
      </div>
    </div>
  );
}

function Label({ children }) {
  return <div style={{ fontSize: 11, color: "#475569", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>{children}</div>;
}

const ghostBtn = { background: "#0a0a14", border: "1px solid #1a1a2e", color: "#94a3b8", borderRadius: 10, padding: "10px 20px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" };
const xBtn = { background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 18, fontFamily: "inherit" };

function emptyLeg(sport) { return { sport, pick: "", game: "", odds: "" }; }

// Convert a stored pick into editable shape (numbers -> strings, null result -> "").
function normalizeForEdit(p) {
  if (p.type === "parlay") {
    return {
      type: "parlay",
      confidence: p.confidence || "HIGH",
      analysis: p.analysis || "",
      result: p.result || "",
      legs: (p.legs || []).map(l => ({ sport: l.sport || "mlb", pick: l.pick || "", game: l.game || "", odds: l.odds != null ? String(l.odds) : "" })),
    };
  }
  return {
    type: "straight",
    sport: p.sport || "mlb",
    pick: p.pick || "",
    game: p.game || "",
    odds: p.odds != null ? String(p.odds) : "",
    confidence: p.confidence || "HIGH",
    analysis: p.analysis || "",
    result: p.result || "",
    market: p.market || "moneyline",
    selection: p.selection || "",
    line: p.line != null ? String(p.line) : "",
    gameId: p.gameId != null ? String(p.gameId) : "",
    awayAbbr: p.awayAbbr || "",
    homeAbbr: p.homeAbbr || "",
    pickEdited: true,
    gameEdited: true,
  };
}

// Convert editable shape into the stored format (odds -> numbers, "" result -> null,
// parlay combinedOdds computed and stored).
function serializeForSave(p) {
  if (p.type === "parlay") {
    const legs = p.legs.map(l => ({ sport: l.sport, pick: l.pick, game: l.game, odds: l.odds === "" ? null : Number(l.odds) }));
    return {
      type: "parlay",
      confidence: p.confidence,
      analysis: p.analysis,
      result: p.result || null,
      combinedOdds: combinedAmerican(p.legs),
      legs,
    };
  }
  return {
    type: "straight",
    sport: p.sport,
    pick: p.pick,
    game: p.game,
    odds: p.odds === "" ? null : Number(p.odds),
    confidence: p.confidence,
    analysis: p.analysis,
    result: p.result || null,
    market: p.market || "moneyline",
    selection: p.selection || null,
    line: (p.line === "" || p.line == null) ? null : Number(p.line),
    gameId: p.gameId || null,
    awayAbbr: p.awayAbbr || null,
    homeAbbr: p.homeAbbr || null,
  };
}
