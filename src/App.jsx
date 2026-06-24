import { useState, useMemo, useRef, useEffect, useCallback } from "react";

// Preset color palette for widget styling — kept small and on-theme
const WIDGET_COLORS = [
  { key:"blue",   hex:"#3A9BE8" },
  { key:"green",  hex:"#2D6A4F" },
  { key:"amber",  hex:"#E8A93A" },
  { key:"red",    hex:"#C0392B" },
  { key:"purple", hex:"#9B59B6" },
  { key:"teal",   hex:"#16A085" },
];

// Widget size presets — grid column/row spans in a 2-column layout
const WIDGET_SIZES = {
  sm:   { label:"Small", w:1, h:1 },
  wide: { label:"Wide",  w:2, h:1 },
  tall: { label:"Tall",  w:1, h:2 },
  lg:   { label:"Large", w:2, h:2 },
};
const SIZE_CYCLE = ["sm","wide","tall","lg"];

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
const toLocalDateStr = d => { const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; };
const addDays = (ds,n) => { const d = new Date(ds+"T00:00:00"); d.setDate(d.getDate()+n); return d.toISOString().split("T")[0]; };
const weekDatesFromSunday = s => { const sun=new Date(s+"T00:00:00"); return DAYS.map((_,i)=>{ const d=new Date(sun); d.setDate(sun.getDate()+i); return d; }); };
const dl = d => { if(!d) return ""; const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return dt.toLocaleDateString("en-US",{month:"short",day:"numeric"}); };
const toInputDate = d => { const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return dt.toISOString().split("T")[0]; };

// ── REPORTING FILTERS — shared time-range engine for Sales/Labor/Forecast ──
// Every widget (stat card, trend chart, comparison, forecast) asks one of
// these for a date range or a computed result, so they all speak the same
// "language" regardless of what's displaying them.
const FILTERS = [
  { key:"yesterday", label:"Yesterday",      kind:"history" },
  { key:"last7",     label:"Last 7 Days",    kind:"history" },
  { key:"last14",    label:"Last 14 Days",   kind:"history" },
  { key:"lastWeek",  label:"Last Week",      kind:"history" },
  { key:"thisWeek",  label:"This Week",      kind:"history" },
  { key:"lastMonth", label:"Last Month",     kind:"history" },
  { key:"last3mo",   label:"Last 3 Months",  kind:"history" },
  { key:"last6mo",   label:"Last 6 Months",  kind:"history" },
  { key:"allTime",   label:"All Time",       kind:"history" },
  { key:"next7",     label:"Next 7 Days",    kind:"forecast" },
  { key:"next14",    label:"Next 14 Days",   kind:"forecast" },
  { key:"next30",    label:"Next 30 Days",   kind:"forecast" },
  { key:"next60",    label:"Next 60 Days",   kind:"forecast" },
  { key:"next90",    label:"Next 90 Days",   kind:"forecast" },
];

const addMonths = (ds,n) => { const d = new Date(ds+"T00:00:00"); d.setMonth(d.getMonth()+n); return d.toISOString().split("T")[0]; };
const datesInRange = (startStr,endStr) => { const out=[]; let cur=startStr; while(cur<=endStr){ out.push(cur); cur=addDays(cur,1); } return out; };

// Returns an array of YYYY-MM-DD date strings for the given filter.
// `anchor` defaults to today, but can be set to a specific Sunday (e.g.
// payWeek) so "thisWeek" can represent whatever week is being viewed.
function getFilterDates(filterKey, salesData, anchor) {
  const today = anchor || new Date().toISOString().split("T")[0];
  switch (filterKey) {
    case "yesterday": return [addDays(today,-1)];
    case "last7":     return datesInRange(addDays(today,-6), today);
    case "last14":    return datesInRange(addDays(today,-13), today);
    case "lastWeek":  return weekDatesFromSunday(addDays(getSunday(today),-7)).map(toInputDate);
    case "thisWeek":  return weekDatesFromSunday(getSunday(today)).map(toInputDate);
    case "lastMonth": {
      const d = new Date(today+"T00:00:00");
      const firstThis = new Date(d.getFullYear(), d.getMonth(), 1);
      const firstLast = new Date(d.getFullYear(), d.getMonth()-1, 1);
      const lastOfLast = new Date(firstThis.getTime() - 86400000);
      return datesInRange(toInputDate(firstLast), toInputDate(lastOfLast));
    }
    case "last3mo":   return datesInRange(addMonths(today,-3), today);
    case "last6mo":   return datesInRange(addMonths(today,-6), today);
    case "allTime":   return salesData.length ? datesInRange(salesData[0].date, today) : [];
    case "next7":     return datesInRange(addDays(today,1), addDays(today,7));
    case "next14":    return datesInRange(addDays(today,1), addDays(today,14));
    case "next30":    return datesInRange(addDays(today,1), addDays(today,30));
    case "next60":    return datesInRange(addDays(today,1), addDays(today,60));
    case "next90":    return datesInRange(addDays(today,1), addDays(today,90));
    default:          return [];
  }
}

// The Sales object — total + day-by-day revenue for any filter.
function getSales(filterKey, salesData, anchor) {
  const dates = getFilterDates(filterKey, salesData, anchor);
  const byDate = Object.fromEntries(salesData.map(d => [d.date, d]));
  const days = dates.map(date => {
    const s = byDate[date];
    return { date, revenue: s?.revenue || 0, transactions: s?.transactions || 0, hasData: !!s };
  });
  const total = days.reduce((s,d) => s+d.revenue, 0);
  const daysWithData = days.filter(d => d.hasData).length;
  return { filterKey, dates, days, total, daysWithData };
}

// The Labor object — total + day-by-day scheduled labor cost for any filter.
// Note: this is only as complete as the schedule data that's been loaded —
// for weeks that were never built out in the Schedule tab, labor comes
// back as $0 for those dates (there's nothing to sum).
function getLabor(filterKey, salesData, employees, eDayH, anchor) {
  const dates = getFilterDates(filterKey, salesData, anchor);
  const days = dates.map(date => {
    const weekStart = getSunday(date);
    const dayIdx = Math.round((new Date(date+"T00:00:00") - new Date(weekStart+"T00:00:00")) / 86400000);
    const labor = employees.reduce((s,e) => s + eDayH(weekStart, e.id, dayIdx) * (parseFloat(e.hourlyRate)||0), 0);
    return { date, labor };
  });
  const total = days.reduce((s,d) => s+d.labor, 0);
  return { filterKey, dates, days, total };
}

// The Forecast object — projects revenue for future dates based on the
// historical average for that date's day-of-week. `hasEnoughData` is true
// only once every weekday has at least MIN_DOW_SAMPLES data points; below
// that, projections would be built on too little history to be meaningful.
const MIN_DOW_SAMPLES = 2;
function getForecast(filterKey, salesData, anchor) {
  const dates = getFilterDates(filterKey, salesData, anchor);
  const dowTotals = [0,0,0,0,0,0,0];
  const dowCounts = [0,0,0,0,0,0,0];
  salesData.forEach(d => {
    const dow = new Date(d.date+"T00:00:00").getDay();
    dowTotals[dow] += d.revenue;
    dowCounts[dow] += 1;
  });
  const dowAverages = dowTotals.map((t,i) => dowCounts[i] ? t/dowCounts[i] : 0);
  const hasEnoughData = dowCounts.every(c => c >= MIN_DOW_SAMPLES);
  const days = dates.map(date => {
    const dow = new Date(date+"T00:00:00").getDay();
    return { date, projectedRevenue: dowAverages[dow], dataPoints: dowCounts[dow] };
  });
  const total = days.reduce((s,d) => s+d.projectedRevenue, 0);
  return { filterKey, dates, days, total, hasEnoughData, dowCounts };
}

const mkEmp = (o={}) => ({ id:(Date.now()+Math.random()).toString(), name:"", role:"", hourlyRate:"", color:COLORS[0], notes:"", availableHours:"40", availableDays:[0,1,2,3,4,5,6], pin:"", ...o });
const loadSaved = () => { try { const r=localStorage.getItem(STORAGE_KEY); return r?JSON.parse(r):null; } catch { return null; } };

const CSS = `
*, *::before, *::after { box-sizing: border-box; }
html { margin:0; padding:0; width:100%; -webkit-text-size-adjust:100%; }
body { margin:0; padding:0; width:100%; min-height:100vh; overflow-x:hidden; overflow-y:auto;
  -webkit-overflow-scrolling:touch; overscroll-behavior-y:auto;
  font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif; }
#root { width:100%; min-height:100vh; }
a, button { -webkit-tap-highlight-color:transparent; }
input,select,button,textarea { font-family:inherit; }
.grid-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; border-radius:12px; }
.dashboard-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
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

// ── Setup flow helpers ─────────────────────────────────────────────────────
const SETUP_DAYS_FULL  = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const SETUP_DAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const SETUP_ROLES = [
  "Barista","Cashier","Server","Cook","Host","Manager",
  "Opener","Closer","Shift Lead","Line Cook","Prep Cook","Other"
];
const SETUP_AV_COLORS = [
  "#2D6A4F","#B45309","#1D4ED8","#7C3AED",
  "#0F766E","#9D174D","#92400E","#1E40AF"
];
const getSetupInitials = name =>
  (name||"").trim().split(" ").slice(0,2).map(w=>w[0]||"").join("").toUpperCase() || "?";

// ── SetupFlow component ─────────────────────────────────────────────────────
const SETUP_CSS = `
  .sw-setup-shell {
    min-height:100vh; display:flex; flex-direction:column;
    align-items:center; padding:0 20px 60px; background:#F7F7F5;
    font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;
  }
  .sw-topbar {
    width:100%; max-width:580px; padding:20px 0 0;
    display:flex; align-items:center; justify-content:space-between;
  }
  .sw-logo { display:flex; align-items:center; gap:8px; }
  .sw-logo-box {
    width:34px; height:34px; border-radius:8px; background:#2D6A4F;
    color:#fff; font-weight:700; font-size:13px;
    display:flex; align-items:center; justify-content:center;
  }
  .sw-logo-name { font-size:16px; font-weight:700; color:#1A1A18; }
  .sw-logo-name span { color:#2D6A4F; }
  .sw-step-ctr { font-size:12px; color:#6B6B67; font-weight:500; }
  .sw-prog-wrap { width:100%; max-width:580px; margin:20px 0 28px; }
  .sw-prog-track { height:4px; background:#E8E6E1; border-radius:2px; overflow:hidden; }
  .sw-prog-fill { height:100%; background:#2D6A4F; border-radius:2px; transition:width .4s cubic-bezier(.4,0,.2,1); }
  .sw-prog-labels { display:flex; justify-content:space-between; margin-top:8px; }
  .sw-prog-lbl { font-size:10px; font-weight:500; color:#C4C0BB; }
  .sw-prog-lbl.done { color:#2D6A4F; }
  .sw-prog-lbl.active { color:#1A1A18; font-weight:700; }
  .sw-card {
    width:100%; max-width:580px; background:#fff;
    border:1px solid #E8E6E1; border-radius:16px; padding:36px;
    box-shadow:0 2px 16px rgba(0,0,0,.05);
  }
  .sw-eyebrow { font-size:11px; font-weight:700; color:#2D6A4F; text-transform:uppercase; letter-spacing:.1em; margin-bottom:8px; }
  .sw-title { font-size:24px; font-weight:700; color:#1A1A18; line-height:1.2; margin-bottom:6px; }
  .sw-sub { font-size:14px; color:#6B6B67; margin-bottom:28px; line-height:1.6; }
  .sw-sub strong { color:#2D6A4F; font-weight:600; }
  .sw-fgroup { margin-bottom:20px; }
  .sw-flabel { font-size:11px; font-weight:700; color:#6B6B67; text-transform:uppercase; letter-spacing:.07em; margin-bottom:6px; display:block; }
  .sw-fhint { font-size:12px; color:#6B6B67; margin-top:5px; }
  .sw-input {
    width:100%; background:#F7F7F5; border:1.5px solid #E8E6E1;
    border-radius:9px; padding:12px 14px; color:#1A1A18;
    font-size:15px; font-family:inherit; outline:none;
    transition:border-color .15s,background .15s;
  }
  .sw-input:focus { border-color:#2D6A4F; background:#fff; }
  .sw-input::placeholder { color:#C4C0BB; }
  .sw-toggle-row { display:flex; gap:8px; }
  .sw-toggle-btn {
    flex:1; padding:12px; border-radius:9px; border:1.5px solid #E8E6E1;
    background:#F7F7F5; color:#6B6B67; font-size:14px; font-weight:500;
    cursor:pointer; transition:all .15s; font-family:inherit;
  }
  .sw-toggle-btn.sel { border-color:#2D6A4F; background:#E8F4EE; color:#1B4332; font-weight:600; }
  .sw-days-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; margin-bottom:8px; }
  .sw-day-pill {
    display:flex; flex-direction:column; align-items:center; gap:4px;
    padding:9px 2px 7px; border-radius:9px; border:1.5px solid #E8E6E1;
    background:#F7F7F5; cursor:pointer; transition:all .15s; user-select:none;
  }
  .sw-day-pill.open { border-color:#2D6A4F; background:#E8F4EE; }
  .sw-dpname { font-size:11px; font-weight:700; color:#6B6B67; }
  .sw-day-pill.open .sw-dpname { color:#1B4332; }
  .sw-dpstatus { font-size:9px; color:#C4C0BB; font-weight:500; }
  .sw-day-pill.open .sw-dpstatus { color:#2D6A4F; font-weight:700; }
  .sw-dpcheck {
    width:16px; height:16px; border-radius:50%; border:1.5px solid #E8E6E1;
    background:#fff; display:flex; align-items:center; justify-content:center;
    font-size:8px; color:#fff; transition:all .15s;
  }
  .sw-day-pill.open .sw-dpcheck { background:#2D6A4F; border-color:#2D6A4F; }
  .sw-days-hint { font-size:12px; color:#6B6B67; margin-top:6px; }
  .sw-budget-display {
    background:#E8F4EE; border:1px solid #A7D7C0; border-radius:10px;
    padding:14px 16px; margin-top:12px;
    display:flex; align-items:center; justify-content:space-between;
  }
  .sw-budget-lbl { font-size:12px; color:#1B4332; font-weight:500; }
  .sw-budget-val { font-size:22px; font-weight:700; color:#2D6A4F; }
  .sw-budget-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-top:12px; }
  .sw-budget-mini { background:#F7F7F5; border:1px solid #E8E6E1; border-radius:8px; padding:10px 12px; }
  .sw-bm-label { font-size:10px; color:#6B6B67; font-weight:700; text-transform:uppercase; letter-spacing:.06em; }
  .sw-bm-val { font-size:15px; font-weight:700; color:#1A1A18; margin-top:2px; }
  .sw-emp-cards { display:flex; flex-direction:column; gap:8px; margin-bottom:14px; }
  .sw-emp-card {
    background:#F7F7F5; border:1px solid #E8E6E1; border-radius:10px;
    padding:11px 14px; display:flex; align-items:center; gap:10px;
  }
  .sw-emp-av {
    width:34px; height:34px; border-radius:50%; color:#fff;
    font-size:12px; font-weight:700; display:flex; align-items:center;
    justify-content:center; flex-shrink:0;
  }
  .sw-emp-name { font-size:14px; font-weight:600; color:#1A1A18; }
  .sw-emp-meta { font-size:12px; color:#6B6B67; }
  .sw-emp-remove {
    background:none; border:none; color:#C4C0BB; font-size:15px;
    cursor:pointer; padding:2px 6px; border-radius:5px; margin-left:auto; font-family:inherit;
  }
  .sw-emp-remove:hover { color:#991B1B; }
  .sw-emp-count { display:inline-flex; align-items:center; gap:5px; background:#E8F4EE; border-radius:20px; padding:3px 10px; font-size:12px; font-weight:600; color:#1B4332; margin-bottom:12px; }
  .sw-add-form { background:#F7F7F5; border:1.5px dashed #E8E6E1; border-radius:10px; padding:16px; margin-bottom:4px; }
  .sw-add-form.active { border-color:#2D6A4F; background:#fff; }
  .sw-form-row { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:10px; }
  .sw-form-lbl { font-size:10px; font-weight:700; color:#6B6B67; text-transform:uppercase; letter-spacing:.06em; margin-bottom:4px; display:block; }
  .sw-form-input {
    width:100%; background:#fff; border:1.5px solid #E8E6E1;
    border-radius:8px; padding:9px 11px; color:#1A1A18;
    font-size:14px; font-family:inherit; outline:none;
  }
  .sw-form-input:focus { border-color:#2D6A4F; }
  .sw-form-select {
    width:100%; background:#fff; border:1.5px solid #E8E6E1;
    border-radius:8px; padding:9px 11px; color:#1A1A18;
    font-size:14px; font-family:inherit; outline:none; appearance:none; cursor:pointer;
  }
  .sw-form-select:focus { border-color:#2D6A4F; }
  .sw-form-actions { display:flex; gap:8px; }
  .sw-btn-confirm { background:#2D6A4F; color:#fff; border:none; border-radius:8px; padding:9px 16px; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; }
  .sw-btn-cancel { background:none; border:1px solid #E8E6E1; border-radius:8px; padding:9px 14px; font-size:13px; color:#6B6B67; cursor:pointer; font-family:inherit; }
  .sw-btn-add-emp {
    width:100%; padding:12px; border-radius:9px; border:1.5px dashed #E8E6E1;
    background:transparent; color:#2D6A4F; font-size:14px; font-weight:600;
    cursor:pointer; font-family:inherit; transition:all .15s;
    display:flex; align-items:center; justify-content:center; gap:6px;
  }
  .sw-btn-add-emp:hover { border-color:#2D6A4F; background:#E8F4EE; }
  .sw-emp-error { font-size:12px; color:#991B1B; margin-bottom:8px; }
  .sw-review-section { margin-bottom:18px; }
  .sw-review-title { font-size:11px; font-weight:700; color:#6B6B67; text-transform:uppercase; letter-spacing:.08em; margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid #E8E6E1; }
  .sw-review-row { display:flex; align-items:center; justify-content:space-between; padding:7px 0; border-bottom:1px solid #F0EEE9; }
  .sw-review-row:last-child { border-bottom:none; }
  .sw-review-label { font-size:13px; color:#6B6B67; }
  .sw-review-val { font-size:13px; font-weight:600; color:#1A1A18; }
  .sw-review-days { display:flex; gap:5px; flex-wrap:wrap; }
  .sw-day-tag { background:#E8F4EE; color:#1B4332; border-radius:5px; padding:2px 8px; font-size:12px; font-weight:600; }
  .sw-day-tag.closed { background:#F0EEE9; color:#6B6B67; }
  .sw-review-emps { display:flex; flex-direction:column; gap:6px; }
  .sw-review-emp { display:flex; align-items:center; gap:10px; padding:8px 10px; background:#F7F7F5; border-radius:8px; }
  .sw-rev-av { width:26px; height:26px; border-radius:50%; color:#fff; font-size:10px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .sw-rev-name { font-size:13px; font-weight:600; color:#1A1A18; }
  .sw-rev-role { font-size:12px; color:#6B6B67; }
  .sw-rev-rate { margin-left:auto; font-size:13px; font-weight:700; color:#2D6A4F; }
  .sw-launch-banner { background:#E8F4EE; border:1px solid #A7D7C0; border-radius:10px; padding:14px 16px; margin-top:18px; display:flex; align-items:flex-start; gap:10px; }
  .sw-launch-text { font-size:13px; color:#1B4332; line-height:1.6; }
  .sw-launch-text strong { font-weight:700; }
  .sw-footer { display:flex; align-items:center; justify-content:space-between; margin-top:28px; }
  .sw-btn-back { background:none; border:none; color:#6B6B67; font-size:14px; cursor:pointer; font-family:inherit; }
  .sw-btn-back:hover { color:#1A1A18; }
  .sw-btn-next { background:#2D6A4F; color:#fff; border:none; border-radius:9px; padding:13px 26px; font-size:14px; font-weight:600; cursor:pointer; font-family:inherit; }
  .sw-btn-next:hover { background:#1B4332; }
  .sw-btn-next:disabled { opacity:.35; cursor:default; }
  .sw-btn-launch { background:#2D6A4F; color:#fff; border:none; border-radius:9px; padding:14px 30px; font-size:15px; font-weight:700; cursor:pointer; font-family:inherit; }
  .sw-btn-launch:hover { background:#1B4332; }
  .sw-btn-launch:disabled { opacity:.45; cursor:default; }
  .sw-skip { font-size:12px; color:#6B6B67; cursor:pointer; text-align:center; margin-top:14px; }
  .sw-skip:hover { color:#2D6A4F; }
  .sw-save-err { font-size:13px; color:#991B1B; text-align:center; margin-top:10px; }
  .sw-saving { font-size:13px; color:#6B6B67; text-align:center; margin-top:10px; }
  .closed-day-cell {
    background: repeating-linear-gradient(
      45deg, transparent, transparent 4px, #F0EEE9 4px, #F0EEE9 5px
    ) !important;
    pointer-events: none !important;
    opacity: 0.6;
  }
  .closed-day-header { opacity:0.4; }
`;

const SW_LABELS = ["Your business","Operating days","Labor budget","Your team","Connect Square","Review & launch"];

function SetupFlow({ bizId, onComplete, initialStep, squareConnected, onConnectSquare }) {
  const [step,      setStep]      = useState(initialStep ?? 0);

  useEffect(() => {
    try { localStorage.setItem("sw_setup_step", String(step)); } catch {}
  }, [step]);
  const [saving,    setSaving]    = useState(false);
  const [saveErr,   setSaveErr]   = useState("");
  const [bizName,   setBizName]   = useState("");
  const [weekStart, setWeekStart] = useState("Sunday");
  const [daysOpen,  setDaysOpen]  = useState([0,1,2,3,4,5,6]);
  const [budget,    setBudget]    = useState("");
  const [employees, setEmployees] = useState([]);
  const [addingEmp, setAddingEmp] = useState(false);
  const [empDraft,  setEmpDraft]  = useState({ name:"", role:"", rate:"" });
  const [empErr,    setEmpErr]    = useState("");

  const toggleDay = i => setDaysOpen(prev =>
    prev.includes(i) ? prev.filter(d=>d!==i) : [...prev,i].sort((a,b)=>a-b)
  );

  const confirmEmp = () => {
    if (!empDraft.name.trim())                      { setEmpErr("Name is required."); return; }
    if (!empDraft.role)                             { setEmpErr("Please select a role."); return; }
    if (!empDraft.rate || isNaN(+empDraft.rate))    { setEmpErr("Enter a valid hourly rate."); return; }
    setEmployees(prev => [...prev, { ...empDraft, rate: parseFloat(empDraft.rate) }]);
    setAddingEmp(false);
    setEmpDraft({ name:"", role:"", rate:"" });
    setEmpErr("");
  };

  const budgetNum = parseFloat(budget.replace(/[^0-9.]/g,"")) || 0;
  const fmt$ = n => "$" + Math.round(n).toLocaleString("en-US");

  const canNext = [
    bizName.trim().length > 0,
    daysOpen.length >= 1,
    true,
    employees.length >= 1 && !addingEmp,
    true,
  ];

  const pct = (step / (SW_LABELS.length - 1)) * 100;

  const handleLaunch = async () => {
    setSaving(true); setSaveErr("");
    try {
      await dbPatch("businesses?id=eq." + bizId, {
        name:           bizName.trim(),
        days_open:      daysOpen,
        weekly_budget:  budgetNum > 0 ? budgetNum : null,
        setup_complete: true,
      });
      if (employees.length > 0) {
        const rows = employees.map(e => ({
          business_id:  bizId,
          name:         e.name.trim(),
          role:         e.role,
          hourly_rate:  e.rate,
          color:        SETUP_AV_COLORS[employees.indexOf(e) % SETUP_AV_COLORS.length],
        }));
        await dbPost("employees", rows);
      }
      onComplete();
    } catch(err) {
      console.error("Setup error:", err);
      setSaveErr("Something went wrong. Please try again.");
      setSaving(false);
    }
  };

  return (
    <>
      <style>{SETUP_CSS}</style>
      <div className="sw-setup-shell">
        <div className="sw-topbar">
          <div className="sw-logo">
            <div className="sw-logo-box">SW</div>
            <span className="sw-logo-name">Shift<span>Wise</span></span>
          </div>
          <span className="sw-step-ctr">Step {step+1} of {SW_LABELS.length}</span>
        </div>
        <div className="sw-prog-wrap">
          <div className="sw-prog-track">
            <div className="sw-prog-fill" style={{width:`${pct}%`}} />
          </div>
          <div className="sw-prog-labels">
            {SW_LABELS.map((l,i)=>(
              <span key={i} className={`sw-prog-lbl ${i<step?"done":i===step?"active":""}`}>{l}</span>
            ))}
          </div>
        </div>

        {step===0 && (
          <div className="sw-card">
            <div className="sw-eyebrow">Welcome to ShiftWise | Veredian</div>
            <h2 className="sw-title">Tell us about your business</h2>
            <p className="sw-sub">Shows on your schedule and reports. Edit any time in Settings.</p>
            <div className="sw-fgroup">
              <label className="sw-flabel">Business name</label>
              <input className="sw-input" placeholder="e.g. Coastal Grounds Coffee"
                value={bizName} onChange={e=>setBizName(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&canNext[0]&&setStep(1)} autoFocus />
            </div>
            <div className="sw-fgroup">
              <label className="sw-flabel">Week starts on</label>
              <div className="sw-toggle-row">
                {["Sunday","Monday"].map(d=>(
                  <button key={d} className={"sw-toggle-btn"+(weekStart===d?" sel":"")}
                    onClick={()=>setWeekStart(d)}>{d}</button>
                ))}
              </div>
              <div className="sw-fhint">Your schedule grid always begins on this day.</div>
            </div>
            <div className="sw-footer">
              <span/>
              <button className="sw-btn-next" disabled={!canNext[0]} onClick={()=>setStep(1)}>Continue →</button>
            </div>
          </div>
        )}

        {step===1 && (
          <div className="sw-card">
            <div className="sw-eyebrow">Operating days</div>
            <h2 className="sw-title">Which days do you operate?</h2>
            <p className="sw-sub"><strong>Closed days are greyed out on your schedule</strong> so you never accidentally assign a shift when you're not open. Update any time in Settings.</p>
            <div className="sw-fgroup">
              <div className="sw-days-grid">
                {SETUP_DAYS_FULL.map((day,i)=>(
                  <div key={i} className={"sw-day-pill"+(daysOpen.includes(i)?" open":"")}
                    onClick={()=>toggleDay(i)}>
                    <div className="sw-dpcheck">{daysOpen.includes(i)?"✓":""}</div>
                    <div className="sw-dpname">{SETUP_DAYS_SHORT[i]}</div>
                    <div className="sw-dpstatus">{daysOpen.includes(i)?"Open":"Closed"}</div>
                  </div>
                ))}
              </div>
              <div className="sw-days-hint">
                {daysOpen.length===7
                  ? "Open every day — tap any day to mark it closed."
                  : `Open ${daysOpen.length} day${daysOpen.length!==1?"s":""} · ${7-daysOpen.length} closed`}
              </div>
            </div>
            <div className="sw-footer">
              <button className="sw-btn-back" onClick={()=>setStep(0)}>← Back</button>
              <button className="sw-btn-next" disabled={!canNext[1]} onClick={()=>setStep(2)}>Continue →</button>
            </div>
          </div>
        )}

        {step===2 && (
          <div className="sw-card">
            <div className="sw-eyebrow">Labor budget</div>
            <h2 className="sw-title">What's your weekly labor target?</h2>
            <p className="sw-sub">ShiftWise tracks your running labor cost as you schedule. <strong>We flag you before you go over</strong> — so you decide before the shift, not after payroll.</p>
            <div className="sw-fgroup">
              <label className="sw-flabel">Weekly labor budget ($)</label>
              <input className="sw-input" placeholder="e.g. 2400" type="number"
                value={budget} onChange={e=>setBudget(e.target.value)} autoFocus />
              <div className="sw-fhint">Dollar amount only — no $ sign needed.</div>
            </div>
            {budgetNum>0 && (
              <>
                <div className="sw-budget-display">
                  <span className="sw-budget-lbl">Weekly target</span>
                  <span className="sw-budget-val">{fmt$(budgetNum)}</span>
                </div>
                <div className="sw-budget-grid">
                  <div className="sw-budget-mini">
                    <div className="sw-bm-label">Per open day</div>
                    <div className="sw-bm-val">{fmt$(budgetNum/(daysOpen.length||7))}</div>
                  </div>
                  <div className="sw-budget-mini">
                    <div className="sw-bm-label">Per month</div>
                    <div className="sw-bm-val">{fmt$(budgetNum*4.33)}</div>
                  </div>
                  <div className="sw-budget-mini">
                    <div className="sw-bm-label">Per year</div>
                    <div className="sw-bm-val">{fmt$(budgetNum*52)}</div>
                  </div>
                </div>
              </>
            )}
            <div className="sw-footer">
              <button className="sw-btn-back" onClick={()=>setStep(1)}>← Back</button>
              <button className="sw-btn-next" onClick={()=>setStep(3)}>Continue →</button>
            </div>
            <p className="sw-skip" onClick={()=>setStep(3)}>Skip — I'll add this in Settings later</p>
          </div>
        )}

        {step===3 && (
          <div className="sw-card">
            <div className="sw-eyebrow">Your team</div>
            <h2 className="sw-title">Build your roster</h2>
            <p className="sw-sub">Name, role, and hourly rate — ShiftWise calculates labor cost the moment you add a shift.</p>
            {employees.length>0 && (
              <>
                <div className="sw-emp-count">✓ {employees.length} employee{employees.length!==1?"s":""} added</div>
                <div className="sw-emp-cards">
                  {employees.map((emp,i)=>(
                    <div key={i} className="sw-emp-card">
                      <div className="sw-emp-av" style={{background:SETUP_AV_COLORS[i%SETUP_AV_COLORS.length]}}>
                        {getSetupInitials(emp.name)}
                      </div>
                      <div>
                        <div className="sw-emp-name">{emp.name}</div>
                        <div className="sw-emp-meta">{emp.role} · ${emp.rate}/hr</div>
                      </div>
                      <button className="sw-emp-remove"
                        onClick={()=>setEmployees(prev=>prev.filter((_,idx)=>idx!==i))}>✕</button>
                    </div>
                  ))}
                </div>
              </>
            )}
            {addingEmp ? (
              <div className="sw-add-form active">
                <div className="sw-form-row">
                  <div>
                    <label className="sw-form-lbl">Full name</label>
                    <input className="sw-form-input" placeholder="e.g. Jordan M."
                      value={empDraft.name} onChange={e=>setEmpDraft(d=>({...d,name:e.target.value}))} autoFocus />
                  </div>
                  <div>
                    <label className="sw-form-lbl">Role</label>
                    <select className="sw-form-select" value={empDraft.role}
                      onChange={e=>setEmpDraft(d=>({...d,role:e.target.value}))}>
                      <option value="">Select…</option>
                      {SETUP_ROLES.map(r=><option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="sw-form-lbl">Hourly rate ($)</label>
                    <input className="sw-form-input" placeholder="13.50" type="number"
                      value={empDraft.rate} onChange={e=>setEmpDraft(d=>({...d,rate:e.target.value}))} />
                  </div>
                </div>
                {empErr && <div className="sw-emp-error">⚠ {empErr}</div>}
                <div className="sw-form-actions">
                  <button className="sw-btn-confirm" onClick={confirmEmp}>Add employee</button>
                  <button className="sw-btn-cancel" onClick={()=>{setAddingEmp(false);setEmpErr("");}}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="sw-btn-add-emp"
                onClick={()=>{setEmpDraft({name:"",role:"",rate:""});setAddingEmp(true);}}>
                + Add {employees.length>0?"another":"an"} employee
              </button>
            )}
            <div className="sw-footer">
              <button className="sw-btn-back" onClick={()=>setStep(2)}>← Back</button>
              <button className="sw-btn-next" disabled={!canNext[3]} onClick={()=>setStep(4)}>Review →</button>
            </div>
            {employees.length>=1&&!addingEmp&&(
              <p className="sw-skip" onClick={()=>setStep(4)}>I'll add more employees later</p>
            )}
          </div>
        )}

        {step===4 && (
          <div className="sw-card">
            <div className="sw-eyebrow">Optional · Step 5 of {SW_LABELS.length}</div>
            <h2 className="sw-title">Connect Square</h2>
            <p className="sw-sub">
              Link your Square account to automatically pull daily sales — ShiftWise uses this to show your real labor cost vs. revenue. You can always connect this later in Settings.
            </p>

            {squareConnected ? (
              <div className="sw-launch-banner">
                <span style={{fontSize:18,flexShrink:0}}>✅</span>
                <div className="sw-launch-banner-text">
                  <strong>Square is connected.</strong> Your sales data will start syncing automatically.
                </div>
              </div>
            ) : (
              <button
                onClick={onConnectSquare}
                style={{
                  width:"100%", background:"#1A1A1A", color:"white", border:"none",
                  borderRadius:10, padding:"14px 0", fontWeight:700, fontSize:14,
                  cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8
                }}>
                <span style={{fontSize:16}}>◼</span> Connect Square Account
              </button>
            )}

            <div className="sw-footer">
              <button className="sw-btn-back" onClick={()=>setStep(3)}>← Back</button>
              <button className="sw-btn-next" onClick={()=>setStep(5)}>
                {squareConnected ? "Continue →" : "Skip for now →"}
              </button>
            </div>
          </div>
        )}

        {step===5 && (
          <div className="sw-card">
            <div className="sw-eyebrow">Almost there</div>
            <h2 className="sw-title">Review & launch</h2>
            <p className="sw-sub">Everything ShiftWise will use to set up your schedule. Edit any of it in Settings later.</p>
            <div className="sw-review-section">
              <div className="sw-review-title">Business</div>
              <div className="sw-review-row"><span className="sw-review-label">Name</span><span className="sw-review-val">{bizName}</span></div>
              <div className="sw-review-row"><span className="sw-review-label">Week starts</span><span className="sw-review-val">{weekStart}</span></div>
              <div className="sw-review-row"><span className="sw-review-label">Weekly budget</span><span className="sw-review-val">{budgetNum>0?fmt$(budgetNum):"Not set"}</span></div>
            </div>
            <div className="sw-review-section">
              <div className="sw-review-title">Days of operation</div>
              <div className="sw-review-days">
                {SETUP_DAYS_SHORT.map((d,i)=>(
                  <span key={i} className={"sw-day-tag"+(daysOpen.includes(i)?"":" closed")}>
                    {d}{!daysOpen.includes(i)?" ✕":""}
                  </span>
                ))}
              </div>
            </div>
            <div className="sw-review-section">
              <div className="sw-review-title">Team ({employees.length})</div>
              <div className="sw-review-emps">
                {employees.map((emp,i)=>(
                  <div key={i} className="sw-review-emp">
                    <div className="sw-rev-av" style={{background:SETUP_AV_COLORS[i%SETUP_AV_COLORS.length]}}>{getSetupInitials(emp.name)}</div>
                    <div><div className="sw-rev-name">{emp.name}</div><div className="sw-rev-role">{emp.role}</div></div>
                    <span className="sw-rev-rate">${emp.rate}/hr</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="sw-launch-banner">
              <span style={{fontSize:18,flexShrink:0}}>🚀</span>
              <div className="sw-launch-text">
                <strong>Your schedule is ready to build.</strong> Closed days will be greyed out, your team is on the grid, and ShiftWise tracks labor the moment you add your first shift.
              </div>
            </div>
            {saveErr && <div className="sw-save-err">{saveErr}</div>}
            <div className="sw-footer">
              <button className="sw-btn-back" onClick={()=>setStep(4)}>← Back</button>
              <button className="sw-btn-launch" onClick={handleLaunch} disabled={saving}>
                {saving?"Saving…":"Launch ShiftWise →"}
              </button>
            </div>
            {saving && <p className="sw-saving">Setting up your workspace…</p>}
          </div>
        )}
      </div>
    </>
  );
}
// ── END SetupFlow ────────────────────────────────────────────────────────────


// ── FeedbackTab component ─────────────────────────────────────────────────────
function FeedbackTab({ bizId, T, Card, showToast, addAudit, getSession, dbPost }) {
  const FEEDBACK_AREAS = [
    "Schedule","Timesheet","Kiosk / Clock-In","Coverage",
    "Business Insights","Dashboard","Team Feed","Settings",
    "Onboarding","Wins / Recognition","General / Other"
  ];
  const FEEDBACK_TYPES = [
    {k:"bug",     l:"🐛 Bug",             d:"Something isn't working correctly"},
    {k:"feature", l:"✨ Feature Request",  d:"An idea for something new"},
    {k:"general", l:"💬 General Feedback", d:"Thoughts, suggestions, impressions"},
  ];

  const [fbArea,    setFbArea]    = useState("");
  const [fbType,    setFbType]    = useState("general");
  const [fbMessage, setFbMessage] = useState("");
  const [fbSaving,  setFbSaving]  = useState(false);
  const [fbSent,    setFbSent]    = useState(false);

  async function submitFeedback() {
    if (!fbArea) { showToast("Select an area first"); return; }
    if (!fbMessage.trim()) { showToast("Write something before submitting"); return; }
    setFbSaving(true);
    try {
      await dbPost("feedback", {
        business_id: bizId,
        owner_id:    getSession()?.user?.id || null,
        area:        fbArea,
        type:        fbType,
        message:     fbMessage.trim(),
      });
      setFbSent(true);
      setFbMessage("");
      addAudit("Feedback Submitted", `${fbType} · ${fbArea}`);
    } catch(e) {
      showToast("Could not submit: " + e.message, 5000);
    } finally {
      setFbSaving(false);
    }
  }

  return (
    <div style={{maxWidth:640, margin:"0 auto", paddingBottom:20}}>
      <div style={{marginBottom:20}}>
        <h2 style={{margin:"0 0 4px", fontSize:20, fontWeight:800, color:T.text}}>Feedback</h2>
        <p style={{margin:0, fontSize:12, color:T.sub, lineHeight:1.5}}>Help shape ShiftWise — report bugs, suggest features, or share what's on your mind.</p>
      </div>

      {fbSent ? (
        <Card T={T} style={{padding:"40px 32px", textAlign:"center"}}>
          <div style={{fontSize:48, marginBottom:16}}>✅</div>
          <div style={{fontWeight:800, fontSize:18, color:T.text, marginBottom:8}}>Thanks for the feedback!</div>
          <p style={{margin:"0 0 24px", fontSize:13, color:T.sub, lineHeight:1.6}}>
            Your message was received. We read everything — it directly shapes what gets built next.
          </p>
          <button onClick={()=>setFbSent(false)}
            style={{background:T.accent, color:"white", border:"none", borderRadius:10, padding:"11px 28px", fontWeight:700, fontSize:13, cursor:"pointer"}}>
            Send More Feedback
          </button>
        </Card>
      ) : (
        <Card T={T} style={{padding:"20px 22px", display:"flex", flexDirection:"column", gap:16}}>

          {/* Area */}
          <div>
            <label style={{fontSize:11, fontWeight:700, color:T.sub, display:"block", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.06em"}}>Area</label>
            <select value={fbArea} onChange={e=>setFbArea(e.target.value)}
              style={{width:"100%", border:`1.5px solid ${fbArea?T.accent:T.border}`, borderRadius:9, padding:"10px 12px", fontSize:14, fontWeight:600, outline:"none", background:T.surface, color:fbArea?T.text:T.sub, cursor:"pointer"}}>
              <option value="" disabled>Select an area…</option>
              {FEEDBACK_AREAS.map(a=><option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          {/* Type */}
          <div>
            <label style={{fontSize:11, fontWeight:700, color:T.sub, display:"block", marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em"}}>Type</label>
            <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
              {FEEDBACK_TYPES.map(t=>(
                <button key={t.k} onClick={()=>setFbType(t.k)}
                  title={t.d}
                  style={{
                    background: fbType===t.k ? T.accent : T.muted,
                    color: fbType===t.k ? "white" : T.sub,
                    border: `1.5px solid ${fbType===t.k ? T.accent : T.border}`,
                    borderRadius:9, padding:"8px 16px", fontWeight:700, fontSize:12,
                    cursor:"pointer", transition:"all 0.15s"
                  }}>
                  {t.l}
                </button>
              ))}
            </div>
            <div style={{fontSize:11, color:T.sub, marginTop:6}}>
              {FEEDBACK_TYPES.find(t=>t.k===fbType)?.d}
            </div>
          </div>

          {/* Message */}
          <div>
            <label style={{fontSize:11, fontWeight:700, color:T.sub, display:"block", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.06em"}}>Message</label>
            <textarea
              value={fbMessage}
              onChange={e=>setFbMessage(e.target.value)}
              rows={5}
              placeholder={
                fbType==="bug"
                  ? "Describe what happened, what you expected, and how to reproduce it..."
                  : fbType==="feature"
                  ? "Describe the feature, what problem it solves, and how you'd use it..."
                  : "Share your thoughts..."
              }
              style={{width:"100%", border:`1.5px solid ${fbMessage.trim()?T.accent:T.border}`, borderRadius:9, padding:"12px 14px", fontSize:13, outline:"none", resize:"vertical", fontFamily:"inherit", color:T.text, background:T.surface, lineHeight:1.6, transition:"border 0.15s", boxSizing:"border-box"}}
            />
            <div style={{fontSize:10, color:T.sub, marginTop:4, textAlign:"right"}}>{fbMessage.length} characters</div>
          </div>

          {/* Submit */}
          <button onClick={submitFeedback} disabled={fbSaving || !fbMessage.trim()}
            style={{
              background: fbMessage.trim() ? T.accent : T.muted,
              color: fbMessage.trim() ? "white" : T.sub,
              border:"none", borderRadius:10, padding:"13px 0",
              fontWeight:800, fontSize:14, cursor: fbMessage.trim() ? "pointer" : "not-allowed",
              transition:"all 0.15s"
            }}>
            {fbSaving ? "Sending…" : "Send Feedback →"}
          </button>

          <div style={{fontSize:11, color:T.sub, textAlign:"center", lineHeight:1.6, paddingTop:4, borderTop:`1px solid ${T.border}`}}>
            Feedback goes directly to the ShiftWise team. We read every submission.
          </div>
        </Card>
      )}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

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
  const [resetSent,   setResetSent]   = useState(false);
  const [authError,   setAuthError]   = useState("");
  const [authBizName, setAuthBizName] = useState("");
  const [bizId,       setBizId]       = useState(null);

  // ── App state — hydrated from Supabase on load ────────────────────────────
  const [tab,         setTab]         = useState("grid");
  const [themeId,     setThemeId]     = useState("fieldwork");
  const T = THEMES[themeId] || THEMES.fieldwork;
  const [biz,         setBiz]         = useState("My Business");
  const [setupComplete, setSetupComplete] = useState(true);   // true = skip setup
  const [daysOpen,      setDaysOpen]      = useState([0,1,2,3,4,5,6]);
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
  const [squareConnected,    setSquareConnected]    = useState(false);
  const [squareMerchantName, setSquareMerchantName] = useState("");
  const [squareLastSync,     setSquareLastSync]     = useState(null);
  const [squareSyncing,      setSquareSyncing]      = useState(false);
  const [squareLoading,      setSquareLoading]      = useState(true);
  const [showDailyBreakdown, setShowDailyBreakdown] = useState(false);
  const [laborPctMode, setLaborPctMode] = useState("projected"); // "projected" | "actual"
  const [widgets,        setWidgets]        = useState([]);
  const [showAddWidget,  setShowAddWidget]  = useState(false);
  const [newWidget,      setNewWidget]      = useState({ data_source:"sales", time_range:"last7", display:"stat", color:null, show_axis:true, show_legend:true });
  const [widgetSaving,   setWidgetSaving]   = useState(false);
  const [dragWidgetId,   setDragWidgetId]   = useState(null);
  const [dragOverWidgetId, setDragOverWidgetId] = useState(null);
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

  useEffect(() => {
    if (Object.keys(businessHours).length === 0) return;
    const open = DAYS.map((_, di) => di).filter(di => !businessHours[di]?.closed);
    setDaysOpen(open);
    if (bizId) {
      dbPatch("businesses?id=eq." + bizId, { days_open: open }).catch(()=>{});
    }
  }, [businessHours, bizId]);

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
  const [scoreOpen,      setScoreOpen]      = useState(false);
  const [pulseHistory,   setPulseHistory]   = useState([]); // saved scores from pulse_history table
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);
  const [notifFreq,      setNotifFreq]      = useState(() => { try { return localStorage.getItem("sw_notif_freq")||"login"; } catch { return "login"; } });
  const [notifDay,       setNotifDay]       = useState(() => { try { return localStorage.getItem("sw_notif_day")||"Monday"; } catch { return "Monday"; } });

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

  async function handleForgotPassword(e) {
    if(e?.preventDefault) e.preventDefault();
    setAuthError("");
    if (!authEmail.trim()) { setAuthError("Enter your email address first."); return; }
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method:"POST",
        headers:{ "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body:JSON.stringify({ email: authEmail }),
      });
      if (!res.ok) {
        const text = await res.text();
        let data = {};
        try { data = JSON.parse(text); } catch {}
        throw new Error(data.error_description || data.error || "Could not send reset email.");
      }
      setResetSent(true);
    } catch(err) {
      setAuthError(err.message);
    }
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
      const bizRows = await dbGet("businesses?select=*&order=created_at.asc&limit=1");
      const business = bizRows?.[0];
      if (!business) { setAuthState("unauthenticated"); clearSession(); return; }

      setBizId(business.id);
      setBiz(business.name ?? "My Business");
      setSetupComplete(business.setup_complete ?? true);
      setDaysOpen(business.days_open ?? [0,1,2,3,4,5,6]);
      setWeeklyBudget(business.weekly_budget ?? null);
      checkSquareStatus(business.id);
      try {
        const w = await dbGet(`dashboard_widgets?business_id=eq.${business.id}&order=sort_order.asc`);
        setWidgets(w || []);
      } catch(e) { console.warn("Widgets load failed:", e); }
      setBiz(business.name || "My Business");
      setWeeklyBudget(business.weekly_budget ? String(business.weekly_budget) : "");
      // Load theme from local preference (kept local — it's a UI pref not business data)
      const localTheme = localStorage.getItem("sw_theme");
      if (localTheme && THEMES[localTheme]) setThemeId(localTheme);

      // 2. Load all data in parallel
      const [
        empRows, weekRows, shiftTypeRows, bizHourRows,
        salesRows, recRows, punchRows, openShiftRows,
        templateRows, publishedRows, auditRows, reviewRows, pulseHistoryRows,
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
        dbGet(`punch_reviews?select=*&business_id=eq.${business.id}`),
        dbGet(`pulse_history?select=*&business_id=eq.${business.id}&order=generated_at.desc&limit=20`),
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

      // 5. Set week dates - always default to current week, single-week mode
      {
        const todaySun = getSunday(new Date().toISOString().split("T")[0]);
        setWk1Start(todaySun);
        setActiveWeek(todaySun);
        setPrintWeek(todaySun);
        setWeekMode("1");
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
      const reviewMap = {};
      (reviewRows||[]).forEach(r=>{ reviewMap[r.punch_id] = r.status; });
      setPunchReviews(reviewMap);
      setPulseHistory((pulseHistoryRows||[]).map(r=>({ id:r.id, score:r.score, label:r.label, weekStart:r.week_start, generatedAt:r.generated_at })));

      setAuthState("authenticated");
    } catch(err) {
      console.error("loadAllData failed:", err);
      const isExpired = /jwt expired|invalid token|jwt malformed/i.test(err.message || "");
      setAuthError(
        isExpired
          ? "You were signed out due to inactivity. Please sign in again."
          : "Could not load your data: " + err.message
      );
      if (isExpired) clearSession();
      setAuthState("unauthenticated");
    }
  }

  // Auto-load on mount if session exists
  useEffect(() => {
    if (authState === "loading") { loadAllData(); }
  }, []);

  // Check if a Pulse reminder is due on load
  useEffect(() => {
    if (authState !== "authenticated") return;
    try {
      const freq = localStorage.getItem("sw_notif_freq") || "login";
      if (freq === "off") return;
      const lastRun = localStorage.getItem("sw_notif_last_run");
      const now = new Date();
      let isDue = false;
      if (freq === "login") {
        isDue = true;
      } else if (freq === "daily") {
        if (!lastRun) { isDue = true; }
        else { const last = new Date(lastRun); isDue = now.toDateString() !== last.toDateString(); }
      } else if (freq === "weekly") {
        const day = localStorage.getItem("sw_notif_day") || "Monday";
        const DAYS_MAP = {Sunday:0,Monday:1,Tuesday:2,Wednesday:3,Thursday:4,Friday:5,Saturday:6};
        if (now.getDay() === DAYS_MAP[day]) {
          if (!lastRun) { isDue = true; }
          else { const last = new Date(lastRun); isDue = now.toDateString() !== last.toDateString(); }
        }
      }
      if (isDue) {
        setTimeout(() => {
          showToast("🧠 Time for your Weekly Pulse — head to Business Insights", 6000);
          localStorage.setItem("sw_notif_last_run", now.toISOString());
        }, 2000);
      }
    } catch {}
  }, [authState]);

  // Handle redirect back from Square OAuth (?square=connected | error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sq = params.get("square");
    if (sq === "connected") {
      showToast("Square connected ✓", 4000);
      const inSetup = (() => { try { return localStorage.getItem("sw_setup_step") !== null; } catch { return false; } })();
      if (!inSetup) setTab("dashboard");
      if (bizId) checkSquareStatus(bizId);
    } else if (sq === "error") {
      showToast("Square connection failed — please try again", 5000);
      const inSetup = (() => { try { return localStorage.getItem("sw_setup_step") !== null; } catch { return false; } })();
      if (!inSetup) setTab("dashboard");
    }
    if (sq) window.history.replaceState({}, "", window.location.pathname);
  }, [bizId]);

  // ─────────────────────────────────────────────────────────────────────────
  // DATA SNAPSHOT — single function to package all business context for AI.
  // When migrating to Supabase, replace this function's internals with
  // database queries. The AI call below remains completely unchanged.
  // ─────────────────────────────────────────────────────────────────────────
  function buildBusinessSnapshot() {
    const today = new Date();
    const todayStr = toLocalDateStr(today);

    // Build per-week summaries
    const weekSummaries = weeks.map(wk => {
      const wkDates = wk.dates.map(d => {
        const dt = typeof d === "string" ? new Date(d+"T00:00:00") : d;
        return toLocalDateStr(dt);
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
        const rplhDay = (sale?.revenue && dayHours > 0) ? parseFloat((sale.revenue / dayHours).toFixed(2)) : null;
        return { day, date: wkDates[di], staffCount, totalHours: dayHours, revenue: sale?.revenue || null, revenuePerLaborHour: rplhDay };
      });

      const rplhWeek = (totalRevenue > 0 && totalHours > 0) ? parseFloat((totalRevenue / totalHours).toFixed(2)) : null;

      return {
        label: wk.label,
        startDate: wkDates[0],
        endDate: wkDates[6],
        totalScheduledHours: parseFloat(totalHours.toFixed(2)),
        totalEstimatedPay: parseFloat(totalPay.toFixed(2)),
        totalRevenue: totalRevenue > 0 ? parseFloat(totalRevenue.toFixed(2)) : null,
        laborCostPct: laborPct !== null ? parseFloat(laborPct.toFixed(1)) : null,
        revenuePerLaborHour: rplhWeek,
        staffScheduled: staffed,
        totalStaff: employees.length,
        budget: parseFloat(weeklyBudget) || null,
        overBudget: weeklyBudget && totalPay > parseFloat(weeklyBudget),
        employeeBreakdown,
        dailyTotals,
      };
    });

    const recentFlags = punches
      .filter(p => p.flags && p.flags.length > 0)
      .slice(-20)
      .map(p => ({ employee: p.empName, type: p.type, flags: p.flags, time: p.time }));

    const overtimeAlerts = employees
      .filter(e => weeks.some(w => eWkH(w.key, e.id) > 40))
      .map(e => ({ name: e.name, hours: Math.max(...weeks.map(w => eWkH(w.key, e.id))) }));

    // ── Budget burn (mid-week pace → projected end) ──────────────────────────
    const budget = parseFloat(weeklyBudget) || null;
    let budgetBurn = null;
    if (budget && weekSummaries[0]) {
      const wk0 = weekSummaries[0];
      const wkDates0 = weeks[0]?.dates.map(d => {
        const dt = typeof d === "string" ? new Date(d+"T00:00:00") : d;
        return toLocalDateStr(dt);
      }) || [];
      const todayIdx0 = wkDates0.indexOf(todayStr);
      const daysPassed = todayIdx0 >= 0 ? todayIdx0 + 1 : 7;
      const dailyRate = daysPassed > 0 ? wk0.totalEstimatedPay / daysPassed : 0;
      const projectedEnd = parseFloat((dailyRate * 7).toFixed(2));
      const overBy = parseFloat((projectedEnd - budget).toFixed(2));
      budgetBurn = {
        spent: wk0.totalEstimatedPay,
        budget,
        projectedEnd,
        projectedOver: projectedEnd > budget,
        overBy: overBy > 0 ? overBy : 0,
        pct: parseFloat(((wk0.totalEstimatedPay / budget) * 100).toFixed(1)),
        daysPassed,
      };
    }

    // ── Punch variance (scheduled vs actual per employee) ────────────────────
    const wk0Dates = weeks[0]?.dates.map(d => {
      const dt = typeof d === "string" ? new Date(d+"T00:00:00") : d;
      return toLocalDateStr(dt);
    }) || [];
    const punchVariance = employees.map(emp => {
      const scheduled = weekSummaries[0]?.employeeBreakdown?.find(e => e.name === emp.name)?.scheduledHours || 0;
      const actualPunches = punches.filter(p => {
        const pd = toLocalDateStr(new Date(p.time));
        return p.empId === emp.id && wk0Dates.includes(pd);
      });
      let actual = 0, inT = null;
      for (const p of [...actualPunches].sort((a,b)=>new Date(a.time)-new Date(b.time))) {
        if (p.type === "in" || p.type === "break_in") inT = new Date(p.time);
        else if (p.type === "out" && inT) { actual += (new Date(p.time)-inT)/3600000; inT = null; }
      }
      actual = parseFloat(actual.toFixed(2));
      return { name: emp.name, scheduled, actual, diff: parseFloat((actual - scheduled).toFixed(2)) };
    }).filter(e => e.scheduled > 0 || e.actual > 0);

    // ── Attendance flags ──────────────────────────────────────────────────────
    const recentPunches = punches.filter(p => (today - new Date(p.time)) / (1000*60*60*24) <= 30);
    const todayDayIdx = today.getDay();
    const todayWeekKey = weeks[0]?.key;

    const lateArrivals = employees.map(emp => {
      const lates = wk0Dates.map((dateStr, di) => {
        const shift = schedule?.[todayWeekKey]?.[emp.id]?.[di] || null;
        if (!shift) return null;
        const scheduledStart = new Date(dateStr+"T00:00:00");
        scheduledStart.setHours(Math.floor(shift.start), Math.round((shift.start % 1) * 60));
        const clockIn = punches.find(p => p.empId === emp.id && p.type === "in" && toLocalDateStr(new Date(p.time)) === dateStr);
        if (!clockIn) return null;
        const minsLate = (new Date(clockIn.time) - scheduledStart) / 60000;
        return minsLate > 10 ? minsLate : null;
      }).filter(Boolean);
      return lates.length > 0 ? { name: emp.name, count: lates.length } : null;
    }).filter(Boolean);

    const missedPunches = employees.map(emp => {
      const shift = schedule?.[todayWeekKey]?.[emp.id]?.[todayDayIdx] || null;
      if (!shift) return null;
      const scheduledStart = new Date(todayStr+"T00:00:00");
      scheduledStart.setHours(Math.floor(shift.start), Math.round((shift.start % 1) * 60));
      if (today < scheduledStart) return null;
      const hasPunch = punches.some(p => p.empId === emp.id && p.type === "in" && toLocalDateStr(new Date(p.time)) === todayStr);
      return hasPunch ? null : { name: emp.name };
    }).filter(Boolean);

    const reliabilityFlags = employees.map(emp => {
      const flagCount = recentPunches.filter(p => p.empId === emp.id && p.flags?.length > 0).length;
      return flagCount > 0 ? { name: emp.name, flags30Days: flagCount } : null;
    }).filter(Boolean).sort((a,b) => b.flags30Days - a.flags30Days);

    return {
      businessName: biz,
      businessHours: Object.entries(businessHours).reduce((acc,[di,h])=>({...acc,[DAYS[parseInt(di)]]:h}),{}),
      today: todayStr,
      dayOfWeek: today.toLocaleDateString("en-US", { weekday: "long" }),
      totalEmployees: employees.length,
      weeklyBudget: budget,
      hasSalesData: salesData.length > 0,
      salesDateRange: salesData.length > 0
        ? { from: salesData[0].date, to: salesData[salesData.length - 1].date }
        : null,
      weeks: weekSummaries,
      budgetBurn,
      punchVariance,
      attendanceFlags: { lateArrivals, missedPunches, reliabilityFlags },
      overtimeAlerts,
      recentPunchFlags: recentFlags,
      publishedSchedulesCount: published.length,
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

    // Small delay so the loading skeleton renders before heavy computation
    setTimeout(async () => {
      try {
        const snapshot = buildBusinessSnapshot();
        const result   = computePulse(snapshot);
        const now = new Date().toISOString();
        const weekStart = wk1Start;
        setInsight({ ...result, generatedAt: now, snapshot });
        // Save score to pulse_history
        if (bizId) {
          try {
            await fetch(`${SUPABASE_URL}/rest/v1/pulse_history?on_conflict=business_id,week_start`, {
              method: "POST",
              headers: { ...SB_HEADERS, Authorization: `Bearer ${getToken()}`, Prefer: "resolution=merge-duplicates,return=minimal" },
              body: JSON.stringify({ business_id: bizId, score: result.score.value, label: result.score.label, week_start: weekStart })
            });
            // Reload history
            const rows = await dbGet(`pulse_history?select=*&business_id=eq.${bizId}&order=generated_at.desc&limit=20`);
            setPulseHistory((rows||[]).map(r=>({ id:r.id, score:r.score, label:r.label, weekStart:r.week_start, generatedAt:r.generated_at })));
          } catch(e) { console.warn("pulse_history save failed:", e); }
        }
      } catch (err) {
        setInsightError("Could not generate insights right now. Check your data and try again.");
        console.error("Pulse engine error:", err);
      } finally {
        setInsightLoading(false);
      }
    }, 600);
  }

  // ── Deterministic Pulse engine ─────────────────────────────────────────────
  // Reads the snapshot produced by buildBusinessSnapshot() and returns the
  // same JSON shape that the Claude API used to return — so the UI is unchanged.
  function computePulse(snap) {
    const wk      = snap.weeks?.[0] || {};
    const burn    = snap.budgetBurn;
    const pv      = snap.punchVariance || [];
    const af      = snap.attendanceFlags || {};
    const ot      = snap.overtimeAlerts || [];
    const budget  = snap.weeklyBudget;
    const hasSales = snap.hasSalesData && wk.totalRevenue > 0;
    const rplh    = wk.revenuePerLaborHour;
    const laborPct = wk.laborCostPct;
    const totalPay = wk.totalEstimatedPay || 0;
    const totalHrs = wk.totalScheduledHours || 0;
    const staffed  = wk.staffScheduled || 0;
    const empCount = snap.totalEmployees || 0;
    const bizName  = snap.businessName || "your business";
    const dayOfWeek = snap.dayOfWeek || "today";

    // ── helper: $ formatter ──
    const $$ = n => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    const pct = n => `${Math.round(n)}%`;
    const hrs = n => `${parseFloat(n.toFixed(1))}h`;

    // ── Score calculation (0-100) ────────────────────────────────────────────
    let score = 100;
    const scorePenalties = [];

    // Overtime
    if (ot.length > 0) {
      score -= 20;
      scorePenalties.push(`${ot.length} employee${ot.length > 1 ? "s" : ""} over 40h`);
    } else {
      const nearOT = wk.employeeBreakdown?.filter(e => e.scheduledHours >= 36 && e.scheduledHours <= 40) || [];
      if (nearOT.length) { score -= 8; scorePenalties.push("near overtime risk"); }
    }

    // Budget
    if (budget) {
      if (totalPay > budget) { score -= 15; scorePenalties.push("over budget"); }
      else if (burn?.projectedOver) { score -= 10; scorePenalties.push("projected over budget"); }
    }

    // Punch variance — total absolute overage
    const totalOverage = pv.reduce((s, e) => s + Math.max(0, e.diff), 0);
    if (totalOverage > 8) { score -= 12; scorePenalties.push(`${totalOverage.toFixed(1)}h punch overage`); }
    else if (totalOverage > 4) { score -= 6; }

    // Missed punches
    if (af.missedPunches?.length) { score -= 10; scorePenalties.push("missed punch-in today"); }

    // Attendance flags
    const topFlagCount = af.reliabilityFlags?.[0]?.flags30Days || 0;
    if (topFlagCount >= 7) { score -= 8; scorePenalties.push("attendance reliability concern"); }
    else if (topFlagCount >= 4) { score -= 4; }

    // Coverage gaps — days with no staff but business is open
    const openDays = Object.values(snap.businessHours || {}).filter(h => h?.isOpen !== false).length;
    const coveredDays = wk.dailyTotals?.filter(d => d.staffCount > 0).length || 0;
    const gapDays = Math.max(0, openDays - coveredDays);
    if (gapDays > 0) { score -= gapDays * 5; scorePenalties.push(`${gapDays} uncovered day${gapDays > 1 ? "s" : ""}`); }

    // No sales data — minor deduction (can't measure efficiency)
    if (!hasSales) score -= 3;

    score = Math.max(0, Math.min(100, Math.round(score)));
    const scoreLabel  = score >= 75 ? "Healthy" : score >= 50 ? "Caution" : score >= 30 ? "Warning" : "Critical";
    const scoreReason = scorePenalties.length
      ? `Key concerns: ${scorePenalties.slice(0,2).join(" and ")}.`
      : "Schedule looks solid with no major issues detected.";

    // ── Headline — score-aware, leads with positives when healthy ───────────
    let headline = "";
    if (score >= 75) {
      // Healthy — lead with what's going well
      if (hasSales && rplh) {
        headline = `Strong week — earning ${$$(rplh)} per labor hour${burn?.projectedOver ? ` · watch budget pace` : ""}`;
      } else if (budget && !burn?.projectedOver && totalPay <= budget) {
        headline = `Labor on track — ${$$(budget - totalPay)} of runway left in this week's budget`;
      } else if (ot.length > 0) {
        headline = `Good week overall — but ${ot[0].name} is approaching overtime, act before end of week`;
      } else if (burn?.projectedOver) {
        headline = `Schedule looks healthy — heads up, current pace projects ${$$(burn.overBy)} over budget`;
      } else {
        headline = `${staffed} of ${empCount} employees scheduled — ${totalHrs}h total labor, looking solid`;
      }
    } else {
      // Caution / Warning / Critical — lead with the biggest issue
      if (ot.length > 0) {
        headline = `${ot[0].name} is headed for overtime — act before it posts`;
      } else if (budget && totalPay > budget) {
        headline = `Labor spend is ${$$(totalPay - budget)} over your weekly budget`;
      } else if (burn?.projectedOver) {
        headline = `On pace to finish ${$$(burn.overBy)} over budget — trim hours now to course-correct`;
      } else if (af.missedPunches?.length) {
        headline = `${af.missedPunches[0].name} has no punch-in recorded today`;
      } else if (gapDays > 0) {
        headline = `${gapDays} open day${gapDays > 1 ? "s" : ""} with no staff scheduled`;
      } else if (hasSales && rplh) {
        headline = `Earning ${$$(rplh)}/labor hr — check your lowest-revenue days`;
      } else if (totalHrs === 0) {
        headline = "No shifts scheduled yet — build your schedule to get insights";
      } else {
        headline = `${staffed} of ${empCount} employees scheduled — ${totalHrs}h total labor this week`;
      }
    }

    // ── Pulse narrative (3-4 sentences) ──────────────────────────────────────
    const sentences = [];

    // Sentence 1 — labor cost / budget
    if (budget) {
      const runway = budget - totalPay;
      if (totalPay > budget) {
        sentences.push(`This week's scheduled labor is ${$$(totalPay)}, which is ${$$(Math.abs(runway))} over your ${$$(budget)} budget.`);
      } else {
        sentences.push(`This week's scheduled labor is ${$$(totalPay)} against a ${$$(budget)} budget, leaving ${$$(runway)} of runway.`);
      }
    } else if (totalHrs > 0) {
      sentences.push(`You have ${totalHrs}h of scheduled labor this week across ${staffed} employee${staffed !== 1 ? "s" : ""}, estimated at ${$$(totalPay)}.`);
    } else {
      sentences.push(`No shifts are scheduled yet for ${bizName} this week.`);
    }

    // Sentence 2 — revenue efficiency or sales prompt
    if (hasSales && rplh) {
      const days = wk.dailyTotals?.filter(d => d.revenuePerLaborHour) || [];
      const best  = days.reduce((b, d) => (!b || d.revenuePerLaborHour > b.revenuePerLaborHour) ? d : b, null);
      const worst = days.reduce((w, d) => (!w || d.revenuePerLaborHour < w.revenuePerLaborHour) ? d : w, null);
      if (best && worst && best.day !== worst.day) {
        sentences.push(`You're earning ${$$(rplh)} per labor hour on average — ${best.day} leads at ${$$(best.revenuePerLaborHour)}/hr while ${worst.day} lags at ${$$(worst.revenuePerLaborHour)}/hr.`);
      } else {
        sentences.push(`With ${$$(wk.totalRevenue)} in sales, you're earning ${$$(rplh)} per labor hour${laborPct ? ` and running a ${laborPct}% labor cost` : ""}.`);
      }
    } else if (!hasSales) {
      sentences.push(`No sales data is loaded yet — import your Square CSV to unlock revenue-per-labor-hour and labor cost % tracking.`);
    }

    // Sentence 3 — biggest risk
    if (ot.length > 0) {
      const topOT = ot[0];
      sentences.push(`Watch overtime — ${topOT.name} is scheduled for ${topOT.hours}h and will trigger overtime pay if not adjusted before end of week.`);
    } else if (totalOverage > 3) {
      const topOver = [...pv].sort((a,b) => b.diff - a.diff)[0];
      sentences.push(`Punch variance is running high — ${topOver.name} has clocked ${topOver.diff.toFixed(1)}h over their scheduled hours, which will push actual labor costs above estimates.`);
    } else if (burn?.projectedOver) {
      sentences.push(`Mid-week pace puts you on track to finish at ${$$(burn.projectedEnd)} — ${$$(burn.overBy)} over budget — unless you trim hours in the back half of the week.`);
    } else if (af.missedPunches?.length) {
      sentences.push(`${af.missedPunches.map(m => m.name).join(" and ")} ${af.missedPunches.length === 1 ? "has" : "have"} a shift today with no punch-in recorded — verify attendance.`);
    } else if (gapDays > 0) {
      sentences.push(`You have ${gapDays} day${gapDays > 1 ? "s" : ""} without any staff scheduled during posted business hours — review coverage before the week runs out.`);
    }

    // Sentence 4 — forward look or positive
    if (score >= 75) {
      sentences.push(`Overall the schedule looks healthy — focus next week on maintaining coverage on your highest-revenue days.`);
    } else if (hasSales) {
      const days = wk.dailyTotals?.filter(d => d.revenuePerLaborHour) || [];
      const worst = days.reduce((w, d) => (!w || d.revenuePerLaborHour < w.revenuePerLaborHour) ? d : w, null);
      if (worst) {
        sentences.push(`Your biggest efficiency opportunity is ${worst.day} — consider pulling back staffing there and redirecting hours to higher-revenue days.`);
      }
    }

    const pulse = sentences.join(" ");

    // ── Actions (priority-ordered) ────────────────────────────────────────────
    const actions = [];
    let priority = 1;

    // 1. Overtime — most urgent
    ot.forEach(e => {
      if (priority <= 5) {
        actions.push({
          priority: priority++,
          action: `Reduce ${e.name}'s hours to stay under 40 this week`,
          why: `At ${e.hours}h scheduled, any additional time will trigger overtime pay — typically 1.5× their hourly rate for every hour over 40.`,
        });
      }
    });

    // 2. Missed punch-in today
    (af.missedPunches || []).forEach(m => {
      if (priority <= 5) {
        actions.push({
          priority: priority++,
          action: `Confirm ${m.name} came in and add a manual punch for today`,
          why: `No clock-in recorded for their ${m.day} shift — payroll and punch variance will be inaccurate without it.`,
        });
      }
    });

    // 3. Budget overrun
    if (priority <= 5 && budget && (totalPay > budget || burn?.projectedOver)) {
      const overBy = totalPay > budget ? totalPay - budget : burn?.overBy || 0;
      actions.push({
        priority: priority++,
        action: `Find ${$$(Math.ceil(overBy / 15))}h to cut from the back half of the week`,
        why: `You're ${$$(overBy)} over budget${burn?.projectedOver ? " on current pace" : ""} — trimming overlap shifts is the fastest fix.`,
      });
    }

    // 4. Worst RPLH day — rebalance staffing
    if (priority <= 5 && hasSales) {
      const days = (wk.dailyTotals || []).filter(d => d.revenuePerLaborHour && d.totalHours > 0);
      const worst = days.reduce((w, d) => (!w || d.revenuePerLaborHour < w.revenuePerLaborHour) ? d : w, null);
      const best  = days.reduce((b, d) => (!b || d.revenuePerLaborHour > b.revenuePerLaborHour) ? d : b, null);
      if (worst && best && worst.day !== best.day && worst.revenuePerLaborHour < rplh * 0.7) {
        actions.push({
          priority: priority++,
          action: `Pull one shift from ${worst.day} and add it to ${best.day}`,
          why: `${worst.day} earns ${$$(worst.revenuePerLaborHour)}/labor hr vs ${best.day}'s ${$$(best.revenuePerLaborHour)}/hr — a simple swap improves your margin without cutting total hours.`,
        });
      }
    }

    // 5. Coverage gaps
    if (priority <= 5 && gapDays > 0) {
      const uncovered = (wk.dailyTotals || []).filter(d => d.staffCount === 0);
      const dayNames = uncovered.map(d => d.day).join(", ");
      actions.push({
        priority: priority++,
        action: `Schedule at least one person for ${dayNames}`,
        why: `Business hours show you're open on ${dayNames} but no staff are assigned — you're either losing revenue or working alone.`,
      });
    }

    // 6. High punch variance
    if (priority <= 5 && totalOverage > 4) {
      const top = [...pv].sort((a,b) => b.diff - a.diff)[0];
      if (top?.diff > 2) {
        actions.push({
          priority: priority++,
          action: `Talk to ${top.name} about clocking out on time`,
          why: `They've run ${top.diff.toFixed(1)}h over scheduled hours — at their rate that's roughly ${$$(top.diff * ((wk.employeeBreakdown?.find(e=>e.name===top.name)?.hourlyRate)||0))} in unplanned labor cost.`,
        });
      }
    }

    // 7. No schedule at all
    if (priority === 1 && totalHrs === 0) {
      actions.push({
        priority: 1,
        action: "Build your schedule for this week to start tracking labor costs",
        why: "Without shifts, ShiftWise can't calculate budget burn, overtime risk, or revenue efficiency.",
      });
    }

    // ── Sections — rich templated analysis per topic ─────────────────────────
    const sections = [];
    const nearOTEmps = wk.employeeBreakdown?.filter(e => e.scheduledHours >= 36) || [];

    // ── SECTION 1: Labor Cost — always shown ─────────────────────────────────
    {
      const overBudget = budget && totalPay > budget;
      const projOver   = burn?.projectedOver;
      const runway     = budget ? budget - totalPay : 0;
      const urgency    = overBudget ? "high" : projOver ? "medium" : "low";

      let insight = "";
      if (!budget && totalHrs === 0) {
        insight = `No shifts are scheduled yet this week — there's nothing to track yet. Head to the Schedule tab, build out the week, and come back for a full labor analysis.`;
      } else if (!budget) {
        insight = `You've scheduled ${hrs(totalHrs)} of labor across ${staffed} employee${staffed!==1?"s":""}, estimated at ${$$(totalPay)} for the week. You haven't set a weekly budget yet — add one in Settings and ShiftWise will automatically flag you when you're trending over.`;
      } else if (overBudget) {
        const overAmt = totalPay - budget;
        const overPct = Math.round((overAmt / budget) * 100);
        insight = `Scheduled labor is ${$$(totalPay)}, which puts you ${$$(overAmt)} (${overPct}%) over your ${$$(budget)} weekly budget. That gap needs to close before payroll runs — look for overlap shifts or days where coverage exceeds what the schedule actually requires. ${hasSales && laborPct ? `At ${pct(laborPct)} of revenue, labor cost is above the 25–35% target range.` : ""}`;
      } else if (projOver) {
        insight = `You're at ${$$(totalPay)} against a ${$$(budget)} budget with ${hrs(burn.daysPassed)} days elapsed. At this pace you'll finish the week at ${$$(burn.projectedEnd)} — ${$$(burn.overBy)} over. The back half of the week is your window to course-correct by trimming a shift or two. ${hasSales && laborPct ? `Current labor cost is ${pct(laborPct)} of revenue.` : ""}`;
      } else {
        const usedPct = budget > 0 ? Math.round((totalPay / budget) * 100) : 0;
        insight = `Labor is running at ${$$(totalPay)} against your ${$$(budget)} budget — ${$$(runway)} of runway remaining (${100 - usedPct}% unused). ${burn ? `Mid-week pace projects you to finish at ${$$(burn.projectedEnd)}, which is under budget.` : ""} ${hasSales && laborPct ? `Your labor cost is ${pct(laborPct)} of revenue, which is ${laborPct <= 35 ? "within" : "above"} the 25–35% target.` : ""}`;
      }
      sections.push({ title: "Labor Cost", icon: "💰", urgency, insight });
    }

    // ── SECTION 2: Revenue Efficiency — shown when sales data exists ──────────
    if (hasSales) {
      const days = (wk.dailyTotals || []).filter(d => d.revenuePerLaborHour && d.totalHours > 0);
      const best  = days.reduce((b,d) => (!b || d.revenuePerLaborHour > b.revenuePerLaborHour) ? d : b, null);
      const worst = days.reduce((w,d) => (!w || d.revenuePerLaborHour < w.revenuePerLaborHour) ? d : w, null);
      const spread = best && worst && best.day !== worst.day ? best.revenuePerLaborHour - worst.revenuePerLaborHour : 0;
      const urgency = !rplh ? "low" : rplh < 15 ? "high" : rplh < 25 ? "medium" : "low";

      let insight = "";
      if (!rplh) {
        insight = `Sales data is loaded but no labor hours are scheduled yet, so revenue per labor hour can't be calculated. Build out this week's schedule and the efficiency numbers will populate automatically.`;
      } else if (rplh >= 40) {
        insight = `You're generating ${$$(rplh)} in revenue per labor hour this week — that's excellent efficiency. ${best ? `${best.day} is your strongest day at ${$$(best.revenuePerLaborHour)}/hr.` : ""} ${laborPct ? `Overall labor cost is ${pct(laborPct)} of revenue.` : ""} At this ratio, you have room to reinvest some of that margin back into staffing on your highest-traffic days without hurting profitability.`;
      } else if (rplh >= 25) {
        insight = `Revenue per labor hour is ${$$(rplh)} this week — solidly within range. ${best && worst && best.day !== worst.day ? `${best.day} leads at ${$$(best.revenuePerLaborHour)}/hr while ${worst.day} trails at ${$$(worst.revenuePerLaborHour)}/hr — a ${$$(Math.round(spread))} spread.` : ""} ${laborPct ? `Labor cost is ${pct(laborPct)} of revenue.` : ""} The opportunity is to shift more hours toward your stronger days.`;
      } else if (rplh >= 15) {
        insight = `Revenue per labor hour is ${$$(rplh)} this week, which is below the target range. ${worst ? `${worst.day} is the main drag at ${$$(worst.revenuePerLaborHour)}/hr` : ""} — that's a day where you're paying more in labor than the volume justifies. ${laborPct ? `Labor cost is ${pct(laborPct)} of revenue — consider trimming hours on slow days and protecting coverage on your top performers.` : ""}`;
      } else {
        insight = `Revenue per labor hour is ${$$(rplh)} this week, which is low. For every dollar of labor you're only generating ${$$(Math.round(rplh))} in revenue. ${worst ? `${worst.day} is the weakest point at ${$$(worst.revenuePerLaborHour)}/hr.` : ""} This usually means either over-staffing on slow days, slow sales this week, or both. ${laborPct ? `Labor cost at ${pct(laborPct)} of revenue needs to come down.` : ""}`;
      }
      sections.push({ title: "Revenue Efficiency", icon: "💵", urgency, insight });
    } else {
      sections.push({
        title: "Revenue Efficiency",
        icon: "💵",
        urgency: "low",
        insight: `No sales data is connected yet. When you link Square, ShiftWise calculates revenue per labor hour for every day of the week — the single clearest signal of whether your staffing is earning its cost. Connect Square in the Dashboard tab or import a sales CSV to unlock this section.`,
      });
    }

    // ── SECTION 3: Overtime & Hours Risk ─────────────────────────────────────
    if (nearOTEmps.length > 0 || ot.length > 0) {
      const topEmp = [...nearOTEmps].sort((a,b) => b.scheduledHours - a.scheduledHours)[0];
      const isOver = ot.length > 0;
      const urgency = isOver ? "high" : "medium";
      const hrOver  = topEmp ? parseFloat((topEmp.scheduledHours - 40).toFixed(1)) : 0;
      const hrToSafe = topEmp ? parseFloat((topEmp.scheduledHours - 38).toFixed(1)) : 0;
      const rate    = topEmp?.hourlyRate || 0;
      const otCost  = isOver && rate > 0 ? $$(Math.round(hrOver * rate * 0.5)) : null;

      let insight = "";
      if (isOver && ot.length > 1) {
        insight = `${ot.length} employees are scheduled over 40 hours this week: ${ot.map(e=>`${e.name} at ${hrs(e.hours)}`).join(", ")}. Each hour over 40 costs 1.5× their hourly rate — this is a payroll hit that compounds fast. Review their schedules now and look for shifts that can be reassigned or shortened before week end.`;
      } else if (isOver) {
        const e = ot[0];
        insight = `${e.name} is scheduled for ${hrs(e.hours)} this week — ${hrs(e.hours - 40)} into overtime territory. ${rate > 0 ? `Those overtime hours carry a ${otCost} premium above their regular rate.` : "Every hour over 40 costs 1.5× their regular rate."} The fastest fix is to pull one shift or trim the end of their longest day to get under 40h before payroll closes.`;
      } else {
        insight = `${topEmp.name} is at ${hrs(topEmp.scheduledHours)} — ${hrs(40 - topEmp.scheduledHours)} away from overtime. That's close enough that any unexpected clock-in time or manual adjustment could push them over. ${hrToSafe > 0 ? `Trimming ${hrs(hrToSafe)} now gives you a safe buffer.` : ""} Keep an eye on their punch times through the rest of the week.`;
      }
      sections.push({ title: "Overtime Risk", icon: "⏱️", urgency, insight });
    }

    // ── SECTION 4: Attendance & Reliability ──────────────────────────────────
    const hasAttendance = (af.lateArrivals?.length || 0) + (af.missedPunches?.length || 0) + (af.reliabilityFlags?.length || 0) > 0;
    if (hasAttendance) {
      const topFlag = af.reliabilityFlags?.[0];
      const urgency = af.missedPunches?.length ? "high" : topFlag?.flags30Days >= 7 ? "medium" : "low";

      let insight = "";
      const parts = [];
      if (af.missedPunches?.length) {
        const names = af.missedPunches.map(m=>m.name).join(" and ");
        parts.push(`${names} ${af.missedPunches.length===1?"has":"have"} a scheduled shift today with no clock-in recorded. If they're actually working, add a manual punch in the Timesheet tab so payroll and punch variance stay accurate. If they didn't show up, this is a no-call-no-show and needs to be followed up directly.`);
      }
      if (af.lateArrivals?.length) {
        const lateNames = af.lateArrivals.map(a=>`${a.name} (${a.count} time${a.count!==1?"s":""})`).join(", ");
        parts.push(`Late clock-ins this week: ${lateNames}. Occasional lateness isn't always a problem, but a pattern across multiple days signals either a schedule mismatch or a reliability issue worth addressing.`);
      }
      if (topFlag && !af.missedPunches?.length) {
        parts.push(`${topFlag.name} has accumulated ${topFlag.flags30Days} attendance flag${topFlag.flags30Days!==1?"s":""} in the last 30 days — the highest on your team. That's enough of a pattern to warrant a direct conversation before it affects scheduling reliability.`);
      }
      insight = parts.join(" ");
      sections.push({ title: "Attendance Patterns", icon: "🚩", urgency, insight });
    } else if (totalHrs > 0) {
      sections.push({
        title: "Attendance Patterns",
        icon: "🚩",
        urgency: "low",
        insight: `No attendance flags this week — everyone is clocking in on time and without issues. That's worth noting because clean attendance is one of the things that quietly erodes labor cost accuracy when it goes wrong. Keep the kiosk running so the punch record stays current.`,
      });
    }

    // ── SECTION 5: Schedule Gaps — if any ────────────────────────────────────
    if (gapDays > 0) {
      const uncovered = (wk.dailyTotals || []).filter(d => d.staffCount === 0).map(d => d.day);
      const urgency   = gapDays >= 3 ? "high" : gapDays >= 2 ? "medium" : "low";
      const revLost   = hasSales && wk.dailyTotals ? $$(Math.round(wk.dailyTotals.filter(d=>uncovered.includes(d.day)).reduce((s,d)=>s+(d.revenue||0),0))) : null;
      let insight = `${uncovered.join(", ")} ${uncovered.length===1?"has":"have"} no staff scheduled this week, but your business hours show you're open on ${uncovered.length===1?"that day":"those days"}. `;
      insight += revLost && revLost !== "$0" ? `Historical data suggests you'd expect around ${revLost} in revenue on ${uncovered.length===1?"that day":"those days"} — leaving it unstaffed either means lost sales or you're working it alone. ` : `Either you're covering it yourself or the revenue opportunity is going unserved. `;
      insight += `If the day is intentionally closed, update your operating hours in Settings so the schedule grid reflects it. If you need coverage, check the Coverage tab for available staff.`;
      sections.push({ title: "Schedule Gaps", icon: "📅", urgency, insight });
    }

    // ── Positives ─────────────────────────────────────────────────────────────
    const positives = [];
    if (budget && totalPay <= budget && !burn?.projectedOver) {
      const pctUsed = Math.round((totalPay / budget) * 100);
      positives.push(`Labor budget on track — ${$$(budget - totalPay)} remaining (${100-pctUsed}% unused)`);
    }
    if (ot.length === 0 && nearOTEmps.length === 0) {
      positives.push("No overtime risk — full team is under 36 scheduled hours");
    }
    if (hasSales && rplh >= 25) {
      positives.push(`Strong revenue efficiency at ${$$(rplh)}/labor hour${laborPct ? ` · ${pct(laborPct)} labor cost` : ""}`);
    }
    if (coveredDays >= openDays && openDays > 0) {
      positives.push(`All ${openDays} open day${openDays!==1?"s":""} have staff scheduled`);
    }
    if (staffed === empCount && empCount > 0) {
      positives.push(`Full team on the schedule — all ${empCount} employee${empCount!==1?"s":""} have shifts this week`);
    }
    if (!af.missedPunches?.length && !af.lateArrivals?.length && totalHrs > 0) {
      positives.push("Clean attendance this week — no missed punches or late clock-ins");
    }
    if (positives.length === 0) {
      positives.push(`${staffed} employee${staffed!==1?"s":""} scheduled · ${hrs(totalHrs)} total labor tracked`);
    }

    // ── Next week focus — specific and actionable ──────────────────────────────
    let nextWeekFocus = "";
    const salesDays = hasSales ? (wk.dailyTotals||[]).filter(d=>d.revenue && d.totalHours>0).sort((a,b)=>b.revenue-a.revenue) : [];
    const topSalesDay = salesDays[0];
    const bottomSalesDay = salesDays[salesDays.length-1];

    if (ot.length > 0) {
      nextWeekFocus = `Before building next week's schedule, resolve this week's overtime. ${ot[0].name} finishing over 40h means next week needs to start with a lighter load for them. Redistribute their hours across the team if the coverage is still needed — don't just cut the shift and leave a gap.`;
    } else if (hasSales && topSalesDay && bottomSalesDay && topSalesDay.day !== bottomSalesDay.day) {
      const topRev = $$(topSalesDay.revenue);
      const botRev = $$(bottomSalesDay.revenue);
      nextWeekFocus = `Build next week around ${topSalesDay.day} first — at ${topRev} in sales it's your highest-revenue day and where staffing decisions have the most margin impact. ${bottomSalesDay.day} brought in ${botRev} — review whether current staffing there is proportional to the volume, and consider shifting hours to stronger days if it isn't.`;
    } else if (burn?.projectedOver || (budget && totalPay > budget)) {
      const target = budget ? $$(Math.round(budget * 0.9)) : null;
      nextWeekFocus = `Use this week's overage as your calibration point. ${target ? `Try targeting ${target} in scheduled labor next week — 10% under budget gives you room for punch variance without blowing the number.` : "Set a weekly budget in Settings, then build the schedule to that number instead of building first and checking cost after."}`;
    } else if (!hasSales) {
      nextWeekFocus = `The most impactful thing you can do before next week is connect your Square account. Revenue per labor hour is the one number that tells you whether your staffing is earning its cost — and right now ShiftWise can't calculate it without sales data. Five minutes in the Dashboard tab unlocks it permanently.`;
    } else if (topSalesDay) {
      nextWeekFocus = `${topSalesDay.day} is your best revenue day at ${$$(topSalesDay.revenue)}. Make sure it's fully staffed next week before filling in the rest. The schedule should start with your highest-volume days and work backward — not the other way around.`;
    } else {
      nextWeekFocus = `Review your operating hours in Settings and make sure they reflect when you're actually open. Accurate hours let ShiftWise detect coverage gaps automatically and give the Pulse engine better data to work with next week.`;
    }

    return { pulse, headline, score: { value: score, label: scoreLabel, reason: scoreReason }, sections: sections.slice(0, 5), actions: actions.slice(0, 5), positives: positives.slice(0, 3), nextWeekFocus };
  }
  // ── end computePulse ───────────────────────────────────────────────────────

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

  // ── SQUARE INTEGRATION ──────────────────────────────────────────────────
  async function checkSquareStatus(businessId) {
    if (!businessId) { setSquareLoading(false); return; }
    try {
      const res = await fetch(`/api/square-status?business_id=${businessId}`);
      if (!res.ok) throw new Error("not connected");
      const data = await res.json();
      setSquareConnected(!!data.connected);
      setSquareMerchantName(data.merchantName || "");
      setSquareLastSync(data.lastSyncedAt || null);
    } catch {
      setSquareConnected(false);
      setSquareMerchantName("");
      setSquareLastSync(null);
    } finally {
      setSquareLoading(false);
    }
  }

  function handleConnectSquare() {
    if (!bizId) return;
    window.location.href = `/api/square-oauth-start?business_id=${bizId}`;
  }

  async function handleSyncSquare() {
    if (!bizId || squareSyncing) return;
    setSquareSyncing(true);
    try {
      const res = await fetch("/api/square-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: bizId }),
      });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || "Sync failed"); }
      const data = await res.json();
      if (Array.isArray(data.salesData)) {
        setSalesData(prev => {
          const map = {};
          prev.forEach(d => map[d.date] = d);
          data.salesData.forEach(d => map[d.date] = d);
          return Object.values(map).sort((a,b) => a.date.localeCompare(b.date));
        });
      }
      setSquareLastSync(data.lastSyncedAt || new Date().toISOString());
      showToast(`Square sales synced ✓${data.daysSynced ? ` (${data.daysSynced} days)` : ""}`, 4000);
      addAudit("Square Sync", `Synced sales data from Square${data.daysSynced ? ` — ${data.daysSynced} days` : ""}`);
    } catch(err) {
      showToast("Square sync failed: " + err.message, 5000);
    } finally {
      setSquareSyncing(false);
    }
  }

  async function handleDisconnectSquare() {
    if (!bizId) return;
    if (!window.confirm("Disconnect Square? You can reconnect anytime — your imported sales history will stay.")) return;
    try {
      const res = await fetch("/api/square-disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: bizId }),
      });
      if (!res.ok) throw new Error("Could not disconnect");
      setSquareConnected(false);
      setSquareMerchantName("");
      setSquareLastSync(null);
      showToast("Square disconnected");
      addAudit("Square Disconnected", "Square integration disconnected");
    } catch(err) {
      showToast("Could not disconnect: " + err.message, 5000);
    }
  }

  // ── DASHBOARD WIDGETS ────────────────────────────────────────────────────
  async function addWidget() {
    if (!bizId || widgetSaving) return;
    setWidgetSaving(true);
    try {
      const sizeKey = newWidget.display === "stat" ? "sm" : "wide";
      const { w, h } = WIDGET_SIZES[sizeKey];
      const [row] = await dbPost("dashboard_widgets", {
        business_id: bizId,
        data_source: newWidget.data_source,
        time_range: newWidget.time_range,
        display: newWidget.display,
        color: newWidget.color || null,
        show_axis: newWidget.show_axis,
        show_legend: newWidget.show_legend,
        grid_w: w, grid_h: h,
        sort_order: widgets.length,
      });
      setWidgets(prev => [...prev, row]);
      setShowAddWidget(false);
      setNewWidget({ data_source:"sales", time_range:"last7", display:"stat", color:null, show_axis:true, show_legend:true });
      showToast("Widget added ✓");
    } catch(e) {
      showToast("Could not add widget: " + e.message, 5000);
    } finally {
      setWidgetSaving(false);
    }
  }

  // Drag-to-reorder: drop dragWidgetId before/after dragOverWidgetId
  async function handleWidgetDrop(targetId) {
    if (!dragWidgetId || dragWidgetId === targetId) {
      setDragWidgetId(null); setDragOverWidgetId(null); return;
    }
    const from = widgets.findIndex(w=>w.id===dragWidgetId);
    const to   = widgets.findIndex(w=>w.id===targetId);
    if (from===-1 || to===-1) return;
    const reordered = [...widgets];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    const updated = reordered.map((w,i) => ({...w, sort_order:i}));
    setWidgets(updated);
    setDragWidgetId(null); setDragOverWidgetId(null);
    try {
      await Promise.all(updated.map(w => dbPatch(`dashboard_widgets?id=eq.${w.id}`, { sort_order: w.sort_order })));
    } catch(e) { console.warn("Reorder save failed:", e); }
  }

  // Cycles a widget through size presets (Small → Wide → Tall → Large → Small...)
  async function resizeWidget(id) {
    const widget = widgets.find(w=>w.id===id);
    if (!widget) return;
    const currentKey = Object.keys(WIDGET_SIZES).find(k => WIDGET_SIZES[k].w===widget.grid_w && WIDGET_SIZES[k].h===widget.grid_h) || "sm";
    const nextKey = SIZE_CYCLE[(SIZE_CYCLE.indexOf(currentKey)+1) % SIZE_CYCLE.length];
    const { w, h } = WIDGET_SIZES[nextKey];
    setWidgets(prev => prev.map(item => item.id===id ? {...item, grid_w:w, grid_h:h} : item));
    try { await dbPatch(`dashboard_widgets?id=eq.${id}`, { grid_w:w, grid_h:h }); }
    catch(e) { console.warn("Resize save failed:", e); }
  }

  async function removeWidget(id) {
    setWidgets(prev => prev.filter(w => w.id !== id));
    try { await dbDelete(`dashboard_widgets?id=eq.${id}`); }
    catch(e) { console.warn("Widget delete failed:", e); }
  }

  // Resolves a widget config into the underlying Sales/Labor/Forecast data
  function computeWidgetResult(config) {
    const filter = FILTERS.find(f => f.key === config.time_range);
    if (filter?.kind === "forecast") {
      return { kind:"forecast", forecast: getForecast(config.time_range, salesData) };
    }
    const result = { kind:"history" };
    if (config.data_source !== "labor") result.sales = getSales(config.time_range, salesData);
    if (config.data_source !== "sales") result.labor = getLabor(config.time_range, salesData, employees, eDayH);
    return result;
  }

  // Renders a small SVG line or bar chart for one or more series, with
  // optional axis labels (min/max value, first/last date) and a legend.
  function renderMiniChart(series, display, options={}) {
    const { dates=[], showAxis=true, showLegend=true, height=80 } = options;
    const W=300, H=height;
    const padL = showAxis ? 32 : 2;
    const padB = showAxis ? 14 : 2;
    const padT = 2, padR = 2;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const n = series[0]?.values.length || 1;
    const max = Math.max(1, ...series.flatMap(s=>s.values));
    const xOf = i => padL + (n>1 ? (i/(n-1))*plotW : plotW/2);
    const yOf = v => padT + plotH - (v/max)*plotH;

    let chartEls;
    if (display === "line") {
      chartEls = series.map((s,si)=>{
        const pts = s.values.map((v,i)=>`${xOf(i)},${yOf(v)}`).join(" ");
        return <polyline key={si} points={pts} fill="none" stroke={s.color} strokeWidth="2"/>;
      });
    } else {
      const groupW = plotW/n;
      const barW = (groupW*0.6)/series.length;
      chartEls = series.flatMap((s,si)=>s.values.map((v,i)=>{
        const h = Math.max(1,(v/max)*plotH);
        const x = padL + i*groupW + groupW*0.2 + si*barW;
        return <rect key={`${si}-${i}`} x={x} y={padT+plotH-h} width={Math.max(1,barW-1)} height={h} fill={s.color}/>;
      }));
    }

    return (
      <div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:H,display:"block"}} preserveAspectRatio="none">
          {showAxis && (
            <>
              <line x1={padL} y1={padT} x2={padL} y2={padT+plotH} stroke={T.border} strokeWidth="1"/>
              <line x1={padL} y1={padT+plotH} x2={padL+plotW} y2={padT+plotH} stroke={T.border} strokeWidth="1"/>
              <text x={padL-3} y={padT+7} textAnchor="end" fontSize="7" fill={T.sub}>${Math.round(max)}</text>
              <text x={padL-3} y={padT+plotH} textAnchor="end" fontSize="7" fill={T.sub}>$0</text>
            </>
          )}
          {chartEls}
          {showAxis && dates.length>0 && (
            <>
              <text x={padL} y={H-1} textAnchor="start" fontSize="7" fill={T.sub}>{dl(dates[0])}</text>
              <text x={padL+plotW} y={H-1} textAnchor="end" fontSize="7" fill={T.sub}>{dl(dates[dates.length-1])}</text>
            </>
          )}
        </svg>
        {showLegend && (
          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:4}}>
            {series.map(s=>(
              <div key={s.label} style={{display:"flex",alignItems:"center",gap:4,fontSize:9,color:T.sub}}>
                <span style={{width:8,height:8,borderRadius:2,background:s.color,display:"inline-block",flexShrink:0}}/>
                {s.label}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Renders one widget card based on its saved config
  function renderWidgetCard(config) {
    const filter = FILTERS.find(f => f.key === config.time_range);
    const sourceLabel = {sales:"Sales", labor:"Labor", both:"Sales & Labor"}[config.data_source] || "Sales";
    const title = config.title || `${sourceLabel} · ${filter?.label || config.time_range}`;
    const result = computeWidgetResult(config);
    const gridH = config.grid_h || 1;
    const primaryColor = config.color || "#3A9BE8";
    const secondaryColor = "#E8A93A";
    const chartHeight = gridH >= 2 ? 140 : 80;
    let body = null;

    if (config.display === "stat") {
      if (result.kind === "forecast") {
        body = result.forecast.hasEnoughData ? (
          <>
            <div style={{fontSize:22,fontWeight:800,color:primaryColor}}>${result.forecast.total.toFixed(0)}</div>
            <div style={{fontSize:11,color:T.sub,marginTop:2}}>suggested labor: ${Math.round(result.forecast.total*0.3)}</div>
          </>
        ) : <div style={{fontSize:12,color:T.sub}}>Need {MIN_DOW_SAMPLES}+ weeks of history</div>;
      } else {
        body = (
          <>
            {result.sales && <div style={{fontSize:22,fontWeight:800,color:primaryColor}}>${result.sales.total.toFixed(0)}</div>}
            {result.labor && <div style={{fontSize:result.sales?13:22,fontWeight:result.sales?700:800,color:result.sales?secondaryColor:primaryColor,marginTop:result.sales?2:0}}>${result.labor.total.toFixed(0)}{result.sales?" labor":""}</div>}
            {result.sales && result.labor && result.sales.total>0 && (
              <div style={{fontSize:11,color:T.sub,marginTop:2}}>{((result.labor.total/result.sales.total)*100).toFixed(1)}% labor cost</div>
            )}
          </>
        );
      }
    } else if (config.display === "line" || config.display === "bar") {
      const chartOpts = { showAxis: config.show_axis !== false, showLegend: config.show_legend !== false, height: chartHeight };
      if (result.kind === "forecast") {
        body = result.forecast.hasEnoughData
          ? renderMiniChart([{label:"Forecast", color:primaryColor, values: result.forecast.days.map(d=>d.projectedRevenue)}], config.display, {...chartOpts, dates: result.forecast.days.map(d=>d.date)})
          : <div style={{fontSize:12,color:T.sub,padding:"20px 0",textAlign:"center"}}>Need {MIN_DOW_SAMPLES}+ weeks of history</div>;
      } else {
        const series = [];
        const dates = (result.sales?.days || result.labor?.days || []).map(d=>d.date);
        if (result.sales) series.push({label:"Sales", color:primaryColor, values: result.sales.days.map(d=>d.revenue)});
        if (result.labor) series.push({label:"Labor", color:result.sales?secondaryColor:primaryColor, values: result.labor.days.map(d=>d.labor)});
        body = series.length ? renderMiniChart(series, config.display, {...chartOpts, dates}) : null;
      }
    } else if (config.display === "table") {
      let rows;
      if (result.kind === "forecast") {
        rows = result.forecast.days.map(d => ({date:d.date, revenue:d.projectedRevenue, labor:null}));
      } else {
        const base = result.sales?.days || result.labor?.days || [];
        rows = base.map((d,i) => ({
          date: d.date,
          revenue: result.sales ? result.sales.days[i].revenue : null,
          labor: result.labor ? result.labor.days[i].labor : null,
        }));
      }
      body = (
        <div style={{maxHeight:gridH>=2?320:160,overflowY:"auto"}}>
          {rows.map(d=>(
            <div key={d.date} style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:11,padding:"3px 0",borderBottom:`1px solid ${T.border}`}}>
              <span style={{color:T.sub}}>{dl(d.date)}</span>
              <span style={{display:"flex",gap:8}}>
                {d.revenue!=null && <span style={{color:primaryColor,fontWeight:700}}>${d.revenue.toFixed(0)}</span>}
                {d.labor!=null && <span style={{color:secondaryColor,fontWeight:700}}>${d.labor.toFixed(0)}</span>}
              </span>
            </div>
          ))}
        </div>
      );
    }

    const sizeKey = Object.keys(WIDGET_SIZES).find(k => WIDGET_SIZES[k].w===(config.grid_w||1) && WIDGET_SIZES[k].h===(config.grid_h||1)) || "sm";
    const isDragging = dragWidgetId === config.id;
    const isDragOver = dragOverWidgetId === config.id;

    return (
      <div key={config.id}
        draggable
        onDragStart={()=>setDragWidgetId(config.id)}
        onDragOver={e=>{ e.preventDefault(); setDragOverWidgetId(config.id); }}
        onDragLeave={()=>setDragOverWidgetId(null)}
        onDrop={()=>handleWidgetDrop(config.id)}
        onDragEnd={()=>{ setDragWidgetId(null); setDragOverWidgetId(null); }}
        style={{background:T.muted,borderRadius:10,padding:"12px 14px",position:"relative",gridColumn:`span ${config.grid_w||1}`,gridRow:`span ${config.grid_h||1}`,opacity:isDragging?0.4:1,outline:isDragOver?`2px dashed ${T.accent}`:"none",transition:"opacity 0.15s, outline 0.1s",cursor:"default"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:8}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:6,flex:1,minWidth:0}}>
            <span title="Drag to reorder" style={{color:T.sub,fontSize:14,cursor:"grab",lineHeight:1.2,flexShrink:0,marginTop:1}}>⠿</span>
            <div style={{fontSize:10,color:T.sub,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em"}}>{title}</div>
          </div>
          <div style={{display:"flex",gap:6,flexShrink:0}}>
            <button onClick={()=>resizeWidget(config.id)} aria-label={`Resize widget (currently ${WIDGET_SIZES[sizeKey].label})`} title={`Size: ${WIDGET_SIZES[sizeKey].label} — tap to cycle`}
              style={{background:"none",border:"none",color:T.sub,cursor:"pointer",fontSize:13,lineHeight:1,padding:0}}>
              ⤢
            </button>
            <button onClick={()=>removeWidget(config.id)} aria-label="Remove widget"
              style={{background:"none",border:"none",color:T.sub,cursor:"pointer",fontSize:14,lineHeight:1,padding:0}}>
              ✕
            </button>
          </div>
        </div>
        {body}
      </div>
    );
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
    // Do NOT migrate schedule data — each week key is independent
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
  const eDayP = (wk,emp,di) => eDayH(wk,emp.id,di)*(parseFloat(emp.hourlyRate)||0);
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
    const todayStr = toLocalDateStr(now);
    const todayIdx = now.getDay();
    for (const wk of weeks) {
      // Verify this week actually contains today's date before checking shifts
      const wkDates = wk.dates.map(d => {
        const dt = typeof d === "string" ? new Date(d+"T00:00:00") : d;
        return toLocalDateStr(dt);
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
        <div onClick={e=>{e.stopPropagation(); if(draft._openPanel) setDraft(d=>({...d,_openPanel:null}));}} style={{background:"white",borderRadius:"20px 20px 0 0",padding:"20px 20px calc(20px + env(safe-area-inset-bottom,0px))",width:"100%",maxWidth:500,boxShadow:"0 -12px 48px rgba(0,0,0,0.2)",borderTop:`4px solid ${emp.color}`}}>
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
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14,position:"relative"}}>
            {[["Start Time","start"],["End Time","end"]].map(([lbl,field])=>{
              const HOURS_TP = [1,2,3,4,5,6,7,8,9,10,11,12];
              const MINS_TP  = [0,5,10,15,20,25,30,35,40,45,50,55];
              const val = draft[field];
              const getHrTP = v => { if(!v) return null; const [h]=v.split(":").map(Number); return h%12===0?12:h%12; };
              const getMinTP = v => { if(!v) return null; const [,m]=v.split(":").map(Number); return m; };
              const getApTP = (v, fb) => { if(!v) return fb; const [h]=v.split(":").map(Number); return h<12?"AM":"PM"; };
              const buildValTP = (hr,min,ap) => { let h=hr%12; if(ap==="PM") h+=12; return String(h).padStart(2,"0")+":"+String(min).padStart(2,"0"); };
              const fallbackAP = field==="start" ? "AM" : "PM";
              const hr = getHrTP(val), min = getMinTP(val), ap = getApTP(val, fallbackAP);
              const isOpen = draft._openPanel === field;
              const filled = !!val;

              function setHrTP(h) { setDraft(d=>({...d, [field]: buildValTP(h, getMinTP(d[field]) ?? 0, getApTP(d[field], fallbackAP))})); }
              function setMinTP(m) { setDraft(d=>({...d, [field]: buildValTP(getHrTP(d[field]) ?? 9, m, getApTP(d[field], fallbackAP))})); }
              function setApTP(a) { setDraft(d=>({...d, [field]: buildValTP(getHrTP(d[field]) ?? 9, getMinTP(d[field]) ?? 0, a)})); }
              function openPanel() { setDraft(d=>({...d, _openPanel: field})); }
              function closePanel() { setDraft(d=>({...d, _openPanel: null})); }

              function handleHrChange(e) {
                const v = e.target.value.replace(/\D/g,"").slice(0,2);
                if (v === "") return;
                let n = parseInt(v); if (n > 12) n = 12;
                setHrTP(n);
              }
              function handleMinChange(e) {
                const v = e.target.value.replace(/\D/g,"").slice(0,2);
                if (v === "") return;
                let n = parseInt(v); if (n > 59) n = 59;
                setMinTP(n);
              }
              function handleHrKeyDown(e) {
                if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                  e.preventDefault();
                  document.getElementById(`tp-min-${field}`)?.focus();
                }
              }
              function handleMinKeyDown(e) {
                if (e.key === "Enter") { e.preventDefault(); closePanel(); }
              }

              return (
                <div key={field} style={{position:"relative"}}>
                  <label style={{fontSize:11,fontWeight:700,color:T.sub,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em"}}>{lbl}</label>

                  <div style={{
                    display:"flex",alignItems:"center",
                    border:`2px solid ${isOpen||filled?emp.color:T.border}`,borderRadius:999,
                    background:T.surface,transition:"border-color 0.15s",padding:"4px 6px"
                  }}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"center",flex:1}}>
                      <input id={`tp-hr-${field}`} inputMode="numeric" placeholder="9" value={hr ?? ""}
                        onChange={handleHrChange} onFocus={openPanel} onKeyDown={handleHrKeyDown}
                        style={{width:22,border:"none",outline:"none",fontSize:17,fontWeight:800,color:T.text,background:"transparent",textAlign:"center",padding:"9px 0"}}/>
                      <span style={{fontSize:17,fontWeight:800,color:T.sub}}>:</span>
                      <input id={`tp-min-${field}`} inputMode="numeric" placeholder="00" value={min!=null?String(min).padStart(2,"0"):""}
                        onChange={handleMinChange} onFocus={openPanel} onKeyDown={handleMinKeyDown}
                        style={{width:30,border:"none",outline:"none",fontSize:17,fontWeight:800,color:T.text,background:"transparent",textAlign:"center",padding:"9px 0"}}/>
                    </div>
                    <button type="button" onClick={()=>setApTP(ap==="AM"?"PM":"AM")}
                      style={{
                        border:"none",borderRadius:999,
                        background:ap?emp.color:T.muted,color:ap?"white":T.sub,
                        fontSize:12,fontWeight:800,padding:"9px 14px",cursor:"pointer",letterSpacing:"0.03em"
                      }}>
                      {ap||fallbackAP}
                    </button>
                  </div>

                  {isOpen && (
                    <div onClick={e=>e.stopPropagation()} style={{
                      marginTop:8,background:T.surface,
                      border:`1.5px solid ${T.border}`,borderRadius:14,boxShadow:"0 6px 20px rgba(0,0,0,0.1)",
                      overflow:"hidden",zIndex:50
                    }}>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",height:160}}>
                        <div style={{overflowY:"auto",borderRight:`1px solid ${T.muted}`}}>
                          <div style={{position:"sticky",top:0,background:T.bg,padding:"6px 0",textAlign:"center",fontSize:9,fontWeight:800,color:T.sub,letterSpacing:"0.08em",borderBottom:`1px solid ${T.muted}`}}>HR</div>
                          {HOURS_TP.map(h=>(
                            <div key={h} onClick={()=>setHrTP(h)} style={{
                              padding:"9px 0",textAlign:"center",fontSize:14,fontWeight:700,cursor:"pointer",
                              background:hr===h?emp.color:"transparent",color:hr===h?"white":T.sub
                            }}>{h}</div>
                          ))}
                        </div>
                        <div style={{overflowY:"auto",borderRight:`1px solid ${T.muted}`}}>
                          <div style={{position:"sticky",top:0,background:T.bg,padding:"6px 0",textAlign:"center",fontSize:9,fontWeight:800,color:T.sub,letterSpacing:"0.08em",borderBottom:`1px solid ${T.muted}`}}>MIN</div>
                          {MINS_TP.map(m=>(
                            <div key={m} onClick={()=>setMinTP(m)} style={{
                              padding:"9px 0",textAlign:"center",fontSize:14,fontWeight:700,cursor:"pointer",
                              background:min===m?emp.color:"transparent",color:min===m?"white":T.sub
                            }}>{String(m).padStart(2,"0")}</div>
                          ))}
                        </div>
                        <div style={{overflowY:"auto"}}>
                          <div style={{position:"sticky",top:0,background:T.bg,padding:"6px 0",textAlign:"center",fontSize:9,fontWeight:800,color:T.sub,letterSpacing:"0.08em",borderBottom:`1px solid ${T.muted}`}}>AM/PM</div>
                          {["AM","PM"].map(a=>(
                            <div key={a} onClick={()=>setApTP(a)} style={{
                              padding:"9px 0",textAlign:"center",fontSize:14,fontWeight:700,cursor:"pointer",
                              background:ap===a?emp.color:"transparent",color:ap===a?"white":T.sub
                            }}>{a}</div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
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
    {key:"dashboard",   icon:"💵", label:"Dashboard"},
    {key:"recognition", icon:"⭐", label:"Team"},
    {key:"settings",    icon:"⚙️", label:"Settings"},
    {key:"feedback",    icon:"💬", label:"Feedback"},
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
            <div style={{fontSize:26,fontWeight:900,color:"white",letterSpacing:"-0.01em",display:"inline-flex",alignItems:"center",gap:0}}>
              ShiftWise
              <span style={{color:"#6B7280",margin:"0 7px",fontWeight:300}}>|</span>
              Veredian
              <span style={{fontSize:11,fontWeight:400,color:"#93c5fd",position:"relative",bottom:"9px",marginLeft:3,letterSpacing:"0.06em"}}>Beta</span>
            </div>
            <div style={{fontSize:13,color:"#4B5563",marginTop:4}}>Schedule smarter. Run better.</div>
          </div>

          {/* Card */}
          <div style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:18,padding:"28px 28px 24px"}}>

            {authMode==="forgot" ? (
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                <div style={{marginBottom:4}}>
                  <div style={{fontSize:16,fontWeight:800,color:"white",marginBottom:4}}>Reset your password</div>
                  <div style={{fontSize:12,color:"#9CA3AF",lineHeight:1.5}}>Enter the email on your account and we'll send you a link to set a new password.</div>
                </div>
                {resetSent ? (
                  <div style={{background:"rgba(45,106,79,0.15)",border:"1px solid rgba(45,106,79,0.4)",borderRadius:10,padding:"14px",fontSize:13,color:"#6FCF97",lineHeight:1.6}}>
                    ✓ If an account exists for <strong>{authEmail}</strong>, a reset link is on its way. Check your inbox (and spam folder).
                  </div>
                ) : (
                  <>
                    <input value={authEmail} onChange={e=>setAuthEmail(e.target.value)}
                      placeholder="Email address" type="email"
                      onKeyDown={e=>e.key==="Enter"&&handleForgotPassword()}
                      style={{width:"100%",background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.12)",borderRadius:10,padding:"13px 14px",fontSize:15,color:"white",outline:"none",boxSizing:"border-box"}}/>
                    {authError && (
                      <div style={{background:"rgba(239,68,68,0.15)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#F87171",lineHeight:1.5}}>
                        {authError}
                      </div>
                    )}
                    <button onClick={handleForgotPassword}
                      style={{width:"100%",background:"#2D6A4F",color:"white",border:"none",borderRadius:10,padding:"14px 0",fontWeight:800,fontSize:15,cursor:"pointer",marginTop:4}}>
                      Send Reset Link
                    </button>
                  </>
                )}
                <button onClick={()=>{setAuthMode("signin");setAuthError("");setResetSent(false);}}
                  style={{background:"none",border:"none",color:"#9CA3AF",fontSize:13,fontWeight:600,cursor:"pointer",marginTop:4,textAlign:"center"}}>
                  ← Back to Sign In
                </button>
              </div>
            ) : (
              <>
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

                  {authMode==="signin" && (
                    <button onClick={()=>{setAuthMode("forgot");setAuthError("");setResetSent(false);}}
                      style={{background:"none",border:"none",color:"#9CA3AF",fontSize:12,fontWeight:600,cursor:"pointer",textAlign:"right",padding:0,marginTop:-4}}>
                      Forgot password?
                    </button>
                  )}

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
              </>
            )}
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

  // ── SETUP GATE ── show setup flow to new users before the main app
  if (!setupComplete && bizId) {
    let resumeStep;
    try { resumeStep = parseInt(localStorage.getItem("sw_setup_step"), 10); } catch {}
    return (
      <SetupFlow
        bizId={bizId}
        initialStep={Number.isInteger(resumeStep) ? resumeStep : undefined}
        squareConnected={squareConnected}
        onConnectSquare={handleConnectSquare}
        onComplete={async () => {
          try { localStorage.removeItem("sw_setup_step"); } catch {}
          await loadAllData();
          setSetupComplete(true);
        }}
      />
    );
  }

  return (
    <div style={{minHeight:"100vh",width:"100%",background:T.bg,color:T.text}}>
      <style>{CSS}</style>

        {/* TOP BAR */}
        <div style={{background:T.dark,position:"sticky",top:0,zIndex:400,borderBottom:"1px solid #2A2A2A"}}>
          <div className="top-bar-inner" style={{width:"100%",display:"flex",alignItems:"center",gap:14,height:54,padding:"0 24px"}}>
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
              <label style={{background:"rgba(255,255,255,0.08)",color:"#bbb",border:"1px solid rgba(255,255,255,0.12)",borderRadius:7,padding:"5px 11px",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                Import<input type="file" accept=".json" onChange={e=>{importData(e.target.files[0]);e.target.value="";}} style={{display:"none"}}/>
              </label>
              <button onClick={exportData} style={{background:"rgba(255,255,255,0.08)",color:"#bbb",border:"1px solid rgba(255,255,255,0.12)",borderRadius:7,padding:"5px 11px",fontSize:11,fontWeight:700,cursor:"pointer"}}>Export</button>
              <button onClick={handleSignOut} style={{background:"rgba(255,255,255,0.05)",color:"#666",border:"1px solid rgba(255,255,255,0.08)",borderRadius:7,padding:"5px 11px",fontSize:11,fontWeight:700,cursor:"pointer"}} title="Sign Out">⎋</button>
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
        <div className="page-pad" style={{width:"100%",padding:"18px 24px 28px"}}>

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
  // Per-row punch delete component — inline so it has access to closure vars
  function PunchRowInline({ p, i, total, typeLabel, typeColor, emp, dateStr, bizId, setPunches, setPunchReviews, addAudit, showToast, T, ADJUSTMENT_REASONS }) {
    const [delOpen, setDelOpen] = useState(false);
    const [delReason, setDelReason] = useState("duplicate_punch");
    const [delNote, setDelNote] = useState("");
    const [deleting, setDeleting] = useState(false);

    async function confirmDelete() {
      if (delReason==="other" && !delNote.trim()) { showToast("Enter a reason"); return; }
      setDeleting(true);
      try {
        const reasonText = delReason==="other" ? delNote.trim() : (ADJUSTMENT_REASONS.find(r=>r.value===delReason)?.label || "Manager Correction");
        setPunches(prev => prev.filter(px => px.id !== p.id));
        setPunchReviews(prev => { const n={...prev}; delete n[p.id]; return n; });
        if (bizId) {
          await fetch(`https://kyrjgfeowmflazywsuir.supabase.co/rest/v1/punches?id=eq.${p.id}`, {
            method:"DELETE",
            headers:{ apikey:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5cmpnZmVvd21mbGF6eXdzdWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NzMzMTQsImV4cCI6MjA5NTA0OTMxNH0.njuDREVF4oIgTYN6wLXKw6Hw_KsFzKPoMabkld_jy0E", Authorization:`Bearer ${(()=>{try{const s=JSON.parse(localStorage.getItem("sw_session")||"null");return s?.access_token||"";}catch{return "";}})()}` }
          });
        }
        addAudit("Punch Deleted", `${emp.name} — ${dateStr}: ${typeLabel} at ${new Date(p.time).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})} removed (${reasonText})`, {empName:emp.name});
        showToast("Punch deleted ✓");
      } catch(e) { showToast("Could not delete: "+e.message); }
      finally { setDeleting(false); }
    }

    return (
      <div style={{borderBottom:i<total-1?`1px solid ${T.border}`:"none",paddingBottom:delOpen?8:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0"}}>
          <span style={{fontSize:12,fontWeight:700,color:typeColor}}>{typeLabel}</span>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:12,color:T.sub,fontFamily:"monospace"}}>{new Date(p.time).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}</span>
            <button onClick={()=>setDelOpen(o=>!o)} title="Delete this punch"
              style={{background:delOpen?"#FDECEA":"transparent",border:`1px solid ${delOpen?"#C0392B44":T.border}`,borderRadius:6,width:24,height:24,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:delOpen?"#C0392B":T.sub}}>
              🗑
            </button>
          </div>
        </div>
        {p.adjustmentReason && !delOpen && (
          <div style={{fontSize:10,color:"#B7780F",marginBottom:4,fontStyle:"italic"}}>↳ {p.adjustmentReason}</div>
        )}
        {delOpen && (
          <div style={{background:"#FDECEA",borderRadius:8,padding:"10px",marginBottom:4,border:"1px solid #C0392B22"}}>
            <div style={{fontSize:10,fontWeight:700,color:"#C0392B",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em"}}>Delete reason</div>
            <select value={delReason} onChange={e=>setDelReason(e.target.value)}
              style={{width:"100%",border:"1.5px solid #C0392B33",borderRadius:6,padding:"6px 8px",fontSize:12,fontWeight:700,background:"white",color:"#C0392B",marginBottom:6,outline:"none"}}>
              {ADJUSTMENT_REASONS.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            {delReason==="other" && (
              <input value={delNote} onChange={e=>setDelNote(e.target.value)} placeholder="Briefly describe why"
                style={{width:"100%",border:"1.5px solid #C0392B33",borderRadius:6,padding:"6px 8px",fontSize:12,background:"white",color:"#333",marginBottom:6,outline:"none",boxSizing:"border-box"}}/>
            )}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              <button onClick={()=>{setDelOpen(false);setDelNote("");}}
                style={{background:"white",border:`1px solid ${T.border}`,borderRadius:6,padding:"6px 0",fontSize:12,fontWeight:700,cursor:"pointer",color:T.sub}}>Cancel</button>
              <button onClick={confirmDelete} disabled={deleting}
                style={{background:"#C0392B",border:"none",borderRadius:6,padding:"6px 0",fontSize:12,fontWeight:700,cursor:"pointer",color:"white",opacity:deleting?0.6:1}}>
                {deleting?"Deleting…":"Confirm Delete"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
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
  const ADJUSTMENT_REASONS = [
    { value:"missed_punch",     label:"Missed Punch" },
    { value:"clock_offline",    label:"Clock Offline" },
    { value:"manager_correction", label:"Manager Correction" },
    { value:"duplicate_punch",  label:"Duplicate Punch" },
    { value:"other",            label:"Other" },
  ];

  function TimesheetCellPopup({ bizId }) {
    const [editIn,  setEditIn]  = useState("");
    const [editOut, setEditOut] = useState("");
    const [saving,  setSaving]  = useState(false);
    const [reasonCode, setReasonCode] = useState("missed_punch");
    const [reasonNote, setReasonNote] = useState("");

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

    async function setStatus(val) {
      if (!punchId) return;
      dp.forEach(p => {
        setPunchReviews(prev=>({...prev,[p.id]:val}));
        if (bizId) {
          fetch(`${SUPABASE_URL}/rest/v1/punch_reviews?on_conflict=punch_id`, {
            method: "POST",
            headers: { ...SB_HEADERS, Authorization: `Bearer ${getToken()}`, Prefer: "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify({ business_id: bizId, punch_id: p.id, status: val, reviewed_by: getSession()?.user?.id || null })
          }).catch(e=>console.warn("punch_reviews upsert failed:", e));
        }
      });
      setTsOpenCell(null);
      showToast(`Marked as ${val} ✓`);
    }

    async function saveManualTime() {
      if (!editIn) { showToast("Enter at least a clock-in time"); return; }
      if (reasonCode==="other" && !reasonNote.trim()) { showToast("Enter a reason for this adjustment"); return; }
      setSaving(true);
      try {
        const reasonLabel = ADJUSTMENT_REASONS.find(r=>r.value===reasonCode)?.label || "Manual adjustment";
        const reasonText  = reasonCode==="other" ? reasonNote.trim() : reasonLabel;

        const makeISO = (dateStr, timeStr) => {
          const [h,m] = timeStr.split(":").map(Number);
          const d = new Date(dateStr+"T00:00:00");
          d.setHours(h,m,0,0);
          return d.toISOString();
        };
        const inTime  = makeISO(dateStr, editIn);
        const outTime = editOut ? makeISO(dateStr, editOut) : null;

        const inPunch = { id:Date.now().toString(), empId, empName:emp.name, type:"in", time:inTime, scheduled:shift||null, flags:["ADJUSTMENT"], adjustmentReason:reasonText };
        setPunches(p=>[...p, inPunch]);
        if (bizId) {
          await dbPost("punches", { business_id:bizId, employee_id:empId, employee_name:emp.name, punch_type:"in", punched_at:inTime, scheduled_start:shift?.start||null, scheduled_end:shift?.end||null, flags:["ADJUSTMENT"], adjustment_reason:reasonText });
        }

        if (outTime) {
          const outPunch = { id:(Date.now()+1).toString(), empId, empName:emp.name, type:"out", time:outTime, scheduled:shift||null, flags:["ADJUSTMENT"], adjustmentReason:reasonText };
          setPunches(p=>[...p, outPunch]);
          if (bizId) {
            await dbPost("punches", { business_id:bizId, employee_id:empId, employee_name:emp.name, punch_type:"out", punched_at:outTime, scheduled_start:shift?.start||null, scheduled_end:shift?.end||null, flags:["ADJUSTMENT"], adjustment_reason:reasonText });
          }
        }

        addAudit("Manual Time Entry", `${emp.name} — ${dateStr}: ${editIn}${editOut?" – "+editOut:""} (${reasonText})`, {empName:emp.name});
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

            {/* Punch log — with per-row delete */}
            {dp.length>0&&(
              <div style={{background:T.muted,borderRadius:10,padding:"10px 12px"}}>
                <div style={{fontSize:10,fontWeight:700,color:T.sub,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Punch log</div>
                {dp.map((p,i)=>{
                  const typeLabel = p.type==="in"?"Clock in":p.type==="out"?"Clock out":p.type==="break_out"?"Break start":"Break end";
                  const typeColor = p.type==="in"||p.type==="break_in" ? "#2D6A4F" : "#C0392B";
                  return (
                    <PunchRowInline key={p.id||i} p={p} i={i} total={dp.length}
                      typeLabel={typeLabel} typeColor={typeColor}
                      emp={emp} dateStr={dateStr} bizId={bizId}
                      setPunches={setPunches} setPunchReviews={setPunchReviews}
                      addAudit={addAudit} showToast={showToast} T={T}
                      ADJUSTMENT_REASONS={ADJUSTMENT_REASONS} />
                  );
                })}
              </div>
            )}

            {/* Manual time entry */}
            <div style={{border:`1.5px solid ${T.border}`,borderRadius:10,padding:"12px 14px"}}>
              <div style={{fontSize:10,fontWeight:700,color:T.sub,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>
                {dp.length>0?"Adjust time":"Add missing time"}
              </div>

              <div style={{marginBottom:10}}>
                <label style={{fontSize:10,color:T.sub,display:"block",marginBottom:4,fontWeight:600}}>Reason</label>
                <select value={reasonCode} onChange={e=>setReasonCode(e.target.value)}
                  style={{width:"100%",border:`1.5px solid ${T.border}`,borderRadius:8,padding:"8px 10px",fontSize:13,fontWeight:700,outline:"none",background:T.surface,color:T.text,cursor:"pointer"}}>
                  {ADJUSTMENT_REASONS.map(r=>(
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                {reasonCode==="other" && (
                  <input value={reasonNote} onChange={e=>setReasonNote(e.target.value)}
                    placeholder="Briefly describe what happened"
                    style={{width:"100%",border:`1.5px solid ${T.border}`,borderRadius:8,padding:"8px 10px",fontSize:13,outline:"none",background:T.surface,color:T.text,marginTop:8,boxSizing:"border-box"}}/>
                )}
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
          {/* Approved summary pill */}
          {totalApprovedHrs>0&&(
            <div style={{background:T.surface,borderRadius:T.radius,padding:"8px 14px",fontSize:12,border:`1px solid ${T.border}`,display:"flex",gap:12,alignItems:"center"}}>
              <span><span style={{color:"#4CAF7D",fontWeight:700}}>{totalApprovedHrs.toFixed(1)}h</span> <span style={{color:T.sub}}>approved</span></span>
              <span><span style={{color:T.accent,fontWeight:700}}>${totalApprovedPay.toFixed(0)}</span> <span style={{color:T.sub}}>est.</span></span>
            </div>
          )}
          {/* Approve All — bulk approves clean punches (both clock-in and clock-out, no flags) */}
          <button onClick={async ()=>{
            const updates = {};
            employees.forEach(emp => {
              tsWkDates.forEach(dateStr => {
                const dp = getDayPunches(emp.id, dateStr);
                const hasIn  = dp.some(p=>p.type==="in");
                const hasOut = dp.some(p=>p.type==="out");
                const hasFlags = dp.some(p=>p.flags?.filter(f=>f!=="ADJUSTMENT").length>0);
                const punchId = dp[0]?.id;
                // Only approve if: has both in+out, no flags, not already actioned
                if (hasIn && hasOut && !hasFlags && punchId && !punchReviews[punchId]) {
                  dp.forEach(p=>{ updates[p.id] = "approved"; });
                }
              });
            });
            if (Object.keys(updates).length === 0) { showToast("No clean punches to approve — review flagged entries individually"); return; }
            setPunchReviews(prev=>({...prev,...updates}));
            if (bizId) {
              try {
                await Promise.all(Object.entries(updates).map(([pid, status]) =>
                  fetch(`${SUPABASE_URL}/rest/v1/punch_reviews?on_conflict=punch_id`, {
                    method:"POST",
                    headers:{...SB_HEADERS, Authorization:`Bearer ${getToken()}`, Prefer:"resolution=merge-duplicates,return=minimal"},
                    body:JSON.stringify({business_id:bizId, punch_id:pid, status, reviewed_by:getSession()?.user?.id||null})
                  })
                ));
              } catch(e) { console.warn("Approve all failed:", e); }
            }
            addAudit("Bulk Approved", `${Object.keys(updates).length} clean punches approved for week of ${tsWkLabel}`);
            showToast(`${Object.keys(updates).length} punches approved ✓`);
          }} style={{background:"#EAF4EF",color:"#2D6A4F",border:"1px solid #2D6A4F30",borderRadius:9,padding:"8px 14px",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
            ✓ Approve All Clean
          </button>
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

      {/* Week picker — matches Schedule tab's Prev / range / calendar / Next pattern */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        <button onClick={()=>setTsWeekStart(getSunday(addDays(tsWeekStart,-7)))}
          style={{background:T.muted,border:`1px solid ${T.border}`,borderRadius:8,width:34,height:36,fontSize:16,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,flexShrink:0}}>‹</button>
        <div style={{display:"flex",alignItems:"center",borderRadius:9,overflow:"hidden",border:`2px solid ${T.accent}`,boxShadow:`0 0 0 2px ${T.accent}28`}}>
          <div style={{background:T.accent,color:"white",padding:"8px 16px",fontWeight:700,fontSize:12,whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:10}}>●</span>
            {tsWkLabel}
          </div>
          <div style={{position:"relative",flexShrink:0,borderLeft:`1px solid ${T.accent}40`}}>
            <input type="date" value={tsWeekStart} onChange={e=>setTsWeekStart(getSunday(e.target.value))}
              style={{opacity:0,position:"absolute",inset:0,cursor:"pointer",width:"100%",height:"100%"}}/>
            <div style={{background:T.accent+"18",padding:"8px 10px",fontSize:13,cursor:"pointer",userSelect:"none",color:T.accent}}>📅</div>
          </div>
        </div>
        <button onClick={()=>setTsWeekStart(getSunday(addDays(tsWeekStart,7)))}
          style={{background:T.muted,border:`1px solid ${T.border}`,borderRadius:8,width:34,height:36,fontSize:16,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,flexShrink:0}}>›</button>
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
                            border:`1.5px solid ${hasFlag?"#E8A93A":status==="approved"?"#4CAF7D40":status==="rejected"?"#C0392B40":(!hasPunch&&shift&&dateStr<toLocalDateStr(new Date()))?"#E8A93A50":hasPunch?T.border:"transparent"}`,
                            background:hasFlag?"#FEF3E215":status==="approved"?"#F0FFF420":status==="rejected"?"#FDECEA15":(!hasPunch&&shift&&dateStr<toLocalDateStr(new Date()))?"#FEF3E210":hasPunch?T.surface:"transparent",
                            cursor:(hasPunch||shift)?"pointer":"default",
                            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                            transition:"all 0.12s",
                          }}>
                          {!hasPunch&&!shift ? (
                            <span style={{color:T.border,fontSize:11}}>—</span>
                          ) : !hasPunch&&shift ? (
                            <div style={{opacity:0.6,display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                              {dateStr < toLocalDateStr(new Date()) ? (
                                <>
                                  <span style={{fontSize:12}}>⚠️</span>
                                  <div style={{fontSize:8,fontWeight:800,color:"#E8A93A"}}>CORRECTION</div>
                                  <div style={{fontSize:7,color:"#E8A93A",fontWeight:700}}>NEEDED</div>
                                </>
                              ) : (
                                <>
                                  <div style={{fontSize:9,color:T.sub,fontWeight:700}}>No punch</div>
                                  <div style={{fontSize:8,color:T.sub}}>{fmt(shift.start)}</div>
                                  <div style={{fontSize:8,color:T.sub}}>{fmt(shift.end)}</div>
                                </>
                              )}
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

      <TimesheetCellPopup bizId={bizId}/>
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
                    <SectionLabel T={T}>Schedule Week</SectionLabel>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <button onClick={()=>{ const prev=getSunday(addDays(activeWeek||wk1Start,-7)); setWk1Start(prev); setActiveWeek(prev); setPrintWeek(prev); }}
                        style={{background:T.muted,border:`1px solid ${T.border}`,borderRadius:8,width:34,height:36,fontSize:16,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,flexShrink:0}}>‹</button>
                      <div style={{display:"flex",alignItems:"center",borderRadius:9,overflow:"hidden",border:`2px solid ${T.accent}`,boxShadow:`0 0 0 2px ${T.accent}28`}}>
                        <div style={{background:T.accent,color:"white",padding:"8px 16px",fontWeight:700,fontSize:12,whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:10}}>●</span>
                          {activeWeek ? `${dl(weekDatesFromSunday(activeWeek)[0])} – ${dl(weekDatesFromSunday(activeWeek)[6])}` : "Select a week"}
                        </div>
                        <div style={{position:"relative",flexShrink:0,borderLeft:`1px solid ${T.accent}40`}}>
                          <input type="date" value={activeWeek?toInputDate(weekDatesFromSunday(activeWeek)[0]):""} onChange={e=>{ const s=getSunday(e.target.value); setWk1Start(s); setActiveWeek(s); setPrintWeek(s); }}
                            style={{opacity:0,position:"absolute",inset:0,cursor:"pointer",width:"100%",height:"100%"}}/>
                          <div style={{background:T.accent+"18",padding:"8px 10px",fontSize:13,cursor:"pointer",userSelect:"none",color:T.accent}}>📅</div>
                        </div>
                      </div>
                      <button onClick={()=>{ const next=getSunday(addDays(activeWeek||wk1Start,7)); setWk1Start(next); setActiveWeek(next); setPrintWeek(next); }}
                        style={{background:T.muted,border:`1px solid ${T.border}`,borderRadius:8,width:34,height:36,fontSize:16,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,flexShrink:0}}>›</button>
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
                  <table className="sched-table" style={{borderCollapse:"collapse",width:"100%",background:T.surface,minWidth:760,tableLayout:"fixed"}}>
                    <colgroup>
                      <col style={{width:200}}/>{DAYS.map(d=><col key={d}/>)}<col style={{width:90}}/>
                    </colgroup>
                    <thead>
                      <tr style={{background:T.dark}}>
                        <th style={{padding:"13px 16px",textAlign:"left",color:"#777",fontSize:11,fontWeight:700,letterSpacing:"0.08em"}}>EMPLOYEE</th>
                        {DAYS.map((d,i)=>{
                          const dh=employees.reduce((s,e)=>s+eDayH(activeWeek,e.id,i),0);
                          return (
                            <th key={d} style={{padding:"12px 6px",textAlign:"center",color:"white",fontSize:13,fontWeight:700}}>
                              <div>{d}</div>
                              <div style={{fontSize:10,color:"#777",fontWeight:400,marginTop:2}}>{activeWkObj?dl(activeWkObj.dates[i]):""}</div>
                              {dh>0&&<div style={{fontSize:10,color:T.accent,fontWeight:700,marginTop:2}}>{dh}h</div>}
                            </th>
                          );
                        })}
                        <th style={{padding:"12px 8px",textAlign:"center",color:T.accent,fontSize:11,fontWeight:700,letterSpacing:"0.06em"}}>HRS</th>
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
                            <td className="emp-name-cell" style={{padding:"12px 16px",verticalAlign:"middle",minWidth:180,maxWidth:220}}>
                              <div style={{display:"flex",alignItems:"center",gap:10}}>
                                <div style={{width:34,height:34,borderRadius:"50%",background:emp.color,display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:800,fontSize:13,flexShrink:0}}>{emp.name?emp.name[0].toUpperCase():"?"}</div>
                                <div style={{minWidth:0}}>
                                  <div style={{fontWeight:700,fontSize:13,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",color:T.text}}>{emp.name||"New"}</div>
                                  {emp.role&&<div style={{fontSize:11,color:T.sub,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginTop:1}}>{emp.role}</div>}
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
                                <td key={di} style={{padding:"6px 6px",textAlign:"center",verticalAlign:"middle",position:"relative",
                                  background:!isDayAvail?`repeating-linear-gradient(45deg,${T.muted},${T.muted} 3px,${T.bg} 3px,${T.bg} 8px)`:"transparent"}}>
                                  {!isDayAvail ? (
                                    <div style={{minHeight:64,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,opacity:0.6}}>
                                      <span style={{fontSize:14}}>🚫</span>
                                      <span style={{fontSize:9,color:T.sub,fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase"}}>Unavail.</span>
                                    </div>
                                  ) : shift ? (
                                    <div style={{position:"relative"}}
                                      draggable
                                      onDragStart={e=>{ e.dataTransfer.effectAllowed="move"; setDraggedShift({empId:emp.id,weekKey:activeWeek,dayIdx:di,shift}); }}
                                      onDragEnd={()=>{ setDraggedShift(null); setDragOverCell(null); }}>
                                      <div className="shift-badge" onClick={()=>setOpenCell({empId:emp.id,weekKey:activeWeek,dayIdx:di})}
                                        style={{background:emp.color,color:"white",borderRadius:10,padding:"8px 6px",cursor:"grab",fontSize:11,lineHeight:1.4,transition:"opacity 0.12s",opacity:draggedShift?.empId===emp.id&&draggedShift?.dayIdx===di?0.4:1,minHeight:64,display:"flex",flexDirection:"column",justifyContent:"center"}}>
                                        <div style={{background:"rgba(255,255,255,0.22)",borderRadius:4,padding:"2px 6px",fontSize:9,fontWeight:800,marginBottom:4,letterSpacing:"0.05em",color:"white"}}>
                                          {types.length>1?`${st.label} +${types.length-1}`:st.label.toUpperCase()}
                                        </div>
                                        <div style={{fontWeight:800,fontSize:12}}>{fmt(shift.start)}</div>
                                        <div style={{opacity:0.85,fontSize:11}}>–{fmt(shift.end)}</div>
                                        <div style={{fontWeight:800,fontSize:13,marginTop:3}}>{h}h</div>
                                        {shift.notes&&<div style={{fontSize:10,opacity:0.8,marginTop:2}}>📝</div>}
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
                                      style={{width:"100%",minHeight:64}}>
                                      <button className="add-shift-btn" onClick={()=>toggleShift(activeWeek,emp.id,di)}
                                        style={{width:"100%",minHeight:64,background:dragOverCell?.empId===emp.id&&dragOverCell?.dayIdx===di?T.accent+"18":"transparent",border:`1.5px dashed ${dragOverCell?.empId===emp.id&&dragOverCell?.dayIdx===di?T.accent:T.border}`,borderRadius:10,color:dragOverCell?.empId===emp.id&&dragOverCell?.dayIdx===di?T.accent:"#C8C3BC",fontSize:22,cursor:"pointer",transition:"all 0.15s"}}>
                                        {dragOverCell?.empId===emp.id&&dragOverCell?.dayIdx===di?"↓":"+"}
                                      </button>
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                            <td style={{padding:"12px 8px",textAlign:"center",verticalAlign:"middle"}}>
                              <div style={{fontWeight:800,fontSize:15,color:overAvail||wH>40?"#C0392B":T.text}}>{wH}h</div>
                              {avail>0&&<div style={{fontSize:10,color:overAvail?"#C0392B":wH>=avail*0.85?"#E8A93A":T.sub,fontWeight:600,marginTop:1}}>/{avail}h</div>}
                              <div style={{fontSize:11,color:T.accent,fontWeight:700,marginTop:2}}>${wP.toFixed(0)}</div>
                              {overAvail&&<div style={{fontSize:9,color:"#C0392B",fontWeight:800,marginTop:2}}>OVER</div>}
                              {!overAvail&&wH>40&&<div style={{fontSize:9,color:"#C0392B",fontWeight:700,marginTop:2}}>OT</div>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{background:T.dark}}>
                        <td style={{padding:"13px 16px",color:"#777",fontWeight:700,fontSize:11,letterSpacing:"0.06em"}}>TOTALS</td>
                        {DAYS.map((_,i)=>{
                          const dh=employees.reduce((s,e)=>s+eDayH(activeWeek,e.id,i),0);
                          const dp=employees.reduce((s,e)=>s+eDayP(activeWeek,e,i),0);
                          return (
                            <td key={i} style={{padding:"12px 6px",textAlign:"center",fontWeight:700}}>
                              {dh>0?<>
                                <div style={{color:T.accent,fontSize:13}}>{dh}h</div>
                                <div style={{color:"#4CAF7D",fontSize:11,fontWeight:700,marginTop:1}}>${dp.toFixed(0)}</div>
                              </>:<span style={{color:"#3A3A3A"}}>—</span>}
                            </td>
                          );
                        })}
                        <td style={{padding:"12px 8px",textAlign:"center"}}>
                          <div style={{color:T.accent,fontWeight:800,fontSize:14}}>{employees.reduce((s,e)=>s+eWkH(activeWeek,e.id),0)}h</div>
                          <div style={{color:T.accent,fontWeight:700,fontSize:12,marginTop:1}}>${activeWkPay.toFixed(0)}</div>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>}
                {activeWeek && (() => {
                  const totalShiftsThisWeek = employees.reduce((s, e) => s + DAYS.reduce((ds, _, di) => ds + (getShift(activeWeek, e.id, di) ? 1 : 0), 0), 0);
                  return totalShiftsThisWeek === 0 && employees.length > 0 ? (
                    <div style={{marginTop:14, background:T.surface, borderRadius:T.radius, border:`2px dashed ${T.border}`, padding:"36px 24px", textAlign:"center", position:"relative"}}>
                      <div style={{width:44, height:44, borderRadius:"50%", background:T.accent+"18", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px", fontSize:22}}>📅</div>
                      <div style={{fontWeight:800, fontSize:15, color:T.text, marginBottom:6}}>Your team is ready — now add their shifts</div>
                      <div style={{fontSize:13, color:T.sub, lineHeight:1.6, marginBottom:16, maxWidth:340, margin:"0 auto 16px"}}>Tap any <strong style={{color:T.text}}>+</strong> cell on the grid above to schedule a shift. ShiftWise tracks labor cost as you go.</div>
                      <div style={{display:"inline-flex", alignItems:"center", gap:8, background:T.accent, color:"white", borderRadius:10, padding:"10px 22px", fontSize:13, fontWeight:700}}>Tap any cell above to start</div>
                    </div>
                  ) : null;
                })()}
                {activeWeek && <div style={{marginTop:8,fontSize:11,color:T.sub,textAlign:"center"}}>Tap <strong>+</strong> to add a shift · Tap a shift to edit · Tap <strong>×</strong> to remove · <strong>Drag</strong> a shift to move it</div>}
              </>}
            </>}
            </div>
          )}

          {/* COVERAGE */}
          {tab==="coverage" && (()=>{
            const today = new Date();
            const todayIdx = today.getDay();
            const todayStr = toLocalDateStr(today);
            const nowDec = today.getHours() + today.getMinutes()/60;

            // ── Helpers ──────────────────────────────────────────────────────
            // Find which week key contains a given date
            function weekKeyForDate(dateStr) {
              for (const wk of weeks) {
                const dates = wk.dates.map(d => { const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return toLocalDateStr(dt); });
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

              // Find punch activity for this employee today — sorted by time
              const empPunches = punches.filter(p => {
                const pd = new Date(p.time);
                return p.empId === emp.id && pd.toDateString() === today.toDateString();
              }).sort((a,b) => new Date(a.time) - new Date(b.time));
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
              <div style={{maxWidth:900, margin:"0 auto", display:"flex", flexDirection:"column", gap:16}}>

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
                        const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return toLocalDateStr(dt);
                      });
                      const empPunches = punches.filter(p => {
                        const pd = toLocalDateStr(new Date(p.time));
                        return p.empId === emp.id && wkDates.includes(pd);
                      }).sort((a,b) => new Date(a.time) - new Date(b.time));
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

          {/* DASHBOARD */}
          {tab==="dashboard" && (
            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              {(()=>{
                const paySun=getSunday(new Date().toISOString().split("T")[0]);
                const pwDates=weekDatesFromSunday(payWeek);
                const pwLabel=dl(pwDates[0])+" – "+dl(pwDates[6]);
                const pwHrs=employees.reduce((s,e)=>s+DAYS.reduce((d,_,i)=>d+eDayH(payWeek,e.id,i),0),0);
                const pwStaff=employees.filter(e=>DAYS.some((_,i)=>eDayH(payWeek,e.id,i)>0)).length;
                const bgt=parseFloat(weeklyBudget)||0;

                const salesThisWeek = getSales("thisWeek", salesData, payWeek);
                const laborThisWeek = getLabor("thisWeek", salesData, employees, eDayH, payWeek);
                const wkSales = salesThisWeek.days.filter(d=>d.hasData);
                const totalRevenue = salesThisWeek.total;
                const payWeekLabor = laborThisWeek.total;
                const laborCostPct = totalRevenue > 0 ? (payWeekLabor / totalRevenue) * 100 : 0;

                // Suggested daily labor: average of historical day-of-week revenue × 30%
                // Then multiply by 7 days to get a full-week budget suggestion.
                // Uses forecast engine so it's based on history, not just this week's partial data.
                const forecastThisWeek = getForecast("thisWeek", salesData, payWeek);
                const suggestedDailyRevenue = forecastThisWeek.hasEnoughData
                  ? forecastThisWeek.total / 7
                  : totalRevenue > 0 ? totalRevenue / Math.max(1, wkSales.length) : 0;
                const suggestedDailyLabor = Math.round(suggestedDailyRevenue * 0.3);
                const suggestedWeeklyBudget = suggestedDailyLabor * 7;

                const forecastNext7 = getForecast("next7", salesData);
                const dayData = salesThisWeek.days.map((d, i) => {
                  const labor = laborThisWeek.days[i].labor;
                  return { day:DAYS[i], date:d.date, revenue:d.revenue, labor, pct:d.revenue>0?(labor/d.revenue)*100:null };
                });
                const hasSalesData = wkSales.length > 0 || salesData.length > 0;

                const over=bgt>0&&payWeekLabor>bgt;
                const warn=!over&&bgt>0&&payWeekLabor/bgt>0.85;
                const bc=over?"#C0392B":warn?"#E8A93A":"#4CAF7D";
                const pct=bgt>0?Math.min((payWeekLabor/bgt)*100,100):0;

                return (
                  <div style={{background:T.surface,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden"}}>
                    <div style={{padding:"12px 18px",background:T.dark,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                        <button onClick={()=>setPayWeek(getSunday(addDays(payWeek,-7)))} style={{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:8,width:32,height:32,fontSize:16,cursor:"pointer",color:"white",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>‹</button>
                        <div style={{background:T.accent,color:"white",padding:"6px 14px",fontWeight:700,fontSize:12,borderRadius:8,whiteSpace:"nowrap"}}>{pwLabel}</div>
                        <button onClick={()=>setPayWeek(getSunday(addDays(payWeek,7)))} style={{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:8,width:32,height:32,fontSize:16,cursor:"pointer",color:"white",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>›</button>
                        {payWeek===paySun
                          ? <span style={{fontSize:11,color:T.accent,fontWeight:700}}>Current week</span>
                          : <button onClick={()=>setPayWeek(paySun)} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:8,padding:"6px 12px",fontSize:11,fontWeight:700,cursor:"pointer"}}>Today</button>}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <span style={{color:"#666",fontSize:11}}>Powered by Square</span>
                        {squareConnected ? (
                          <button onClick={handleSyncSquare} disabled={squareSyncing}
                            style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:7,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:squareSyncing?"default":"pointer",whiteSpace:"nowrap",opacity:squareSyncing?0.6:1}}>
                            {squareSyncing ? "Syncing…" : "Sync Now"}
                          </button>
                        ) : (
                          <button onClick={handleConnectSquare} disabled={squareLoading}
                            style={{background:T.accent,color:"white",border:"none",borderRadius:7,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:squareLoading?"default":"pointer",whiteSpace:"nowrap",opacity:squareLoading?0.6:1}}>
                            Connect to Square
                          </button>
                        )}
                      </div>
                    </div>
                    {squareConnected && (
                      <div style={{padding:"7px 18px",background:T.muted,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,borderBottom:`1px solid ${T.border}`}}>
                        <span style={{fontSize:11,color:T.sub}}>
                          {squareMerchantName ? squareMerchantName+" · " : ""}Last synced {squareLastSync ? new Date(squareLastSync).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) : "never"}
                        </span>
                        <button onClick={handleDisconnectSquare}
                          style={{background:"transparent",color:T.sub,border:"none",fontSize:11,fontWeight:600,cursor:"pointer",padding:0,textDecoration:"underline"}}>
                          Disconnect
                        </button>
                      </div>
                    )}

                    <div style={{padding:"16px 18px",display:"flex",flexDirection:"column",gap:16}}>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10}}>
                        {[
                          { l:"Total Revenue", v:totalRevenue>0?`$${totalRevenue.toFixed(0)}`:"-", c:"#3A9BE8", sub:"this week" },
                          { l:"Labor Cost", v:`$${payWeekLabor.toFixed(2)}`, c:T.accent, sub:"this week" },
                          { l:"Total Hours", v:pwHrs+"h", c:"#3A9BE8", sub:"scheduled" },
                          { l:"Staff Scheduled", v:pwStaff+"/"+employees.length, c:"#4CAF7D", sub:"have shifts" },
                          { l:"Forecast (Next 7 Days)",
                            v: forecastNext7.hasEnoughData ? `$${forecastNext7.total.toFixed(0)}` : "Need more data",
                            c: forecastNext7.hasEnoughData ? "#3A9BE8" : T.sub,
                            sub: forecastNext7.hasEnoughData ? `suggested labor: $${Math.round(forecastNext7.total*0.3)}` : `min ${MIN_DOW_SAMPLES} weeks of history needed` },
                        ].map(s=>(
                          <div key={s.l} style={{background:T.muted,borderRadius:10,padding:"12px 14px"}}>
                            <div style={{fontSize:10,color:T.sub,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:4}}>{s.l}</div>
                            <div style={{fontSize:20,fontWeight:800,color:s.c,lineHeight:1}}>{s.v}</div>
                            <div style={{fontSize:9,color:T.sub,marginTop:4}}>{s.sub}</div>
                          </div>
                        ))}
                        {/* Labor Cost % — standalone tile with Projected/Actual toggle */}
                        {(()=>{
                          const projPct = forecastThisWeek.hasEnoughData && forecastThisWeek.total > 0
                            ? (payWeekLabor / forecastThisWeek.total) * 100 : null;
                          const actPct  = totalRevenue > 0 ? laborCostPct : null;
                          const dispPct = laborPctMode === "projected" ? projPct : actPct;
                          const pctColor = dispPct == null ? T.sub : dispPct > 35 ? "#C0392B" : dispPct > 25 ? "#E8A93A" : "#4CAF7D";
                          const pctSub = laborPctMode === "projected"
                            ? (forecastThisWeek.hasEnoughData ? `vs $${forecastThisWeek.total.toFixed(0)} forecasted` : "need more history")
                            : (totalRevenue > 0 ? `vs $${totalRevenue.toFixed(0)} actual` : "no revenue yet");
                          return (
                            <div key="labor-pct" style={{background:T.muted,borderRadius:10,padding:"12px 14px"}}>
                              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                                <div style={{fontSize:10,color:T.sub,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em"}}>Labor Cost %</div>
                                <div style={{display:"flex",background:T.border,borderRadius:20,padding:2,gap:2}}>
                                  {["projected","actual"].map(m=>(
                                    <button key={m} onClick={e=>{e.stopPropagation();setLaborPctMode(m);}}
                                      style={{background:laborPctMode===m?T.accent:"transparent",color:laborPctMode===m?"white":T.sub,border:"none",borderRadius:18,padding:"3px 8px",fontSize:9,fontWeight:700,cursor:"pointer",transition:"all 0.15s",textTransform:"capitalize",whiteSpace:"nowrap"}}>
                                      {m}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div style={{fontSize:20,fontWeight:800,color:pctColor,lineHeight:1}}>{dispPct!=null?`${dispPct.toFixed(1)}%`:"-"}</div>
                              <div style={{fontSize:9,color:T.sub,marginTop:4}}>{pctSub}</div>
                              <div style={{fontSize:9,color:T.sub,marginTop:6,padding:"4px 6px",background:laborPctMode==="projected"?"#EAF4EF":"#FEF3E2",borderRadius:5}}>
                                {dispPct!=null?(dispPct<25?"✓ Under target":dispPct<=35?"✓ On target":"⚠ Over target"):""} target: 25–35%
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      <div>
                        <button onClick={()=>setShowDailyBreakdown(v=>!v)}
                          style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",background:"transparent",border:"none",padding:"4px 0",cursor:"pointer"}}>
                          <span style={{fontSize:11,fontWeight:700,color:T.sub,textTransform:"uppercase",letterSpacing:"0.04em"}}>Daily breakdown</span>
                          <span style={{fontSize:11,color:T.accent,fontWeight:700}}>{showDailyBreakdown ? "Hide ▲" : "Show ▼"}</span>
                        </button>
                        {showDailyBreakdown && dayData.map((d,i)=>(
                          <div key={d.date} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderBottom:i<dayData.length-1?`1px solid ${T.border}`:"none",fontSize:12}}>
                            <span style={{color:T.text,fontWeight:700,width:36,flexShrink:0}}>{d.day}</span>
                            <span style={{color:T.sub,flex:1}}>{d.revenue>0?`$${d.revenue.toFixed(0)} sales`:"no sales data"}</span>
                            <span style={{color:T.sub,flex:1,textAlign:"right"}}>{d.labor>0?`$${d.labor.toFixed(0)} labor`:"-"}</span>
                            <span style={{width:44,textAlign:"right",fontWeight:700,color:d.pct==null?T.sub:d.pct>35?"#C0392B":d.pct>25?"#E8A93A":"#4CAF7D"}}>{d.pct!=null?`${d.pct.toFixed(0)}%`:"-"}</span>
                          </div>
                        ))}
                      </div>

                      <div style={{background:T.muted,borderRadius:10,padding:"14px 16px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                          <div>
                            <div style={{fontSize:10,color:T.sub,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em"}}>Weekly Budget</div>
                            <div style={{fontSize:20,fontWeight:800,color:T.text,marginTop:2}}>{bgt>0?`$${bgt.toFixed(0)}`:"Not set"}</div>
                          </div>
                          {bgt>0 && <span style={{fontSize:12,fontWeight:700,color:bc}}>{over?"$"+(payWeekLabor-bgt).toFixed(0)+" over":"$"+(bgt-payWeekLabor).toFixed(0)+(warn?" left":" remaining")}</span>}
                        </div>
                        {bgt>0 && (
                          <>
                            <div style={{height:10,background:T.surface,borderRadius:5,overflow:"hidden",marginTop:8}}><div style={{height:"100%",width:`${pct}%`,background:bc,borderRadius:5,transition:"width 0.3s"}}/></div>
                            <div style={{display:"flex",justifyContent:"space-between",marginTop:6,fontSize:11,color:T.sub}}><span>$0</span><span>${bgt.toFixed(0)}</span></div>
                          </>
                        )}
                        {suggestedDailyLabor > 0 && (
                          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:bgt>0?12:8,paddingTop:bgt>0?12:0,borderTop:bgt>0?`1px solid ${T.border}`:"none",flexWrap:"wrap"}}>
                            <div style={{flex:1,minWidth:200}}>
                              <div style={{fontSize:12,fontWeight:700,color:T.text,marginBottom:2}}>Suggested labor budget</div>
                              <div style={{fontSize:11,color:T.sub,lineHeight:1.5}}>
                                Based on your historical daily revenue, you should target <strong style={{color:T.text}}>${suggestedDailyLabor}/day</strong> in labor (30% of avg daily revenue). Across 7 days that's <strong style={{color:T.accent}}>${suggestedWeeklyBudget}/week</strong>.
                              </div>
                            </div>
                            <button onClick={()=>{
                              setWeeklyBudget(String(suggestedWeeklyBudget));
                              saveBizSettings({weekly_budget: suggestedWeeklyBudget}).catch(()=>{});
                              showToast(`Weekly budget set to $${suggestedWeeklyBudget} ($${suggestedDailyLabor}/day × 7) ✓`);
                            }}
                              style={{background:T.accent,color:"white",border:"none",borderRadius:8,padding:"8px 16px",fontWeight:700,fontSize:12,cursor:"pointer",flexShrink:0}}>
                              Apply ${suggestedWeeklyBudget}
                            </button>
                          </div>
                        )}
                      </div>

                      {!hasSalesData && (
                        <div style={{background:T.muted,borderRadius:10,padding:"14px 16px",textAlign:"center"}}>
                          {squareConnected ? (
                            <div style={{fontSize:12,color:T.sub}}>Connected — tap Sync Now above to pull your sales history.</div>
                          ) : (
                            <>
                              <div style={{fontSize:12,color:T.sub,marginBottom:10}}>Connect to Square above for automatic sync, or import a Sales Summary CSV.</div>
                              <label style={{background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 16px",fontSize:12,fontWeight:700,cursor:"pointer",display:"inline-block"}}>
                                Import Square CSV
                                <input type="file" accept=".csv" onChange={e=>{importSquareCSV(e.target.files[0]);e.target.value="";}} style={{display:"none"}}/>
                              </label>
                            </>
                          )}
                        </div>
                      )}

                      {salesData.length > 0 && (
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                          <span style={{fontSize:11,color:T.sub}}>{salesData.length} days of data · {salesData[0]?.date} to {salesData[salesData.length-1]?.date}</span>
                          <div style={{display:"flex",gap:8}}>
                            <label style={{background:"transparent",color:T.sub,border:`1px solid ${T.border}`,borderRadius:7,padding:"5px 10px",fontSize:11,fontWeight:600,cursor:"pointer"}}>
                              Import CSV
                              <input type="file" accept=".csv" onChange={e=>{importSquareCSV(e.target.files[0]);e.target.value="";}} style={{display:"none"}}/>
                            </label>
                            <button onClick={()=>{ if(window.confirm("Clear all imported sales data?")) { setSalesData([]); if(bizId) dbDelete(`sales_data?business_id=eq.${bizId}`).catch(()=>{}); }; }}
                              style={{background:"transparent",color:T.sub,border:`1px solid ${T.border}`,borderRadius:7,padding:"5px 10px",fontSize:11,fontWeight:600,cursor:"pointer"}}>
                              Clear Data
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Your Widgets */}
              <div style={{background:T.surface,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden"}}>
                <div style={{padding:"12px 18px",background:T.dark,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{color:"white",fontWeight:800,fontSize:14}}>Your Widgets</span>
                  <button onClick={()=>setShowAddWidget(true)}
                    style={{background:T.accent,color:"white",border:"none",borderRadius:7,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                    + Add
                  </button>
                </div>
                <div style={{padding:"16px 18px"}}>
                  {widgets.length===0 ? (
                    <div style={{textAlign:"center",padding:"20px 0",color:T.sub,fontSize:12}}>
                      No widgets yet — tap "+ Add" to build a sales, labor, or forecast view of your own.
                    </div>
                  ) : (
                    <div style={{display:"grid",gridTemplateColumns:"repeat(2, 1fr)",gridAutoRows:"auto",gap:10}}>
                      {widgets.map(w=>renderWidgetCard(w))}
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* Add Widget modal */}
          {showAddWidget && (
            <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:1000}} onClick={()=>setShowAddWidget(false)}>
              <div onClick={e=>e.stopPropagation()} style={{background:T.surface,borderRadius:"16px 16px 0 0",padding:"20px 18px",width:"100%",maxWidth:480,maxHeight:"80vh",overflowY:"auto"}}>
                <div style={{fontWeight:800,fontSize:15,color:T.text,marginBottom:14}}>Add Widget</div>

                <div style={{fontSize:10,color:T.sub,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:6}}>Data</div>
                <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
                  {[{k:"sales",l:"Sales"},{k:"labor",l:"Labor"},{k:"both",l:"Sales & Labor"}].map(o=>(
                    <button key={o.k} onClick={()=>setNewWidget(w=>({...w,data_source:o.k}))}
                      style={{background:newWidget.data_source===o.k?T.accent:T.muted,color:newWidget.data_source===o.k?"white":T.text,border:"none",borderRadius:20,padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                      {o.l}
                    </button>
                  ))}
                </div>

                <div style={{fontSize:10,color:T.sub,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:6}}>Time Range</div>
                <div style={{display:"flex",gap:6,marginBottom:6,flexWrap:"wrap"}}>
                  {FILTERS.filter(f=>f.kind==="history").map(f=>(
                    <button key={f.key} onClick={()=>setNewWidget(w=>({...w,time_range:f.key}))}
                      style={{background:newWidget.time_range===f.key?T.accent:T.muted,color:newWidget.time_range===f.key?"white":T.text,border:"none",borderRadius:20,padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                      {f.label}
                    </button>
                  ))}
                </div>
                <div style={{fontSize:10,color:T.sub,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em",margin:"8px 0 6px"}}>Forecast</div>
                <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
                  {FILTERS.filter(f=>f.kind==="forecast").map(f=>(
                    <button key={f.key} onClick={()=>setNewWidget(w=>({...w,time_range:f.key}))}
                      style={{background:newWidget.time_range===f.key?T.accent:T.muted,color:newWidget.time_range===f.key?"white":T.text,border:"none",borderRadius:20,padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                      {f.label}
                    </button>
                  ))}
                </div>

                <div style={{fontSize:10,color:T.sub,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:6}}>Display</div>
                <div style={{display:"flex",gap:6,marginBottom:18,flexWrap:"wrap"}}>
                  {[{k:"stat",l:"Stat Card"},{k:"line",l:"Line Chart"},{k:"bar",l:"Bar Chart"},{k:"table",l:"Table"}].map(o=>(
                    <button key={o.k} onClick={()=>setNewWidget(w=>({...w,display:o.k}))}
                      style={{background:newWidget.display===o.k?T.accent:T.muted,color:newWidget.display===o.k?"white":T.text,border:"none",borderRadius:8,padding:"8px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                      {o.l}
                    </button>
                  ))}
                </div>

                <div style={{fontSize:10,color:T.sub,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:6}}>Color</div>
                <div style={{display:"flex",gap:8,marginBottom:18}}>
                  {WIDGET_COLORS.map(c=>(
                    <button key={c.key} onClick={()=>setNewWidget(w=>({...w,color:c.hex}))} aria-label={`Color: ${c.key}`}
                      style={{width:28,height:28,borderRadius:"50%",background:c.hex,border:newWidget.color===c.hex?`2px solid ${T.text}`:"2px solid transparent",cursor:"pointer",padding:0}}/>
                  ))}
                </div>

                {(newWidget.display==="line" || newWidget.display==="bar") && (
                  <div style={{display:"flex",gap:18,marginBottom:18,flexWrap:"wrap"}}>
                    <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:T.text,cursor:"pointer"}}>
                      <input type="checkbox" checked={newWidget.show_axis} onChange={e=>setNewWidget(w=>({...w,show_axis:e.target.checked}))}/>
                      Show axis labels
                    </label>
                    <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:T.text,cursor:"pointer"}}>
                      <input type="checkbox" checked={newWidget.show_legend} onChange={e=>setNewWidget(w=>({...w,show_legend:e.target.checked}))}/>
                      Show legend
                    </label>
                  </div>
                )}

                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setShowAddWidget(false)}
                    style={{flex:1,background:"transparent",color:T.sub,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 0",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                    Cancel
                  </button>
                  <button onClick={addWidget} disabled={widgetSaving}
                    style={{flex:2,background:T.accent,color:"white",border:"none",borderRadius:10,padding:"12px 0",fontSize:13,fontWeight:700,cursor:widgetSaving?"default":"pointer",opacity:widgetSaving?0.6:1}}>
                    {widgetSaving?"Adding…":"Add Widget"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {tab==="insights" && (()=>{
            function ScoreCard({ score, scoreColor, scoreBg, history, isOpen, onToggle }) {
              const [open, setOpen] = [isOpen, onToggle];

              // 4-week rolling average (excluding current week)
              const prior = history.slice(1, 5); // skip index 0 = current week
              const avg4  = prior.length > 0 ? Math.round(prior.reduce((s,h)=>s+h.score,0)/prior.length) : null;
              const delta = avg4 != null ? score.value - avg4 : null;
              const deltaColor = delta == null ? T.sub : delta > 0 ? "#4CAF7D" : delta < 0 ? "#C0392B" : T.sub;
              const deltaLabel = delta == null ? null : delta > 0 ? `+${delta} vs avg` : delta < 0 ? `${delta} vs avg` : "= avg";

              // Sparkline — last 8 weeks
              const sparkData = [...history].reverse().slice(-8);

              return (
                <div style={{flexShrink:0, minWidth:160}}>
                  <div style={{background:scoreBg(score.value), borderRadius:12, padding:"12px 18px", textAlign:"center", marginBottom:6}}>
                    <div style={{fontSize:32, fontWeight:900, color:scoreColor(score.value), lineHeight:1}}>{score.value}</div>
                    <div style={{fontSize:11, fontWeight:800, color:scoreColor(score.value), marginTop:2}}>{score.label}</div>
                    <div style={{fontSize:9, color:"#888", marginTop:4, lineHeight:1.3}}>{score.reason}</div>
                    {/* Delta vs 4-week avg */}
                    {delta != null && (
                      <div style={{marginTop:8, display:"flex", alignItems:"center", justifyContent:"center", gap:6}}>
                        <span style={{fontSize:12, fontWeight:800, color:deltaColor}}>{deltaLabel}</span>
                        <span style={{fontSize:9, color:"#888"}}>{prior.length}wk avg: {avg4}</span>
                      </div>
                    )}
                    {history.length === 0 && (
                      <div style={{fontSize:9, color:"#888", marginTop:6}}>Run weekly to build your benchmark</div>
                    )}
                    {/* Sparkline */}
                    {sparkData.length > 1 && (
                      <div style={{marginTop:10}}>
                        <svg viewBox={`0 0 ${sparkData.length * 20} 32`} style={{width:"100%", height:32}}>
                          {sparkData.map((h,i) => {
                            const x = i * 20 + 10;
                            const y = 30 - Math.round((h.score / 100) * 26);
                            const isCurrent = i === sparkData.length - 1;
                            return (
                              <g key={h.id}>
                                {i > 0 && (
                                  <line
                                    x1={(i-1)*20+10} y1={30 - Math.round((sparkData[i-1].score/100)*26)}
                                    x2={x} y2={y}
                                    stroke={isCurrent ? scoreColor(h.score) : "#ccc"} strokeWidth="1.5"/>
                                )}
                                <circle cx={x} cy={y} r={isCurrent?4:2.5}
                                  fill={isCurrent ? scoreColor(h.score) : "#ccc"}/>
                              </g>
                            );
                          })}
                        </svg>
                        <div style={{fontSize:8, color:"#aaa", textAlign:"center"}}>last {sparkData.length} weeks</div>
                      </div>
                    )}
                  </div>
                  <button onClick={()=>setOpen(o=>!o)}
                    style={{width:"100%", background:open?T.accent+"18":"transparent", border:`1px solid ${open?T.accent:T.border}`, borderRadius:8, padding:"5px 8px", fontSize:10, fontWeight:700, color:open?T.accent:T.sub, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:4, marginTop:6}}>
                    <span>📖</span> How is this scored? {open?"▲":"▼"}
                  </button>
                </div>
              );
            }
            const hasData = employees.length > 0 && Object.keys(schedule).length > 0;
            const urgencyColor = { low:"#4CAF7D", medium:"#E8A93A", high:"#C0392B" };
            const scoreColor = v => v >= 75 ? "#4CAF7D" : v >= 50 ? "#E8A93A" : "#C0392B";
            const scoreBg    = v => v >= 75 ? "#F0FFF4" : v >= 50 ? "#FEF3E2" : "#FDECEA";

            return (
              <div style={{maxWidth:900, margin:"0 auto", display:"flex", flexDirection:"column", gap:16}}>

                {/* Header */}
                <div style={{display:"flex", alignItems:"flex-start", justifyContent:"space-between", flexWrap:"wrap", gap:12}}>
                  <div>
                    <h2 style={{margin:"0 0 4px", fontSize:20, fontWeight:800, color:T.text}}>Business Insights</h2>
                    <p style={{margin:0, fontSize:12, color:T.sub, lineHeight:1.5}}>
                      AI analysis of your schedule, labor costs, and team — powered by Claude.
                      {insight && <span style={{marginLeft:6, color:T.sub}}>Last updated {new Date(insight.generatedAt).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</span>}
                    </p>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
                    <button onClick={()=>setNotifPanelOpen(p=>!p)}
                      title="Notification preferences"
                      style={{background:notifPanelOpen?T.accent:T.muted,border:`1px solid ${notifPanelOpen?T.accent:T.border}`,borderRadius:9,width:38,height:38,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,cursor:"pointer",transition:"all 0.15s",position:"relative"}}>
                      🔔
                      {notifFreq!=="off"&&<span style={{position:"absolute",top:4,right:4,width:7,height:7,borderRadius:"50%",background:T.accent,border:`1.5px solid ${T.bg}`}}/>}
                    </button>
                    <button onClick={generateInsight} disabled={insightLoading}
                      style={{
                        background: insightLoading ? T.muted : T.accent,
                        color: insightLoading ? T.sub : "white",
                        border:"none", borderRadius:10, padding:"10px 20px",
                        fontWeight:700, fontSize:13, cursor: insightLoading ? "not-allowed" : "pointer",
                        display:"flex", alignItems:"center", gap:8,
                        transition:"all 0.15s"
                      }}>
                      {insightLoading ? (
                        <><span style={{display:"inline-block", animation:"spin 1s linear infinite"}}>⟳</span> Analyzing...</>
                      ) : (
                        <><span>🧠</span> {insight ? "Refresh Analysis" : "Generate Insights"}</>
                      )}
                    </button>
                  </div>
                </div>

                {/* Notification preferences panel */}
                {notifPanelOpen && (
                  <Card T={T} style={{padding:"18px 20px",border:`1.5px solid ${T.accent}28`,background:T.accent+"08"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                      <div>
                        <div style={{fontWeight:800,fontSize:14,color:T.text}}>🔔 Pulse Notifications</div>
                        <div style={{fontSize:11,color:T.sub,marginTop:2}}>When should ShiftWise remind you to run your weekly analysis?</div>
                      </div>
                      <button onClick={()=>setNotifPanelOpen(false)} style={{background:T.muted,border:"none",borderRadius:"50%",width:28,height:28,fontSize:16,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
                    </div>
                    <div style={{marginBottom:14}}>
                      <div style={{fontSize:10,fontWeight:700,color:T.sub,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Frequency</div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                        {[
                          {k:"login",  l:"On Login",   d:"Every time you open ShiftWise"},
                          {k:"daily",  l:"Daily",      d:"Once per day"},
                          {k:"weekly", l:"Weekly",     d:"Pick a day below"},
                          {k:"off",    l:"Off",        d:"No reminders"},
                        ].map(opt=>(
                          <button key={opt.k} onClick={()=>{ setNotifFreq(opt.k); try{localStorage.setItem("sw_notif_freq",opt.k);}catch{} }}
                            title={opt.d}
                            style={{background:notifFreq===opt.k?T.accent:T.muted,color:notifFreq===opt.k?"white":T.sub,border:`1.5px solid ${notifFreq===opt.k?T.accent:T.border}`,borderRadius:8,padding:"7px 14px",fontWeight:700,fontSize:12,cursor:"pointer",transition:"all 0.15s"}}>
                            {opt.l}
                          </button>
                        ))}
                      </div>
                    </div>
                    {notifFreq==="weekly" && (
                      <div style={{marginBottom:14}}>
                        <div style={{fontSize:10,fontWeight:700,color:T.sub,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Day of week</div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map(day=>(
                            <button key={day} onClick={()=>{ setNotifDay(day); try{localStorage.setItem("sw_notif_day",day);}catch{} }}
                              style={{background:notifDay===day?T.accent:T.muted,color:notifDay===day?"white":T.sub,border:`1.5px solid ${notifDay===day?T.accent:T.border}`,borderRadius:8,padding:"6px 12px",fontWeight:700,fontSize:11,cursor:"pointer",transition:"all 0.15s"}}>
                              {day.slice(0,3)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div style={{background:T.muted,borderRadius:9,padding:"10px 14px",fontSize:12,color:T.text,display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
                      <span style={{fontSize:16}}>{notifFreq==="off"?"🔕":"🔔"}</span>
                      <span>
                        {notifFreq==="off" && "Pulse reminders are off — you'll need to run it manually."}
                        {notifFreq==="login" && "You'll see a Pulse reminder each time you open ShiftWise."}
                        {notifFreq==="daily" && "You'll see a Pulse reminder once per day when you open the app."}
                        {notifFreq==="weekly" && `You'll see a Pulse reminder every ${notifDay} when you open the app.`}
                      </span>
                    </div>
                    <div style={{background:"#F5EEFF",borderRadius:9,padding:"10px 14px",border:"1px solid #9B59B630"}}>
                      <div style={{fontSize:11,fontWeight:700,color:"#9B59B6",marginBottom:3}}>📧 Email & SMS Digest — Coming Soon</div>
                      <div style={{fontSize:11,color:"#7D4B9E",lineHeight:1.5}}>Get your Weekly Pulse delivered to your inbox or phone every Monday morning. Available on the Pro plan.</div>
                    </div>
                  </Card>
                )}

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

                {/* Empty state — first-run checklist */}
                {!insightLoading && !insight && !insightError && (() => {
                  const hasEmployees = employees.length > 0;
                  const hasShifts = hasEmployees && Object.keys(schedule).some(wk =>
                    employees.some(e => DAYS.some((_, di) => getShift(wk, e.id, di)))
                  );
                  const readyToGenerate = hasEmployees && hasShifts;

                  const stepIcon = (done, active) => ({
                    bg: done ? "#E8F5E9" : active ? "#EBF5FF" : T.muted,
                    color: done ? "#2D6A4F" : active ? "#185FA5" : T.sub,
                    symbol: done ? "✓" : active ? "→" : "·",
                  });

                  return (
                    <Card T={T} style={{padding:"28px 28px 24px"}}>
                      <div style={{display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:16, flexWrap:"wrap", marginBottom:24}}>
                        <div>
                          <div style={{fontWeight:800, fontSize:17, color:T.text, marginBottom:4}}>Your first Pulse is 3 steps away</div>
                          <div style={{fontSize:13, color:T.sub, lineHeight:1.5}}>Complete these steps, then hit Generate Insights to get your plain-English briefing.</div>
                        </div>
                        <button onClick={generateInsight} disabled={!readyToGenerate || insightLoading}
                          style={{background:readyToGenerate ? T.accent : T.muted, color:readyToGenerate ? "white" : T.sub, border:"none", borderRadius:10, padding:"10px 20px", fontWeight:800, fontSize:13, cursor:readyToGenerate ? "pointer" : "not-allowed", opacity:readyToGenerate ? 1 : 0.55, flexShrink:0, transition:"all 0.15s"}}>
                          🧠 Generate insights
                        </button>
                      </div>

                      {/* Step 1 */}
                      {(() => { const s = stepIcon(hasEmployees, !hasEmployees); return (
                        <div style={{display:"flex", alignItems:"flex-start", gap:14, padding:"16px 0", borderBottom:`1px solid ${T.border}`}}>
                          <div style={{width:34, height:34, borderRadius:"50%", background:s.bg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, color:s.color, fontWeight:800, flexShrink:0, marginTop:1}}>{s.symbol}</div>
                          <div style={{flex:1}}>
                            <div style={{fontWeight:700, fontSize:14, color:hasEmployees ? T.text : T.sub, marginBottom:3}}>Employees added</div>
                            <div style={{fontSize:12, color:T.sub, lineHeight:1.5}}>{hasEmployees ? `${employees.length} team member${employees.length !== 1 ? "s" : ""} on your roster with roles and hourly rates.` : "Add your team in Settings → Team Roster so ShiftWise can calculate labor cost."}</div>
                            {hasEmployees && <span style={{display:"inline-block", marginTop:5, fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:20, background:"#E8F5E9", color:"#2D6A4F"}}>Done</span>}
                            {!hasEmployees && <button onClick={()=>setTab("settings")} style={{marginTop:8, background:"transparent", border:`1px solid ${T.border}`, borderRadius:8, padding:"5px 12px", fontSize:12, color:T.text, cursor:"pointer", fontWeight:600}}>Go to Settings →</button>}
                          </div>
                        </div>
                      ); })()}

                      {/* Step 2 */}
                      {(() => { const s = stepIcon(hasShifts, hasEmployees && !hasShifts); return (
                        <div style={{display:"flex", alignItems:"flex-start", gap:14, padding:"16px 0", borderBottom:`1px solid ${T.border}`}}>
                          <div style={{width:34, height:34, borderRadius:"50%", background:s.bg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, color:s.color, fontWeight:800, flexShrink:0, marginTop:1}}>{s.symbol}</div>
                          <div style={{flex:1}}>
                            <div style={{fontWeight:700, fontSize:14, color:hasShifts ? T.text : hasEmployees ? T.text : T.sub, marginBottom:3}}>Build your first week of shifts</div>
                            <div style={{fontSize:12, color:T.sub, lineHeight:1.5}}>Head to the Schedule tab and assign shifts to your team. ShiftWise needs at least one scheduled week to generate your Pulse.</div>
                            {hasShifts && <span style={{display:"inline-block", marginTop:5, fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:20, background:"#E8F5E9", color:"#2D6A4F"}}>Done</span>}
                            {hasEmployees && !hasShifts && <button onClick={()=>setTab("grid")} style={{marginTop:8, background:"transparent", border:`1px solid ${T.border}`, borderRadius:8, padding:"5px 12px", fontSize:12, color:T.text, cursor:"pointer", fontWeight:600}}>Go to Schedule →</button>}
                          </div>
                        </div>
                      ); })()}

                      {/* Step 3 */}
                      {(() => { const s = stepIcon(false, hasShifts); return (
                        <div style={{display:"flex", alignItems:"flex-start", gap:14, padding:"16px 0 0"}}>
                          <div style={{width:34, height:34, borderRadius:"50%", background:s.bg, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, color:s.color, fontWeight:800, flexShrink:0, marginTop:1}}>{s.symbol}</div>
                          <div style={{flex:1}}>
                            <div style={{fontWeight:700, fontSize:14, color:hasShifts ? T.text : T.sub, marginBottom:3}}>Come back and generate your Pulse</div>
                            <div style={{fontSize:12, color:T.sub, lineHeight:1.5}}>Once you have shifts scheduled, hit "Generate insights" above. Your first Weekly Pulse will analyze labor cost, coverage gaps, and attendance — in plain English.</div>
                          </div>
                        </div>
                      ); })()}

                    </Card>
                  );
                })()}

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
                          <ScoreCard score={insight.score} scoreColor={scoreColor} scoreBg={scoreBg} history={pulseHistory} isOpen={scoreOpen} onToggle={setScoreOpen} />
                        )}
                      </div>

                      {/* Scoring legend — full width */}
                      {scoreOpen && insight.score && (
                        <div style={{padding:"16px 20px", borderBottom:`1px solid ${T.border}`, background:T.surface}}>
                          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:24}}>
                            <div>
                              <div style={{fontWeight:800, fontSize:13, color:T.text, marginBottom:10}}>Score ranges</div>
                              {[
                                {range:"75–100", label:"Healthy",  color:"#4CAF7D", bg:"#F0FFF4", desc:"Schedule is running clean — no major issues detected."},
                                {range:"50–74",  label:"Caution",  color:"#E8A93A", bg:"#FEF3E2", desc:"One or more issues need attention before they compound."},
                                {range:"30–49",  label:"Warning",  color:"#C0392B", bg:"#FDECEA", desc:"Multiple problems affecting scheduling health."},
                                {range:"0–29",   label:"Critical", color:"#7B0000", bg:"#FDECEA", desc:"Significant issues requiring immediate action."},
                              ].map(s=>(
                                <div key={s.label} style={{display:"flex", alignItems:"flex-start", gap:10, marginBottom:10,
                                  padding:"8px 10px", borderRadius:8,
                                  background: insight.score.label===s.label ? s.bg : "transparent",
                                  border: insight.score.label===s.label ? `1px solid ${s.color}30` : "1px solid transparent"}}>
                                  <div style={{width:10, height:10, borderRadius:"50%", background:s.color, flexShrink:0, marginTop:2}}/>
                                  <div>
                                    <div style={{fontWeight:insight.score.label===s.label?800:600, fontSize:12, color:insight.score.label===s.label?s.color:T.text}}>{s.range} — {s.label}</div>
                                    <div style={{fontSize:11, color:T.sub, marginTop:2, lineHeight:1.4}}>{s.desc}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <div>
                              <div style={{fontWeight:800, fontSize:13, color:T.text, marginBottom:10}}>Points deducted for</div>
                              {[
                                ["−20", "Overtime scheduled (40h+)", "Any employee scheduled over 40 hours triggers overtime pay rules."],
                                ["−8",  "Near overtime (36–40h)", "Close enough to overtime that punch variance could push them over."],
                                ["−15", "Labor over weekly budget", "Scheduled labor exceeds your set weekly target."],
                                ["−10", "Budget pace projects over", "Mid-week rate puts you on track to finish over budget."],
                                ["−12", "Punch variance over 8h", "Employees are clocking significantly more than scheduled."],
                                ["−10", "Missed punch-in today", "An employee has a shift today with no clock-in recorded."],
                                ["−8",  "Attendance reliability", "An employee has 7+ flagged punches in the last 30 days."],
                                ["−5/day", "Open days with no staff", "Business hours show you're open but no one is scheduled."],
                                ["−3",  "No sales data loaded", "Can't calculate revenue efficiency without sales data."],
                              ].map(([pts, title, desc])=>(
                                <div key={title} style={{display:"flex", gap:10, marginBottom:8, alignItems:"flex-start"}}>
                                  <span style={{fontWeight:800, color:"#C0392B", minWidth:52, flexShrink:0, fontSize:12}}>{pts}</span>
                                  <div>
                                    <div style={{fontWeight:600, fontSize:12, color:T.text}}>{title}</div>
                                    <div style={{fontSize:10, color:T.sub, marginTop:1, lineHeight:1.4}}>{desc}</div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

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
              <div style={{maxWidth:900,margin:"0 auto",paddingBottom:20}}>
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
              <div style={{maxWidth:760, margin:"0 auto", paddingBottom:20}}>
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
                                <span style={{fontSize:11,fontWeight:800,color:theme.id==="commander"?theme.text:"white",display:"inline-flex",alignItems:"center",gap:0}}>
                                  ShiftWise
                                  <span style={{color:"#6B7280",margin:"0 4px",fontWeight:300}}>|</span>
                                  Veredian
                                  <span style={{fontSize:7,fontWeight:400,color:"#93c5fd",position:"relative",bottom:"4px",marginLeft:2,letterSpacing:"0.05em"}}>Beta</span>
                                </span>
                                <div style={{marginLeft:"auto",display:"flex",gap:3}}>
                                  {["Schedule","Team","Dashboard"].map(lbl=>(<div key={lbl} style={{background:lbl==="Schedule"?theme.accent:"transparent",color:"#888",borderRadius:3,padding:"2px 6px",fontSize:8,fontWeight:700}}>{lbl}</div>))}
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
            {/* Mark all reviewed + Clear actioned */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <button onClick={()=>{
                const updates = {};
                flagged.forEach(p=>{ if(!punchReviews[p.id]) updates[p.id]="reviewed"; });
                setPunchReviews(prev=>({...prev,...updates}));
                if (bizId) {
                  Object.entries(updates).forEach(([pid, status]) => {
                    fetch(`${SUPABASE_URL}/rest/v1/punch_reviews?on_conflict=punch_id`, {
                      method: "POST",
                      headers: { ...SB_HEADERS, Authorization: `Bearer ${getToken()}`, Prefer: "resolution=merge-duplicates,return=minimal" },
                      body: JSON.stringify({ business_id: bizId, punch_id: pid, status, reviewed_by: getSession()?.user?.id || null })
                    }).catch(e=>console.warn("punch_reviews insert failed:", e));
                  });
                }
                showToast("All alerts marked as reviewed ✓");
              }} style={{background:T.muted,color:T.sub,border:`1px solid ${T.border}`,borderRadius:9,padding:"8px 0",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                Mark All Reviewed
              </button>
              <button onClick={()=>{
                const actionedIds = flagged.filter(p => punchReviews[p.id] && punchReviews[p.id] !== "pending").map(p=>p.id);
                if (actionedIds.length === 0) { showToast("No actioned alerts to clear"); return; }
                setPunches(prev => prev.map(p => actionedIds.includes(p.id) ? {...p, flags:[]} : p));
                showToast(`Cleared ${actionedIds.length} actioned alert${actionedIds.length!==1?"s":""} ✓`);
              }} style={{background:"#FDECEA",color:"#C0392B",border:"1px solid #C0392B22",borderRadius:9,padding:"8px 0",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                Clear Actioned
              </button>
            </div>

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
                      <button key={val} onClick={()=>{
                        setPunchReviews(prev=>({...prev,[p.id]:val}));
                        if (bizId) {
                          fetch(`${SUPABASE_URL}/rest/v1/punch_reviews?on_conflict=punch_id`, {
                            method: "POST",
                            headers: { ...SB_HEADERS, Authorization: `Bearer ${getToken()}`, Prefer: "resolution=merge-duplicates,return=minimal" },
                            body: JSON.stringify({ business_id: bizId, punch_id: p.id, status: val, reviewed_by: getSession()?.user?.id || null })
                          }).catch(e=>console.warn("punch_reviews insert failed:", e));
                        }
                      }}
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

        {/* FEEDBACK TAB */}
        {tab==="feedback" && <FeedbackTab bizId={bizId} T={T} Card={Card} showToast={showToast} addAudit={addAudit} getSession={getSession} dbPost={dbPost}/>}

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