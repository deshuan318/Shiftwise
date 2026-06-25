// ShiftWise Kiosk — v2.1 (ticker removed)
import { useState, useEffect, useCallback, useRef, useMemo } from "react";

const SUPABASE_URL      = "https://kyrjgfeowmflazywsuir.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5cmpnZmVvd21mbGF6eXdzdWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NzMzMTQsImV4cCI6MjA5NTA0OTMxNH0.njuDREVF4oIgTYN6wLXKw6Hw_KsFzKPoMabkld_jy0E";

async function kbFetch(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "apikey":        SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type":  "application/json",
      "Prefer":        opts.prefer || "return=representation",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || res.statusText);
  return text ? JSON.parse(text) : null;
}

const DATA_LAYER = {
  async getBusinessData(bizId) {
    if (!bizId) return null;
    const bizRows = await kbFetch(`businesses?select=*&id=eq.${bizId}&limit=1`);
    const business = bizRows?.[0];
    if (!business) return null;
    const [empRows, weekRows] = await Promise.all([
      kbFetch(`employees?select=*&business_id=eq.${business.id}&order=sort_order.asc,created_at.asc`),
      kbFetch(`schedule_weeks?select=*&business_id=eq.${business.id}&order=week_start.asc`),
    ]);
    const wkIds = (weekRows || []).map(w => w.id);
    const shiftRows = wkIds.length ? await kbFetch(`shifts?select=*&week_id=in.(${wkIds.join(",")})`) : [];
    const schedule = {};
    for (const row of (shiftRows || [])) {
      const wk = (weekRows || []).find(w => w.id === row.week_id);
      if (!wk) continue;
      if (!schedule[wk.week_start]) schedule[wk.week_start] = {};
      if (!schedule[wk.week_start][row.employee_id]) schedule[wk.week_start][row.employee_id] = {};
      schedule[wk.week_start][row.employee_id][row.day_index] = {
        start: parseFloat(row.start_dec), end: parseFloat(row.end_dec),
        type: row.shift_types || ["regular"], notes: row.notes || "",
      };
    }
    return {
      businessId: business.id, businessName: business.name || "ShiftWise",
      employees: (empRows || []).map(e => ({ id: e.id, name: e.name, role: e.role || "", pin: e.pin || "", color: e.color || "#2D6A4F", availableDays: e.available_days || [0,1,2,3,4,5,6] })),
      schedule, weeks: (weekRows || []).map(w => w.week_start),
    };
  },
  async writePunch(punch, businessId) {
    await kbFetch("punches", { method: "POST", body: JSON.stringify({ business_id: businessId, employee_id: punch.empId, employee_name: punch.empName, punch_type: punch.type, punched_at: punch.time || new Date().toISOString(), scheduled_start: punch.scheduled?.start ?? null, scheduled_end: punch.scheduled?.end ?? null, flags: punch.flags || [] }) });
  },
  async getTodayPunchesForEmp(empId) {
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const rows = await kbFetch(`punches?select=*&employee_id=eq.${empId}&punched_at=gte.${todayStart.toISOString()}&order=punched_at.asc`);
    return (rows || []).map(r => ({ id: r.id, type: r.punch_type, time: r.punched_at, scheduled: r.scheduled_start ? { start: parseFloat(r.scheduled_start), end: parseFloat(r.scheduled_end) } : null, flags: r.flags || [] }));
  },
};

const DAY_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const fmt = v => { if (v == null) return ""; const h = Math.floor(v), m = Math.round((v-h)*60); const hr = h%12===0?12:h%12; return `${hr}:${m===0?"00":"30"} ${h<12?"AM":"PM"}`; };
const shiftHrs = s => (!s ? 0 : Math.max(0, parseFloat((s.end-s.start).toFixed(2))));
const nowDecimal = () => { const n = new Date(); return n.getHours() + n.getMinutes()/60; };
// Local-date-safe "YYYY-MM-DD" — avoids UTC rollover shifting the date late in the day
const toLocalDateStr = d => { const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; };

function getTodayShift(schedule, weeks, empId) {
  const now = new Date(), todayStr = toLocalDateStr(now), todayIdx = now.getDay();
  for (const wkStart of weeks) {
    const sun = new Date(wkStart+"T00:00:00");
    const dates = Array.from({length:7},(_,i)=>{ const d=new Date(sun); d.setDate(sun.getDate()+i); return toLocalDateStr(d); });
    if (!dates.includes(todayStr)) continue;
    const shift = schedule?.[wkStart]?.[empId]?.[todayIdx];
    if (shift) return { shift, dayIdx: todayIdx };
  }
  return null;
}

function timeAgo(isoStr) {
  const mins = Math.floor((Date.now()-new Date(isoStr))/60000);
  if (mins<1) return "just now"; if (mins<60) return `${mins}m ago`;
  const hrs = Math.floor(mins/60); if (hrs<24) return `${hrs}h ago`;
  return new Date(isoStr).toLocaleDateString("en-US",{month:"short",day:"numeric"});
}

function getAvailableActions(punches) {
  if (!punches.length) return ["in"];
  const last = punches[punches.length-1].type;
  if (last === "in" || last === "break_in") return ["out","break_out"];
  if (last === "break_out") return ["break_in","out"];   // can end shift directly from break, no forced return
  if (last === "out") return [];
  return ["in"];
}

const ACTION_CONFIG = {
  in:        { label:"Clock In",    color:"#2D6A4F", icon:"👊", desc:"Start your shift" },
  out:       { label:"Clock Out",   color:"#C0392B", icon:"👋", desc:"End your shift" },
  break_out: { label:"Start Break", color:"#E8A93A", icon:"☕", desc:"Take a break" },
  break_in:  { label:"End Break",   color:"#3A9BE8", icon:"🔙", desc:"Back to work" },
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;900&family=DM+Mono:wght@400;500&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{width:100%;height:100%;min-height:100vh;background:#0D1117;font-family:'DM Sans',system-ui,sans-serif;-webkit-text-size-adjust:100%;overscroll-behavior:none;}
  input{font-family:'DM Mono',monospace;}
  button{font-family:'DM Sans',system-ui,sans-serif;-webkit-tap-highlight-color:transparent;cursor:pointer;}
  @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes blink{0%,100%{border-color:#2D6A4F}50%{border-color:#21262D}}
  @keyframes progress{from{width:100%}to{width:0%}}
  .fade-in{animation:fadeIn 0.3s ease both;}
  .spin{animation:spin 1s linear infinite;}
  .pin-input{width:100%;height:72px;background:#161B22;border:2px solid #21262D;border-radius:14px;color:white;font-size:32px;font-family:'DM Mono',monospace;font-weight:500;letter-spacing:0.3em;text-align:center;outline:none;transition:border-color 0.15s;animation:blink 1.2s ease-in-out infinite;}
  .pin-input:focus{border-color:#2D6A4F;animation:none;}
  .key-btn{width:100%;aspect-ratio:1;background:#161B22;border:1.5px solid #21262D;border-radius:16px;color:white;font-size:26px;font-weight:700;transition:all 0.08s;display:flex;align-items:center;justify-content:center;user-select:none;-webkit-user-select:none;}
  .key-btn:active{background:#2D6A4F;border-color:#2D6A4F;transform:scale(0.94);}
  .punch-btn{width:100%;padding:20px 0;border-radius:16px;border:none;font-size:17px;font-weight:800;transition:all 0.15s;display:flex;align-items:center;justify-content:center;gap:10px;}
  .punch-btn:active{transform:scale(0.97);opacity:0.9;}
  ::-webkit-scrollbar{width:4px;}
  ::-webkit-scrollbar-track{background:transparent;}
  ::-webkit-scrollbar-thumb{background:#21262D;border-radius:4px;}
`;

function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(t); }, []);
  return (
    <div style={{textAlign:"center"}}>
      <div style={{fontSize:52,fontWeight:900,color:"white",lineHeight:1,letterSpacing:"-0.02em",fontFamily:"'DM Mono',monospace"}}>
        {now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}
      </div>
      <div style={{fontSize:14,color:"#8B949E",marginTop:6,fontWeight:500}}>
        {now.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
      </div>
    </div>
  );
}


export default function ShiftWiseKiosk() {
  const [screen,          setScreen]       = useState("idle");
  const [bizData,         setBizData]      = useState(null);
  const [loading,         setLoading]      = useState(true);
  const [loadError,       setLoadError]    = useState(null);
  const [pin,             setPin]          = useState("");
  const [matchedEmp,      setMatchedEmp]   = useState(null);
  const [todayPunches,    setTodayPunches] = useState([]);
  const [resultMsg,       setResultMsg]    = useState(null);
  const [submitting,      setSubmitting]   = useState(false);
  const [selectedAction,  setSelectedAction] = useState(null);
  const [selectedEmp,     setSelectedEmp]   = useState(null);
  const pinRef = useRef();

  const bizId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("bizId") || params.get("biz_id") || params.get("business_id") || null;
  }, []);

  const loadData = useCallback(async () => {
    try {
      if (!bizId) throw new Error("No business ID in URL. Add ?bizId=YOUR_ID to the kiosk URL.");
      const data = await DATA_LAYER.getBusinessData(bizId);
      if (!data) throw new Error("No business found. Check your bizId or set up your account in ShiftWise first.");
      setBizData(data); setLoadError(null);
    } catch(e) { setLoadError(e.message); }
    finally { setLoading(false); }
  }, [bizId]);

  useEffect(() => { loadData(); const i = setInterval(loadData,60000); return ()=>clearInterval(i); }, [loadData]);

  useEffect(() => {
    if (screen==="result") {
      const t = setTimeout(()=>{ setScreen("idle"); setPin(""); setMatchedEmp(null); setResultMsg(null); setSelectedAction(null); setSelectedEmp(null); },5000);
      return ()=>clearTimeout(t);
    }
  }, [screen]);

  useEffect(() => { if (screen==="pin") setTimeout(()=>pinRef.current?.focus(),100); }, [screen]);

  function handleKey(k) {
    if (pin.length>=6) return;
    const next = pin+k; setPin(next);
    if (selectedEmp && selectedEmp.pin && next===selectedEmp.pin) {
      setTimeout(()=>submitPin(next),120);
    }
  }

  function handleBackspace() { setPin(p=>p.slice(0,-1)); }

  async function submitPin(pinVal) {
    const val = pinVal||pin; if (!val || !selectedEmp) return;
    if (val !== selectedEmp.pin) { setResultMsg({ok:false,message:"PIN not recognized. Please try again.",icon:"❌"}); setScreen("result"); return; }
    const emp = selectedEmp;
    setMatchedEmp(emp);
    try { const punches = await DATA_LAYER.getTodayPunchesForEmp(emp.id); setTodayPunches(punches); }
    catch(e) { setTodayPunches([]); }
    setScreen("confirm");
  }

  async function confirmPunchDirect(action, emp, punches) {
    setSubmitting(true);
    const now=new Date(), nowDec=nowDecimal();
    const todayData=getTodayShift(bizData.schedule,bizData.weeks,emp.id);
    const flags=[]; let message="";

    if (action==="in") {
      if (!todayData) { flags.push("NO_SHIFT"); message="No shift scheduled — punch recorded and flagged for manager review."; }
      else {
        const {shift}=todayData, minsEarly=(shift.start-nowDec)*60;
        if (minsEarly>15) { setResultMsg({ok:false,message:`Too early. Your shift starts at ${fmt(shift.start)}.`,icon:"⏰"}); setSubmitting(false); setScreen("result"); return; }
        if (minsEarly>0) flags.push("EARLY");
        if (nowDec>shift.start+0.25) flags.push("LATE");
        message = flags.includes("LATE") ? `Clocked in late. Shift started at ${fmt(shift.start)}.` : `Clocked in. Shift: ${fmt(shift.start)} – ${fmt(shift.end)}.`;
      }
    } else if (action==="break_out") { message="Break started. Enjoy!"; }
    else if (action==="break_in") { message="Welcome back!"; }
    else if (action==="out") {
      if (todayData&&nowDec<todayData.shift.end-0.25) flags.push("EARLY_OUT");
      message = flags.includes("EARLY_OUT") ? `Clocked out early. Shift ends at ${fmt(todayData.shift.end)}.` : "Clocked out. Have a great rest of your day!";
    }

    const punch = { empId:emp.id, empName:emp.name, type:action, time:now.toISOString(), scheduled:todayData?.shift||null, flags };
    try {
      await DATA_LAYER.writePunch(punch,bizData.businessId);
      setMatchedEmp(emp);
      setResultMsg({ok:true,message,icon:ACTION_CONFIG[action].icon,type:action,flags});
    } catch(e) { setResultMsg({ok:false,message:"Could not save punch — check your connection.",icon:"⚠️"}); }
    setSubmitting(false); setScreen("result");
  }

  async function confirmPunch(action) {
    if (!matchedEmp||submitting) return;
    await confirmPunchDirect(action, matchedEmp, todayPunches);
  }

  const W = { maxWidth:480, margin:"0 auto", width:"100%", padding:"0 20px" };

  if (loading) return (
    <div style={{minHeight:"100vh",background:"#0D1117",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
      <style>{CSS}</style>
      <div className="spin" style={{width:36,height:36,border:"3px solid #21262D",borderTopColor:"#2D6A4F",borderRadius:"50%"}}/>
      <div style={{color:"#8B949E",fontSize:13,fontWeight:500}}>Loading kiosk…</div>
    </div>
  );

  if (loadError) return (
    <div style={{minHeight:"100vh",background:"#0D1117",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,padding:24}}>
      <style>{CSS}</style>
      <div style={{fontSize:36}}>⚠️</div>
      <div style={{color:"white",fontWeight:700,fontSize:16,textAlign:"center"}}>Connection Error</div>
      <div style={{color:"#8B949E",fontSize:13,textAlign:"center",maxWidth:320,lineHeight:1.6}}>{loadError}</div>
      <button onClick={loadData} style={{marginTop:8,background:"#2D6A4F",color:"white",border:"none",borderRadius:10,padding:"10px 24px",fontWeight:700,fontSize:13}}>Retry</button>
    </div>
  );

  if (screen==="idle") return (
    <div style={{minHeight:"100vh",background:"#0D1117",display:"flex",flexDirection:"column"}}>
      <style>{CSS}</style>
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:24,padding:"32px 20px"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,background:"#2D6A4F",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>📅</div>
          <span style={{color:"white",fontWeight:900,fontSize:18}}>{bizData?.businessName||"ShiftWise"}</span>
        </div>
        <LiveClock/>
        <div className="fade-in" style={{width:"100%",maxWidth:560,padding:"0 20px"}}>
          <div style={{fontSize:12,color:"#8B949E",fontWeight:600,textAlign:"center",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:16}}>Tap your name to clock in or out</div>
          {(!bizData?.employees || bizData.employees.length===0) ? (
            <div style={{textAlign:"center",color:"#8B949E",fontSize:13,padding:"20px 0"}}>No employees found yet.</div>
          ) : (
            <div style={{display:"flex",flexWrap:"wrap",gap:16,justifyContent:"center",maxWidth:900,margin:"0 auto"}}>
              {bizData.employees.map(emp=>(
                <button key={emp.id} onClick={()=>{setSelectedEmp(emp);setSelectedAction(null);setScreen("pin");}}
                  style={{background:"#111",border:`2px solid ${emp.color}33`,borderRadius:16,padding:"24px 16px",width:160,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:12,transition:"all 0.15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.background=emp.color+"15";e.currentTarget.style.borderColor=emp.color+"77";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="#111";e.currentTarget.style.borderColor=emp.color+"33";}}>
                  <div style={{width:56,height:56,borderRadius:"50%",background:emp.color,display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:900,fontSize:24}}>
                    {emp.name?.[0]?.toUpperCase()||"?"}
                  </div>
                  <div style={{color:"white",fontWeight:700,fontSize:15,textAlign:"center"}}>{emp.name}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (screen==="pin") return (
    <div style={{minHeight:"100vh",background:"#0D1117",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px 20px"}}>
      <style>{CSS}</style>
      <div className="fade-in" style={{...W}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{fontSize:13,color:"#8B949E",fontWeight:500,marginBottom:8}}>{bizData?.businessName}</div>
          {selectedEmp&&(
            <div style={{display:"inline-flex",alignItems:"center",gap:8,background:selectedEmp.color+"22",border:`1.5px solid ${selectedEmp.color}55`,borderRadius:999,padding:"6px 16px 6px 10px",marginBottom:14}}>
              <div style={{width:24,height:24,borderRadius:"50%",background:selectedEmp.color,display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:800,fontSize:11}}>
                {selectedEmp.name?.[0]?.toUpperCase()||"?"}
              </div>
              <span style={{color:"white",fontWeight:700,fontSize:14}}>{selectedEmp.name}</span>
            </div>
          )}
          <div style={{fontSize:22,fontWeight:800,color:"white"}}>Enter your PIN</div>
        </div>
        <div style={{marginBottom:20}}>
          <input ref={pinRef} type="password" inputMode="numeric" value={pin}
            onChange={e=>{const v=e.target.value.replace(/\D/g,"").slice(0,6);setPin(v);}}
            onKeyDown={e=>{if(e.key==="Enter"&&pin.length>=4)submitPin();}}
            className="pin-input" placeholder="• • • •" maxLength={6}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
          {["1","2","3","4","5","6","7","8","9"].map(k=>(
            <button key={k} className="key-btn" onClick={()=>handleKey(k)}>{k}</button>
          ))}
          <button className="key-btn" onClick={handleBackspace} style={{fontSize:20}}>⌫</button>
          <button className="key-btn" onClick={()=>handleKey("0")}>0</button>
          <button className="key-btn" onClick={()=>{setScreen("idle");setPin("");setSelectedAction(null);setSelectedEmp(null);}} style={{fontSize:14,color:"#8B949E"}}>← Back</button>
        </div>
        <button onClick={()=>submitPin()} disabled={pin.length<4}
          style={{width:"100%",padding:"18px 0",borderRadius:14,border:"none",fontSize:16,fontWeight:700,background:pin.length>=4?(selectedEmp?.color||"#2D6A4F"):"#161B22",color:pin.length>=4?"white":"#8B949E"}}>
          Confirm
        </button>
      </div>
    </div>
  );

  if (screen==="confirm"&&matchedEmp) {
    const availableActions=["in","out","break_out","break_in"]; // always show all 4 — owner preference
    const todayData=getTodayShift(bizData.schedule,bizData.weeks,matchedEmp.id);
    const lastPunch=todayPunches.length?todayPunches[todayPunches.length-1]:null;
    return (
      <div style={{minHeight:"100vh",background:"#0D1117",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px 20px"}}>
        <style>{CSS}</style>
        <div className="fade-in" style={{...W}}>
          <div style={{background:"#161B22",border:`2px solid ${matchedEmp.color}40`,borderRadius:20,padding:"24px 20px",marginBottom:24,textAlign:"center"}}>
            <div style={{width:64,height:64,borderRadius:"50%",background:matchedEmp.color,display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:900,fontSize:28,margin:"0 auto 12px"}}>
              {matchedEmp.name?.[0]?.toUpperCase()||"?"}
            </div>
            <div style={{color:"white",fontWeight:800,fontSize:22}}>{matchedEmp.name}</div>
            {matchedEmp.role&&<div style={{color:"#8B949E",fontSize:13,marginTop:4}}>{matchedEmp.role}</div>}
            {todayData&&(
              <div style={{marginTop:14,background:"#0D1117",borderRadius:10,padding:"10px 14px",display:"inline-block"}}>
                <div style={{fontSize:10,color:"#8B949E",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Today's Shift</div>
                <div style={{color:"white",fontWeight:700,fontSize:15,fontFamily:"'DM Mono',monospace"}}>
                  {fmt(todayData.shift.start)} – {fmt(todayData.shift.end)}
                  <span style={{marginLeft:10,color:"#8B949E",fontWeight:400,fontSize:12}}>{shiftHrs(todayData.shift)}h</span>
                </div>
              </div>
            )}
            {lastPunch&&(
              <div style={{marginTop:10,fontSize:12,color:"#8B949E"}}>
                Last action: <span style={{color:lastPunch.type==="out"?"#C0392B":"#2D6A4F",fontWeight:700}}>
                  {ACTION_CONFIG[lastPunch.type]?.label||lastPunch.type}
                </span> · {timeAgo(lastPunch.time)}
              </div>
            )}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
            {availableActions.map(action=>{
              const cfg=ACTION_CONFIG[action];
              return (
                <button key={action} className="punch-btn" onClick={()=>confirmPunch(action)} disabled={submitting}
                  style={{background:submitting?"#21262D":cfg.color,color:"white",padding:"18px 8px",fontSize:15}}>
                  {submitting
                    ?<div className="spin" style={{width:18,height:18,border:"2px solid rgba(255,255,255,0.3)",borderTopColor:"white",borderRadius:"50%"}}/>
                    :<>{cfg.icon} {cfg.label}</>
                  }
                </button>
              );
            })}
          </div>

          <button onClick={()=>{setScreen("idle");setPin("");setMatchedEmp(null);setSelectedAction(null);setSelectedEmp(null);}}
            style={{width:"100%",background:"transparent",color:"#8B949E",border:"1px solid #21262D",borderRadius:14,padding:"13px 0",fontSize:14,fontWeight:600}}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (screen==="result"&&resultMsg) {
    const acfg=resultMsg.type?ACTION_CONFIG[resultMsg.type]:null;
    const color=resultMsg.ok?(acfg?.color||"#2D6A4F"):"#C0392B";
    return (
      <div style={{minHeight:"100vh",background:"#0D1117",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px 20px"}}>
        <style>{CSS}</style>
        <div className="fade-in" style={{...W,textAlign:"center"}}>
          <div style={{fontSize:80,marginBottom:20,lineHeight:1}}>{resultMsg.icon}</div>
          {matchedEmp&&<div style={{color:"white",fontWeight:900,fontSize:26,marginBottom:10}}>{matchedEmp.name}</div>}
          <div style={{color,fontWeight:700,fontSize:16,marginBottom:12,lineHeight:1.6}}>{resultMsg.message}</div>
          {resultMsg.flags?.length>0&&(
            <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap",marginBottom:16}}>
              {resultMsg.flags.map(f=><span key={f} style={{background:"#21262D",color:"#E8A93A",borderRadius:6,padding:"3px 10px",fontSize:11,fontWeight:700}}>{f}</span>)}
            </div>
          )}
          <div style={{color:"#8B949E",fontSize:12,fontFamily:"'DM Mono',monospace",marginBottom:24}}>
            {new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit",second:"2-digit"})}
          </div>
          <div style={{height:4,background:"#21262D",borderRadius:2,overflow:"hidden"}}>
            <div style={{height:"100%",background:color,borderRadius:2,animation:"progress 5s linear forwards"}}/>
          </div>
          <div style={{color:"#3D444D",fontSize:11,marginTop:8}}>Returning to home screen in 5 seconds…</div>
        </div>
      </div>
    );
  }

  return null;
}
