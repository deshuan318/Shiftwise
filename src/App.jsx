import { useState, useMemo, useRef, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE CONFIG
// To update credentials: change SUPABASE_URL and SUPABASE_ANON_KEY only.
// All queries live in the functions below — no other files need to change.
// ─────────────────────────────────────────────────────────────────────────────
const SUPABASE_URL      = "https://kyrjgfeowmflazywsuir.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5cmpnZmVvd21mbGF6eXdzdWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NzMzMTQsImV4cCI6MjA5NTA0OTMxNH0.njuDREVF4oIgTYN6wLXKw6Hw_KsFzKPoMabkld_jy0E";
const SB_HEADERS = { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" };

// Session stored in localStorage (auth token only — not business data)
const SW_SESSION_KEY = "sw_session";

function getToken() {
  try { const s = JSON.parse(localStorage.getItem(SW_SESSION_KEY)||"null"); return s?.access_token || SUPABASE_ANON_KEY; }
  catch { return SUPABASE_ANON_KEY; }
}
function getSession() {
  try { return JSON.parse(localStorage.getItem(SW_SESSION_KEY)||"null"); } catch { return null; }
}
function saveSession(s) { localStorage.setItem(SW_SESSION_KEY, JSON.stringify(s)); }
function clearSession() { localStorage.removeItem(SW_SESSION_KEY); }

// Core fetch helper
async function sbFetch(path, opts={}) {
  const token = getToken();
  const url = path.startsWith("http") ? path : `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      ...SB_HEADERS,
      "Authorization": `Bearer ${token}`,
      "Prefer": opts.prefer || "return=representation",
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const e = await res.json().catch(()=>({message:res.statusText}));
    throw new Error(e.message || e.error || res.statusText);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
const dbGet    = (path)       => sbFetch(path, { method:"GET" });
const dbPost   = (path, body) => sbFetch(path, { method:"POST",   body:JSON.stringify(body) });
const dbPatch  = (path, body) => sbFetch(path, { method:"PATCH",  body:JSON.stringify(body), prefer:"return=representation" });
const dbDelete = (path)       => sbFetch(path, { method:"DELETE", prefer:"return=minimal" });
const dbUpsert = (path, body) => sbFetch(path, { method:"POST",   body:JSON.stringify(Array.isArray(body)?body:[body]), headers:{"Prefer":"resolution=merge-duplicates,return=representation"} });

const DAYS      = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DAY_FULL  = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const COLORS    = ["#E8623A","#3A9BE8","#4CAF7D","#E8A93A","#9B59B6","#E84E8A","#1ABC9C","#E67E22"];
const DEFAULT_SHIFT_TYPES = [
  { id:"regular",  label:"Regular",  color:"#4CAF7D" },
  { id:"opening",  label:"Opening",  color:"#3A9BE8" },
  { id:"closing",  label:"Closing",  color:"#9B59B6" },
  { id:"training", label:"Training", color:"#E8A93A" },
  { id:"cover",    label:"Cover",    color:"#E84E8A" },
  { id:"manager",  label:"Manager",  color:"#E8623A" },
];
const toTypeArr = t => !t ? ["regular"] : Array.isArray(t) ? t : [t];
const STORAGE_KEY = "shiftwise_v2";

const fmt = v => {
  if (v == null) return "";
  const h = Math.floor(v), m = Math.round((v - h) * 60);
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${m === 0 ? "00" : "30"} ${h < 12 ? "AM" : "PM"}`;
};
const shiftHrs = s => (!s ? 0 : Math.max(0, parseFloat((s.end - s.start).toFixed(2))));
const getSunday = ds => { const d = new Date(ds+"T00:00:00"); d.setDate(d.getDate()-d.getDay()); return d.toISOString().split("T")[0]; };
const addDays = (ds,n) => { const d = new Date(ds+"T00:00:00"); d.setDate(d.getDate()+n); return d.toISOString().split("T")[0]; };
const weekDatesFromSunday = s => { const sun=new Date(s+"T00:00:00"); return DAYS.map((_,i)=>{ const d=new Date(sun); d.setDate(sun.getDate()+i); return d; }); };
const dl = d => { if(!d) return ""; const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return dt.toLocaleDateString("en-US",{month:"short",day:"numeric"}); };
const toInputDate = d => { const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return dt.toISOString().split("T")[0]; };
const mkEmp = (o={}) => ({ id:(Date.now()+Math.random()).toString(), name:"", role:"", hourlyRate:"", color:COLORS[0], notes:"", availableHours:"40", availableDays:[0,1,2,3,4,5,6], pin:"", ...o });
const loadSaved = () => { try { const r=localStorage.getItem(STORAGE_KEY); return r?JSON.parse(r):null; } catch { return null; } };

const CSS = `
*, *::before, *::after { box-sizing: border-box; }
html { margin:0; padding:0; -webkit-text-size-adjust:100%; }
body { margin:0; padding:0; min-height:100vh; overflow-x:hidden; overflow-y:auto;
  -webkit-overflow-scrolling:touch; overscroll-behavior-y:auto;
  font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif; }
a, button { -webkit-tap-highlight-color:transparent; }
input,select,button,textarea { font-family:inherit; }
.grid-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; border-radius:12px; }
.payroll-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
@media (hover:hover) {
  .add-shift-btn:hover { border-color:#aaa !important; background:#EEF0EB !important; color:#6B7B6E !important; }
  .emp-card:hover { box-shadow:0 6px 20px rgba(0,0,0,0.1) !important; transform:translateY(-1px); }
  .nav-tab-btn:hover { color:#2D6A4F !important; }
  .action-btn:hover { opacity:0.88; }
}
.bottom-nav {
  position:fixed; bottom:0; left:0; right:0;
  background:#1C1C1C; display:flex; z-index:500;
  border-top:1px solid #2A2A2A;
  padding-bottom:env(safe-area-inset-bottom,0px);
}
.bottom-nav button {
  flex:1; background:transparent; border:none; color:#666;
  padding:10px 4px 8px; font-size:10px; font-weight:700; cursor:pointer;
  display:flex; flex-direction:column; align-items:center; gap:3px;
  touch-action:manipulation; transition:color 0.15s;
}
.bottom-nav button.active { color:#2D6A4F; }
.nav-icon { font-size:20px; line-height:1; }
.page-pad { padding-bottom:24px; }
@media (min-width:768px) { .bottom-nav { display:none !important; } }
@media (max-width:1024px) { .controls-bar { flex-wrap:wrap !important; } }
@media (max-width:767px) {
  .top-bar-tabs  { display:none !important; }
  .top-stats     { display:none !important; }
  .biz-input     { width:140px !important; font-size:13px !important; }
  .top-bar-inner { height:50px !important; }
  .page-pad      { padding-bottom:calc(80px + env(safe-area-inset-bottom,0px)) !important; }
  .sched-table th, .sched-table td { padding:3px 2px !important; }
  .emp-name-cell { min-width:72px !important; max-width:72px !important; }
  .shift-badge   { font-size:9px !important; }
  .sh-pay        { display:none !important; }
  .stat-grid { grid-template-columns:1fr 1fr !important; }
  .team-grid { grid-template-columns:1fr !important; }
  input, select, textarea { font-size:16px !important; }
  button { min-height:40px; touch-action:manipulation; }
  .controls-bar { flex-direction:column !important; gap:10px !important; }
  .controls-divider { display:none !important; }
  .mobile-compact { padding:12px 14px !important; }
}
`;

const THEMES = {
  fieldwork: {
    id:"fieldwork", name:"Fieldwork", tagline:"Forest Green + Cream",
    desc:"Grounded, dependable, easy on the eyes.",
    preview: { bg:"#F7F4EE", accent:"#2D6A4F", dark:"#1C2B22" },
    bg:"#F7F4EE", surface:"#FFFFFF", dark:"#1C2B22",
    accent:"#2D6A4F", muted:"#EEF0EB", border:"#DDD8CE",
    text:"#1C2B22", sub:"#6B7B6E", radius:14,
    shadow:"0 1px 6px rgba(0,0,0,0.07)", shadowMd:"0 4px 16px rgba(0,0,0,0.10)",
  },
  commander: {
    id:"commander", name:"Commander", tagline:"Deep Navy + Gold",
    desc:"Authority, premium, built-for-business.",
    preview: { bg:"#0B1426", accent:"#C9A84C", dark:"#070E1C" },
    bg:"#0B1426", surface:"#132040", dark:"#070E1C",
    accent:"#C9A84C", muted:"#1A2D55", border:"#1E3160",
    text:"#F0EDE6", sub:"#8B9BB4", radius:14,
    shadow:"0 1px 8px rgba(0,0,0,0.3)", shadowMd:"0 4px 20px rgba(0,0,0,0.4)",
  },
  precision: {
    id:"precision", name:"Precision", tagline:"Charcoal + Electric Green",
    desc:"Modern, sharp, no-nonsense.",
    preview: { bg:"#F1F3F4", accent:"#00C853", dark:"#1A1A1A" },
    bg:"#F1F3F4", surface:"#FFFFFF", dark:"#1A1A1A",
    accent:"#00C853", muted:"#EAECEE", border:"#E0E3E7",
    text:"#1A1A1A", sub:"#6B7280", radius:14,
    shadow:"0 1px 6px rgba(0,0,0,0.07)", shadowMd:"0 4px 16px rgba(0,0,0,0.10)",
  },
  classic: {
    id:"classic", name:"Classic", tagline:"Warm Slate + Coral",
    desc:"Familiar, warm, approachable.",
    preview: { bg:"#F2EFE9", accent:"#E8623A", dark:"#1C1C1C" },
    bg:"#F2EFE9", surface:"#FFFFFF", dark:"#1C1C1C",
    accent:"#E8623A", muted:"#F0EDE8", border:"#E4E0DA",
    text:"#1C1C1C", sub:"#7A7672", radius:14,
    shadow:"0 1px 6px rgba(0,0,0,0.07)", shadowMd:"0 4px 16px rgba(0,0,0,0.10)",
  },
};

const Card = ({ children, style={}, T }) => (
  <div style={{ background:T.surface, borderRadius:T.radius, boxShadow:T.shadow, overflow:"visible", ...style }}>
    {children}
  </div>
);

const SectionLabel = ({ children, T }) => (
  <div style={{ fontSize:10, fontWeight:700, color:T.sub, letterSpacing:"0.08em", marginBottom:6, textTransform:"uppercase" }}>
    {children}
  </div>
);

const Pill = ({ active, onClick, children, color, T }) => (
  <button onClick={onClick} className="action-btn" style={{
    background: active ? (color||T.dark) : T.muted,
    color:      active ? "white" : T.sub,
    border:     "none", borderRadius:8, padding:"7px 14px",
    fontWeight:700, fontSize:12, cursor:"pointer", transition:"all 0.15s", whiteSpace:"nowrap"
  }}>{children}</button>
);

const Divider = ({ T }) => (
  <div className="controls-divider" style={{ width:1, background:T.border, alignSelf:"stretch" }} />
);

export default function App() {
  const defaultSun = useMemo(() => getSunday(new Date().toISOString().split("T")[0]), []);

  // ── Auth state ────────────────────────────────────────────────────────────
  const [authState,   setAuthState]   = useState(() => {
    const s = getSession();
    return s?.access_token ? "loading" : "unauthenticated";
  });
  const [authEmail,   setAuthEmail]   = useState("");
  const [authPass,    setAuthPass]    = useState("");
  const [authMode,    setAuthMode]    = useState("signin");
  const [authError,   setAuthError]   = useState("");
  const [authBizName, setAuthBizName] = useState("");
  const [bizId,       setBizId]       = useState(null);

  // ── App state — hydrated from Supabase on load ────────────────────────────
  const [tab,         setTab]         = useState("grid");
  const [themeId,     setThemeId]     = useState("fieldwork");
  const T = THEMES[themeId] || THEMES.fieldwork;
  const [biz,         setBiz]         = useState("My Business");
  const [weekMode,    setWeekMode]     = useState("1");
  const [wk1Start,    setWk1Start]     = useState(defaultSun);
  const [wk2Start,    setWk2Start]     = useState(addDays(defaultSun,7));
  const [activeWeek,  setActiveWeek]   = useState(null);
  const [printWeek,   setPrintWeek]    = useState(defaultSun);
  const [payWeek,     setPayWeek]      = useState(defaultSun);
  const [printView,   setPrintView]    = useState("weekly");
  const [weeklyBudget,setWeeklyBudget] = useState("");
  const [clipboard,   setClipboard]    = useState(null);
  const [employees,   setEmployees]    = useState([]);
  const [editEmpId,   setEditEmpId]    = useState(null);
  const [schedule,    setSchedule]     = useState({});
  const [weekMap,     setWeekMap]      = useState({});
  const [published,   setPublished]    = useState([]);
  const [historyOpen, setHistoryOpen]  = useState(false);
  const [historyPrev, setHistoryPrev]  = useState(null);
  const [openCell,    setOpenCell]     = useState(null);
  const [toast,       setToast]        = useState(null);
  const [settingsSection, setSettingsSection] = useState(null);
  const [recMsg,   setRecMsg]   = useState("");
  const [recTo,    setRecTo]    = useState("");
  const [recFrom,  setRecFrom]  = useState("Owner");
  const [recEmoji, setRecEmoji] = useState("⭐");
  const [recType,  setRecType]  = useState("shoutout");
  const [auditLog,   setAuditLog]   = useState([]);
  const [shiftTypes,  setShiftTypes]  = useState(DEFAULT_SHIFT_TYPES);
  const SHIFT_TYPES = shiftTypes;
  const [recognition, setRecognition] = useState([]);
  const [schedView,    setSchedView]   = useState("weekly");
  const [activeDay,    setActiveDay]   = useState(() => new Date().toISOString().split("T")[0]);
  const [actionsOpen,  setActionsOpen] = useState(false);
  const [templates,    setTemplates]   = useState([]);
  const [salesData,   setSalesData]   = useState([]);
  const [punches,        setPunches]        = useState([]);
const [tsWeekStart, setTsWeekStart] = useState(()=>getSunday(new Date().toISOString().split("T")[0]));
const [tsOpenCell, setTsOpenCell] = useState(null);
const [timesheetHistory, setTimesheetHistory] = useState([]);
const [punchReviews,   setPunchReviews]   = useState({}); // { punchId: "pending"|"reviewed"|"approved"|"rejected" }
const [alertsOpen,     setAlertsOpen]     = useState(false);
const [schedSubTab,    setSchedSubTab]    = useState("schedule"); // "schedule" | "timesheet"

  // ── Coverage / Open Shifts ───────────────────────────────────────────────
  // openShifts: { id, weekKey, empId, dayIdx, originalShift, reason, status, createdAt, claimedBy }
  // status: "open" | "claimed" | "covered" | "cancelled"
  const [openShifts, setOpenShifts] = useState(() => {
    try { const r = localStorage.getItem(STORAGE_KEY); return r ? (JSON.parse(r)?.openShifts ?? []) : []; } catch { return []; }
  });

  // ── Business Hours ────────────────────────────────────────────────────────
  // { sun:{open:"09:00",close:"17:00",closed:true}, mon:{...}, ... }
  const [businessHours, setBusinessHours] = useState(() => {
    try {
      const r = localStorage.getItem(STORAGE_KEY);
      return r ? (JSON.parse(r)?.businessHours ?? {}) : {};
    } catch { return {}; }
  });

  // ── Drag & Drop ───────────────────────────────────────────────────────────
  // draggedShift: { empId, weekKey, dayIdx, shift }
  const [draggedShift, setDraggedShift] = useState(null);
  const [dragOverCell, setDragOverCell] = useState(null); // { empId, dayIdx }
  // dropIntent: { empId, fromDayIdx, toDayIdx, weekKey, shift, x, y } — shows copy/move popup
  const [dropIntent,   setDropIntent]   = useState(null);

  // ── AI Insights ──────────────────────────────────────────────────────────
  const [insight,        setInsight]        = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError,   setInsightError]   = useState(null);

  const printRef = useRef();

  const showToast = (msg, dur=3000) => { setToast(msg); setTimeout(()=>setToast(null),dur); };

  // ─────────────────────────────────────────────────────────────────────────
  // AUTH FUNCTIONS
  // ─────────────────────────────────────────────────────────────────────────
 async function handleSignIn(e) {
    if(e?.preventDefault) e.preventDefault();
    setAuthError("");
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method:"POST",
        headers:{
          "apikey": SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body:JSON.stringify({email:authEmail, password:authPass}),
      });
      const text = await res.text();
      const data = JSON.parse(text);
      if (data.error || !data.access_token) throw new Error(data.error_description || data.error || "Sign in failed");
      saveSession(data);
      setAuthState("loading");
      await loadAllData();
    } catch(err) {
      setAuthError(err.message);
    }
  }

  async function handleSignUp(e) {
    if(e?.preventDefault) e.preventDefault();
    setAuthError("");
    if (!authBizName.trim()) { setAuthError("Enter your business name"); return; }
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method:"POST", headers:{...SB_HEADERS},
        body:JSON.stringify({email:authEmail, password:authPass}),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error_description || data.error || "Sign up failed");
      if (!data.access_token) {
        setAuthError("Check your email to confirm your account, then sign in.");
        return;
      }
      saveSession(data);
      // Create business record
      await dbPost("businesses", { owner_id: data.user.id, name: authBizName.trim() });
      setAuthState("loading");
      await loadAllData();
    } catch(err) { setAuthError(err.message); }
  }

  async function handleSignOut() {
    clearSession();
    setAuthState("unauthenticated");
    setEmployees([]); setSchedule({}); setBiz("My Business");
    setPublished([]); setAuditLog([]); setRecognition([]); setPunches([]);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DATA LOADING — single function hydrates all app state from Supabase
  // Supabase swap point: replace each dbGet call with your preferred client
  // ─────────────────────────────────────────────────────────────────────────
  async function loadAllData() {
    try {
      // 1. Get business record
      const bizRows = await dbGet("businesses?select=*&limit=1");
      const business = bizRows?.[0];
      if (!business) { setAuthState("unauthenticated"); clearSession(); return; }

      setBizId(business.id);
      setBiz(business.name || "My Business");
      setWeeklyBudget(business.weekly_budget ? String(business.weekly_budget) : "");
      // Load theme from local preference (kept local — it's a UI pref not business data)
      const localTheme = localStorage.getItem("sw_theme");
      if (localTheme && THEMES[localTheme]) setThemeId(localTheme);

      // 2. Load all data in parallel
      const [
        empRows, weekRows, shiftTypeRows, bizHourRows,
        salesRows, recRows, punchRows, openShiftRows,
        templateRows, publishedRows, auditRows,
      ] = await Promise.all([
        dbGet(`employees?select=*&business_id=eq.${business.id}&order=sort_order.asc,created_at.asc`),
        dbGet(`schedule_weeks?select=*&business_id=eq.${business.id}&order=week_start.asc`),
        dbGet(`shift_types?select=*&business_id=eq.${business.id}&order=sort_order.asc`),
        dbGet(`business_hours?select=*&business_id=eq.${business.id}&order=day_index.asc`),
        dbGet(`sales_data?select=*&business_id=eq.${business.id}&order=sale_date.asc`),
        dbGet(`recognition?select=*&business_id=eq.${business.id}&order=created_at.desc&limit=100`),
        dbGet(`punches?select=*&business_id=eq.${business.id}&order=punched_at.desc&limit=200`),
        dbGet(`open_shifts?select=*&business_id=eq.${business.id}&status=neq.cancelled&order=created_at.desc`),
        dbGet(`templates?select=*&business_id=eq.${business.id}&order=created_at.desc`),
        dbGet(`published_schedules?select=*&business_id=eq.${business.id}&order=published_at.desc`),
        dbGet(`audit_log?select=*&business_id=eq.${business.id}&order=created_at.desc&limit=500`),
      ]);

      // 3. Load shifts for all weeks
      const wks = weekRows || [];
      const wkIds = wks.map(w => w.id);
      const shiftRows = wkIds.length
        ? await dbGet(`shifts?select=*&week_id=in.(${wkIds.join(",")})`)
        : [];

      // 4. Build week map: { weekStart: supabaseWeekId }
      const newWeekMap = {};
      wks.forEach(w => { newWeekMap[w.week_start] = w.id; });
      setWeekMap(newWeekMap);

      // 5. Set week dates - always default to current week
      {
        const todaySun = getSunday(new Date().toISOString().split("T")[0]);
        setWk1Start(todaySun);
        setActiveWeek(todaySun);
        setPrintWeek(todaySun);
        if (wks.length > 1) { setWk2Start(wks[1].week_start); setWeekMode("2"); }
      }

      // 6. Transform employees
      setEmployees((empRows||[]).map(e => ({
        id:             e.id,
        name:           e.name,
        role:           e.role,
        hourlyRate:     String(e.hourly_rate || ""),
        color:          e.color,
        pin:            e.pin,
        availableDays:  e.available_days || [0,1,2,3,4,5,6],
        availableHours: String(e.available_hours || "40"),
        notes:          e.notes,
      })));

      // 7. Transform schedule: { weekStart: { empId: { dayIdx: shift } } }
      const sched = {};
      for (const row of (shiftRows||[])) {
        const wk = wks.find(w => w.id === row.week_id);
        if (!wk) continue;
        const wkKey = wk.week_start;
        if (!sched[wkKey]) sched[wkKey] = {};
        if (!sched[wkKey][row.employee_id]) sched[wkKey][row.employee_id] = {};
        sched[wkKey][row.employee_id][row.day_index] = {
          start: parseFloat(row.start_dec),
          end:   parseFloat(row.end_dec),
          type:  row.shift_types || ["regular"],
          notes: row.notes || "",
          _id:   row.id,
        };
      }
      setSchedule(sched);

      // 8. Shift types
      setShiftTypes((shiftTypeRows||[]).length > 0
        ? (shiftTypeRows||[]).map(r => ({ id:r.type_id, label:r.label, color:r.color }))
        : DEFAULT_SHIFT_TYPES
      );

      // 9. Business hours
      const bh = {};
      for (const r of (bizHourRows||[])) {
        bh[r.day_index] = {
          open:   r.open_time  ? r.open_time.slice(0,5)  : "09:00",
          close:  r.close_time ? r.close_time.slice(0,5) : "17:00",
          closed: r.is_closed,
        };
      }
      setBusinessHours(bh);

      // 10. Other state
      setSalesData((salesRows||[]).map(r=>({ date:r.sale_date, revenue:parseFloat(r.revenue), transactions:r.transactions })));
      setRecognition((recRows||[]).map(r=>({ id:r.id, at:r.created_at, type:r.rec_type, emoji:r.emoji, message:r.message, fromName:r.from_name, toName:r.to_name, toId:r.to_id })));
      setPunches((punchRows||[]).map(r=>({ id:r.id, empId:r.employee_id, empName:r.employee_name, type:r.punch_type, time:r.punched_at, scheduled:r.scheduled_start?{start:parseFloat(r.scheduled_start),end:parseFloat(r.scheduled_end)}:null, flags:r.flags||[] })));
      setOpenShifts((openShiftRows||[]).map(r=>({ id:r.id, weekKey:wks.find(w=>w.id===r.week_id)?.week_start||r.week_id, empId:r.employee_id, dayIdx:r.day_index, originalShift:r.shift_start?{start:parseFloat(r.shift_start),end:parseFloat(r.shift_end)}:null, reason:r.reason, status:r.status, claimedBy:r.claimed_by, createdAt:r.created_at })));
      setTemplates((templateRows||[]).map(r=>({ id:r.id, name:r.name, savedAt:r.created_at, scheduleData:r.schedule_data, employeeSnapshot:r.employee_snapshot })));
      setPublished((publishedRows||[]).map(r=>({ id:r.id, publishedAt:r.published_at, label:r.label, wk1Start:r.week_start, wk2Start:r.week_start, weekMode:"1", scheduleData:r.schedule_data, employeeSnapshot:r.employee_snapshot, budget:r.budget })));
      setAuditLog((auditRows||[]).map(r=>({ id:r.id, at:r.created_at, action:r.action, detail:r.detail, empName:r.employee_name })));

      setAuthState("authenticated");
    } catch(err) {
      console.error("loadAllData failed:", err);
      setAuthError("Could not load your data: " + err.message);
      setAuthState("unauthenticated");
    }
  }

  // Auto-load on mount if session exists
  useEffect(() => {
    if (authState === "loading") { loadAllData(); }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // DATA SNAPSHOT — single function to package all business context for AI.
  // When migrating to Supabase, replace this function's internals with
  // database queries. The AI call below remains completely unchanged.
  // ─────────────────────────────────────────────────────────────────────────
  function buildBusinessSnapshot() {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    // Build per-week summaries
    const weekSummaries = weeks.map(wk => {
      const wkDates = wk.dates.map(d => {
        const dt = typeof d === "string" ? new Date(d+"T00:00:00") : d;
        return dt.toISOString().split("T")[0];
      });

      const employeeBreakdown = employees.map(emp => {
        const dailyShifts = DAYS.map((day, di) => {
          const shift = schedule?.[wk.key]?.[emp.id]?.[di] || null;
          if (!shift) return null;
          return {
            day,
            date: wkDates[di],
            start: fmt(shift.start),
            end: fmt(shift.end),
            hours: shiftHrs(shift),
            type: toTypeArr(shift.type).join("+"),
            notes: shift.notes || null,
          };
        }).filter(Boolean);

        const totalHours = dailyShifts.reduce((s, d) => s + d.hours, 0);
        const estPay = totalHours * (parseFloat(emp.hourlyRate) || 0);
        const availHours = parseFloat(emp.availableHours) || 0;

        return {
          name: emp.name || "Unnamed",
          role: emp.role || "No role",
          hourlyRate: parseFloat(emp.hourlyRate) || 0,
          availableHoursPerWeek: availHours,
          scheduledHours: parseFloat(totalHours.toFixed(2)),
          estimatedPay: parseFloat(estPay.toFixed(2)),
          overtime: totalHours > 40,
          nearLimit: availHours > 0 && totalHours >= availHours * 0.85,
          overLimit: availHours > 0 && totalHours > availHours,
          unavailableDays: DAYS.filter((_, i) => !(emp.availableDays ?? [0,1,2,3,4,5,6]).includes(i)),
          shifts: dailyShifts,
        };
      });

      const totalHours = employeeBreakdown.reduce((s, e) => s + e.scheduledHours, 0);
      const totalPay = employeeBreakdown.reduce((s, e) => s + e.estimatedPay, 0);
      const staffed = employeeBreakdown.filter(e => e.scheduledHours > 0).length;

      // Match sales data to this week
      const wkSales = salesData.filter(s => wkDates.includes(s.date));
      const totalRevenue = wkSales.reduce((s, d) => s + d.revenue, 0);
      const laborPct = totalRevenue > 0 ? (totalPay / totalRevenue) * 100 : null;

      // Day-level staffing density
      const dailyTotals = DAYS.map((day, di) => {
        const staffCount = employees.filter(e => schedule?.[wk.key]?.[e.id]?.[di]).length;
        const dayHours = employees.reduce((s, e) => s + shiftHrs(schedule?.[wk.key]?.[e.id]?.[di] || null), 0);
        const sale = wkSales.find(s => s.date === wkDates[di]);
        return { day, date: wkDates[di], staffCount, totalHours: dayHours, revenue: sale?.revenue || null };
      });

      return {
        label: wk.label,
        startDate: wkDates[0],
        endDate: wkDates[6],
        totalScheduledHours: parseFloat(totalHours.toFixed(2)),
        totalEstimatedPay: parseFloat(totalPay.toFixed(2)),
        totalRevenue: totalRevenue > 0 ? parseFloat(totalRevenue.toFixed(2)) : null,
        laborCostPct: laborPct !== null ? parseFloat(laborPct.toFixed(1)) : null,
        staffScheduled: staffed,
        totalStaff: employees.length,
        budget: parseFloat(weeklyBudget) || null,
        overBudget: weeklyBudget && totalPay > parseFloat(weeklyBudget),
        employeeBreakdown,
        dailyTotals,
      };
    });

    // Recent punch flags
    const recentFlags = punches
      .filter(p => p.flags && p.flags.length > 0)
      .slice(-20)
      .map(p => ({ employee: p.empName, type: p.type, flags: p.flags, time: p.time }));

    // Overtime employees
    const overtimeAlerts = employees
      .filter(e => weeks.some(w => eWkH(w.key, e.id) > 40))
      .map(e => ({ name: e.name, hours: Math.max(...weeks.map(w => eWkH(w.key, e.id))) }));

    return {
      // ── swap this section for Supabase queries ──
      businessName: biz,
      businessHours: Object.entries(businessHours).reduce((acc,[di,h])=>({...acc,[DAYS[parseInt(di)]]:h}),{}),
      today: todayStr,
      dayOfWeek: today.toLocaleDateString("en-US", { weekday: "long" }),
      totalEmployees: employees.length,
      weeklyBudget: parseFloat(weeklyBudget) || null,
      hasSalesData: salesData.length > 0,
      salesDateRange: salesData.length > 0
        ? { from: salesData[0].date, to: salesData[salesData.length - 1].date }
        : null,
      weeks: weekSummaries,
      overtimeAlerts,
      recentPunchFlags: recentFlags,
      publishedSchedulesCount: published.length,
      // ─────────────────────────────────────────────
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AI INSIGHT GENERATOR — calls Claude with the business snapshot.
  // The prompt and API call are data-source agnostic.
  // ─────────────────────────────────────────────────────────────────────────
  async function generateInsight() {
    if (insightLoading) return;
    setInsightLoading(true);
    setInsightError(null);

    const snapshot = buildBusinessSnapshot();

    const prompt = `You are a sharp, concise business operations advisor for a small business owner-operator named ${snapshot.businessName || "the owner"}. 
They manage hourly staff (cafes, retail, service businesses) and handle everything themselves — scheduling, payroll, HR, operations.

Today is ${snapshot.dayOfWeek}, ${snapshot.today}.

Here is a complete snapshot of their current business data:
${JSON.stringify(snapshot, null, 2)}

Analyze this data and respond ONLY with a JSON object in exactly this structure (no markdown, no preamble):
{
  "headline": "One punchy sentence summarizing the most important thing they need to know right now (max 12 words)",
  "score": {
    "value": <number 1-100 representing overall scheduling health>,
    "label": "<one word: Healthy | Caution | Warning | Critical>",
    "reason": "<one sentence explaining the score>"
  },
  "sections": [
    {
      "title": "<section title>",
      "icon": "<single emoji>",
      "insight": "<2-3 sentences of plain-English analysis specific to their actual data>",
      "urgency": "<low|medium|high>"
    }
  ],
  "actions": [
    {
      "priority": <1-5, 1=most urgent>,
      "action": "<specific thing they should do, phrased as a direct instruction>",
      "why": "<one sentence explaining the business impact>"
    }
  ],
  "positives": ["<one thing going well>", "<another thing going well>"],
  "nextWeekFocus": "<one forward-looking recommendation for next week's scheduling>"
}

Rules:
- Every insight must reference their ACTUAL data (real names, real numbers, real dates). Never give generic advice.
- If they have no employees or no schedule yet, your sections and actions should guide them on getting started.
- If they have no sales data, note this as an opportunity but don't make it the main focus.
- Actions should be specific and immediately actionable, not vague.
- Keep total response under 800 tokens.
- Sections: include 2-4 most relevant from: Labor Cost, Staffing Coverage, Overtime Risk, Budget Tracking, Attendance Flags, Schedule Gaps, Team Availability.`;

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const data = await response.json();
      const raw = data.content?.map(b => b.text || "").join("") || "";
      const clean = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);

      setInsight({ ...parsed, generatedAt: new Date().toISOString(), snapshot });
    } catch (err) {
      setInsightError("Could not generate insights right now. Check your data and try again.");
      console.error("AI insight error:", err);
    } finally {
      setInsightLoading(false);
    }
  }

  function importSquareCSV(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = e.target.result;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) throw new Error("File appears empty");

        const parseRow = row => {
          const cols = []; let cur = ""; let inQ = false;
          for (let i = 0; i < row.length; i++) {
            const c = row[i];
            if (c === '"') { inQ = !inQ; }
            else if (c === ',' && !inQ) { cols.push(cur.trim().replace(/^"|"$/g,"")); cur = ""; }
            else cur += c;
          }
          cols.push(cur.trim().replace(/^"|"$/g,""));
          return cols;
        };

        const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g,""));
        const isSummary = headers.some(h => h.includes("grosssales") || h.includes("netsales") || h.includes("totalsales"));
        const isTransactions = headers.some(h => h.includes("time") || h.includes("amount") || h.includes("totalmoney"));
        const parsed = {};

        if (isSummary) {
          const dateIdx  = headers.findIndex(h => h === "date" || h.startsWith("date"));
          const salesIdx = headers.findIndex(h => h.includes("netsales") || h.includes("grosssales") || h.includes("totalsales") || h.includes("totalcollected"));
          for (let i = 1; i < lines.length; i++) {
            const row = parseRow(lines[i]);
            if (!row[dateIdx]) continue;
            const dateRaw = row[dateIdx];
            let date;
            const m = dateRaw.match(/(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})/);
            if (m) {
              const yr = m[3].length === 2 ? "20" + m[3] : m[3];
              date = `${yr}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
            } else if (dateRaw.match(/\d{4}-\d{2}-\d{2}/)) {
              date = dateRaw.slice(0,10);
            } else continue;
            const revenue = parseFloat((row[salesIdx]||"0").replace(/[\$,]/g,"")) || 0;
            if (!parsed[date]) parsed[date] = { revenue:0, transactions:0 };
            parsed[date].revenue += revenue;
          }
        } else if (isTransactions) {
          const dateIdx  = headers.findIndex(h => h === "date" || h.startsWith("date"));
          const salesIdx = headers.findIndex(h => h.includes("netsales") || h.includes("grosssales") || h.includes("totalcollected") || h.includes("amount"));
          for (let i = 1; i < lines.length; i++) {
            const row = parseRow(lines[i]);
            if (!row[dateIdx]) continue;
            const dateRaw = row[dateIdx];
            let date;
            const m = dateRaw.match(/(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})/);
            if (m) { const yr = m[3].length===2?"20"+m[3]:m[3]; date=`${yr}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`; }
            else if (dateRaw.match(/\d{4}-\d{2}-\d{2}/)) date = dateRaw.slice(0,10);
            else continue;
            const revenue = parseFloat((row[salesIdx]||"0").replace(/[\$,]/g,"")) || 0;
            if (revenue <= 0) continue;
            if (!parsed[date]) parsed[date] = { revenue:0, transactions:0 };
            parsed[date].revenue += revenue;
            parsed[date].transactions += 1;
          }
        } else {
          throw new Error("Could not detect Square report format.");
        }

        const result = Object.entries(parsed)
          .map(([date, d]) => ({ date, revenue: Math.round(d.revenue * 100)/100, transactions: d.transactions }))
          .sort((a,b) => a.date.localeCompare(b.date));

        if (result.length === 0) throw new Error("No sales data found in this file.");

        setSalesData(prev => {
          const map = {};
          prev.forEach(d => map[d.date] = d);
          result.forEach(d => map[d.date] = d);
          const merged = Object.values(map).sort((a,b) => a.date.localeCompare(b.date));
          // Write to Supabase
          if (bizId) {
            const rows = merged.map(d=>({ business_id:bizId, sale_date:d.date, revenue:d.revenue, transactions:d.transactions||0 }));
            dbUpsert("sales_data", rows).catch(e=>console.warn("Sales data write failed:", e));
          }
          return merged;
        });

        showToast(`${result.length} days of sales data imported ✓`, 4000);
        addAudit("Sales Data Imported", `${result.length} days from Square — ${result[0].date} to ${result[result.length-1].date}`);
      } catch(err) {
        alert("Could not read this file.\n\n" + err.message);
      }
    };
    reader.readAsText(file);
  }

  async function saveBizSettings(fields) {
    if (!bizId) return;
    try { await dbPatch(`businesses?id=eq.${bizId}`, fields); }
    catch(e) { console.warn("Business save failed:", e); }
  }

  const weeks = useMemo(() => {
    const base = [{ key:wk1Start, label:"Week 1", dates:weekDatesFromSunday(wk1Start) }];
    if (weekMode==="2") base.push({ key:wk2Start, label:"Week 2", dates:weekDatesFromSunday(wk2Start) });
    return base;
  }, [wk1Start, wk2Start, weekMode]);

  const activeWkObj = activeWeek ? (weeks.find(w=>w.key===activeWeek) || null) : null;

  useEffect(() => { if (weekMode==="1" && activeWeek===wk2Start) setActiveWeek(wk1Start); }, [weekMode]);

  // ── Theme persisted locally (no auth needed) ─────────────────────────────
  useEffect(() => {
    try { localStorage.setItem("sw_theme", themeId); } catch {}
  }, [themeId]);

  function exportData() {
    const data = { _v:2, _at:new Date().toISOString(), biz,weekMode,wk1Start,wk2Start,weeklyBudget,employees,schedule,published,themeId,activeWeek,punches,auditLog,recognition,shiftTypes,salesData };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
    a.download = `${biz.replace(/\s+/g,"_")}_${new Date().toISOString().split("T")[0]}.json`;
    a.click();
  }

  function importData(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = e => {
      try {
        const d = JSON.parse(e.target.result);
        if (!d.employees||!d.schedule) throw new Error();
        if (!window.confirm("Import this file? Current data will be replaced.")) return;
        if (d.biz)          setBiz(d.biz);
        if (d.weekMode)     setWeekMode(d.weekMode);
        if (d.wk1Start)     { setWk1Start(d.wk1Start); setActiveWeek(d.activeWeek ?? d.wk1Start ?? null); setPrintWeek(d.wk1Start); }
        if (d.wk2Start)     setWk2Start(d.wk2Start);
        if (d.weeklyBudget!==undefined) setWeeklyBudget(d.weeklyBudget);
        setEmployees(d.employees);
        setSchedule(d.schedule);
        if (d.published)    setPublished(d.published);
        if (d.themeId && THEMES[d.themeId]) setThemeId(d.themeId);
        if (d.auditLog) setAuditLog(d.auditLog);
        if (d.recognition) setRecognition(d.recognition);
        if (d.shiftTypes) setShiftTypes(d.shiftTypes);
        if (d.salesData) setSalesData(d.salesData);
        if (d.templates) setTemplates(d.templates);
        showToast("Imported successfully ✓");
      } catch { alert("Invalid ShiftWise export file."); }
    };
    r.readAsText(file);
  }

  function addAudit(action, detail, extras={}) {
    const entry = { id: Date.now().toString(), at: new Date().toISOString(), action, detail, ...extras };
    setAuditLog(p => [entry, ...p].slice(0, 500));
    // Fire-and-forget write to Supabase
    if (bizId) {
      dbPost("audit_log", { business_id:bizId, action, detail, employee_name:extras?.empName||null })
        .catch(e => console.warn("Audit log write failed:", e));
    }
  }

  const getShift = (wk,eid,di) => schedule?.[wk]?.[eid]?.[di] || null;

  async function setShift(wk, eid, di, shift, empName) {
    const emp = employees.find(e=>e.id===eid);
    const name = empName || emp?.name || "Unknown";
    const dayLabel = DAY_FULL[di] || "Day " + di;

    // Update local state immediately (optimistic)
    setSchedule(p => {
      const n = JSON.parse(JSON.stringify(p));
      if (!n[wk]) n[wk] = {};
      if (!n[wk][eid]) n[wk][eid] = {};
      if (shift === null) {
        delete n[wk][eid][di];
        addAudit("Shift Removed", name + " — " + dayLabel, { empName:name });
      } else {
        const isNew = !p?.[wk]?.[eid]?.[di];
        n[wk][eid][di] = shift;
        addAudit(isNew ? "Shift Added" : "Shift Updated",
          name + " — " + dayLabel + ": " + fmt(shift.start) + " – " + fmt(shift.end),
          { empName:name });
      }
      return n;
    });

    // Persist to Supabase
    if (!bizId) return;
    try {
      // Ensure week exists in DB, create if not
      let weekId = weekMap[wk];
      if (!weekId) {
        const rows = await dbUpsert("schedule_weeks", [{ business_id:bizId, week_start:wk, label:"Week" }]);
        weekId = rows?.[0]?.id;
        if (weekId) setWeekMap(p => ({...p, [wk]: weekId}));
      }
      if (!weekId) return;

      if (shift === null) {
        await dbDelete("shifts?week_id=eq." + weekId + "&employee_id=eq." + eid + "&day_index=eq." + di);
      } else {
        await dbUpsert("shifts", [{
          business_id:  bizId,
          week_id:      weekId,
          employee_id:  eid,
          day_index:    di,
          start_dec:    shift.start,
          end_dec:      shift.end,
          shift_types:  Array.isArray(shift.type) ? shift.type : [shift.type || "regular"],
          notes:        shift.notes || "",
        }]);
      }
    } catch(e) { console.warn("Shift save failed:", e); }
  }

  function toggleShift(wk,eid,di) {
    if (getShift(wk,eid,di)) { setShift(wk,eid,di,null); setOpenCell(null); return; }
    const emp = employees.find(e=>e.id===eid);
    const availDays = emp?.availableDays ?? [0,1,2,3,4,5,6];
    if (!availDays.includes(di)) { showToast(`${emp?.name||"Employee"} is unavailable on ${DAY_FULL[di]}s`); return; }
    setOpenCell({ empId:eid, weekKey:wk, dayIdx:di, isNew:true });
  }

  function changeWkStart(oldKey, newKey, setKey) {
    setSchedule(p => { const n=JSON.parse(JSON.stringify(p)); if(p[oldKey]){n[newKey]=p[oldKey];delete n[oldKey];} return n; });
    if (activeWeek===oldKey) setActiveWeek(newKey);
    if (printWeek===oldKey)  setPrintWeek(newKey);
    setKey(newKey);
  }

  function doCopyWeek(from,to) {
    const fromLabel = weeks.find(w=>w.key===from)?.label || from;
    const toLabel = weeks.find(w=>w.key===to)?.label || to;
    setSchedule(p => { const n=JSON.parse(JSON.stringify(p)); n[to]=JSON.parse(JSON.stringify(p[from]||{})); return n; });
    addAudit("Week Copied", `${fromLabel} → ${toLabel}`);
  }

  const eDayH = (wk,eid,di) => shiftHrs(getShift(wk,eid,di));
  const eWkH  = (wk,eid)    => DAYS.reduce((s,_,i)=>s+eDayH(wk,eid,i),0);
  const eWkP  = (wk,emp)    => eWkH(wk,emp.id)*(parseFloat(emp.hourlyRate)||0);
  const eTotalH = eid => weeks.reduce((s,w)=>s+eWkH(w.key,eid),0);
  const eTotalP = emp => weeks.reduce((s,w)=>s+eWkP(w.key,emp),0);

  const grandPay    = useMemo(()=>employees.reduce((s,e)=>s+eTotalP(e),0),   [employees,schedule,weeks]);
  const grandHrs    = useMemo(()=>employees.reduce((s,e)=>s+eTotalH(e.id),0),[employees,schedule,weeks]);
  const activeWkPay = useMemo(()=>activeWeek?employees.reduce((s,e)=>s+eWkP(activeWeek,e),0):0,[employees,schedule,activeWeek]);

  async function addEmp() {
    if (!bizId) return;
    const color = COLORS[employees.length % COLORS.length];
    try {
      const rows = await dbPost("employees", {
        business_id:     bizId,
        name:            "",
        role:            "",
        hourly_rate:     0,
        color,
        pin:             "",
        available_days:  [0,1,2,3,4,5,6],
        available_hours: 40,
        notes:           "",
        sort_order:      employees.length,
      });
      const newEmp = rows?.[0];
      if (!newEmp) return;
      const appEmp = { id:newEmp.id, name:"", role:"", hourlyRate:"", color, pin:"", availableDays:[0,1,2,3,4,5,6], availableHours:"40", notes:"" };
      setEmployees(p=>[...p, appEmp]);
      setEditEmpId(newEmp.id);
      addAudit("Employee Added", "New employee created — name pending");
    } catch(e) { showToast("Could not add employee: " + e.message); }
  }

  const updEmp = (id, f) => {
    const emp = employees.find(e=>e.id===id);
    if (f.name && emp && f.name !== emp.name) addAudit("Employee Updated", `Name changed: ${emp.name||"(unnamed)"} → ${f.name}`, {empName:f.name});
    if (f.hourlyRate && emp && f.hourlyRate !== emp.hourlyRate) addAudit("Employee Updated", `${emp.name||"Employee"} rate changed`, {empName:emp.name});
    setEmployees(p=>p.map(e=>e.id===id?{...e,...f}:e));
    // Persist to Supabase — map app field names to DB column names
    const dbFields = {};
    if (f.name           !== undefined) dbFields.name            = f.name;
    if (f.role           !== undefined) dbFields.role            = f.role;
    if (f.hourlyRate     !== undefined) dbFields.hourly_rate     = parseFloat(f.hourlyRate)||0;
    if (f.color          !== undefined) dbFields.color           = f.color;
    if (f.pin            !== undefined) dbFields.pin             = f.pin;
    if (f.availableDays  !== undefined) dbFields.available_days  = f.availableDays;
    if (f.availableHours !== undefined) dbFields.available_hours = parseFloat(f.availableHours)||40;
    if (f.notes          !== undefined) dbFields.notes           = f.notes;
    if (Object.keys(dbFields).length > 0) {
      dbPatch(`employees?id=eq.${id}`, dbFields).catch(e => console.warn("Employee update failed:", e));
    }
  };

  async function rmEmp(id) {
    const emp = employees.find(e=>e.id===id);
    addAudit("Employee Removed", emp?.name || "Unknown employee", {empName:emp?.name});
    setEmployees(p=>p.filter(e=>e.id!==id));
    setSchedule(p=>{ const n=JSON.parse(JSON.stringify(p)); Object.keys(n).forEach(wk=>delete n[wk][id]); return n; });
    if(editEmpId===id) setEditEmpId(null);
    // Supabase: cascades to shifts automatically via foreign key
    dbDelete(`employees?id=eq.${id}`).catch(e => console.warn("Employee delete failed:", e));
  }

  function getTodayShift(empId) {
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];
    const todayIdx = now.getDay();
    for (const wk of weeks) {
      // Verify this week actually contains today's date before checking shifts
      const wkDates = wk.dates.map(d => {
        const dt = typeof d === "string" ? new Date(d+"T00:00:00") : d;
        return dt.toISOString().split("T")[0];
      });
      if (!wkDates.includes(todayStr)) continue; // week doesn't contain today
      const shift = getShift(wk.key, empId, todayIdx);
      if (shift) return { shift, weekKey: wk.key, dayIdx: todayIdx };
    }
    return null;
  }

  function nowDecimal() {
    const n = new Date();
    return n.getHours() + n.getMinutes() / 60;
  }

  function lastPunch(empId) {
    const emp_punches = punches.filter(p => p.empId === empId);
    return emp_punches.length ? emp_punches[emp_punches.length - 1] : null;
  }

  function processPunch(emp, action) {
    const now = new Date();
    const nowDec = nowDecimal();
    const todayData = getTodayShift(emp.id);
    const punchType = action;
    const flags = [];

    if (punchType === "in" || punchType === "break_in") {
      if (!todayData) {
        flags.push("NO_SHIFT");
        var message = "No shift scheduled today — punch recorded and flagged for review.";
      } else {
        const { shift } = todayData;
        const minsEarly = (shift.start - nowDec) * 60;
        if (minsEarly > 5) {
          const minsStr = Math.round(minsEarly);
          return { ok:false, blocked:true, message:`Too early to clock in. Your shift starts at ${fmt(shift.start)}. Please try again in ${minsStr} minute${minsStr!==1?"s":""}.`, flags:[] };
        }
        if (minsEarly > 0) flags.push("EARLY");
        if (nowDec > shift.start + 0.25) flags.push("LATE");
        var message = flags.includes("EARLY") ? `Clocked in slightly early. Shift starts at ${fmt(shift.start)}.`
          : flags.includes("LATE") ? `Clocked in late. Shift started at ${fmt(shift.start)}.`
          : `Clocked in. Shift: ${fmt(shift.start)} – ${fmt(shift.end)}.`;
      }
    } else {
      if (punchType === "break_out") { var message = "Break started. Enjoy your break!"; }
      else if (punchType === "break_in") { var message = "Welcome back from your break!"; }
      else {
        if (todayData) { const { shift } = todayData; if (nowDec < shift.end - 0.25) flags.push("EARLY_OUT"); }
        var message = "Clocked out. Have a great rest of your day!";
      }
    }

    const punch = { id:Date.now().toString(), empId:emp.id, empName:emp.name, type:punchType, time:now.toISOString(), weekKey:todayData?.weekKey??null, dayIdx:todayData?.dayIdx??null, scheduled:todayData?.shift??null, flags };
    setPunches(p => [...p, punch]);
    // Write to Supabase
    if (bizId) {
      dbPost("punches", { business_id:bizId, employee_id:emp.id, employee_name:emp.name, punch_type:punchType, punched_at:punch.time, scheduled_start:todayData?.shift?.start||null, scheduled_end:todayData?.shift?.end||null, flags:punch.flags })
        .catch(e => console.warn("Punch write failed:", e));
    }
    return { ok:true, blocked:false, message, flags, punchType };
  }

  function getMissedPunches() {
    const missed = [];
    const now = new Date();
    const nowDec = nowDecimal();
    employees.forEach(emp => {
      const last = lastPunch(emp.id);
      if (last && last.type === "in" && last.scheduled) {
        const shiftEndDec = last.scheduled.end;
        const punchDate = new Date(last.time);
        const isToday = punchDate.toDateString() === now.toDateString();
        if (isToday && nowDec > shiftEndDec + 0.5) {
          missed.push({ emp, lastPunch: last, missedAt: fmt(shiftEndDec) });
        }
      }
    });
    return missed;
  }

  function saveTemplate(name) {
    if (!name?.trim()) return;
    const tpl = { id:Date.now().toString(), name:name.trim(), savedAt:new Date().toISOString(), scheduleData:JSON.parse(JSON.stringify(schedule)), employeeSnapshot:JSON.parse(JSON.stringify(employees)) };
    setTemplates(p => [tpl, ...p]);
    addAudit("Template Saved", `"${tpl.name}"`);
    showToast(`Template "${tpl.name}" saved ✓`);
  }

  function applyTemplate(tpl) {
    const n = JSON.parse(JSON.stringify(schedule));
    weeks.forEach((wk, wi) => {
      const srcKeys = Object.keys(tpl.scheduleData);
      const srcKey = srcKeys[wi] || srcKeys[0];
      if (!srcKey) return;
      if (!n[wk.key]) n[wk.key] = {};
      employees.forEach(emp => {
        const srcEmp = tpl.employeeSnapshot.find(e => e.name === emp.name);
        if (srcEmp && tpl.scheduleData[srcKey]?.[srcEmp.id]) {
          n[wk.key][emp.id] = JSON.parse(JSON.stringify(tpl.scheduleData[srcKey][srcEmp.id]));
        }
      });
    });
    setSchedule(n);
    addAudit("Template Applied", `"${tpl.name}"`);
    showToast(`Template "${tpl.name}" applied ✓`);
  }

  async function publishSchedule() {
    const w1d=weekDatesFromSunday(wk1Start), w2d=weekDatesFromSunday(wk2Start);
    const label = weekMode==="2" ? `${dl(w1d[0])} – ${dl(w2d[6])}` : `${dl(w1d[0])} – ${dl(w1d[6])}`;
    const entry = { id:Date.now().toString(), publishedAt:new Date().toISOString(), label, wk1Start,wk2Start,weekMode, scheduleData:JSON.parse(JSON.stringify(schedule)), employeeSnapshot:JSON.parse(JSON.stringify(employees)), budget:weeklyBudget };
    addAudit("Schedule Published", "Published: " + label);
    setPublished(p=>[entry,...p]);
    showToast("Schedule published ✓",3500);
    // Write to Supabase
    if (bizId) {
      dbPost("published_schedules", { business_id:bizId, label, week_start:wk1Start, schedule_data:entry.scheduleData, employee_snapshot:entry.employeeSnapshot, budget:parseFloat(weeklyBudget)||null })
        .catch(e => console.warn("Publish write failed:", e));
    }
  }

  function loadPublished(entry) {
    setSchedule(JSON.parse(JSON.stringify(entry.scheduleData)));
    setWk1Start(entry.wk1Start); setWk2Start(entry.wk2Start);
    setWeekMode(entry.weekMode); setActiveWeek(entry.wk1Start);
    setHistoryOpen(false); showToast("Schedule loaded — edit then re-publish when ready",4000);
  }

  function applyPattern(entry) {
    const n=JSON.parse(JSON.stringify(schedule));
    weeks.forEach((wk,wi)=>{
      const src=wi===0?entry.wk1Start:entry.wk2Start;
      if(!n[wk.key]) n[wk.key]={};
      employees.forEach(emp=>{
        const se=entry.employeeSnapshot.find(e=>e.name===emp.name);
        if(se&&entry.scheduleData?.[src]?.[se.id]) n[wk.key][emp.id]=JSON.parse(JSON.stringify(entry.scheduleData[src][se.id]));
      });
    });
    setSchedule(n); setHistoryOpen(false);
    showToast("Shift pattern applied — review and publish when ready",4000);
  }

  function handlePrint() {
    // Printing from inside a sandboxed artifact iframe requires the user
    // to use their browser's native print. Export to JSON then print from
    // the exported view, or use Cmd+P / Ctrl+P with the preview visible.
    showToast("Right-click the schedule preview → Print, or use Cmd+P / Ctrl+P", 6000);
  }

  const decToTime = v => { if(v==null) return ""; const h=Math.floor(v),m=Math.round((v-h)*60); return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`; };
  const timeToDec = t => { if(!t) return null; const [h,m]=t.split(":").map(Number); return h+m/60; };

  // Generate 15-minute interval time options for the full day
  const TIME_OPTIONS = (() => {
    const opts = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 15) {
        const hh = String(h).padStart(2,"0");
        const mm = String(m).padStart(2,"0");
        const val = `${hh}:${mm}`;
        const hr = h % 12 === 0 ? 12 : h % 12;
        const label = `${hr}:${mm} ${h < 12 ? "AM" : "PM"}`;
        opts.push({ val, label });
      }
    }
    return opts;
  })();
  const editEmp = employees.find(e=>e.id===editEmpId);

  function TimePickerModal() {
    const [draft,setDraft] = useState(null);
    useEffect(()=>{
      if(!openCell){setDraft(null);return;}
      const {empId,weekKey,dayIdx,isNew}=openCell;
      const ex=getShift(weekKey,empId,dayIdx);
      if(ex) setDraft({start:decToTime(ex.start),end:decToTime(ex.end),type:toTypeArr(ex.type),notes:ex.notes||""});
      else if(isNew) setDraft({start:"",end:"",type:["regular"],notes:""});
    },[openCell?.empId,openCell?.weekKey,openCell?.dayIdx]);

    if(!openCell||!draft) return null;
    const {empId,weekKey,dayIdx}=openCell;
    const emp=employees.find(e=>e.id===empId); if(!emp) return null;
    const sd=draft.start?timeToDec(draft.start):null, ed=draft.end?timeToDec(draft.end):null;
    const h=(sd!=null&&ed!=null)?Math.max(0,parseFloat((ed-sd).toFixed(2))):0;
    const pay=h*(parseFloat(emp.hourlyRate)||0);
    const canSave=draft.start&&draft.end&&ed>sd;
    const existing=getShift(weekKey,empId,dayIdx);

    function save() {
      if(!canSave) return;
      const shiftData = {start:sd, end:ed, type:draft.type.length?draft.type:["regular"], notes:draft.notes||""};
      // Save to primary day
      setShift(weekKey, empId, dayIdx, shiftData);
      // Copy to additional selected days
      if ((draft.applyToDays||[]).length > 0) {
        setSchedule(prev => {
          const n = JSON.parse(JSON.stringify(prev));
          if (!n[weekKey]) n[weekKey] = {};
          if (!n[weekKey][empId]) n[weekKey][empId] = {};
          (draft.applyToDays||[]).forEach(di => { n[weekKey][empId][di] = {...shiftData}; });
          return n;
        });
        addAudit("Shift Copied to Days",
          `${emp.name} — same shift applied to ${(draft.applyToDays||[]).map(d=>DAY_FULL[d]).join(", ")}`,
          {empName: emp.name}
        );
        showToast(`Shift saved + copied to ${(draft.applyToDays||[]).length} day${(draft.applyToDays||[]).length!==1?"s":""} ✓`, 3500);
      }
      setOpenCell(null);
    }
    function remove() { setShift(weekKey,empId,dayIdx,null); setOpenCell(null); }

    return (
      <div onClick={()=>setOpenCell(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
        <div onClick={e=>e.stopPropagation()} style={{background:"white",borderRadius:"20px 20px 0 0",padding:"20px 20px calc(20px + env(safe-area-inset-bottom,0px))",width:"100%",maxWidth:500,boxShadow:"0 -12px 48px rgba(0,0,0,0.2)",borderTop:`4px solid ${emp.color}`}}>
          <div style={{width:36,height:4,borderRadius:2,background:"#E0DAD2",margin:"0 auto 16px"}}/>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:38,height:38,borderRadius:"50%",background:emp.color,display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:800,fontSize:15,flexShrink:0}}>
                {emp.name?emp.name[0].toUpperCase():"?"}
              </div>
              <div>
                <div style={{fontWeight:800,fontSize:16,color:T.text}}>{emp.name}</div>
                <div style={{fontSize:12,color:T.sub}}>{DAY_FULL[dayIdx]}</div>
              </div>
            </div>
            <button onClick={()=>setOpenCell(null)} style={{background:T.muted,border:"none",borderRadius:"50%",width:34,height:34,fontSize:20,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
            {[["Start Time","start"],["End Time","end"]].map(([lbl,field])=>{
              // Parse "HH:MM" → decimal; format decimal → "HH:MM"
              const valDec = draft[field] ? timeToDec(draft[field]) : null;

              // Snap a decimal to nearest 15-min increment
              const snapTo15 = v => Math.round(v * 4) / 4;

              // Format decimal to display string "9:30 AM"
              const fmtDisplay = v => {
                if (v == null) return "";
                const h = Math.floor(v), m = Math.round((v - h) * 60);
                const hr = h % 12 === 0 ? 12 : h % 12;
                const mm = String(m).padStart(2,"0");
                return hr + ":" + mm + " " + (h < 12 ? "AM" : "PM");
              };

              // Parse typed input → "HH:MM" 24h string or null
              function parseTyped(raw) {
                const s = raw.trim().toUpperCase();
                // Patterns: "9:30 AM", "930am", "9:30", "930", "9am", "9"
                let h, m = 0, pm = false;
                const ampm = s.includes("AM") ? "AM" : s.includes("PM") ? "PM" : null;
                const digits = s.replace(/[^0-9:]/g,"");
                if (digits.includes(":")) {
                  const parts = digits.split(":");
                  h = parseInt(parts[0]||"0");
                  m = parseInt(parts[1]||"0");
                } else if (digits.length <= 2) {
                  h = parseInt(digits||"0"); m = 0;
                } else if (digits.length === 3) {
                  h = parseInt(digits[0]); m = parseInt(digits.slice(1));
                } else {
                  h = parseInt(digits.slice(0,2)); m = parseInt(digits.slice(2,4));
                }
                if (ampm === "PM" && h !== 12) h += 12;
                if (ampm === "AM" && h === 12) h = 0;
                // If no AM/PM and h < 7, assume PM (e.g. "3" → 3 PM)
                if (!ampm && h >= 1 && h <= 6) h += 12;
                m = Math.round(m / 15) * 15; // snap to 15
                if (m === 60) { m = 0; h += 1; }
                if (h < 0 || h > 23 || m < 0 || m > 59 || isNaN(h) || isNaN(m)) return null;
                return String(h).padStart(2,"0") + ":" + String(m).padStart(2,"0");
              }

              function handleBlur(e) {
                const parsed = parseTyped(e.target.value);
                setDraft(d => ({...d, [field]: parsed || d[field] || ""}));
              }

              function handleKeyDown(e) {
                if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                e.preventDefault();
                // Scroll in 30-min increments
                const step = 0.5;
                const current = valDec != null ? valDec : (field === "start" ? 9 : 17);
                const next = Math.max(0, Math.min(23.75, current + (e.key === "ArrowUp" ? step : -step)));
                const snapped = snapTo15(next);
                const hh = Math.floor(snapped);
                const mm = Math.round((snapped - hh) * 60);
                setDraft(d => ({...d, [field]: String(hh).padStart(2,"0") + ":" + String(mm).padStart(2,"0")}));
              }

              return (
                <div key={field}>
                  <label style={{fontSize:11,fontWeight:700,color:T.sub,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em"}}>{lbl}</label>
                  <div style={{position:"relative"}}>
                    <input
                      type="text"
                      placeholder="e.g. 9:00 AM"
                      defaultValue={draft[field] ? fmtDisplay(valDec) : ""}
                      key={field + (draft[field]||"none")}
                      onBlur={handleBlur}
                      onKeyDown={handleKeyDown}
                      style={{
                        width:"100%",
                        border:`2px solid ${draft[field] ? emp.color : T.border}`,
                        borderRadius:10,
                        padding:"11px 10px 11px 10px",
                        fontSize:15,
                        fontWeight:700,
                        outline:"none",
                        background:"white",
                        color:draft[field] ? T.text : "#aaa",
                        textAlign:"center",
                        transition:"border 0.15s",
                      }}
                    />
                    {/* Up / Down nudge buttons — 30-min steps */}
                    <div style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",display:"flex",flexDirection:"column",gap:1}}>
                      {["▲","▼"].map((arrow, ai) => (
                        <button key={arrow} type="button"
                          onMouseDown={e=>{ e.preventDefault();
                            const step = 0.5;
                            const current = valDec != null ? valDec : (field==="start"?9:17);
                            const next = Math.max(0, Math.min(23.75, current + (ai===0?step:-step)));
                            const snapped = snapTo15(next);
                            const hh = Math.floor(snapped);
                            const mm = Math.round((snapped-hh)*60);
                            setDraft(d=>({...d,[field]:String(hh).padStart(2,"0")+":"+String(mm).padStart(2,"0")}));
                          }}
                          style={{background:"none",border:"none",cursor:"pointer",padding:"1px 3px",fontSize:9,color:T.sub,lineHeight:1,opacity:0.7}}>
                          {arrow}
                        </button>
                      ))}
                    </div>
                  </div>
                  {draft[field] && <div style={{fontSize:10,color:T.sub,marginTop:4,textAlign:"center"}}>{fmtDisplay(valDec)}</div>}
                </div>
              );
            })}
          </div>
          {draft.start&&draft.end&&!canSave&&(
            <div style={{background:"#FEF3E2",border:"1px solid #F39C12",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:"#E67E22",fontWeight:600}}>End time must be after start time</div>
          )}
          {canSave&&(
            <div style={{background:T.muted,borderRadius:10,padding:"12px 16px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><div style={{fontSize:10,color:T.sub,marginBottom:2,textTransform:"uppercase",letterSpacing:"0.05em"}}>Hours</div>
                <div style={{fontWeight:800,fontSize:30,color:emp.color,lineHeight:1}}>{h}h</div></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:10,color:T.sub,marginBottom:2,textTransform:"uppercase",letterSpacing:"0.05em"}}>Est. Pay</div>
                <div style={{fontWeight:800,fontSize:22,color:T.text}}>${pay.toFixed(2)}</div></div>
            </div>
          )}
          <div style={{marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}>
              <label style={{fontSize:11,fontWeight:700,color:T.sub,textTransform:"uppercase",letterSpacing:"0.05em"}}>Shift Type</label>
              <span style={{fontSize:10,color:T.sub}}>{draft.type.length>1?`${draft.type.length} selected`:"Tap to select · select multiple"}</span>
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {SHIFT_TYPES.map(st=>{
                const selected = draft.type.includes(st.id);
                return (
                  <button key={st.id} onClick={()=>setDraft(d=>{
                    const curr = toTypeArr(d.type);
                    const next = selected ? (curr.filter(t=>t!==st.id).length ? curr.filter(t=>t!==st.id) : curr) : [...curr, st.id];
                    return {...d, type:next};
                  })} style={{
                    background:selected?st.color:T.muted, color:selected?"white":T.sub,
                    border:`2px solid ${selected?st.color:"transparent"}`,
                    borderRadius:8, padding:"6px 13px", fontSize:12, fontWeight:700,
                    cursor:"pointer", transition:"all 0.12s",
                    boxShadow:selected?`0 2px 8px ${st.color}44`:"none",
                  }}>
                    {selected && <span style={{marginRight:4,fontSize:10}}>✓</span>}{st.label}
                  </button>
                );
              })}
            </div>
            {draft.type.length > 1 && (
              <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:8}}>
                {draft.type.map(tid=>{
                  const st = SHIFT_TYPES.find(s=>s.id===tid);
                  return st ? <span key={tid} style={{background:st.color+"22",color:st.color,border:`1px solid ${st.color}44`,borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700}}>{st.label}</span> : null;
                })}
              </div>
            )}
          </div>
          <div style={{marginBottom:16}}>
            <label style={{fontSize:11,fontWeight:700,color:T.sub,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em"}}>Notes <span style={{fontWeight:400,textTransform:"none"}}>(optional)</span></label>
            <textarea value={draft.notes} onChange={e=>setDraft(d=>({...d,notes:e.target.value}))} rows={2}
              placeholder="e.g. Key holder, cover register from open..."
              style={{width:"100%",border:`1.5px solid ${T.border}`,borderRadius:10,padding:"10px 12px",fontSize:13,outline:"none",resize:"none",fontFamily:"inherit",color:T.text,background:"white"}}/>
          </div>

          {/* ── Apply to multiple days ── */}
          {canSave && (
            <div style={{marginBottom:16,padding:"12px 14px",background:T.muted,borderRadius:10,border:`1px solid ${T.border}`}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                <label style={{fontSize:11,fontWeight:700,color:T.sub,textTransform:"uppercase",letterSpacing:"0.05em"}}>
                  Also apply to
                </label>
                <span style={{fontSize:10,color:T.sub}}>Copy this shift to other days</span>
              </div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                {DAYS.map((day, di) => {
                  if (di === dayIdx) return null; // skip current day
                  const availDays = emp.availableDays ?? [0,1,2,3,4,5,6];
                  const isAvail = availDays.includes(di);
                  const alreadyHasShift = !!getShift(weekKey, emp.id, di);
                  const isSelected = (draft.applyToDays || []).includes(di);
                  return (
                    <button key={di}
                      disabled={!isAvail}
                      onClick={()=>{
                        setDraft(d => {
                          const curr = d.applyToDays || [];
                          return {...d, applyToDays: isSelected ? curr.filter(d=>d!==di) : [...curr, di]};
                        });
                      }}
                      style={{
                        width:38, height:38, borderRadius:8, fontSize:11, fontWeight:700,
                        cursor: isAvail ? "pointer" : "not-allowed",
                        opacity: !isAvail ? 0.3 : 1,
                        border: isSelected ? "none" : `1.5px solid ${alreadyHasShift ? "#E8A93A" : T.border}`,
                        background: isSelected ? emp.color : alreadyHasShift ? "#FEF3E2" : T.surface,
                        color: isSelected ? "white" : alreadyHasShift ? "#E8A93A" : T.sub,
                        position:"relative", transition:"all 0.12s",
                      }}>
                      {day.slice(0,2)}
                      {alreadyHasShift && !isSelected && (
                        <span style={{position:"absolute",top:1,right:2,fontSize:7,color:"#E8A93A"}}>●</span>
                      )}
                    </button>
                  );
                })}
              </div>
              {(draft.applyToDays||[]).length > 0 && (
                <div style={{fontSize:10,color:T.sub,marginTop:7}}>
                  Will copy to: <strong style={{color:emp.color}}>{(draft.applyToDays||[]).map(d=>DAYS[d]).join(", ")}</strong>
                  {(draft.applyToDays||[]).some(d=>getShift(weekKey,emp.id,d)) &&
                    <span style={{color:"#E8A93A",marginLeft:6}}>⚠ existing shifts will be overwritten</span>}
                </div>
              )}
            </div>
          )}

          <div style={{display:"grid",gridTemplateColumns:existing?"1fr 2fr":"1fr",gap:10}}>
            {existing&&<button onClick={remove} style={{background:"#FDECEA",color:"#C0392B",border:"none",borderRadius:10,padding:"13px 0",fontSize:13,fontWeight:700,cursor:"pointer"}}>Remove</button>}
            <button onClick={save} disabled={!canSave} style={{background:canSave?emp.color:"#DDD",color:canSave?"white":"#aaa",border:"none",borderRadius:10,padding:"13px 0",fontSize:14,fontWeight:700,cursor:canSave?"pointer":"not-allowed",transition:"background 0.15s"}}>
              {canSave ? ((draft.applyToDays||[]).length > 0 ? `Save + Apply to ${(draft.applyToDays||[]).length} day${(draft.applyToDays||[]).length!==1?"s":""}` : "Save Shift ✓") : "Select times to save"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const TABS = [
    {key:"grid",        icon:"📋", label:"Schedule"},
    {key:"coverage",    icon:"🚨", label:"Coverage"},
    {key:"insights",    icon:"🧠", label:"Insights"},
    {key:"payroll",     icon:"💵", label:"Payroll"},
    {key:"recognition", icon:"⭐", label:"Team"},
    {key:"settings",    icon:"⚙️", label:"Settings"},
  ];

  // ── LOGIN SCREEN ───────────────────────────────────────────────────────────
  if (authState === "unauthenticated") {
    return (
      <div style={{minHeight:"100vh",background:"#0A0F0A",display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:"'Inter',system-ui,sans-serif"}}>
        <style>{CSS}</style>
        <div style={{width:"100%",maxWidth:400}}>
          {/* Logo */}
          <div style={{textAlign:"center",marginBottom:32}}>
            <div style={{width:56,height:56,background:"#2D6A4F",borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,margin:"0 auto 16px"}}>📅</div>
            <div style={{fontSize:26,fontWeight:900,color:"white",letterSpacing:"-0.01em"}}>ShiftWise</div>
            <div style={{fontSize:13,color:"#4B5563",marginTop:4}}>Schedule smarter. Run better.</div>
          </div>

          {/* Card */}
          <div style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:18,padding:"28px 28px 24px"}}>
            {/* Tab switcher */}
            <div style={{display:"flex",background:"rgba(0,0,0,0.3)",borderRadius:10,padding:4,marginBottom:24}}>
              {[["signin","Sign In"],["signup","Create Account"]].map(([m,lbl])=>(
                <button key={m} onClick={()=>{setAuthMode(m);setAuthError("");}}
                  style={{flex:1,background:authMode===m?"white":"transparent",color:authMode===m?"#1C1C1C":"#6B7280",border:"none",borderRadius:7,padding:"9px 0",fontWeight:700,fontSize:13,cursor:"pointer",transition:"all 0.15s"}}>
                  {lbl}
                </button>
              ))}
            </div>

            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {authMode==="signup" && (
                <input value={authBizName} onChange={e=>setAuthBizName(e.target.value)}
                  placeholder="Business name"
                  style={{width:"100%",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"13px 14px",fontSize:15,color:"white",outline:"none",boxSizing:"border-box"}}/>
              )}
              <input value={authEmail} onChange={e=>setAuthEmail(e.target.value)}
                placeholder="Email address" type="email"
                onKeyDown={e=>e.key==="Enter"&&(authMode==="signin"?handleSignIn():handleSignUp())}
                style={{width:"100%",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"13px 14px",fontSize:15,color:"white",outline:"none",boxSizing:"border-box"}}/>
              <input value={authPass} onChange={e=>setAuthPass(e.target.value)}
                placeholder="Password" type="password"
                onKeyDown={e=>e.key==="Enter"&&(authMode==="signin"?handleSignIn():handleSignUp())}
                style={{width:"100%",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"13px 14px",fontSize:15,color:"white",outline:"none",boxSizing:"border-box"}}/>

              {authError && (
                <div style={{background:"rgba(239,68,68,0.15)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#F87171",lineHeight:1.5}}>
                  {authError}
                </div>
              )}

              <button onClick={authMode==="signin"?handleSignIn:handleSignUp}
                style={{width:"100%",background:"#2D6A4F",color:"white",border:"none",borderRadius:10,padding:"14px 0",fontWeight:800,fontSize:15,cursor:"pointer",marginTop:4}}>
                {authMode==="signin" ? "Sign In" : "Create Account"}
              </button>
            </div>
          </div>

          <div style={{textAlign:"center",marginTop:20,fontSize:11,color:"#374151",lineHeight:1.6}}>
            Your data is stored securely in Supabase.<br/>
            Schedule, payroll, and team data sync across all your devices.
          </div>
        </div>
      </div>
    );
  }

  // ── LOADING SCREEN ──────────────────────────────────────────────────────────
  if (authState === "loading") {
    return (
      <div style={{minHeight:"100vh",background:"#0A0F0A",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,fontFamily:"'Inter',system-ui,sans-serif"}}>
        <style>{CSS}</style>
        <div style={{width:36,height:36,border:"3px solid rgba(45,106,79,0.3)",borderTopColor:"#2D6A4F",borderRadius:"50%",animation:"spin 0.9s linear infinite"}}/>
        <div style={{color:"#4B5563",fontSize:13,fontWeight:600}}>Loading your schedule…</div>
        <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      </div>
    );
  }

  return (
    <div style={{minHeight:"100vh",background:T.bg,color:T.text}}>
      <style>{CSS}</style>

        {/* TOP BAR */}
        <div style={{background:T.dark,position:"sticky",top:0,zIndex:400,borderBottom:"1px solid #2A2A2A"}}>
          <div className="top-bar-inner" style={{maxWidth:1400,margin:"0 auto",display:"flex",alignItems:"center",gap:14,height:54,padding:"0 18px"}}>
            <div style={{display:"flex",alignItems:"center",gap:9,flexShrink:0}}>
              <div style={{width:30,height:30,background:T.accent,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,flexShrink:0}}>📅</div>
              <input className="biz-input" value={biz} onChange={e=>setBiz(e.target.value)}
                style={{background:"transparent",border:"none",color:"white",fontSize:15,fontWeight:700,outline:"none",width:180}}
                onBlur={()=>{ saveBizSettings({name:biz}); showToast("Business name saved ✓"); }}/>
            </div>
            <div className="top-bar-tabs" style={{display:"flex",gap:2,flex:1,overflow:"hidden",minWidth:0}}>
              {TABS.map(t=>(
                <button key={t.key} onClick={()=>setTab(t.key)} className="nav-tab-btn" style={{
                  background:tab===t.key?T.accent:"transparent",
                  color:tab===t.key?"white":"#888",
                  border:"none",borderRadius:7,padding:"7px 16px",
                  cursor:"pointer",fontWeight:600,fontSize:12,whiteSpace:"nowrap",transition:"all 0.15s"
                }}>{t.icon} {t.label}</button>
              ))}
            </div>
            <div className="top-stats" style={{display:"flex",alignItems:"center",gap:8,flexShrink:0,minWidth:0}}>

              <span style={{fontSize:12,color:"#888",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:180}}>
                <span style={{color:T.accent,fontWeight:700}}>${grandPay.toFixed(0)}</span>
                {" · "}{grandHrs}h · {employees.length} staff
              </span>
              <button onClick={exportData} style={{background:"rgba(255,255,255,0.08)",color:"#bbb",border:"1px solid rgba(255,255,255,0.12)",borderRadius:7,padding:"5px 11px",fontSize:11,fontWeight:700,cursor:"pointer"}}>Export</button>

              {/* 🔔 Alert Bell */}
{(()=>{
  const unreviewed = punches.filter(p => p.flags?.length > 0 && !punchReviews[p.id]).length;
  return (
    <button onClick={()=>setAlertsOpen(p=>!p)}
      style={{position:"relative",background:"transparent",border:"none",cursor:"pointer",padding:"4px 6px",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <span style={{fontSize:20,lineHeight:1}}>🔔</span>
      {unreviewed > 0 && (
        <span style={{position:"absolute",top:0,right:0,background:"#C0392B",color:"white",borderRadius:"50%",width:16,height:16,fontSize:9,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",border:"2px solid #1C2B22"}}>
          {unreviewed > 9 ? "9+" : unreviewed}
        </span>
      )}
    </button>
  );
})()}
              <button onClick={handleSignOut} style={{background:"rgba(255,255,255,0.05)",color:"#666",border:"1px solid rgba(255,255,255,0.08)",borderRadius:7,padding:"5px 11px",fontSize:11,fontWeight:700,cursor:"pointer"}} title="Sign Out">⎋</button>
              <label style={{background:"rgba(255,255,255,0.08)",color:"#bbb",border:"1px solid rgba(255,255,255,0.12)",borderRadius:7,padding:"5px 11px",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                Import<input type="file" accept=".json" onChange={e=>{importData(e.target.files[0]);e.target.value="";}} style={{display:"none"}}/>
              </label>
            </div>
          </div>
        </div>

        {/* MOBILE SUMMARY STRIP */}
        {tab==="grid"&&(
          <div style={{display:"none"}} className="mobile-summary-strip">
            <style>{".mobile-summary-strip{display:none!important} @media(max-width:767px){.mobile-summary-strip{display:flex!important;background:#1C1C1C;padding:7px 16px;gap:16px;justify-content:space-between;align-items:center;border-bottom:1px solid #2A2A2A}}"}</style>
            <span style={{fontSize:11,color:"#888"}}><span style={{color:T.accent,fontWeight:700}}>${activeWkPay.toFixed(0)}</span> est. this wk</span>
            {weeklyBudget&&(()=>{const b=parseFloat(weeklyBudget)||0,s=activeWkPay,over=s>b,pct=b>0?Math.min((s/b)*100,100):0;return <span style={{fontSize:11,color:over?"#C0392B":pct>85?"#E8A93A":"#4CAF7D",fontWeight:700}}>{over?`$${(s-b).toFixed(0)} over`:`$${(b-s).toFixed(0)} left`}</span>})()}
            <span style={{fontSize:11,color:"#888"}}>{employees.length} staff</span>
          </div>
        )}

        {/* PAGE CONTENT */}
        <div className="page-pad" style={{maxWidth:1400,margin:"0 auto",padding:"18px 16px 28px"}}>

          {/* SCHEDULE GRID */}
          {tab==="grid" && (
            <div>
              {/* Schedule / Timesheet sub-tabs */}
<div style={{display:"flex",gap:6,marginBottom:14}}>
  {[["schedule","📋 Schedule"],["timesheet","🕐 Timesheet"]].map(([v,lbl])=>(
    <button key={v} onClick={()=>setSchedSubTab(v)} style={{
      background:schedSubTab===v?T.dark:T.muted,
      color:schedSubTab===v?"white":T.sub,
      border:"none",borderRadius:8,padding:"8px 18px",
      fontWeight:700,fontSize:13,cursor:"pointer",transition:"all 0.15s"
    }}>{lbl}</button>
  ))}
</div>

{/* TIMESHEET VIEW */}
{schedSubTab==="timesheet" && (()=>{
  const tsWkDates = Array.from({length:7},(_,i)=>{
    const d = new Date(tsWeekStart+"T00:00:00");
    d.setDate(d.getDate()+i);
    return d.toISOString().split("T")[0];
  });
  const tsWkLabel = `${dl(new Date(tsWeekStart+"T00:00:00"))} – ${dl(new Date(tsWkDates[6]+"T00:00:00"))}`;

  const tsSchedKey = Object.keys(schedule).find(wk => {
    const sun = new Date(wk+"T00:00:00");
    const dates = Array.from({length:7},(_,i)=>{ const d=new Date(sun); d.setDate(sun.getDate()+i); return d.toISOString().split("T")[0]; });
    return dates[0] === tsWeekStart;
  }) || null;

  function getTsShift(empId, di) {
    return tsSchedKey ? (schedule?.[tsSchedKey]?.[empId]?.[di] || null) : null;
  }

  function getDayPunches(empId, dateStr) {
    return punches.filter(p => {
      const pd = new Date(p.time).toISOString().split("T")[0];
      return p.empId === empId && pd === dateStr;
    }).sort((a,b) => new Date(a.time)-new Date(b.time));
  }

  function calcActualHours(dayPunches) {
    let hrs = 0, inT = null;
    for (const p of dayPunches) {
      if (p.type==="in"||p.type==="break_in") inT = new Date(p.time);
      else if (p.type==="out" && inT) { hrs += (new Date(p.time)-inT)/3600000; inT=null; }
    }
    if (inT) hrs += (Date.now()-inT)/3600000;
    return parseFloat(hrs.toFixed(2));
  }

  const pendingFlags = punches.filter(p =>
    p.flags?.length > 0 &&
    tsWkDates.includes(new Date(p.time).toISOString().split("T")[0]) &&
    !punchReviews[p.id]
  ).length;

  const totalApprovedHrs = employees.reduce((s,emp) =>
    s + tsWkDates.reduce((ds,dateStr) => {
      const dp = getDayPunches(emp.id, dateStr);
      if (!dp.length) return ds;
      return ds + (punchReviews[dp[0]?.id]==="approved" ? calcActualHours(dp) : 0);
    },0)
  ,0);

  const totalApprovedPay = employees.reduce((s,emp) => {
    const rate = parseFloat(emp.hourlyRate)||0;
    const hrs = tsWkDates.reduce((ds,dateStr) => {
      const dp = getDayPunches(emp.id, dateStr);
      if (!dp.length) return ds;
      return ds + (punchReviews[dp[0]?.id]==="approved" ? calcActualHours(dp) : 0);
    },0);
    return s + hrs*rate;
  },0);

  function exportTimesheetCSV(wkDates, wkLabel, snapEmployees, snapReviews) {
    const rows = [["Employee","Role","Hourly Rate","Date","Day","Scheduled In","Scheduled Out","Scheduled Hours","Actual Hours","Difference","Flags","Status"]];
    const emps = snapEmployees || employees;
    emps.forEach(emp => {
      wkDates.forEach((dateStr, di) => {
        const shift = snapEmployees ? null : getTsShift(emp.id, di);
        const dp = snapEmployees
          ? (emp.days?.[di]?.punches||[])
          : getDayPunches(emp.id, dateStr);
        const actualHrs = snapEmployees ? (emp.days?.[di]?.actualHrs||0) : calcActualHours(dp);
        const schedHrs = shiftHrs(shift);
        const flags = snapEmployees ? (emp.days?.[di]?.flags||[]) : dp.flatMap(p=>p.flags||[]);
        const inP = Array.isArray(dp) ? dp.find(p=>p.type==="in") : null;
        const outP = Array.isArray(dp) ? [...dp].reverse().find(p=>p.type==="out") : null;
        const reviews = snapReviews || punchReviews;
        const punchId = Array.isArray(dp) ? dp[0]?.id : null;
        const status = snapEmployees ? (emp.days?.[di]?.status||"pending") : (punchId?(reviews[punchId]||"pending"):"no_punch");
        if (schedHrs===0 && actualHrs===0) return;
        rows.push([
          emp.name, emp.role||"", `$${emp.hourlyRate||0}`,
          dateStr, DAYS[di],
          shift?fmt(shift.start):"", shift?fmt(shift.end):"", schedHrs,
          actualHrs, parseFloat((actualHrs-schedHrs).toFixed(2)),
          flags.join("|"), status
        ]);
      });
    });
    const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    a.download = `${biz.replace(/\s+/g,"_")}_timesheet_${wkDates[0]}.csv`;
    a.click();
    showToast("Timesheet exported ✓");
  }

  function lockAndSave() {
    if (!window.confirm(`Lock and save timesheet for ${tsWkLabel}?\n\nThis creates a permanent record that can be exported for payroll.`)) return;
    const snapshot = {
      id: Date.now().toString(),
      savedAt: new Date().toISOString(),
      weekStart: tsWeekStart,
      label: tsWkLabel,
      employees: employees.map(emp => ({
        id: emp.id, name: emp.name, role: emp.role, hourlyRate: emp.hourlyRate,
        days: tsWkDates.map((dateStr, di) => {
          const dp = getDayPunches(emp.id, dateStr);
          const shift = getTsShift(emp.id, di);
          const actualHrs = calcActualHours(dp);
          const punchId = dp[0]?.id;
          return {
            dateStr, day: DAYS[di],
            scheduledHrs: shiftHrs(shift),
            actualHrs,
            flags: dp.flatMap(p=>p.flags||[]),
            status: punchId ? (punchReviews[punchId]||"pending") : "no_punch",
            punches: dp.map(p=>({type:p.type,time:p.time,flags:p.flags,id:p.id})),
          };
        }),
        totalActualHrs: parseFloat(tsWkDates.reduce((s,dateStr)=>s+calcActualHours(getDayPunches(emp.id,dateStr)),0).toFixed(2)),
        totalApprovedHrs: parseFloat(tsWkDates.reduce((ds,dateStr)=>{
          const dp=getDayPunches(emp.id,dateStr);
          return ds+(punchReviews[dp[0]?.id]==="approved"?calcActualHours(dp):0);
        },0).toFixed(2)),
      })),
      totalApprovedHrs: parseFloat(totalApprovedHrs.toFixed(2)),
      totalApprovedPay: parseFloat(totalApprovedPay.toFixed(2)),
      reviewStatuses: {...punchReviews},
    };
    setTimesheetHistory(p=>[snapshot,...p]);
    addAudit("Timesheet Locked", `Week of ${tsWkLabel} — ${totalApprovedHrs.toFixed(1)}h approved · $${totalApprovedPay.toFixed(0)}`);
    showToast(`Timesheet locked ✓ — ${tsWkLabel}`, 4000);
  }

  // ── CELL POPUP ─────────────────────────────────────────────────────────────
  function TimesheetCellPopup() {
    const [editIn,  setEditIn]  = useState("");
    const [editOut, setEditOut] = useState("");
    const [saving,  setSaving]  = useState(false);

    useEffect(()=>{
      if (!tsOpenCell) return;
      const dp = getDayPunches(tsOpenCell.empId, tsOpenCell.dateStr);
      const inP  = dp.find(p=>p.type==="in");
      const outP = [...dp].reverse().find(p=>p.type==="out");
      const toHHMM = isoStr => { const d=new Date(isoStr); return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); };
      setEditIn(inP ? toHHMM(inP.time) : "");
      setEditOut(outP ? toHHMM(outP.time) : "");
    }, [tsOpenCell?.empId, tsOpenCell?.dateStr]);

    if (!tsOpenCell) return null;
    const {empId, dateStr, dayIdx} = tsOpenCell;
    const emp = employees.find(e=>e.id===empId);
    if (!emp) return null;

    const dp      = getDayPunches(empId, dateStr);
    const shift   = getTsShift(empId, dayIdx);
    const actual  = calcActualHours(dp);
    const sched   = shiftHrs(shift);
    const diff    = parseFloat((actual-sched).toFixed(2));
    const flags   = dp.flatMap(p=>p.flags||[]).filter((v,i,a)=>a.indexOf(v)===i);
    const punchId = dp[0]?.id;
    const status  = punchId ? (punchReviews[punchId]||"pending") : null;

    const FLAG_LABELS = {LATE:"Late clock-in",EARLY:"Early clock-in",EARLY_OUT:"Early clock-out",NO_SHIFT:"No shift scheduled",ADJUSTMENT:"Manual adjustment"};
    const STATUS_COLOR = {reviewed:"#3A9BE8",approved:"#4CAF7D",rejected:"#C0392B",pending:"#E8A93A"};

    function setStatus(val) {
      if (!punchId) return;
      dp.forEach(p => setPunchReviews(prev=>({...prev,[p.id]:val})));
      setTsOpenCell(null);
      showToast(`Marked as ${val} ✓`);
    }

    async function saveManualTime() {
      if (!editIn) { showToast("Enter at least a clock-in time"); return; }
      setSaving(true);
      try {
        const makeISO = (dateStr, timeStr) => {
          const [h,m] = timeStr.split(":").map(Number);
          const d = new Date(dateStr+"T00:00:00");
          d.setHours(h,m,0,0);
          return d.toISOString();
        };
        const inTime  = makeISO(dateStr, editIn);
        const outTime = editOut ? makeISO(dateStr, editOut) : null;

        const inPunch = { id:Date.now().toString(), empId, empName:emp.name, type:"in", time:inTime, scheduled:shift||null, flags:["ADJUSTMENT"] };
        setPunches(p=>[...p, inPunch]);
        if (bizId) {
          await dbPost("punches", { business_id:bizId, employee_id:empId, employee_name:emp.name, punch_type:"in", punched_at:inTime, scheduled_start:shift?.start||null, scheduled_end:shift?.end||null, flags:["ADJUSTMENT"] });
        }

        if (outTime) {
          const outPunch = { id:(Date.now()+1).toString(), empId, empName:emp.name, type:"out", time:outTime, scheduled:shift||null, flags:["ADJUSTMENT"] };
          setPunches(p=>[...p, outPunch]);
          if (bizId) {
            await dbPost("punches", { business_id:bizId, employee_id:empId, employee_name:emp.name, punch_type:"out", punched_at:outTime, scheduled_start:shift?.start||null, scheduled_end:shift?.end||null, flags:["ADJUSTMENT"] });
          }
        }

        addAudit("Manual Time Entry", `${emp.name} — ${dateStr}: ${editIn}${editOut?" – "+editOut:""}`, {empName:emp.name});
        showToast("Time adjustment saved ✓");
        setTsOpenCell(null);
      } catch(e) { showToast("Could not save: "+e.message); }
      finally { setSaving(false); }
    }

    return (
      <div onClick={()=>setTsOpenCell(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <div onClick={e=>e.stopPropagation()} style={{background:"white",borderRadius:20,width:"100%",maxWidth:420,boxShadow:"0 20px 60px rgba(0,0,0,0.3)",overflow:"hidden",maxHeight:"90vh",overflowY:"auto"}}>

          {/* Header */}
          <div style={{background:emp.color,padding:"16px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,0.25)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:800,fontSize:15}}>{emp.name?.[0]?.toUpperCase()||"?"}</div>
              <div>
                <div style={{color:"white",fontWeight:800,fontSize:15}}>{emp.name}</div>
                <div style={{color:"rgba(255,255,255,0.75)",fontSize:11}}>{new Date(dateStr+"T00:00:00").toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}</div>
              </div>
            </div>
            <button onClick={()=>setTsOpenCell(null)} style={{background:"rgba(255,255,255,0.2)",border:"none",borderRadius:"50%",width:30,height:30,color:"white",fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
          </div>

          <div style={{padding:"16px 18px",display:"flex",flexDirection:"column",gap:12}}>

            {/* Scheduled vs Actual */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div style={{background:T.muted,borderRadius:10,padding:"10px 12px"}}>
                <div style={{fontSize:10,color:T.sub,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>Scheduled</div>
                {shift ? (
                  <><div style={{fontWeight:700,fontSize:13,color:T.text}}>{fmt(shift.start)} – {fmt(shift.end)}</div>
                  <div style={{fontSize:11,color:T.sub}}>{sched}h</div></>
                ) : <div style={{fontSize:12,color:T.sub,fontStyle:"italic"}}>No shift</div>}
              </div>
              <div style={{background:actual>0?"#F0FFF4":T.muted,borderRadius:10,padding:"10px 12px"}}>
                <div style={{fontSize:10,color:T.sub,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>Actual</div>
                {actual>0 ? (
                  <><div style={{fontWeight:700,fontSize:13,color:T.text}}>{actual.toFixed(2)}h</div>
                  <div style={{fontSize:11,color:diff>0.25?"#E8A93A":diff<-0.25?"#C0392B":"#4CAF7D",fontWeight:600}}>{diff>0?"+":""}{diff.toFixed(2)}h vs sched</div></>
                ) : <div style={{fontSize:12,color:T.sub,fontStyle:"italic"}}>No punches</div>}
              </div>
            </div>

            {/* Flags */}
            {flags.length>0&&(
              <div style={{background:"#FEF3E2",borderRadius:10,padding:"10px 12px",border:"1px solid #E8A93A30"}}>
                <div style={{fontSize:10,fontWeight:700,color:"#E67E22",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>⚠ Flags</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {flags.map((f,i)=>(
                    <span key={i} style={{background:"#E8A93A22",color:"#B7780F",border:"1px solid #E8A93A44",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700}}>
                      {FLAG_LABELS[f]||f}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Punch log */}
            {dp.length>0&&(
              <div style={{background:T.muted,borderRadius:10,padding:"10px 12px"}}>
                <div style={{fontSize:10,fontWeight:700,color:T.sub,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Punch log</div>
                {dp.map((p,i)=>(
                  <div key={p.id||i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:i<dp.length-1?`1px solid ${T.border}`:"none"}}>
                    <span style={{fontSize:12,fontWeight:700,color:p.type==="in"||p.type==="break_in"?"#2D6A4F":"#C0392B"}}>
                      {p.type==="in"?"Clock in":p.type==="out"?"Clock out":p.type==="break_out"?"Break start":"Break end"}
                    </span>
                    <span style={{fontSize:12,color:T.sub,fontFamily:"monospace"}}>{new Date(p.time).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Manual time entry */}
            <div style={{border:`1.5px solid ${T.border}`,borderRadius:10,padding:"12px 14px"}}>
              <div style={{fontSize:10,fontWeight:700,color:T.sub,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>
                {dp.length>0?"Adjust time":"Add missing time"}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                {[["Clock in",editIn,setEditIn],["Clock out",editOut,setEditOut]].map(([lbl,val,setter])=>(
                  <div key={lbl}>
                    <label style={{fontSize:10,color:T.sub,display:"block",marginBottom:4,fontWeight:600}}>{lbl}</label>
                    <input type="time" value={val} onChange={e=>setter(e.target.value)}
                      style={{width:"100%",border:`1.5px solid ${T.border}`,borderRadius:8,padding:"8px 10px",fontSize:13,fontWeight:700,outline:"none",background:T.surface,color:T.text}}/>
                  </div>
                ))}
              </div>
              <button onClick={saveManualTime} disabled={saving||!editIn}
                style={{width:"100%",background:editIn?T.dark:T.muted,color:editIn?"white":T.sub,border:"none",borderRadius:8,padding:"10px 0",fontWeight:700,fontSize:13,cursor:editIn?"pointer":"not-allowed"}}>
                {saving?"Saving…":"Save time adjustment"}
              </button>
              <div style={{fontSize:10,color:T.sub,marginTop:6,textAlign:"center"}}>Creates an audit trail entry flagged as ADJUSTMENT</div>
            </div>

{/* Delete punches */}
{dp.length>0&&(
  <div style={{borderTop:`1px solid ${T.border}`,paddingTop:12}}>
    <button onClick={()=>{
      if(!window.confirm(`Delete all ${dp.length} punch record${dp.length!==1?"s":""} for ${emp.name} on ${dateStr}?\n\nThis cannot be undone. An audit entry will be created.`)) return;
      const idsToRemove = new Set(dp.map(p=>p.id));
      setPunches(p=>p.filter(p=>!idsToRemove.has(p.id)));
      setPunchReviews(prev=>{ const n={...prev}; dp.forEach(p=>delete n[p.id]); return n; });
      if (bizId) {
        dp.forEach(p=>{
          dbDelete(`punches?id=eq.${p.id}`).catch(e=>console.warn("Punch delete failed:",e));
        });
      }
      addAudit("Punches Deleted", `${emp.name} — ${dateStr}: ${dp.length} record${dp.length!==1?"s":""} removed`, {empName:emp.name});
      showToast(`${dp.length} punch record${dp.length!==1?"s":""} deleted ✓`);
      setTsOpenCell(null);
    }} style={{width:"100%",background:"#FDECEA",color:"#C0392B",border:"1px solid #C0392B22",borderRadius:9,padding:"10px 0",fontWeight:700,fontSize:12,cursor:"pointer"}}>
      Delete {dp.length} punch record{dp.length!==1?"s":""}
    </button>
  </div>
)}

            {/* Review buttons */}
            <div>
              <div style={{fontSize:10,fontWeight:700,color:T.sub,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Review status</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                {[["Reviewed","reviewed","#3A9BE8"],["Approve","approved","#4CAF7D"],["Reject","rejected","#C0392B"]].map(([lbl,val,color])=>(
                  <button key={val} onClick={()=>setStatus(val)}
                    style={{
                      background:status===val?color:color+"18",
                      color:status===val?"white":color,
                      border:`1.5px solid ${color}40`,
                      borderRadius:10,padding:"11px 0",fontWeight:700,fontSize:12,cursor:"pointer",transition:"all 0.12s"
                    }}>{lbl}</button>
                ))}
              </div>
              {!punchId&&<div style={{fontSize:11,color:T.sub,textAlign:"center",marginTop:8}}>Add time above before reviewing</div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── MAIN RENDER ────────────────────────────────────────────────────────────
  return (
    <div>

      {/* Header */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontWeight:800,fontSize:16,color:T.text}}>Timesheet</div>
          <div style={{fontSize:11,color:T.sub,marginTop:2,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            Actual hours from kiosk · Review flags · Lock when ready for payroll
            {pendingFlags>0&&<span style={{background:"#C0392B",color:"white",borderRadius:10,padding:"1px 8px",fontSize:10,fontWeight:700}}>{pendingFlags} flag{pendingFlags!==1?"s":""} pending</span>}
          </div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          {totalApprovedHrs>0&&(
            <div style={{background:T.surface,borderRadius:T.radius,padding:"8px 14px",fontSize:12,border:`1px solid ${T.border}`,display:"flex",gap:12,alignItems:"center"}}>
              <span><span style={{color:"#4CAF7D",fontWeight:700}}>{totalApprovedHrs.toFixed(1)}h</span> <span style={{color:T.sub}}>approved</span></span>
              <span><span style={{color:T.accent,fontWeight:700}}>${totalApprovedPay.toFixed(0)}</span> <span style={{color:T.sub}}>est.</span></span>
            </div>
          )}
          <button onClick={()=>exportTimesheetCSV(tsWkDates, tsWkLabel)}
            style={{background:T.muted,color:T.text,border:`1px solid ${T.border}`,borderRadius:9,padding:"8px 14px",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            Export CSV ↓
          </button>
          <button onClick={lockAndSave}
            style={{background:T.accent,color:"white",border:"none",borderRadius:9,padding:"8px 16px",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            🔒 Lock & Save
          </button>
        </div>
      </div>

      {/* Week picker */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
        <div style={{fontWeight:700,fontSize:13,color:T.text,minWidth:160}}>{tsWkLabel}</div>
        <div style={{position:"relative",flexShrink:0}}>
          <input type="date" value={tsWeekStart} onChange={e=>setTsWeekStart(getSunday(e.target.value))}
            style={{opacity:0,position:"absolute",inset:0,cursor:"pointer",width:"100%",height:"100%"}}/>
          <div style={{background:T.muted,borderRadius:8,padding:"7px 12px",fontSize:13,cursor:"pointer",userSelect:"none",border:`1px solid ${T.border}`,fontWeight:600,color:T.text,display:"flex",alignItems:"center",gap:6}}>
            📅 Jump to week
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="grid-scroll" style={{borderRadius:T.radius,boxShadow:T.shadowMd,marginBottom:20}}>
        <table className="sched-table" style={{borderCollapse:"collapse",width:"100%",background:T.surface,minWidth:600}}>
          <colgroup>
            <col style={{width:110}}/>{DAYS.map(d=><col key={d}/>)}<col style={{width:80}}/>
          </colgroup>
          <thead>
            <tr style={{background:T.dark}}>
              <th style={{padding:"11px 12px",textAlign:"left",color:"#666",fontSize:10,fontWeight:700,letterSpacing:"0.08em"}}>EMPLOYEE</th>
              {tsWkDates.map((dateStr,i)=>{
                const dayTotal = employees.reduce((s,emp)=>s+calcActualHours(getDayPunches(emp.id,dateStr)),0);
                return (
                  <th key={dateStr} style={{padding:"9px 4px",textAlign:"center",color:"white",fontSize:11,fontWeight:700}}>
                    <div>{DAYS[i]}</div>
                    <div style={{fontSize:9,color:"#666",fontWeight:400}}>{dl(new Date(dateStr+"T00:00:00"))}</div>
                    {dayTotal>0&&<div style={{fontSize:9,color:T.accent,fontWeight:700,marginTop:1}}>{dayTotal.toFixed(1)}h</div>}
                  </th>
                );
              })}
              <th style={{padding:"9px 6px",textAlign:"center",color:T.accent,fontSize:10,fontWeight:700,letterSpacing:"0.06em"}}>ACTUAL<br/>HRS</th>
            </tr>
          </thead>
          <tbody>
            {employees.length===0&&(
              <tr><td colSpan={9} style={{padding:"40px",textAlign:"center",color:T.sub}}>No employees yet.</td></tr>
            )}
            {employees.map((emp,ei)=>{
              const totalActual = parseFloat(tsWkDates.reduce((s,dateStr)=>s+calcActualHours(getDayPunches(emp.id,dateStr)),0).toFixed(2));
              const totalSched  = parseFloat(tsWkDates.reduce((s,_,di)=>s+shiftHrs(getTsShift(emp.id,di)),0).toFixed(2));
              const delta = parseFloat((totalActual-totalSched).toFixed(2));
              return (
                <tr key={emp.id} style={{borderBottom:`1px solid ${T.border}`,background:ei%2===0?T.surface:"#FDFCFA"}}>
                  <td style={{padding:"9px 12px",verticalAlign:"middle"}}>
                    <div style={{display:"flex",alignItems:"center",gap:7}}>
                      <div style={{width:26,height:26,borderRadius:"50%",background:emp.color,display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:800,fontSize:10,flexShrink:0}}>{emp.name?emp.name[0].toUpperCase():"?"}</div>
                      <div>
                        <div style={{fontWeight:700,fontSize:12,color:T.text}}>{emp.name||"New"}</div>
                        <div style={{fontSize:9,color:T.sub}}>${emp.hourlyRate||0}/hr</div>
                      </div>
                    </div>
                  </td>
                  {tsWkDates.map((dateStr,di)=>{
                    const shift      = getTsShift(emp.id,di);
                    const dp         = getDayPunches(emp.id,dateStr);
                    const actual     = calcActualHours(dp);
                    const sched      = shiftHrs(shift);
                    const diff       = parseFloat((actual-sched).toFixed(2));
                    const flags      = dp.flatMap(p=>p.flags||[]).filter(f=>f!=="ADJUSTMENT");
                    const hasPunch   = dp.length>0;
                    const punchId    = dp[0]?.id;
                    const status     = punchId?(punchReviews[punchId]||"pending"):null;
                    const inP        = dp.find(p=>p.type==="in");
                    const outP       = [...dp].reverse().find(p=>p.type==="out");
                    const hasFlag    = flags.length>0;
                    const statusColor = status==="approved"?"#4CAF7D":status==="rejected"?"#C0392B":status==="reviewed"?"#3A9BE8":"#E8A93A";

                    return (
                      <td key={dateStr} style={{padding:"4px 3px",textAlign:"center",verticalAlign:"middle"}}>
                        <div
                          onClick={()=>(hasPunch||shift)&&setTsOpenCell({empId:emp.id,dateStr,dayIdx:di})}
                          style={{
                            borderRadius:8, padding:"5px 4px", minHeight:54,
                            border:`1.5px solid ${hasFlag?"#E8A93A":status==="approved"?"#4CAF7D40":status==="rejected"?"#C0392B40":hasPunch?T.border:"transparent"}`,
                            background:hasFlag?"#FEF3E215":status==="approved"?"#F0FFF420":status==="rejected"?"#FDECEA15":hasPunch?T.surface:"transparent",
                            cursor:(hasPunch||shift)?"pointer":"default",
                            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                            transition:"all 0.12s",
                          }}>
                          {!hasPunch&&!shift ? (
                            <span style={{color:T.border,fontSize:11}}>—</span>
                          ) : !hasPunch&&shift ? (
                            <div style={{opacity:0.6}}>
                              <div style={{fontSize:9,color:T.sub,fontWeight:700}}>No punch</div>
                              <div style={{fontSize:8,color:T.sub}}>{fmt(shift.start)}</div>
                              <div style={{fontSize:8,color:T.sub}}>{fmt(shift.end)}</div>
                            </div>
                          ) : (
                            <>
                              {inP&&<div style={{fontSize:9,color:T.sub,fontWeight:600}}>{new Date(inP.time).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}</div>}
                              {outP&&<div style={{fontSize:9,color:T.sub}}>{new Date(outP.time).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}</div>}
                              <div style={{fontWeight:800,fontSize:11,color:diff>0.25?"#E8A93A":diff<-0.25?"#C0392B":T.text,marginTop:2}}>{actual.toFixed(1)}h</div>
                              {hasFlag&&<div style={{fontSize:8,color:"#E8A93A",fontWeight:700}}>⚠ FLAG</div>}
                              {status&&<div style={{fontSize:8,fontWeight:700,color:statusColor,textTransform:"uppercase",marginTop:1,letterSpacing:"0.04em"}}>{status}</div>}
                            </>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td style={{padding:"8px 6px",textAlign:"center",verticalAlign:"middle"}}>
                    {totalActual>0?(
                      <>
                        <div style={{fontWeight:800,fontSize:12,color:delta>0.5?"#E8A93A":delta<-0.5?"#C0392B":T.text}}>{totalActual.toFixed(1)}h</div>
                        {totalSched>0&&<div style={{fontSize:9,color:T.sub}}>{totalSched}h sched</div>}
                        {delta!==0&&<div style={{fontSize:9,color:delta>0?"#E8A93A":"#C0392B",fontWeight:700}}>{delta>0?"+":""}{delta.toFixed(1)}</div>}
                      </>
                    ):<span style={{color:T.border,fontSize:11}}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{fontSize:11,color:T.sub,textAlign:"center",marginBottom:20}}>
        Tap any cell to review, adjust time, or approve · 📅 Jump to any week · 🔒 Lock when ready for payroll
      </div>

      {/* Timesheet History */}
      {timesheetHistory.length>0&&(
        <div>
          <div style={{fontWeight:800,fontSize:15,color:T.text,marginBottom:10}}>📁 Saved Timesheets</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {timesheetHistory.map(snap=>(
              <div key={snap.id} style={{background:T.surface,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden",border:`1px solid ${T.border}`}}>
                <div style={{background:T.dark,padding:"11px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                  <div>
                    <div style={{color:"white",fontWeight:800,fontSize:13}}>{snap.label}</div>
                    <div style={{color:"#666",fontSize:10,marginTop:2}}>Locked {new Date(snap.savedAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                    <span style={{color:T.accent,fontWeight:700,fontSize:12}}>{snap.totalApprovedHrs.toFixed(1)}h · ${snap.totalApprovedPay.toFixed(0)}</span>
                    <button onClick={()=>{
                      const wkDates = Array.from({length:7},(_,i)=>{ const d=new Date(snap.weekStart+"T00:00:00"); d.setDate(d.getDate()+i); return d.toISOString().split("T")[0]; });
                      exportTimesheetCSV(wkDates, snap.label, snap.employees, snap.reviewStatuses);
                    }} style={{background:T.accent,color:"white",border:"none",borderRadius:7,padding:"5px 12px",fontWeight:700,fontSize:11,cursor:"pointer"}}>Export CSV ↓</button>
                    <button onClick={()=>{ if(window.confirm("Delete this saved timesheet?")) setTimesheetHistory(p=>p.filter(s=>s.id!==snap.id)); }}
                      style={{background:"#FDECEA",color:"#C0392B",border:"none",borderRadius:7,padding:"5px 10px",fontWeight:700,fontSize:11,cursor:"pointer"}}>Delete</button>
                  </div>
                </div>
                <div>
                  {snap.employees.map((emp,i)=>{
                    if (emp.totalActualHrs===0) return null;
                    const rate = parseFloat(emp.hourlyRate)||0;
                    return (
                      <div key={emp.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",borderBottom:i<snap.employees.length-1?`1px solid ${T.border}`:"none",flexWrap:"wrap",gap:8}}>
                        <div style={{fontWeight:600,fontSize:13,color:T.text}}>{emp.name}</div>
                        <div style={{display:"flex",gap:14,fontSize:12,color:T.sub,flexWrap:"wrap"}}>
                          <span>{emp.totalActualHrs.toFixed(1)}h total</span>
                          <span style={{color:"#4CAF7D",fontWeight:700}}>{emp.totalApprovedHrs.toFixed(1)}h approved</span>
                          <span style={{color:T.accent,fontWeight:700}}>${(emp.totalApprovedHrs*rate).toFixed(0)}</span>
                        </div>
                      </div>
                    );
                  }).filter(Boolean)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <TimesheetCellPopup/>
    </div>
  );
})()}


{schedSubTab==="schedule" && <>
              <Card T={T} style={{marginBottom:14,padding:"14px 16px",overflow:"visible",position:"relative",zIndex:300}}>
                <div className="controls-bar" style={{display:"flex",gap:14,alignItems:"flex-start",flexWrap:"wrap"}}>
                  <div>
                    <SectionLabel T={T}>View</SectionLabel>
                    <div style={{display:"flex",gap:5}}>
                      {[["daily","Day"],["weekly","Week"],["monthly","Month"]].map(([v,lbl])=>(
                        <Pill key={v} T={T} active={schedView===v} onClick={()=>setSchedView(v)}>{lbl}</Pill>
                      ))}
                    </div>
                  </div>
                  <Divider T={T}/>
                  <div>
                    <SectionLabel T={T}>{activeWeek ? "Schedule Week" : "Select a Week"}</SectionLabel>
                    <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                      {weeks.map((wk,wi)=>{
                        const isActive = activeWeek === wk.key;
                        const changeFn = (newKey) => changeWkStart(wk.key,newKey,wi===0?setWk1Start:setWk2Start);
                        const dateRange = `${dl(wk.dates[0])} – ${dl(wk.dates[6])}`;
                        return (
                          <div key={wk.key} style={{display:"flex",gap:6,alignItems:"center"}}>
                            <button onClick={()=>setActiveWeek(wk.key)} className="action-btn"
                              style={{ background:isActive?T.dark:T.muted, color:isActive?"white":T.sub, border:isActive?"none":`1.5px dashed ${T.border}`, borderRadius:8, padding:"7px 14px", fontWeight:700, fontSize:12, cursor:"pointer", transition:"all 0.15s", whiteSpace:"nowrap" }}>
                              {dateRange}
                            </button>
                            <div style={{position:"relative",flexShrink:0}} title="Change week start date">
                              <input type="date" value={toInputDate(wk.dates[0])} onChange={e=>changeFn(getSunday(e.target.value))}
                                style={{opacity:0,position:"absolute",inset:0,cursor:"pointer",width:"100%",height:"100%"}}/>
                              <div style={{background:T.muted,borderRadius:8,padding:"7px 10px",fontSize:14,cursor:"pointer",userSelect:"none"}}>📅</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <Divider T={T}/>
                  <div style={{position:"relative"}}>
                    <SectionLabel T={T}>Actions</SectionLabel>
                    <button onClick={()=>setActionsOpen(p=>!p)}
                      style={{background:actionsOpen?T.accent:T.muted,color:actionsOpen?"white":T.text,border:"none",borderRadius:8,padding:"7px 14px",fontWeight:700,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap"}}>
                      Actions {actionsOpen?"▲":"▼"}
                      {published.length>0&&<span style={{background:actionsOpen?"rgba(255,255,255,0.3)":T.accent,color:"white",borderRadius:10,padding:"1px 6px",fontSize:9,marginLeft:2}}>{published.length}</span>}
                    </button>
                    {actionsOpen&&(
                      <>
                        <div onClick={()=>setActionsOpen(false)} style={{position:"fixed",inset:0,zIndex:550}}/>
                        <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,boxShadow:T.shadowMd,zIndex:600,minWidth:240,overflow:"hidden"}}>

                          {/* ── Publish ── */}
                          <div style={{padding:"6px 14px 4px",fontSize:9,fontWeight:700,color:T.sub,letterSpacing:"0.1em",textTransform:"uppercase",background:T.muted}}>Publish</div>
                          <button onClick={()=>{ setActionsOpen(false); if(window.confirm("Publish this schedule? It will be saved as a locked version in History.")) publishSchedule(); }}
                            style={{width:"100%",background:"transparent",border:"none",borderBottom:`1px solid ${T.border}`,padding:"11px 14px",textAlign:"left",fontSize:13,cursor:"pointer",color:T.text,fontWeight:600,display:"flex",alignItems:"center",gap:10}}>
                            <span style={{fontSize:16}}>✅</span>
                            <div><div style={{fontWeight:700}}>Publish Week</div><div style={{fontSize:10,color:T.sub}}>Lock and save a timestamped version</div></div>
                          </button>
                          <button onClick={()=>{ setActionsOpen(false); setHistoryOpen(true); }}
                            style={{width:"100%",background:"transparent",border:"none",borderBottom:`1px solid ${T.border}`,padding:"11px 14px",textAlign:"left",fontSize:13,cursor:"pointer",color:T.text,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              <span style={{fontSize:16}}>🕐</span>
                              <div><div style={{fontWeight:700}}>History</div><div style={{fontSize:10,color:T.sub}}>View and restore published schedules</div></div>
                            </div>
                            {published.length>0&&<span style={{background:T.accent,color:"white",borderRadius:10,padding:"1px 7px",fontSize:9,flexShrink:0}}>{published.length}</span>}
                          </button>

                          {/* ── Copy / Paste (2-week mode only) ── */}
                          {weekMode==="2"&&<>
                            <div style={{padding:"6px 14px 4px",fontSize:9,fontWeight:700,color:T.sub,letterSpacing:"0.1em",textTransform:"uppercase",background:T.muted}}>Copy &amp; Paste</div>
                            <button onClick={()=>{ setClipboard(activeWeek); setActionsOpen(false); showToast("Week copied — open Actions and paste on the other week"); }}
                              style={{width:"100%",background:clipboard===activeWeek?T.accent+"12":"transparent",border:"none",borderBottom:`1px solid ${T.border}`,padding:"11px 14px",textAlign:"left",fontSize:13,cursor:"pointer",color:clipboard===activeWeek?T.accent:T.text,fontWeight:600,display:"flex",alignItems:"center",gap:10}}>
                              <span style={{fontSize:16}}>📋</span>
                              <div><div style={{fontWeight:700}}>{clipboard===activeWeek?"✓ Copied this week":"Copy This Week"}</div><div style={{fontSize:10,color:T.sub}}>Copy current week's shifts to clipboard</div></div>
                            </button>
                            <button
                              disabled={!clipboard||clipboard===activeWeek}
                              onClick={()=>{ doCopyWeek(clipboard,activeWeek); setClipboard(null); setActionsOpen(false); showToast("Week pasted ✓"); }}
                              style={{width:"100%",background:clipboard&&clipboard!==activeWeek?T.accent+"10":"transparent",border:"none",borderBottom:`1px solid ${T.border}`,padding:"11px 14px",textAlign:"left",fontSize:13,cursor:clipboard&&clipboard!==activeWeek?"pointer":"not-allowed",color:clipboard&&clipboard!==activeWeek?T.accent:T.sub,fontWeight:600,display:"flex",alignItems:"center",gap:10,opacity:clipboard&&clipboard!==activeWeek?1:0.5}}>
                              <span style={{fontSize:16}}>📌</span>
                              <div><div style={{fontWeight:700}}>Paste Week</div><div style={{fontSize:10,color:T.sub}}>{clipboard&&clipboard!==activeWeek?"Ready to paste here":"Copy a week first"}</div></div>
                            </button>
                          </>}

                          {/* ── Templates ── */}
                          <div style={{padding:"6px 14px 4px",fontSize:9,fontWeight:700,color:T.sub,letterSpacing:"0.1em",textTransform:"uppercase",background:T.muted}}>Templates</div>
                          <button onClick={()=>{
                            setActionsOpen(false);
                            const name = window.prompt("Name this template:", `Template ${templates.length+1}`);
                            if (name !== null) saveTemplate(name);
                          }} style={{width:"100%",background:"transparent",border:"none",borderBottom:`1px solid ${T.border}`,padding:"11px 14px",textAlign:"left",fontSize:13,cursor:"pointer",color:T.text,fontWeight:600,display:"flex",alignItems:"center",gap:10}}>
                            <span style={{fontSize:16}}>💾</span>
                            <div><div style={{fontWeight:700}}>Save as Template</div><div style={{fontSize:10,color:T.sub}}>Save current schedule to reuse later</div></div>
                          </button>
                          {templates.length===0?(
                            <div style={{padding:"10px 14px",fontSize:12,color:T.sub,fontStyle:"italic"}}>No templates saved yet</div>
                          ):(
                            <div>
                              <div style={{padding:"6px 14px 4px",fontSize:9,fontWeight:700,color:T.sub,letterSpacing:"0.1em",textTransform:"uppercase"}}>Apply Template</div>
                              {templates.slice(0,5).map(tpl=>(
                                <button key={tpl.id} onClick={()=>{ if(window.confirm(`Apply template "${tpl.name}"? Current shifts will be overwritten.`)) { applyTemplate(tpl); setActionsOpen(false); } }}
                                  style={{width:"100%",background:"transparent",border:"none",borderTop:`1px solid ${T.border}`,padding:"9px 14px",textAlign:"left",fontSize:12,cursor:"pointer",color:T.text,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                                  <span style={{fontWeight:600}}>{tpl.name}</span>
                                  <span style={{fontSize:10,color:T.sub,whiteSpace:"nowrap"}}>{new Date(tpl.savedAt).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
                                </button>
                              ))}
                              {templates.length>5&&<div style={{padding:"6px 14px",fontSize:10,color:T.sub,borderTop:`1px solid ${T.border}`}}>{templates.length-5} more in Settings</div>}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  <Divider T={T}/>
                  <div style={{marginLeft:"auto",minWidth:200}}>
                    <SectionLabel T={T}>Weekly Budget</SectionLabel>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                      <div style={{position:"relative"}}>
                        <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",fontWeight:700,fontSize:13,color:T.sub}}>$</span>
                        <input type="number" min="0" step="10" value={weeklyBudget}
                          onChange={e=>{ const v=e.target.value; if(v===""||(!isNaN(v)&&parseFloat(v)>=0)) setWeeklyBudget(v); }}
                          onBlur={e=>{ const v=parseFloat(e.target.value); const val=isNaN(v)||v<0?"":String(Math.round(v)); setWeeklyBudget(val); if(bizId) saveBizSettings({weekly_budget:parseFloat(val)||null}).catch(()=>{}); }}
                          placeholder="Set budget..."
                          style={{width:130,border:`1.5px solid ${weeklyBudget&&parseFloat(weeklyBudget)>0?"#4CAF7D":T.border}`,borderRadius:8,padding:"7px 8px 7px 22px",fontSize:13,outline:"none",fontWeight:700,transition:"border 0.15s"}}/>
                      </div>
                    </div>
                    {(()=>{
                      const budget=parseFloat(weeklyBudget)||0;
                      const spent=activeWkPay;
                      const pct=budget>0?Math.min((spent/budget)*100,100):0;
                      const over=budget>0&&spent>budget;
                      const warn=!over&&pct>85;
                      const barColor=over?"#C0392B":warn?"#E8A93A":"#4CAF7D";
                      return (
                        <div>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:5}}>
                            <span style={{fontWeight:800,fontSize:15,color:over?"#C0392B":T.text}}>${spent.toFixed(0)}{budget>0&&<span style={{fontWeight:400,fontSize:11,color:T.sub}}> / ${budget.toFixed(0)}</span>}</span>
                            {budget>0&&<span style={{fontSize:11,fontWeight:700,color:barColor}}>{over?`$${(spent-budget).toFixed(0)} OVER`:`$${(budget-spent).toFixed(0)} left`}</span>}
                          </div>
                          {budget>0&&(
                            <div style={{height:7,background:T.muted,borderRadius:4,overflow:"hidden"}}>
                              <div style={{height:"100%",width:`${pct}%`,background:barColor,borderRadius:4,transition:"width 0.3s,background 0.3s"}}/>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </Card>

              {/* DAILY VIEW */}
              {schedView==="daily" && (() => {
                const dayIdx = new Date(activeDay+"T00:00:00").getDay();
                const dayDate = new Date(activeDay+"T00:00:00");
                const prevDay = addDays(activeDay,-1);
                const nextDay = addDays(activeDay,1);
                const wkForDay = weeks.find(wk => wk.dates.some(d => { const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return dt.toISOString().split("T")[0]===activeDay; }));
                const wkKey = wkForDay?.key || null; // null = activeDay not in any scheduled week
                return (
                  <div>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                      <button onClick={()=>setActiveDay(prevDay)} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"7px 14px",fontWeight:700,fontSize:13,cursor:"pointer",color:T.text}}>← Prev</button>
                      <div style={{textAlign:"center"}}>
                        <div style={{fontWeight:800,fontSize:18,color:T.text}}>{DAY_FULL[dayIdx]}</div>
                        <div style={{fontSize:12,color:T.sub}}>{dayDate.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</div>
                      </div>
                      <button onClick={()=>setActiveDay(nextDay)} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"7px 14px",fontWeight:700,fontSize:13,cursor:"pointer",color:T.text}}>Next →</button>
                    </div>
                    <div style={{background:T.surface,borderRadius:T.radius,boxShadow:T.shadowMd,overflow:"hidden"}}>
                      <div style={{background:T.dark,padding:"11px 16px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <span style={{color:"#777",fontSize:10,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Employee</span>
                        <span style={{color:"#777",fontSize:10,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Shift</span>
                        <span style={{color:T.accent,fontSize:10,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Hours · Pay</span>
                      </div>
                      {!wkKey&&<div style={{padding:"24px",textAlign:"center",color:T.sub,fontSize:13,background:"#FEF3E2",borderBottom:`1px solid ${T.border}`}}>📅 This date isn't part of your configured schedule weeks. Set your week dates in the Schedule tab.</div>}
                      {employees.length===0&&<div style={{padding:"40px 24px",textAlign:"center",color:T.sub,fontSize:13}}>No employees added yet.</div>}
                      {employees.map((emp,i)=>{
                        const shift = getShift(wkKey,emp.id,dayIdx);
                        const h = shiftHrs(shift);
                        const pay = h*(parseFloat(emp.hourlyRate)||0);
                        const availDays = emp.availableDays??[0,1,2,3,4,5,6];
                        const isDayAvail = availDays.includes(dayIdx);
                        const st = SHIFT_TYPES.find(s=>s.id===toTypeArr(shift?.type)[0])||SHIFT_TYPES[0];
                        return (
                          <div key={emp.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",borderBottom:i<employees.length-1?`1px solid ${T.border}`:"none",background:i%2===0?T.surface:T.bg}}>
                            <div style={{display:"flex",alignItems:"center",gap:10,minWidth:120}}>
                              <div style={{width:34,height:34,borderRadius:"50%",background:emp.color,display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:800,fontSize:13,flexShrink:0}}>{emp.name?emp.name[0].toUpperCase():"?"}</div>
                              <div>
                                <div style={{fontWeight:700,fontSize:13,color:T.text}}>{emp.name||"New"}</div>
                                <div style={{fontSize:10,color:T.sub}}>${emp.hourlyRate||0}/hr</div>
                              </div>
                            </div>
                            <div style={{flex:1,margin:"0 16px",textAlign:"center"}}>
                              {!isDayAvail?(<span style={{fontSize:12,color:T.sub,fontStyle:"italic"}}>🚫 Unavailable</span>):shift?(
                                <div>
                                  <div style={{display:"inline-flex",alignItems:"center",gap:6,background:emp.color+"18",borderRadius:8,padding:"6px 12px"}}>
                                    <div style={{width:8,height:8,borderRadius:"50%",background:st.color,flexShrink:0}}/>
                                    <span style={{fontWeight:700,fontSize:12,color:emp.color}}>{st.label}</span>
                                    <span style={{fontSize:12,color:T.text,fontWeight:600}}>{fmt(shift.start)} – {fmt(shift.end)}</span>
                                  </div>
                                  {shift.notes&&<div style={{fontSize:10,color:T.sub,marginTop:4,fontStyle:"italic"}}>{shift.notes}</div>}
                                </div>
                              ):(
                                <button onClick={()=>{ if(!wkKey){showToast("Set up this week's schedule dates first");return;} setActiveWeek(wkKey); setSchedView("weekly"); setOpenCell({empId:emp.id,weekKey:wkKey,dayIdx,isNew:true}); }}
                                  style={{background:T.muted,border:`1.5px dashed ${T.border}`,borderRadius:8,padding:"7px 16px",fontSize:12,color:T.sub,cursor:"pointer",fontWeight:600}}>
                                  + Add Shift
                                </button>
                              )}
                            </div>
                            <div style={{textAlign:"right",minWidth:70}}>
                              {shift?(<><div style={{fontWeight:800,fontSize:14,color:T.text}}>{h}h</div><div style={{fontSize:11,color:T.accent,fontWeight:700}}>${pay.toFixed(0)}</div></>):<span style={{color:T.border,fontSize:12}}>—</span>}
                            </div>
                          </div>
                        );
                      })}
                      {employees.length>0&&wkKey&&(
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",background:T.dark,borderTop:`2px solid ${T.border}`}}>
                          <span style={{color:"#777",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>Day Total</span>
                          <div style={{display:"flex",gap:16}}>
                            <span style={{color:T.accent,fontWeight:800,fontSize:14}}>{employees.reduce((s,e)=>s+shiftHrs(getShift(wkKey,e.id,dayIdx)),0)}h</span>
                            <span style={{color:T.accent,fontWeight:700,fontSize:13}}>${employees.reduce((s,e)=>{const h=shiftHrs(getShift(wkKey,e.id,dayIdx));return s+h*(parseFloat(e.hourlyRate)||0);},0).toFixed(0)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* MONTHLY VIEW */}
              {schedView==="monthly" && (() => {
                const anchor = new Date(wk1Start+"T00:00:00");
                const year = anchor.getFullYear();
                const month = anchor.getMonth();
                const firstOfMonth = new Date(year,month,1);
                const lastOfMonth = new Date(year,month+1,0);
                const startPad = firstOfMonth.getDay();
                const totalDays = lastOfMonth.getDate();
                const monthName = firstOfMonth.toLocaleDateString("en-US",{month:"long",year:"numeric"});
                return (
                  <div>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                      <button onClick={()=>{ const d=new Date(year,month-1,1); setWk1Start(getSunday(d.toISOString().split("T")[0])); }} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"7px 14px",fontWeight:700,fontSize:13,cursor:"pointer",color:T.text}}>← Prev</button>
                      <div style={{fontWeight:800,fontSize:18,color:T.text}}>{monthName}</div>
                      <button onClick={()=>{ const d=new Date(year,month+1,1); setWk1Start(getSunday(d.toISOString().split("T")[0])); }} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"7px 14px",fontWeight:700,fontSize:13,cursor:"pointer",color:T.text}}>Next →</button>
                    </div>
                    <div style={{background:T.surface,borderRadius:T.radius,boxShadow:T.shadowMd,overflow:"hidden"}}>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",background:T.dark}}>
                        {DAYS.map(d=><div key={d} style={{padding:"8px 4px",textAlign:"center",fontSize:10,fontWeight:700,color:"#777",letterSpacing:"0.08em"}}>{d}</div>)}
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:1,background:T.border}}>
                        {Array.from({length:startPad}).map((_,i)=>(<div key={"pad"+i} style={{background:T.bg,minHeight:80}}/>))}
                        {Array.from({length:totalDays}).map((_,i)=>{
                          const dayNum = i+1;
                          const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(dayNum).padStart(2,"0")}`;
                          const dayOfWeek = new Date(dateStr+"T00:00:00").getDay();
                          const isToday = dateStr===new Date().toISOString().split("T")[0];
                          const isActive = dateStr===activeDay;
                          const wkForDay = weeks.find(wk=>wk.dates.some(d=>{ const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return dt.toISOString().split("T")[0]===dateStr; }));
                          const wkKey = wkForDay?.key;
                          const shiftsToday = wkKey ? employees.filter(e=>{ const availDays=e.availableDays??[0,1,2,3,4,5,6]; return availDays.includes(dayOfWeek)&&getShift(wkKey,e.id,dayOfWeek); }) : [];
                          return (
                            <div key={dateStr} onClick={()=>{ setActiveDay(dateStr); setSchedView("daily"); }}
                              style={{background:isActive?T.accent+"18":T.surface,minHeight:80,padding:"6px 8px",cursor:"pointer",border:isToday?`2px solid ${T.accent}`:"none",transition:"background 0.1s",position:"relative"}}>
                              <div style={{fontWeight:isToday?800:600,fontSize:13,color:isToday?T.accent:T.text,marginBottom:4}}>{dayNum}</div>
                              <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
                                {shiftsToday.slice(0,6).map(emp=>(<div key={emp.id} style={{width:8,height:8,borderRadius:"50%",background:emp.color,flexShrink:0}} title={emp.name}/>))}
                                {shiftsToday.length>6&&<div style={{fontSize:8,color:T.sub,fontWeight:700}}>+{shiftsToday.length-6}</div>}
                              </div>
                              {wkKey&&shiftsToday.length>0&&(
                                <div style={{position:"absolute",bottom:5,right:6,fontSize:9,color:T.sub,fontWeight:600}}>
                                  {shiftsToday.reduce((s,e)=>s+shiftHrs(getShift(wkKey,e.id,dayOfWeek)),0)}h
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{marginTop:8,fontSize:11,color:T.sub,textAlign:"center"}}>Tap any day to see the full schedule for that day</div>
                  </div>
                );
              })()}

              {/* WEEKLY VIEW */}
              {schedView==="weekly" && <>
                {!activeWeek && (
                  <div style={{background:T.surface,borderRadius:T.radius,boxShadow:T.shadow,padding:"52px 28px",textAlign:"center",border:`2px dashed ${T.border}`}}>
                    <div style={{fontSize:36,marginBottom:12}}>📅</div>
                    <div style={{fontWeight:700,fontSize:16,color:T.text,marginBottom:8}}>Select a week to get started</div>
                    <div style={{fontSize:13,color:T.sub,lineHeight:1.6}}>Tap a date range button above to load your schedule, or use the 📅 icon to jump to a specific week.</div>
                  </div>
                )}
                {activeWeek && <div className="grid-scroll" style={{borderRadius:T.radius,boxShadow:T.shadowMd}}>
                  <table className="sched-table" style={{borderCollapse:"collapse",width:"100%",background:T.surface,minWidth:560}}>
                    <colgroup>
                      <col style={{width:110}}/>{DAYS.map(d=><col key={d}/>)}<col style={{width:76}}/>
                    </colgroup>
                    <thead>
                      <tr style={{background:T.dark}}>
                        <th style={{padding:"11px 12px",textAlign:"left",color:"#666",fontSize:10,fontWeight:700,letterSpacing:"0.08em"}}>EMPLOYEE</th>
                        {DAYS.map((d,i)=>{
                          const dh=employees.reduce((s,e)=>s+eDayH(activeWeek,e.id,i),0);
                          return (
                            <th key={d} style={{padding:"9px 4px",textAlign:"center",color:"white",fontSize:11,fontWeight:700}}>
                              <div>{d}</div>
                              <div style={{fontSize:9,color:"#666",fontWeight:400}}>{activeWkObj?dl(activeWkObj.dates[i]):""}</div>
                              {dh>0&&<div style={{fontSize:9,color:T.accent,fontWeight:700,marginTop:1}}>{dh}h</div>}
                            </th>
                          );
                        })}
                        <th style={{padding:"9px 6px",textAlign:"center",color:T.accent,fontSize:10,fontWeight:700,letterSpacing:"0.06em"}}>HRS<br/>PAY</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.length===0&&(
                        <tr><td colSpan={9} style={{padding:"52px 24px",textAlign:"center"}}>
                          <div style={{fontSize:32,marginBottom:10}}>👥</div>
                          <div style={{fontWeight:700,fontSize:14,color:T.sub,marginBottom:6}}>No team members yet</div>
                          <div style={{fontSize:12,color:"#bbb"}}>Go to the <strong style={{color:T.text}}>Settings</strong> tab to add your roster.</div>
                        </td></tr>
                      )}
                      {employees.map((emp,ei)=>{
                        const wH=eWkH(activeWeek,emp.id), wP=eWkP(activeWeek,emp);
                        const avail=parseFloat(emp.availableHours)||0;
                        const overAvail=avail>0&&wH>avail;
                        return (
                          <tr key={emp.id} style={{borderBottom:`1px solid ${T.border}`,background:ei%2===0?T.surface:"#FDFCFA"}}>
                            <td className="emp-name-cell" style={{padding:"9px 12px",verticalAlign:"middle",minWidth:100,maxWidth:120}}>
                              <div style={{display:"flex",alignItems:"center",gap:7}}>
                                <div style={{width:26,height:26,borderRadius:"50%",background:emp.color,display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:800,fontSize:10,flexShrink:0}}>{emp.name?emp.name[0].toUpperCase():"?"}</div>
                                <div style={{minWidth:0}}>
                                  <div style={{fontWeight:700,fontSize:12,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{emp.name||"New"}</div>
                                </div>
                              </div>
                            </td>
                            {DAYS.map((_,di)=>{
                              const shift=getShift(activeWeek,emp.id,di);
                              const h=shiftHrs(shift);
                              const pay=h*(parseFloat(emp.hourlyRate)||0);
                              const types=toTypeArr(shift?.type); const st=SHIFT_TYPES.find(s=>s.id===types[0])||SHIFT_TYPES[0];
                              const availDays = emp.availableDays ?? [0,1,2,3,4,5,6];
                              const isDayAvail = availDays.includes(di);
                              return (
                                <td key={di} style={{padding:"4px 3px",textAlign:"center",verticalAlign:"middle",position:"relative",
                                  background:!isDayAvail?`repeating-linear-gradient(45deg,${T.muted},${T.muted} 3px,${T.bg} 3px,${T.bg} 8px)`:"transparent"}}>
                                  {!isDayAvail ? (
                                    <div style={{minHeight:54,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,opacity:0.6}}>
                                      <span style={{fontSize:12}}>🚫</span>
                                      <span style={{fontSize:8,color:T.sub,fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase"}}>Unavail.</span>
                                    </div>
                                  ) : shift ? (
                                    <div style={{position:"relative"}}
                                      draggable
                                      onDragStart={e=>{ e.dataTransfer.effectAllowed="move"; setDraggedShift({empId:emp.id,weekKey:activeWeek,dayIdx:di,shift}); }}
                                      onDragEnd={()=>{ setDraggedShift(null); setDragOverCell(null); }}>
                                      <div className="shift-badge" onClick={()=>setOpenCell({empId:emp.id,weekKey:activeWeek,dayIdx:di})}
                                        style={{background:emp.color,color:"white",borderRadius:8,padding:"5px 3px",cursor:"grab",fontSize:10,lineHeight:1.35,transition:"opacity 0.12s",opacity:draggedShift?.empId===emp.id&&draggedShift?.dayIdx===di?0.4:1}}>
                                        <div style={{background:"rgba(255,255,255,0.22)",borderRadius:4,padding:"2px 4px",fontSize:8,fontWeight:800,marginBottom:3,letterSpacing:"0.05em",color:"white"}}>
                                          {types.length>1?`${st.label} +${types.length-1}`:st.label.toUpperCase()}
                                        </div>
                                        <div style={{fontWeight:800,fontSize:10}}>{fmt(shift.start)}</div>
                                        <div style={{opacity:0.85,fontSize:9}}>–{fmt(shift.end)}</div>
                                        <div style={{fontWeight:800,fontSize:11,marginTop:2}}>{h}h</div>
                                        {shift.notes&&<div style={{fontSize:9,opacity:0.8,marginTop:1}}>📝</div>}
                                      </div>
                                      <button onClick={()=>{setShift(activeWeek,emp.id,di,null);setOpenCell(null);}}
                                        style={{position:"absolute",top:2,right:2,background:"rgba(0,0,0,0.25)",color:"white",border:"none",borderRadius:"50%",width:14,height:14,fontSize:10,cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>×</button>
                                    </div>
                                  ) : (
                                    <div
                                      onDragOver={e=>{ if(draggedShift&&draggedShift.empId===emp.id) { e.preventDefault(); setDragOverCell({empId:emp.id,dayIdx:di}); }}}
                                      onDragLeave={()=>setDragOverCell(null)}
                                      onDrop={e=>{
                                        e.preventDefault();
                                        if(!draggedShift||draggedShift.empId!==emp.id||draggedShift.dayIdx===di) return;
                                        // Show copy/move popup at drop location
                                        setDropIntent({
                                          empId: emp.id,
                                          fromDayIdx: draggedShift.dayIdx,
                                          toDayIdx: di,
                                          weekKey: activeWeek,
                                          shift: draggedShift.shift,
                                          x: e.clientX,
                                          y: e.clientY,
                                        });
                                        setDraggedShift(null);
                                        setDragOverCell(null);
                                      }}
                                      style={{width:"100%",minHeight:54}}>
                                      <button className="add-shift-btn" onClick={()=>toggleShift(activeWeek,emp.id,di)}
                                        style={{width:"100%",minHeight:54,background:dragOverCell?.empId===emp.id&&dragOverCell?.dayIdx===di?T.accent+"18":"transparent",border:`1.5px dashed ${dragOverCell?.empId===emp.id&&dragOverCell?.dayIdx===di?T.accent:T.border}`,borderRadius:8,color:dragOverCell?.empId===emp.id&&dragOverCell?.dayIdx===di?T.accent:"#C8C3BC",fontSize:20,cursor:"pointer",transition:"all 0.15s"}}>
                                        {dragOverCell?.empId===emp.id&&dragOverCell?.dayIdx===di?"↓":"+"}
                                      </button>
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                            <td style={{padding:"8px 6px",textAlign:"center",verticalAlign:"middle"}}>
                              <div style={{fontWeight:800,fontSize:13,color:overAvail||wH>40?"#C0392B":T.text}}>{wH}h</div>
                              {avail>0&&<div style={{fontSize:9,color:overAvail?"#C0392B":wH>=avail*0.85?"#E8A93A":T.sub,fontWeight:600}}>/{avail}h</div>}
                              <div style={{fontSize:10,color:T.accent,fontWeight:700}}>${wP.toFixed(0)}</div>
                              {overAvail&&<div style={{fontSize:8,color:"#C0392B",fontWeight:800,marginTop:1}}>OVER</div>}
                              {!overAvail&&wH>40&&<div style={{fontSize:8,color:"#C0392B",fontWeight:700}}>OT</div>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{background:T.dark}}>
                        <td style={{padding:"10px 12px",color:"#777",fontWeight:700,fontSize:10,letterSpacing:"0.06em"}}>TOTALS</td>
                        {DAYS.map((_,i)=>{
                          const dh=employees.reduce((s,e)=>s+eDayH(activeWeek,e.id,i),0);
                          return (
                            <td key={i} style={{padding:"10px 3px",textAlign:"center",fontWeight:700}}>
                              {dh>0?<><div style={{color:T.accent,fontSize:11}}>{dh}h</div></>:<span style={{color:"#3A3A3A"}}>—</span>}
                            </td>
                          );
                        })}
                        <td style={{padding:"10px 6px",textAlign:"center"}}>
                          <div style={{color:T.accent,fontWeight:800,fontSize:12}}>{employees.reduce((s,e)=>s+eWkH(activeWeek,e.id),0)}h</div>
                          <div style={{color:T.accent,fontWeight:700,fontSize:11}}>${activeWkPay.toFixed(0)}</div>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>}
                {activeWeek && <div style={{marginTop:8,fontSize:11,color:T.sub,textAlign:"center"}}>Tap <strong>+</strong> to add a shift · Tap a shift to edit · Tap <strong>×</strong> to remove · <strong>Drag</strong> a shift to move it</div>}
              </>}
            </>}
            </div>
          )}

          {/* COVERAGE */}
          {tab==="coverage" && (()=>{
            const today = new Date();
            const todayIdx = today.getDay();
            const todayStr = today.toISOString().split("T")[0];
            const nowDec = today.getHours() + today.getMinutes()/60;

            // ── Helpers ──────────────────────────────────────────────────────
            // Find which week key contains a given date
            function weekKeyForDate(dateStr) {
              for (const wk of weeks) {
                const dates = wk.dates.map(d => { const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return dt.toISOString().split("T")[0]; });
                if (dates.includes(dateStr)) return { weekKey: wk.key, dayIdx: dates.indexOf(dateStr) };
              }
              return null;
            }

            const todayWk = weekKeyForDate(todayStr);
            // Only look up shifts if today is actually within a configured week
            const todayWeekKey = todayWk?.weekKey ?? null;
            const todayDayIdx  = todayWk?.dayIdx  ?? todayIdx;
            const todayInSchedule = todayWk !== null;

            // Build today's full shift status list
            const todayShifts = employees.map(emp => {
              if (!todayInSchedule) return null; // today not in any scheduled week
              const shift = schedule?.[todayWeekKey]?.[emp.id]?.[todayDayIdx] || null;
              if (!shift) return null;

              // Check if this shift is marked open
              const openEntry = openShifts.find(o =>
                o.weekKey === todayWeekKey && o.empId === emp.id && o.dayIdx === todayDayIdx && o.status !== "cancelled"
              );

              // Find punch activity for this employee today
              const empPunches = punches.filter(p => {
                const pd = new Date(p.time);
                return p.empId === emp.id && pd.toDateString() === today.toDateString();
              });
              const lastPunchEntry = empPunches.length ? empPunches[empPunches.length-1] : null;
              const clockedIn = lastPunchEntry?.type === "in" || lastPunchEntry?.type === "break_in";
              const clockedOut = lastPunchEntry?.type === "out";

              // Determine status
              let status = "scheduled";
              if (openEntry) {
                status = openEntry.status === "claimed" ? "claimed" : "open";
              } else if (clockedOut) {
                status = "completed";
              } else if (clockedIn) {
                status = "active";
              } else if (nowDec > shift.start + 0.25 && !clockedIn && !clockedOut) {
                status = "late";
              } else if (nowDec > shift.end) {
                status = "missed";
              }

              // Actual hours from punches
              let actualHours = 0;
              let inTime = null;
              for (const p of empPunches) {
                if (p.type === "in" || p.type === "break_in") inTime = new Date(p.time);
                else if ((p.type === "out") && inTime) {
                  actualHours += (new Date(p.time) - inTime) / 3600000;
                  inTime = null;
                }
              }
              if (clockedIn && inTime) actualHours += (today - inTime) / 3600000; // still on shift

              return { emp, shift, status, openEntry, empPunches, clockedIn, clockedOut, lastPunchEntry, actualHours: parseFloat(actualHours.toFixed(2)) };
            }).filter(Boolean);

            // Rank replacement candidates for an open shift
            function rankCandidates(openEntry) {
              if (!openEntry) return [];
              const { dayIdx, weekKey, empId } = openEntry;
              return employees
                .filter(e => e.id !== empId)
                .map(e => {
                  const availDays = e.availableDays ?? [0,1,2,3,4,5,6];
                  const isAvailable = availDays.includes(dayIdx);
                  const alreadyWorking = !!schedule?.[weekKey]?.[e.id]?.[dayIdx];
                  const wkHours = eWkH(weekKey, e.id);
                  const availHours = parseFloat(e.availableHours) || 40;
                  const hoursNeeded = shiftHrs(openEntry.originalShift);
                  const wouldOvertime = wkHours + hoursNeeded > 40;
                  const nearLimit = wkHours + hoursNeeded > availHours;
                  const hasWorkedThisType = Object.values(schedule?.[weekKey]?.[e.id] || {}).some(s =>
                    toTypeArr(s?.type).some(t => toTypeArr(openEntry.originalShift?.type).includes(t))
                  );
                  // Score: available days (40) + not already working (20) + has hours (20) + experience (10) + no overtime (10)
                  let score = 0;
                  if (isAvailable)      score += 40;
                  if (!alreadyWorking)  score += 20;
                  if (!wouldOvertime)   score += 20;
                  if (!nearLimit)       score += 10;
                  if (hasWorkedThisType) score += 10;
                  return { emp: e, score, isAvailable, alreadyWorking, wkHours, wouldOvertime, hasWorkedThisType };
                })
                .filter(c => c.isAvailable && !c.alreadyWorking)
                .sort((a, b) => b.score - a.score);
            }

            // Status display config
            const statusConfig = {
              scheduled:  { label:"Scheduled",  color:"#3A9BE8", bg:"#EBF5FF",  icon:"📅" },
              active:     { label:"On Shift",   color:"#4CAF7D", bg:"#F0FFF4",  icon:"✅" },
              completed:  { label:"Completed",  color:"#6B7B6E", bg:"#F0F0F0",  icon:"✓"  },
              late:       { label:"Late",        color:"#E8A93A", bg:"#FEF3E2",  icon:"⏰" },
              missed:     { label:"Missed",      color:"#C0392B", bg:"#FDECEA",  icon:"🚨" },
              open:       { label:"Open Shift",  color:"#C0392B", bg:"#FDECEA",  icon:"🔴" },
              claimed:    { label:"Claimed",     color:"#9B59B6", bg:"#F5EEFF",  icon:"🙋" },
            };

            const openCount  = openShifts.filter(o => o.status === "open" && weeks.some(w => w.key === o.weekKey)).length;
            const activeCount = todayShifts.filter(s => s.status === "active").length;
            const lateCount  = todayShifts.filter(s => s.status === "late").length;

            // Mark a shift open (callout)
            function markOpen(empId, dayIdx, weekKey, reason) {
              const shift = schedule?.[weekKey]?.[empId]?.[dayIdx];
              if (!shift) return;
              const existing = openShifts.find(o => o.weekKey===weekKey && o.empId===empId && o.dayIdx===dayIdx && o.status!=="cancelled");
              if (existing) return;
              const entry = {
                id: Date.now().toString(),
                weekKey, empId, dayIdx,
                originalShift: shift,
                reason: reason || "Called out",
                status: "open",
                createdAt: new Date().toISOString(),
                claimedBy: null,
              };
              setOpenShifts(p => [...p, entry]);
              addAudit("Shift Opened", `${employees.find(e=>e.id===empId)?.name} — ${DAY_FULL[dayIdx]} shift marked open`);
              showToast("Shift marked open ✓");
            }

            function markClaimed(openId, claimedByEmpId) {
              const claimer = employees.find(e => e.id === claimedByEmpId);
              setOpenShifts(p => p.map(o => o.id===openId ? {...o, status:"claimed", claimedBy:claimedByEmpId} : o));
              addAudit("Shift Claimed", `${claimer?.name} claimed open shift`);
              showToast(`${claimer?.name} assigned ✓`);
            }

            function cancelOpen(openId) {
              setOpenShifts(p => p.map(o => o.id===openId ? {...o, status:"cancelled"} : o));
              showToast("Open shift cancelled");
            }

            // Week-level open shifts (all weeks)
            const allOpenShifts = openShifts.filter(o =>
              (o.status === "open" || o.status === "claimed") &&
              weeks.some(w => w.key === o.weekKey)
            );

            return (
              <div style={{maxWidth:720, display:"flex", flexDirection:"column", gap:16}}>

                {/* Header */}
                <div>
                  <h2 style={{margin:"0 0 4px", fontSize:20, fontWeight:800, color:T.text}}>Coverage</h2>
                  <p style={{margin:0, fontSize:12, color:T.sub}}>Live schedule vs reality — manage callouts, open shifts, and replacements.</p>
                </div>

                {/* Status bar */}
                <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10}}>
                  {[
                    { label:"On Shift Now",  value:activeCount, color:"#4CAF7D", icon:"✅" },
                    { label:"Late / No Show",value:lateCount,   color:"#E8A93A", icon:"⏰" },
                    { label:"Open Shifts",   value:openCount,   color:"#C0392B", icon:"🔴" },
                  ].map(s => (
                    <div key={s.label} style={{background:T.surface, borderRadius:T.radius, boxShadow:T.shadow, padding:"14px 16px", borderLeft:`4px solid ${s.color}`}}>
                      <div style={{fontSize:10, fontWeight:700, color:T.sub, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:4}}>{s.label}</div>
                      <div style={{fontSize:28, fontWeight:900, color:s.value>0?s.color:T.sub, lineHeight:1}}>{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* TODAY'S COVERAGE BOARD */}
                <div style={{background:T.surface, borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden"}}>
                  <div style={{background:T.dark, padding:"11px 18px", display:"flex", alignItems:"center", justifyContent:"space-between"}}>
                    <div>
                      <span style={{color:"white", fontWeight:800, fontSize:14}}>Today's Shifts</span>
                      <span style={{color:"#666", fontSize:11, marginLeft:10}}>
                        {today.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
                      </span>
                    </div>
                    <span style={{color:T.accent, fontSize:11, fontWeight:700}}>
                      {todayShifts.filter(s=>s.status==="active").length} active · {todayShifts.length} total
                    </span>
                  </div>

                  {todayShifts.length === 0 && (
                    <div style={{padding:"40px 24px", textAlign:"center", color:T.sub}}>
                      <div style={{fontSize:32, marginBottom:10}}>📅</div>
                      <div style={{fontWeight:700, fontSize:14, marginBottom:6}}>No shifts scheduled today</div>
                      <div style={{fontSize:12}}>Head to the Schedule tab to add shifts for {DAY_FULL[todayIdx]}.</div>
                    </div>
                  )}

                  {todayShifts.map((item, i) => {
                    const { emp, shift, status, openEntry, actualHours } = item;
                    const cfg = statusConfig[status] || statusConfig.scheduled;
                    const scheduled = shiftHrs(shift);
                    const delta = actualHours - scheduled;
                    const candidates = (status === "open") ? rankCandidates(openEntry) : [];

                    return (
                      <div key={emp.id} style={{borderBottom: i<todayShifts.length-1 ? `1px solid ${T.border}` : "none"}}>
                        {/* Main row */}
                        <div style={{display:"flex", alignItems:"center", gap:12, padding:"13px 18px", background:status==="open"?"#FDECEA20":status==="active"?"#F0FFF420":"transparent"}}>
                          {/* Avatar */}
                          <div style={{width:40, height:40, borderRadius:"50%", background:emp.color, display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontWeight:800, fontSize:15, flexShrink:0}}>
                            {emp.name?emp.name[0].toUpperCase():"?"}
                          </div>

                          {/* Employee + shift info */}
                          <div style={{flex:1, minWidth:0}}>
                            <div style={{display:"flex", alignItems:"center", gap:8, flexWrap:"wrap"}}>
                              <span style={{fontWeight:700, fontSize:13, color:T.text}}>{emp.name}</span>
                              <span style={{background:cfg.bg, color:cfg.color, border:`1px solid ${cfg.color}30`, borderRadius:6, padding:"2px 8px", fontSize:10, fontWeight:700}}>
                                {cfg.icon} {cfg.label}
                              </span>
                              {status==="late" && (
                                <span style={{fontSize:10, color:"#E8A93A", fontWeight:600}}>
                                  {Math.round((nowDec - shift.start)*60)}m late
                                </span>
                              )}
                            </div>
                            <div style={{fontSize:11, color:T.sub, marginTop:3, display:"flex", gap:12, flexWrap:"wrap"}}>
                              <span>{fmt(shift.start)} – {fmt(shift.end)} · {scheduled}h scheduled</span>
                              {actualHours > 0 && <span style={{color:delta<-0.25?"#C0392B":delta>0.25?"#E8A93A":"#4CAF7D", fontWeight:600}}>{actualHours.toFixed(1)}h actual</span>}
                              {openEntry?.reason && <span style={{color:"#C0392B"}}>"{openEntry.reason}"</span>}
                              {openEntry?.claimedBy && <span style={{color:"#9B59B6", fontWeight:600}}>→ {employees.find(e=>e.id===openEntry.claimedBy)?.name}</span>}
                            </div>
                          </div>

                          {/* Actions */}
                          <div style={{display:"flex", gap:6, flexShrink:0}}>
                            {(status==="scheduled"||status==="late") && (
                              <button onClick={()=>{
                                const reason = window.prompt(`Why is ${emp.name} calling out?`, "Called out");
                                if (reason !== null) markOpen(emp.id, todayDayIdx, todayWeekKey, reason);
                              }} style={{background:"#FDECEA", color:"#C0392B", border:"none", borderRadius:8, padding:"6px 12px", fontSize:11, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap"}}>
                                Mark Open
                              </button>
                            )}
                            {status==="open" && (
                              <button onClick={()=>cancelOpen(openEntry.id)} style={{background:T.muted, color:T.sub, border:"none", borderRadius:8, padding:"6px 10px", fontSize:11, fontWeight:700, cursor:"pointer"}}>
                                Cancel
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Replacement candidates — shown when shift is open */}
                        {status==="open" && (
                          <div style={{background:"#FEF3E2", borderTop:`1px solid #E8A93A20`, padding:"12px 18px"}}>
                            <div style={{fontSize:10, fontWeight:700, color:"#E67E22", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:10}}>
                              ⚡ Suggested Replacements
                            </div>
                            {candidates.length === 0 ? (
                              <div style={{fontSize:12, color:"#E67E22"}}>No available staff found — consider reaching out manually.</div>
                            ) : (
                              <div style={{display:"flex", flexDirection:"column", gap:8}}>
                                {candidates.slice(0,3).map((c, ci) => (
                                  <div key={c.emp.id} style={{display:"flex", alignItems:"center", gap:10, background:"white", borderRadius:9, padding:"10px 14px", border:`1px solid ${ci===0?"#E8A93A":"#E8E4DF"}`}}>
                                    <div style={{width:30, height:30, borderRadius:"50%", background:c.emp.color, display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontWeight:800, fontSize:12, flexShrink:0}}>
                                      {c.emp.name?c.emp.name[0].toUpperCase():"?"}
                                    </div>
                                    <div style={{flex:1, minWidth:0}}>
                                      <div style={{fontWeight:700, fontSize:12, color:T.text, display:"flex", alignItems:"center", gap:6}}>
                                        {c.emp.name}
                                        {ci===0 && <span style={{background:"#E8A93A", color:"white", borderRadius:4, padding:"1px 6px", fontSize:9, fontWeight:700}}>BEST MATCH</span>}
                                      </div>
                                      <div style={{fontSize:10, color:T.sub, marginTop:2, display:"flex", gap:8, flexWrap:"wrap"}}>
                                        <span>{c.wkHours}h this week</span>
                                        {c.hasWorkedThisType && <span style={{color:"#4CAF7D"}}>✓ experience</span>}
                                        {c.wouldOvertime && <span style={{color:"#C0392B"}}>⚠ OT risk</span>}
                                      </div>
                                    </div>
                                    <div style={{display:"flex", gap:6}}>
                                      {/* Copy message button */}
                                      <button onClick={()=>{
                                        const msg = `Hi ${c.emp.name}! ${emp.name} can't make their ${fmt(shift.start)}–${fmt(shift.end)} shift today. Can you cover? Let me know ASAP. — ${biz}`;
                                        navigator.clipboard?.writeText(msg).then(()=>showToast("Message copied to clipboard ✓")).catch(()=>showToast(msg, 6000));
                                      }} style={{background:T.muted, color:T.sub, border:"none", borderRadius:7, padding:"6px 10px", fontSize:10, fontWeight:700, cursor:"pointer"}}>
                                        Copy msg
                                      </button>
                                      {/* Assign button */}
                                      <button onClick={()=>markClaimed(openEntry.id, c.emp.id)}
                                        style={{background:ci===0?T.accent:T.dark, color:"white", border:"none", borderRadius:7, padding:"6px 12px", fontSize:11, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap"}}>
                                        Assign
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* WEEK OPEN SHIFTS — all open/claimed across all schedule weeks */}
                {allOpenShifts.length > 0 && (
                  <div style={{background:T.surface, borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden"}}>
                    <div style={{background:T.dark, padding:"11px 18px", display:"flex", alignItems:"center", justifyContent:"space-between"}}>
                      <span style={{color:"white", fontWeight:800, fontSize:14}}>Open Shifts This Period</span>
                      <span style={{background:"#C0392B", color:"white", borderRadius:10, padding:"2px 9px", fontSize:11, fontWeight:700}}>{allOpenShifts.length}</span>
                    </div>
                    {allOpenShifts.map((o, i) => {
                      const emp = employees.find(e=>e.id===o.empId);
                      const wk = weeks.find(w=>w.key===o.weekKey);
                      const date = wk?.dates[o.dayIdx];
                      const dateStr = date ? (typeof date==="string"?new Date(date+"T00:00:00"):date).toLocaleDateString("en-US",{month:"short",day:"numeric"}) : DAY_FULL[o.dayIdx];
                      const claimer = o.claimedBy ? employees.find(e=>e.id===o.claimedBy) : null;
                      const candidates = o.status==="open" ? rankCandidates(o) : [];

                      return (
                        <div key={o.id} style={{borderBottom: i<allOpenShifts.length-1?`1px solid ${T.border}`:"none"}}>
                          <div style={{display:"flex", alignItems:"center", gap:12, padding:"13px 18px", background:o.status==="claimed"?"#F5EEFF20":"#FDECEA10"}}>
                            <div style={{width:36, height:36, borderRadius:"50%", background:emp?.color||T.muted, display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontWeight:800, fontSize:13, flexShrink:0}}>
                              {emp?.name?emp.name[0].toUpperCase():"?"}
                            </div>
                            <div style={{flex:1, minWidth:0}}>
                              <div style={{fontWeight:700, fontSize:13, color:T.text, display:"flex", gap:8, alignItems:"center", flexWrap:"wrap"}}>
                                {emp?.name || "Unknown"}
                                <span style={{background:o.status==="claimed"?"#F5EEFF":"#FDECEA", color:o.status==="claimed"?"#9B59B6":"#C0392B", border:`1px solid ${o.status==="claimed"?"#9B59B6":"#C0392B"}30`, borderRadius:5, padding:"1px 7px", fontSize:9, fontWeight:700}}>
                                  {o.status==="claimed"?"🙋 CLAIMED":"🔴 OPEN"}
                                </span>
                              </div>
                              <div style={{fontSize:11, color:T.sub, marginTop:2}}>
                                {dateStr} · {fmt(o.originalShift?.start)}–{fmt(o.originalShift?.end)} · {shiftHrs(o.originalShift)}h
                                {o.reason && <span style={{marginLeft:8, color:T.sub, fontStyle:"italic"}}>"{o.reason}"</span>}
                                {claimer && <span style={{marginLeft:8, color:"#9B59B6", fontWeight:600}}>→ {claimer.name} covering</span>}
                              </div>
                            </div>
                            <div style={{display:"flex", gap:6, flexShrink:0}}>
                              {o.status==="open" && candidates.length>0 && (
                                <button onClick={()=>{
                                  const top = candidates[0];
                                  if(window.confirm(`Assign ${top.emp.name} to cover this shift?`)) markClaimed(o.id, top.emp.id);
                                }} style={{background:T.accent, color:"white", border:"none", borderRadius:8, padding:"6px 12px", fontSize:11, fontWeight:700, cursor:"pointer"}}>
                                  Quick Assign
                                </button>
                              )}
                              <button onClick={()=>cancelOpen(o.id)} style={{background:T.muted, color:T.sub, border:"none", borderRadius:8, padding:"6px 10px", fontSize:11, fontWeight:700, cursor:"pointer"}}>
                                Dismiss
                              </button>
                            </div>
                          </div>

                          {/* Candidates for future open shifts */}
                          {o.status==="open" && candidates.length>0 && (
                            <div style={{background:T.muted, padding:"10px 18px", display:"flex", gap:8, flexWrap:"wrap", alignItems:"center"}}>
                              <span style={{fontSize:10, fontWeight:700, color:T.sub, textTransform:"uppercase", letterSpacing:"0.06em"}}>Top picks:</span>
                              {candidates.slice(0,3).map(c=>(
                                <div key={c.emp.id} style={{display:"flex", alignItems:"center", gap:6, background:T.surface, borderRadius:7, padding:"5px 10px", border:`1px solid ${T.border}`}}>
                                  <div style={{width:20, height:20, borderRadius:"50%", background:c.emp.color, display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontSize:9, fontWeight:800}}>{c.emp.name?c.emp.name[0]:""}</div>
                                  <span style={{fontSize:11, fontWeight:600, color:T.text}}>{c.emp.name}</span>
                                  <span style={{fontSize:10, color:T.sub}}>{c.wkHours}h</span>
                                  <button onClick={()=>markClaimed(o.id, c.emp.id)}
                                    style={{background:T.accent+"15", color:T.accent, border:`1px solid ${T.accent}30`, borderRadius:5, padding:"2px 7px", fontSize:10, fontWeight:700, cursor:"pointer"}}>
                                    Assign
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* SCHEDULE vs REALITY — week delta */}
                {punches.length > 0 && (
                  <div style={{background:T.surface, borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden"}}>
                    <div style={{background:T.dark, padding:"11px 18px"}}>
                      <span style={{color:"white", fontWeight:800, fontSize:14}}>Scheduled vs Actual Hours</span>
                      <span style={{color:"#666", fontSize:11, marginLeft:10}}>Based on clock-in data</span>
                    </div>
                    {employees.map((emp, i) => {
                      // Calculate actual hours from punches for the active week
                      const wkKey = activeWeek || wk1Start;
                      const wkDates = (weeks.find(w=>w.key===wkKey)?.dates || []).map(d=>{
                        const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return dt.toISOString().split("T")[0];
                      });
                      const empPunches = punches.filter(p => {
                        const pd = new Date(p.time).toISOString().split("T")[0];
                        return p.empId === emp.id && wkDates.includes(pd);
                      });
                      let actualHrs = 0, inT = null;
                      for (const p of empPunches) {
                        if (p.type==="in"||p.type==="break_in") inT = new Date(p.time);
                        else if (p.type==="out" && inT) { actualHrs += (new Date(p.time)-inT)/3600000; inT=null; }
                      }
                      const scheduledHrs = eWkH(wkKey, emp.id);
                      if (scheduledHrs === 0 && actualHrs === 0) return null;
                      const delta = actualHrs - scheduledHrs;
                      const pct = scheduledHrs > 0 ? Math.min((actualHrs/scheduledHrs)*100, 120) : 0;
                      const barColor = delta < -0.5 ? "#C0392B" : delta > 0.5 ? "#E8A93A" : "#4CAF7D";

                      return (
                        <div key={emp.id} style={{padding:"12px 18px", borderBottom:i<employees.length-1?`1px solid ${T.border}`:"none"}}>
                          <div style={{display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6}}>
                            <div style={{display:"flex", alignItems:"center", gap:8}}>
                              <div style={{width:24, height:24, borderRadius:"50%", background:emp.color, display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontWeight:800, fontSize:10, flexShrink:0}}>{emp.name?emp.name[0]:""}</div>
                              <span style={{fontWeight:700, fontSize:13, color:T.text}}>{emp.name}</span>
                            </div>
                            <div style={{display:"flex", gap:12, alignItems:"baseline"}}>
                              <span style={{fontSize:11, color:T.sub}}>{scheduledHrs}h sched</span>
                              <span style={{fontSize:13, fontWeight:800, color:barColor}}>{actualHrs.toFixed(1)}h actual</span>
                              {delta !== 0 && <span style={{fontSize:10, color:barColor, fontWeight:700}}>{delta>0?"+":""}{delta.toFixed(1)}h</span>}
                            </div>
                          </div>
                          <div style={{height:6, background:T.muted, borderRadius:3, overflow:"hidden"}}>
                            <div style={{height:"100%", width:`${Math.min(pct,100)}%`, background:barColor, borderRadius:3, transition:"width 0.3s"}}/>
                          </div>
                        </div>
                      );
                    }).filter(Boolean)}
                  </div>
                )}

                {/* Empty state when no employees */}
                {employees.length === 0 && (
                  <div style={{background:T.surface, borderRadius:T.radius, boxShadow:T.shadow, padding:"48px 32px", textAlign:"center", border:`2px dashed ${T.border}`}}>
                    <div style={{fontSize:40, marginBottom:12}}>🚨</div>
                    <div style={{fontWeight:800, fontSize:16, color:T.text, marginBottom:8}}>Coverage tracking starts with your team</div>
                    <p style={{margin:"0 0 20px", fontSize:13, color:T.sub, lineHeight:1.6}}>Add employees in Settings, build a schedule, then come here to manage real-time coverage, callouts, and replacements.</p>
                    <button onClick={()=>setTab("settings")} style={{background:T.accent, color:"white", border:"none", borderRadius:10, padding:"11px 24px", fontWeight:700, fontSize:13, cursor:"pointer"}}>Go to Settings →</button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* PAYROLL */}
          {tab==="payroll" && (
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              {(()=>{
                const paySun=getSunday(new Date().toISOString().split("T")[0]);
                const pwDates=weekDatesFromSunday(payWeek);
                const pwLabel=dl(pwDates[0])+" – "+dl(pwDates[6]);
                const pwHrs=employees.reduce((s,e)=>s+DAYS.reduce((d,_,i)=>d+eDayH(payWeek,e.id,i),0),0);
                const pwPay=employees.reduce((s,e)=>s+DAYS.reduce((d,_,i)=>d+eDayH(payWeek,e.id,i)*(parseFloat(e.hourlyRate)||0),0),0);
                const pwStaff=employees.filter(e=>DAYS.some((_,i)=>eDayH(payWeek,e.id,i)>0)).length;
                const bgt=parseFloat(weeklyBudget)||0;
                const over=bgt>0&&pwPay>bgt;
                const warn=!over&&bgt>0&&pwPay/bgt>0.85;
                const bc=over?"#C0392B":warn?"#E8A93A":"#4CAF7D";
                const pct=bgt>0?Math.min((pwPay/bgt)*100,100):0;
                return (
                  <div style={{display:"flex",flexDirection:"column",gap:16}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <button onClick={()=>setPayWeek(getSunday(addDays(payWeek,-7)))} style={{background:T.muted,border:`1px solid ${T.border}`,borderRadius:8,width:34,height:36,fontSize:16,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>‹</button>
                      <div style={{background:T.accent,color:"white",padding:"8px 16px",fontWeight:700,fontSize:12,borderRadius:8,whiteSpace:"nowrap"}}>{pwLabel}</div>
                      <button onClick={()=>setPayWeek(getSunday(addDays(payWeek,7)))} style={{background:T.muted,border:`1px solid ${T.border}`,borderRadius:8,width:34,height:36,fontSize:16,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>›</button>
                      {payWeek===paySun&&<span style={{fontSize:11,color:T.accent,fontWeight:700}}>Current week</span>}
                      {payWeek!==paySun&&<button onClick={()=>setPayWeek(paySun)} style={{background:T.muted,color:T.sub,border:`1px solid ${T.border}`,borderRadius:8,padding:"7px 12px",fontSize:11,fontWeight:700,cursor:"pointer"}}>Today</button>}
                    </div>
                    <div className="stat-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
                      {[
                        {l:"Est. Gross Payroll",v:"$"+pwPay.toFixed(2),c:T.accent,sub:"this week"},
                        {l:"Total Hours",v:pwHrs+"h",c:"#3A9BE8",sub:"scheduled"},
                        {l:"Staff Scheduled",v:pwStaff+"/"+employees.length,c:"#4CAF7D",sub:"have shifts"},
                        {l:"Weekly Budget",v:bgt>0?"$"+bgt.toFixed(0):"Not set",c:"#9B59B6",sub:over?"OVER budget":warn?"Near limit":bgt>0?"On track":"Set in schedule tab"},
                      ].map(s=>(
                        <div key={s.l} style={{background:T.surface,borderRadius:T.radius,boxShadow:T.shadow,padding:"16px 18px",borderLeft:`4px solid ${s.c}`,overflow:"hidden"}}>
                          <div style={{fontSize:11,color:T.sub,marginBottom:5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em"}}>{s.l}</div>
                          <div style={{fontSize:26,fontWeight:800,color:s.c,lineHeight:1}}>{s.v}</div>
                          <div style={{fontSize:10,color:"#bbb",marginTop:5}}>{s.sub}</div>
                        </div>
                      ))}
                    </div>
                    {bgt>0&&<div style={{background:T.surface,borderRadius:T.radius,boxShadow:T.shadow,padding:"16px 18px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><span style={{fontWeight:700,fontSize:13,color:T.text}}>Budget Tracker</span><span style={{fontSize:12,fontWeight:700,color:bc}}>{over?"$"+(pwPay-bgt).toFixed(0)+" over":warn?"$"+(bgt-pwPay).toFixed(0)+" left":"$"+(bgt-pwPay).toFixed(0)+" remaining"}</span></div>
                      <div style={{height:10,background:T.muted,borderRadius:5,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:bc,borderRadius:5,transition:"width 0.3s"}}/></div>
                      <div style={{display:"flex",justifyContent:"space-between",marginTop:6,fontSize:11,color:T.sub}}><span>$0</span><span>${bgt.toFixed(0)}</span></div>
                    </div>}
                  </div>
                );
              })()}

              {/* Sales Intelligence */}
              {(()=>{
                const wkDates = weeks.flatMap(w => w.dates.map(d => { const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return dt.toISOString().split("T")[0]; }));
                const wkSales = salesData.filter(s => wkDates.includes(s.date));
                const totalRevenue = wkSales.reduce((s,d) => s+d.revenue, 0);
                const laborCostPct = totalRevenue > 0 ? (grandPay / totalRevenue) * 100 : 0;
                const suggestedBudget = totalRevenue > 0 ? Math.round(totalRevenue * 0.3) : 0;
                const activeWkDates = activeWkObj ? activeWkObj.dates.map(d => { const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return dt.toISOString().split("T")[0]; }) : [];
                const dayData = activeWkDates.map((dateStr, i) => {
                  const sale = salesData.find(s => s.date === dateStr);
                  const labor = employees.reduce((s,e) => s + eDayH(activeWeek, e.id, i) * (parseFloat(e.hourlyRate)||0), 0);
                  return { day:DAYS[i], date:dateStr, revenue:sale?.revenue||0, labor, pct:sale?.revenue>0?(labor/sale.revenue)*100:null };
                });
                const hasSalesData = wkSales.length > 0 || salesData.length > 0;
                return (
                  <div style={{background:T.surface,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden"}}>
                    <div style={{padding:"12px 18px",background:T.dark,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
                      <div>
                        <span style={{color:"white",fontWeight:800,fontSize:14}}>Sales Intelligence</span>
                        <span style={{color:"#666",fontSize:11,marginLeft:10}}>Powered by Square</span>
                      </div>
                      <label style={{background:hasSalesData?"rgba(255,255,255,0.1)":T.accent,color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:7,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
                        {hasSalesData ? "Update Sales Data" : "Import Square CSV"}
                        <input type="file" accept=".csv" onChange={e=>{importSquareCSV(e.target.files[0]);e.target.value="";}} style={{display:"none"}}/>
                      </label>
                    </div>
                    {!hasSalesData ? (
                      <div style={{padding:"32px 24px",textAlign:"center"}}>
                        <div style={{fontSize:32,marginBottom:10}}>📊</div>
                        <div style={{fontWeight:700,fontSize:15,color:T.text,marginBottom:6}}>Connect your Square data</div>
                        <p style={{margin:"0 0 16px",fontSize:12,color:T.sub,lineHeight:1.6,maxWidth:340,marginLeft:"auto",marginRight:"auto"}}>
                          Export a Sales Summary from your Square Dashboard, then import it here to unlock labor cost %, demand-based scheduling, and smarter budget targets.
                        </p>
                        <div style={{background:T.muted,borderRadius:10,padding:"12px 16px",fontSize:11,color:T.sub,textAlign:"left",maxWidth:340,margin:"0 auto",lineHeight:1.7}}>
                          <strong style={{color:T.text}}>How to export from Square:</strong><br/>
                          1. Sign into Square Dashboard<br/>
                          2. Go to Reports → Sales Summary<br/>
                          3. Set your date range (last 4–8 weeks)<br/>
                          4. Click the export icon → Download CSV<br/>
                          5. Import that file here
                        </div>
                      </div>
                    ) : (
                      <div style={{padding:"16px 18px",display:"flex",flexDirection:"column",gap:16}}>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10}}>
                          {[
                            { l:"Total Revenue", v:totalRevenue>0?`$${totalRevenue.toFixed(0)}`:"-", c:"#3A9BE8", sub:"this schedule period" },
                            { l:"Labor Cost %", v:laborCostPct>0?`${laborCostPct.toFixed(1)}%`:"-", c:laborCostPct>35?"#C0392B":laborCostPct>25?"#E8A93A":"#4CAF7D", sub:"target: 25–35%" },
                            { l:"Labor vs Revenue", v:totalRevenue>0?`$${grandPay.toFixed(0)} / $${totalRevenue.toFixed(0)}`:"-", c:T.text, sub:"labor / revenue" },
                            { l:"Suggested Budget", v:suggestedBudget>0?`$${suggestedBudget}`:"-", c:T.accent, sub:"30% of revenue" },
                          ].map(s=>(
                            <div key={s.l} style={{background:T.muted,borderRadius:10,padding:"12px 14px"}}>
                              <div style={{fontSize:10,color:T.sub,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:4}}>{s.l}</div>
                              <div style={{fontSize:20,fontWeight:800,color:s.c,lineHeight:1}}>{s.v}</div>
                              <div style={{fontSize:9,color:T.sub,marginTop:4}}>{s.sub}</div>
                            </div>
                          ))}
                        </div>
                        {suggestedBudget > 0 && (
                          <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 14px",background:T.accent+"12",border:`1px solid ${T.accent}28`,borderRadius:10}}>
                            <div style={{flex:1}}>
                              <div style={{fontWeight:700,fontSize:13,color:T.text}}>Suggested Weekly Budget</div>
                              <div style={{fontSize:11,color:T.sub,marginTop:2}}>Based on your average revenue × 30% labor target</div>
                            </div>
                            <div style={{fontWeight:800,fontSize:18,color:T.accent,flexShrink:0}}>${suggestedBudget}</div>
                            <button onClick={()=>{ setWeeklyBudget(String(suggestedBudget)); showToast("Budget updated to $"+suggestedBudget+" ✓"); }}
                              style={{background:T.accent,color:"white",border:"none",borderRadius:8,padding:"8px 14px",fontWeight:700,fontSize:12,cursor:"pointer",flexShrink:0}}>
                              Apply
                            </button>
                          </div>
                        )}
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <span style={{fontSize:11,color:T.sub}}>{salesData.length} days of data · {salesData[0]?.date} to {salesData[salesData.length-1]?.date}</span>
                          <button onClick={()=>{ if(window.confirm("Clear all imported sales data?")) { setSalesData([]); if(bizId) dbDelete(`sales_data?business_id=eq.${bizId}`).catch(()=>{}); }; }}
                            style={{background:"transparent",color:T.sub,border:`1px solid ${T.border}`,borderRadius:7,padding:"5px 10px",fontSize:11,fontWeight:600,cursor:"pointer"}}>
                            Clear Data
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

            </div>
          )}

          {/* INSIGHTS */}
          {tab==="insights" && (()=>{
            const hasData = employees.length > 0 && Object.keys(schedule).length > 0;
            const urgencyColor = { low:"#4CAF7D", medium:"#E8A93A", high:"#C0392B" };
            const scoreColor = v => v >= 75 ? "#4CAF7D" : v >= 50 ? "#E8A93A" : "#C0392B";
            const scoreBg    = v => v >= 75 ? "#F0FFF4" : v >= 50 ? "#FEF3E2" : "#FDECEA";

            return (
              <div style={{maxWidth:720, display:"flex", flexDirection:"column", gap:16}}>

                {/* Header */}
                <div style={{display:"flex", alignItems:"flex-start", justifyContent:"space-between", flexWrap:"wrap", gap:12}}>
                  <div>
                    <h2 style={{margin:"0 0 4px", fontSize:20, fontWeight:800, color:T.text}}>Business Insights</h2>
                    <p style={{margin:0, fontSize:12, color:T.sub, lineHeight:1.5}}>
                      AI analysis of your schedule, labor costs, and team — powered by Claude.
                      {insight && <span style={{marginLeft:6, color:T.sub}}>Last updated {new Date(insight.generatedAt).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</span>}
                    </p>
                  </div>
                  <button onClick={generateInsight} disabled={insightLoading}
                    style={{
                      background: insightLoading ? T.muted : T.accent,
                      color: insightLoading ? T.sub : "white",
                      border:"none", borderRadius:10, padding:"10px 20px",
                      fontWeight:700, fontSize:13, cursor: insightLoading ? "not-allowed" : "pointer",
                      display:"flex", alignItems:"center", gap:8, flexShrink:0,
                      transition:"all 0.15s"
                    }}>
                    {insightLoading ? (
                      <><span style={{display:"inline-block", animation:"spin 1s linear infinite"}}>⟳</span> Analyzing...</>
                    ) : (
                      <><span>🧠</span> {insight ? "Refresh Analysis" : "Generate Insights"}</>
                    )}
                  </button>
                </div>

                {/* Error */}
                {insightError && (
                  <div style={{background:"#FDECEA", border:"1.5px solid #C0392B30", borderRadius:T.radius, padding:"14px 18px", color:"#C0392B", fontSize:13, fontWeight:600}}>
                    ⚠️ {insightError}
                  </div>
                )}

                {/* Loading skeleton */}
                {insightLoading && (
                  <div style={{display:"flex", flexDirection:"column", gap:12}}>
                    {[180, 140, 160, 120].map((h, i) => (
                      <div key={i} style={{background:T.surface, borderRadius:T.radius, height:h, boxShadow:T.shadow, overflow:"hidden", position:"relative"}}>
                        <div style={{position:"absolute", inset:0, background:`linear-gradient(90deg, transparent 0%, ${T.muted} 50%, transparent 100%)`, animation:"shimmer 1.4s infinite"}}/>
                      </div>
                    ))}
                    <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}`}</style>
                  </div>
                )}

                {/* Empty state — no data yet */}
                {!insightLoading && !insight && !insightError && (
                  <Card T={T} style={{padding:"48px 32px", textAlign:"center", border:`2px dashed ${T.border}`}}>
                    <div style={{fontSize:48, marginBottom:16}}>🧠</div>
                    <div style={{fontWeight:800, fontSize:17, color:T.text, marginBottom:8}}>Your AI business advisor</div>
                    <p style={{margin:"0 0 20px", fontSize:13, color:T.sub, lineHeight:1.7, maxWidth:400, marginLeft:"auto", marginRight:"auto"}}>
                      ShiftWise analyzes your schedule, labor costs, team availability, and sales data to give you a plain-English briefing — the things you'd tell yourself if you had time to look at all the numbers.
                    </p>
                    <div style={{display:"flex", flexDirection:"column", gap:10, maxWidth:340, margin:"0 auto 24px", textAlign:"left"}}>
                      {[
                        {icon:"💰", text:"Are you on track with your labor budget?"},
                        {icon:"📅", text:"Which days are over or under-staffed?"},
                        {icon:"⚠️", text:"Who's at risk of overtime this week?"},
                        {icon:"📈", text:"How does your labor cost compare to revenue?"},
                      ].map(item => (
                        <div key={item.icon} style={{display:"flex", alignItems:"center", gap:10, background:T.muted, borderRadius:9, padding:"10px 14px"}}>
                          <span style={{fontSize:18}}>{item.icon}</span>
                          <span style={{fontSize:13, color:T.text, fontWeight:500}}>{item.text}</span>
                        </div>
                      ))}
                    </div>
                    {!hasData && (
                      <div style={{background:"#FEF3E2", border:"1px solid #E8A93A30", borderRadius:9, padding:"10px 14px", fontSize:12, color:"#E67E22", marginBottom:16, fontWeight:600}}>
                        💡 Add employees and build a schedule first for the most useful analysis
                      </div>
                    )}
                    <button onClick={generateInsight} disabled={insightLoading}
                      style={{background:T.accent, color:"white", border:"none", borderRadius:10, padding:"13px 28px", fontWeight:800, fontSize:14, cursor:"pointer"}}>
                      🧠 Generate My First Insight
                    </button>
                  </Card>
                )}

                {/* INSIGHT RESULTS */}
                {!insightLoading && insight && (
                  <div style={{display:"flex", flexDirection:"column", gap:14}}>

                    {/* Headline + Score */}
                    <Card T={T} style={{padding:0, overflow:"hidden"}}>
                      <div style={{background:T.dark, padding:"16px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:16, flexWrap:"wrap"}}>
                        <div style={{flex:1, minWidth:200}}>
                          <div style={{fontSize:10, fontWeight:700, color:"#666", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6}}>This Week's Headline</div>
                          <div style={{fontSize:17, fontWeight:800, color:"white", lineHeight:1.4}}>{insight.headline}</div>
                        </div>
                        {insight.score && (
                          <div style={{background:scoreBg(insight.score.value), borderRadius:12, padding:"12px 18px", textAlign:"center", flexShrink:0}}>
                            <div style={{fontSize:32, fontWeight:900, color:scoreColor(insight.score.value), lineHeight:1}}>{insight.score.value}</div>
                            <div style={{fontSize:11, fontWeight:800, color:scoreColor(insight.score.value), marginTop:2}}>{insight.score.label}</div>
                            <div style={{fontSize:9, color:"#888", marginTop:4, maxWidth:120, lineHeight:1.3}}>{insight.score.reason}</div>
                          </div>
                        )}
                      </div>

                      {/* Positives strip */}
                      {insight.positives?.length > 0 && (
                        <div style={{background:"#F0FFF4", borderBottom:`1px solid #4CAF7D20`, padding:"10px 20px", display:"flex", gap:16, flexWrap:"wrap"}}>
                          {insight.positives.map((p, i) => (
                            <div key={i} style={{display:"flex", alignItems:"center", gap:6, fontSize:12, color:"#2D6A4F", fontWeight:600}}>
                              <span style={{color:"#4CAF7D"}}>✓</span> {p}
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>

                    {/* Priority Actions */}
                    {insight.actions?.length > 0 && (
                      <Card T={T} style={{overflow:"hidden"}}>
                        <div style={{padding:"11px 18px", background:T.dark, display:"flex", alignItems:"center", gap:8}}>
                          <span style={{fontSize:16}}>⚡</span>
                          <span style={{color:"white", fontWeight:800, fontSize:14}}>Action Items</span>
                          <span style={{background:T.accent, color:"white", borderRadius:10, padding:"1px 8px", fontSize:10, fontWeight:700, marginLeft:4}}>{insight.actions.length}</span>
                        </div>
                        {[...insight.actions].sort((a,b) => a.priority - b.priority).map((action, i) => (
                          <div key={i} style={{
                            display:"flex", gap:14, padding:"13px 18px",
                            borderBottom: i < insight.actions.length - 1 ? `1px solid ${T.border}` : "none",
                            alignItems:"flex-start",
                            background: i === 0 ? T.accent+"08" : T.surface,
                          }}>
                            <div style={{
                              width:26, height:26, borderRadius:"50%", flexShrink:0,
                              background: action.priority === 1 ? T.accent : T.muted,
                              color: action.priority === 1 ? "white" : T.sub,
                              display:"flex", alignItems:"center", justifyContent:"center",
                              fontWeight:800, fontSize:12, marginTop:1,
                            }}>{action.priority}</div>
                            <div style={{flex:1, minWidth:0}}>
                              <div style={{fontWeight:700, fontSize:13, color:T.text, marginBottom:3}}>{action.action}</div>
                              <div style={{fontSize:11, color:T.sub, lineHeight:1.5}}>{action.why}</div>
                            </div>
                          </div>
                        ))}
                      </Card>
                    )}

                    {/* Analysis Sections */}
                    {insight.sections?.length > 0 && (
                      <div style={{display:"flex", flexDirection:"column", gap:10}}>
                        <div style={{fontSize:11, fontWeight:700, color:T.sub, textTransform:"uppercase", letterSpacing:"0.08em", paddingLeft:2}}>Detailed Analysis</div>
                        {insight.sections.map((section, i) => (
                          <Card key={i} T={T} style={{padding:0, overflow:"hidden"}}>
                            <div style={{display:"flex", alignItems:"center", gap:10, padding:"11px 16px", borderBottom:`1px solid ${T.border}`, background:T.muted}}>
                              <span style={{fontSize:18}}>{section.icon}</span>
                              <span style={{fontWeight:700, fontSize:13, color:T.text, flex:1}}>{section.title}</span>
                              <span style={{
                                background: urgencyColor[section.urgency] + "20",
                                color: urgencyColor[section.urgency],
                                border: `1px solid ${urgencyColor[section.urgency]}30`,
                                borderRadius:6, padding:"2px 8px", fontSize:10, fontWeight:700,
                                textTransform:"uppercase", letterSpacing:"0.05em"
                              }}>{section.urgency}</span>
                            </div>
                            <div style={{padding:"13px 16px", fontSize:13, color:T.text, lineHeight:1.7}}>{section.insight}</div>
                          </Card>
                        ))}
                      </div>
                    )}

                    {/* Next Week Focus */}
                    {insight.nextWeekFocus && (
                      <Card T={T} style={{padding:"16px 20px", background:T.accent+"10", border:`1.5px solid ${T.accent}28`}}>
                        <div style={{display:"flex", gap:12, alignItems:"flex-start"}}>
                          <span style={{fontSize:22, flexShrink:0}}>🎯</span>
                          <div>
                            <div style={{fontWeight:700, fontSize:10, color:T.accent, marginBottom:4, textTransform:"uppercase", letterSpacing:"0.05em"}}>Next Week Focus</div>
                            <div style={{fontSize:13, color:T.text, lineHeight:1.6, fontWeight:600}}>{insight.nextWeekFocus}</div>
                          </div>
                        </div>
                      </Card>
                    )}

                    {/* Supabase upgrade note */}
                    <div style={{background:T.muted, borderRadius:T.radius, padding:"12px 16px", display:"flex", gap:10, alignItems:"flex-start"}}>
                      <span style={{fontSize:16, flexShrink:0}}>🔗</span>
                      <div style={{fontSize:11, color:T.sub, lineHeight:1.6}}>
                        <strong style={{color:T.text}}>Analysis is based on this device's data.</strong> Once connected to Supabase, insights will include historical patterns, multi-device punch data, and real-time Square sales — making recommendations significantly more powerful.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* TEAM / RECOGNITION */}
          {tab==="recognition" && (()=>{
            const EMOJIS = ["⭐","🙌","🔥","💪","👏","🎉","💯","❤️","🏆","✨"];
            const REC_TYPES = [
              { id:"shoutout",  label:"Shoutout",  desc:"Recognize great work",      color:"#F9C74F" },
              { id:"hype",      label:"Shift Hype", desc:"Get the team fired up",    color:"#4CC9F0" },
              { id:"milestone", label:"Milestone",  desc:"Celebrate an achievement", color:"#E8623A" },
            ];

            async function postRecognition() {
              if (!recMsg.trim()) return;
              const toEmp = employees.find(e=>e.id===recTo);
              const entry = { id:Date.now().toString(), at:new Date().toISOString(), type:recType, emoji:recEmoji, message:recMsg.trim(), fromName:recFrom||"Owner", toName:toEmp?.name||null, toId:recTo||null };
              setRecognition(p=>[entry,...p].slice(0,200));
              addAudit("Recognition Posted", (entry.fromName) + " → " + (entry.toName||"Team") + ": " + entry.message.slice(0,60));
              setRecMsg(""); setRecTo(""); setRecEmoji("⭐"); setRecType("shoutout");
              // Write to Supabase
              if (bizId) {
                dbPost("recognition", { business_id:bizId, from_name:entry.fromName, to_id:recTo||null, to_name:entry.toName||null, rec_type:recType, emoji:recEmoji, message:entry.message })
                  .catch(e => console.warn("Recognition write failed:", e));
              }
            }

            const typeInfo = REC_TYPES.find(t=>t.id===recType);

            return (
              <div style={{maxWidth:640,paddingBottom:20}}>
                <div style={{marginBottom:20}}>
                  <h2 style={{margin:"0 0 4px",fontSize:20,fontWeight:800,color:T.text}}>Team Feed</h2>
                  <p style={{margin:0,fontSize:12,color:T.sub}}>Recognize great work, hype an upcoming shift, celebrate milestones.</p>
                </div>
                <Card T={T} style={{padding:"18px 20px",marginBottom:20}}>
                  <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
                    {REC_TYPES.map(rt=>(
                      <button key={rt.id} onClick={()=>setRecType(rt.id)} style={{background:recType===rt.id?rt.color:T.muted,color:recType===rt.id?"white":T.sub,border:"none",borderRadius:8,padding:"6px 14px",fontWeight:700,fontSize:12,cursor:"pointer",transition:"all 0.15s"}}>{rt.label}</button>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:10,marginBottom:12,alignItems:"flex-start"}}>
                    <div style={{position:"relative",flexShrink:0}}>
                      <button onClick={()=>{ const idx=EMOJIS.indexOf(recEmoji); setRecEmoji(EMOJIS[(idx+1)%EMOJIS.length]); }} style={{width:44,height:44,borderRadius:10,background:typeInfo.color+"22",border:`1.5px solid ${typeInfo.color}44`,fontSize:22,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>{recEmoji}</button>
                      <div style={{fontSize:8,color:T.sub,textAlign:"center",marginTop:2}}>tap to cycle</div>
                    </div>
                    <textarea value={recMsg} onChange={e=>setRecMsg(e.target.value)} rows={3}
                      placeholder={recType==="shoutout"?"Write a shoutout...":recType==="hype"?"Hype up the team...":"Celebrate a milestone..."}
                      style={{flex:1,border:`1.5px solid ${T.border}`,borderRadius:10,padding:"10px 12px",fontSize:13,outline:"none",resize:"none",fontFamily:"inherit",color:T.text,background:T.surface}}/>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                    <div>
                      <label style={{fontSize:10,color:T.sub,display:"block",marginBottom:5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>From</label>
                      <input value={recFrom} onChange={e=>setRecFrom(e.target.value)} placeholder="Your name" style={{width:"100%",border:`1.5px solid ${T.border}`,borderRadius:8,padding:"8px 10px",fontSize:13,outline:"none",background:T.surface}}/>
                    </div>
                    <div>
                      <label style={{fontSize:10,color:T.sub,display:"block",marginBottom:5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>To</label>
                      <select value={recTo} onChange={e=>setRecTo(e.target.value)} style={{width:"100%",border:`1.5px solid ${T.border}`,borderRadius:8,padding:"8px 10px",fontSize:13,outline:"none",background:T.surface,color:T.text}}>
                        <option value="">Whole Team</option>
                        {employees.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <button onClick={postRecognition} disabled={!recMsg.trim()}
                    style={{width:"100%",background:recMsg.trim()?typeInfo.color:"#DDD",color:recMsg.trim()?"white":"#aaa",border:"none",borderRadius:10,padding:"12px 0",fontWeight:800,fontSize:14,cursor:recMsg.trim()?"pointer":"not-allowed",transition:"all 0.15s"}}>
                    Post {typeInfo.label}
                  </button>
                </Card>
                {recognition.length===0&&(
                  <Card T={T} style={{padding:"40px 24px",textAlign:"center",border:`2px dashed ${T.border}`}}>
                    <div style={{fontSize:40,marginBottom:12}}>⭐</div>
                    <div style={{fontWeight:700,fontSize:15,marginBottom:6,color:T.sub}}>No posts yet</div>
                    <div style={{fontSize:12,color:T.sub}}>Post a shoutout, shift hype, or milestone above to start the team feed.</div>
                  </Card>
                )}
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  {recognition.map((r,i)=>{
                    const typeColor = REC_TYPES.find(t=>t.id===r.type)?.color || T.accent;
                    const pd = new Date(r.at);
                    const timeAgo = (()=>{ const mins=Math.floor((Date.now()-pd)/60000); if(mins<1)return "just now"; if(mins<60)return `${mins}m ago`; const hrs=Math.floor(mins/60); if(hrs<24)return `${hrs}h ago`; return pd.toLocaleDateString("en-US",{month:"short",day:"numeric"}); })();
                    return (
                      <Card key={r.id} T={T} style={{padding:0,overflow:"hidden"}}>
                        <div style={{height:4,background:typeColor}}/>
                        <div style={{padding:"14px 16px"}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              <div style={{width:38,height:38,borderRadius:"50%",background:typeColor+"22",border:`1.5px solid ${typeColor}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{r.emoji||"⭐"}</div>
                              <div>
                                <div style={{fontWeight:700,fontSize:13,color:T.text}}>
                                  {r.fromName}
                                  {r.toName&&<><span style={{color:T.sub,fontWeight:400}}> → </span><span style={{color:typeColor}}>{r.toName}</span></>}
                                  {!r.toName&&<><span style={{color:T.sub,fontWeight:400}}> → </span><span style={{color:typeColor}}>Whole Team</span></>}
                                </div>
                                <div style={{fontSize:10,color:T.sub,marginTop:1,display:"flex",alignItems:"center",gap:6}}>
                                  <span style={{background:typeColor+"22",color:typeColor,borderRadius:4,padding:"1px 6px",fontSize:9,fontWeight:700}}>{(r.type||"shoutout").toUpperCase()}</span>
                                  <span>{timeAgo}</span>
                                </div>
                              </div>
                            </div>
                            <button onClick={()=>{ if(window.confirm("Delete this post?")) { setRecognition(p=>p.filter(e=>e.id!==r.id)); if(bizId) dbDelete(`recognition?id=eq.${r.id}`).catch(()=>{}); }; }}
                              style={{background:"transparent",color:T.sub,border:"none",fontSize:18,cursor:"pointer",opacity:0.4,padding:"4px 6px"}}>×</button>
                          </div>
                          <div style={{fontSize:14,color:T.text,lineHeight:1.6,paddingLeft:48}}>{r.message}</div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
                {recognition.length>0&&(
                  <div style={{marginTop:16,textAlign:"center"}}>
                    <button onClick={()=>{ if(window.confirm("Clear all recognition posts?")) { setRecognition([]); if(bizId) dbDelete(`recognition?business_id=eq.${bizId}`).catch(()=>{}); }; }}
                      style={{background:"transparent",color:T.sub,border:`1px solid ${T.border}`,borderRadius:8,padding:"7px 14px",fontSize:11,fontWeight:600,cursor:"pointer"}}>
                      Clear All Posts
                    </button>
                  </div>
                )}
              </div>
            );
          })()}



          {/* SETTINGS */}
          {tab==="settings" && (()=>{
            const SETTING_SECTIONS = [
              { id:"general",  icon:"🏢", label:"General",          sub:"Business name, appearance & shift types" },
              { id:"hours",    icon:"🕐", label:"Hours of Operation",sub:(()=>{ const set = Object.values(businessHours).filter(h=>!h.closed).length; return set>0?`${set} day${set!==1?"s":""}  configured`:"Not configured yet"; })() },
              { id:"roster",   icon:"👥", label:"Team Roster",      sub:`${employees.length} employee${employees.length!==1?"s":""}` },
              { id:"kiosk",    icon:"🔐", label:"Kiosk & Clock-In", sub:"Manage owner PIN for kiosk app" },
              { id:"print",    icon:"🖨",  label:"Print Schedule",   sub:"Preview and print or save as PDF" },
              { id:"data",     icon:"💾", label:"Data & Backup",    sub:(()=>{ return bizId ? "Connected to Supabase ✓" : "Not connected"; })() },
              { id:"audit",    icon:"📋", label:"Audit Log",        sub:auditLog.length>0?`${auditLog.length} change${auditLog.length!==1?"s":""} recorded`:"No changes recorded yet" },
            ];

            return (
              <div style={{maxWidth:600, paddingBottom:20}}>
                <div style={{marginBottom:20, display:"flex", alignItems:"center", gap:12}}>
                  {settingsSection && (
                    <button onClick={()=>setSettingsSection(null)}
                      style={{background:T.muted, border:"none", borderRadius:"50%", width:34, height:34, fontSize:18, cursor:"pointer", color:T.sub, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0}}>
                      ←
                    </button>
                  )}
                  <div>
                    <h2 style={{margin:"0 0 2px", fontSize:20, fontWeight:800, color:T.text}}>
                      {settingsSection ? SETTING_SECTIONS.find(s=>s.id===settingsSection)?.label : "Settings"}
                    </h2>
                    {!settingsSection && <p style={{margin:0, fontSize:12, color:T.sub}}>Tap a section to configure</p>}
                  </div>
                </div>

                {!settingsSection && (
                  <Card T={T} style={{overflow:"hidden"}}>
                    {SETTING_SECTIONS.map((s, i) => (
                      <div key={s.id} onClick={()=>setSettingsSection(s.id)}
                        style={{display:"flex", alignItems:"center", gap:14, padding:"15px 18px", cursor:"pointer", borderBottom:i<SETTING_SECTIONS.length-1?`1px solid ${T.border}`:"none", transition:"background 0.12s"}}
                        onMouseEnter={e=>e.currentTarget.style.background=T.muted}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <div style={{width:40, height:40, borderRadius:10, background:T.accent+"18", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0}}>{s.icon}</div>
                        <div style={{flex:1, minWidth:0}}>
                          <div style={{fontWeight:700, fontSize:14, color:T.text}}>{s.label}</div>
                          <div style={{fontSize:11, color:T.sub, marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>{s.sub}</div>
                        </div>
                        <div style={{color:T.sub, fontSize:18, flexShrink:0}}>›</div>
                      </div>
                    ))}
                  </Card>
                )}

                {/* GENERAL */}
                {settingsSection==="general" && (
                  <div style={{display:"flex", flexDirection:"column", gap:14}}>
                    <Card T={T} style={{padding:"18px 20px"}}>
                      <SectionLabel T={T}>Business Name</SectionLabel>
                      <p style={{margin:"0 0 12px", fontSize:12, color:T.sub, lineHeight:1.5}}>Appears in the top bar and on all printed schedules.</p>
                      <input value={biz} onChange={e=>setBiz(e.target.value)}
                        onBlur={()=>{ saveBizSettings({name:biz}); showToast("Business name saved ✓"); }}
                        style={{width:"100%", border:`1.5px solid ${T.border}`, borderRadius:9, padding:"11px 13px", fontSize:16, fontWeight:700, outline:"none", color:T.text, background:T.surface}}
                        placeholder="Your business name"/>
                    </Card>

                    <div>
                      <div style={{fontSize:13, fontWeight:800, color:T.text, marginBottom:4, paddingLeft:2}}>Shift Types</div>
                      <div style={{fontSize:12, color:T.sub, marginBottom:12, paddingLeft:2}}>Customize shift types available when scheduling.</div>
                      <Card T={T} style={{overflow:"hidden", marginBottom:10}}>
                        {shiftTypes.map((st,i)=>(
                          <div key={st.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 16px",borderBottom:i<shiftTypes.length-1?`1px solid ${T.border}`:"none"}}>
                            <div style={{width:30,height:30,borderRadius:7,background:st.color,flexShrink:0,position:"relative",cursor:"pointer",border:`2px solid ${T.border}`,overflow:"hidden"}}>
                              <input type="color" value={st.color} onChange={e=>setShiftTypes(p=>p.map(s=>s.id===st.id?{...s,color:e.target.value}:s))}
                                style={{opacity:0,position:"absolute",inset:0,width:"140%",height:"140%",top:"-20%",left:"-20%",cursor:"pointer"}}/>
                            </div>
                            <input value={st.label} onChange={e=>setShiftTypes(p=>p.map(s=>s.id===st.id?{...s,label:e.target.value}:s))}
                              style={{flex:1,border:`1.5px solid ${T.border}`,borderRadius:7,padding:"7px 10px",fontSize:13,fontWeight:700,outline:"none",background:T.surface,color:T.text,minWidth:0}}/>
                            <span style={{background:st.color+"22",color:st.color,border:`1px solid ${st.color}44`,borderRadius:6,padding:"3px 9px",fontSize:11,fontWeight:700,whiteSpace:"nowrap",flexShrink:0}}>{st.label||"—"}</span>
                            <button disabled={shiftTypes.length<=1} onClick={()=>{ if(window.confirm(`Remove "${st.label}"?`)) setShiftTypes(p=>p.filter(s=>s.id!==st.id)); }}
                              style={{background:"transparent",color:shiftTypes.length>1?"#C0392B":"#ddd",border:"none",fontSize:18,cursor:shiftTypes.length>1?"pointer":"not-allowed",padding:"4px 6px",flexShrink:0,lineHeight:1}}>×</button>
                          </div>
                        ))}
                      </Card>
                      <Card T={T} style={{padding:"14px 16px",marginBottom:8}}>
                        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                          <input id="new-type-label" placeholder="New type name..."
                            style={{flex:1,minWidth:140,border:`1.5px solid ${T.border}`,borderRadius:8,padding:"8px 10px",fontSize:14,outline:"none",background:T.surface,color:T.text}}/>
                          <div style={{width:36,height:36,borderRadius:8,border:`2px solid ${T.border}`,overflow:"hidden",cursor:"pointer",position:"relative",flexShrink:0}}>
                            <input type="color" id="new-type-color" defaultValue="#3A9BE8"
                              style={{opacity:0,position:"absolute",inset:0,width:"140%",height:"140%",top:"-20%",left:"-20%",cursor:"pointer"}}/>
                            <div id="new-type-preview" style={{position:"absolute",inset:0,background:"#3A9BE8",pointerEvents:"none"}}/>
                          </div>
                          <button onClick={()=>{
                            const lEl=document.getElementById("new-type-label");
                            const cEl=document.getElementById("new-type-color");
                            const label=lEl?.value?.trim();
                            if(!label){showToast("Enter a name first");return;}
                            setShiftTypes(p=>[...p,{id:label.toLowerCase().replace(/[^a-z0-9]/g,"")+Date.now().toString().slice(-4),label,color:cEl?.value||"#3A9BE8"}]);
                            if(lEl) lEl.value="";
                            showToast(`"${label}" added ✓`);
                          }} style={{background:T.accent,color:"white",border:"none",borderRadius:8,padding:"8px 16px",fontWeight:700,fontSize:13,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>+ Add</button>
                        </div>
                      </Card>
                      <button onClick={()=>{if(window.confirm("Reset shift types to defaults?"))setShiftTypes(DEFAULT_SHIFT_TYPES);}}
                        style={{background:"transparent",color:T.sub,border:`1px solid ${T.border}`,borderRadius:8,padding:"7px 12px",fontSize:11,fontWeight:600,cursor:"pointer"}}>
                        Reset to defaults
                      </button>
                    </div>

                    <div>
                      <div style={{fontSize:13, fontWeight:800, color:T.text, marginBottom:4, paddingLeft:2}}>Appearance</div>
                      <div style={{fontSize:12, color:T.sub, marginBottom:12, paddingLeft:2}}>Choose a color scheme.</div>
                      <div style={{display:"flex",flexDirection:"column",gap:10}}>
                        {Object.values(THEMES).map(theme => {
                          const isActive = themeId === theme.id;
                          return (
                            <div key={theme.id} onClick={() => setThemeId(theme.id)}
                              style={{borderRadius:T.radius, overflow:"hidden", cursor:"pointer", border:`2px solid ${isActive?T.accent:T.border}`, boxShadow:isActive?`0 0 0 3px ${T.accent}28`:T.shadow, background:T.surface, transition:"all 0.15s"}}>
                              <div style={{background:theme.dark, padding:"9px 12px", display:"flex", alignItems:"center", gap:8}}>
                                <div style={{width:18,height:18,background:theme.accent,borderRadius:4,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>📅</div>
                                <span style={{fontSize:11,fontWeight:800,color:theme.id==="commander"?theme.text:"white"}}>ShiftWise</span>
                                <div style={{marginLeft:"auto",display:"flex",gap:3}}>
                                  {["Schedule","Team","Payroll"].map(lbl=>(<div key={lbl} style={{background:lbl==="Schedule"?theme.accent:"transparent",color:"#888",borderRadius:3,padding:"2px 6px",fontSize:8,fontWeight:700}}>{lbl}</div>))}
                                </div>
                              </div>
                              <div style={{background:theme.bg,padding:"8px 12px",display:"flex",alignItems:"center",gap:8}}>
                                {[theme.bg,theme.surface,theme.accent,theme.dark,theme.muted].map((col,i)=>(<div key={i} style={{width:18,height:18,borderRadius:4,background:col,border:`1px solid ${theme.border}`,flexShrink:0}}/>))}
                                <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:10}}>
                                  <div>
                                    <div style={{fontWeight:800,fontSize:12,color:T.text}}>{theme.name}</div>
                                    <div style={{fontSize:10,color:T.sub}}>{theme.tagline}</div>
                                  </div>
                                  <div style={{width:20,height:20,borderRadius:"50%",background:isActive?T.accent:T.muted,border:`2px solid ${isActive?T.accent:T.border}`,display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s",flexShrink:0}}>
                                    {isActive&&<span style={{color:"white",fontSize:11,lineHeight:1}}>✓</span>}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* HOURS OF OPERATION */}
                {settingsSection==="hours" && (
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    <p style={{margin:0,fontSize:12,color:T.sub,lineHeight:1.6}}>
                      Set your regular opening and closing times. This allows the AI to detect schedule gaps and flag uncovered periods automatically.
                    </p>

                    <Card T={T} style={{overflow:"hidden"}}>
                      {DAYS.map((day, di) => {
                        const h = businessHours[di] || { open:"09:00", close:"17:00", closed:false };
                        return (
                          <div key={di} style={{display:"flex",alignItems:"center",gap:12,padding:"13px 18px",borderBottom:di<6?`1px solid ${T.border}`:"none",flexWrap:"wrap"}}>
                            {/* Day + toggle */}
                            <div style={{display:"flex",alignItems:"center",gap:10,minWidth:110}}>
                              <button onClick={()=>{ const next={...(businessHours[di]||{open:'09:00',close:'17:00'}),closed:!h.closed}; setBusinessHours(p=>({...p,[di]:next})); if(bizId) dbUpsert('business_hours',[{business_id:bizId,day_index:di,open_time:next.closed?null:next.open,close_time:next.closed?null:next.close,is_closed:!!next.closed}]).catch(()=>{}); }}
                                style={{width:36,height:20,borderRadius:10,background:h.closed?"#E0DAD2":"#4CAF7D",border:"none",cursor:"pointer",position:"relative",transition:"background 0.2s",flexShrink:0}}>
                                <div style={{position:"absolute",top:2,left:h.closed?2:18,width:16,height:16,borderRadius:"50%",background:"white",transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
                              </button>
                              <span style={{fontWeight:700,fontSize:13,color:h.closed?T.sub:T.text,minWidth:36}}>{DAY_FULL[di].slice(0,3)}</span>
                              {h.closed && <span style={{fontSize:10,color:T.sub,fontWeight:600,background:T.muted,borderRadius:4,padding:"1px 6px"}}>Closed</span>}
                            </div>

                            {/* Time selects */}
                            {!h.closed && (
                              <div style={{display:"flex",alignItems:"center",gap:8,flex:1,flexWrap:"wrap"}}>
                                <select value={h.open||"09:00"} onChange={e=>{ const next={...(businessHours[di]||{}),open:e.target.value,closed:false}; setBusinessHours(p=>({...p,[di]:next})); if(bizId) dbUpsert('business_hours',[{business_id:bizId,day_index:di,open_time:e.target.value,close_time:next.close||'17:00',is_closed:false}]).catch(()=>{}); }}
                                  style={{border:`1.5px solid ${T.border}`,borderRadius:8,padding:"7px 10px",fontSize:13,fontWeight:700,outline:"none",background:T.surface,color:T.text,cursor:"pointer"}}>
                                  {TIME_OPTIONS.map(o=><option key={o.val} value={o.val}>{o.label}</option>)}
                                </select>
                                <span style={{color:T.sub,fontSize:12,fontWeight:600}}>to</span>
                                <select value={h.close||"17:00"} onChange={e=>{ const next={...(businessHours[di]||{}),close:e.target.value,closed:false}; setBusinessHours(p=>({...p,[di]:next})); if(bizId) dbUpsert('business_hours',[{business_id:bizId,day_index:di,open_time:next.open||'09:00',close_time:e.target.value,is_closed:false}]).catch(()=>{}); }}
                                  style={{border:`1.5px solid ${T.border}`,borderRadius:8,padding:"7px 10px",fontSize:13,fontWeight:700,outline:"none",background:T.surface,color:T.text,cursor:"pointer"}}>
                                  {TIME_OPTIONS.map(o=><option key={o.val} value={o.val}>{o.label}</option>)}
                                </select>
                                <span style={{fontSize:11,color:T.sub,fontWeight:600,marginLeft:4}}>
                                  {(()=>{
                                    if(!h.open||!h.close) return "";
                                    const [oh,om]=h.open.split(":").map(Number);
                                    const [ch,cm]=h.close.split(":").map(Number);
                                    const hrs = (ch+cm/60)-(oh+om/60);
                                    return hrs>0?`${hrs}h open`:"";
                                  })()}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </Card>

                    {/* Quick fill buttons */}
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      <button onClick={()=>{
                        const defaults = {};
                        [1,2,3,4,5].forEach(d=>defaults[d]={open:"09:00",close:"17:00",closed:false});
                        [0,6].forEach(d=>defaults[d]={open:"10:00",close:"15:00",closed:false});
                        setBusinessHours(defaults);
                      }} style={{background:T.muted,color:T.text,border:`1px solid ${T.border}`,borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                        Typical retail (M–F 9–5, Wknd 10–3)
                      </button>
                      <button onClick={()=>{
                        const defaults = {};
                        DAYS.forEach((_,d)=>defaults[d]={open:"07:00",close:"15:00",closed:false});
                        setBusinessHours(defaults);
                      }} style={{background:T.muted,color:T.text,border:`1px solid ${T.border}`,borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                        Café (7AM–3PM daily)
                      </button>
                      <button onClick={()=>{
                        const defaults = {};
                        DAYS.forEach((_,d)=>defaults[d]={open:"11:00",close:"22:00",closed:false});
                        setBusinessHours(defaults);
                      }} style={{background:T.muted,color:T.text,border:`1px solid ${T.border}`,borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                        Restaurant (11AM–10PM daily)
                      </button>
                    </div>

                    {/* Schedule gap check */}
                    {Object.keys(businessHours).length > 0 && activeWeek && (
                      <Card T={T} style={{padding:"16px 18px",background:T.accent+"10",border:`1.5px solid ${T.accent}28`}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
                          <div>
                            <div style={{fontWeight:700,fontSize:13,color:T.text,marginBottom:3}}>Check Schedule for Gaps</div>
                            <div style={{fontSize:11,color:T.sub}}>Compare your hours of operation against the current schedule to find uncovered periods.</div>
                          </div>
                          <button onClick={()=>{
                            const gaps = [];
                            DAYS.forEach((day, di) => {
                              const h = businessHours[di];
                              if (!h || h.closed) return;
                              const [oh,om] = h.open.split(":").map(Number);
                              const [ch,cm] = h.close.split(":").map(Number);
                              const openDec = oh+om/60;
                              const closeDec = ch+cm/60;
                              const dayShifts = employees
                                .map(e => schedule?.[activeWeek]?.[e.id]?.[di])
                                .filter(Boolean)
                                .sort((a,b) => a.start - b.start);
                              if (dayShifts.length === 0) {
                                gaps.push(day + ": No staff scheduled (" + h.open + " to " + h.close + ")");
                                return;
                              }
                              if (dayShifts[0].start > openDec + 0.25) {
                                gaps.push(day + ": Gap at open — no cover from " + h.open + " to " + fmt(dayShifts[0].start));
                              }
                              const lastEnd = Math.max(...dayShifts.map(s => s.end));
                              if (lastEnd < closeDec - 0.25) {
                                gaps.push(day + ": Gap before close — last shift ends " + fmt(lastEnd) + ", closes " + h.close);
                              }
                            });
                            if (gaps.length === 0) {
                              showToast("No coverage gaps found — schedule looks complete!", 4000);
                            } else {
                              alert("Coverage Gaps Found:\n\n" + gaps.join("\n\n") + "\n\nFix these in the Schedule tab or ask AI Insights for recommendations.");
                            }
                          }} style={{background:T.accent,color:"white",border:"none",borderRadius:9,padding:"10px 18px",fontWeight:700,fontSize:12,cursor:"pointer",flexShrink:0,whiteSpace:"nowrap"}}>
                            🔍 Check for Gaps
                          </button>
                        </div>
                      </Card>
                    )}
                  </div>
                )}

                {/* ROSTER */}
                {settingsSection==="roster" && (
                  <div style={{paddingBottom:20}}>
                    {/* Sticky action bar — stays visible while scrolling through employee cards */}
                    <div style={{position:"sticky",top:54,zIndex:200,background:T.bg,paddingTop:8,paddingBottom:8,marginBottom:8,borderBottom:`1px solid ${T.border}`}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
                        <div>
                          <h2 style={{margin:"0 0 2px",fontSize:18,fontWeight:800,color:T.text}}>Team Roster</h2>
                          <p style={{margin:0,fontSize:11,color:T.sub}}>{employees.length} {employees.length===1?"employee":"employees"}{editEmpId?" · editing "+employees.find(e=>e.id===editEmpId)?.name:""}</p>
                        </div>
                        <div style={{display:"flex",gap:8,alignItems:"center"}}>
                          {editEmpId && (
                            <button onClick={()=>setEditEmpId(null)}
                              style={{background:T.muted,color:T.sub,border:`1px solid ${T.border}`,borderRadius:9,padding:"8px 16px",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                              ✓ Done Editing
                            </button>
                          )}
                          <button onClick={()=>{
                            addEmp();
                            // Auto-scroll to bottom where new card appears after short delay
                            setTimeout(()=>{
                              const cards = document.querySelectorAll(".emp-card");
                              if(cards.length) cards[cards.length-1].scrollIntoView({behavior:"smooth",block:"start"});
                            }, 100);
                          }} style={{background:T.accent,color:"white",border:"none",borderRadius:9,padding:"9px 18px",fontWeight:700,fontSize:13,cursor:"pointer",flexShrink:0}}>
                            + Add Employee
                          </button>
                        </div>
                      </div>
                    </div>
                    {employees.length===0&&(
                      <Card T={T} style={{padding:"48px 28px",textAlign:"center",border:`2px dashed ${T.border}`}}>
                        <div style={{fontSize:40,marginBottom:12}}>👥</div>
                        <div style={{fontSize:17,fontWeight:800,marginBottom:8}}>Build your team roster</div>
                        <p style={{margin:"0 0 20px",fontSize:13,color:T.sub,lineHeight:1.6,maxWidth:320,marginLeft:"auto",marginRight:"auto"}}>Add each employee with their name, role, hourly rate, and weekly availability.</p>
                        <button onClick={addEmp} style={{background:T.accent,color:"white",border:"none",borderRadius:10,padding:"12px 28px",fontWeight:800,fontSize:14,cursor:"pointer"}}>+ Add First Employee</button>
                      </Card>
                    )}
                    <div className="team-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:14}}>
                      {employees.map(emp=>{
                        const isEditing=editEmpId===emp.id;
                        const totalH=eTotalH(emp.id), totalP=eTotalP(emp);
                        const maxWkH=Math.max(...weeks.map(w=>eWkH(w.key,emp.id)));
                        const avail=parseFloat(emp.availableHours)||0;
                        const overAvail=avail>0&&maxWkH>avail;
                        const almostAvail=avail>0&&!overAvail&&maxWkH>=avail*0.85;
                        return (
                          <div key={emp.id} className="emp-card" id={`emp-card-${emp.id}`} style={{background:T.surface,borderRadius:T.radius,overflow:"hidden",boxShadow:T.shadow,border:`2px solid ${isEditing?emp.color:"transparent"}`,transition:"all 0.15s"}}>
                            <div style={{background:emp.color,padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                              <div style={{display:"flex",alignItems:"center",gap:12}}>
                                <div style={{width:42,height:42,borderRadius:"50%",background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:800,fontSize:18,flexShrink:0}}>{emp.name?emp.name[0].toUpperCase():"?"}</div>
                                <div>
                                  <div style={{color:"white",fontWeight:800,fontSize:15}}>{emp.name||"New Employee"}</div>
                                  <div style={{color:"rgba(255,255,255,0.7)",fontSize:12}}>{emp.role||"No role"}</div>
                                  {(()=>{ const unavail=DAYS.filter((_,i)=>!(emp.availableDays??[0,1,2,3,4,5,6]).includes(i)); return unavail.length>0?(<div style={{color:"rgba(255,255,255,0.6)",fontSize:10,marginTop:2}}>Off: {unavail.join(", ")}</div>):null; })()}
                                </div>
                              </div>
                              <button onClick={()=>{
                                const newId = isEditing ? null : emp.id;
                                setEditEmpId(newId);
                                if(newId) setTimeout(()=>{
                                  const el = document.getElementById(`emp-card-${newId}`);
                                  if(el) el.scrollIntoView({behavior:"smooth",block:"start"});
                                }, 80);
                              }} style={{background:"rgba(255,255,255,0.18)",color:"white",border:"none",borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                                {isEditing?"Close":"Edit"}
                              </button>
                            </div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`}}>
                              {[
                                ["$/hr",emp.hourlyRate?`$${emp.hourlyRate}`:"—","#1C1C1C"],
                                ["Avail/Wk",avail>0?`${avail}h`:"—","#3A9BE8"],
                                ["Sched Hrs",totalH+"h",overAvail?"#C0392B":almostAvail?"#E8A93A":T.text],
                                ["Est. Pay",`$${totalP.toFixed(0)}`,T.accent],
                              ].map(([lbl,val,color],idx)=>(
                                <div key={lbl} style={{padding:"12px 14px",textAlign:"center",background:idx===0||idx===3?T.muted+"80":T.surface,borderRight:idx%2===0?`1px solid ${T.border}`:"none",borderBottom:idx<2?`1px solid ${T.border}`:"none"}}>
                                  <div style={{fontSize:10,color:T.sub,marginBottom:4,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>{lbl}</div>
                                  <div style={{fontSize:16,fontWeight:800,color,lineHeight:1}}>{val}</div>
                                </div>
                              ))}
                            </div>
                            {isEditing&&(
                              <div style={{padding:"16px",borderTop:`1px solid ${T.border}`,background:T.bg}}>
                                <div style={{marginBottom:10}}>
                                  <label style={{fontSize:10,color:T.sub,display:"block",marginBottom:5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>Full Name</label>
                                  <input type="text" value={emp.name||""} onChange={e=>updEmp(emp.id,{name:e.target.value})}
                                    style={{width:"100%",border:`1.5px solid ${T.border}`,borderRadius:8,padding:"9px 11px",fontSize:14,outline:"none",background:T.surface}}/>
                                </div>
                                <div style={{marginBottom:10}}>
                                  <label style={{fontSize:10,color:T.sub,display:"block",marginBottom:5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>Role / Title</label>
                                  <input type="text" value={emp.role||""} onChange={e=>updEmp(emp.id,{role:e.target.value})}
                                    style={{width:"100%",border:`1.5px solid ${T.border}`,borderRadius:8,padding:"9px 11px",fontSize:14,outline:"none",background:T.surface}}/>
                                </div>
                                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                                  <div>
                                    <label style={{fontSize:10,color:T.sub,display:"block",marginBottom:5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>Hourly Rate ($)</label>
                                    <input type="number" value={emp.hourlyRate||""} onChange={e=>updEmp(emp.id,{hourlyRate:e.target.value})} min="0"
                                      style={{width:"100%",border:`1.5px solid ${T.border}`,borderRadius:8,padding:"9px 11px",fontSize:14,outline:"none",background:T.surface}}/>
                                  </div>
                                  <div>
                                    <label style={{fontSize:10,color:T.sub,display:"block",marginBottom:5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>Avail Hrs/Wk</label>
                                    <input type="number" value={emp.availableHours||""} onChange={e=>updEmp(emp.id,{availableHours:e.target.value})} min="0" placeholder="e.g. 32"
                                      style={{width:"100%",border:`1.5px solid ${T.border}`,borderRadius:8,padding:"9px 11px",fontSize:14,outline:"none",background:T.surface}}/>
                                  </div>
                                </div>
                                <div style={{marginBottom:14}}>
                                  <label style={{fontSize:10,color:T.sub,display:"block",marginBottom:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>Available Days <span style={{fontWeight:400,textTransform:"none",marginLeft:6}}>— tap to toggle</span></label>
                                  <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                                    {DAYS.map((day,di)=>{
                                      const availDays = emp.availableDays ?? [0,1,2,3,4,5,6];
                                      const isAvail = availDays.includes(di);
                                      return (
                                        <button key={di} onClick={()=>{
                                          const current = emp.availableDays ?? [0,1,2,3,4,5,6];
                                          const updated = isAvail ? current.filter(d=>d!==di) : [...current, di].sort();
                                          updEmp(emp.id,{availableDays:updated});
                                        }}
                                          style={{width:38,height:38,borderRadius:8,background:isAvail?T.accent:T.muted,color:isAvail?"white":T.sub,border:isAvail?"none":`1.5px solid ${T.border}`,fontWeight:700,fontSize:11,cursor:"pointer",transition:"all 0.15s",textDecoration:!isAvail?"line-through":"none",opacity:!isAvail?0.6:1}}>
                                          {day}
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <div style={{fontSize:10,color:T.sub,marginTop:6,lineHeight:1.5}}>
                                    {(()=>{ const availDays=emp.availableDays??[0,1,2,3,4,5,6]; const unavail=DAYS.filter((_,i)=>!availDays.includes(i)); return unavail.length===0?"Available all days":`Unavailable: ${unavail.join(", ")}`; })()}
                                  </div>
                                </div>
                                <div style={{marginBottom:12}}>
                                  <label style={{fontSize:10,color:T.sub,display:"block",marginBottom:6,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>Color</label>
                                  <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                                    {COLORS.map(c=>(<div key={c} onClick={()=>updEmp(emp.id,{color:c})} style={{width:28,height:28,borderRadius:"50%",background:c,cursor:"pointer",border:emp.color===c?"3px solid #1C1C1C":"3px solid transparent",boxShadow:emp.color===c?"0 0 0 2px white inset":"none",transition:"all 0.15s"}}/>))}
                                  </div>
                                </div>
                                <div style={{marginBottom:14,padding:"12px 14px",background:T.accent+"10",borderRadius:10,border:`1px solid ${T.accent}25`}}>
                                  <label style={{fontSize:10,color:T.accent,display:"block",marginBottom:5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>Clock-In PIN</label>
                                  <input type="password" inputMode="numeric" maxLength={6} value={emp.pin||""} onChange={e=>updEmp(emp.id,{pin:e.target.value.replace(/[^0-9]/g,"")})} placeholder="Set a 4–6 digit PIN"
                                    style={{width:"100%",border:`2px solid ${emp.pin?T.accent:T.border}`,borderRadius:8,padding:"9px 11px",fontSize:16,outline:"none",background:T.surface,letterSpacing:"0.2em",transition:"border 0.15s"}}/>
                                  <div style={{fontSize:10,color:T.sub,marginTop:6}}>Employee enters this on the kiosk screen to clock in and out.</div>
                                </div>
                                <div style={{marginBottom:14}}>
                                  <label style={{fontSize:10,color:T.sub,display:"block",marginBottom:5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>Notes</label>
                                  <textarea value={emp.notes||""} onChange={e=>updEmp(emp.id,{notes:e.target.value})} rows={2}
                                    placeholder="e.g. Part-time, no Sundays..."
                                    style={{width:"100%",border:`1.5px solid ${T.border}`,borderRadius:8,padding:"9px 11px",fontSize:13,outline:"none",resize:"vertical",background:T.surface,fontFamily:"inherit"}}/>
                                </div>
                                <button onClick={()=>rmEmp(emp.id)}
                                  style={{width:"100%",background:"#FDECEA",color:"#C0392B",border:"none",borderRadius:8,padding:"10px 0",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                                  Remove Employee
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* KIOSK */}
                {settingsSection==="kiosk" && (
                  <div style={{display:"flex", flexDirection:"column", gap:14}}>
                    <Card T={T} style={{padding:"18px 20px"}}>
                      <SectionLabel T={T}>Standalone Kiosk App</SectionLabel>
                      <p style={{margin:"0 0 14px", fontSize:12, color:T.sub, lineHeight:1.6}}>
                        The clock-in kiosk runs as a separate app designed for your POS or a dedicated tablet. It reads your schedule and employee data automatically — no setup needed.
                      </p>
                      <div style={{display:"flex",flexDirection:"column",gap:10}}>
                        {[
                          {icon:"📅", text:"Reads your schedule and employees automatically"},
                          {icon:"🔄", text:"Updates instantly when you make changes here"},
                          {icon:"👆", text:"Employees clock in with their PIN — no owner involvement"},
                          {icon:"🚨", text:"Flags late arrivals, early outs, and no-shows"},
                          {icon:"⭐", text:"Displays your team recognition feed"},
                        ].map(item=>(
                          <div key={item.icon} style={{display:"flex",alignItems:"center",gap:10,background:T.muted,borderRadius:9,padding:"10px 14px"}}>
                            <span style={{fontSize:18}}>{item.icon}</span>
                            <span style={{fontSize:12,color:T.text,fontWeight:500}}>{item.text}</span>
                          </div>
                        ))}
                      </div>
                    </Card>
                    <Card T={T} style={{padding:"18px 20px"}}>
                      <SectionLabel T={T}>Employee Clock-In PINs</SectionLabel>
                      <p style={{margin:"0 0 12px", fontSize:12, color:T.sub, lineHeight:1.5}}>Set each employee's PIN in the Team Roster. They use it to clock in and out on the kiosk.</p>
                      <button onClick={()=>setSettingsSection("roster")}
                        style={{background:T.accent,color:"white",border:"none",borderRadius:9,padding:"11px 0",fontWeight:700,fontSize:13,cursor:"pointer",width:"100%"}}>
                        Go to Team Roster →
                      </button>
                    </Card>
                  </div>
                )}

                {/* AUDIT LOG */}
                {settingsSection==="audit" && (
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
                      <p style={{margin:0,fontSize:12,color:T.sub,lineHeight:1.5}}>Every schedule change is automatically timestamped and recorded here.</p>
                      {auditLog.length>0&&(
                        <button onClick={()=>{ if(window.confirm("Clear the audit log?")) setAuditLog([]); }}
                          style={{background:"transparent",color:"#C0392B",border:"1px solid #C0392B30",borderRadius:8,padding:"6px 12px",fontWeight:700,fontSize:11,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                          Clear Log
                        </button>
                      )}
                    </div>
                    {auditLog.length===0&&(
                      <Card T={T} style={{padding:"40px 24px",textAlign:"center",border:`2px dashed ${T.border}`}}>
                        <div style={{fontSize:32,marginBottom:10}}>📋</div>
                        <div style={{fontWeight:700,fontSize:15,marginBottom:6,color:T.sub}}>No changes recorded yet</div>
                        <div style={{fontSize:12,color:T.sub}}>Changes to shifts, employees, and published schedules will appear here automatically.</div>
                      </Card>
                    )}
                    {auditLog.length>0&&(
                      <Card T={T} style={{overflow:"hidden"}}>
                        {auditLog.map((entry,i)=>{
                          const d = new Date(entry.at);
                          const dateStr = d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
                          const timeStr = d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
                          const icons = {"Shift Added":"➕","Shift Updated":"✏️","Shift Removed":"🗑","Week Copied":"📋","Schedule Published":"✅","Employee Added":"👤","Employee Updated":"✏️","Employee Removed":"❌"};
                          const colors = {"Shift Added":T.accent,"Shift Updated":"#3A9BE8","Shift Removed":"#C0392B","Week Copied":"#3A9BE8","Schedule Published":T.accent,"Employee Added":T.accent,"Employee Updated":"#3A9BE8","Employee Removed":"#C0392B"};
                          const icon = icons[entry.action] || "•";
                          const color = colors[entry.action] || T.sub;
                          return (
                            <div key={entry.id} style={{display:"flex",gap:12,padding:"12px 16px",borderBottom:i<auditLog.length-1?`1px solid ${T.border}`:"none",alignItems:"flex-start"}}>
                              <div style={{width:32,height:32,borderRadius:"50%",background:color+"18",border:`1px solid ${color}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0,marginTop:1}}>{icon}</div>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap"}}>
                                  <span style={{fontWeight:700,fontSize:13,color}}>{entry.action}</span>
                                  <span style={{fontSize:10,color:T.sub,whiteSpace:"nowrap"}}>{dateStr} at {timeStr}</span>
                                </div>
                                <div style={{fontSize:12,color:T.sub,marginTop:3,lineHeight:1.4}}>{entry.detail}</div>
                              </div>
                            </div>
                          );
                        })}
                      </Card>
                    )}
                    {auditLog.length>0&&(
                      <button onClick={()=>{
                        const rows = [["Timestamp","Action","Detail","Employee"],...auditLog.map(e=>[new Date(e.at).toLocaleString(),e.action,e.detail,e.empName||""])];
                        const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
                        const a=document.createElement("a");
                        a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
                        a.download=`${biz.replace(/\s+/g,"_")}_audit_${new Date().toISOString().split("T")[0]}.csv`;
                        a.click();
                      }} style={{background:T.dark,color:"white",border:"none",borderRadius:9,padding:"10px 18px",fontWeight:700,fontSize:12,cursor:"pointer",alignSelf:"flex-start"}}>
                        Export Log (.csv)
                      </button>
                    )}
                  </div>
                )}

                {/* PRINT SCHEDULE */}
                {settingsSection==="print" && (()=>{
                  const wk = weeks.find(w=>w.key===printWeek) || weeks[0];
                  const wkDates = wk.dates.map(d => { const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return dt; });
                  const wkTH = employees.reduce((s,e)=>s+eWkH(wk.key,e.id),0);
                  const scheduledEmps = employees.filter(e => eWkH(wk.key,e.id) > 0);

                  return (
                    <div>
                      {/* Controls bar */}
                      <Card T={T} style={{padding:"16px 18px",marginBottom:16,overflow:"visible"}}>
                        <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-end"}}>
                          {/* Week picker */}
                          <div>
                            <label style={{fontSize:10,fontWeight:700,color:T.sub,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Schedule Week</label>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                              <button onClick={()=>setPrintWeek(getSunday(addDays(printWeek,-7)))}
                                style={{background:T.muted,border:`1px solid ${T.border}`,borderRadius:8,width:34,height:36,fontSize:16,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,flexShrink:0}}>‹</button>
                              <div style={{display:"flex",alignItems:"center",borderRadius:9,overflow:"hidden",border:`2px solid ${T.accent}`,boxShadow:`0 0 0 2px ${T.accent}28`}}>
                                <div style={{background:T.accent,color:"white",padding:"8px 16px",fontWeight:700,fontSize:12,whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}>
                                  <span style={{fontSize:10}}>●</span>
                                  {printWeek ? `${dl(weekDatesFromSunday(printWeek)[0])} – ${dl(weekDatesFromSunday(printWeek)[6])}` : "Select a week"}
                                </div>
                                <div style={{position:"relative",flexShrink:0,borderLeft:`1px solid ${T.accent}40`}}>
                                  <input type="date" value={printWeek?toInputDate(weekDatesFromSunday(printWeek)[0]):""} onChange={e=>setPrintWeek(getSunday(e.target.value))}
                                    style={{opacity:0,position:"absolute",inset:0,cursor:"pointer",width:"100%",height:"100%"}}/>
                                  <div style={{background:T.accent+"18",padding:"8px 10px",fontSize:13,cursor:"pointer",userSelect:"none",color:T.accent}}>📅</div>
                                </div>
                              </div>
                              <button onClick={()=>setPrintWeek(getSunday(addDays(printWeek,7)))}
                                style={{background:T.muted,border:`1px solid ${T.border}`,borderRadius:8,width:34,height:36,fontSize:16,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,flexShrink:0}}>›</button>
                            </div>
                          </div>
                          {/* View toggle */}
                          <div>
                            <label style={{fontSize:10,fontWeight:700,color:T.sub,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Layout</label>
                            <div style={{display:"flex",gap:6}}>
                              {[["weekly","📅 Full Week"],["employee","👤 Per Employee"]].map(([v,lbl])=>(
                                <button key={v} onClick={()=>setPrintView(v)} style={{
                                  background:printView===v?T.dark:T.muted,
                                  color:printView===v?"white":T.sub,
                                  border:"none",borderRadius:8,padding:"8px 14px",
                                  fontWeight:700,fontSize:12,cursor:"pointer",transition:"all 0.15s",whiteSpace:"nowrap"
                                }}>{lbl}</button>
                              ))}
                            </div>
                          </div>
                          {/* Print instruction */}
                          <div style={{marginLeft:"auto",textAlign:"right"}}>
                            <div style={{fontSize:12,fontWeight:700,color:T.text,marginBottom:3}}>🖨 Ready to print</div>
                            <div style={{fontSize:11,color:T.sub}}>
                              <strong style={{fontFamily:"monospace"}}>Cmd+P</strong> (Mac) &nbsp;·&nbsp; <strong style={{fontFamily:"monospace"}}>Ctrl+P</strong> (Windows)
                            </div>
                            <div style={{fontSize:10,color:T.sub,marginTop:2}}>Set orientation to <strong>Landscape</strong> for best results</div>
                          </div>
                        </div>
                      </Card>

                      {/* ── WEEKLY TABLE VIEW ── */}
                      {printView==="weekly" && (
                        <div ref={printRef} style={{background:"white",borderRadius:T.radius,boxShadow:T.shadowMd,overflow:"hidden",border:`1px solid ${T.border}`}}>
                          {/* Header */}
                          <div style={{padding:"20px 28px 16px",borderBottom:"2px solid #1C1C1C"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                              <div>
                                <div style={{fontSize:22,fontWeight:900,color:"#1C1C1C",letterSpacing:"-0.01em"}}>{biz}</div>
                                <div style={{fontSize:13,color:"#666",marginTop:3,fontWeight:500}}>
                                  Employee Schedule &nbsp;·&nbsp; {wk.label} &nbsp;·&nbsp;
                                  {wkDates[0].toLocaleDateString("en-US",{month:"long",day:"numeric"})} – {wkDates[6].toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}
                                </div>
                              </div>
                              <div style={{textAlign:"right",fontSize:11,color:"#999"}}>
                                <div style={{fontWeight:700,fontSize:16,color:"#1C1C1C"}}>{wkTH}h total</div>
                                <div>{scheduledEmps.length} of {employees.length} scheduled</div>
                                <div style={{marginTop:2}}>Printed {new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
                              </div>
                            </div>
                          </div>

                          {/* Table */}
                          <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed"}}>
                            <colgroup>
                              <col style={{width:"14%"}}/>
                              {DAYS.map(d=><col key={d} style={{width:"12%"}}/>)}
                              <col style={{width:"4%"}}/>
                            </colgroup>
                            <thead>
                              <tr style={{background:"#1C1C1C"}}>
                                <th style={{padding:"12px 16px",color:"white",textAlign:"left",fontWeight:800,fontSize:12,letterSpacing:"0.05em",textTransform:"uppercase"}}>Employee</th>
                                {DAYS.map((d,i)=>(
                                  <th key={d} style={{padding:"12px 8px",color:"white",textAlign:"center",fontWeight:700,fontSize:12,borderLeft:"1px solid #333"}}>
                                    <div style={{fontSize:13,fontWeight:800}}>{d}</div>
                                    <div style={{fontSize:10,color:"#aaa",fontWeight:400,marginTop:2}}>
                                      {wkDates[i].toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                                    </div>
                                  </th>
                                ))}
                                <th style={{padding:"12px 6px",color:"#aaa",textAlign:"center",fontWeight:700,fontSize:10,borderLeft:"1px solid #333",textTransform:"uppercase",letterSpacing:"0.05em"}}>Hrs</th>
                              </tr>
                            </thead>
                            <tbody>
                              {employees.map((emp,ei)=>{
                                const wH = eWkH(wk.key,emp.id);
                                const hasAnyShift = wH > 0;
                                return (
                                  <tr key={emp.id} style={{background:ei%2===0?"white":"#FAFAFA",borderBottom:"1px solid #E8E4DF"}}>
                                    {/* Employee name */}
                                    <td style={{padding:"14px 16px",borderRight:"2px solid #E8E4DF",verticalAlign:"middle"}}>
                                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                                        <div style={{width:32,height:32,borderRadius:"50%",background:emp.color,display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:900,fontSize:14,flexShrink:0}}>
                                          {emp.name?emp.name[0].toUpperCase():"?"}
                                        </div>
                                        <div>
                                          <div style={{fontWeight:800,fontSize:14,color:"#1C1C1C",lineHeight:1.2}}>{emp.name||"—"}</div>
                                          
                                        </div>
                                      </div>
                                    </td>
                                    {/* Day cells */}
                                    {DAYS.map((_,di)=>{
                                      const shift = getShift(wk.key,emp.id,di);
                                      const h = shiftHrs(shift);
                                      const types = toTypeArr(shift?.type);
                                      const st = SHIFT_TYPES.find(s=>s.id===types[0]) || SHIFT_TYPES[0];
                                      const availDays = emp.availableDays ?? [0,1,2,3,4,5,6];
                                      const isOff = !availDays.includes(di);
                                      return (
                                        <td key={di} style={{padding:"10px 8px",textAlign:"center",borderLeft:"1px solid #E8E4DF",verticalAlign:"middle",background:isOff?"#F8F6F3":shift?st.color+"0D":"white"}}>
                                          {shift ? (
                                            <div>
                                              <div style={{fontSize:14,fontWeight:900,color:"#1C1C1C",lineHeight:1.1}}>{fmt(shift.start)}</div>
                                              <div style={{fontSize:12,color:"#555",margin:"3px 0",fontWeight:600}}>to {fmt(shift.end)}</div>
                                              <div style={{display:"inline-block",background:st.color,color:"white",borderRadius:4,padding:"2px 6px",fontSize:9,fontWeight:800,letterSpacing:"0.04em",textTransform:"uppercase"}}>{st.label}</div>
                                              <div style={{fontSize:11,fontWeight:700,color:"#1C1C1C",marginTop:4}}>{h}h</div>
                                              {shift.notes&&<div style={{fontSize:9,color:"#888",marginTop:3,fontStyle:"italic",lineHeight:1.3}}>{shift.notes}</div>}
                                            </div>
                                          ) : isOff ? (
                                            <div style={{fontSize:10,color:"#CCC",fontStyle:"italic"}}>—</div>
                                          ) : (
                                            <div style={{fontSize:11,color:"#DDD",fontStyle:"italic"}}>Off</div>
                                          )}
                                        </td>
                                      );
                                    })}
                                    {/* Hours total */}
                                    <td style={{padding:"10px 6px",textAlign:"center",borderLeft:"2px solid #E8E4DF",fontWeight:900,fontSize:14,color:wH>0?"#1C1C1C":"#CCC"}}>
                                      {wH>0?wH+"h":"—"}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr style={{background:"#F4F1EC",borderTop:"2px solid #1C1C1C"}}>
                                <td style={{padding:"12px 16px",fontWeight:800,fontSize:12,color:"#1C1C1C",textTransform:"uppercase",letterSpacing:"0.05em"}}>Daily Total</td>
                                {DAYS.map((_,di)=>{
                                  const dh = employees.reduce((s,e)=>s+eDayH(wk.key,e.id,di),0);
                                  return (
                                    <td key={di} style={{padding:"12px 8px",textAlign:"center",borderLeft:"1px solid #DDD",verticalAlign:"middle"}}>
                                      {dh>0?(
                                        <div>
                                          <div style={{fontWeight:800,fontSize:13,color:"#1C1C1C"}}>{dh}h</div>
                                        </div>
                                      ):<span style={{color:"#CCC",fontSize:11}}>—</span>}
                                    </td>
                                  );
                                })}
                                <td style={{padding:"12px 6px",textAlign:"center",borderLeft:"2px solid #DDD",fontWeight:900,fontSize:14,color:"#1C1C1C"}}>{wkTH}h</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}

                      {/* ── PER-EMPLOYEE CARD VIEW ── */}
                      {printView==="employee" && (
                        <div ref={printRef} style={{background:"white",borderRadius:T.radius,boxShadow:T.shadowMd,overflow:"hidden",border:`1px solid ${T.border}`}}>
                          {/* Header */}
                          <div style={{padding:"20px 28px 16px",borderBottom:"2px solid #1C1C1C",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div>
                              <div style={{fontSize:22,fontWeight:900,color:"#1C1C1C"}}>{biz}</div>
                              <div style={{fontSize:13,color:"#666",marginTop:3}}>
                                Individual Schedules &nbsp;·&nbsp; {wkDates[0].toLocaleDateString("en-US",{month:"long",day:"numeric"})} – {wkDates[6].toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}
                              </div>
                            </div>
                            <div style={{fontSize:11,color:"#999",textAlign:"right"}}>
                              <div>Printed {new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
                            </div>
                          </div>

                          {/* Employee cards */}
                          <div style={{padding:"20px 24px",display:"flex",flexDirection:"column",gap:16}}>
                            {employees.map((emp, ei) => {
                              const wH = eWkH(wk.key, emp.id);
                              const wP = eWkP(wk.key, emp);
                              const shifts = DAYS.map((day,di) => ({
                                day, di,
                                date: wkDates[di],
                                shift: getShift(wk.key, emp.id, di),
                                avail: (emp.availableDays??[0,1,2,3,4,5,6]).includes(di),
                              }));
                              const workDays = shifts.filter(s=>s.shift);
                              return (
                                <div key={emp.id} style={{border:`2px solid ${emp.color}`,borderRadius:12,overflow:"hidden",pageBreakInside:"avoid"}}>
                                  {/* Employee header */}
                                  <div style={{background:emp.color,padding:"12px 18px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                                    <div style={{display:"flex",alignItems:"center",gap:12}}>
                                      <div style={{width:40,height:40,borderRadius:"50%",background:"rgba(255,255,255,0.25)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:900,fontSize:18}}>
                                        {emp.name?emp.name[0].toUpperCase():"?"}
                                      </div>
                                      <div>
                                        <div style={{color:"white",fontWeight:900,fontSize:18,lineHeight:1}}>{emp.name||"—"}</div>
                                        
                                      </div>
                                    </div>
                                    <div style={{textAlign:"right"}}>
                                      <div style={{color:"white",fontWeight:900,fontSize:22,lineHeight:1}}>{wH}h</div>
                                      <div style={{color:"rgba(255,255,255,0.75)",fontSize:11,marginTop:2}}>{workDays.length} day{workDays.length!==1?"s":""} this week</div>
                                    </div>
                                  </div>
                                  {/* Shift rows */}
                                  {workDays.length === 0 ? (
                                    <div style={{padding:"16px 18px",color:"#999",fontSize:13,fontStyle:"italic",textAlign:"center"}}>Not scheduled this week</div>
                                  ) : (
                                    <div>
                                      {workDays.map(({day,di,date,shift},idx)=>{
                                        const h = shiftHrs(shift);
                                        const types = toTypeArr(shift.type);
                                        const st = SHIFT_TYPES.find(s=>s.id===types[0])||SHIFT_TYPES[0];
                                        return (
                                          <div key={di} style={{display:"flex",alignItems:"center",padding:"13px 18px",borderBottom:idx<workDays.length-1?"1px solid #E8E4DF":"none",background:idx%2===0?"white":"#FAFAFA"}}>
                                            {/* Day + date */}
                                            <div style={{minWidth:90}}>
                                              <div style={{fontWeight:900,fontSize:15,color:"#1C1C1C"}}>{day}</div>
                                              <div style={{fontSize:11,color:"#888",marginTop:1}}>{date.toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                                            </div>
                                            {/* Times — BIG and readable */}
                                            <div style={{flex:1,display:"flex",alignItems:"center",gap:8}}>
                                              <span style={{fontSize:20,fontWeight:900,color:"#1C1C1C"}}>{fmt(shift.start)}</span>
                                              <span style={{fontSize:14,color:"#999",fontWeight:600}}>→</span>
                                              <span style={{fontSize:20,fontWeight:900,color:"#1C1C1C"}}>{fmt(shift.end)}</span>
                                            </div>
                                            {/* Type badge + hours */}
                                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                                              <span style={{background:st.color,color:"white",borderRadius:6,padding:"3px 10px",fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.04em"}}>{st.label}</span>
                                              <span style={{fontWeight:900,fontSize:15,color:"#1C1C1C",minWidth:32,textAlign:"right"}}>{h}h</span>
                                            </div>
                                            {shift.notes&&<div style={{marginLeft:12,fontSize:11,color:"#888",fontStyle:"italic"}}>{shift.notes}</div>}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div style={{marginTop:10,fontSize:11,color:T.sub,textAlign:"center",lineHeight:1.6}}>
                        Use <strong>Cmd+P</strong> (Mac) or <strong>Ctrl+P</strong> (Windows) to print or save as PDF.
                        Set page orientation to <strong>Landscape</strong> for the Full Week view.
                      </div>
                    </div>
                  );
                })()}

                {/* DATA & BACKUP */}
                {settingsSection==="data" && (
                  <div style={{display:"flex", flexDirection:"column", gap:14}}>
                    <Card T={T} style={{padding:"18px 20px"}}>
                      <SectionLabel T={T}>Auto-Save</SectionLabel>
                      <p style={{margin:"0 0 10px", fontSize:12, color:T.sub, lineHeight:1.5}}>ShiftWise automatically saves everything to this device every time you make a change.</p>
                      <div style={{padding:"10px 14px",background:T.accent+"14",border:`1px solid ${T.accent}28`,borderRadius:9,fontSize:12,color:T.text,fontWeight:600,display:"flex",alignItems:"center",gap:8}}>
                        <span style={{color:T.accent}}>✓</span>
                        {bizId ? "All data synced to Supabase ✓" : "Not connected to database"}
                      </div>
                    </Card>
                    <Card T={T} style={{padding:"18px 20px"}}>
                      <SectionLabel T={T}>Export Backup</SectionLabel>
                      <p style={{margin:"0 0 12px", fontSize:12, color:T.sub, lineHeight:1.5}}>Download all your data as a single file. Use it to move ShiftWise to another device.</p>
                      <button onClick={exportData} style={{width:"100%",background:T.dark,color:"white",border:"none",borderRadius:9,padding:"12px 0",fontWeight:700,fontSize:13,cursor:"pointer"}}>Export Backup (.json)</button>
                    </Card>
                    <Card T={T} style={{padding:"18px 20px"}}>
                      <SectionLabel T={T}>Import Backup</SectionLabel>
                      <p style={{margin:"0 0 12px", fontSize:12, color:T.sub, lineHeight:1.5}}>Restore from a previously exported file. Your current data will be replaced.</p>
                      <label style={{display:"block",width:"100%",background:"#EBF5FF",color:"#3A9BE8",border:"1.5px solid #3A9BE830",borderRadius:9,padding:"12px 0",fontWeight:700,fontSize:13,cursor:"pointer",textAlign:"center"}}>
                        Import Backup File
                        <input type="file" accept=".json" onChange={e=>{importData(e.target.files[0]);e.target.value="";}} style={{display:"none"}}/>
                      </label>
                    </Card>
                    <Card T={T} style={{padding:"18px 20px"}}>
                      <SectionLabel T={T}>Clear All Data</SectionLabel>
                      <p style={{margin:"0 0 12px", fontSize:12, color:T.sub, lineHeight:1.5}}>Permanently removes all schedules, employees, settings, and history from this device.</p>
                      <button onClick={()=>{ if(window.confirm("Sign out and clear local session? Your cloud data is safe.")) { handleSignOut(); } }}
                        style={{background:"#FDECEA",color:"#C0392B",border:"1px solid #C0392B22",borderRadius:9,padding:"11px 18px",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                        Clear All Data
                      </button>
                    </Card>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

{/* 🔔 ALERTS DRAWER */}
{alertsOpen&&(
  <>
    <div onClick={()=>setAlertsOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:600}}/>
    <div style={{position:"fixed",top:0,right:0,bottom:0,width:"min(420px,100vw)",background:T.bg,zIndex:700,display:"flex",flexDirection:"column",boxShadow:"-8px 0 40px rgba(0,0,0,0.18)"}}>
      <div style={{background:T.dark,padding:"16px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div>
          <div style={{color:"white",fontWeight:800,fontSize:16}}>🔔 Alerts</div>
          <div style={{color:"#666",fontSize:11,marginTop:2}}>Flagged punches requiring review</div>
        </div>
        <button onClick={()=>setAlertsOpen(false)} style={{background:"rgba(255,255,255,0.1)",border:"none",borderRadius:"50%",width:34,height:34,color:"white",fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
      </div>

      {(()=>{
        const flagged = punches.filter(p=>p.flags&&p.flags.length>0).sort((a,b)=>new Date(b.time)-new Date(a.time));
        if (flagged.length===0) return (
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,textAlign:"center",color:T.sub}}>
            <div style={{fontSize:40,marginBottom:12}}>✅</div>
            <div style={{fontWeight:700,fontSize:15,color:"#888",marginBottom:8}}>No flagged punches</div>
            <div style={{fontSize:13,lineHeight:1.5}}>When employees clock in late, early, or without a scheduled shift, alerts will appear here.</div>
          </div>
        );
        const FLAG_LABELS = { LATE:"Late Clock-In", EARLY:"Early Clock-In", EARLY_OUT:"Early Clock-Out", NO_SHIFT:"No Shift Scheduled" };
        const FLAG_COLORS = { LATE:"#E8A93A", EARLY:"#3A9BE8", EARLY_OUT:"#E8A93A", NO_SHIFT:"#C0392B" };
        return (
          <div style={{flex:1,overflowY:"auto",padding:14,display:"flex",flexDirection:"column",gap:10}}>
            {/* Mark all reviewed button */}
            <button onClick={()=>{
              const updates = {};
              flagged.forEach(p=>{ if(!punchReviews[p.id]) updates[p.id]="reviewed"; });
              setPunchReviews(prev=>({...prev,...updates}));
              showToast("All alerts marked as reviewed ✓");
            }} style={{background:T.muted,color:T.sub,border:`1px solid ${T.border}`,borderRadius:9,padding:"8px 0",fontWeight:700,fontSize:12,cursor:"pointer",width:"100%"}}>
              Mark All Reviewed
            </button>

            {flagged.map(p=>{
              const emp = employees.find(e=>e.id===p.empId);
              const status = punchReviews[p.id] || "pending";
              const statusColor = status==="approved"?"#4CAF7D":status==="rejected"?"#C0392B":status==="reviewed"?"#3A9BE8":"#E8A93A";
              const pd = new Date(p.time);
              return (
                <div key={p.id} style={{background:T.surface,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden",border:`1px solid ${status==="pending"?"#E8A93A30":T.border}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:12,padding:"13px 14px"}}>
                    <div style={{width:36,height:36,borderRadius:"50%",background:emp?.color||T.muted,display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:800,fontSize:13,flexShrink:0}}>
                      {emp?.name?emp.name[0].toUpperCase():"?"}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:13,color:T.text}}>{emp?.name||p.empName}</div>
                      <div style={{fontSize:11,color:T.sub,marginTop:2}}>
                        {pd.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})} · {pd.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}
                      </div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:5}}>
                        {p.flags.map(f=>(
                          <span key={f} style={{background:(FLAG_COLORS[f]||"#888")+"22",color:FLAG_COLORS[f]||"#888",border:`1px solid ${(FLAG_COLORS[f]||"#888")}44`,borderRadius:5,padding:"2px 7px",fontSize:10,fontWeight:700}}>
                            {FLAG_LABELS[f]||f}
                          </span>
                        ))}
                      </div>
                      {p.scheduled&&(
                        <div style={{fontSize:10,color:T.sub,marginTop:4}}>
                          Scheduled: {fmt(p.scheduled.start)} – {fmt(p.scheduled.end)}
                        </div>
                      )}
                    </div>
                    <div style={{fontSize:10,fontWeight:700,color:statusColor,textTransform:"uppercase",flexShrink:0}}>{status}</div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:1,borderTop:`1px solid ${T.border}`}}>
                    {[["Reviewed","reviewed","#3A9BE8"],["Approved","approved","#4CAF7D"],["Rejected","rejected","#C0392B"]].map(([lbl,val,color])=>(
                      <button key={val} onClick={()=>setPunchReviews(p=>({...p,[p.id]:val}))}
                        style={{background:status===val?color+"22":T.surface,color:status===val?color:T.sub,border:"none",padding:"9px 0",fontSize:11,fontWeight:700,cursor:"pointer",transition:"all 0.12s"}}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  </>
)}
        {/* HISTORY DRAWER */}
        {historyOpen&&(
          <>
            <div onClick={()=>setHistoryOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:600}}/>
            <div style={{position:"fixed",top:0,right:0,bottom:0,width:"min(440px,100vw)",background:T.bg,zIndex:700,display:"flex",flexDirection:"column",boxShadow:"-8px 0 40px rgba(0,0,0,0.18)"}}>
              <div style={{background:T.dark,padding:"16px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
                <div>
                  <div style={{color:"white",fontWeight:800,fontSize:16}}>Published Schedules</div>
                  <div style={{color:"#666",fontSize:11,marginTop:2}}>{published.length===0?"No published schedules yet":`${published.length} published`}</div>
                </div>
                <button onClick={()=>setHistoryOpen(false)} style={{background:"rgba(255,255,255,0.1)",border:"none",borderRadius:"50%",width:34,height:34,color:"white",fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
              </div>
              {published.length===0&&(
                <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,textAlign:"center",color:T.sub}}>
                  <div style={{fontSize:40,marginBottom:12}}>📋</div>
                  <div style={{fontWeight:700,fontSize:15,marginBottom:8,color:"#888"}}>Nothing published yet</div>
                  <div style={{fontSize:13,lineHeight:1.5}}>Build a schedule, then click <strong style={{color:T.text}}>Publish Week</strong> to lock it here.</div>
                </div>
              )}
              <div style={{flex:1,overflowY:"auto",WebkitOverflowScrolling:"touch",padding:14,display:"flex",flexDirection:"column",gap:10}}>
                {published.map(entry=>{
                  const isOpen=historyPrev===entry.id;
                  const pd=new Date(entry.publishedAt);
                  const wk1d=weekDatesFromSunday(entry.wk1Start);
                  const wkKeys=entry.weekMode==="2"?[entry.wk1Start,entry.wk2Start]:[entry.wk1Start];
                  const tH=entry.employeeSnapshot.reduce((s,emp)=>s+wkKeys.reduce((ws,wk)=>ws+DAYS.reduce((ds,_,di)=>ds+shiftHrs(entry.scheduleData?.[wk]?.[emp.id]?.[di]||null),0),0),0);
                  const tP=entry.employeeSnapshot.reduce((s,emp)=>s+wkKeys.reduce((ws,wk)=>{const h=DAYS.reduce((ds,_,di)=>ds+shiftHrs(entry.scheduleData?.[wk]?.[emp.id]?.[di]||null),0);return ws+h*(parseFloat(emp.hourlyRate)||0);},0),0);
                  return (
                    <Card T={T} key={entry.id}>
                      <div style={{padding:"14px 16px"}}>
                        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8,marginBottom:12}}>
                          <div>
                            <div style={{fontWeight:800,fontSize:14}}>{entry.label}</div>
                            <div style={{fontSize:10,color:T.sub,marginTop:2}}>Published {pd.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
                          </div>
                          <div style={{display:"flex",gap:5,flexShrink:0}}>
                            <button onClick={()=>setHistoryPrev(isOpen?null:entry.id)} style={{background:T.muted,color:T.sub,border:"none",borderRadius:7,padding:"5px 9px",fontSize:10,fontWeight:700,cursor:"pointer"}}>{isOpen?"Hide":"Preview"}</button>
                            <button onClick={()=>{if(window.confirm("Delete this record?"))setPublished(p=>p.filter(e=>e.id!==entry.id));}} style={{background:"#FDECEA",color:"#C0392B",border:"none",borderRadius:7,padding:"5px 9px",fontSize:10,fontWeight:700,cursor:"pointer"}}>Delete</button>
                          </div>
                        </div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:14,paddingBottom:14,borderBottom:`1px solid ${T.border}`}}>
                          {[[`${entry.employeeSnapshot.length} staff`,"👥"],[`${tH}h`,"⏱"],[`$${tP.toFixed(0)} est.`,"💵"],[entry.weekMode==="2"?"2 wks":"1 wk","📆"]].map(([v,icon])=>(
                            <div key={v} style={{background:T.muted,borderRadius:6,padding:"4px 9px",fontSize:11,color:T.sub,fontWeight:700,display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:13}}>{icon}</span>{v}</div>
                          ))}
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                          <button onClick={()=>{if(window.confirm("Load this schedule? Current draft will be replaced."))loadPublished(entry);}}
                            style={{background:T.accent,color:"white",border:"none",borderRadius:9,padding:"9px 0",fontSize:12,fontWeight:700,cursor:"pointer"}}>Load & Edit</button>
                          <button onClick={()=>applyPattern(entry)}
                            style={{background:"#EBF5FF",color:"#3A9BE8",border:"1.5px solid #3A9BE830",borderRadius:9,padding:"9px 0",fontSize:12,fontWeight:700,cursor:"pointer"}}>Use as Template</button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* ── DROP INTENT POPUP — Copy or Move ── */}
        {dropIntent && (
          <>
            {/* Backdrop */}
            <div onClick={()=>setDropIntent(null)}
              style={{position:"fixed",inset:0,zIndex:1100,background:"rgba(0,0,0,0.35)"}}/>
            {/* Popup — positioned near drop point, clamped to viewport */}
            <div style={{
              position:"fixed",
              left: Math.min(dropIntent.x, window.innerWidth - 220),
              top:  Math.min(dropIntent.y, window.innerHeight - 160),
              zIndex:1200,
              background:"white",
              borderRadius:14,
              boxShadow:"0 8px 32px rgba(0,0,0,0.22)",
              padding:"14px 16px",
              minWidth:200,
              border:`2px solid ${T.border}`,
            }}>
              {/* Header */}
              <div style={{marginBottom:12}}>
                <div style={{fontWeight:800,fontSize:14,color:T.text,marginBottom:2}}>
                  {employees.find(e=>e.id===dropIntent.empId)?.name}
                </div>
                <div style={{fontSize:11,color:T.sub}}>
                  {DAY_FULL[dropIntent.fromDayIdx]} → {DAY_FULL[dropIntent.toDayIdx]}
                  <span style={{marginLeft:6,background:T.muted,borderRadius:4,padding:"1px 6px",fontSize:10}}>
                    {fmt(dropIntent.shift.start)} – {fmt(dropIntent.shift.end)}
                  </span>
                </div>
              </div>
              {/* Actions */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <button onClick={()=>{
                  // MOVE — set target, clear source
                  setShift(dropIntent.weekKey, dropIntent.empId, dropIntent.toDayIdx, dropIntent.shift);
                  setShift(dropIntent.weekKey, dropIntent.empId, dropIntent.fromDayIdx, null);
                  setDropIntent(null);
                  showToast(`Shift moved to ${DAY_FULL[dropIntent.toDayIdx]} ✓`);
                }} style={{
                  background:T.dark, color:"white", border:"none",
                  borderRadius:9, padding:"11px 0", fontWeight:700,
                  fontSize:13, cursor:"pointer", display:"flex",
                  flexDirection:"column", alignItems:"center", gap:3,
                }}>
                  <span style={{fontSize:16}}>✂️</span>
                  <span>Move</span>
                  <span style={{fontSize:9,opacity:0.6,fontWeight:400}}>Remove from {DAY_FULL[dropIntent.fromDayIdx].slice(0,3)}</span>
                </button>
                <button onClick={()=>{
                  // COPY — set target, keep source
                  setShift(dropIntent.weekKey, dropIntent.empId, dropIntent.toDayIdx, {...dropIntent.shift});
                  setDropIntent(null);
                  showToast(`Shift copied to ${DAY_FULL[dropIntent.toDayIdx]} ✓`);
                }} style={{
                  background:T.accent, color:"white", border:"none",
                  borderRadius:9, padding:"11px 0", fontWeight:700,
                  fontSize:13, cursor:"pointer", display:"flex",
                  flexDirection:"column", alignItems:"center", gap:3,
                }}>
                  <span style={{fontSize:16}}>📋</span>
                  <span>Copy</span>
                  <span style={{fontSize:9,opacity:0.8,fontWeight:400}}>Keep on {DAY_FULL[dropIntent.fromDayIdx].slice(0,3)}</span>
                </button>
              </div>
              <button onClick={()=>setDropIntent(null)}
                style={{width:"100%",marginTop:8,background:"transparent",color:T.sub,border:"none",fontSize:11,cursor:"pointer",fontWeight:600}}>
                Cancel
              </button>
            </div>
          </>
        )}

        <TimePickerModal/>

        {/* MOBILE BOTTOM NAV */}
        <nav className="bottom-nav">
          {TABS.map(t=>(
            <button key={t.key} className={tab===t.key?"active":""} onClick={()=>setTab(t.key)}>
              <span className="nav-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>

        {/* TOAST */}
        {toast&&(
          <div style={{position:"fixed",bottom:"calc(72px + env(safe-area-inset-bottom, 0px))",left:"50%",transform:"translateX(-50%)",background:T.dark,color:"white",borderRadius:12,padding:"12px 22px",fontSize:13,fontWeight:600,boxShadow:"0 8px 32px rgba(0,0,0,0.3)",zIndex:999,whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:8,maxWidth:"calc(100vw - 32px)",animation:"fadeup 0.2s ease"}}>
            <span style={{color:T.accent,fontSize:16}}>✓</span> {toast}
          </div>
        )}
        <style>{`@keyframes fadeup{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}} @keyframes ticker{0%{transform:translateX(100vw)}100%{transform:translateX(-100%)}} .ticker-wrap{overflow:hidden;width:100%;} .ticker-track{display:inline-block;white-space:nowrap;animation:ticker 24s linear infinite;} .ticker-track:hover{animation-play-state:paused;}`}</style>
    </div>
  );
}