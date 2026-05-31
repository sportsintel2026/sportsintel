import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/api";

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

export default function AdminPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("daily"); // "daily" | "expert"

  useEffect(() => {
    if (user && user.email !== ADMIN_EMAIL) {
      navigate("/dashboard");
    }
  }, [user, navigate]);

  return (
    <div style={{ minHeight: "100vh", background: "#080810", color: "#e2e8f0", fontFamily: "'Inter',system-ui,sans-serif", padding: 24 }}>
      <style>{`*{box-sizing:border-box} input,textarea,select{background:#0a0a14;border:1px solid #1a1a2e;color:#e2e8f0;border-radius:8px;padding:10px 12px;font-family:inherit;font-size:13px;width:100%;outline:none} input:focus,textarea:focus,select:focus{border-color:#ef4444}`}</style>

      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 11, color: "#475569", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>Admin Panel</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>Picks Manager</div>
          </div>
          <a href="/dashboard" style={{ color: "#475569", textDecoration: "none", fontSize: 13 }}>← Dashboard</a>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          <button onClick={() => setTab("daily")} style={tabBtn(tab === "daily")}>📊 Daily picks (dashboard)</button>
          <button onClick={() => setTab("expert")} style={tabBtn(tab === "expert")}>🎯 Expert picks</button>
        </div>

        {tab === "daily" ? <DailyPicksManager /> : <ExpertPicksManager />}
      </div>
    </div>
  );
}

function tabBtn(active) {
  return {
    flex: 1,
    background: active ? "#ef4444" : "#0a0a14",
    color: active ? "#fff" : "#94a3b8",
    border: `1px solid ${active ? "#ef4444" : "#1a1a2e"}`,
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

// ============================================================================
// DAILY PICKS MANAGER — unchanged behavior; writes to daily_picks (dashboard).
// ============================================================================
function DailyPicksManager() {
  const [picks, setPicks] = useState([
    { league: "MLB", game: "", pick: "", odds: "", confidence: "HIGH", analysis: "" },
    { league: "NBA", game: "", pick: "", odds: "", confidence: "HIGH", analysis: "" },
    { league: "NFL", game: "", pick: "", odds: "", confidence: "MEDIUM", analysis: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadPicks(); }, []);

  const loadPicks = async () => {
    try {
      const { data } = await supabase
        .from("daily_picks")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (data?.picks) setPicks(JSON.parse(data.picks));
    } catch (e) {}
    setLoading(false);
  };

  const savePicks = async () => {
    setSaving(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      await supabase.from("daily_picks").upsert({
        date: today,
        picks: JSON.stringify(picks),
        updated_at: new Date().toISOString(),
      }, { onConflict: "date" });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      alert("Error saving picks: " + e.message);
    }
    setSaving(false);
  };

  const updatePick = (i, field, value) => {
    const updated = [...picks];
    updated[i] = { ...updated[i], [field]: value };
    setPicks(updated);
  };
  const addPick = () => setPicks([...picks, { league: "MLB", game: "", pick: "", odds: "", confidence: "HIGH", analysis: "" }]);
  const removePick = (i) => setPicks(picks.filter((_, j) => j !== i));

  if (loading) return <div style={{ color: "#475569", fontSize: 13, padding: 20 }}>Loading...</div>;

  return (
    <div>
      <div style={{ background: "#22c55e15", border: "1px solid #22c55e30", borderRadius: 12, padding: "12px 16px", marginBottom: 24, fontSize: 13, color: "#22c55e" }}>
        ✓ These show in the "Today's Best Bets" box on your dashboard
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }}>
        {picks.map((p, i) => (
          <div key={i} style={{ background: "#0a0a14", border: "1px solid #1a1a2e", borderRadius: 14, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Pick #{i + 1}</div>
              <button onClick={() => removePick(i)} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 18, fontFamily: "inherit" }}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <Label>League</Label>
                <select value={p.league} onChange={e => updatePick(i, "league", e.target.value)}>
                  <option>MLB</option><option>NBA</option><option>NFL</option><option>NHL</option>
                  <option>Soccer</option><option>MMA</option><option>Golf</option>
                </select>
              </div>
              <div>
                <Label>Confidence</Label>
                <select value={p.confidence} onChange={e => updatePick(i, "confidence", e.target.value)}>
                  <option>HIGH</option><option>MEDIUM</option><option>LOW</option>
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div>
                <Label>Game (e.g. Yankees vs Red Sox)</Label>
                <input value={p.game} onChange={e => updatePick(i, "game", e.target.value)} placeholder="Team A vs Team B" />
              </div>
              <div>
                <Label>Pick (e.g. Yankees -1.5)</Label>
                <input value={p.pick} onChange={e => updatePick(i, "pick", e.target.value)} placeholder="Yankees -1.5" />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <Label>Odds (e.g. -110)</Label>
              <input value={p.odds} onChange={e => updatePick(i, "odds", e.target.value)} placeholder="-110" />
            </div>
            <div>
              <Label>Analysis (why this pick?)</Label>
              <textarea value={p.analysis} onChange={e => updatePick(i, "analysis", e.target.value)} placeholder="Explain why you like this pick..." rows={3} style={{ resize: "vertical" }} />
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 32 }}>
        <button onClick={addPick} style={ghostBtn}>+ Add Pick</button>
        <button onClick={savePicks} disabled={saving}
          style={{ background: saved ? "#22c55e" : "#ef4444", color: "#fff", border: "none", borderRadius: 10, padding: "10px 32px", fontSize: 14, fontWeight: 700, cursor: saving ? "wait" : "pointer", fontFamily: "inherit", flex: 1 }}>
          {saving ? "Saving..." : (saved ? "✓ Saved!" : "Save & Publish Picks")}
        </button>
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
  const addStraight = () => setItems([...items, { type: "straight", sport: "mlb", pick: "", game: "", odds: "", confidence: "HIGH", analysis: "", result: "" }]);
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
      </div>
    </div>
  );
}

function StraightEditor({ item, index, update, remove }) {
  return (
    <div style={{ background: "#0a0a14", border: "1px solid #1a1a2e", borderRadius: 14, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Straight bet</div>
        <button onClick={() => remove(index)} style={xBtn}>×</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
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
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.7fr", gap: 12 }}>
        <div>
          <Label>Pick (e.g. Dodgers ML)</Label>
          <input value={item.pick} onChange={e => update(index, { pick: e.target.value })} placeholder="Dodgers ML" />
        </div>
        <div>
          <Label>Game / matchup</Label>
          <input value={item.game} onChange={e => update(index, { game: e.target.value })} placeholder="LAD @ SF" />
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
          <div key={li} style={{ background: "#080810", border: "1px solid #1a1a2e", borderRadius: 10, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#ef444415", border: "1px solid #ef444440", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#ef4444" }}>{li + 1}</div>
              <div style={{ width: 130 }}>
                <select value={leg.sport} onChange={e => updateLeg(index, li, { sport: e.target.value })} style={{ padding: "7px 10px" }}>
                  {SPORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }} />
              {item.legs.length > 1 && (
                <button onClick={() => removeLeg(index, li)} style={xBtn}>×</button>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1.1fr 0.7fr", gap: 8 }}>
              <input value={leg.pick} onChange={e => updateLeg(index, li, { pick: e.target.value })} placeholder="Dodgers ML" />
              <input value={leg.game} onChange={e => updateLeg(index, li, { game: e.target.value })} placeholder="LAD @ SF" />
              <input value={leg.odds} onChange={e => updateLeg(index, li, { odds: e.target.value })} placeholder="-135" />
            </div>
          </div>
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
  };
}
