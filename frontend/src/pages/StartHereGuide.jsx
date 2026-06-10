import { useState } from "react";

// Collapsible "How to use WizePicks" education panel shown at the top of the
// dashboard. Teaches subscribers to use the site as a research tool (read the
// board, learn CLV, shop/read the price, do their own homework) rather than
// handing them a "play." Hide state persists per-browser via localStorage.
export default function StartHereGuide({ navigate }) {
  const [hidden, setHidden] = useState(() => {
    try {
      const saved = localStorage.getItem("wp_guide_hidden");
      return saved === null ? true : saved === "1"; // collapsed by default until the user opens it
    } catch (e) { return true; }
  });

  const toggle = () => {
    setHidden((h) => {
      const next = !h;
      try { localStorage.setItem("wp_guide_hidden", next ? "1" : "0"); } catch (e) {}
      return next;
    });
  };

  const linkBtn = {
    fontSize: 12, fontWeight: 700, color: "#1D9E75", cursor: "pointer",
    background: "none", border: "none", padding: 0, fontFamily: "inherit",
  };
  const stepNum = {
    flexShrink: 0, width: 26, height: 26, borderRadius: "50%",
    border: "1px solid #1D9E75", color: "#1D9E75", fontSize: 13, fontWeight: 700,
    display: "flex", alignItems: "center", justifyContent: "center",
  };
  const stepTitle = { fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 3 };
  const stepBody = { fontSize: 13, color: "#9ca3af", lineHeight: 1.65 };

  return (
    <div style={{ background: "#0b1f18", border: "1px solid #14352a", borderRadius: 12, padding: "16px 18px", marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "#1D9E75", textTransform: "uppercase", marginBottom: 5 }}>Start here</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: "#e4e7eb" }}>How to use WizePicks</div>
        </div>
        <button onClick={toggle} style={{ background: "transparent", border: "1px solid #1f2937", color: "#9ca3af", fontSize: 12, padding: "6px 12px", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit" }}>
          {hidden ? "Show guide" : "Hide guide"}
        </button>
      </div>

      {!hidden && (
        <>
          <div style={{ fontSize: 13, color: "#9ca3af", lineHeight: 1.6, marginBottom: 16, maxWidth: 560 }}>
            WizePicks is a research tool, not a tipster. Here's how to turn the data into your own edge.
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 13 }}>
              <div style={stepNum}>1</div>
              <div>
                <div style={stepTitle}>Read the Edges board</div>
                <div style={stepBody}>Right below this you'll see today's games — that's the Edges board. Each game lists our model's win probability next to the market's odds. When they agree, the market has it priced. When they don't, that gap is where to look first.</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 13 }}>
              <div style={stepNum}>2</div>
              <div>
                <div style={stepTitle}>Learn the edge — start with CLV</div>
                <div style={stepBody}>Closing line value is the truest sign you're betting well: did you get a better number than where the line closed? Beating the close, over time, is what separates skill from luck.</div>
                <div style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <button onClick={() => navigate("/clv")} style={linkBtn}>→ Beat the Close</button>
                  <button onClick={() => navigate("/guide")} style={linkBtn}>→ How it works (full guide)</button>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 13 }}>
              <div style={stepNum}>3</div>
              <div>
                <div style={stepTitle}>Read the price — shop every book</div>
                <div style={stepBody}>Market Price puts every sportsbook side by side so you can grab the best number on any bet — a real edge, pure math. It also shows where books agree or disagree: the odds themselves tell you a lot about what the market really thinks of a game.</div>
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => navigate("/odds")} style={linkBtn}>→ Open Market Price</button>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 13 }}>
              <div style={stepNum}>4</div>
              <div>
                <div style={stepTitle}>Do your own homework</div>
                <div style={stepBody}>Click into any game to see the full matchup — head-to-head history, recent form, and the breakdowns behind the number. Build your own read: the model informs you, then you decide which side you think has the edge.</div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16, paddingTop: 13, borderTop: "1px solid #14352a", fontSize: 12, color: "#6b7280", lineHeight: 1.6 }}>
            The model informs. You decide. The edge comes from how you use it.
          </div>
        </>
      )}
    </div>
  );
}
