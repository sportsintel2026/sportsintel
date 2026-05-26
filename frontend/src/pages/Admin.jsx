import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/api";

const ADMIN_EMAIL = "r7002g@gmail.com";

export default function AdminPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [picks, setPicks] = useState([
    { league:"MLB", game:"", pick:"", odds:"", confidence:"HIGH", analysis:"" },
    { league:"NBA", game:"", pick:"", odds:"", confidence:"HIGH", analysis:"" },
    { league:"NFL", game:"", pick:"", odds:"", confidence:"MEDIUM", analysis:"" },
  ]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && user.email !== ADMIN_EMAIL) {
      navigate("/dashboard");
    }
  }, [user, navigate]);

  useEffect(() => {
    loadPicks();
  }, []);

  const loadPicks = async () => {
    try {
      const { data } = await supabase
        .from("daily_picks")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (data?.picks) setPicks(JSON.parse(data.picks));
    } catch(e) {}
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
    } catch(e) {
      alert("Error saving picks: " + e.message);
    }
    setSaving(false);
  };

  const updatePick = (i, field, value) => {
    const updated = [...picks];
    updated[i] = { ...updated[i], [field]: value };
    setPicks(updated);
  };

  const addPick = () => {
    setPicks([...picks, { league:"MLB", game:"", pick:"", odds:"", confidence:"HIGH", analysis:"" }]);
  };

  const removePick = (i) => {
    setPicks(picks.filter((_, j) => j !== i));
  };

  if (loading) return (
    <div style={{minHeight:"100vh",background:"#080810",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff"}}>
      Loading...
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#080810",color:"#e2e8f0",fontFamily:"'Inter',system-ui,sans-serif",padding:24}}>
      <style>{`*{box-sizing:border-box} input,textarea,select{background:#0a0a14;border:1px solid #1a1a2e;color:#e2e8f0;border-radius:8px;padding:10px 12px;font-family:inherit;font-size:13px;width:100%;outline:none} input:focus,textarea:focus,select:focus{border-color:#ef4444}`}</style>
      
      <div style={{maxWidth:700,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:32}}>
          <div>
            <div style={{fontSize:11,color:"#475569",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.08em"}}>Admin Panel</div>
            <div style={{fontSize:22,fontWeight:800,color:"#fff"}}>Daily Picks Manager</div>
          </div>
          <a href="/dashboard" style={{color:"#475569",textDecoration:"none",fontSize:13}}>← Dashboard</a>
        </div>

        <div style={{background:"#22c55e15",border:"1px solid #22c55e30",borderRadius:12,padding:"12px 16px",marginBottom:24,fontSize:13,color:"#22c55e"}}>
          ✓ Picks update live on your site the moment you save
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:16,marginBottom:24}}>
          {picks.map((p, i) => (
            <div key={i} style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:14,padding:20}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>Pick #{i+1}</div>
                <button onClick={()=>removePick(i)} style={{background:"none",border:"none",color:"#475569",cursor:"pointer",fontSize:18,fontFamily:"inherit"}}>×</button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                <div>
                  <div style={{fontSize:11,color:"#475569",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>League</div>
                  <select value={p.league} onChange={e=>updatePick(i,"league",e.target.value)}>
                    <option>MLB</option>
                    <option>NBA</option>
                    <option>NFL</option>
                    <option>NHL</option>
                    <option>Soccer</option>
                    <option>MMA</option>
                    <option>Golf</option>
                  </select>
                </div>
                <div>
                  <div style={{fontSize:11,color:"#475569",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Confidence</div>
                  <select value={p.confidence} onChange={e=>updatePick(i,"confidence",e.target.value)}>
                    <option>HIGH</option>
                    <option>MEDIUM</option>
                    <option>LOW</option>
                  </select>
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                <div>
                  <div style={{fontSize:11,color:"#475569",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Game (e.g. Yankees vs Red Sox)</div>
                  <input value={p.game} onChange={e=>updatePick(i,"game",e.target.value)} placeholder="Team A vs Team B"/>
                </div>
                <div>
                  <div style={{fontSize:11,color:"#475569",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Pick (e.g. Yankees -1.5)</div>
                  <input value={p.pick} onChange={e=>updatePick(i,"pick",e.target.value)} placeholder="Yankees -1.5"/>
                </div>
              </div>
              <div style={{marginBottom:12}}>
                <div style={{fontSize:11,color:"#475569",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Odds (e.g. -110)</div>
                <input value={p.odds} onChange={e=>updatePick(i,"odds",e.target.value)} placeholder="-110"/>
              </div>
              <div>
                <div style={{fontSize:11,color:"#475569",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Analysis (why this pick?)</div>
                <textarea value={p.analysis} onChange={e=>updatePick(i,"analysis",e.target.value)} placeholder="Explain why you like this pick..." rows={3} style={{resize:"vertical"}}/>
              </div>
            </div>
          ))}
        </div>

        <div style={{display:"flex",gap:12,marginBottom:32}}>
          <button onClick={addPick} style={{background:"#0a0a14",border:"1px solid #1a1a2e",color:"#94a3b8",borderRadius:10,padding:"10px 20px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
            + Add Pick
          </button>
          <button onClick={savePicks} disabled={saving}
            style={{background:saved?"#22c55e":"#ef4444",color:"#fff",border:"none",borderRadius:10,padding:"10px 32px",fontSize:14,fontWeight:700,cursor:saving?"wait":"pointer",fontFamily:"inherit",flex:1}}>
            {saving?"Saving...":(saved?"✓ Saved!":" Save & Publish Picks")}
          </button>
        </div>

        <div style={{background:"#0a0a14",border:"1px solid #1a1a2e",borderRadius:12,padding:16,fontSize:12,color:"#475569"}}>
          <strong style={{color:"#e2e8f0"}}>How to use:</strong> Fill in today's picks above and click Save. Your picks will instantly appear on your website for subscribers. Update them daily for best results!
        </div>
      </div>
    </div>
  );
}
