import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  ResponsiveContainer, LineChart as RLineChart, BarChart as RBarChart,
  AreaChart as RAreaChart, ComposedChart as RComposedChart,
  Line, Bar, Area as RArea, Cell, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend as RLegend, LabelList,
} from "recharts";

// UI Batch 1/2 look: pastel metric cards, light panels, quiet axes
const UI = {
  ink: "#1C2B22", sub: "#5E6B63", line: "#E6E8E4", panel: "#F7F8F6",
  pastels: ["#E4EFFB", "#ECEAFB", "#E4F3EC", "#F7EFE2"],
  up: "#1F6B48", down: "#A93226",
};

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

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE CONFIG
// To update credentials: change SUPABASE_URL and SUPABASE_ANON_KEY only.
// All queries live in the functions below — no other files need to change.
// ─────────────────────────────────────────────────────────────────────────────
const SUPABASE_URL      = "https://kyrjgfeowmflazywsuir.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt5cmpnZmVvd21mbGF6eXdzdWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0NzMzMTQsImV4cCI6MjA5NTA0OTMxNH0.njuDREVF4oIgTYN6wLXKw6Hw_KsFzKPoMabkld_jy0E";
const SB_HEADERS = { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" };

// Shared demo login — this specific auth user id gets a fresh cloned sandbox
// business on every sign-in instead of the normal "find my one business" flow.
const DEMO_OWNER_ID = "aeee94c4-64af-44ab-abda-7d72da38fd0b";
// Ties a cloned demo business_id to this specific browser tab/session only —
// so multiple people sharing the demo login each land in their own sandbox.
const DEMO_BIZ_SESSION_KEY = "sw_demo_biz_id";
// "Try the Cedar & Sage demo" fills this into Email; the password is never in code — shared separately.
const DEMO_EMAIL = "demo@shiftwise.app";
// The "virtual today" for demo sessions — Cedar & Sage's seeded data lives in
// June 2026, not the real live date. Used anywhere a report/filter needs a
// date anchor (flag patterns, report builder) so defaults land on real data.
const DEMO_TODAY_ANCHOR = "2026-06-17";

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

// Supabase email links (signup confirmation, password reset) send the user back
// to the app with the session in the URL hash:
//   #access_token=...&refresh_token=...&type=signup|recovery
// or, for an expired/used link, #error=...&error_description=...
function readAuthHash() {
  const h = window.location.hash.replace(/^#/, "");
  if (!h.includes("access_token") && !h.includes("error")) return null;
  const p = new URLSearchParams(h);
  if (p.get("error") || p.get("error_description")) {
    return { error: p.get("error_description") || p.get("error") };
  }
  const access_token = p.get("access_token");
  if (!access_token) return null;
  return {
    access_token,
    refresh_token: p.get("refresh_token"),
    expires_in: p.get("expires_in"),
    token_type: p.get("token_type") || "bearer",
    type: p.get("type"),
  };
}
function clearAuthHash() {
  window.history.replaceState({}, "", window.location.pathname + window.location.search);
}
async function fetchAuthUser(accessToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "apikey": SUPABASE_ANON_KEY, "Authorization": `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Link expired");
  return res.json();
}

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
    const msg = e.message || e.error || res.statusText || "";
    // Detect expired session and notify the app to sign out
    if (res.status === 401 || (res.status === 403 && /jwt|token|expired|invalid/i.test(msg))) {
      window.dispatchEvent(new CustomEvent("sw:session-expired"));
    }
    throw new Error(msg);
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
// Shift-type attribution buckets that aren't real shift types
const SHIFT_UNSCHEDULED = "__unscheduled"; // punches with no scheduled shift that day
const SHIFT_REMOVED     = "__removed";     // shifts whose type was later deleted

const fmt = v => {
  if (v == null) return "";
  const h = Math.floor(v), m = Math.round((v - h) * 60);
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const shiftHrs = s => (!s ? 0 : Math.max(0, parseFloat((s.end - s.start).toFixed(2))));
const getSunday = ds => {
  // Get day-of-week in CST using noon to avoid any midnight UTC shift
  const d = new Date(ds+"T12:00:00");
  const dowStr = new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",weekday:"short"}).format(d);
  const dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(dowStr);
  // Subtract days to get to Sunday — work in UTC to avoid DST issues
  const result = new Date(d.getTime() - dow*24*60*60*1000);
  // Format using CST to get the correct local date
  const parts = new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(result);
  const p = {}; parts.forEach(({type,value})=>{p[type]=value;});
  return `${p.year}-${p.month}-${p.day}`;
};
const APP_TZ = "America/Chicago"; // ShiftWise always operates in Central Time
const toLocalDateStr = d => {
  // Always interpret dates in Central Time regardless of browser timezone
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ,
    year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(d);
  const p = {};
  parts.forEach(({type,value}) => { p[type]=value; });
  return `${p.year}-${p.month}-${p.day}`;
};
// Central-time date + hour for a timestamp. Central's UTC offset is always a
// whole number of hours, so its hour boundaries line up with UTC's — which
// lets attribution walk a shift hour-by-hour with simple math.
const CENTRAL_DH_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", hourCycle:"h23" });
function centralDateHour(ms) {
  const p = {};
  CENTRAL_DH_FMT.formatToParts(new Date(ms)).forEach(({type,value}) => { p[type] = value; });
  return { date: `${p.year}-${p.month}-${p.day}`, hour: parseInt(p.hour, 10) % 24 };
}
const addDays = (ds,n) => { const d = new Date(ds+"T12:00:00"); d.setDate(d.getDate()+n); return toLocalDateStr(d); };
// Pairs a day's punches (in/break_in/out) into worked hours. Promoted here from
// where it used to live buried inside the Grid tab's render tree — it had no
// dependency on any tab-local state, so nesting it there just made it
// invisible to everything else in the app that also needs real hour
// calculations (like the Report Builder).
function calcActualHours(dayPunches) {
  let hrs = 0, inT = null;
  for (const p of dayPunches) {
    if (p.type==="in"||p.type==="break_in") inT = new Date(p.time);
    else if (p.type==="out" && inT) { hrs += (new Date(p.time)-inT)/3600000; inT=null; }
  }
  // Only count "still on shift" for punches from TODAY — never for historical days
  if (inT) {
    const punchDate = toLocalDateStr(inT);
    const todayDate = toLocalDateStr(new Date());
    if (punchDate === todayDate) {
      hrs += (Date.now()-inT)/3600000;
    }
    // Historical punch with no clock-out — count 0 extra, needs manual correction
  }
  return parseFloat(hrs.toFixed(2));
}
// ── SEASON (UI Batch 21) ──────────────────────────────────────────────────
// A seasonal business opens and closes on the same month/day every year.
// season = { on, open:"MM-DD", close:"MM-DD" }. A season can wrap the new
// year (e.g. open 11-01, close 02-28). When `on` is false every date is open.
const SEASON_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function isSeasonOpen(dateStr, season) {
  if (!season?.on || !season.open || !season.close || !dateStr) return true;
  const md = String(dateStr).slice(5, 10);
  return season.open <= season.close
    ? (md >= season.open && md <= season.close)
    : (md >= season.open || md <= season.close);
}
function seasonInfo(todayStr, season) {
  if (!season?.on || !season.open || !season.close) return { seasonal:false, open:true };
  const y = Number(todayStr.slice(0,4));
  const open = isSeasonOpen(todayStr, season);
  const next = (md) => { let d = `${y}-${md}`; if (d < todayStr) d = `${y+1}-${md}`; return d; };   // on/after today
  const prev = (md) => { let d = `${y}-${md}`; if (d > todayStr) d = `${y-1}-${md}`; return d; };   // on/before today
  if (open) {
    const start = prev(season.open);
    return { seasonal:true, open:true, closes: next(season.close), current:{ start, end: next(season.close) } };
  }
  const end = prev(season.close);
  let start = `${end.slice(0,4)}-${season.open}`; if (start > end) start = `${Number(end.slice(0,4))-1}-${season.open}`;
  const weeks = Math.round((new Date(end+"T12:00:00") - new Date(start+"T12:00:00")) / (7*86400000)) + 1;
  return { seasonal:true, open:false, reopens: next(season.open), last:{ start, end, weeks } };
}
const fmtLongDate = s => s ? new Date(s+"T12:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}) : "";

const weekDatesFromSunday = s => { const sun=new Date(s+"T12:00:00"); return DAYS.map((_,i)=>{ const d=new Date(sun.getTime()+i*24*60*60*1000); return d; }); };
const dl = d => { if(!d) return ""; const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return dt.toLocaleDateString("en-US",{month:"short",day:"numeric"}); };
const toInputDate = d => { const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return toLocalDateStr(dt); };

// ── REPORTING FILTERS — shared time-range engine for Sales/Labor/Forecast ──
// Every widget (stat card, trend chart, comparison, forecast) asks one of
// these for a date range or a computed result, so they all speak the same
// "language" regardless of what's displaying them.
const FILTERS = [
  { key:"yesterday",   label:"Yesterday",      kind:"history" },
  { key:"last7",       label:"Last 7 Days",    kind:"history" },
  { key:"last14",      label:"Last 14 Days",   kind:"history" },
  { key:"lastWeek",    label:"Last Week",      kind:"history" },
  { key:"thisWeek",    label:"This Week",      kind:"history" },
  { key:"lastMonth",   label:"Last Month",     kind:"history" },
  { key:"thisQuarter", label:"This Quarter",   kind:"history" },
  { key:"lastQuarter", label:"Last Quarter",   kind:"history" },
  { key:"last3mo",     label:"Last 3 Months",  kind:"history" },
  { key:"last6mo",     label:"Last 6 Months",  kind:"history" },
  { key:"allTime",     label:"All Time",       kind:"history" },
  { key:"next7",     label:"Next 7 Days",    kind:"forecast" },
  { key:"next14",    label:"Next 14 Days",   kind:"forecast" },
  { key:"next30",    label:"Next 30 Days",   kind:"forecast" },
  { key:"next60",    label:"Next 60 Days",   kind:"forecast" },
  { key:"next90",    label:"Next 90 Days",   kind:"forecast" },
];

const addMonths = (ds,n) => { const d = new Date(ds+"T12:00:00"); d.setMonth(d.getMonth()+n); return toLocalDateStr(d); };
const datesInRange = (startStr,endStr) => { const out=[]; let cur=startStr; while(cur<=endStr){ out.push(cur); cur=addDays(cur,1); } return out; };

// Returns an array of YYYY-MM-DD date strings for the given filter.
// `anchor` defaults to today, but can be set to a specific Sunday (e.g.
// payWeek) so "thisWeek" can represent whatever week is being viewed.
// Quarter bounds via pure string math (no Date-object construction from
// year/month numbers) — this file has already been bitten once by timezone
// bugs from Date-object math, so quarter boundaries stay string-based like
// the rest of the date helpers here.
function getQuarterBounds(dateStr) {
  const [y, m] = dateStr.split("-").map(Number); // m is 1-12
  const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1; // 1, 4, 7, or 10
  const start = `${y}-${String(qStartMonth).padStart(2,"0")}-01`;
  let nextQStartMonth = qStartMonth + 3, nextYear = y;
  if (nextQStartMonth > 12) { nextQStartMonth -= 12; nextYear += 1; }
  const nextStart = `${nextYear}-${String(nextQStartMonth).padStart(2,"0")}-01`;
  const end = addDays(nextStart, -1);
  return { start, end };
}

function getFilterDates(filterKey, salesData, anchor) {
  const today = anchor || toLocalDateStr(new Date());
  switch (filterKey) {
    case "yesterday": return [addDays(today,-1)];
    case "last7":     return datesInRange(addDays(today,-6), today);
    case "last14":    return datesInRange(addDays(today,-13), today);
    case "lastWeek":  return weekDatesFromSunday(addDays(getSunday(today),-7)).map(toInputDate);
    case "thisWeek":  return weekDatesFromSunday(getSunday(today)).map(toInputDate);
    case "thisQuarter": {
      const { start } = getQuarterBounds(today);
      return datesInRange(start, today); // quarter-to-date — the quarter isn't over yet
    }
    case "lastQuarter": {
      const { start: thisQStart } = getQuarterBounds(today);
      const lastQEnd = addDays(thisQStart, -1);
      const { start: lastQStart } = getQuarterBounds(lastQEnd);
      return datesInRange(lastQStart, lastQEnd); // full prior quarter
    }
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
const FORECAST_RECENT_WEEKS = 8;
// Forecast = average of the same weekday, from RECENT history so a seasonal
// business isn't averaging October against July:
//   1. the last 8 weeks before the period starts, else
//   2. the same weeks one year earlier (±1 week) — covers reopening after
//      being closed for the season, and stays $0 while closed.
// A weekday with no sales in either window forecasts $0 (normally a closed day).
function getForecast(filterKey, salesData, anchor) {
  const dates = getFilterDates(filterKey, salesData, anchor);
  const start = dates[0] || anchor || toLocalDateStr(new Date());
  const tally = (from, to) => {
    const t = [0,0,0,0,0,0,0], c = [0,0,0,0,0,0,0];
    salesData.forEach(d => {
      if (d.date < from || d.date >= to || !(d.revenue > 0)) return;
      const dow = new Date(d.date+"T12:00:00").getDay();
      t[dow] += d.revenue; c[dow] += 1;
    });
    return { t, c };
  };
  // No sales at all in the 2 weeks before the period = closed / off-season:
  // recent weeks would forecast the old season, so skip straight to last year.
  const recentlyOpen = salesData.some(d => d.date >= addDays(start, -14) && d.date < start && d.revenue > 0);
  const recent = recentlyOpen ? tally(addDays(start, -FORECAST_RECENT_WEEKS * 7), start) : { t:[0,0,0,0,0,0,0], c:[0,0,0,0,0,0,0] };
  const lyStart = addDays(start, -364); // same weekday, a year back
  const lastYear = tally(addDays(lyStart, -7), addDays(lyStart, 7 + dates.length));
  const dowBasis = [], dowAverages = [], dowCounts = [];
  for (let i = 0; i < 7; i++) {
    if (recent.c[i] >= MIN_DOW_SAMPLES) { dowAverages[i] = recent.t[i] / recent.c[i]; dowCounts[i] = recent.c[i]; dowBasis[i] = "recent"; }
    else if (lastYear.c[i] >= MIN_DOW_SAMPLES) { dowAverages[i] = lastYear.t[i] / lastYear.c[i]; dowCounts[i] = lastYear.c[i]; dowBasis[i] = "lastYear"; }
    else { dowAverages[i] = 0; dowCounts[i] = Math.max(recent.c[i], lastYear.c[i]); dowBasis[i] = (recent.c[i] || lastYear.c[i]) ? "thin" : "none"; }
  }
  // Enough data = at least one weekday has a real basis, and no weekday that
  // HAS some sales is too thin to trust. Weekdays with no sales at all are closed days.
  const hasEnoughData = dowBasis.some(b => b === "recent" || b === "lastYear") && !dowBasis.includes("thin");
  const used = new Set(dowBasis.filter(b => b === "recent" || b === "lastYear"));
  const basis = used.size === 2 ? "mixed" : used.has("recent") ? "recent" : used.has("lastYear") ? "lastYear" : null;
  const days = dates.map(date => {
    const dow = new Date(date+"T12:00:00").getDay();
    return { date, projectedRevenue: dowAverages[dow], dataPoints: dowCounts[dow], basis: dowBasis[dow] };
  });
  const total = days.reduce((s,d) => s+d.projectedRevenue, 0);
  return { filterKey, dates, days, total, hasEnoughData, dowCounts, basis };
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
  @media (min-width:768px) and (max-width:1199px) { .nav-tab-btn { padding:8px 11px !important; font-size:13px !important; } .top-bar-tabs { gap:4px !important; padding-left:0 !important; } .biz-input { width:160px !important; } }
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
.ov-wrap { display:grid; grid-template-columns:minmax(0,1fr); gap:22px; align-items:start; }
.ov-main { display:flex; flex-direction:column; gap:16px; min-width:0; }
/* UI Batch 8 — framed Overview: one bordered surface holding every section */
.ov-frame { background:#FFFFFF; border:1px solid #E6E8E4; border-radius:22px; padding:22px; box-shadow:0 1px 2px rgba(28,43,34,0.04), 0 10px 28px rgba(28,43,34,0.06); }
@media (max-width:767px) { .ov-frame { padding:14px; border-radius:16px; } }
.ov-rail { display:flex; flex-direction:column; gap:22px; padding:16px 16px 20px; border-left:1px solid #E6E8E4; position:sticky; top:66px; }
.ov-kpis { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; }
/* UI Batch 17 — every row shares the KPI 4-column grid so card edges line up */
.ov-row-2-1 { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; }
.ov-row-2-1 > :first-child { grid-column:span 3; }
.ov-row-1-1 { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; }
.ov-row-1-1 > * { grid-column:span 2; }
.ov-widgets { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
@media (max-width:1199px) {
  .ov-wrap { grid-template-columns:minmax(0,1fr); }
  .ov-row-2-1 > * { grid-column:span 4; }
  .ov-rail { position:static; border-left:none; border-top:1px solid #E6E8E4; padding:18px 2px 0; display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); }
}
@media (max-width:899px) {
  .ov-kpis { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .ov-row-2-1, .ov-row-1-1 { grid-template-columns:minmax(0,1fr); }
  .ov-row-2-1 > *, .ov-row-1-1 > * { grid-column:auto; }
}
@media (max-width:520px) {
  .ov-widgets { grid-template-columns:minmax(0,1fr); }
  .ov-widgets > * { grid-column:auto !important; }
}
@media (min-width:768px) { .bottom-nav { display:none !important; } }
@media (max-width:1024px) { .controls-bar { flex-wrap:wrap !important; } }
@media (max-width:767px) {
  .top-bar-tabs  { display:none !important; }
  .top-stats     { display:none !important; }
  .biz-input     { width:140px !important; font-size:13px !important; }
  .top-bar-inner { height:50px !important; }
  .page-pad      { padding-bottom:calc(80px + env(safe-area-inset-bottom,0px)) !important; }
  .sh-pay        { display:none !important; }
  .stat-grid { grid-template-columns:1fr 1fr !important; }
  .team-grid { grid-template-columns:1fr !important; }
  input, select, textarea { font-size:16px !important; }
  button { min-height:40px; touch-action:manipulation; }
  .controls-bar { flex-direction:column !important; gap:10px !important; }
  .controls-divider { display:none !important; }
  .sched-strip { grid-template-columns:1fr !important; gap:10px !important; }
  .rb-dd-row { grid-template-columns:1fr !important; }
  .sw-emp-cols { grid-template-columns:minmax(0,1fr) !important; }
  .sw-emp-dialog { padding:16px !important; }
  .sw-settings { grid-template-columns:minmax(0,1fr) !important; min-height:0 !important; }
  .sw-settings > * { border-right:none !important; }
  .sw-set-lvl0 .sw-set-col2, .sw-set-lvl0 .sw-set-col3,
  .sw-set-lvl1 .sw-set-col1, .sw-set-lvl1 .sw-set-col3,
  .sw-set-lvl2 .sw-set-col1, .sw-set-lvl2 .sw-set-col2 { display:none !important; }
  .sw-set-back { display:inline-flex !important; }
  .sw-set-catsub { display:block !important; }
  .sched-stat  { border-left:none !important; padding-left:0 !important; }
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

// UI Batch 10c — small range calendar for Report Builder custom dates.
// Values are "YYYY-MM-DD" strings. First tap = start, second tap = end.
function RangeCalendar({ start, end, onChange, T, anchor }) {
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const parse = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); };
  const base = start ? parse(start) : anchor ? parse(anchor) : new Date();
  const [view, setView] = useState(() => new Date(base.getFullYear(), base.getMonth(), 1));
  const y = view.getFullYear(), m = view.getMonth();
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m+1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({length:days}, (_, i) => iso(new Date(y, m, i+1)))];
  const todayIso = anchor || iso(new Date());
  const pick = d => {
    if (!start || (start && end)) onChange(d, "");
    else if (d < start) onChange(d, "");
    else onChange(start, d);
  };
  const fmt = s => s ? parse(s).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";
  const nav = { width:32, height:32, borderRadius:8, border:`1px solid ${T.border}`, background:T.surface, color:T.text, cursor:"pointer", fontSize:15, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" };
  return (
    <div style={{ border:`1px solid ${T.border}`, borderRadius:12, background:T.surface, padding:12, maxWidth:320 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
        <button type="button" aria-label="Previous month" onClick={()=>setView(new Date(y, m-1, 1))} style={nav}>‹</button>
        <div style={{ fontSize:13, fontWeight:800, color:T.text }}>{view.toLocaleDateString("en-US",{month:"long",year:"numeric"})}</div>
        <button type="button" aria-label="Next month" onClick={()=>setView(new Date(y, m+1, 1))} style={nav}>›</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,minmax(0,1fr))", gap:2, fontSize:10.5, fontWeight:700, color:T.sub, textAlign:"center", marginBottom:4 }}>
        {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => <div key={d}>{d}</div>)}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,minmax(0,1fr))", gap:2 }}>
        {cells.map((d, i) => {
          if (!d) return <div key={"b"+i}/>;
          const isEnd = d === start || d === end;
          const inRange = start && end && d > start && d < end;
          return (
            <button key={d} type="button" onClick={()=>pick(d)} aria-pressed={isEnd}
              aria-label={parse(d).toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}
              style={{ height:34, borderRadius:8, border: d===todayIso && !isEnd ? `1px solid ${T.accent}` : "1px solid transparent",
                background: isEnd ? T.accent : inRange ? T.accent+"22" : "transparent",
                color: isEnd ? "white" : T.text, fontSize:12, fontWeight: isEnd ? 800 : 600, cursor:"pointer", fontFamily:"inherit" }}>
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:10, fontSize:11.5, color:T.sub, gap:8 }}>
        <span><strong style={{color:T.text}}>{fmt(start)}</strong> – <strong style={{color:T.text}}>{fmt(end)}</strong></span>
        {(start || end) && <button type="button" onClick={()=>onChange("", "")} style={{ background:"none", border:"none", color:T.sub, fontSize:11, fontWeight:600, cursor:"pointer", textDecoration:"underline", padding:0 }}>Clear</button>}
      </div>
      {start && !end && <div style={{ fontSize:11, color:T.sub, marginTop:4 }}>Now tap an end date.</div>}
    </div>
  );
}

const SectionLabel = ({ children, T }) => (
  <div style={{ fontSize:10, fontWeight:700, color:T.sub, letterSpacing:"0.08em", marginBottom:6, textTransform:"uppercase" }}>
    {children}
  </div>
);

// Promoted to a real top-level component — it used to be defined *inside*
// the Insights tab's render function, which meant React saw a brand-new
// component type on every single re-render and fully unmounted/remounted
// it each time. That was cheap when its sparkline was plain SVG, but once
// it became a real Recharts chart (which measures its container on mount),
// the repeated remounting could cause a visible layout shift right as
// someone clicked something — including, plausibly, a nav tab underneath.
function ScoreCard({ score, scoreColor, scoreBg, history, isOpen, onToggle, T }) {
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
      <div style={{background:scoreBg(score.value), borderRadius:12, padding:"10px 15px", textAlign:"center", marginBottom:6}}>
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
            <ResponsiveContainer width="100%" height={32}>
              <RLineChart data={sparkData.map((h,i)=>({ week:i, score:h.score, isCurrent:i===sparkData.length-1 }))} margin={{top:4,right:4,left:4,bottom:0}}>
                <RTooltip
                  formatter={(v)=>`${v}`}
                  labelFormatter={()=>""}
                  contentStyle={{fontSize:10,borderRadius:6,border:`1px solid ${T.border}`,background:T.surface,padding:"3px 8px"}}
                />
                <Line type="monotone" dataKey="score" stroke="#ccc" strokeWidth={1.5}
                  dot={(props) => {
                    const isCurrent = props.payload.isCurrent;
                    return <circle key={props.index} cx={props.cx} cy={props.cy} r={isCurrent?4:2.5} fill={isCurrent?scoreColor(props.payload.score):"#ccc"} stroke="none"/>;
                  }}
                  activeDot={{ r:4 }}
                />
              </RLineChart>
            </ResponsiveContainer>
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
  const [addrLine,  setAddrLine]  = useState("");
  const [addrCity,  setAddrCity]  = useState("");
  const [addrState, setAddrState] = useState("");
  const [addrZip,   setAddrZip]   = useState("");
  const [weekStart, setWeekStart] = useState("Sunday");
  const [daysOpen,  setDaysOpen]  = useState([0,1,2,3,4,5,6]);
  // UI Batch 21 — seasonal business, same dates every year ("MM-DD")
  const [seasonOn,    setSeasonOn]    = useState(false);
  const [seasonOpen,  setSeasonOpen]  = useState("03-01");
  const [seasonClose, setSeasonClose] = useState("09-30");
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
    daysOpen.length >= 1 && !(seasonOn && seasonOpen === seasonClose),
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
        address_line:   addrLine.trim() || null,
        city:           addrCity.trim() || null,
        state:          addrState.trim().toUpperCase() || null,
        zip:            addrZip.trim() || null,
        days_open:      daysOpen,
        weekly_budget:  budgetNum > 0 ? budgetNum : null,
        seasonal:       seasonOn,
        season_open:    seasonOn ? seasonOpen : null,
        season_close:   seasonOn ? seasonClose : null,
        setup_complete: true,
      });
      let insertedEmps = [];
      if (employees.length > 0) {
        const rows = employees.map(e => ({
          business_id:  bizId,
          name:         e.name.trim(),
          role:         e.role,
          hourly_rate:  e.rate,
          color:        SETUP_AV_COLORS[employees.indexOf(e) % SETUP_AV_COLORS.length],
        }));
        insertedEmps = (await dbPost("employees", rows)) || [];
      }

      // Seed a starter example week so the Schedule tab isn't blank on first
      // landing. This is a forward-looking draft the owner can edit or clear —
      // never fabricated punch/timesheet history, since that touches real
      // employee pay records and would be a real data-integrity problem.
      let seeded = false;
      if (insertedEmps.length > 0 && daysOpen.length > 0) {
        try {
          const weekStartStr = getSunday(toLocalDateStr(new Date()));
          const weekRows = await dbUpsert("schedule_weeks", [{ business_id: bizId, week_start: weekStartStr, label: "Week" }]);
          const weekId = weekRows?.[0]?.id;
          if (weekId) {
            const shiftRows = daysOpen.map((dayIdx, i) => {
              const emp = insertedEmps[i % insertedEmps.length];
              return {
                business_id: bizId, week_id: weekId, employee_id: emp.id, day_index: dayIdx,
                start_dec: 9, end_dec: 17, shift_types: ["regular"], notes: "",
              };
            });
            await sbFetch("shifts?on_conflict=week_id,employee_id,day_index", {
              method: "POST", body: JSON.stringify(shiftRows),
              headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
            });
            seeded = true;
          }
        } catch(seedErr) { console.warn("Starter week seed failed (non-blocking):", seedErr); }
      }

      onComplete(seeded);
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
              <label className="sw-flabel" htmlFor="sw-addr-line">Business address</label>
              <input id="sw-addr-line" className="sw-input" placeholder="Street address" autoComplete="street-address"
                value={addrLine} onChange={e=>setAddrLine(e.target.value)} />
              <div style={{display:"grid",gridTemplateColumns:"minmax(0,2fr) minmax(0,1fr) minmax(0,1.2fr)",gap:8,marginTop:8}}>
                <input className="sw-input" placeholder="City" aria-label="City" autoComplete="address-level2" value={addrCity} onChange={e=>setAddrCity(e.target.value)} />
                <input className="sw-input" placeholder="State" aria-label="State" autoComplete="address-level1" maxLength={2} value={addrState} onChange={e=>setAddrState(e.target.value)} />
                <input className="sw-input" placeholder="ZIP" aria-label="ZIP code" autoComplete="postal-code" inputMode="numeric" maxLength={10} value={addrZip} onChange={e=>setAddrZip(e.target.value)} />
              </div>
              <div className="sw-fhint">Optional. ShiftWise uses it to record each day's weather automatically, so you can see how weather affects sales.</div>
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
            {(()=>{
              const daysIn = m => new Date(2024, m, 0).getDate();
              const mk = (m, d) => `${String(m).padStart(2,"0")}-${String(Math.min(d, daysIn(m))).padStart(2,"0")}`;
              const sel = { appearance:"none", WebkitAppearance:"none", height:42, border:"1.5px solid #DAD7D0", borderRadius:9, background:"#FFFFFF", padding:"0 12px", fontSize:14, fontWeight:600, color:"#1A1A1A", fontFamily:"inherit", cursor:"pointer" };
              const pick = (val, setVal, label) => {
                const m = Number(val.slice(0,2)), d = Number(val.slice(3));
                return (
                  <fieldset style={{border:"none",padding:0,margin:0,display:"flex",gap:8,alignItems:"flex-end"}}>
                    <legend style={{fontSize:12,fontWeight:700,color:"#6B6B67",marginBottom:5,padding:0}}>{label}</legend>
                    <select aria-label={`${label} month`} value={m} onChange={e=>setVal(mk(Number(e.target.value), d))} style={{...sel,width:150}}>
                      {SEASON_MONTHS.map((name,i)=><option key={name} value={i+1}>{name}</option>)}
                    </select>
                    <select aria-label={`${label} day`} value={d} onChange={e=>setVal(mk(m, Number(e.target.value)))} style={{...sel,width:80}}>
                      {Array.from({length:daysIn(m)},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}
                    </select>
                  </fieldset>
                );
              };
              return (
                <div className="sw-fgroup" style={{marginTop:18}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,padding:"14px 16px",border:"1.5px solid #E6E3DC",borderRadius:12,background:"#FFFFFF"}}>
                    <div>
                      <div style={{fontSize:14.5,fontWeight:800,color:"#1A1A1A"}}>Seasonal business?</div>
                      <div style={{fontSize:12.5,color:"#6B6B67",marginTop:2}}>Turn on if you close part of the year. Closed weeks won't drag down your numbers.</div>
                    </div>
                    <button type="button" role="switch" aria-checked={seasonOn} aria-label="Seasonal business" onClick={()=>setSeasonOn(v=>!v)}
                      style={{width:48,height:28,borderRadius:999,border:"none",background:seasonOn?"#2D6A4F":"#D5D2CB",position:"relative",cursor:"pointer",flexShrink:0,transition:"background 0.15s"}}>
                      <span style={{position:"absolute",top:3,left:seasonOn?23:3,width:22,height:22,borderRadius:999,background:"white",transition:"left 0.15s"}}/>
                    </button>
                  </div>
                  {seasonOn && (
                    <div style={{display:"flex",gap:20,flexWrap:"wrap",marginTop:12}}>
                      {pick(seasonOpen, setSeasonOpen, "Opens")}
                      {pick(seasonClose, setSeasonClose, "Closes")}
                    </div>
                  )}
                  {seasonOn && seasonOpen === seasonClose && <div style={{fontSize:12.5,color:"#A93226",marginTop:8}}>Opens and closes on the same day — pick different dates.</div>}
                  {seasonOn && <div className="sw-days-hint">Same dates every year. Change them any time in Settings → General → Season.</div>}
                </div>
              );
            })()}
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
              <div className="sw-review-row"><span className="sw-review-label">Address</span><span className="sw-review-val">{[addrLine,addrCity,[addrState.toUpperCase(),addrZip].filter(Boolean).join(" ")].filter(x=>x&&x.trim()).join(", ")||"Not set"}</span></div>
              <div className="sw-review-row"><span className="sw-review-label">Week starts</span><span className="sw-review-val">{weekStart}</span></div>
              <div className="sw-review-row"><span className="sw-review-label">Weekly budget</span><span className="sw-review-val">{budgetNum>0?fmt$(budgetNum):"Not set"}</span></div>
              <div className="sw-review-row"><span className="sw-review-label">Season</span><span className="sw-review-val">{seasonOn ? (()=>{ const md = s => `${SEASON_MONTHS[Number(s.slice(0,2))-1]} ${Number(s.slice(3))}`; return `${md(seasonOpen)} – ${md(seasonClose)} each year`; })() : "Open year-round"}</span></div>
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
function FeedbackTab({ bizId, T, Card, showToast, showError, friendlyError, addAudit, getSession, dbPost }) {
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
      showError(friendlyError(e, "Couldn't submit that feedback — try again."));
    } finally {
      setFbSaving(false);
    }
  }

  return (
    <div style={{padding:"14px 20px 20px"}}>
      <div style={{marginBottom:14}}>
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
              style={{width:"100%", border:`1.5px solid ${fbMessage.trim()?T.accent:T.border}`, borderRadius:9, padding:"10px 12px", fontSize:13, outline:"none", resize:"vertical", fontFamily:"inherit", color:T.text, background:T.surface, lineHeight:1.6, transition:"border 0.15s", boxSizing:"border-box"}}
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
  const defaultSun = useMemo(() => getSunday(toLocalDateStr(new Date())), []);

  // ── Auth state ────────────────────────────────────────────────────────────
  // Read once on first render — an email link (signup confirm / password
  // reset) may have just dropped the user back here with tokens in the hash.
  const [authHash] = useState(() => readAuthHash());
  const [authState,   setAuthState]   = useState(() => {
    if (authHash?.access_token) return authHash.type === "recovery" ? "recovery" : "loading";
    const s = getSession();
    return s?.access_token ? "loading" : "unauthenticated";
  });
  const [authEmail,   setAuthEmail]   = useState("");
  const [authPass,    setAuthPass]    = useState("");
  const [authMode,    setAuthMode]    = useState("signin");
  const [resetSent,   setResetSent]   = useState(false);
  const [authError,   setAuthError]   = useState(() =>
    authHash?.error ? `That link didn't work (${authHash.error}). Request a new one below.` : "");
  const [newPass,     setNewPass]     = useState("");
  const [newPass2,    setNewPass2]    = useState("");
  const bizCreateRef = useRef(null); // guards against creating two businesses for one new account
  const [authBizName, setAuthBizName] = useState("");
  const [showPass,    setShowPass]    = useState(false);
  const [authBusy,    setAuthBusy]    = useState(false);
  const [bizId,       setBizId]       = useState(null);
  const [isDemoBiz,   setIsDemoBiz]   = useState(false);

  // ── App state — hydrated from Supabase on load ────────────────────────────
  const [tab,         setTab]         = useState(() => {
    // A page refresh mid-session preserves whatever tab you were on via the
    // URL hash. The "always open to the scheduler" behavior belongs to the
    // actual sign-in action (see handleSignIn), not every page load.
    const hash = window.location.hash.replace("#","");
    const valid = ["grid","coverage","insights","dashboard","recognition","settings","feedback"];
    return valid.includes(hash) ? hash : "grid";
  });
  const [themeId,     setThemeId]     = useState(() => { try { const t = localStorage.getItem("sw_theme"); return t && THEMES[t] ? t : "fieldwork"; } catch { return "fieldwork"; } });
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
  const [employees,   setEmployees]    = useState([]);       // active only — everything operational uses this
  const [formerEmployees, setFormerEmployees] = useState([]); // deactivated — kept for history + exit summaries
  const allEmployees = useMemo(() => [...employees, ...formerEmployees], [employees, formerEmployees]);
  const [exitSummaries, setExitSummaries] = useState({});    // empId -> { id, summary }
  const [exitViewId,    setExitViewId]    = useState(null);
  const [formerOpen,    setFormerOpen]    = useState(false);
  const [exitBusy,      setExitBusy]      = useState(false);
  const [editEmpId,   setEditEmpId]    = useState(null);
  const [schedule,    setSchedule]     = useState({});
  const [weekMap,     setWeekMap]      = useState({});
  const [published,   setPublished]    = useState([]);
  const [historyOpen, setHistoryOpen]  = useState(false);
  const [historyPrev, setHistoryPrev]  = useState(null);
  const [openCell,    setOpenCell]     = useState(null);
  const [toast,       setToast]        = useState(null);
  const [settingsSection, setSettingsSection] = useState(null);
  const [settingsFolder,  setSettingsFolder]  = useState(null);
  const [rosterSearch,    setRosterSearch]    = useState(""); // UI Batch 18 — folder inside a Settings category
  const [recMsg,   setRecMsg]   = useState("");
  const [recTo,    setRecTo]    = useState("");
  const [recFrom,  setRecFrom]  = useState("Owner");
  const [recEmoji, setRecEmoji] = useState("⭐");
  const [recType,  setRecType]  = useState("shoutout");
  const [auditLog,   setAuditLog]   = useState([]);
  const [shiftTypes,  setShiftTypes]  = useState(DEFAULT_SHIFT_TYPES);
  const SHIFT_TYPES = shiftTypes;
  // What's currently saved in Supabase (JSON). null = not loaded yet, so
  // nothing saves before the business's own shift types have arrived.
  const shiftTypesSavedRef = useRef(null);
  const [recognition, setRecognition] = useState([]);
  const [schedView,    setSchedView]   = useState("weekly");
  const [activeDay,    setActiveDay]   = useState(() => toLocalDateStr(new Date()));
  const [actionsOpen,  setActionsOpen] = useState(false);
  const [templates,    setTemplates]   = useState([]);
  // Raw sales rows, one per day per source (square / cash). Everything that
  // needs a daily total reads salesData, which sums the sources per day — so a
  // cash entry and Square sales on the same day ADD instead of overwriting.
  const [rawSales,    setRawSales]    = useState([]);
  const salesData = useMemo(() => {
    const by = {};
    rawSales.forEach(r => {
      const d = (by[r.date] ||= { date: r.date, revenue: 0, transactions: 0, sources: [] });
      d.revenue += Number(r.revenue) || 0;
      d.transactions += Number(r.transactions) || 0;
      if (r.source && !d.sources.includes(r.source)) d.sources.push(r.source);
    });
    return Object.values(by).map(d => ({ ...d, source: d.sources.length === 1 ? d.sources[0] : "mixed" }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [rawSales]);
  // Replace every row of one source for the given dates, keep everything else
  const mergeSalesRows = (prev, source, rows) => {
    const dates = new Set(rows.map(r => r.date));
    return [...prev.filter(r => !(r.source === source && dates.has(r.date))), ...rows.map(r => ({ ...r, source }))];
  };
  const [squareConnected,    setSquareConnected]    = useState(false);
  const [squareMerchantName, setSquareMerchantName] = useState("");
  const [squareLastSync,     setSquareLastSync]     = useState(null);
  const [squareSyncing,      setSquareSyncing]      = useState(false);
  const [squareLoading,      setSquareLoading]      = useState(true);
  const [showDailyBreakdown, setShowDailyBreakdown] = useState(false);
  const [cashMode,    setCashMode]    = useState(false);
  const [cashEntries, setCashEntries] = useState({}); // { "YYYY-MM-DD": amount }
  const [laborPctMode, setLaborPctMode] = useState("projected"); // "projected" | "actual"
  // UI Batch 19 — payroll card: projected (schedule) vs actual (punches) for the Overview week
  const [payrollMode,  setPayrollMode]  = useState("projected"); // "projected" | "actual"
  const [ovPayPunches, setOvPayPunches] = useState(null);        // { week, rows, loading, error }
  const [widgets,        setWidgets]        = useState([]);
  // Break-even + week check
  const [laborTargetPct, setLaborTargetPct] = useState(30);   // businesses.labor_target_pct
  const [season, setSeason] = useState({ on:false, open:"03-01", close:"09-30" }); // businesses.seasonal / season_open / season_close
  const [bizAddress,     setBizAddress]     = useState({ line:"", city:"", state:"", zip:"" });
  const [addrDraft,      setAddrDraft]      = useState(null);   // editing copy in Settings
  const [weatherInfo,    setWeatherInfo]    = useState({ status:null, latestDate:null });
  const [costs,          setCosts]          = useState([]);   // business_costs rows
  const [costsOpen,      setCostsOpen]      = useState(false);
  const [costDraft,      setCostDraft]      = useState(null); // {id?, name, amount, kind, frequency} while adding/editing
  const [beView,         setBeView]         = useState("breakeven"); // "breakeven" | "target"
  const [beOpen,         setBeOpen]         = useState(false);       // Break-even card hidden until opened
  const [showAddWidget,  setShowAddWidget]  = useState(false);
  const [newWidget,      setNewWidget]      = useState({ data_source:"sales", time_range:"last7", display:"stat", color:null, size:"sm", show_axis:true, show_legend:true });
  const [sizeMenuFor,    setSizeMenuFor]    = useState(null); // widget id whose size picker is open, or null
  const [awOpenSection,  setAwOpenSection]  = useState({ data:true, range:false, viz:false, size:false, style:false });
  const [widgetSaving,   setWidgetSaving]   = useState(false);
  const [dragWidgetId,   setDragWidgetId]   = useState(null);
  const [dragOverWidgetId, setDragOverWidgetId] = useState(null);
  const [punches,        setPunches]        = useState([]);
const [tsWeekStart, setTsWeekStart] = useState(()=>getSunday(toLocalDateStr(new Date())));
const [coverageWeek, setCoverageWeek] = useState(()=>getSunday(toLocalDateStr(new Date())));
const [coverageDay,  setCoverageDay]  = useState(()=>toLocalDateStr(new Date()));
const [tsOpenCell, setTsOpenCell] = useState(null);
const [timesheetHistory, setTimesheetHistory] = useState([]);
const [punchReviews,   setPunchReviews]   = useState({}); // { punchId: "pending"|"reviewed"|"approved"|"rejected" }
const [alertsOpen,     setAlertsOpen]     = useState(false);
const [schedSubTab,    setSchedSubTab]    = useState("schedule"); // "schedule" | "timesheet"
const [dashSub,        setDashSub]        = useState("overview"); // Dashboard tab: "overview" | "reports"

  // ── Coverage / Open Shifts ───────────────────────────────────────────────
  // openShifts: { id, weekKey, empId, dayIdx, originalShift, reason, status, createdAt, claimedBy }
  // status: "open" | "claimed" | "covered" | "cancelled"
  // Loaded from Supabase per business (never from browser storage, which
  // isn't tied to a business and could carry another account's data over)
  const [openShifts, setOpenShifts] = useState([]);

  // ── Business Hours ────────────────────────────────────────────────────────
  // { sun:{open:"09:00",close:"17:00",closed:true}, mon:{...}, ... }
  const [businessHours, setBusinessHours] = useState({});
  const bizHoursLoadedRef = useRef(false); // true once THIS business's hours are loaded
  const bizNameRef = useRef({ id: null, name: null }); // last name saved/loaded for this business

  useEffect(() => {
    if (!bizHoursLoadedRef.current) return;
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
  // Mutually exclusive Insights-tab side panels — only one shows at a time,
  // and opening any of them hides the main Pulse content below.
  const [insightsPanel, setInsightsPanel] = useState(null); // null | "history" | "flags" | "reports" | "notif" | "prices"
  const [priceData,     setPriceData]     = useState(null); // { loading, error, changes, hasTracking }
  const [itemNames,     setItemNames]     = useState(null); // [{ key, name, units }] for the Item Sales filter
  const [rbFilterSearch, setRbFilterSearch] = useState({}); // { "source|filter": text }
  const [rbMenu,         setRbMenu]         = useState(null); // "source|fields" or "source|filterId" — the one open filter menu
  const [pulsePrompt,    setPulsePrompt]    = useState(false);

  const [notifFreq,      setNotifFreq]      = useState(() => { try { return localStorage.getItem("sw_notif_freq")||"login"; } catch { return "login"; } });
  const [notifDay,       setNotifDay]       = useState(() => { try { return localStorage.getItem("sw_notif_day")||"Monday"; } catch { return "Monday"; } });

  const [flagReportRange,   setFlagReportRange]   = useState("thisQuarter");
  const [flagReportLoading, setFlagReportLoading] = useState(false);
  const [flagReportData,    setFlagReportData]    = useState(null);


  const [rbSources,     setRbSources]     = useState({}); // { sourceId: { active, fields:[], filters:{fid:[opts]} } }
  const [rbGrouping,    setRbGrouping]    = useState(null);
  const [rbPreset,      setRbPreset]      = useState(null);
  const [rbCustomStart, setRbCustomStart] = useState("");
  const [rbCustomEnd,   setRbCustomEnd]   = useState("");
  const [rbVizType,     setRbVizType]     = useState(null);
  const [rbLoading,     setRbLoading]     = useState(false);
  const [rbResult,      setRbResult]      = useState(null); // { data, truncated }
  const [rbLineItemsOpen, setRbLineItemsOpen] = useState(false);
  const [rbFlagListOpen,  setRbFlagListOpen]  = useState(false);

  const printRef = useRef();
  // These pop-ups are written inside App so they can use its data directly.
  // Rendering them through a shell whose identity never changes stops React
  // from remounting them on every App re-render, which used to wipe whatever
  // was being typed. Each shell calls the latest version of its pop-up.
  const timePickerImpl = useRef(null);
  const TimePickerShell = useRef(function TimePickerShell() { return timePickerImpl.current ? timePickerImpl.current() : null; }).current;
  const tsCellPopupImpl = useRef(null);
  const TsCellPopupShell = useRef(function TsCellPopupShell(props) { return tsCellPopupImpl.current ? tsCellPopupImpl.current(props) : null; }).current;
  const punchRowImpl = useRef(null);
  const PunchRowShell = useRef(function PunchRowShell(props) { return punchRowImpl.current ? punchRowImpl.current(props) : null; }).current;
  const weatherMapRef = useRef({}); // date -> daily_weather row, loaded per report run

  const showToast = (msg, dur=3000, type="success") => { setToast({msg, type}); setTimeout(()=>setToast(null),dur); };
  const showError = (msg, dur=5000) => showToast(msg, dur, "error");

  // Translates raw Supabase/Postgres/network errors into plain-English messages.
  // `fallback` is what shows when the error doesn't match a known pattern —
  // always specific to the action being attempted, never a generic "error occurred".
  function friendlyError(err, fallback) {
    const raw = (err && (err.message || err.error_description || err.error || String(err))) || "";
    const msg = raw.toLowerCase();
    if (!navigator.onLine || msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network request failed")) {
      return "You're offline — this will save once you're back online.";
    }
    if (msg.includes("duplicate key") || msg.includes("already exists") || msg.includes("unique constraint")) {
      return "That already exists — try a different name or value.";
    }
    if (msg.includes("foreign key") || msg.includes("violates foreign key")) {
      return "Couldn't complete that — something it depends on may have been deleted. Try refreshing the page.";
    }
    if (msg.includes("permission denied") || msg.includes("row-level security") || msg.includes("rls") || msg.includes("jwt")) {
      return "Your session may have expired — try refreshing the page and signing in again.";
    }
    if (msg.includes("timeout") || msg.includes("timed out")) {
      return "That took too long to save — check your connection and try again.";
    }
    if (msg.includes("payload too large") || msg.includes("too large")) {
      return "That's too large to save — try a smaller file or fewer items at once.";
    }
    return fallback || "Something went wrong saving this — try again.";
  }

  async function runFlagReport(filterKey) {
    const key = filterKey || flagReportRange;
    if (!bizId) return;
    setFlagReportLoading(true);
    try {
      const dates = getFilterDates(key, salesData, isDemoBiz ? DEMO_TODAY_ANCHOR : undefined);
      const startDate = dates[0], endDate = dates[dates.length-1];
      const { rows, truncated } = await fetchPunchesForRange(bizId, startDate, endDate);
      // Saved no-shows (written nightly). Excused ones are listed but not counted.
      let noShows = [];
      try {
        noShows = (await dbGet(`attendance_events?select=*&business_id=eq.${bizId}&event_type=eq.NO_SHOW&event_date=gte.${startDate}&event_date=lte.${endDate}&order=event_date.desc`)) || [];
      } catch (e) { console.warn("No-shows unavailable:", e); }
      const noShowRows = noShows.filter(n => n.status !== "excused").map(n => ({
        id: n.id, empId: n.employee_id, empName: n.employee_name, type: "no_show", time: `${n.event_date}T12:00:00`, flags: ["NO_SHOW"],
      }));
      const stats = computeFlagPatterns([...rows, ...noShowRows]);
      setFlagReportData({ ...stats, noShows, startDate, endDate, filterKey: key, punchesScanned: rows.length, truncated });
    } catch (e) {
      showError(friendlyError(e, "Couldn't load that report — try again."));
    } finally {
      setFlagReportLoading(false);
    }
  }

  function rbActiveSourceIds() { return Object.keys(rbSources).filter(sid => rbSources[sid]?.active); }
  function rbToggleSource(sid) {
    setRbResult(null);
    setRbSources(prev => {
      const cur = prev[sid];
      if (cur?.active) return { ...prev, [sid]: { active:false, fields:[], filters:{} } };
      const activeCount = Object.values(prev).filter(s=>s?.active).length;
      if (activeCount >= 3) return prev; // cap reached, no-op
      return { ...prev, [sid]: { active:true, fields:[], filters:{} } };
    });
  }
  function rbToggleField(sid, fid) {
    setRbResult(null);
    setRbSources(prev => {
      const cur = prev[sid] || { active:true, fields:[], filters:{} };
      const fields = cur.fields.includes(fid) ? cur.fields.filter(x=>x!==fid) : [...cur.fields, fid];
      return { ...prev, [sid]: { ...cur, fields } };
    });
  }
  function rbToggleFilter(sid, fkey, val) {
    setRbResult(null);
    setRbSources(prev => {
      const cur = prev[sid] || { active:true, fields:[], filters:{} };
      const curVals = cur.filters[fkey] || [];
      const vals = curVals.includes(val) ? curVals.filter(x=>x!==val) : [...curVals, val];
      return { ...prev, [sid]: { ...cur, filters: { ...cur.filters, [fkey]: vals } } };
    });
  }
  function rbResetAll() {
    setRbSources({});
    setRbGrouping(null);
    setRbPreset(null);
    setRbCustomStart(""); setRbCustomEnd("");
    setRbVizType(null);
    setRbResult(null);
    setRbLineItemsOpen(false);
    setRbMenu(null);
  }
  // Report Builder selections never carry over — leaving the panel any way
  // (X button, toggling it off, or switching straight to History/Flag
  // Patterns/notifications) resets it, so reopening always starts blank.
  const rbOpen = tab === "dashboard" && dashSub === "reports";
  useEffect(() => { if (!rbOpen) rbResetAll(); }, [rbOpen]);
  useEffect(() => {
    if (!rbOpen || itemNames || !bizId) return;
    dbGet(`sales_item_names?select=item_key,item_name,units&business_id=eq.${bizId}&order=units.desc&limit=1000`)
      .then(rows => setItemNames((rows||[]).map(r => ({ key: r.item_key, name: r.item_name || "Item", units: Number(r.units)||0 }))))
      .catch(e => { console.warn("Item list unavailable:", e); setItemNames([]); });
  }, [rbOpen, bizId]);

  async function runCustomReportUI() {
    const activeIds = rbActiveSourceIds();
    const anyFields = activeIds.some(sid => (rbSources[sid]?.fields||[]).length > 0);
    const missing = [];
    if (activeIds.length === 0 || !anyFields) missing.push("at least one field");
    if (!rbGrouping) missing.push("a grouping");
    if (!rbPreset) missing.push("a date range");
    else if (rbPreset === "custom" && (!rbCustomStart || !rbCustomEnd)) missing.push("both custom dates");
    if (!rbVizType) missing.push("a visualization type");
    if (missing.length) { showToast("Still needed: " + missing.join(", ")); return; }

    // Combos that can't produce rows still "run" — they return 0 results with the reason.
    let noResultReason = null;
    if (rbGrouping === "Employee" && activeIds.some(sid => sid !== "timesheet" && sid !== "laborcost" && sid !== "flags")) {
      noResultReason = "Only Timesheet, Flags & No-Shows, and Labor Cost can be grouped by Employee.";
    } else if (activeIds.includes("weather") && ["Employee","Shift Type","Item","Flag Type"].includes(rbGrouping)) {
      noResultReason = "Weather can only be grouped by Day, Week, or Day of Week.";
    } else if (rbGrouping === "Item" && activeIds.some(sid => sid !== "itemsales")) {
      noResultReason = "Only Item Sales can be grouped by Item.";
    } else if (rbGrouping === "Shift Type" && activeIds.some(sid => sid !== "shifttypes")) {
      noResultReason = "Only Shift Types can be grouped by Shift Type.";
    } else if (rbGrouping === "Flag Type" && activeIds.some(sid => sid !== "timesheet" && sid !== "flags")) {
      noResultReason = "Only Timesheet & Punches and Flags & No-Shows can be grouped by Flag Type.";
    }

    let startDate, endDate;
    if (rbPreset === "custom") {
      startDate = rbCustomStart; endDate = rbCustomEnd;
    } else {
      const dates = getFilterDates(rbPreset, salesData, isDemoBiz ? DEMO_TODAY_ANCHOR : undefined);
      startDate = dates[0]; endDate = dates[dates.length-1];
    }
    if (noResultReason) { setRbResult({ data: [], truncated: false, startDate, endDate, emptyReason: noResultReason }); return; }
    setRbLoading(true);
    try {
      const sourceFilters = {};
      activeIds.forEach(sid => { sourceFilters[sid] = rbSources[sid]?.filters || {}; });
      const sourceFields = {};
      activeIds.forEach(sid => { sourceFields[sid] = rbSources[sid]?.fields || []; });
      const result = await runCustomReport(activeIds, sourceFields, sourceFilters, rbGrouping, startDate, endDate);
      setRbResult({ ...result, startDate, endDate });
    } catch (e) {
      showError(friendlyError(e, "Couldn't run that report — try again."));
    } finally {
      setRbLoading(false);
    }
  }

  function rbActiveFieldKeys() {
    const keys = [];
    rbActiveSourceIds().forEach(sid => {
      (rbSources[sid]?.fields||[]).forEach(fid => {
        const fieldDef = REPORT_SOURCES[sid].fields.find(f=>f.id===fid);
        keys.push({ key:`${sid}__${fid}`, label: fieldDef?.label || fid, color: REPORT_SOURCES[sid].color, text: !!fieldDef?.text });
      });
    });
    return keys;
  }

  function rbExportFlagDetailsCSV() {
    const rows = rbResult?.details || [];
    if (!rows.length) return;
    const esc = v => `"${String(v ?? "").replace(/"/g,'""')}"`;
    const csv = [["Date","Time","Employee","Flag","Punch","Review"].join(","),
      ...rows.map(d => [d.date, d.time, d.empName, d.flagLabel, d.punchType, d.review].map(esc).join(","))].join("\n");
    const blob = new Blob([csv], { type:"text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `shiftwise-flags-${rbResult.startDate}-to-${rbResult.endDate}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function rbExportCSV() {
    if (!rbResult?.data?.length) return;
    const fieldKeys = rbActiveFieldKeys();
    const header = [rbGrouping, ...fieldKeys.map(f=>f.label)];
    const lines = [header.join(",")];
    rbResult.data.forEach(row => {
      const vals = [row.label, ...fieldKeys.map(f => row[f.key] ?? "")];
      lines.push(vals.map(v => `"${String(v).replace(/"/g,'""')}"`).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `report_${rbResult.startDate}_${rbResult.endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AUTH FUNCTIONS
  // ─────────────────────────────────────────────────────────────────────────

  // Resolves this tab's demo sandbox business_id — reusing the cached one if
  // it still exists, or cloning a fresh one if it's missing/stale (e.g. was
  // already destroyed by a prior idle-timeout/logout but sessionStorage still
  // remembers it). This makes demo sign-in self-healing rather than failing.
  async function resolveDemoBusinessId() {
    let demoBizId = sessionStorage.getItem(DEMO_BIZ_SESSION_KEY);
    if (demoBizId) {
      // Check the sandbox actually completed cloning, not just that the
      // business row exists — a clone that failed partway through (e.g.
      // the employees insert step erroring) still leaves a real businesses
      // row behind, which would otherwise pass this check and get reused
      // forever as a broken, empty sandbox.
      const empRows = await dbGet(`employees?select=id&business_id=eq.${demoBizId}&limit=1`);
      if (!empRows?.[0]) demoBizId = null; // incomplete/stale — clone fresh below
    }
    if (!demoBizId) {
      const cloneRes = await fetch("/api/demo-login", { method: "POST" });
      const cloneData = await cloneRes.json();
      if (!cloneRes.ok || !cloneData.business_id) {
        throw new Error(cloneData.error || "Could not create demo sandbox");
      }
      demoBizId = cloneData.business_id;
      sessionStorage.setItem(DEMO_BIZ_SESSION_KEY, demoBizId);
    }
    return demoBizId;
  }

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
      setTab("grid"); // signing in always lands on the scheduler, regardless of whatever tab was open last session
      setAuthState("loading");

      if (data.user?.id === DEMO_OWNER_ID) {
        const demoBizId = await resolveDemoBusinessId();
        await loadAllData(demoBizId);
      } else {
        await loadAllData();
      }
    } catch(err) {
      setAuthError(err.message);
      setAuthState("unauthenticated");
    }
  }

  async function handleSignUp(e) {
    if(e?.preventDefault) e.preventDefault();
    setAuthError("");
    if (!authBizName.trim()) { setAuthError("Enter your business name"); return; }
    try {
      // Business name rides along on the auth user's metadata. That way the
      // business row can be created on first sign-in even when email
      // confirmation means signup itself returns no session.
      const res = await fetch(`${SUPABASE_URL}/auth/v1/signup?redirect_to=${encodeURIComponent(window.location.origin)}`, {
        method:"POST", headers:{...SB_HEADERS},
        body:JSON.stringify({email:authEmail, password:authPass, data:{ business_name: authBizName.trim() }}),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error_description || data.error || "Sign up failed");
      if (!data.access_token) {
        setAuthError("Check your email to confirm your account, then sign in.");
        return;
      }
      saveSession(data);
      // Business record is created by loadAllData() on first load
      setTab("grid");
      setAuthState("loading");
      await loadAllData();
    } catch(err) { setAuthError(err.message); }
  }

  async function handleForgotPassword(e) {
    if(e?.preventDefault) e.preventDefault();
    setAuthError("");
    if (!authEmail.trim()) { setAuthError("Enter your email address first."); return; }
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(window.location.origin)}`, {
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

  // Second half of password reset — the user arrived from the reset email
  // with a short-lived recovery token and now picks a new password.
  async function handleSetNewPassword(e) {
    if(e?.preventDefault) e.preventDefault();
    setAuthError("");
    if (newPass.length < 6) { setAuthError("Password must be at least 6 characters."); return; }
    if (newPass !== newPass2) { setAuthError("Passwords don't match."); return; }
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method:"PUT",
        headers:{ "apikey": SUPABASE_ANON_KEY, "Content-Type":"application/json", "Authorization":`Bearer ${authHash.access_token}` },
        body:JSON.stringify({ password: newPass }),
      });
      const data = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(data.msg || data.error_description || data.message || "Couldn't update your password.");
      saveSession({ ...authHash, user: data });
      setNewPass(""); setNewPass2("");
      setTab("grid");
      setAuthState("loading");
      if (data?.id === DEMO_OWNER_ID) {
        await loadAllData(await resolveDemoBusinessId());
      } else {
        await loadAllData();
      }
      showToast("Password updated ✓");
    } catch(err) {
      setAuthError(/expired|invalid|jwt/i.test(err.message)
        ? "This reset link has expired. Request a new one below."
        : err.message);
    }
  }

  // Clears everything tied to a business, so nothing from one account (or the
  // demo) can carry into the next sign-in — on screen or into a save.
  function resetBusinessState() {
    bizHoursLoadedRef.current = false;
    bizNameRef.current = { id: null, name: null };
    shiftTypesSavedRef.current = null;
    setBizId(null); setBiz("My Business"); setIsDemoBiz(false);
    setEmployees([]); setFormerEmployees([]); setExitSummaries({}); setExitViewId(null);
    setSchedule({}); setWeekMap({}); setOpenShifts([]); setBusinessHours({});
    setRawSales([]); setCashEntries({}); setPunches([]); setPunchReviews({});
    setPublished([]); setAuditLog([]); setRecognition([]); setTemplates([]); setTimesheetHistory([]);
    setWidgets([]); setCosts([]); setShiftTypes(DEFAULT_SHIFT_TYPES);
    setInsight(null); setPulseHistory([]); setFlagReportData(null); setPriceData(null); setItemNames(null);
    setSquareConnected(false); setSquareMerchantName(""); setSquareLastSync(null);
    setBizAddress({ line:"", city:"", state:"", zip:"" }); setAddrDraft(null); setWeatherInfo({ status:null, latestDate:null });
    setLaborTargetPct(30);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  async function handleSignOut() {
    const s = getSession();
    if (s?.user?.id === DEMO_OWNER_ID) {
      const demoBizId = sessionStorage.getItem(DEMO_BIZ_SESSION_KEY);
      if (demoBizId) {
        // Best-effort destroy — don't block sign-out on this if it fails;
        // the idle-timeout/cron backup catches anything left behind.
        try {
          await fetch("/api/demo-logout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ business_id: demoBizId }),
          });
        } catch (e) { console.warn("Demo sandbox cleanup failed:", e); }
        sessionStorage.removeItem(DEMO_BIZ_SESSION_KEY);
      }
    }
    clearSession();
    setAuthState("unauthenticated");
    resetBusinessState();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DATA LOADING — single function hydrates all app state from Supabase
  // Supabase swap point: replace each dbGet call with your preferred client
  // ─────────────────────────────────────────────────────────────────────────
  async function loadAllData(forcedBusinessId) {
    resetBusinessState();
    try {
      // 1. Get business record.
      // Demo sessions pass forcedBusinessId directly (their specific cloned
      // sandbox) since every demo clone shares the same owner_id — the normal
      // "first business I own" query below would otherwise always return the
      // oldest demo clone ever created, not this session's fresh one.
      let business;
      if (forcedBusinessId) {
        const rows = await dbGet(`businesses?select=*&id=eq.${forcedBusinessId}&limit=1`);
        business = rows?.[0];
      } else {
        const bizRows = await dbGet("businesses?select=*&order=created_at.asc&limit=1");
        business = bizRows?.[0];
      }
      if (!business && !forcedBusinessId) {
        // Brand-new account signing in for the first time (e.g. right after
        // confirming their email) — create their business now. setup_complete
        // is set explicitly so new accounts always go through onboarding,
        // regardless of the column's database default.
        const u = getSession()?.user;
        if (u?.id && u.id !== DEMO_OWNER_ID) {
          if (!bizCreateRef.current) {
            bizCreateRef.current = dbPost("businesses", {
              owner_id: u.id,
              name: (u.user_metadata?.business_name || "").trim() || "My Business",
              setup_complete: false,
            });
          }
          const created = await bizCreateRef.current;
          business = created?.[0];
        }
      }
      if (!business) {
        setAuthError("Couldn't load your business — try signing in again.");
        setAuthState("unauthenticated"); clearSession(); return;
      }

      setBizId(business.id);
      setBiz(business.name ?? "My Business");
      bizNameRef.current = { id: business.id, name: business.name ?? "My Business" };
      setSetupComplete(business.setup_complete ?? true);
      setDaysOpen(business.days_open ?? [0,1,2,3,4,5,6]);
      setWeeklyBudget(business.weekly_budget ?? null);
      if (business.cash_mode) setCashMode(true);
      setLaborTargetPct(Number(business.labor_target_pct) > 0 ? Number(business.labor_target_pct) : 30);
      setSeason({ on: !!business.seasonal, open: business.season_open || "03-01", close: business.season_close || "09-30" });
      setBizAddress({ line: business.address_line || "", city: business.city || "", state: business.state || "", zip: business.zip || "" });
      setAddrDraft(null);
      {
        let latestDate = null;
        try {
          const w = await dbGet(`daily_weather?select=weather_date&business_id=eq.${business.id}&order=weather_date.desc&limit=1`);
          latestDate = w?.[0]?.weather_date || null;
        } catch {}
        setWeatherInfo({ status: business.geocode_status || null, latestDate });
      }
      try {
        const costRows = await dbGet(`business_costs?select=*&business_id=eq.${business.id}&order=sort_order.asc,created_at.asc`);
        setCosts(costRows || []);
      } catch (e) { console.warn("Costs load failed:", e); setCosts([]); }

      setIsDemoBiz(!!business.is_demo);

      if (business.is_demo) {
        // Cedar & Sage's seeded data lives in June 2026, not the real live
        // date. Without this, every "current week" default (Coverage,
        // Timesheet, Pulse) points at an empty real-world week and shows
        // nothing. June 14 is the seeded "current reference" week.
        // (wk1Start/activeWeek/printWeek are handled below in the existing
        // "always default to current week" block, which is also demo-aware.)
        const DEMO_CURRENT_WEEK = "2026-06-14";
        const DEMO_TODAY = "2026-06-17"; // a Wednesday inside that week
        setWk2Start(addDays(DEMO_CURRENT_WEEK, 7));
        setPayWeek(DEMO_CURRENT_WEEK);
        setActiveDay(DEMO_TODAY);
        setTsWeekStart(DEMO_CURRENT_WEEK);
        setCoverageWeek(DEMO_CURRENT_WEEK);
        setCoverageDay(DEMO_TODAY);
      }

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
        const todaySun = business.is_demo ? "2026-06-14" : getSunday(toLocalDateStr(new Date()));
        setWk1Start(todaySun);
        setActiveWeek(todaySun);
        setPrintWeek(todaySun);
        setWeekMode("1");
      }

      // 6. Transform employees
      const mappedEmps = (empRows||[]).map(e => ({
        id:             e.id,
        name:           e.name,
        role:           e.role,
        hourlyRate:     String(e.hourly_rate || ""),
        color:          e.color,
        pin:            e.pin,
        availableDays:  e.available_days || [0,1,2,3,4,5,6],
        availableHours: String(e.available_hours || "40"),
        notes:          e.notes,
        phone:          e.phone || "",
        status:         e.status || "active",
        exitedAt:       e.exited_at || null,
        exitReason:     e.exit_reason || "",
        createdAt:      e.created_at || null,
      }));
      setEmployees(mappedEmps.filter(e => e.status !== "inactive"));
      setFormerEmployees(mappedEmps.filter(e => e.status === "inactive").sort((a,b) => (b.exitedAt||"").localeCompare(a.exitedAt||"")));
      try {
        const exitRows = await dbGet(`employee_exits?select=*&business_id=eq.${business.id}&order=created_at.asc`);
        const map = {};
        (exitRows||[]).forEach(r => { if (r.employee_id) map[r.employee_id] = { id: r.id, summary: r.summary }; });
        setExitSummaries(map);
      } catch (e) { console.warn("Exit summaries load failed:", e); setExitSummaries({}); }

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
      const loadedTypes = (shiftTypeRows||[]).length > 0
        ? (shiftTypeRows||[]).map(r => ({ id:r.type_id, label:r.label, color:r.color }))
        : DEFAULT_SHIFT_TYPES;
      // No saved rows yet → baseline "" so the defaults get saved once.
      shiftTypesSavedRef.current = (shiftTypeRows||[]).length > 0 ? JSON.stringify(loadedTypes) : "";
      setShiftTypes(loadedTypes);

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
      bizHoursLoadedRef.current = true;

      // 10. Other state
      setRawSales((salesRows||[]).map(r=>({ date:r.sale_date, revenue:parseFloat(r.revenue), transactions:r.transactions, source:r.source || "square" })));
      // Load cash entries (source='cash') separately into cashEntries map
      const cashRows = (salesRows||[]).filter(r=>r.source==='cash');
      if (cashRows.length > 0) {
        const map = {};
        cashRows.forEach(r=>{ map[r.sale_date] = parseFloat(r.revenue); });
        setCashEntries(map);
      }
      setRecognition((recRows||[]).map(r=>({ id:r.id, at:r.created_at, type:r.rec_type, emoji:r.emoji, message:r.message, fromName:r.from_name, toName:r.to_name, toId:r.to_id })));
      setPunches((punchRows||[]).map(r=>({ id:r.id, empId:r.employee_id, empName:r.employee_name, type:r.punch_type, time:r.punched_at?.replace(" ", "T").replace("+00","Z") ?? null, scheduled:r.scheduled_start?{start:parseFloat(r.scheduled_start),end:parseFloat(r.scheduled_end)}:null, flags:r.flags||[] })));
      setOpenShifts((openShiftRows||[]).map(r=>({ id:r.id, weekKey:wks.find(w=>w.id===r.week_id)?.week_start||r.week_id, empId:r.employee_id, dayIdx:r.day_index, originalShift:r.shift_start?{start:parseFloat(r.shift_start),end:parseFloat(r.shift_end)}:null, reason:r.reason, status:r.status, claimedBy:r.claimed_by, createdAt:r.created_at })));
      try {
        const lockRows = await dbGet(`timesheet_locks?select=*&business_id=eq.${business.id}&order=locked_at.desc`);
        setTimesheetHistory((lockRows||[]).map(r => ({ ...(r.snapshot || {}), id: r.id, savedAt: r.locked_at || r.snapshot?.savedAt })));
      } catch (e) { console.warn("Locked timesheets load failed:", e); }
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
          : friendlyError(err, "Couldn't load your data. Try refreshing the page — if that doesn't work, sign out and back in.")
      );
      if (isExpired) clearSession();
      setAuthState("unauthenticated");
    }
  }

  // Save shift type edits (rename, recolor, add, delete, reorder) to Supabase.
  // Debounced so typing a new name doesn't fire a save per keystroke.
  useEffect(() => {
    if (!bizId || shiftTypesSavedRef.current === null) return;
    const json = JSON.stringify(shiftTypes);
    if (json === shiftTypesSavedRef.current) return;
    const timer = setTimeout(async () => {
      try {
        const rows = shiftTypes.map((st, i) => ({ business_id: bizId, type_id: st.id, label: st.label, color: st.color, sort_order: i }));
        if (rows.length) {
          await sbFetch("shift_types?on_conflict=business_id,type_id", {
            method: "POST", body: JSON.stringify(rows),
            headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
          });
        }
        const keepIds = shiftTypes.map(st => st.id).join(",");
        await dbDelete(`shift_types?business_id=eq.${bizId}` + (keepIds ? `&type_id=not.in.(${keepIds})` : ""));
        shiftTypesSavedRef.current = json;
      } catch (e) {
        console.warn("Shift type save failed:", e);
        showError(friendlyError(e, "Shift type changes didn't save — try again."));
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [shiftTypes, bizId]);

  // Auto-load on mount if session exists
  useEffect(() => {
    if (authHash) clearAuthHash(); // don't leave tokens sitting in the address bar
    if (authState !== "loading") return;
    (async () => {
      // Arrived from the signup confirmation email — turn the link's tokens
      // into a saved session so the user is signed in straight away.
      if (authHash?.access_token) {
        try {
          const user = await fetchAuthUser(authHash.access_token);
          saveSession({ ...authHash, user });
        } catch {
          clearSession();
          setAuthError("That link has expired — sign in below.");
          setAuthState("unauthenticated");
          return;
        }
      }
      const s = getSession();
      if (s?.user?.id === DEMO_OWNER_ID) {
        // Demo user refreshing the tab: reuse this tab's already-cloned
        // sandbox, or clone a fresh one if it's missing/stale — rather than
        // the normal owner_id lookup (which would grab the oldest demo clone
        // across every tab, not this one's).
        resolveDemoBusinessId()
          .then(demoBizId => loadAllData(demoBizId))
          .catch(() => { clearSession(); setAuthState("unauthenticated"); });
      } else {
        loadAllData();
      }
    })();
  }, []);

  // ── Demo sandbox cleanup backstop ──────────────────────────────────────
  // handleSignOut (explicit logout) is the primary reset trigger. An idle
  // timer catches people who walk away without signing out. A daily Vercel
  // Cron job (api/demo-cleanup.js) catches everything else — anyone who
  // just closes the tab, whose heartbeat (below) simply stops updating.
  //
  // NOTE: a client-side "destroy on tab close" hook (pagehide/beforeunload)
  // was tried here and removed — pagehide fires on ordinary page refresh as
  // well as actual tab close, with no reliable way to tell them apart. That
  // meant refreshing the page silently destroyed the live sandbox while
  // sessionStorage still pointed at it, bouncing the user back to login.
  useEffect(() => {
    const s = getSession();
    if (authState !== "authenticated" || s?.user?.id !== DEMO_OWNER_ID) return;

    const IDLE_LIMIT_MS = 15 * 60 * 1000; // 15 minutes
    let idleTimer;

    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        handleSignOut();
      }, IDLE_LIMIT_MS);
    };

    const activityEvents = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    activityEvents.forEach(evt => window.addEventListener(evt, resetIdleTimer));
    resetIdleTimer();

    return () => {
      clearTimeout(idleTimer);
      activityEvents.forEach(evt => window.removeEventListener(evt, resetIdleTimer));
    };
  }, [authState]);

  // Heartbeat: tells the server this demo sandbox is still actively being
  // viewed. Stops the moment the tab closes (nothing left to run the
  // interval) — the daily cron job treats a stale heartbeat as "abandoned"
  // and cleans it up, without needing the browser to say goodbye.
  useEffect(() => {
    const s = getSession();
    if (authState !== "authenticated" || s?.user?.id !== DEMO_OWNER_ID || !bizId) return;

    const HEARTBEAT_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes
    const sendHeartbeat = () => {
      fetch("/api/demo-heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: bizId }),
      }).catch(() => {}); // best-effort — a missed beat just means slightly earlier cleanup eligibility
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);

  }, [authState, bizId]);
  useEffect(() => {
    if (authState !== "authenticated") return;
    const current = window.location.hash.replace("#","");
    if (current !== tab) {
      window.history.pushState({ tab }, "", `#${tab}`);
    }
  }, [tab, authState]);

  // Listen for browser back/forward
  useEffect(() => {
    const onPop = (e) => {
      const valid = ["grid","coverage","insights","dashboard","recognition","settings","feedback"];
      const t = e.state?.tab || window.location.hash.replace("#","");
      if (valid.includes(t)) setTab(t);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Periodic session check — every 5 minutes verify token is still valid
  useEffect(() => {
    if (authState !== "authenticated") return;
    const interval = setInterval(async () => {
      try {
        const session = getSession();
        if (!session?.access_token) {
          window.dispatchEvent(new CustomEvent("sw:session-expired"));
          return;
        }
        // Light check — just ping a small endpoint
        const res = await fetch(`${SUPABASE_URL}/rest/v1/businesses?select=id&limit=1`, {
          headers: { ...SB_HEADERS, Authorization: `Bearer ${session.access_token}` }
        });
        if (res.status === 401 || res.status === 403) {
          window.dispatchEvent(new CustomEvent("sw:session-expired"));
        }
      } catch {}
    }, 5 * 60 * 1000); // every 5 minutes
    return () => clearInterval(interval);
  }, [authState]);

  // Listen for session expiry from sbFetch and auto sign-out
  useEffect(() => {
    const handleExpired = () => {
      clearSession();
      setAuthState("unauthenticated");
      setAuthError("You were signed out due to inactivity. Please sign in again.");
      resetBusinessState();
    };
    window.addEventListener("sw:session-expired", handleExpired);
    return () => window.removeEventListener("sw:session-expired", handleExpired);
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
          setPulsePrompt(true);
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
    const today = isDemoBiz ? new Date(DEMO_TODAY_ANCHOR+"T12:00:00") : new Date();
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

    // ── Budget burn — scheduled labor vs budget for the week ─────────────────
    // The scheduled labor IS the full-week commitment — no extrapolation needed.
    // What matters: total scheduled labor vs budget, and how much of the week has passed.
    const budget = parseFloat(weeklyBudget) || null;
    let budgetBurn = null;
    if (budget && weekSummaries[0]) {
      const wk0 = weekSummaries[0];
      const wkDates0 = weeks[0]?.dates.map(d => {
        const dt = typeof d === "string" ? new Date(d+"T00:00:00") : d;
        return toLocalDateStr(dt);
      }) || [];
      const todayIdx0 = wkDates0.indexOf(todayStr);
      const daysPassed  = todayIdx0 >= 0 ? todayIdx0 + 1 : 7;
      const daysInWeek  = 7;
      const totalScheduled = wk0.totalEstimatedPay;
      const overBy = parseFloat((totalScheduled - budget).toFixed(2));
      // Labor committed so far = sum of scheduled shifts on days that have already occurred
      const laborToDate = wk0.dailyTotals
        ? wk0.dailyTotals.slice(0, daysPassed).reduce((s,d) => s + (d.totalHours || 0) * 0, 0)
        : 0;
      budgetBurn = {
        spent:         totalScheduled,           // full week scheduled labor
        budget,
        projectedEnd:  totalScheduled,           // no projection needed — this IS the commitment
        projectedOver: totalScheduled > budget,
        overBy:        overBy > 0 ? overBy : 0,
        pct:           parseFloat(((totalScheduled / budget) * 100).toFixed(1)),
        daysPassed,
        daysInWeek,
        weekPct:       parseFloat(((daysPassed / daysInWeek) * 100).toFixed(0)),
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
      squareConnected: !!squareConnected,
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
      laborTargetPct: laborTargetPct || 30,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AI INSIGHT GENERATOR — calls Claude with the business snapshot.
  // The prompt and API call are data-source agnostic.
  // ─────────────────────────────────────────────────────────────────────────
  async function generateInsight(fromNotification=false) {
    if (insightLoading) return;
    if (!seasonNow.open) return; // UI Batch 22 — Pulse pauses while closed for the season
    setInsightLoading(true);
    setInsightError(null);

    // Small delay so the loading skeleton renders before heavy computation
    setTimeout(async () => {
      try {
        const snapshot = buildBusinessSnapshot();
        // Shift Type Efficiency: this Pulse week for the card, the last 28
        // days for the trim suggestion (needs a pattern, not one bad night).
        try {
          const wkEndFull = addDays(wk1Start, 6);
          const wkEnd = wkEndFull < demoToday ? wkEndFull : demoToday;
          if (wk1Start <= wkEnd) {
            const [wkAttr, trendAttr] = await Promise.all([
              computeShiftTypeAttribution(wk1Start, wkEnd),
              computeShiftTypeAttribution(addDays(demoToday, -27), demoToday),
            ]);
            const rows = summarizeShiftTypes(wkAttr);
            const worst = rows.find(r => r.status === "over");
            snapshot.shiftTypeAttribution = {
              rows,
              uncovered: Object.values(wkAttr.uncoveredByDate).reduce((s,v)=>s+v,0),
              matchedRevenue: wkAttr.matchedRevenue,
              estimatedRevenue: wkAttr.estimatedRevenue,
              trim: worst ? shiftTypeTrimSuggestion(trendAttr, worst.key) : null,
              trimHasHourly: trendAttr.hasHourly,
            };
          }
        } catch (e) { console.warn("Shift type attribution failed (Pulse continues without it):", e); }
        const result   = computePulse(snapshot);
        const now = new Date().toISOString();
        const weekStart = wk1Start;
        setInsight({ ...result, generatedAt: now, snapshot });
        // Save score to pulse_history
        // Only save to history when triggered from the scheduled notification — not manual runs
        if (bizId && fromNotification) {
          try {
            const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/pulse_history?on_conflict=business_id,week_start`, {
              method: "POST",
              headers: { ...SB_HEADERS, Authorization: `Bearer ${getToken()}`, Prefer: "resolution=merge-duplicates,return=minimal" },
              body: JSON.stringify({ business_id: bizId, score: result.score.value, label: result.score.label, week_start: weekStart, generated_at: now })
            });
            if (!saveRes.ok) {
              const saveText = await saveRes.text();
              console.warn("pulse_history save failed:", saveRes.status, saveText);
            }
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
    // Why there's no sales this week decides the wording everywhere below:
    //  "none"      — no sales source at all (Square not connected, no CSV/cash)
    //  "unsynced"  — Square connected but nothing has synced yet
    //  "quietWeek" — sales history exists, just none in this week (closed, off-season, early in the week)
    const salesGap = hasSales ? null
      : !snap.hasSalesData ? (snap.squareConnected ? "unsynced" : "none")
      : "quietWeek";
    if (salesGap === "none") score -= 3; // only penalize a missing sales source, not a quiet week

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

    // ── Pulse narrative — specific numbers and names from this week ──────────
    const sentences = [];

    // Pre-compute weekly specifics for richer narrative
    const salesDays   = hasSales ? (wk.dailyTotals||[]).filter(d=>d.revenue&&d.totalHours>0).sort((a,b)=>b.revenue-a.revenue) : [];
    const rplhDays    = hasSales ? (wk.dailyTotals||[]).filter(d=>d.revenuePerLaborHour&&d.totalHours>0) : [];
    const bestRplhDay = rplhDays.reduce((b,d)=>(!b||d.revenuePerLaborHour>b.revenuePerLaborHour)?d:b, null);
    const worstRplhDay= rplhDays.reduce((w,d)=>(!w||d.revenuePerLaborHour<w.revenuePerLaborHour)?d:w, null);
    const topSalesDay = salesDays[0];
    // Lowest-revenue day of the week worked, for the "focus" narrative below.
    // (Was previously referenced but never declared — a stale comment claimed
    // it was "already declared above," causing a ReferenceError once real
    // sales data actually reached this code path.)
    const bottomSalesDay = salesDays.length > 1 ? salesDays[salesDays.length - 1] : null;
    const empBreakdown = wk.employeeBreakdown || [];
    const topHrsEmp   = [...empBreakdown].sort((a,b)=>b.scheduledHours-a.scheduledHours)[0];
    const runway      = budget ? budget - totalPay : 0;
    const weekLabel   = snap.weeks?.[0]?.label || "this week";
    const dayName     = snap.dayOfWeek || "today";

    // Sentence 1 — labor cost with employee breakdown context
    if (budget) {
      if (totalPay > budget) {
        const overAmt = totalPay - budget;
        const overPct = Math.round((overAmt/budget)*100);
        sentences.push(`${weekLabel}: scheduled labor is ${$$(totalPay)} — ${$$(overAmt)} (${overPct}%) over your ${$$(budget)} budget.${topHrsEmp ? ` ${topHrsEmp.name} carries the most hours at ${hrs(topHrsEmp.scheduledHours)} this week.` : ""}`);
      } else {
        const usedPct = Math.round((totalPay/budget)*100);
        sentences.push(`${weekLabel}: ${$$(totalPay)} in scheduled labor (${usedPct}% of your ${$$(budget)} budget) across ${staffed} employee${staffed!==1?"s":""} totaling ${hrs(totalHrs)}.${topHrsEmp ? ` ${topHrsEmp.name} leads with ${hrs(topHrsEmp.scheduledHours)}.` : ""}`);
      }
    } else if (totalHrs > 0) {
      sentences.push(`${weekLabel}: ${hrs(totalHrs)} scheduled across ${staffed} of ${empCount} employee${empCount!==1?"s":""}, estimated at ${$$(totalPay)}.${topHrsEmp ? ` ${topHrsEmp.name} has the most hours at ${hrs(topHrsEmp.scheduledHours)}.` : ""}`);
    } else {
      sentences.push(`No shifts are scheduled yet for ${weekLabel}.`);
    }

    // Sentence 2 — revenue efficiency with specific day data
    if (hasSales && rplh && bestRplhDay && worstRplhDay && bestRplhDay.day !== worstRplhDay.day) {
      const spread = bestRplhDay.revenuePerLaborHour - worstRplhDay.revenuePerLaborHour;
      sentences.push(`Revenue efficiency: ${$$(rplh)}/labor hr on ${$$(wk.totalRevenue||0)} in sales — ${bestRplhDay.day} is your strongest at ${$$(bestRplhDay.revenuePerLaborHour)}/hr (${$$(bestRplhDay.revenue||0)} revenue, ${hrs(bestRplhDay.totalHours||0)} labor), while ${worstRplhDay.day} is weakest at ${$$(worstRplhDay.revenuePerLaborHour)}/hr — a ${$$(Math.round(spread))} spread worth examining.`);
    } else if (hasSales && rplh) {
      sentences.push(`With ${$$(wk.totalRevenue||0)} in sales and ${hrs(totalHrs)} of labor, you're generating ${$$(rplh)}/hr${laborPct ? ` at a ${pct(laborPct)} labor cost rate` : ""}.`);
    } else if (hasSales && !rplh) {
      sentences.push(`${$$(wk.totalRevenue||0)} in revenue this week — schedule some hours alongside these sales days to unlock revenue-per-labor-hour tracking.`);
    } else {
      sentences.push(salesGap === "quietWeek"
        ? `No sales are recorded for ${weekLabel} yet, so revenue per labor hour and labor cost % will fill in as sales come in.`
        : salesGap === "unsynced"
        ? `Square is connected but no sales have synced yet — tap Sync Now on the Dashboard to pull them in.`
        : `Connect Square to see revenue-per-labor-hour and labor cost % — the two numbers that tell you whether your staffing is earning its cost.`);
    }

    // Sentence 3 — most urgent operational issue with specifics
    if (ot.length > 1) {
      sentences.push(`Overtime alert: ${ot.map(e=>`${e.name} (${hrs(e.hours)})`).join(", ")} are all above 40h — multiple overtime situations in the same week significantly inflate your actual labor cost.`);
    } else if (ot.length === 1) {
      const e = ot[0];
      const overHrs = parseFloat((e.hours - 40).toFixed(1));
      sentences.push(`Overtime alert: ${e.name} is at ${hrs(e.hours)} — ${hrs(overHrs)} into overtime. Every hour over 40 costs 1.5× their regular rate; pull a shift or shorten their longest day before week end.`);
    } else if (totalOverage > 3) {
      const topOver = [...pv].sort((a,b)=>b.diff-a.diff).slice(0,2);
      sentences.push(`Punch variance is running ${hrs(totalOverage)} over scheduled hours total — ${topOver.map(e=>`${e.name} +${hrs(e.diff)}`).join(", ")} — actual labor costs are running higher than your schedule estimates.`);
    } else if (af.missedPunches?.length) {
      const names = af.missedPunches.map(m=>m.name).join(" and ");
      sentences.push(`${names} ${af.missedPunches.length===1?"has a":"have"} shift${af.missedPunches.length!==1?"s":""} today with no clock-in recorded as of ${dayName} — verify attendance and add a manual punch if they worked.`);
    } else if (budget && totalPay > budget) {
      sentences.push(`To bring labor back under budget, you need to cut ${$$(totalPay - budget)} in scheduled hours — look at your longest days and see if any shifts can be shortened without affecting coverage.`);
    } else if (gapDays > 0) {
      const uncovDays = (wk.dailyTotals||[]).filter(d=>d.staffCount===0).map(d=>d.day);
      sentences.push(`Coverage gap: ${uncovDays.join(", ")} ${uncovDays.length===1?"has":"have"} no staff scheduled while your business hours show you're open — either close those days in Settings or add coverage.`);
    } else if (af.lateArrivals?.length) {
      const late = af.lateArrivals.slice(0,2).map(a=>`${a.name} (${a.count}×)`).join(", ");
      sentences.push(`Attendance note: ${late} clocked in late this week — not a crisis but worth a check-in if it becomes a pattern.`);
    }

    // Sentence 4 — forward look with specific next-week recommendation
    if (topSalesDay && score >= 75) {
      sentences.push(`Going into next week: ${topSalesDay.day} is your highest-revenue day at ${$$(topSalesDay.revenue)} — prioritize filling that day first and build the rest of the schedule around it.`);
    } else if (topSalesDay && bestRplhDay) {
      sentences.push(`Next week priority: protect coverage on ${bestRplhDay.day} (your most efficient day at ${$$(bestRplhDay.revenuePerLaborHour)}/hr) and consider trimming hours on ${worstRplhDay?.day||"your slowest day"} where efficiency lags.`);
    } else if (ot.length > 0) {
      sentences.push(`Before building next week, resolve this week's overtime first — start ${ot[0].name}'s schedule at a lighter load so the week doesn't compound the problem.`);
    } else if (!hasSales) {
      sentences.push(salesGap === "quietWeek"
        ? `Once this week's sales come in, the Pulse will show which days earn the most per labor hour.`
        : salesGap === "unsynced"
        ? `Run a Square sync before next week's schedule so the Pulse can show which days earn the most per labor hour.`
        : `Connect Square before next week's schedule to see which days earn the most per labor hour — that one number changes how you build the schedule.`);
    } else {
      sentences.push(`Schedule is in good shape — stay consistent with coverage on your busiest days and keep an eye on variance as the week closes out.`);
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

    // 4b. Shift type running over the labor target
    const staA = snap.shiftTypeAttribution;
    const worstTypeA = staA?.rows?.find(r => r.status === "over");
    if (priority <= 5 && worstTypeA) {
      const nm = worstTypeA.label.toLowerCase();
      const t = staA.trim;
      if (t) {
        actions.push({
          priority: priority++,
          action: `End ${t.days.join(", ")} ${nm} shifts an hour earlier`,
          why: `Sales in the last ${nm} hour averaged ${$$(t.avgRev)} against ${$$(t.avgCost)} in ${nm} labor. Cutting it saves about ${$$(t.weeklySavings)} a week.`,
        });
      } else {
        actions.push({
          priority: priority++,
          action: `Review ${nm} staffing`,
          why: staA.trimHasHourly
            ? `${worstTypeA.label} is running ${pct(worstTypeA.laborPct)} labor cost, but no single hour stands out. Try a shorter shift or one less person on it.`
            : `${worstTypeA.label} is running ${pct(worstTypeA.laborPct)} labor cost. Hourly Square sales would show exactly which hour to trim.`,
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
    // Owner's labor target (default 30%); "on target" = within 5 points of it
    const tgtPct = snap.laborTargetPct || 30;
    const tgtHigh = tgtPct + 5;

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
        insight = `Scheduled labor is ${$$(totalPay)}, which puts you ${$$(overAmt)} (${overPct}%) over your ${$$(budget)} weekly budget. That gap needs to close before payroll runs — look for overlap shifts or days where coverage exceeds what the schedule actually requires. ${hasSales && laborPct ? (laborPct > tgtHigh ? `At ${pct(laborPct)} of revenue, labor cost is above your ${tgtPct}% target.` : `Labor cost is ${pct(laborPct)} of revenue against your ${tgtPct}% target.`) : ""}`;
      } else if (projOver) {
        insight = `Scheduled labor is ${$$(totalPay)} against a ${$$(budget)} budget — ${$$(burn.overBy)} over. You're ${burn.weekPct}% through the week (day ${burn.daysPassed} of ${burn.daysInWeek}). Review the remaining shifts and look for overlap or slow days where hours can be trimmed. ${hasSales && laborPct ? `Current labor cost is ${pct(laborPct)} of revenue.` : ""}`;
      } else {
        const usedPct = budget > 0 ? Math.round((totalPay / budget) * 100) : 0;
        insight = `Scheduled labor is ${$$(totalPay)} against your ${$$(budget)} budget — ${$$(runway)} of runway remaining with ${100 - burn?.weekPct || 0}% of the week ahead. ${hasSales && laborPct ? `Your labor cost is ${pct(laborPct)} of revenue, ${laborPct <= tgtHigh ? "in line with" : "above"} your ${tgtPct}% target.` : ""}`;
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
        insight: salesGap === "quietWeek"
          ? `No sales are recorded for this week yet. If you're closed or between seasons, that's expected. Revenue per labor hour fills in automatically as soon as sales come in.`
          : salesGap === "unsynced"
          ? `Square is connected, but no sales have synced yet. Tap Sync Now on the Dashboard to pull in your sales history, then generate the Pulse again.`
          : `No sales data is connected yet. When you link Square, ShiftWise calculates revenue per labor hour for every day of the week — the single clearest signal of whether your staffing is earning its cost. Connect Square or import a sales CSV in Settings → Data & Backup to unlock this section.`,
      });
    }

    // ── SECTION 2b: Shift Type Efficiency ────────────────────────────────────
    const sta = snap.shiftTypeAttribution;
    if (sta?.rows?.length) {
      const rows = sta.rows;
      const withPct = rows.filter(r => r.laborPct != null);
      const maxPct = withPct.length ? Math.max(...withPct.map(r => r.laborPct)) : 0;
      const urgency = maxPct > tgtPct + 10 ? "high" : maxPct > tgtHigh ? "medium" : "low";
      const worst = rows.find(r => r.status === "over");
      let insight;
      if (!withPct.length) {
        const top = [...rows].sort((a,b) => b.cost - a.cost)[0];
        insight = `No sales recorded during these hours yet, so this shows labor only. ${top.label} carries the most labor cost at ${$$(top.cost)}.`;
      } else if (worst) {
        insight = `${worst.label} is your costliest shift type. It cost ${$$(worst.cost)} in labor against ${$$(worst.revenue)} in sales during its hours — ${pct(worst.laborPct)}, above your ${tgtPct}% target.`;
      } else {
        const best = [...withPct].sort((a,b) => (b.rplh||0) - (a.rplh||0))[0];
        insight = `Every shift type is at or under your ${tgtPct}% target. ${best.label} is the most efficient at ${$$(best.rplh)} per labor hour.`;
      }
      const totalRev = sta.matchedRevenue + sta.estimatedRevenue;
      sections.push({
        title: "Shift Type Efficiency", icon: "🏷️", urgency, insight,
        shiftTypes: { rows, uncovered: sta.uncovered, matchedPct: totalRev > 0 ? Math.round(sta.matchedRevenue / totalRev * 100) : null },
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
    // salesDays, topSalesDay, bottomSalesDay already declared above in pulse narrative

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
      nextWeekFocus = salesGap === "quietWeek"
        ? `No sales this week yet to plan around. When sales pick up, build the schedule around your busiest days first — the Pulse will name them once there's data for the week.`
        : salesGap === "unsynced"
        ? `Tap Sync Now on the Dashboard before building next week. With your sales in, the Pulse can show which days earn the most per labor hour.`
        : `The most impactful thing you can do before next week is connect your Square account. Revenue per labor hour is the one number that tells you whether your staffing is earning its cost — and right now ShiftWise can't calculate it without sales data. Five minutes in Settings → Data & Backup unlocks it permanently.`;
    } else if (topSalesDay) {
      nextWeekFocus = `${topSalesDay.day} is your best revenue day at ${$$(topSalesDay.revenue)}. Make sure it's fully staffed next week before filling in the rest. The schedule should start with your highest-volume days and work backward — not the other way around.`;
    } else {
      nextWeekFocus = `Review your operating hours in Settings and make sure they reflect when you're actually open. Accurate hours let ShiftWise detect coverage gaps automatically and give the Pulse engine better data to work with next week.`;
    }

    return { pulse, headline, score: { value: score, label: scoreLabel, reason: scoreReason }, sections: sections.slice(0, 6), actions: actions.slice(0, 5), positives: positives.slice(0, 3), nextWeekFocus };
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
          .map(([date, d]) => ({ date, revenue: Math.round(d.revenue * 100)/100, transactions: d.transactions, source: 'square' }))
          .sort((a,b) => a.date.localeCompare(b.date));

        if (result.length === 0) throw new Error("No sales data found in this file.");

        setRawSales(prev => mergeSalesRows(prev, "square", result));
        // Write only the imported Square rows; cash entries are untouched
        if (bizId) {
          const rows = result.map(d=>({ business_id:bizId, sale_date:d.date, revenue:d.revenue, transactions:d.transactions||0, source:"square" }));
          sbFetch("sales_data?on_conflict=business_id,sale_date,source", {
            method:"POST", body:JSON.stringify(rows), headers:{ "Prefer":"resolution=merge-duplicates,return=minimal" },
          }).catch(e=>{ console.warn("Sales data write failed:", e); showError(friendlyError(e, "That import didn't save to the server — try uploading again.")); });
        }

        showToast(`${result.length} days of sales data imported ✓`, 4000);
        addAudit("Sales Data Imported", `${result.length} days from Square — ${result[0].date} to ${result[result.length-1].date}`);
      } catch(err) {
        showError(friendlyError(err, "Couldn't read that file — make sure it's a Square CSV export and try again."), 6000);
      }
    };
    reader.readAsText(file);
  }

  // ── FLAG PATTERNS REPORT ─────────────────────────────────────────────────
  // Capped at 2000 punches for performance — more than enough for a full
  // quarter even for a busier team, and keeps this to at most 2 requests.
  // If a range genuinely has more than that, we say so explicitly (see
  // `truncated` below) rather than silently showing a partial report as if
  // it were complete.
  const FLAG_REPORT_MAX_ROWS = 2000;
  async function fetchPunchesForRange(businessId, startDate, endDate) {
    if (!businessId) return { rows: [], truncated: false };
    const startTs = encodeURIComponent(`${startDate} 00:00:00`);
    const endTs = encodeURIComponent(`${endDate} 23:59:59`);
    const PAGE_SIZE = 1000;
    let all = [];
    let offset = 0;
    while (all.length < FLAG_REPORT_MAX_ROWS) {
      const rows = await dbGet(
        `punches?select=*&business_id=eq.${businessId}&punched_at=gte.${startTs}&punched_at=lte.${endTs}&order=punched_at.asc&limit=${PAGE_SIZE}&offset=${offset}`
      );
      if (!rows || rows.length === 0) break;
      all = all.concat(rows);
      if (rows.length < PAGE_SIZE) break; // fewer than a full page means this was the last one
      offset += PAGE_SIZE;
    }
    const truncated = all.length > FLAG_REPORT_MAX_ROWS;
    const trimmed = all.slice(0, FLAG_REPORT_MAX_ROWS);
    return {
      truncated,
      rows: trimmed.map(r => ({
        id: r.id, empId: r.employee_id, empName: r.employee_name,
        type: r.punch_type, time: r.punched_at?.replace(" ", "T") ?? null, flags: r.flags || [],
      })),
    };
  }

  const FLAG_REPORT_LABELS = { EARLY:"Clocked In Early", EARLY_OUT:"Clocked Out Early", NO_SHIFT:"Unscheduled Punch", ADJUSTMENT:"Manually Adjusted", LATE:"Late Clock-In", NO_SHOW:"No-Show" };
  const FLAG_REPORT_COLORS = { EARLY:"#3A9BE8", EARLY_OUT:"#E07020", NO_SHIFT:"#C0392B", ADJUSTMENT:"#9B59B6", LATE:"#E8A93A", NO_SHOW:"#7B241C" };
  const DOW_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  // Deterministic, rule-based pattern detection + one-line narrative —
  // same philosophy as computePulse(): no AI, just priority-ordered rules
  // against real counts so the sentence always matches what's on screen.
  function computeFlagPatterns(punchRows) {
    const byType = {}, byDay = {}, byEmployee = {};
    let total = 0;
    punchRows.forEach(p => {
      if (!p.flags || !p.flags.length) return;
      const d = new Date((p.time||"").replace(" ","T"));
      const dow = DOW_SHORT[d.getDay()];
      p.flags.forEach(f => {
        total++;
        byType[f] = (byType[f]||0) + 1;
        byDay[dow] = (byDay[dow]||0) + 1;
        byEmployee[p.empName||"Unknown"] = (byEmployee[p.empName||"Unknown"]||0) + 1;
      });
    });
    const topOf = obj => Object.entries(obj).sort((a,b)=>b[1]-a[1])[0] || null;
    const topType = topOf(byType), topDay = topOf(byDay), topEmployee = topOf(byEmployee);
    const typeLabel = k => FLAG_REPORT_LABELS[k] || k;

    let narrative;
    if (total === 0) {
      narrative = "No flagged punches in this period — clean record.";
    } else if (topEmployee && (topEmployee[1] / total) >= 0.4) {
      narrative = `${topEmployee[0]} accounts for ${Math.round(topEmployee[1]/total*100)}% of flagged punches this period — mostly ${typeLabel(topType[0])}${topDay ? ` on ${topDay[0]}s` : ""}.`;
    } else if (topDay && (topDay[1] / total) >= 0.4) {
      narrative = `Flags cluster on ${topDay[0]}s (${topDay[1]} of ${total}), mostly ${typeLabel(topType[0])}.`;
    } else if (topType && (topType[1] / total) >= 0.5) {
      narrative = `${typeLabel(topType[0])} is your most common flag this period (${topType[1]} of ${total}).`;
    } else {
      narrative = "Flags were spread fairly evenly this period — no single day, employee, or type stood out.";
    }
    return { total, byType, byDay, byEmployee, topType, topDay, topEmployee, narrative };
  }

  // ── REPORT BUILDER ENGINE ────────────────────────────────────────────────
  // Shared date-bucketing helpers. Mon-first ordering for "Day of Week" so
  // report charts read left-to-right the way an owner thinks about a work
  // week, not the JS Date.getDay() Sun-first convention.
  const REPORT_DOW = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  // Weather filter shared by every date-based source. A day passes when its
  // main condition is one of those picked; days with no weather recorded are
  // left out while the filter is on.
  const WEATHER_CONDITIONS = [["sunny","Sunny"],["cloudy","Cloudy"],["rainy","Rainy"],["storm","Storm"],["snowy","Snowy"]];
  const WEATHER_FILTER = { id:"weather", label:"Weather", options: WEATHER_CONDITIONS.map(([v,l]) => ({ value:v, label:l })) };
  function weatherOk(dateStr, filters) {
    if (!filters?.weather?.length) return true;
    const w = weatherMapRef.current[dateStr];
    return !!w && filters.weather.includes(w.condition);
  }
  function reportDowOf(dateStr) {
    const d = new Date(dateStr+"T12:00:00");
    return REPORT_DOW[(d.getDay()+6)%7];
  }
  function reportBucketKey(dateStr, grouping) {
    if (grouping === "Day of Week") return reportDowOf(dateStr);
    if (grouping === "Week") return getSunday(dateStr);
    return dateStr;
  }
  function reportBucketLabel(key, grouping) {
    if (grouping === "Day of Week") return key;
    if (grouping === "Week") return `Wk of ${dl(key)}`;
    return dl(key);
  }
  function reportBucketKeysInRange(startDate, endDate, grouping) {
    if (grouping === "Day of Week") return REPORT_DOW;
    const keys = [];
    if (grouping === "Week") {
      let cur = getSunday(startDate);
      const endSun = getSunday(endDate);
      while (cur <= endSun) { keys.push(cur); cur = addDays(cur,7); }
    } else {
      let cur = startDate;
      while (cur <= endDate) { keys.push(cur); cur = addDays(cur,1); }
    }
    // UI Batch 23 — a closed day (or a week with no open days) isn't a $0 row
    if (season.on) return keys.filter(k => grouping === "Week" ? [0,1,2,3,4,5,6].some(i => openDay(addDays(k, i))) : openDay(k));
    return keys;
  }

  // Field/filter metadata for the builder UI — matches the real, audited
  // Supabase vocabulary (confirmed flag values, review statuses, sale
  // sources), not guessed labels.
  const REPORT_SOURCES = {
    timesheet: {
      label: "Timesheet & Punches", color: "#FF7A59",
      fields: [
        { id:"hours", label:"Total Hours" },
        { id:"punches", label:"Punch Count" },
        { id:"overtime", label:"Overtime Hours" },
        { id:"flagged", label:"Flagged Punches" },
        { id:"edits", label:"Manual Edits" },
        { id:"noshows", label:"No-Shows" },
      ],
      filters: [
        { id:"employee", label:"Employee", options: allEmployees.map(e=>({value:e.id,label:e.status==="inactive" ? `${e.name} (former)` : e.name})) },
        { id:"flagType", label:"Flag Type", options:[
          {value:"EARLY",label:"Clocked In Early"},{value:"EARLY_OUT",label:"Clocked Out Early"},
          {value:"LATE",label:"Late Clock-In"},{value:"NO_SHIFT",label:"Unscheduled Punch"},
          {value:"ADJUSTMENT",label:"Manually Adjusted"},{value:"NO_SHOW",label:"No-Show"}] },
        { id:"reviewStatus", label:"Review Status", options:[
          {value:"reviewed",label:"Reviewed"},{value:"approved",label:"Approved"},{value:"rejected",label:"Rejected"}] },
        { id:"dow", label:"Day of Week", options: REPORT_DOW.map(d=>({value:d,label:d})) },
        WEATHER_FILTER,
      ],
    },
    flags: {
      label: "Flags & No-Shows", color: "#C0392B",
      fields: [
        { id:"total", label:"All Flags" },
        { id:"EARLY", label:"Clocked In Early" },
        { id:"EARLY_OUT", label:"Clocked Out Early" },
        { id:"LATE", label:"Late Clock-In" },
        { id:"NO_SHIFT", label:"Unscheduled Punch" },
        { id:"ADJUSTMENT", label:"Manually Adjusted" },
        { id:"NO_SHOW", label:"No-Shows" },
      ],
      filters: [
        { id:"employee", label:"Employee", options: allEmployees.map(e=>({value:e.id,label:e.status==="inactive" ? `${e.name} (former)` : e.name})) },
        { id:"reviewStatus", label:"Review Status", options:[
          {value:"unreviewed",label:"Not reviewed"},{value:"reviewed",label:"Reviewed"},{value:"approved",label:"Approved"},{value:"rejected",label:"Rejected"}] },
        { id:"dow", label:"Day of Week", options: REPORT_DOW.map(d=>({value:d,label:d})) },
        WEATHER_FILTER,
      ],
    },
    revenue: {
      label: "Revenue", color: "#FBBF3D",
      fields: [
        { id:"total", label:"Total Revenue" },
        { id:"txns", label:"Transaction Count" },
        { id:"avgTicket", label:"Avg Ticket" },
      ],
      filters: [
        { id:"source", label:"Source", options:[{value:"square",label:"Square (Auto)"},{value:"cash",label:"Cash"}] },
        { id:"dow", label:"Day of Week", options: REPORT_DOW.map(d=>({value:d,label:d})) },
        WEATHER_FILTER,
      ],
    },
    // NOTE: intentionally only Actual % and Revenue/Labor Hr for now — both
    // computed purely from punches + sales + hourly rate. Budget Burn %,
    // Projected %, and Variance would need to reconstruct scheduled labor
    // cost from published_schedules.schedule_data historically, which needs
    // its JSON shape verified before it's trustworthy — deferred rather than
    // guessed.
    laborcost: {
      label: "Labor Cost & Efficiency", color: "#5EEAB0",
      fields: [
        { id:"actual", label:"Actual Labor Cost %" },
        { id:"rplh", label:"Revenue / Labor Hr" },
      ],
      filters: [
        { id:"dow", label:"Day of Week", options: REPORT_DOW.map(d=>({value:d,label:d})) },
        WEATHER_FILTER,
      ],
    },
    weather: {
      label: "Weather", color: "#3A9BE8",
      fields: [
        { id:"condition", label:"Conditions", text:true },
        { id:"highF", label:"High °F" },
        { id:"lowF", label:"Low °F" },
        { id:"rainIn", label:"Rain (in)" },
        { id:"wetDays", label:"Rain / Storm / Snow Days" },
      ],
      filters: [WEATHER_FILTER],
    },
    itemsales: {
      label: "Item Sales", color: "#E8623A",
      fields: [
        { id:"units", label:"Units Sold" },
        { id:"sales", label:"Item Sales" },
        { id:"avgPrice", label:"Avg Price Paid" },
        { id:"share", label:"Share of Item Sales %" },
      ],
      filters: [
        { id:"item", label:"Item", options: (itemNames||[]).map(i => ({ value:i.key, label:i.name })) },
        { id:"dow", label:"Day of Week", options: REPORT_DOW.map(d=>({value:d,label:d})) },
        WEATHER_FILTER,
      ],
    },
    shifttypes: {
      label: "Shift Types", color: "#9B59B6",
      fields: [
        { id:"hours", label:"Hours" },
        { id:"cost", label:"Labor Cost" },
        { id:"revenue", label:"Sales Credited" },
        { id:"laborPct", label:"Labor Cost %" },
        { id:"rplh", label:"Sales / Labor Hr" },
      ],
      filters: [
        { id:"shiftType", label:"Shift Type", options: [
          ...shiftTypes.map(s => ({ value:s.id, label:s.label || "(unnamed)" })),
          { value: SHIFT_UNSCHEDULED, label: "Unscheduled" },
        ] },
        WEATHER_FILTER,
      ],
    },
    pulse: {
      label: "Weekly Pulse Trends", color: "#7DD3FC",
      fields: [{ id:"score", label:"Pulse Score" }],
      filters: [{ id:"scoreBand", label:"Score Band", options:[
        {value:"Healthy",label:"Healthy"},{value:"Caution",label:"Caution"},{value:"Warning",label:"Warning"},{value:"Critical",label:"Critical"}] }],
    },
  };

  // Labor Cost & Efficiency — async, combines a fresh punch fetch (for actual
  // hours × each employee's own rate) with the already-loaded salesData.
  async function computeLaborCostReport(startDate, endDate, grouping, filters={}) {
    const { rows: rawPunches, truncated } = await fetchPunchesForRange(bizId, startDate, endDate);
    const rateById = {};
    allEmployees.forEach(e => { rateById[e.id] = parseFloat(e.hourlyRate)||0; });

    const byEmpDay = {};
    rawPunches.forEach(p => {
      if (!p.time) return;
      const dateStr = toLocalDateStr(new Date(p.time));
      if (dateStr < startDate || dateStr > endDate) return;
      if (filters.dow?.length && !filters.dow.includes(reportDowOf(dateStr))) return;
      if (!weatherOk(dateStr, filters)) return;
      (byEmpDay[`${p.empId}__${dateStr}`] ||= []).push(p);
    });

    if (grouping === "Employee") {
      // Revenue isn't attributable to one employee, so "actual %" here means
      // each employee's own labor cost as a share of TOTAL business revenue
      // for the period — these sum back up to the whole business's labor
      // cost %, which is what makes the breakdown meaningful rather than
      // just splitting a business-wide number arbitrarily.
      const totalRev = salesData
        .filter(d => d.date >= startDate && d.date <= endDate)
        .filter(d => !filters.dow?.length || filters.dow.includes(reportDowOf(d.date)))
        .filter(d => weatherOk(d.date, filters))
        .reduce((s,d) => s + (Number(d.revenue)||0), 0);
      const byEmp = {};
      Object.entries(byEmpDay).forEach(([k, dayPunches]) => {
        const [empId] = k.split("__");
        const b = (byEmp[empId] ||= { hrs:0, pay:0 });
        const sorted = [...dayPunches].sort((a,b)=>new Date(a.time)-new Date(b.time));
        const hrs = calcActualHours(sorted);
        b.hrs += hrs;
        b.pay += hrs*(rateById[empId]||0);
      });
      const rows = allEmployees.filter(emp => emp.status !== "inactive" || (byEmp[emp.id]?.hrs||0) > 0).map(emp => {
        const b = byEmp[emp.id] || { hrs:0, pay:0 };
        return {
          label: emp.name,
          laborcost__actual: totalRev > 0 ? Math.round((b.pay/totalRev)*1000)/10 : 0,
          laborcost__rplh: b.hrs > 0 ? Math.round((totalRev/b.hrs)*100)/100 : 0,
        };
      }).sort((a,b) => b.laborcost__actual - a.laborcost__actual);
      return { rows, truncated };
    }

    const payByKey = {}, hoursByKey = {};
    Object.entries(byEmpDay).forEach(([k, dayPunches]) => {
      const [empId, dateStr] = k.split("__");
      const key = reportBucketKey(dateStr, grouping);
      const sorted = [...dayPunches].sort((a,b)=>new Date(a.time)-new Date(b.time));
      const hrs = calcActualHours(sorted);
      payByKey[key] = (payByKey[key]||0) + hrs*(rateById[empId]||0);
      hoursByKey[key] = (hoursByKey[key]||0) + hrs;
    });

    const revByKey = {};
    salesData.filter(d => d.date >= startDate && d.date <= endDate).forEach(d => {
      if (filters.dow?.length && !filters.dow.includes(reportDowOf(d.date))) return;
      if (!weatherOk(d.date, filters)) return;
      const key = reportBucketKey(d.date, grouping);
      revByKey[key] = (revByKey[key]||0) + (Number(d.revenue)||0);
    });

    const rows = reportBucketKeysInRange(startDate, endDate, grouping).map(key => {
      const pay = payByKey[key] || 0, hrs = hoursByKey[key] || 0, rev = revByKey[key] || 0;
      return {
        label: reportBucketLabel(key, grouping),
        laborcost__actual: rev > 0 ? Math.round((pay/rev)*1000)/10 : 0,
        laborcost__rplh: hrs > 0 ? Math.round((rev/hrs)*100)/100 : 0,
      };
    });
    return { rows, truncated };
  }

  // Pulse Trends — async fresh fetch of pulse_history for the range. Pulse is
  // inherently a once-a-week number, so every grouping choice buckets by the
  // week it was actually generated for rather than trying to force it into
  // Day or Day-of-Week buckets that don't really apply to it.
  async function computePulseReport(startDate, endDate, grouping, filters={}) {
    if (!bizId) return { rows: [], truncated: false };
    const startTs = encodeURIComponent(startDate), endTs = encodeURIComponent(endDate);
    const rawRows = await dbGet(
      `pulse_history?select=*&business_id=eq.${bizId}&week_start=gte.${startTs}&week_start=lte.${endTs}&order=week_start.asc&limit=500`
    );
    let hist = (rawRows||[]).map(r => ({ weekStart: r.week_start, score: r.score, label: r.label }));
    if (filters.scoreBand?.length) hist = hist.filter(h => filters.scoreBand.includes(h.label));

    const rows = hist.map(h => ({
      label: reportBucketLabel(getSunday(h.weekStart), "Week"),
      pulse__score: h.score,
    }));
    return { rows, truncated: false };
  }

  function computeRevenueReport(startDate, endDate, grouping, filters={}) {
    let salesRows = rawSales.filter(d => d.date >= startDate && d.date <= endDate);
    if (filters.source?.length) salesRows = salesRows.filter(d => filters.source.includes(d.source));
    if (filters.dow?.length) salesRows = salesRows.filter(d => filters.dow.includes(reportDowOf(d.date)));
    if (filters.weather?.length) salesRows = salesRows.filter(d => weatherOk(d.date, filters));

    const buckets = {};
    salesRows.forEach(d => {
      const key = reportBucketKey(d.date, grouping);
      const b = (buckets[key] ||= { revenue:0, txns:0 });
      b.revenue += Number(d.revenue)||0;
      b.txns += Number(d.transactions)||0;
    });
    const rows = reportBucketKeysInRange(startDate, endDate, grouping).map(key => {
      const b = buckets[key] || { revenue:0, txns:0 };
      return {
        label: reportBucketLabel(key, grouping),
        revenue__total: Math.round(b.revenue*100)/100,
        revenue__txns: b.txns,
        revenue__avgTicket: b.txns>0 ? Math.round((b.revenue/b.txns)*100)/100 : 0,
      };
    });
    return { rows, truncated: false };
  }

  // Timesheet — async (needs a fresh, uncapped-within-2000 punch fetch for the
  // range). Reuses calcActualHours() for shift-pairing so this can never drift
  // from how hours are computed everywhere else in the app. Overtime is
  // attributed per employee, per Sun–Sat week, to the specific day that pushed
  // that week's cumulative hours past 40 — not just summed independently per
  // bucket, which would misrepresent which day actually caused the overtime.
  // UI Batch 16 — one row per flag (a punch with two flags = two rows) plus
  // one row per saved no-show. Used by the detail list and its CSV.
  const FLAG_KEYS = ["EARLY","EARLY_OUT","LATE","NO_SHIFT","ADJUSTMENT","NO_SHOW"];
  function buildFlagDetails(punches, noShows, startDate, endDate) {
    const out = [];
    punches.forEach(p => {
      if (!p.time || !(p.flags||[]).length) return;
      const d = new Date(p.time);
      const dateStr = toLocalDateStr(d);
      if (dateStr < startDate || dateStr > endDate) return;
      p.flags.forEach(f => out.push({
        id: `${p.id}_${f}`, date: dateStr, time: d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),
        empName: p.empName || allEmployees.find(e=>e.id===p.empId)?.name || "Unknown",
        flag: f, flagLabel: FLAG_REPORT_LABELS[f] || f, punchType: ({ in:"Clock in", out:"Clock out", break_in:"Break start", break_out:"Break end" })[p.type] || (p.type || ""),
        review: punchReviews[p.id] || "not reviewed",
      }));
    });
    noShows.forEach(n => out.push({
      id: `ns_${n.id}`, date: n.event_date, time: n.shift_start != null ? `${fmt(parseFloat(n.shift_start))}–${fmt(parseFloat(n.shift_end))}` : "",
      empName: n.employee_name || allEmployees.find(e=>e.id===n.employee_id)?.name || "Unknown",
      flag: "NO_SHOW", flagLabel: "No-Show", punchType: "Scheduled shift", review: "—",
    }));
    return out.sort((a,b) => (b.date + b.time).localeCompare(a.date + a.time));
  }

  async function computeFlagsReport(startDate, endDate, grouping, filters={}) {
    const { rows: rawPunches, truncated } = await fetchPunchesForRange(bizId, startDate, endDate);
    let noShows = [];
    try {
      noShows = (await dbGet(`attendance_events?select=id,employee_id,employee_name,event_date,shift_start,shift_end&business_id=eq.${bizId}&event_type=eq.NO_SHOW&event_date=gte.${startDate}&event_date=lte.${endDate}&limit=5000`)) || [];
    } catch (e) { console.warn("No-shows unavailable:", e); }
    const dayOk = dateStr => (!filters.dow?.length || filters.dow.includes(reportDowOf(dateStr))) && weatherOk(dateStr, filters);
    let punches = rawPunches.filter(p => (p.flags||[]).length && p.time);
    if (filters.employee?.length) { punches = punches.filter(p => filters.employee.includes(p.empId)); noShows = noShows.filter(n => filters.employee.includes(n.employee_id)); }
    if (filters.reviewStatus?.length) {
      punches = punches.filter(p => filters.reviewStatus.includes(punchReviews[p.id] || "unreviewed"));
      if (!filters.reviewStatus.includes("unreviewed")) noShows = []; // no-shows have no punch to review
    }
    punches = punches.filter(p => { const ds = toLocalDateStr(new Date(p.time)); return ds >= startDate && ds <= endDate && dayOk(ds); });
    noShows = noShows.filter(n => dayOk(n.event_date));

    const blank = () => ({ total:0, EARLY:0, EARLY_OUT:0, LATE:0, NO_SHIFT:0, ADJUSTMENT:0, NO_SHOW:0 });
    const add = (b, f) => { if (b[f] === undefined) return; b[f]++; b.total++; };
    const toRow = (label, b) => { const r = { label }; Object.keys(b).forEach(k => { r[`flags__${k}`] = b[k]; }); return r; };
    const details = buildFlagDetails(punches, noShows, startDate, endDate);

    if (grouping === "Flag Type") {
      const rows = FLAG_KEYS.map(k => {
        const b = blank();
        details.filter(d => d.flag === k).forEach(() => add(b, k));
        return toRow(FLAG_REPORT_LABELS[k] || k, b);
      }).filter(r => r.flags__total > 0);
      return { rows, truncated, details };
    }
    if (grouping === "Employee") {
      const byEmp = {};
      punches.forEach(p => p.flags.forEach(f => add((byEmp[p.empId] ||= blank()), f)));
      noShows.forEach(n => add((byEmp[n.employee_id] ||= blank()), "NO_SHOW"));
      const empIds = filters.employee?.length ? filters.employee
        : allEmployees.filter(e => e.status !== "inactive" || byEmp[e.id]).map(e=>e.id);
      const rows = empIds.map(id => toRow(allEmployees.find(e=>e.id===id)?.name || "Unknown", byEmp[id] || blank()))
        .sort((a,b) => b.flags__total - a.flags__total);
      return { rows, truncated, details };
    }
    const buckets = {};
    punches.forEach(p => { const k = reportBucketKey(toLocalDateStr(new Date(p.time)), grouping); p.flags.forEach(f => add((buckets[k] ||= blank()), f)); });
    noShows.forEach(n => add((buckets[reportBucketKey(n.event_date, grouping)] ||= blank()), "NO_SHOW"));
    const rows = reportBucketKeysInRange(startDate, endDate, grouping).map(k => toRow(reportBucketLabel(k, grouping), buckets[k] || blank()));
    return { rows, truncated, details };
  }

  async function computeTimesheetReport(startDate, endDate, grouping, filters={}) {
    const { rows: rawPunches, truncated } = await fetchPunchesForRange(bizId, startDate, endDate);

    // Saved no-shows (written nightly from attendance_events). Every saved
    // no-show counts — there is no excusing (UI Batch 15).
    let noShows = [];
    try {
      noShows = (await dbGet(`attendance_events?select=id,employee_id,employee_name,event_date,shift_start,shift_end&business_id=eq.${bizId}&event_type=eq.NO_SHOW&event_date=gte.${startDate}&event_date=lte.${endDate}&limit=5000`)) || [];
    } catch (e) { console.warn("No-shows unavailable:", e); }
    if (filters.employee?.length) noShows = noShows.filter(n => filters.employee.includes(n.employee_id));
    if (filters.flagType?.length && !filters.flagType.includes("NO_SHOW")) noShows = [];
    if (filters.reviewStatus?.length) noShows = []; // no-shows have no punch to review
    noShows = noShows.filter(n => (!filters.dow?.length || filters.dow.includes(reportDowOf(n.event_date))) && weatherOk(n.event_date, filters));

    let punches = rawPunches;
    if (filters.employee?.length) punches = punches.filter(p => filters.employee.includes(p.empId));
    if (filters.flagType?.length) punches = punches.filter(p => (p.flags||[]).some(f => filters.flagType.includes(f)));
    if (filters.reviewStatus?.length) punches = punches.filter(p => filters.reviewStatus.includes(punchReviews[p.id]));

    const byEmpDay = {};
    punches.forEach(p => {
      if (!p.time) return;
      const dateStr = toLocalDateStr(new Date(p.time));
      if (dateStr < startDate || dateStr > endDate) return;
      if (filters.dow?.length && !filters.dow.includes(reportDowOf(dateStr))) return;
      if (!weatherOk(dateStr, filters)) return;
      (byEmpDay[`${p.empId}__${dateStr}`] ||= []).push(p);
    });

    // Overtime attribution pass — per employee, per week, cumulative hours vs 40.
    const overtimeByDate = {};
    const byEmpWeek = {};
    Object.entries(byEmpDay).forEach(([k, dayPunches]) => {
      const [empId, dateStr] = k.split("__");
      (byEmpWeek[`${empId}__${getSunday(dateStr)}`] ||= []).push({ dateStr, dayPunches });
    });
    Object.values(byEmpWeek).forEach(days => {
      days.sort((a,b)=>a.dateStr.localeCompare(b.dateStr));
      let cumulative = 0;
      days.forEach(({ dateStr, dayPunches }) => {
        const sorted = [...dayPunches].sort((a,b)=>new Date(a.time)-new Date(b.time));
        const dayHrs = calcActualHours(sorted);
        const before = cumulative;
        cumulative += dayHrs;
        const otToday = Math.max(0, cumulative-40) - Math.max(0, before-40);
        if (otToday > 0) overtimeByDate[dateStr] = (overtimeByDate[dateStr]||0) + otToday;
      });
    });

    if (grouping === "Flag Type") {
      // One row per flag type: punch flags plus saved no-shows.
      const TYPES = [["EARLY","Clocked In Early"],["EARLY_OUT","Clocked Out Early"],["LATE","Late Clock-In"],["NO_SHIFT","Unscheduled Punch"],["ADJUSTMENT","Manually Adjusted"],["NO_SHOW","No-Show"]];
      const counts = {};
      Object.values(byEmpDay).forEach(dayPunches => dayPunches.forEach(p => (p.flags||[]).forEach(f => { counts[f] = (counts[f]||0) + 1; })));
      counts.NO_SHOW = noShows.length;
      const rows = TYPES
        .filter(([k]) => !filters.flagType?.length || filters.flagType.includes(k))
        .map(([k, label]) => ({ label, timesheet__hours:0, timesheet__punches:0, timesheet__overtime:0, timesheet__edits:0,
          timesheet__flagged: counts[k] || 0, timesheet__noshows: k === "NO_SHOW" ? (counts.NO_SHOW || 0) : 0 }))
        .filter(r => r.timesheet__flagged > 0);
      return { rows, truncated, details: buildFlagDetails(Object.values(byEmpDay).flat(), noShows, startDate, endDate) };
    }

    if (grouping === "Employee") {
      // One row per employee, totals across the whole range — not bucketed
      // by day/week. Overtime still needs the per-week attribution pass
      // above (already computed into overtimeByDate) so it stays correct
      // even when summed across employees rather than across dates.
      const byEmp = {};
      Object.entries(byEmpDay).forEach(([k, dayPunches]) => {
        const [empId, dateStr] = k.split("__");
        const b = (byEmp[empId] ||= { hours:0, punches:0, overtime:0, flagged:0, edits:0 });
        const sorted = [...dayPunches].sort((a,b)=>new Date(a.time)-new Date(b.time));
        b.hours += calcActualHours(sorted);
        b.punches += dayPunches.length;
        b.overtime += overtimeByDate[dateStr] || 0;
        dayPunches.forEach(p => {
          b.flagged += (p.flags||[]).length;
          if ((p.flags||[]).includes("ADJUSTMENT")) b.edits += 1;
        });
      });
      // Respect the Employee filter if set (show exactly who was chosen,
      // even at zero); otherwise show every employee on the roster so
      // anyone with zero activity in the range is visible, not hidden.
      const empIds = filters.employee?.length ? filters.employee
        : allEmployees.filter(e => e.status !== "inactive" || (byEmp[e.id]?.hours||0) > 0).map(e=>e.id);
      const rows = empIds.map(empId => {
        const emp = allEmployees.find(e=>e.id===empId);
        const b = byEmp[empId] || { hours:0, punches:0, overtime:0, flagged:0, edits:0 };
        return {
          label: emp?.name || "Unknown",
          timesheet__hours: Math.round(b.hours*100)/100,
          timesheet__punches: b.punches,
          timesheet__overtime: Math.round(b.overtime*100)/100,
          timesheet__flagged: b.flagged,
          timesheet__edits: b.edits,
          timesheet__noshows: noShows.filter(n => n.employee_id === empId).length,
        };
      }).sort((a,b) => b.timesheet__hours - a.timesheet__hours);
      return { rows, truncated, details: buildFlagDetails(Object.values(byEmpDay).flat(), noShows, startDate, endDate) };
    }

    const buckets = {};
    Object.entries(byEmpDay).forEach(([k, dayPunches]) => {
      const [, dateStr] = k.split("__");
      const key = reportBucketKey(dateStr, grouping);
      const b = (buckets[key] ||= { hours:0, punches:0, overtime:0, flagged:0, edits:0 });
      const sorted = [...dayPunches].sort((a,b)=>new Date(a.time)-new Date(b.time));
      b.hours += calcActualHours(sorted);
      b.punches += dayPunches.length;
      b.overtime += overtimeByDate[dateStr] || 0;
      dayPunches.forEach(p => {
        b.flagged += (p.flags||[]).length;
        if ((p.flags||[]).includes("ADJUSTMENT")) b.edits += 1;
      });
    });

    const noShowsByKey = {};
    noShows.forEach(n => { const k = reportBucketKey(n.event_date, grouping); noShowsByKey[k] = (noShowsByKey[k]||0) + 1; });
    const rows = reportBucketKeysInRange(startDate, endDate, grouping).map(key => {
      const b = buckets[key] || { hours:0, punches:0, overtime:0, flagged:0, edits:0 };
      return {
        label: reportBucketLabel(key, grouping),
        timesheet__hours: Math.round(b.hours*100)/100,
        timesheet__punches: b.punches,
        timesheet__overtime: Math.round(b.overtime*100)/100,
        timesheet__flagged: b.flagged,
        timesheet__edits: b.edits,
        timesheet__noshows: noShowsByKey[key] || 0,
      };
    });
    return { rows, truncated, details: buildFlagDetails(Object.values(byEmpDay).flat(), noShows, startDate, endDate) };
  }

  // Shared chart renderer for the custom Report Builder — Number and Table
  // are handled inline in the panel JSX since they aren't Recharts components.
  // Renders a report result (number/table/chart) from explicit params rather
  // than reading Report Builder's own state — this lets the exact same
  // rendering be reused for dashboard widgets, which have their own
  // independently-computed result.
  // Color for one row of a single-field chart/list: the shift type's or
  // employee's own color when grouped that way, otherwise the source color.
  function reportRowColor(label, grouping, fallback) {
    if (grouping === "Shift Type") return shiftTypes.find(s => s.label === label)?.color || fallback;
    if (grouping === "Employee") return allEmployees.find(e => e.name === label)?.color || fallback;
    return fallback;
  }
  const fmtReportVal = v => v == null ? "—" : typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v;

  function renderReportResult(data, vizType, grouping, fieldKeys, truncated, emptyReason) {
    if (fieldKeys.length===0 || data.length===0) return (
      <div role="status" style={{textAlign:"center",padding:"24px 12px",marginBottom:12,border:`1px dashed ${UI.line}`,borderRadius:12}}>
        <div style={{fontSize:14,fontWeight:800,color:UI.ink}}>0 results found</div>
        <div style={{fontSize:12,color:UI.sub,marginTop:4,lineHeight:1.5}}>{emptyReason || "Nothing matches these filters for this date range. Try fewer filters or a wider range."}</div>
      </div>
    );
    const numKeys = fieldKeys.filter(f => !f.text);
    let body;
    if (vizType === "number") {
      body = (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:12}}>
          {numKeys.map((f, i) => {
            const vals = data.map(r => r[f.key]).filter(v => v !== undefined && v !== null);
            const cur = vals[vals.length-1] ?? 0, first = vals[0];
            const delta = vals.length > 1 && first ? ((cur - first) / Math.abs(first)) * 100 : null;
            return (
              <div key={f.key} style={{background:UI.pastels[i % UI.pastels.length],borderRadius:16,padding:"14px 16px",minWidth:0}}>
                <div style={{fontSize:12,fontWeight:600,color:UI.sub}}>{f.label}</div>
                <div style={{fontSize:24,fontWeight:800,color:UI.ink,marginTop:4,lineHeight:1.1}}>{fmtReportVal(cur)}</div>
                {delta != null && <div style={{fontSize:11.5,fontWeight:700,color:delta>=0?UI.up:UI.down,marginTop:3}}>{delta>=0?"▲":"▼"} {Math.abs(delta).toFixed(1)}% vs. start</div>}
              </div>
            );
          })}
        </div>
      );
    } else if (vizType === "list") {
      const f0 = numKeys[0];
      const rows = f0 ? [...data].filter(r => r[f0.key] != null).sort((x, y) => (y[f0.key]||0) - (x[f0.key]||0)) : [];
      const max = rows.length ? Math.max(...rows.map(r => Math.abs(r[f0.key]||0))) : 0;
      body = !f0 ? <div style={{fontSize:12.5,color:UI.sub}}>Pick at least one number field for a list.</div> : (
        <div style={{display:"flex",flexDirection:"column",gap:11,marginBottom:12,maxHeight:420,overflowY:"auto"}}>
          {rows.map((r, i) => (
            <div key={i}>
              <div style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:12.5}}>
                <span style={{color:UI.ink,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.label}</span>
                <span style={{color:UI.sub,whiteSpace:"nowrap"}}>
                  <strong style={{color:UI.ink}}>{fmtReportVal(r[f0.key])}</strong>
                  {numKeys.slice(1, 3).map(f => <span key={f.key}> · {fmtReportVal(r[f.key])}</span>)}
                </span>
              </div>
              <div style={{height:4,background:UI.line,borderRadius:2,marginTop:5}}>
                <div style={{height:"100%",width:`${max ? Math.abs(r[f0.key]||0)/max*100 : 0}%`,background:reportRowColor(r.label, grouping, f0.color),borderRadius:2}}/>
              </div>
            </div>
          ))}
          <div style={{fontSize:10.5,color:UI.sub}}>Ranked by {f0.label}{numKeys.length > 1 ? ` · also: ${numKeys.slice(1,3).map(f=>f.label).join(", ")}` : ""}</div>
        </div>
      );
    } else if (vizType === "table") {
      body = (
        <div style={{maxHeight:360,overflowY:"auto",overflowX:"auto",WebkitOverflowScrolling:"touch",marginBottom:12}}>
          <table style={{width:"100%",minWidth:420,borderCollapse:"collapse",fontSize:12.5}}>
            <thead><tr>
              <th style={{textAlign:"left",padding:"8px 6px",fontSize:11,fontWeight:700,color:UI.sub,borderBottom:`1px solid ${UI.line}`,position:"sticky",top:0,background:UI.panel}}>{grouping}</th>
              {fieldKeys.map(f=><th key={f.key} style={{textAlign:f.text?"left":"right",padding:"8px 6px",fontSize:11,fontWeight:700,color:UI.sub,borderBottom:`1px solid ${UI.line}`,position:"sticky",top:0,background:UI.panel}}>{f.label}</th>)}
            </tr></thead>
            <tbody>
              {data.map((row,i)=>(
                <tr key={i}>
                  <td style={{padding:"9px 6px",borderBottom:`1px solid ${UI.line}`,color:UI.ink,fontWeight:600}}>{row.label}</td>
                  {fieldKeys.map(f=><td key={f.key} style={{padding:"9px 6px",borderBottom:`1px solid ${UI.line}`,textAlign:f.text?"left":"right",color:f.text?UI.sub:UI.ink}}>{fmtReportVal(row[f.key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    } else {
      body = (
        <div style={{marginBottom:12}}>
          {renderCustomReportChart(data, vizType, numKeys, grouping)}
          {fieldKeys.some(f=>f.text) && <div style={{fontSize:10.5,color:UI.sub,marginTop:4}}>Text fields like Conditions show in Table view and CSV export.</div>}
        </div>
      );
    }
    return (
      <>
        {body}
        {truncated && (
          <div style={{fontSize:11,color:"#8A5A00",marginBottom:10,display:"flex",gap:6,alignItems:"flex-start"}}>
            <span>⚠️</span><span>One or more sources hit their data cap for this range — pick a shorter range for a complete picture.</span>
          </div>
        )}
      </>
    );
  }

  function fieldKeysFromConfig(sourcesConfig) {
    const keys = [];
    Object.keys(sourcesConfig || {}).forEach(sid => {
      (sourcesConfig[sid]?.fields||[]).forEach(fid => {
        const fieldDef = REPORT_SOURCES[sid]?.fields.find(f=>f.id===fid);
        keys.push({ key:`${sid}__${fid}`, label: fieldDef?.label || fid, color: REPORT_SOURCES[sid]?.color, text: !!fieldDef?.text });
      });
    });
    return keys;
  }

  // ── Dashboard report widgets ────────────────────────────────────────────
  // Report widgets store their DEFINITION (sources/fields/filters/grouping/
  // date range/viz type), never a computed snapshot. This effect re-runs
  // every report widget's computation whenever the underlying data changes,
  // so they stay live without ever needing to be recreated.
  const [reportWidgetData, setReportWidgetData] = useState({}); // { [widgetId]: {loading, result, error} }

  // Overview "Top items this week" (from Square item sales)
  const [ovItems, setOvItems] = useState(null); // { week, loading, error, rows }
  async function loadOverviewItems(week) {
    if (!bizId) return;
    setOvItems({ week, loading: true, rows: [] });
    try {
      const end = addDays(week, 6);
      const rows = (await dbGet(`sales_items_daily?select=item_key,item_name,quantity,revenue&business_id=eq.${bizId}&sale_date=gte.${week}&sale_date=lte.${end}&limit=5000`)) || [];
      const by = {};
      rows.forEach(r => { const b = (by[r.item_key] ||= { key: r.item_key, name: r.item_name || "Item", units: 0, sales: 0 }); b.units += Number(r.quantity) || 0; b.sales += Number(r.revenue) || 0; });
      setOvItems({ week, loading: false, rows: Object.values(by).sort((a, b) => b.sales - a.sales).slice(0, 6) });
    } catch (e) { console.warn("Top items unavailable:", e); setOvItems({ week, loading: false, error: true, rows: [] }); }
  }
  useEffect(() => { if (tab === "dashboard" && bizId) loadOverviewItems(payWeek); }, [tab, payWeek, bizId]);

  // Actual payroll needs the whole week's punches (the app only keeps the latest 200 in memory).
  async function loadOverviewPayPunches(week) {
    setOvPayPunches({ week, rows: [], loading: true });
    try {
      const { rows } = await fetchPunchesForRange(bizId, week, addDays(week, 6));
      setOvPayPunches({ week, rows, loading: false });
    } catch (e) {
      setOvPayPunches({ week, rows: [], loading: false, error: true });
    }
  }
  useEffect(() => {
    if (tab === "dashboard" && bizId && payrollMode === "actual") loadOverviewPayPunches(payWeek); // fresh each time, so today's punches show
  }, [tab, payWeek, bizId, payrollMode]);

  useEffect(() => {
    const reportWidgets = widgets.filter(w => w.config?.report);
    if (reportWidgets.length === 0) return;
    let cancelled = false;
    reportWidgets.forEach(async (w) => {
      const def = w.config.report;
      setReportWidgetData(prev => ({ ...prev, [w.id]: { ...(prev[w.id]||{}), loading: true, error: null } }));
      try {
        let startDate, endDate;
        if (def.preset === "custom") { startDate = def.customStart; endDate = def.customEnd; }
        else {
          const dates = getFilterDates(def.preset, salesData, isDemoBiz ? DEMO_TODAY_ANCHOR : undefined);
          startDate = dates[0]; endDate = dates[dates.length-1];
        }
        const activeIds = Object.keys(def.sources || {});
        const sourceFilters = {};
        activeIds.forEach(sid => { sourceFilters[sid] = def.sources[sid]?.filters || {}; });
        const result = await runCustomReport(activeIds, null, sourceFilters, def.grouping, startDate, endDate);
        if (!cancelled) setReportWidgetData(prev => ({ ...prev, [w.id]: { loading:false, error:null, result } }));
      } catch (e) {
        if (!cancelled) setReportWidgetData(prev => ({ ...prev, [w.id]: { loading:false, error:e, result:null } }));
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgets, salesData, schedule, employees, punches, pulseHistory, shiftTypes]);

  async function addReportWidgetToDashboard(title) {
    if (!bizId || widgetSaving) return;
    setWidgetSaving(true);
    try {
      const activeIds = rbActiveSourceIds();
      const sources = {};
      activeIds.forEach(sid => { sources[sid] = { fields: rbSources[sid]?.fields || [], filters: rbSources[sid]?.filters || {} }; });
      const reportDef = {
        title: title?.trim() || "Custom Report",
        sources, grouping: rbGrouping, preset: rbPreset,
        customStart: rbPreset==="custom" ? rbCustomStart : null,
        customEnd: rbPreset==="custom" ? rbCustomEnd : null,
        vizType: rbVizType,
      };
      const { w, h } = WIDGET_SIZES.lg || WIDGET_SIZES.md || WIDGET_SIZES.sm;
      const [row] = await dbPost("dashboard_widgets", {
        business_id: bizId,
        config: { report: reportDef },
        grid_w: w, grid_h: h,
        sort_order: widgets.length,
      });
      setWidgets(prev => [...prev, row]);
      showToast("Added to Dashboard — it'll stay live and update on its own ✓", 5000);
    } catch(e) {
      showError(friendlyError(e, "Couldn't add that to the dashboard — try again."));
    } finally {
      setWidgetSaving(false);
    }
  }

  function renderCustomReportChart(data, vizType, fieldKeys, grouping) {
    const height = 260;
    const axes = (
      <>
        <CartesianGrid stroke={UI.line} vertical={false}/>
        <XAxis dataKey="label" stroke={UI.sub} fontSize={11} tickLine={false} axisLine={false} minTickGap={12}/>
        <YAxis stroke={UI.sub} fontSize={11} tickLine={false} axisLine={false} width={44}/>
        <RTooltip formatter={v => fmtReportVal(v)} contentStyle={{fontSize:11.5,borderRadius:10,border:`1px solid ${UI.line}`,background:"#FFFFFF"}}/>
        {fieldKeys.length > 1 && <RLegend iconType="plainline" wrapperStyle={{fontSize:11,color:UI.sub}}/>}
      </>
    );
    const margin = { top: 18, right: 8, left: -6, bottom: 0 };
    const single = fieldKeys.length === 1;
    const valueLabels = data.length <= 14; // value labels only when they'll fit
    if (vizType === "line") return (
      <ResponsiveContainer width="100%" height={height}><RLineChart data={data} margin={margin}>{axes}
        {fieldKeys.map(f=><Line key={f.key} type="monotone" dataKey={f.key} name={f.label} stroke={f.color} strokeWidth={2.4} dot={data.length <= 14 ? {r:2.5} : false} activeDot={{r:4}} connectNulls/>)}
      </RLineChart></ResponsiveContainer>
    );
    if (vizType === "bar") return (
      <ResponsiveContainer width="100%" height={height}><RBarChart data={data} margin={margin}>{axes}
        {fieldKeys.map(f=>(
          <Bar key={f.key} dataKey={f.key} name={f.label} fill={f.color} radius={[9,9,9,9]} maxBarSize={34}>
            {single && data.map((r, i) => <Cell key={i} fill={reportRowColor(r.label, grouping, f.color)}/>)}
            {single && valueLabels && <LabelList dataKey={f.key} position="top" formatter={v => fmtReportVal(v)} style={{fontSize:11,fontWeight:700,fill:UI.ink}}/>}
          </Bar>
        ))}
      </RBarChart></ResponsiveContainer>
    );
    if (vizType === "area") return (
      <ResponsiveContainer width="100%" height={height}><RAreaChart data={data} margin={margin}>{axes}
        {fieldKeys.map(f=><RArea key={f.key} type="monotone" dataKey={f.key} name={f.label} stroke={f.color} strokeWidth={2.4} fill={f.color} fillOpacity={0.12} connectNulls/>)}
      </RAreaChart></ResponsiveContainer>
    );
    if (vizType === "combo") return (
      <ResponsiveContainer width="100%" height={height}><RComposedChart data={data} margin={margin}>{axes}
        {fieldKeys.map((f,i)=>{
          if (i===0) return <RArea key={f.key} type="monotone" dataKey={f.key} name={f.label} stroke={f.color} strokeWidth={2} fill={f.color} fillOpacity={0.12}/>;
          if (i===1) return <Line key={f.key} type="monotone" dataKey={f.key} name={f.label} stroke={f.color} strokeWidth={2.4} dot={false}/>;
          return <Bar key={f.key} dataKey={f.key} name={f.label} fill={f.color} radius={[9,9,9,9]} maxBarSize={30}/>;
        })}
      </RComposedChart></ResponsiveContainer>
    );
    return null;
  }

  // ── SHIFT-TYPE ATTRIBUTION ENGINE ───────────────────────────────────────
  // Hours + labor cost come from actual punches, each matched to that day's
  // scheduled shift for its type. Sales are credited hour-by-hour: each hour's
  // Square sales (sales_hourly) split among whoever was clocked in that hour,
  // by minutes worked. Days without hourly data fall back to splitting the
  // day's total by each type's share of labor hours (marked as estimated).
  // A shift tagged Manager always counts as Manager.
  function isManagerType(id) {
    if (id === "manager") return true;
    const st = shiftTypes.find(s => s.id === id);
    return !!st && /manager/i.test(st.label || "");
  }
  function resolveShiftTypeKey(shift) {
    if (!shift) return SHIFT_UNSCHEDULED;
    const ids = toTypeArr(shift.type);
    const pick = ids.find(isManagerType) || ids[0];
    return shiftTypes.some(s => s.id === pick) ? pick : SHIFT_REMOVED;
  }
  function shiftTypeMeta(key) {
    if (key === SHIFT_UNSCHEDULED) return { label:"Unscheduled", color:"#8A8A8A" };
    if (key === SHIFT_REMOVED) return { label:"Removed type", color:"#B0A99F" };
    const st = shiftTypes.find(s => s.id === key);
    return { label: st?.label || "(unnamed)", color: st?.color || "#888888" };
  }

  // Missing table, no rows, or any error → [] and the estimate takes over.
  async function fetchHourlySales(startDate, endDate) {
    if (!bizId) return [];
    const out = []; const PAGE = 1000; let offset = 0;
    try {
      while (out.length < 20000) {
        const rows = await dbGet(`sales_hourly?select=sale_date,hour,revenue&business_id=eq.${bizId}&sale_date=gte.${startDate}&sale_date=lte.${endDate}&order=sale_date.asc,hour.asc&limit=${PAGE}&offset=${offset}`);
        if (!rows?.length) break;
        out.push(...rows);
        if (rows.length < PAGE) break;
        offset += PAGE;
      }
    } catch (e) { console.warn("Hourly sales unavailable — using estimates:", e); return []; }
    return out;
  }

  async function computeShiftTypeAttribution(startDate, endDate) {
    const [{ rows: rawPunches, truncated }, hourlyRows] = await Promise.all([
      fetchPunchesForRange(bizId, startDate, endDate),
      fetchHourlySales(startDate, endDate),
    ]);
    const rateById = {};
    allEmployees.forEach(e => { rateById[e.id] = parseFloat(e.hourlyRate)||0; });
    const todayStr = toLocalDateStr(new Date());

    const byEmpDay = {};
    rawPunches.forEach(p => {
      if (!p.time) return;
      const d = toLocalDateStr(new Date(p.time));
      if (d < startDate || d > endDate) return;
      (byEmpDay[`${p.empId}__${d}`] ||= []).push(p);
    });

    const slots = {};      // "date|hour" -> { typeKey: { minutes, cost } }
    const byDateType = {}; // date -> { typeKey: { minutes, cost, revenue, estRevenue } }
    const lastHour = {};   // typeKey -> { date: last hour worked }
    const empStats = {};   // empId -> { minutes, cost, revenue, byType, dates }
    const slotEmp = {};    // "date|hour" -> { empId: minutes }
    const dayEmp = {};     // date -> { empId: minutes }
    Object.entries(byEmpDay).forEach(([k, dayPunches]) => {
      const [empId, dateStr] = k.split("__");
      const dow = new Date(dateStr+"T12:00:00").getDay();
      const typeKey = resolveShiftTypeKey(schedule?.[getSunday(dateStr)]?.[empId]?.[dow] || null);
      const rate = rateById[empId] || 0;
      // Same pairing rules as calcActualHours, so hours match the Timesheet
      const sorted = [...dayPunches].sort((a,b)=>new Date(a.time)-new Date(b.time));
      const intervals = []; let inT = null;
      for (const p of sorted) {
        if (p.type==="in" || p.type==="break_in") inT = new Date(p.time).getTime();
        else if (p.type==="out" && inT != null) { intervals.push([inT, new Date(p.time).getTime()]); inT = null; }
      }
      if (inT != null && dateStr === todayStr) intervals.push([inT, Date.now()]);
      for (const [s, e] of intervals) {
        let t = s;
        while (t < e) {
          const next = Math.min(e, (Math.floor(t/3600000)+1)*3600000);
          const { date, hour } = centralDateHour(t);
          if (date >= startDate && date <= endDate) {
            const mins = (next - t) / 60000;
            const cost = mins / 60 * rate;
            const slot = ((slots[`${date}|${hour}`] ||= {})[typeKey] ||= { minutes:0, cost:0 });
            slot.minutes += mins; slot.cost += cost;
            const dt = ((byDateType[date] ||= {})[typeKey] ||= { minutes:0, cost:0, revenue:0, estRevenue:0 });
            dt.minutes += mins; dt.cost += cost;
            const lh = (lastHour[typeKey] ||= {});
            if (lh[date] == null || hour > lh[date]) lh[date] = hour;
            const es = (empStats[empId] ||= { minutes:0, cost:0, revenue:0, byType:{}, dates:new Set() });
            es.minutes += mins; es.cost += cost; es.byType[typeKey] = (es.byType[typeKey]||0) + mins; es.dates.add(date);
            const se = (slotEmp[`${date}|${hour}`] ||= {}); se[empId] = (se[empId]||0) + mins;
            const de = (dayEmp[date] ||= {}); de[empId] = (de[empId]||0) + mins;
          }
          t = next;
        }
      }
    });

    const hourly = {}; const hourlyDates = new Set();
    hourlyRows.forEach(r => {
      const k = `${r.sale_date}|${r.hour}`;
      hourly[k] = (hourly[k]||0) + (Number(r.revenue)||0);
      hourlyDates.add(r.sale_date);
    });
    const dailyRev = {};
    salesData.forEach(d => { dailyRev[d.date] = (dailyRev[d.date]||0) + (Number(d.revenue)||0); });

    const slotRevenue = {};     // "date|hour" -> { typeKey: revenue credited }
    const uncoveredByDate = {}; // sales with no one on the clock
    let matchedRevenue = 0, estimatedRevenue = 0;
    datesInRange(startDate, endDate).forEach(date => {
      const types = byDateType[date] || {};
      if (hourlyDates.has(date)) {
        for (let h = 0; h < 24; h++) {
          const rev = hourly[`${date}|${h}`] || 0;
          if (!rev) continue;
          matchedRevenue += rev;
          const slot = slots[`${date}|${h}`];
          const totalMin = slot ? Object.values(slot).reduce((s,x)=>s+x.minutes,0) : 0;
          if (!totalMin) { uncoveredByDate[date] = (uncoveredByDate[date]||0) + rev; continue; }
          Object.entries(slot).forEach(([tk, x]) => {
            const share = rev * x.minutes / totalMin;
            types[tk].revenue += share;
            const sr = (slotRevenue[`${date}|${h}`] ||= {});
            sr[tk] = (sr[tk]||0) + share;
          });
          Object.entries(slotEmp[`${date}|${h}`] || {}).forEach(([eid, m]) => { if (empStats[eid]) empStats[eid].revenue += rev * m / totalMin; });
        }
      } else {
        const rev = dailyRev[date] || 0;
        if (!rev) return;
        estimatedRevenue += rev;
        const totalMin = Object.values(types).reduce((s,x)=>s+x.minutes,0);
        if (!totalMin) { uncoveredByDate[date] = (uncoveredByDate[date]||0) + rev; return; }
        Object.values(types).forEach(x => { const share = rev * x.minutes / totalMin; x.revenue += share; x.estRevenue += share; });
        Object.entries(dayEmp[date] || {}).forEach(([eid, m]) => { if (empStats[eid]) empStats[eid].revenue += rev * m / totalMin; });
      }
    });

    return { startDate, endDate, byDateType, slots, slotRevenue, lastHour, uncoveredByDate, empStats,
      matchedRevenue, estimatedRevenue, hourlyDates: [...hourlyDates], hasHourly: hourlyDates.size > 0, truncated };
  }

  // Totals per shift type, with a status against the owner's labor target
  // (on target = within 5 points; over = more than 5 above; lean = more than 5 below)
  function summarizeShiftTypes(attr, filterKeys, dateOk) {
    const totals = {};
    Object.entries(attr.byDateType).filter(([d]) => !dateOk || dateOk(d)).forEach(([, types]) => Object.entries(types).forEach(([tk, x]) => {
      if (filterKeys?.length && !filterKeys.includes(tk)) return;
      const t = (totals[tk] ||= { minutes:0, cost:0, revenue:0, estRevenue:0 });
      t.minutes += x.minutes; t.cost += x.cost; t.revenue += x.revenue; t.estRevenue += x.estRevenue;
    }));
    return Object.entries(totals).map(([key, t]) => {
      const hours = t.minutes / 60;
      const laborPct = t.revenue > 0 ? (t.cost / t.revenue) * 100 : null;
      const tgt = laborTargetPct || 30;
      const status = laborPct == null ? null : laborPct > tgt + 5 ? "over" : laborPct >= tgt - 5 ? "on" : "lean";
      return { key, ...shiftTypeMeta(key), hours, cost:t.cost, revenue:t.revenue, estRevenue:t.estRevenue,
        laborPct, rplh: hours > 0 && t.revenue > 0 ? t.revenue / hours : null, status };
    }).filter(r => r.hours > 0).sort((a,b) => (b.laborPct ?? -1) - (a.laborPct ?? -1));
  }

  // The "end it an hour earlier" rule: on each weekday, look at the LAST hour
  // this shift type works. Where that hour's credited sales averaged less than
  // its labor cost on 2+ occurrences, trimming it is the suggestion; the
  // weekly saving is that hour's average labor cost on each of those days.
  // Uses hourly-matched days only — estimates can't pin down a single hour.
  function shiftTypeTrimSuggestion(attr, typeKey) {
    const hourlySet = new Set(attr.hourlyDates);
    const byDow = {};
    Object.entries(attr.lastHour[typeKey] || {}).forEach(([date, hour]) => {
      if (!hourlySet.has(date)) return;
      const cost = attr.slots[`${date}|${hour}`]?.[typeKey]?.cost || 0;
      const revenue = attr.slotRevenue[`${date}|${hour}`]?.[typeKey] || 0;
      (byDow[new Date(date+"T12:00:00").getDay()] ||= []).push({ cost, revenue });
    });
    const losing = Object.entries(byDow).map(([dow, list]) => ({
      dow: +dow, n: list.length,
      avgCost: list.reduce((s,x)=>s+x.cost,0) / list.length,
      avgRev:  list.reduce((s,x)=>s+x.revenue,0) / list.length,
    })).filter(d => d.n >= 2 && d.avgRev < d.avgCost).sort((a,b) => a.dow - b.dow);
    if (!losing.length) return null;
    return {
      days: losing.map(d => DAYS[d.dow]),
      avgCost: losing.reduce((s,d)=>s+d.avgCost,0) / losing.length,
      avgRev:  losing.reduce((s,d)=>s+d.avgRev,0) / losing.length,
      weeklySavings: losing.reduce((s,d)=>s+d.avgCost,0),
    };
  }

  async function computeShiftTypeReport(startDate, endDate, grouping, filters={}) {
    const attr = await computeShiftTypeAttribution(startDate, endDate);
    const keys = filters.shiftType?.length ? filters.shiftType : null;
    const fmtRow = (label, t) => {
      const hours = t.minutes / 60;
      return {
        label,
        shifttypes__hours: Math.round(hours*100)/100,
        shifttypes__cost: Math.round(t.cost*100)/100,
        shifttypes__revenue: Math.round(t.revenue*100)/100,
        shifttypes__laborPct: t.revenue > 0 ? Math.round(t.cost/t.revenue*1000)/10 : null,
        shifttypes__rplh: hours > 0 && t.revenue > 0 ? Math.round(t.revenue/hours*100)/100 : null,
      };
    };
    if (grouping === "Shift Type") {
      const rows = summarizeShiftTypes(attr, keys, d => weatherOk(d, filters)).map(r => fmtRow(r.label, { minutes: r.hours*60, cost: r.cost, revenue: r.revenue }));
      const uncovered = Object.entries(attr.uncoveredByDate).filter(([d]) => weatherOk(d, filters)).reduce((s,[,v])=>s+v,0);
      if (!keys && uncovered > 0) {
        rows.push({ label:"No one on clock", shifttypes__hours:0, shifttypes__cost:0,
          shifttypes__revenue: Math.round(uncovered*100)/100, shifttypes__laborPct:null, shifttypes__rplh:null });
      }
      return { rows, truncated: attr.truncated };
    }
    const buckets = {};
    Object.entries(attr.byDateType).forEach(([date, types]) => {
      if (!weatherOk(date, filters)) return;
      const b = (buckets[reportBucketKey(date, grouping)] ||= { minutes:0, cost:0, revenue:0 });
      Object.entries(types).forEach(([tk, x]) => {
        if (keys && !keys.includes(tk)) return;
        b.minutes += x.minutes; b.cost += x.cost; b.revenue += x.revenue;
      });
    });
    const rows = reportBucketKeysInRange(startDate, endDate, grouping)
      .map(key => fmtRow(reportBucketLabel(key, grouping), buckets[key] || { minutes:0, cost:0, revenue:0 }));
    return { rows, truncated: attr.truncated };
  }

  // ── WEATHER REPORT ──────────────────────────────────────────────────────
  // Reviews weather over time. Day: that day's conditions (with how they
  // changed), high/low, rain. Week / Day of Week: average high/low, total
  // rain, number of wet days, and a count of each condition.
  async function computeWeatherReport(startDate, endDate, grouping, filters={}) {
    const map = weatherMapRef.current;
    const label = c => (WEATHER_CONDITIONS.find(([v]) => v === c) || [c, c])[1];
    const dates = datesInRange(startDate, endDate).filter(d => map[d] && weatherOk(d, filters));
    const buckets = {};
    dates.forEach(d => { (buckets[reportBucketKey(d, grouping)] ||= []).push(map[d]); });
    const rows = reportBucketKeysInRange(startDate, endDate, grouping).map(key => {
      const list = buckets[key] || [];
      const avg = f => { const v = list.map(x => x[f]).filter(x => x != null); return v.length ? Math.round(v.reduce((s,x)=>s+Number(x),0) / v.length) : null; };
      let condition = "—";
      if (list.length === 1 && grouping === "Day") condition = list[0].timeline || label(list[0].condition);
      else if (list.length) {
        const counts = {}; list.forEach(x => { counts[x.condition] = (counts[x.condition]||0) + 1; });
        condition = Object.entries(counts).sort((a,b) => b[1]-a[1]).map(([c,n]) => `${n} ${label(c).toLowerCase()}`).join(" · ");
      }
      return {
        label: reportBucketLabel(key, grouping),
        weather__condition: condition,
        weather__highF: avg("high_f"),
        weather__lowF: avg("low_f"),
        weather__rainIn: list.length ? Math.round(list.reduce((s,x)=>s+(Number(x.precip_in)||0),0) * 100) / 100 : null,
        weather__wetDays: list.length ? list.filter(x => ["rainy","storm","snowy"].includes(x.condition)).length : null,
      };
    });
    return { rows, truncated: false };
  }

  // ── ITEM SALES REPORT ───────────────────────────────────────────────────
  // From sales_items_daily (Square catalog items, sales before tax).
  // "Share" = these items' sales ÷ ALL item sales in the same bucket.
  const ITEM_REPORT_MAX_ROWS = 50000;
  async function computeItemSalesReport(startDate, endDate, grouping, filters={}) {
    if (!bizId) return { rows: [], truncated: false };
    const all = []; const PAGE = 1000; let offset = 0; let truncated = false;
    while (true) {
      const page = await dbGet(`sales_items_daily?select=sale_date,item_key,item_name,quantity,revenue&business_id=eq.${bizId}&sale_date=gte.${startDate}&sale_date=lte.${endDate}&order=sale_date.asc&limit=${PAGE}&offset=${offset}`);
      if (!page?.length) break;
      all.push(...page);
      if (page.length < PAGE) break;
      offset += PAGE;
      if (all.length >= ITEM_REPORT_MAX_ROWS) { truncated = true; break; }
    }
    const pickItems = filters.item?.length ? new Set(filters.item) : null;
    const inDow = ds => (!filters.dow?.length || filters.dow.includes(reportDowOf(ds))) && weatherOk(ds, filters);
    const rowsIn = all.filter(r => inDow(r.sale_date));
    const fmt = (label, units, sales, denom) => ({
      label,
      itemsales__units: Math.round(units * 100) / 100,
      itemsales__sales: Math.round(sales * 100) / 100,
      itemsales__avgPrice: units > 0 ? Math.round(sales / units * 100) / 100 : null,
      itemsales__share: denom > 0 ? Math.round(sales / denom * 1000) / 10 : null,
    });

    if (grouping === "Item") {
      const byItem = {}; let allSales = 0;
      rowsIn.forEach(r => {
        const rev = Number(r.revenue) || 0; allSales += rev;
        if (pickItems && !pickItems.has(r.item_key)) return;
        const b = (byItem[r.item_key] ||= { name: r.item_name || "Item", units: 0, sales: 0 });
        b.units += Number(r.quantity) || 0; b.sales += rev;
        if (r.item_name) b.name = r.item_name;
      });
      const rows = Object.values(byItem).sort((a,b) => b.sales - a.sales).map(b => fmt(b.name, b.units, b.sales, allSales));
      return { rows, truncated };
    }

    const buckets = {}; const denomByKey = {};
    rowsIn.forEach(r => {
      const key = reportBucketKey(r.sale_date, grouping);
      const rev = Number(r.revenue) || 0;
      denomByKey[key] = (denomByKey[key] || 0) + rev;
      if (pickItems && !pickItems.has(r.item_key)) return;
      const b = (buckets[key] ||= { units: 0, sales: 0 });
      b.units += Number(r.quantity) || 0; b.sales += rev;
    });
    const rows = reportBucketKeysInRange(startDate, endDate, grouping).map(key => {
      const b = buckets[key] || { units: 0, sales: 0 };
      return fmt(reportBucketLabel(key, grouping), b.units, b.sales, denomByKey[key] || 0);
    });
    return { rows, truncated };
  }

  // Insights card body for Shift Type Efficiency
  function renderShiftTypeRows(data) {
    const STATUS = {
      over: { label:"Over target", color:"#A93226" },
      on:   { label:"On target",   color:"#2D6A4F" },
      lean: { label:"Lean",        color:"#9A6510" },
    };
    const footnote = data.matchedPct == null ? "No sales in this period."
      : data.matchedPct === 100 ? "All sales matched to shifts by hour from Square."
      : data.matchedPct === 0 ? "Sales estimated by each shift type's share of labor hours (no hourly sales data)."
      : `${data.matchedPct}% of sales matched to shifts by hour from Square; the rest estimated by labor-hour share.`;
    const tgt = laborTargetPct || 30;
    const scaleMax = Math.max(50, Math.ceil((tgt + 15) / 10) * 10);
    const bandLeft = Math.max(0, tgt - 5) / scaleMax * 100;
    const bandWidth = 10 / scaleMax * 100;
    return (
      <div style={{borderTop:`1px solid ${T.border}`}}>
        {data.rows.map(r => {
          const st = STATUS[r.status];
          const barPct = r.laborPct == null ? 0 : Math.min(100, r.laborPct / scaleMax * 100);
          return (
            <div key={r.key} style={{padding:"9px 16px", borderBottom:`1px solid ${T.border}`, display:"flex", flexDirection:"column", gap:6}}>
              <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", gap:8}}>
                <div style={{display:"flex", alignItems:"center", gap:8, minWidth:0, flexWrap:"wrap"}}>
                  <span style={{width:10, height:10, borderRadius:3, background:r.color, flexShrink:0}}/>
                  <span style={{fontWeight:700, fontSize:13, color:T.text}}>{r.label}</span>
                  {st && <span style={{fontSize:10, fontWeight:700, color:st.color, background:st.color+"18", borderRadius:5, padding:"1px 6px"}}>{st.label}</span>}
                </div>
                <span style={{fontWeight:800, fontSize:16, color:r.status==="over"?"#A93226":T.text, flexShrink:0}}>{r.laborPct==null ? "—" : `${Math.round(r.laborPct)}%`}</span>
              </div>
              <div style={{position:"relative", height:8, background:T.muted, borderRadius:4}}>
                <div style={{position:"absolute", left:`${bandLeft}%`, width:`${bandWidth}%`, top:-3, bottom:-3, background:"rgba(45,106,79,0.18)", borderRadius:3}}/>
                <div style={{position:"absolute", left:0, top:0, bottom:0, width:`${barPct}%`, background:r.status==="over"?"#A93226":T.accent, borderRadius:4}}/>
              </div>
              <div style={{fontSize:11, color:T.sub}}>
                {r.hours.toFixed(1)}h · ${Math.round(r.cost).toLocaleString()} labor · ${Math.round(r.revenue).toLocaleString()} sales{r.rplh!=null ? ` · $${Math.round(r.rplh)} per labor hr` : ""}
              </div>
            </div>
          );
        })}
        <div style={{padding:"8px 16px", fontSize:10, color:T.sub}}>Shaded band = your {tgt}% target (±5) · bar scale 0–{scaleMax}%</div>
        {data.uncovered > 0 && (
          <div style={{margin:"0 16px 10px", padding:"9px 12px", background:"#FEF3E2", borderRadius:9, fontSize:12, color:"#6E4A0E", lineHeight:1.5}}>
            <strong>${Math.round(data.uncovered).toLocaleString()} in sales with no one clocked in.</strong> Usually the owner covering a gap.
          </div>
        )}
        <div style={{padding:"9px 16px 12px", borderTop:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap"}}>
          <span style={{fontSize:11, color:T.sub, lineHeight:1.5, flex:"1 1 200px"}}>{footnote}</span>
          <button onClick={()=>{ setTab("settings"); setSettingsSection("general"); setSettingsFolder("shifts"); }}
            style={{background:"none", border:"none", color:T.accent, fontWeight:700, fontSize:12, cursor:"pointer", padding:"8px 0"}}>
            Edit shift types
          </button>
        </div>
      </div>
    );
  }

  const REPORT_COMPUTE_FNS = {
    timesheet: computeTimesheetReport,
    flags: computeFlagsReport,
    revenue: (s,e,g,f) => Promise.resolve(computeRevenueReport(s,e,g,f)),
    laborcost: computeLaborCostReport,
    pulse: computePulseReport,
    shifttypes: computeShiftTypeReport,
    itemsales: computeItemSalesReport,
    weather: computeWeatherReport,
  };

  // Orchestrator — runs every active source in parallel and merges results
  // into one row set keyed by label (rows from different sources land on the
  // same chart row only when their labels match, e.g. same week or same
  // weekday — sources with mismatched bucket counts just leave gaps rather
  // than silently misaligning).
  async function runCustomReport(activeSourceIds, sourceFields, sourceFilters, grouping, startDate, endDate) {
    const needsWeather = activeSourceIds.includes("weather") || activeSourceIds.some(sid => sourceFilters[sid]?.weather?.length);
    if (needsWeather && bizId) {
      try {
        const rows = (await dbGet(`daily_weather?select=weather_date,condition,high_f,low_f,precip_in,timeline&business_id=eq.${bizId}&weather_date=gte.${startDate}&weather_date=lte.${endDate}&limit=5000`)) || [];
        const map = {}; rows.forEach(r => { map[r.weather_date] = r; });
        weatherMapRef.current = map;
      } catch (e) { console.warn("Weather unavailable:", e); weatherMapRef.current = {}; }
    }
    const results = await Promise.all(
      activeSourceIds.map(sid => REPORT_COMPUTE_FNS[sid](startDate, endDate, grouping, sourceFilters[sid] || {}))
    );
    const merged = {};
    const order = [];
    results.forEach(({ rows }) => {
      rows.forEach(row => {
        if (!merged[row.label]) { merged[row.label] = { label: row.label }; order.push(row.label); }
        Object.assign(merged[row.label], row);
      });
    });
    const anyTruncated = results.some(r => r.truncated);
    const fi = activeSourceIds.indexOf("flags"), ti = activeSourceIds.indexOf("timesheet");
    const tsFlagFields = (sourceFields?.timesheet || []).some(f => f === "flagged" || f === "noshows");
    const details = fi >= 0 ? results[fi].details : (ti >= 0 && tsFlagFields ? results[ti].details : null);
    return { data: order.map(l => merged[l]), truncated: anyTruncated, details: details || null };
  }


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
        setRawSales(prev => mergeSalesRows(prev, "square", data.salesData));
      }
      setSquareLastSync(data.lastSyncedAt || new Date().toISOString());
      showToast(`Square sales synced ✓${data.daysSynced ? ` (${data.daysSynced} days)` : ""}`, 4000);
      addAudit("Square Sync", `Synced sales data from Square${data.daysSynced ? ` — ${data.daysSynced} days` : ""}`);
    } catch(err) {
      showError(friendlyError(err, "Square sync failed — try again."));
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
      showError(friendlyError(err, "Couldn't disconnect Square — try again."));
    }
  }

  // ── DASHBOARD WIDGETS ────────────────────────────────────────────────────
  async function addWidget() {
    if (!bizId || widgetSaving) return;
    setWidgetSaving(true);
    try {
      const { w, h } = WIDGET_SIZES[newWidget.size] || WIDGET_SIZES.sm;
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
      setNewWidget({ data_source:"sales", time_range:"last7", display:"stat", color:null, size:"sm", show_axis:true, show_legend:true });
      showToast("Widget added ✓");
    } catch(e) {
      showError(friendlyError(e, "Couldn't add that widget — try again."));
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
    } catch(e) { console.warn("Reorder save failed:", e); showError(friendlyError(e, "Widget order didn't save — it may reset on reload.")); }
  }

  // Sets a widget to an explicit size (used by the size picker popover)
  async function setWidgetSize(id, sizeKey) {
    const { w, h } = WIDGET_SIZES[sizeKey] || WIDGET_SIZES.sm;
    setWidgets(prev => prev.map(item => item.id===id ? {...item, grid_w:w, grid_h:h} : item));
    setSizeMenuFor(null);
    try { await dbPatch(`dashboard_widgets?id=eq.${id}`, { grid_w:w, grid_h:h }); }
    catch(e) { console.warn("Resize save failed:", e); showError(friendlyError(e, "Widget size didn't save — it may reset on reload.")); }
  }

  async function removeWidget(id) {
    setWidgets(prev => prev.filter(w => w.id !== id));
    try { await dbDelete(`dashboard_widgets?id=eq.${id}`); }
    catch(e) { console.warn("Widget delete failed:", e); showError(friendlyError(e, "Couldn't remove that widget — try again.")); }
  }

  // ── EMPLOYEE EXITS ──────────────────────────────────────────────────────
  // Deactivating keeps the employee's history and freezes an exit summary,
  // computed once from the 12 weeks before they left (90 days for reliability).
  const addYearsStr = (ds, n) => { const [y,m,d] = ds.split("-"); return `${Number(y)+n}-${m}-${d}`; };

  // UI Batch 20 — live exit-review preview for the employee open in the roster
  const [rosterExit, setRosterExit] = useState(null); // { empId, data, loading, error }
  useEffect(() => {
    if (!editEmpId || !bizId) { setRosterExit(null); return; }
    const emp = employees.find(e => e.id === editEmpId);
    if (!emp || !emp.name) { setRosterExit(null); return; }
    let live = true;
    setRosterExit({ empId: emp.id, loading: true });
    computeExitSummary(emp, demoToday, "")
      .then(data => { if (live) setRosterExit({ empId: emp.id, data }); })
      .catch(() => { if (live) setRosterExit({ empId: emp.id, error: true }); });
    return () => { live = false; };
  }, [editEmpId, bizId]);

  // UI Batch 24 — value is measured on OPEN weeks the employee actually WORKED:
  // per-hour and per-shift rates, so time off the schedule (or a closed season)
  // never counts against them. Closed for the season → uses last season.
  async function computeExitSummary(emp, exitDate, reason) {
    const si = seasonInfo(exitDate, season);
    const basisKind = si.seasonal && !si.open && si.last ? "season" : "recent";
    const winStart = basisKind === "season" ? si.last.start : addDays(exitDate, -83);
    const winEnd   = basisKind === "season" ? si.last.end : exitDate;
    const [attr, pRes, firstRows, noShowRows] = await Promise.all([
      computeShiftTypeAttribution(winStart, winEnd),
      fetchPunchesForRange(bizId, winStart, winEnd),
      dbGet(`punches?select=punched_at&business_id=eq.${bizId}&employee_id=eq.${emp.id}&order=punched_at.asc&limit=1`).catch(() => []),
      dbGet(`attendance_events?select=employee_id,event_date&business_id=eq.${bizId}&event_type=eq.NO_SHOW&event_date=gte.${winStart}&event_date=lte.${winEnd}&limit=5000`).catch(() => []),
    ]);
    const firstName = (emp.name || "They").split(" ")[0];
    const firstPunch = firstRows?.[0]?.punched_at ? toLocalDateStr(new Date(String(firstRows[0].punched_at).replace(" ","T"))) : null;
    const created = emp.createdAt ? String(emp.createdAt).slice(0,10) : null;
    const tenureStart = [firstPunch, created].filter(Boolean).sort()[0] || null;
    const tenureDays = tenureStart ? Math.max(1, Math.round((new Date(exitDate+"T12:00:00") - new Date(tenureStart+"T12:00:00")) / 86400000) + 1) : null;

    // Open weeks in the window (a week counts if any day in it was open)
    const openWeeks = new Set();
    for (let d = winStart; d <= winEnd; d = addDays(d, 1)) if (openDay(d)) openWeeks.add(getSunday(d));
    const es = attr.empStats?.[emp.id] || { minutes:0, cost:0, revenue:0, byType:{}, dates:new Set() };
    const workedDays = [...es.dates].filter(d => openDay(d));
    const weeksWorked = new Set(workedDays.map(d => getSunday(d))).size;
    const hours = es.minutes / 60;
    const hoursPerWeek = weeksWorked ? hours / weeksWorked : 0;
    const salesPerHour = hours > 0 ? es.revenue / hours : null;
    const costPerHour = hours > 0 ? es.cost / hours : null;
    const teamMin = Object.values(attr.empStats || {}).reduce((s, x) => s + x.minutes, 0);
    const teamRev = Object.values(attr.empStats || {}).reduce((s, x) => s + x.revenue, 0);
    const teamSalesPerHour = teamMin > 0 ? teamRev / (teamMin / 60) : null;

    const dowCounts = [0,0,0,0,0,0,0];
    workedDays.forEach(d => { dowCounts[new Date(d+"T12:00:00").getDay()]++; });
    let usual = dowCounts.map((c, i) => ({ i, c })).filter(x => x.c >= Math.max(2, Math.ceil(weeksWorked * 0.33)));
    if (!usual.length) usual = dowCounts.map((c, i) => ({ i, c })).filter(x => x.c > 0).sort((a,b) => b.c - a.c).slice(0, 3);
    const usualIdx = usual.map(x => x.i).sort((a,b) => a - b);

    const mainTypeKey = Object.entries(es.byType).sort((a,b) => b[1] - a[1])[0]?.[0] || null;
    const typeTotalMin = mainTypeKey ? Object.values(attr.byDateType).reduce((s, types) => s + (types[mainTypeKey]?.minutes || 0), 0) : 0;

    // Reliability per shift worked (a shift = a day with a clock-in), for them and the team
    const rows = pRes.rows || [];
    const shiftsBy = {}, flagBy = {};
    rows.forEach(p => {
      if (!p.time) return;
      const ds = toLocalDateStr(new Date(p.time));
      if (p.type === "in") (shiftsBy[p.empId] ||= new Set()).add(ds);
      (p.flags || []).forEach(f => { const k = `${p.empId}|${f}`; flagBy[k] = (flagBy[k] || 0) + 1; });
    });
    const shiftsWorked = shiftsBy[emp.id]?.size || 0;
    const late = flagBy[`${emp.id}|LATE`] || 0, earlyOut = flagBy[`${emp.id}|EARLY_OUT`] || 0;
    const noShows = (noShowRows || []).filter(r => r.employee_id === emp.id).length;
    const teamShifts = Object.values(shiftsBy).reduce((s, x) => s + x.size, 0);
    const teamLate = Object.entries(flagBy).filter(([k]) => k.endsWith("|LATE")).reduce((s, [, v]) => s + v, 0);
    const rate = (n, d) => d > 0 ? n / d : null;

    const peers = employees.filter(e => e.id !== emp.id && emp.role && e.role === emp.role && parseFloat(e.hourlyRate) > 0);
    const replaceRate = peers.length ? peers.reduce((s, e) => s + parseFloat(e.hourlyRate), 0) / peers.length : (parseFloat(emp.hourlyRate) || 0);
    const rateBasis = peers.length ? `the average ${emp.role} rate on your team` : `${firstName}'s rate`;
    const replaceWeekly = hoursPerWeek * replaceRate;

    const gaps = usualIdx.map(i => {
      const others = employees.filter(e => e.id !== emp.id && (e.availableDays ?? [0,1,2,3,4,5,6]).includes(i));
      return others.length <= 1 ? { day: DAY_FULL[i], names: others.map(e => e.name || "Unnamed") } : null;
    }).filter(Boolean);

    const basisText = basisKind === "season"
      ? `Closed since ${dl(si.last.end)}. Using the ${si.last.start.slice(0,4)} season (${dl(si.last.start)} – ${dl(si.last.end)}), where ${firstName} worked ${weeksWorked} of ${openWeeks.size} open weeks.`
      : `Last 12 weeks: ${firstName} worked ${weeksWorked} of ${openWeeks.size} open week${openWeeks.size!==1?"s":""}.`;
    let headline;
    if (es.minutes === 0) headline = `${firstName} didn't work any open weeks in this period, so there are no hours to replace.`;
    else {
      headline = `Losing ${firstName} costs about ${fmtMoney(replaceWeekly)} a week to replace${gaps.length ? ` and leaves ${gaps.map(g => g.day).join(" and ")} thin` : ""}.`;
      if (salesPerHour != null && teamSalesPerHour != null && attr.hasHourly) {
        const cmp = salesPerHour >= teamSalesPerHour * 1.05 ? "above" : salesPerHour <= teamSalesPerHour * 0.95 ? "below" : "about even with";
        headline += ` ${firstName} brings in ${fmtMoney(salesPerHour)} of sales per hour worked — ${cmp} the team's ${fmtMoney(teamSalesPerHour)}.`;
      }
    }

    return {
      v: 2, name: emp.name || "", role: emp.role || "", color: emp.color || "#888888",
      exitedAt: exitDate, reason: reason || "", tenureStart, tenureDays,
      basis: { kind: basisKind, start: winStart, end: winEnd, openWeeks: openWeeks.size, weeksWorked, text: basisText },
      usualDays: usualIdx.map(i => DAYS[i]), mainType: mainTypeKey ? shiftTypeMeta(mainTypeKey).label : null,
      // v1 names kept so older screens still read: weeksIn = weeks worked, avg = per week worked
      avgWeeklyHours: hoursPerWeek, weeksIn: weeksWorked,
      hoursWorked: hours, salesPerHour, costPerHour, teamSalesPerHour,
      shiftsWorked90: shiftsWorked, late90: late, earlyOut90: earlyOut, noShow90: noShows,
      lateRate: rate(late, shiftsWorked), earlyOutRate: rate(earlyOut, shiftsWorked), noShowRate: rate(noShows, shiftsWorked + noShows),
      teamLateRate: rate(teamLate, teamShifts),
      coverageShare: teamMin > 0 ? es.minutes / teamMin : 0,
      typeShare: typeTotalMin > 0 && mainTypeKey ? (es.byType[mainTypeKey] || 0) / typeTotalMin : 0,
      salesDuring: es.revenue, weeklySales: weeksWorked ? es.revenue / weeksWorked : 0,
      salesEstimated: !attr.hasHourly ? "all" : attr.estimatedRevenue > 0 ? "some" : "none",
      replaceRate, rateBasis, replaceWeekly, gaps, headline,
      keepUntil: addYearsStr(exitDate, 3),
    };
  }

  // Drop the employee's shifts AFTER their exit date (past shifts stay as history)
  async function removeFutureShifts(empId, exitDate) {
    const doomed = [];
    Object.entries(schedule).forEach(([wk, emps]) => {
      Object.keys(emps?.[empId] || {}).forEach(di => { if (addDays(wk, Number(di)) > exitDate) doomed.push([wk, Number(di)]); });
    });
    if (!doomed.length) return;
    setSchedule(prev => {
      const n = JSON.parse(JSON.stringify(prev));
      doomed.forEach(([wk, di]) => { if (n[wk]?.[empId]) delete n[wk][empId][di]; });
      return n;
    });
    await Promise.all(doomed.map(([wk, di]) => weekMap[wk]
      ? dbDelete(`shifts?week_id=eq.${weekMap[wk]}&employee_id=eq.${empId}&day_index=eq.${di}`).catch(e => console.warn("Future shift delete failed:", e))
      : null));
  }

  async function deactivateEmp(emp) {
    if (exitBusy) return;
    if (!window.confirm(`Deactivate ${emp.name || "this employee"}? They'll come off the schedule and kiosk from today on. Their hours and pay history are kept.`)) return;
    const reason = window.prompt("Reason for leaving (optional):", "");
    if (reason === null) return;
    setExitBusy(true);
    try {
      const exitDate = demoToday;
      const summary = await computeExitSummary(emp, exitDate, reason.trim());
      await dbPatch(`employees?id=eq.${emp.id}`, { status: "inactive", exited_at: exitDate, exit_reason: reason.trim() || null });
      let savedId = null;
      try {
        const saved = await dbPost("employee_exits", { business_id: bizId, employee_id: emp.id, exited_at: exitDate, summary });
        savedId = saved?.[0]?.id || null;
      } catch (e) { console.warn("Exit summary save failed:", e); showError(friendlyError(e, "Deactivated, but the exit summary didn't save. Open it from Former employees to rebuild it.")); }
      await removeFutureShifts(emp.id, exitDate);
      setEmployees(p => p.filter(e => e.id !== emp.id));
      setFormerEmployees(p => [{ ...emp, status: "inactive", exitedAt: exitDate, exitReason: reason.trim() }, ...p]);
      setExitSummaries(p => ({ ...p, [emp.id]: { id: savedId, summary } }));
      setEditEmpId(null);
      addAudit("Employee Deactivated", `${emp.name || "Employee"} — ${reason.trim() || "no reason given"}`, { empName: emp.name });
      setFormerOpen(true);
      setExitViewId(emp.id);
      showToast(`${emp.name || "Employee"} deactivated — exit summary saved ✓`, 4000);
    } catch (e) {
      showError(friendlyError(e, "Couldn't deactivate that employee — try again."));
    } finally { setExitBusy(false); }
  }

  async function rebuildExitSummary(emp) {
    setExitBusy(true);
    try {
      const summary = await computeExitSummary(emp, emp.exitedAt || demoToday, emp.exitReason || "");
      const existing = exitSummaries[emp.id];
      let id = existing?.id || null;
      if (id) await dbPatch(`employee_exits?id=eq.${id}`, { summary });
      else id = (await dbPost("employee_exits", { business_id: bizId, employee_id: emp.id, exited_at: summary.exitedAt, summary }))?.[0]?.id || null;
      setExitSummaries(p => ({ ...p, [emp.id]: { id, summary } }));
    } catch (e) { showError(friendlyError(e, "Couldn't build the exit summary — try again.")); }
    finally { setExitBusy(false); }
  }

  async function reactivateEmp(emp) {
    if (!window.confirm(`Reactivate ${emp.name}? They'll return to the schedule and kiosk.`)) return;
    try {
      await dbPatch(`employees?id=eq.${emp.id}`, { status: "active", exited_at: null, exit_reason: null });
      setFormerEmployees(p => p.filter(e => e.id !== emp.id));
      setEmployees(p => [...p, { ...emp, status: "active", exitedAt: null, exitReason: "" }]);
      setExitViewId(null);
      addAudit("Employee Reactivated", emp.name || "Employee", { empName: emp.name });
      showToast(`${emp.name} is back on the team ✓`);
    } catch (e) { showError(friendlyError(e, "Couldn't reactivate — try again.")); }
  }

  async function removePersonalInfo(emp) {
    if (!window.confirm(`Remove ${emp.name}'s personal info? Their name, PIN, and notes are deleted. Hours and pay stay as an anonymous former employee for your payroll records. This can't be undone.`)) return;
    const n = formerEmployees.filter(e => /^Former employee #/.test(e.name || "")).length + 1;
    const anon = `Former employee #${n}`;
    try {
      await dbPatch(`employees?id=eq.${emp.id}`, { name: anon, pin: "", notes: "" });
      await Promise.all([
        dbPatch(`punches?business_id=eq.${bizId}&employee_id=eq.${emp.id}`, { employee_name: anon }).catch(e => console.warn(e)),
        dbPatch(`attendance_events?business_id=eq.${bizId}&employee_id=eq.${emp.id}`, { employee_name: anon }).catch(() => {}),
      ]);
      const ex = exitSummaries[emp.id];
      if (ex?.summary) {
        const summary = { ...ex.summary, name: anon, reason: "" };
        if (ex.id) await dbPatch(`employee_exits?id=eq.${ex.id}`, { summary }).catch(e => console.warn(e));
        setExitSummaries(p => ({ ...p, [emp.id]: { ...ex, summary } }));
      }
      setFormerEmployees(p => p.map(e => e.id === emp.id ? { ...e, name: anon, pin: "", notes: "", exitReason: "" } : e));
      setPunches(p => p.map(x => x.empId === emp.id ? { ...x, empName: anon } : x));
      addAudit("Personal Info Removed", anon, { empName: anon });
      showToast("Personal info removed ✓");
    } catch (e) { showError(friendlyError(e, "Couldn't remove personal info — try again.")); }
  }

  async function deleteEmployeePermanently(emp) {
    const keepUntil = exitSummaries[emp.id]?.summary?.keepUntil || (emp.exitedAt ? addYearsStr(emp.exitedAt, 3) : null);
    const early = keepUntil && demoToday < keepUntil;
    const warn = early
      ? `Payroll records are usually kept for 3 years after someone leaves (until ${dl(keepUntil)}). Deleting removes ALL of ${emp.name}'s hours, punches, and pay history now. This can't be undone. Delete anyway?`
      : `Delete everything for ${emp.name}, including hours, punches, and pay history? This can't be undone.`;
    if (!window.confirm(warn)) return;
    try {
      await dbDelete(`punches?business_id=eq.${bizId}&employee_id=eq.${emp.id}`);
      await dbDelete(`attendance_events?business_id=eq.${bizId}&employee_id=eq.${emp.id}`).catch(() => {});
      await dbDelete(`employee_exits?business_id=eq.${bizId}&employee_id=eq.${emp.id}`).catch(() => {});
      await dbDelete(`employees?id=eq.${emp.id}`); // shifts cascade
      setFormerEmployees(p => p.filter(e => e.id !== emp.id));
      setExitSummaries(p => { const n = { ...p }; delete n[emp.id]; return n; });
      setPunches(p => p.filter(x => x.empId !== emp.id));
      setSchedule(p => { const n = JSON.parse(JSON.stringify(p)); Object.keys(n).forEach(wk => delete n[wk][emp.id]); return n; });
      setExitViewId(null);
      addAudit("Employee Deleted", "A former employee's records were permanently deleted");
      showToast("Deleted permanently");
    } catch (e) { showError(friendlyError(e, "Couldn't delete — try again.")); }
  }

  function renderFormerEmployees() {
    if (!formerEmployees.length) return null;
    return (
      <div style={{marginTop:18}}>
        <button onClick={()=>setFormerOpen(o=>!o)} aria-expanded={formerOpen}
          style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",background:T.surface,border:`1px solid ${T.border}`,borderRadius:T.radius,padding:"13px 16px",cursor:"pointer"}}>
          <span style={{fontWeight:800,fontSize:14,color:T.text}}>Former employees <span style={{fontWeight:400,color:T.sub}}>· {formerEmployees.length}</span></span>
          <span style={{fontSize:12,color:T.sub}}>{formerOpen ? "Hide ▴" : "Show ▾"}</span>
        </button>
        {formerOpen && (
          <Card T={T} style={{marginTop:8,overflow:"hidden"}}>
            {formerEmployees.map((e, i) => {
              const keepUntil = exitSummaries[e.id]?.summary?.keepUntil || (e.exitedAt ? addYearsStr(e.exitedAt, 3) : null);
              const due = keepUntil && demoToday >= keepUntil;
              return (
                <button key={e.id} onClick={()=>setExitViewId(e.id)}
                  style={{width:"100%",display:"flex",alignItems:"center",gap:12,padding:"12px 16px",background:"transparent",border:"none",borderTop:i?`1px solid ${T.border}`:"none",cursor:"pointer",textAlign:"left"}}>
                  <div style={{width:34,height:34,borderRadius:"50%",background:e.color||T.muted,opacity:0.75,display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:800,fontSize:13,flexShrink:0}}>{(e.name||"?")[0].toUpperCase()}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,fontSize:13,color:T.text}}>{e.name || "Unnamed"}</div>
                    <div style={{fontSize:11,color:T.sub}}>{e.role ? `${e.role} · ` : ""}Left {e.exitedAt ? dl(e.exitedAt) : "—"}</div>
                  </div>
                  {due && <span style={{fontSize:10,fontWeight:700,color:"#9A6510",background:"#FEF3E2",borderRadius:6,padding:"3px 7px"}}>3 years — review</span>}
                  <span style={{color:T.sub,fontSize:16}}>›</span>
                </button>
              );
            })}
          </Card>
        )}
        {exitViewId && renderExitSummaryModal()}
      </div>
    );
  }

  function renderExitSummaryModal() {
    const emp = formerEmployees.find(e => e.id === exitViewId);
    if (!emp) return null;
    const s = exitSummaries[emp.id]?.summary;
    const first = (s?.name || emp.name || "They").split(" ")[0];
    const pctStr = v => `${Math.round((v || 0) * 100)}%`;
    const tenureStr = d => { if (!d) return "—"; const m = Math.floor(d / 30.44); return m >= 12 ? `${Math.floor(m/12)} yr ${m%12} mo` : m >= 1 ? `${m} mo` : `${d} days`; };
    const Row = ({ label, value, sub, color }) => (
      <div style={{padding:"10px 16px",borderTop:`1px solid ${T.border}`}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"baseline"}}>
          <span style={{fontSize:12,color:T.sub}}>{label}</span>
          <span style={{fontSize:13,fontWeight:800,color:color||T.text,textAlign:"right"}}>{value}</span>
        </div>
        {sub && <div style={{fontSize:11,color:T.sub,marginTop:3,lineHeight:1.45}}>{sub}</div>}
      </div>
    );
    return (
      <div onClick={()=>setExitViewId(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:1100,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"24px 16px",overflowY:"auto"}}>
        <div onClick={e=>e.stopPropagation()} style={{background:T.bg,borderRadius:18,width:"100%",maxWidth:440,overflow:"hidden",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
          <div style={{background:T.dark,padding:"14px 16px",display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:44,height:44,borderRadius:"50%",background:s?.color||emp.color||"#888",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:800,fontSize:18,flexShrink:0}}>{(s?.name||emp.name||"?")[0].toUpperCase()}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{color:"white",fontWeight:800,fontSize:16}}>{s?.name || emp.name}</div>
              <div style={{color:"#C9D2CB",fontSize:12}}>{[s?.role || emp.role, emp.exitedAt ? `Left ${dl(emp.exitedAt)}` : null, (s?.reason || emp.exitReason) ? `"${s?.reason || emp.exitReason}"` : null].filter(Boolean).join(" · ")}</div>
            </div>
            <button onClick={()=>setExitViewId(null)} aria-label="Close" style={{background:"rgba(255,255,255,0.12)",border:"none",borderRadius:"50%",width:34,height:34,color:"white",fontSize:18,cursor:"pointer",flexShrink:0}}>×</button>
          </div>

          <div style={{padding:12,display:"flex",flexDirection:"column",gap:12}}>
            {!s ? (
              <Card T={T} style={{padding:"18px 16px",textAlign:"center"}}>
                <div style={{fontSize:13,color:T.text,marginBottom:12}}>No exit summary saved for {first} yet.</div>
                <button onClick={()=>rebuildExitSummary(emp)} disabled={exitBusy}
                  style={{background:T.accent,color:"white",border:"none",borderRadius:9,padding:"11px 18px",fontWeight:700,fontSize:13,cursor:"pointer",opacity:exitBusy?0.6:1}}>{exitBusy ? "Building…" : "Build exit summary"}</button>
              </Card>
            ) : (
              <Card T={T} style={{overflow:"hidden"}}>
                <div style={{padding:"12px 16px",fontSize:13,lineHeight:1.6,color:T.text}}><strong>{s.headline}</strong></div>
                <Row label="Tenure" value={tenureStr(s.tenureDays)} sub={s.tenureStart ? `${dl(s.tenureStart)} – ${dl(s.exitedAt)}` : null}/>
                <Row label="Usual schedule" value={s.usualDays?.length ? s.usualDays.join(" · ") : "—"}
                  sub={`${s.mainType ? `Mostly ${s.mainType} · ` : ""}${(s.avgWeeklyHours||0).toFixed(1)}h a week ${s.v >= 2 ? `across the ${s.weeksIn} week${s.weeksIn!==1?"s":""} worked` : `on average (last ${s.weeksIn} week${s.weeksIn!==1?"s":""})`}`}/>
                {s.v >= 2 && s.basis?.text && <Row label="Measured on" value={s.basis.kind === "season" ? "Last season" : "Last 12 weeks"} sub={s.basis.text}/>}
                {s.v >= 2 && <Row label="Sales per hour worked" value={s.salesPerHour != null ? `${fmtMoney(s.salesPerHour)} / hr` : "—"} sub={s.teamSalesPerHour != null ? `Team average ${fmtMoney(s.teamSalesPerHour)} / hr` : null}/>}
                <Row label={s.v >= 2 ? "Reliability, per shift" : "Reliability, last 90 days"} value={s.v >= 2 ? `${s.late90} of ${s.shiftsWorked90} late · ${s.noShow90} no-show${s.noShow90!==1?"s":""}` : `${s.late90} late · ${s.noShow90} no-show${s.noShow90!==1?"s":""}`}
                  sub={`${s.earlyOut90} early clock-out${s.earlyOut90!==1?"s":""} · ${s.shiftsWorked90} shift${s.shiftsWorked90!==1?"s":""} worked`}/>
                <Row label="Share of coverage" value={`${pctStr(s.coverageShare)} of all hours`} sub={s.mainType ? `${pctStr(s.typeShare)} of ${s.mainType} hours` : null}/>
                <Row label={`Sales during ${first}'s shifts`} value={fmtMoney(s.salesDuring || 0)}
                  sub={`Last ${s.weeksIn} week${s.weeksIn!==1?"s":""} · about ${fmtMoney(s.weeklySales || 0)} a week${s.salesEstimated==="all" ? " · estimated (no hourly sales data)" : s.salesEstimated==="some" ? " · partly estimated" : ""}`}/>
                <Row label="Cost to replace their hours" value={`${fmtMoney(s.replaceWeekly || 0)} / week`}
                  sub={`${(s.avgWeeklyHours||0).toFixed(1)}h × $${(s.replaceRate||0).toFixed(2)}, ${s.rateBasis}`}/>
                {s.gaps?.length > 0 && (
                  <div style={{margin:"4px 16px 14px",padding:"10px 12px",background:"#FEF3E2",borderRadius:9,fontSize:12,color:"#6E4A0E",lineHeight:1.5}}>
                    <strong>Coverage gap:</strong> {s.gaps.map(g => `${g.day}: ${g.names.length ? `only ${g.names.join(", ")} ${g.names.length===1?"is":"are"} available` : "no one else is available"}`).join(" · ")}. Consider training or hiring before it comes up on the schedule.
                  </div>
                )}
              </Card>
            )}

            <Card T={T} style={{overflow:"hidden"}}>
              <div style={{padding:"11px 16px",background:T.muted,borderBottom:`1px solid ${T.border}`,fontWeight:700,fontSize:13,color:T.text}}>Records</div>
              <div style={{padding:"11px 16px",fontSize:12,color:T.sub,lineHeight:1.5}}>
                Hours, punches, and pay records are kept until <strong style={{color:T.text}}>{dl(s?.keepUntil || (emp.exitedAt ? addYearsStr(emp.exitedAt, 3) : demoToday))}</strong> (3 years after leaving). This list will flag them for review then.
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8,padding:"0 16px 14px"}}>
                <button onClick={()=>reactivateEmp(emp)} style={{background:T.surface,color:T.accent,border:`1px solid ${T.border}`,borderRadius:10,padding:"13px 0",fontWeight:700,fontSize:13,cursor:"pointer"}}>Reactivate {first}</button>
                {!/^Former employee #/.test(emp.name || "") && (
                  <>
                    <button onClick={()=>removePersonalInfo(emp)} style={{background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:10,padding:"13px 0",fontWeight:700,fontSize:13,cursor:"pointer"}}>Remove personal info</button>
                    <div style={{fontSize:11,color:T.sub,lineHeight:1.45,marginTop:-2}}>Deletes their name, PIN, and notes. Hours and pay stay as an anonymous former employee. Names already written in the audit log aren't changed.</div>
                  </>
                )}
                <button onClick={()=>deleteEmployeePermanently(emp)} style={{background:"#FDECEA",color:"#A93226",border:"none",borderRadius:10,padding:"13px 0",fontWeight:700,fontSize:13,cursor:"pointer"}}>Delete permanently</button>
                <div style={{fontSize:11,color:T.sub,lineHeight:1.45,marginTop:-2}}>Removes everything, including hours and pay. You'll be warned if it's inside the 3-year window.</div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // ── PRICE CHANGES ───────────────────────────────────────────────────────
  // Price changes come ONLY from the item's set price in the Square catalog
  // (catalog_price_history, written by the sync). Prices charged at the
  // register are never used, so overrides — even several days running — can't
  // register as a change. Sales outcomes come from sales_items_daily: the 28
  // days before vs. after, weekday-matched, on days the business had sales.
  async function loadPriceChanges() {
    if (!bizId) return;
    setPriceData({ loading: true });
    try {
      const history = (await dbGet(`catalog_price_history?select=item_key,item_name,price,effective_date,is_baseline&business_id=eq.${bizId}&order=effective_date.asc&limit=20000`)) || [];
      const since = addDays(demoToday, -240);
      const sales = []; const PAGE = 1000; let offset = 0;
      while (sales.length < 50000) {
        const page = await dbGet(`sales_items_daily?select=sale_date,item_key,quantity,revenue&business_id=eq.${bizId}&sale_date=gte.${since}&order=sale_date.asc&limit=${PAGE}&offset=${offset}`);
        if (!page?.length) break;
        sales.push(...page);
        if (page.length < PAGE) break;
        offset += PAGE;
      }
      const trackingSince = history.length ? history[0].effective_date : null;
      setPriceData({ loading: false, hasTracking: history.length > 0, trackingSince, changes: detectPriceChanges(history, sales) });
    } catch (e) {
      console.warn("Price changes unavailable:", e);
      setPriceData({ loading: false, hasTracking: false, changes: [], error: true });
    }
  }

  function detectPriceChanges(history, salesRows) {
    const totalByDate = {};
    salesData.forEach(d => { totalByDate[d.date] = (totalByDate[d.date]||0) + (Number(d.revenue)||0); });
    const bizDays = Object.keys(totalByDate).filter(d => totalByDate[d] > 0);
    const salesByItem = {};
    salesRows.forEach(r => { (salesByItem[r.item_key] ||= {})[r.sale_date] = { qty: Number(r.quantity)||0, rev: Number(r.revenue)||0 }; });
    const histByItem = {};
    history.forEach(h => { (histByItem[h.item_key] ||= []).push(h); });
    const cutoff = addDays(demoToday, -180);
    const changes = [];
    Object.entries(histByItem).forEach(([key, rows]) => {
      rows.sort((x, y) => x.effective_date.localeCompare(y.effective_date));
      for (let i = 1; i < rows.length; i++) {
        const prev = Number(rows[i-1].price), cur = Number(rows[i].price);
        if (rows[i].is_baseline || Math.abs(cur - prev) < 0.005) continue;
        if (rows[i].effective_date < cutoff) continue;
        const it = { name: rows[i].item_name || rows[i-1].item_name || "Item", map: salesByItem[key] || {} };
        changes.push(evaluatePriceChange(key, it, rows[i].effective_date, prev, cur, bizDays, totalByDate));
      }
    });
    return changes.sort((x, y) => y.date.localeCompare(x.date));
  }

  function evaluatePriceChange(key, it, date, oldPrice, newPrice, bizDays, totalByDate) {
    const beforeStart = addDays(date, -28), afterEnd = addDays(date, 27) < demoToday ? addDays(date, 27) : demoToday;
    let before = bizDays.filter(ds => ds >= beforeStart && ds < date);
    let after  = bizDays.filter(ds => ds >= date && ds <= afterEnd);
    // UI Batch 23 — seasonal: use the last ~4 open weeks before and the first ~4 open
    // weeks after, so a change made while closed compares to the end of last season.
    let acrossSeasons = false;
    if (season.on) {
      const sorted = [...bizDays].filter(ds => openDay(ds)).sort();
      before = sorted.filter(ds => ds < date).slice(-24);
      after  = sorted.filter(ds => ds >= date && ds <= demoToday).slice(0, 24);
      acrossSeasons = before.length > 0 && before[before.length - 1] < addDays(date, -28);
    }
    const group = dates => {
      const by = {};
      dates.forEach(ds => {
        const dow = new Date(ds+"T12:00:00").getDay();
        const x = it.map[ds];
        (by[dow] ||= []).push({ qty: x?.qty || 0, rev: x?.rev || 0, total: totalByDate[ds] || 0 });
      });
      return by;
    };
    const b = group(before), a = group(after);
    const dows = Object.keys(b).filter(k => a[k]);
    const avg = (by, f) => dows.length ? dows.reduce((s, k) => s + by[k].reduce((t, x) => t + x[f], 0) / by[k].length, 0) / dows.length : 0;
    const m = f => { const bv = avg(b, f), av = avg(a, f); return { before: bv, after: av, pct: bv > 0 ? (av - bv) / bv * 100 : null }; };
    const qty = m("qty"), rev = m("rev"), total = m("total");
    const tooEarly = after.length < 14;
    const verdict = tooEarly ? "early" : rev.pct == null ? "flat" : rev.pct >= 2 ? "working" : rev.pct <= -2 ? "not" : "flat";
    return { key, name: it.name, date, oldPrice, newPrice, pricePct: oldPrice > 0 ? (newPrice - oldPrice) / oldPrice * 100 : null,
      afterDays: after.length, weeksAfter: Math.floor(after.length / 7), qty, rev, total, tooEarly, verdict, acrossSeasons };
  }

  function renderPriceChangesPanel() {
    const pd = priceData;
    const money2 = n => `$${Number(n).toFixed(2)}`;
    const signPct = p => p == null ? "—" : `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(0)}%`;
    const Metric = ({ label, m, money, goodWhenUp=true }) => {
      const good = m.pct == null ? null : goodWhenUp ? m.pct >= 0 : m.pct < 0;
      const fmtV = v => money ? fmtMoney(v) : (Math.round(v * 10) / 10).toLocaleString();
      return (
        <div style={{background:T.bg,borderRadius:8,padding:"8px 9px",minWidth:0}}>
          <div style={{fontSize:10,color:T.sub,fontWeight:700,lineHeight:1.3}}>{label}</div>
          <div style={{fontSize:11,color:T.sub,marginTop:4}}>{fmtV(m.before)} → <strong style={{color:T.text}}>{fmtV(m.after)}</strong></div>
          <div style={{fontSize:13,fontWeight:800,marginTop:2,color:good==null?T.sub:good?"#2D6A4F":"#9A4E0C"}}>{signPct(m.pct)}</div>
        </div>
      );
    };
    return (
      <Card T={T} style={{padding:"14px 16px"}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:12,gap:12}}>
          <div>
            <div style={{fontWeight:800,fontSize:14,color:T.text}}>💲 Price Changes</div>
            <div style={{fontSize:11,color:T.sub,marginTop:2,lineHeight:1.5}}>Found automatically from your Square prices. Each compares the 4 weeks before and after the change, same weekdays{season.on ? " — open weeks only, so a change made while closed compares to the end of last season" : ""}.</div>
          </div>
          <button onClick={()=>setInsightsPanel(null)} aria-label="Close" style={{background:T.muted,border:"none",borderRadius:"50%",width:28,height:28,fontSize:16,cursor:"pointer",color:T.sub,flexShrink:0}}>×</button>
        </div>
        {(!pd || pd.loading) && <div style={{fontSize:12,color:T.sub,textAlign:"center",padding:"20px 0"}}>Checking your item prices…</div>}
        {pd && !pd.loading && !pd.hasTracking && (
          <div style={{fontSize:12,color:T.sub,textAlign:"center",padding:"18px 8px",lineHeight:1.6}}>
            Price tracking hasn't started yet. It reads the prices set in your Square item catalog, so reconnect Square once (Dashboard → Disconnect, then Connect) and sync. Cash-only sales aren't tracked.
          </div>
        )}
        {pd && !pd.loading && pd.hasTracking && !pd.changes.length && (
          <div style={{fontSize:12,color:T.sub,textAlign:"center",padding:"18px 8px",lineHeight:1.6}}>No price changes since tracking started on {dl(pd.trackingSince)}. Changes you make to item prices in Square will show up here.</div>
        )}
        {pd && !pd.loading && pd.changes?.length > 0 && (
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {pd.changes.map(c => (
              <div key={`${c.key}-${c.date}`} style={{border:`1px solid ${T.border}`,borderRadius:12,padding:"12px 13px",display:"flex",flexDirection:"column",gap:9}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8}}>
                  <span style={{fontWeight:800,fontSize:14,color:T.text}}>{c.name}</span>
                  <span style={{fontWeight:800,fontSize:13,color:T.text,flexShrink:0}}>{money2(c.oldPrice)} → {money2(c.newPrice)}</span>
                </div>
                <div style={{fontSize:11,color:T.sub,marginTop:-5}}>Changed {dl(c.date)}{c.acrossSeasons ? " (while closed)" : ""}{c.pricePct!=null ? ` · ${signPct(c.pricePct)}` : ""}{c.tooEarly ? "" : ` · ${c.weeksAfter >= 4 ? "4 weeks" : `${c.weeksAfter} week${c.weeksAfter!==1?"s":""}`} after so far`}</div>
                {c.tooEarly ? (
                  <>
                    <div style={{fontSize:12,color:T.text}}>Too early to tell: {c.afterDays} of 14 days of sales so far.</div>
                    <div style={{height:6,background:T.muted,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min(100, c.afterDays/14*100)}%`,background:T.accent}}/></div>
                  </>
                ) : (
                  <>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:6}}>
                      <Metric label="Sold per day" m={c.qty}/>
                      <Metric label="Item sales per day" m={c.rev} money/>
                      <Metric label="All sales per day" m={c.total} money/>
                    </div>
                    <div style={{background:c.verdict==="working"?"#E8F4EE":c.verdict==="not"?"#FEF3E2":T.muted,color:c.verdict==="working"?"#1B4332":c.verdict==="not"?"#6E4A0E":T.text,borderRadius:9,padding:"9px 11px",fontSize:12,lineHeight:1.5}}>
                      {c.verdict==="working" && <><strong>Working.</strong> It brings in more per day{c.qty.pct!=null && c.qty.pct < 0 ? " even though a few fewer sell" : ""}.</>}
                      {c.verdict==="not" && <><strong>Not working so far.</strong> {c.newPrice > c.oldPrice ? "The drop in sales is bigger than the price increase." : "The lower price isn't bringing in enough extra sales to make up for it."}</>}
                      {c.verdict==="flat" && <><strong>No clear change yet.</strong> Item sales per day are about the same as before.</>}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        <div style={{fontSize:11,color:T.sub,lineHeight:1.5,marginTop:12}}>Uses the set price in your Square item catalog. Prices overridden at the register are never counted as a change. Weather, holidays, and other changes on the same dates can also move these numbers.</div>
      </Card>
    );
  }

  // ── BREAK-EVEN ENGINE ───────────────────────────────────────────────────
  // Per day: scheduled labor + an even share of weekly fixed costs (open days
  // only), divided by (1 − % of sales costs) = sales needed to break even.
  // Labor-target view: labor ÷ target %. Sales per day = actual where it's
  // already recorded, forecast (average of past same weekdays) otherwise.
  function costWeeklyAmount(c) {
    const amt = Number(c.amount) || 0;
    if (c.kind === "percent") return 0;
    if (c.frequency === "month") return amt * 12 / 52;
    if (c.frequency === "year") return amt / 52;
    return amt;
  }
  function computeBreakEven(weekStart) {
    const dates = weekDatesFromSunday(weekStart).map(toInputDate);
    const laborByDay = DAYS.map((_, i) => employees.reduce((s, e) => s + eDayH(weekStart, e.id, i) * (parseFloat(e.hourlyRate)||0), 0));
    const fixedWeekly = costs.reduce((s, c) => s + costWeeklyAmount(c), 0);
    const pctCosts = costs.filter(c => c.kind === "percent").reduce((s, c) => s + (Number(c.amount)||0), 0) / 100;
    const openIdx = (daysOpen && daysOpen.length) ? daysOpen : [0,1,2,3,4,5,6];
    const fixedPerOpenDay = fixedWeekly / openIdx.length;
    const target = (laborTargetPct || 30) / 100;
    const pctOk = pctCosts < 1;
    const forecast = getForecast("thisWeek", salesData, weekStart);
    const actualByDate = {};
    salesData.forEach(d => { actualByDate[d.date] = (actualByDate[d.date]||0) + (Number(d.revenue)||0); });
    const days = dates.map((date, i) => {
      const fixedShare = openIdx.includes(i) ? fixedPerOpenDay : 0;
      const labor = laborByDay[i];
      // UI Batch 23 — closed for the season: no sales expected, nothing to flag
      if (season.on && !openDay(date)) return { date, day: DAYS[i], labor, fixedShare, breakEven: null, targetNeed: 0, sales: null, isActual: false, closed: true };
      const breakEven = pctOk ? (labor + fixedShare) / (1 - pctCosts) : null;
      const targetNeed = labor / target;
      let sales = null, isActual = false;
      if (date <= demoToday && actualByDate[date] != null) { sales = actualByDate[date]; isActual = true; }
      else if (forecast.hasEnoughData) { sales = forecast.days[i]?.projectedRevenue ?? null; }
      return { date, day: DAYS[i], labor, fixedShare, breakEven, targetNeed, sales, isActual };
    });
    const sum = k => days.reduce((s, d) => s + (d[k] || 0), 0);
    const openDays = days.filter(d => !d.closed);
    const salesKnown = openDays.length > 0 && openDays.every(d => d.sales != null);
    const weekClosed = openDays.length === 0;
    return {
      days, salesKnown, pctOk, pctCosts, fixedWeekly, target, weekClosed, closedDays: days.length - openDays.length,
      labor: sum("labor"), breakEven: pctOk ? sum("breakEven") : null, targetNeed: sum("targetNeed"),
      sales: salesKnown ? sum("sales") : null, anyActual: days.some(d => d.isActual),
    };
  }

  async function saveCostDraft() {
    const d = costDraft;
    if (!d) return;
    if (!d.name?.trim()) { showToast("Give this cost a name"); return; }
    const amount = parseFloat(d.amount);
    if (isNaN(amount) || amount < 0) { showToast("Enter a valid amount"); return; }
    if (d.kind === "percent" && amount >= 100) { showToast("A % of sales cost has to be under 100%"); return; }
    const row = { name: d.name.trim(), amount, kind: d.kind, frequency: d.kind === "percent" ? null : (d.frequency || "week") };
    try {
      if (d.id) {
        setCosts(prev => prev.map(c => c.id === d.id ? { ...c, ...row } : c));
        await dbPatch(`business_costs?id=eq.${d.id}`, row);
      } else {
        const saved = await dbPost("business_costs", { business_id: bizId, ...row, sort_order: costs.length });
        if (saved?.[0]) setCosts(prev => [...prev, saved[0]]);
      }
      setCostDraft(null);
      showToast(d.id ? "Cost updated ✓" : "Cost added ✓");
    } catch (e) { showError(friendlyError(e, "Couldn't save that cost — try again.")); }
  }
  async function removeCost(id) {
    if (!window.confirm("Remove this cost?")) return;
    const prev = costs;
    setCosts(p => p.filter(c => c.id !== id));
    try { await dbDelete(`business_costs?id=eq.${id}`); }
    catch (e) { setCosts(prev); showError(friendlyError(e, "Couldn't remove that cost — try again.")); }
  }
  function changeLaborTarget() {
    const v = window.prompt("Labor cost target, as a % of sales:", String(laborTargetPct));
    if (v === null) return;
    const n = parseFloat(v);
    if (isNaN(n) || n <= 0 || n >= 100) { showToast("Enter a number between 1 and 99"); return; }
    setLaborTargetPct(n);
    saveBizSettings({ labor_target_pct: n });
    showToast(`Labor target set to ${n}% ✓`);
  }

  const fmtMoney = n => "$" + Math.round(n).toLocaleString("en-US");

  // Dashboard — Break-even card (its own card, not a user widget)
  function renderBreakEvenCard() {
    const be = computeBreakEven(payWeek);
    const isTarget = beView === "target";
    const need = isTarget ? be.targetNeed : be.breakEven;
    const needKey = isTarget ? "targetNeed" : "breakEven";
    const wkDates = weekDatesFromSunday(payWeek);
    const gap = be.sales != null && need != null ? be.sales - need : null;
    const scaleMax = Math.max(1, ...be.days.map(d => Math.max(d.sales || 0, d[needKey] || 0))) * 1.08;
    const short = be.days.filter(d => d.sales != null && d[needKey] > 0 && d.sales < d[needKey]);
    const thinnest = be.days.filter(d => d.sales != null && d[needKey] > 0).sort((a,b) => (a.sales - a[needKey]) - (b.sales - b[needKey]))[0];
    let summary = null;
    if (be.weekClosed) {
      summary = `Closed for the season this week. Fixed costs still run ${fmtMoney(be.fixedWeekly)} a week.`;
    } else if (need != null && be.days.some(d => d.sales != null)) {
      summary = short.length
        ? `${short.map(d => d.day).join(", ")} ${short.length === 1 ? "doesn't" : "don't"} cover ${isTarget ? `labor at ${laborTargetPct}%` : "costs"}.`
        : thinnest ? `Every day covers ${isTarget ? `labor at ${laborTargetPct}%` : "its costs"}. ${thinnest.day} has the thinnest cushion at ${fmtMoney(thinnest.sales - thinnest[needKey])}.` : null;
    }
    const inputStyle = {border:`1.5px solid ${T.border}`,borderRadius:8,padding:"8px 10px",fontSize:13,outline:"none",background:T.surface,color:T.text,width:"100%",boxSizing:"border-box"};
    return (
      <div style={{background:T.surface,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden"}}>
        <div style={{padding:"10px 15px",background:T.dark,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{color:"white",fontWeight:800,fontSize:14}}>Break-even</span>
          <span style={{color:"#999",fontSize:11}}>{dl(wkDates[0])} – {dl(wkDates[6])}</span>
        </div>
        <div style={{padding:"13px 16px",display:"flex",flexDirection:"column",gap:12}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,background:T.muted,borderRadius:9,padding:3}}>
            {[["breakeven","Break-even"],["target",`Labor at ${laborTargetPct}%`]].map(([k,l]) => (
              <button key={k} onClick={()=>setBeView(k)}
                style={{background:beView===k?T.surface:"transparent",color:beView===k?T.text:T.sub,border:"none",borderRadius:7,padding:"9px 0",fontWeight:700,fontSize:12,cursor:"pointer",boxShadow:beView===k?T.shadow:"none"}}>{l}</button>
            ))}
          </div>

          {!isTarget && !be.pctOk ? (
            <div style={{background:"#FDECEA",color:"#A93226",borderRadius:9,padding:"10px 12px",fontSize:12}}>Your % of sales costs add up to 100% or more, so there's no break-even point. Check them below.</div>
          ) : (
            <>
              <div>
                <div style={{fontSize:12,color:T.sub}}>{isTarget ? `Sales needed to keep labor at ${laborTargetPct}%` : "Sales needed to cover all costs"}</div>
                <div style={{fontSize:28,fontWeight:800,color:T.text,lineHeight:1.15}}>{fmtMoney(need || 0)}</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div style={{background:T.muted,borderRadius:9,padding:"9px 11px"}}>
                  <div style={{fontSize:10,color:T.sub,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em"}}>{be.anyActual ? "Sales (actual + forecast)" : "Forecast sales"}</div>
                  <div style={{fontSize:17,fontWeight:800,color:T.text,marginTop:2}}>{be.sales != null ? fmtMoney(be.sales) : "—"}</div>
                </div>
                <div style={{background:T.muted,borderRadius:9,padding:"9px 11px"}}>
                  <div style={{fontSize:10,color:T.sub,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em"}}>{gap == null ? "Gap" : gap >= 0 ? "Cushion" : "Short"}</div>
                  <div style={{fontSize:17,fontWeight:800,marginTop:2,color:gap == null ? T.sub : gap >= 0 ? "#2D6A4F" : "#B5651D"}}>{gap == null ? "—" : `${gap >= 0 ? "+" : "−"}${fmtMoney(Math.abs(gap))}`}</div>
                </div>
              </div>
              {be.sales == null && <div style={{fontSize:11,color:T.sub}}>No forecast for this week: there are no recent sales and none in these weeks last year. If you're closed for the season, that's expected. Sales needed is still accurate.</div>}
              {summary && <div style={{fontSize:12,color:T.text,lineHeight:1.5}}>{summary}</div>}

              <div style={{background:T.bg,borderRadius:9,padding:"6px 10px 8px"}}>
                {be.days.map(d => {
                  const below = d.sales != null && d[needKey] > 0 && d.sales < d[needKey];
                  const diff = d.sales != null ? d.sales - d[needKey] : null;
                  return (
                    <div key={d.date} style={{display:"grid",gridTemplateColumns:"34px minmax(0,1fr) 66px",alignItems:"center",gap:8,padding:"6px 0"}}>
                      <span style={{fontSize:12,fontWeight:700,color:T.text}}>{d.day}</span>
                      <div style={{position:"relative",height:16,background:T.muted,borderRadius:4}}>
                        {d.sales != null && <div style={{position:"absolute",left:0,top:0,bottom:0,width:`${Math.min(100, d.sales/scaleMax*100)}%`,background:below?"#C26A12":"#2D6A4F",opacity:d.isActual?1:0.7,borderRadius:4}}/>}
                        {d[needKey] > 0 && <div style={{position:"absolute",left:`${Math.min(100, d[needKey]/scaleMax*100)}%`,top:-4,bottom:-4,width:2,background:T.text}}/>}
                      </div>
                      <span style={{fontSize:11,fontWeight:700,textAlign:"right",color:diff == null ? T.sub : below ? "#9A4E0C" : "#2D6A4F"}}>
                        {diff == null ? fmtMoney(d[needKey]) : `${diff >= 0 ? "+" : "−"}${fmtMoney(Math.abs(diff))}`}
                      </span>
                    </div>
                  );
                })}
                <div style={{display:"flex",gap:12,flexWrap:"wrap",paddingTop:6,fontSize:10,color:T.sub}}>
                  <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:12,height:8,background:"#2D6A4F",borderRadius:2}}/>Sales {be.anyActual ? "(lighter = forecast)" : "forecast"}</span>
                  <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:2,height:12,background:T.text}}/>{isTarget ? "Needed at target" : "Break-even"}</span>
                </div>
              </div>
            </>
          )}

          <div style={{border:`1px solid ${T.border}`,borderRadius:9,overflow:"hidden"}}>
            <button onClick={()=>setCostsOpen(o=>!o)} aria-expanded={costsOpen}
              style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 12px",background:"transparent",border:"none",cursor:"pointer"}}>
              <span style={{fontSize:12,fontWeight:800,color:T.text}}>Your costs <span style={{fontWeight:400,color:T.sub}}>· {costs.length + 1}</span></span>
              <span style={{fontSize:11,color:T.sub}}>{fmtMoney(be.labor + be.fixedWeekly)}/wk{be.pctCosts > 0 ? ` + ${(be.pctCosts*100).toFixed(1)}%` : ""} {costsOpen ? "▴" : "▾"}</span>
            </button>
            {costsOpen && (
              <div style={{padding:"0 12px 10px"}}>
                <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",gap:8,padding:"9px 0",borderTop:`1px solid ${T.border}`,fontSize:12.5}}>
                  <span style={{fontWeight:600,color:T.text}}>Scheduled labor <span style={{fontSize:11,color:T.sub,fontWeight:400}}>· from schedule</span></span>
                  <span style={{fontWeight:800,color:T.text}}>{fmtMoney(be.labor)}</span>
                </div>
                {costs.map(c => (
                  <div key={c.id} style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) auto auto",alignItems:"center",gap:8,padding:"6px 0",borderTop:`1px solid ${T.border}`,fontSize:12.5}}>
                    <button onClick={()=>setCostDraft({ id:c.id, name:c.name, amount:String(c.amount), kind:c.kind, frequency:c.frequency || "week" })}
                      style={{background:"none",border:"none",padding:"4px 0",textAlign:"left",cursor:"pointer",minWidth:0}}>
                      <div style={{fontWeight:600,color:T.text}}>{c.name}</div>
                      <div style={{fontSize:11,color:T.sub}}>{c.kind === "percent" ? `${c.amount}% of sales` : `${fmtMoney(c.amount)} / ${c.frequency || "week"}`}</div>
                    </button>
                    <span style={{fontWeight:800,color:T.text}}>{c.kind === "percent" ? `${c.amount}%` : fmtMoney(costWeeklyAmount(c))}</span>
                    <button onClick={()=>removeCost(c.id)} aria-label={`Remove ${c.name}`}
                      style={{background:"none",border:"none",color:T.sub,fontSize:15,cursor:"pointer",padding:"6px 4px"}}>✕</button>
                  </div>
                ))}
                {costDraft ? (
                  <div style={{marginTop:8,background:T.bg,borderRadius:9,padding:10,display:"flex",flexDirection:"column",gap:8}}>
                    <input value={costDraft.name} onChange={e=>setCostDraft(d=>({...d,name:e.target.value}))} placeholder="Name, e.g. Rent" aria-label="Cost name" style={inputStyle}/>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      <input type="number" min="0" step="0.01" value={costDraft.amount} onChange={e=>setCostDraft(d=>({...d,amount:e.target.value}))}
                        placeholder={costDraft.kind === "percent" ? "e.g. 2.9" : "e.g. 2000"} aria-label="Amount" style={inputStyle}/>
                      <select value={costDraft.kind === "percent" ? "percent" : (costDraft.frequency || "week")} aria-label="How it's charged"
                        onChange={e=>{ const v=e.target.value; setCostDraft(d=> v==="percent" ? {...d,kind:"percent"} : {...d,kind:"fixed",frequency:v}); }}
                        style={inputStyle}>
                        <option value="week">$ per week</option>
                        <option value="month">$ per month</option>
                        <option value="year">$ per year</option>
                        <option value="percent">% of sales</option>
                      </select>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:8}}>
                      <button onClick={()=>setCostDraft(null)} style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 0",fontSize:12,fontWeight:700,color:T.sub,cursor:"pointer"}}>Cancel</button>
                      <button onClick={saveCostDraft} style={{background:T.accent,border:"none",borderRadius:8,padding:"10px 0",fontSize:12,fontWeight:700,color:"white",cursor:"pointer"}}>{costDraft.id ? "Save changes" : "Add cost"}</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={()=>setCostDraft({ name:"", amount:"", kind:"fixed", frequency:"month" })}
                    style={{width:"100%",marginTop:8,background:"transparent",border:`1.5px dashed ${T.border}`,borderRadius:8,color:T.accent,fontWeight:700,fontSize:12,padding:"11px 0",cursor:"pointer"}}>
                    + Add cost
                  </button>
                )}
              </div>
            )}
          </div>

          <div style={{fontSize:11,color:T.sub,lineHeight:1.5}}>
            Break-even = (labor + fixed costs) ÷ (1 − % of sales costs). Monthly and yearly costs are converted to weekly and spread evenly across open days. Forecast = average of the same weekday over the last 8 weeks, or the same weeks last year if you were closed recently.
          </div>
          <button onClick={changeLaborTarget}
            style={{alignSelf:"flex-start",background:"transparent",color:T.accent,border:`1px solid ${T.border}`,borderRadius:8,padding:"9px 14px",fontWeight:700,fontSize:12,cursor:"pointer"}}>
            Change labor target ({laborTargetPct}%)
          </button>
        </div>
      </div>
    );
  }

  // ── OVERVIEW (Dashboard tab) ────────────────────────────────────────────
  // Layout: compact header → pastel KPI cards → light panels (charts, top
  // items, hours, daily breakdown, break-even, widgets) → right rail on wide
  // screens (attention, today's team, activity, budget, sales data source).
  // Every number comes from existing data; comparisons only when data exists.
  function renderOverview() {
    const paySun = getSunday(demoToday);
    const pwDates = weekDatesFromSunday(payWeek).map(toInputDate);
    const pwLabel = dl(pwDates[0]) + " – " + dl(pwDates[6]);
    const tgt = laborTargetPct || 30;
    const bgt = parseFloat(weeklyBudget) || 0;

    const salesWk = getSales("thisWeek", salesData, payWeek);
    const laborWk = getLabor("thisWeek", salesData, employees, eDayH, payWeek);
    const lastWkStart = addDays(payWeek, -7);
    const salesLast = getSales("thisWeek", salesData, lastWkStart);
    const totalRevenue = salesWk.total;
    const payWeekLabor = laborWk.total;
    const pwHrs = employees.reduce((s, e) => s + eWkH(payWeek, e.id), 0);
    const pwStaff = employees.filter(e => eWkH(payWeek, e.id) > 0).length;

    // UI Batch 22 — seasons. A fully closed week shows last season instead of zeros,
    // and a week right after reopening compares to the same week last season.
    const weekClosed = season.on && pwDates.every(d => !openDay(d));
    const lastWeekClosed = season.on && weekDatesFromSunday(lastWkStart).map(toInputDate).every(d => !openDay(d));
    const cmpStart = lastWeekClosed && !weekClosed ? addDays(payWeek, -364) : lastWkStart;
    const cmpLabel = cmpStart === lastWkStart ? "last week" : "last season";
    const salesCmp = cmpStart === lastWkStart ? salesLast : getSales("thisWeek", salesData, getSunday(cmpStart));
    const viewSeason = weekClosed ? seasonInfo(pwDates[0], season) : null;
    let lastSeasonSales = 0, lastSeasonLabor = 0;
    if (viewSeason?.last) {
      const { start, end } = viewSeason.last;
      salesData.forEach(d => { if (d.date >= start && d.date <= end) lastSeasonSales += d.revenue || 0; });
      for (let d = start; d <= end; d = addDays(d, 1)) {
        const ws = getSunday(d), di = Math.round((new Date(d+"T00:00:00") - new Date(ws+"T00:00:00")) / 86400000);
        lastSeasonLabor += employees.reduce((s,e) => s + eDayH(ws, e.id, di) * (parseFloat(e.hourlyRate)||0), 0);
      }
    }
    const lastSeasonPct = lastSeasonSales > 0 && lastSeasonLabor > 0 ? lastSeasonLabor / lastSeasonSales * 100 : null;

    // Sales vs. last week — same days only (so a week in progress compares fairly)
    const daysIn = salesWk.days.filter(d => d.date <= demoToday).length;
    const curToDate = salesWk.days.slice(0, daysIn).reduce((s, d) => s + d.revenue, 0);
    const prevToDate = salesCmp.days.slice(0, daysIn).reduce((s, d) => s + d.revenue, 0);
    const salesDelta = daysIn > 0 && prevToDate > 0 && curToDate > 0 ? (curToDate - prevToDate) / prevToDate * 100 : null;

    // Labor % (actual = labor on days that had sales ÷ those sales)
    const laborOnSalesDays = salesWk.days.reduce((s, d, i) => s + (d.revenue > 0 ? laborWk.days[i].labor : 0), 0);
    const actualPct = totalRevenue > 0 ? laborOnSalesDays / totalRevenue * 100 : null;
    const forecastWk = getForecast("thisWeek", salesData, payWeek);
    const projPct = forecastWk.hasEnoughData && forecastWk.total > 0 ? payWeekLabor / forecastWk.total * 100 : null;
    const shownPct = laborPctMode === "projected" ? projPct : actualPct;
    const pctTone = shownPct == null ? T.sub : shownPct > tgt + 5 ? "#A93226" : shownPct > tgt - 5 ? "#8A5A00" : "#1F6B48";
    const forecastNext7 = getForecast("next7", salesData, isDemoBiz ? DEMO_TODAY_ANCHOR : undefined);
    // Closed now → forecast the first week back instead of the (closed) next 7 days
    const forecastReopen = !seasonNow.open && seasonNow.reopens ? getForecast("thisWeek", salesData, seasonNow.reopens) : null;

    // Suggested budget (unchanged logic)
    const wkSalesDays = salesWk.days.filter(d => d.hasData);
    const suggestedDailyRevenue = forecastWk.hasEnoughData ? forecastWk.total / 7 : totalRevenue > 0 ? totalRevenue / Math.max(1, wkSalesDays.length) : 0;
    const suggestedDailyLabor = Math.round(suggestedDailyRevenue * tgt / 100);
    const suggestedWeeklyBudget = suggestedDailyLabor * 7;

    const chartData = salesWk.days.map((d, i) => ({
      day: DAYS[i],
      Sales: d.hasData ? Math.round(d.revenue) : null,
      Labor: Math.round(laborWk.days[i].labor),
      "Last week": salesCmp.days[i].hasData ? Math.round(salesCmp.days[i].revenue) : null,
    }));
    const hasLastWeek = salesCmp.days.some(d => d.hasData);
    const hoursData = employees.map(e => ({ name: (e.name || "Unnamed").split(" ")[0], hours: Math.round(eWkH(payWeek, e.id) * 10) / 10, color: e.color || T.accent }))
      .filter(x => x.hours > 0).sort((a, b) => b.hours - a.hours);

    // Right rail data
    const thirtyAgo = new Date(new Date(demoToday + "T12:00:00") - 30 * 86400000);
    const flagCount = punches.filter(p => p.flags?.includes("NO_SHIFT") && !punchReviews[p.id] && new Date(p.time) > thirtyAgo && employees.some(e => e.id === p.empId)).length;
    const openCallouts = openShifts.filter(o => o.status === "open").length;
    const todayIdx = new Date(demoToday + "T12:00:00").getDay();
    const todayWk = getSunday(demoToday);
    const todayTeam = employees.map(e => ({ e, s: schedule?.[todayWk]?.[e.id]?.[todayIdx] })).filter(x => x.s).sort((a, b) => a.s.start - b.s.start);
    const ago = iso => {
      const m = Math.round((Date.now() - new Date(iso)) / 60000);
      if (m < 1) return "Just now"; if (m < 60) return `${m} min ago`;
      const h = Math.round(m / 60); if (h < 24) return `${h} hr ago`;
      return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };

    // Styles for this page
    const C = { blue:"#E4EFFB", lav:"#ECEAFB", mint:"#E4F3EC", sand:"#F7EFE2", panel:"#F7F8F6", ink:"#1C2B22", sub:"#5E6B63", line:"#E6E8E4" };
    const panel = { background: C.panel, borderRadius: 18, padding: "16px 18px", border: `1px solid ${C.line}` };
    const panelTitle = { fontSize: 13.5, fontWeight: 800, color: C.ink, margin: 0 };
    // One header row height for every panel and KPI card, so titles, values
    // and empty states start on the same line across a row.
    const panelHead = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, minHeight: 32, marginBottom: 12, flexWrap: "wrap" };
    const emptyState = { fontSize: 12.5, color: C.sub, minHeight: 160, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", lineHeight: 1.5, padding: "0 12px" };
    const kpiHead = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, minHeight: 26 };
    const kpi = bg => ({ background: bg, borderRadius: 18, padding: "16px 18px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 });
    const kpiLabel = { fontSize: 12.5, fontWeight: 600, color: C.sub };
    const kpiValue = { fontSize: 26, fontWeight: 800, color: C.ink, lineHeight: 1.1 };
    const railTitle = { fontSize: 12.5, fontWeight: 800, color: C.ink, margin: "0 0 8px" };
    const btnGhost = { background: "#FFFFFF", border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 12px", fontSize: 12, fontWeight: 700, color: C.ink, cursor: "pointer", minHeight: 36 };
    const deltaChip = (v, upGood = true) => {
      if (v == null) return null;
      const good = upGood ? v >= 0 : v < 0;
      return <span style={{ fontSize: 11.5, fontWeight: 700, color: good ? "#1F6B48" : "#A93226" }}>{v >= 0 ? "▲" : "▼"} {Math.abs(v).toFixed(1)}%</span>;
    };
    const items = ovItems && ovItems.week === payWeek ? ovItems : null;
    const maxItem = items?.rows?.length ? Math.max(...items.rows.map(r => r.sales)) : 0;

    return (
      <div className="ov-wrap">
        <div className="ov-main ov-frame">
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: C.ink, margin: 0, lineHeight: 1.2 }}>Overview</h1>
              <div style={{ fontSize: 12.5, color: C.sub, marginTop: 2 }}>{biz} · {pwLabel}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <div className="sw-datebar" style={{ display: "flex", alignItems: "center", gap: 6, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 4 }}>
              <button aria-label="Previous week" onClick={() => setPayWeek(getSunday(addDays(payWeek, -7)))} style={{ ...btnGhost, width: 40, padding: 0 }}>‹</button>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, padding: "0 4px", whiteSpace: "nowrap", minWidth: 132, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{payWeek === paySun ? "This week" : pwLabel}</span>
              <button aria-label="Next week" onClick={() => setPayWeek(getSunday(addDays(payWeek, 7)))} style={{ ...btnGhost, width: 40, padding: 0 }}>›</button>
              <button onClick={() => setPayWeek(paySun)} disabled={payWeek === paySun} title={payWeek === paySun ? "Already on this week" : "Jump to this week"}
                style={{ ...btnGhost, color: T.accent, opacity: payWeek === paySun ? 0.45 : 1, cursor: payWeek === paySun ? "default" : "pointer" }}>Today</button>
              </div>
              {squareConnected && <button onClick={handleSyncSquare} disabled={squareSyncing} style={{ ...btnGhost, opacity: squareSyncing ? 0.6 : 1 }}>{squareSyncing ? "Syncing…" : "Sync Square"}</button>}
            </div>
          </div>

          {seasonNow.seasonal && !seasonNow.open && (
            <div role="status" style={{ background: "#F6EEE3", border: "1px solid #E8D6BD", borderRadius: 12, padding: "12px 16px", fontSize: 14, color: C.ink }}>
              <strong>Closed for the season.</strong> Reopens {fmtLongDate(seasonNow.reopens)}.
            </div>
          )}

          {/* KPI cards */}
          <div className="ov-kpis">
            <div style={kpi(C.blue)}>
              <div style={kpiHead}><span style={kpiLabel}>Sales this week</span></div>
              <span style={kpiValue}>{weekClosed && totalRevenue === 0 ? "Closed" : totalRevenue > 0 ? fmtMoney(totalRevenue) : "—"}</span>
              <span style={{ fontSize: 11.5, color: C.sub }}>{weekClosed && totalRevenue === 0 ? (lastSeasonSales > 0 ? `Last season: ${fmtMoney(lastSeasonSales)} total` : "Closed for the season") : salesDelta != null ? <>{deltaChip(salesDelta)} vs. same days {cmpLabel}</> : totalRevenue > 0 ? `${wkSalesDays.length} day${wkSalesDays.length !== 1 ? "s" : ""} of sales` : "No sales recorded yet"}</span>
            </div>
            {(() => {
              // Payroll this week. Projected = scheduled hours × hourly pay (same math as the
              // schedule grid). Actual = punched hours × hourly pay. Straight time — no OT premium.
              const pp = ovPayPunches && ovPayPunches.week === payWeek ? ovPayPunches : null;
              let actualTotal = null, actualHrs = 0;
              if (pp && !pp.loading && !pp.error) {
                const byEmpDay = {};
                pp.rows.forEach(p => { if (!p.time) return; const ds = toLocalDateStr(new Date(p.time)); (byEmpDay[`${p.empId}__${ds}`] ||= []).push(p); });
                actualTotal = 0;
                Object.entries(byEmpDay).forEach(([k, dayPunches]) => {
                  const empId = k.split("__")[0];
                  const emp = allEmployees.find(e => e.id === empId);
                  const hrs = calcActualHours([...dayPunches].sort((a,b) => new Date(a.time) - new Date(b.time)));
                  actualHrs += hrs;
                  actualTotal += hrs * (parseFloat(emp?.hourlyRate) || 0);
                });
              }
              const isActual = payrollMode === "actual";
              const value = isActual ? actualTotal : payWeekLabor;
              const overBudget = bgt > 0 && value != null && value > bgt;
              return (
                <div style={kpi(C.lav)}>
                  <span style={{ ...kpiLabel, ...kpiHead }}>
                    Payroll this week
                    <span role="group" aria-label="Projected or actual payroll" style={{ display: "flex", background: "rgba(255,255,255,0.7)", borderRadius: 999, padding: 2 }}>
                      {["projected", "actual"].map(m => (
                        <button key={m} onClick={() => setPayrollMode(m)} aria-pressed={payrollMode === m}
                          style={{ border: "none", borderRadius: 999, padding: "3px 8px", fontSize: 10.5, lineHeight: 1.4, fontWeight: 700, cursor: "pointer", textTransform: "capitalize", background: payrollMode === m ? C.ink : "transparent", color: payrollMode === m ? "white" : C.sub }}>{m}</button>
                      ))}
                    </span>
                  </span>
                  <span style={{ ...kpiValue, color: overBudget ? "#A93226" : C.ink }}>
                    {isActual && pp?.loading ? "…" : value != null ? fmtMoney(value) : "—"}
                  </span>
                  <span style={{ fontSize: 11.5, color: C.sub }}>
                    {isActual
                      ? (pp?.error ? <>Couldn't load punches. <button onClick={() => loadOverviewPayPunches(payWeek)} style={{ background: "none", border: "none", color: T.accent, fontWeight: 700, cursor: "pointer", padding: 0, fontSize: 11.5 }}>Try again</button></>
                        : pp?.loading || !pp ? "Loading punches…"
                        : `${actualHrs.toFixed(1)}h worked · projected ${fmtMoney(payWeekLabor)}`)
                      : weekClosed && pwHrs === 0 ? "No shifts while closed"
                      : `${pwHrs.toFixed(1)}h · ${pwStaff} of ${employees.length} staff scheduled${bgt > 0 ? ` · budget ${fmtMoney(bgt)}` : ""}`}
                  </span>
                </div>
              );
            })()}
            <div style={kpi(C.mint)}>
              <span style={{ ...kpiLabel, ...kpiHead }}>
                Labor % of sales
                <span role="group" aria-label="Actual or projected" style={{ display: "flex", background: "rgba(255,255,255,0.7)", borderRadius: 999, padding: 2 }}>
                  {["actual", "projected"].map(m => (
                    <button key={m} onClick={() => setLaborPctMode(m)} aria-pressed={laborPctMode === m}
                      style={{ border: "none", borderRadius: 999, padding: "3px 8px", fontSize: 10.5, lineHeight: 1.4, fontWeight: 700, cursor: "pointer", textTransform: "capitalize", background: laborPctMode === m ? C.ink : "transparent", color: laborPctMode === m ? "white" : C.sub }}>{m}</button>
                  ))}
                </span>
              </span>
              {weekClosed && shownPct == null ? (<>
                <span style={kpiValue}>{lastSeasonPct != null ? `${lastSeasonPct.toFixed(1)}%` : "—"}</span>
                <span style={{ fontSize: 11.5, color: C.sub }}>{lastSeasonPct != null ? `Last season's average · target ${tgt}%` : "Closed for the season"}</span>
              </>) : (<>
              <span style={{ ...kpiValue, color: pctTone }}>{shownPct != null ? `${shownPct.toFixed(1)}%` : "—"}</span>
              <span style={{ fontSize: 11.5, color: C.sub }}>{shownPct != null ? `Target ${tgt}%` : laborPctMode === "projected" ? "Needs recent sales history" : "No sales recorded yet"}</span>
              </>)}
            </div>
            <div style={kpi(C.sand)}>
              {forecastReopen ? (<>
                <div style={kpiHead}><span style={kpiLabel}>Forecast · first week open</span></div>
                <span style={kpiValue}>{forecastReopen.hasEnoughData ? fmtMoney(forecastReopen.total) : "—"}</span>
                <span style={{ fontSize: 11.5, color: C.sub }}>{forecastReopen.hasEnoughData ? `Week of ${dl(forecastReopen.dates[0])} · from last season` : "Not enough last-season sales yet"}</span>
              </>) : (<>
              <div style={kpiHead}><span style={kpiLabel}>Forecast · next 7 days</span></div>
              <span style={kpiValue}>{forecastNext7.hasEnoughData ? fmtMoney(forecastNext7.total) : "—"}</span>
              <span style={{ fontSize: 11.5, color: C.sub }}>{forecastNext7.hasEnoughData ? `Suggested labor ${fmtMoney(forecastNext7.total * tgt / 100)}` : "No recent sales to forecast from"}</span>
              </>)}
            </div>
          </div>

          {/* Sales vs labor + top items */}
          <div className="ov-row-2-1">
            <section style={panel} aria-label="Sales and labor by day">
              <div style={panelHead}>
                <h2 style={panelTitle}>Sales vs. labor</h2>
                <div style={{ display: "flex", gap: 12, fontSize: 11.5, color: C.sub }}>
                  <span><span style={{ display: "inline-block", width: 10, height: 2, background: C.ink, verticalAlign: "middle", marginRight: 5 }} />Sales</span>
                  <span><span style={{ display: "inline-block", width: 10, height: 2, background: T.accent, verticalAlign: "middle", marginRight: 5 }} />Labor</span>
                  {hasLastWeek && <span><span style={{ display: "inline-block", width: 10, borderTop: "2px dashed #8EA4D2", verticalAlign: "middle", marginRight: 5 }} />{cmpLabel === "last week" ? "Last week" : "Same week last season"}</span>}
                </div>
              </div>
              {totalRevenue === 0 && payWeekLabor === 0 ? (
                <div style={emptyState}>No sales or scheduled labor this week yet.</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <RLineChart data={chartData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke={C.line} vertical={false} />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} stroke={C.sub} />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} stroke={C.sub} width={44} tickFormatter={v => `$${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v}`} />
                    <RTooltip formatter={v => v == null ? "—" : fmtMoney(v)} contentStyle={{ fontSize: 11, borderRadius: 10, border: `1px solid ${C.line}` }} />
                    {hasLastWeek && <Line type="monotone" dataKey="Last week" stroke="#8EA4D2" strokeDasharray="4 4" strokeWidth={1.5} dot={false} connectNulls />}
                    <Line type="monotone" dataKey="Labor" stroke={T.accent} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="Sales" stroke={C.ink} strokeWidth={2.2} dot={{ r: 2.5 }} connectNulls />
                  </RLineChart>
                </ResponsiveContainer>
              )}
            </section>

            <section style={panel} aria-label="Top items this week">
              <div style={panelHead}><h2 style={panelTitle}>Top items this week</h2></div>
              {!items || items.loading ? (
                <div style={emptyState}>Loading item sales…</div>
              ) : items.error ? (
                <div style={{ fontSize: 12.5, color: "#A93226" }}>Couldn't load item sales. <button onClick={() => loadOverviewItems(payWeek)} style={{ background: "none", border: "none", color: T.accent, fontWeight: 700, cursor: "pointer", padding: 0 }}>Try again</button></div>
              ) : !items.rows.length ? (
                <div style={emptyState}>{squareConnected ? "No item sales this week." : "Item sales appear after you connect Square and sync."}</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                  {items.rows.map(r => (
                    <div key={r.key}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5 }}>
                        <span style={{ color: C.ink, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                        <span style={{ color: C.sub, whiteSpace: "nowrap" }}>{fmtMoney(r.sales)} · {Math.round(r.units)}</span>
                      </div>
                      <div style={{ height: 4, background: C.line, borderRadius: 2, marginTop: 5 }}><div style={{ height: "100%", width: `${maxItem ? r.sales / maxItem * 100 : 0}%`, background: C.ink, borderRadius: 2 }} /></div>
                    </div>
                  ))}
                  <button onClick={() => setDashSub("reports")} style={{ background: "none", border: "none", color: T.accent, fontWeight: 700, fontSize: 12, cursor: "pointer", padding: "6px 0", alignSelf: "flex-start" }}>All items in Report Builder →</button>
                </div>
              )}
            </section>
          </div>

          {/* Hours by employee + daily breakdown */}
          <div className="ov-row-1-1">
            <section style={panel} aria-label="Scheduled hours by employee">
              <div style={panelHead}><h2 style={panelTitle}>Scheduled hours by employee</h2></div>
              {hoursData.length === 0 ? <div style={emptyState}>No shifts scheduled this week.</div> : (
                <ResponsiveContainer width="100%" height={200}>
                  <RBarChart data={hoursData} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke={C.line} vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} stroke={C.sub} interval={0} />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} stroke={C.sub} width={34} />
                    <RTooltip formatter={v => `${v}h`} contentStyle={{ fontSize: 11, borderRadius: 10, border: `1px solid ${C.line}` }} />
                    <Bar dataKey="hours" radius={[8, 8, 8, 8]} maxBarSize={28}>
                      {hoursData.map((h, i) => <Cell key={i} fill={h.color} />)}
                    </Bar>
                  </RBarChart>
                </ResponsiveContainer>
              )}
            </section>

            <section style={panel} aria-label="Daily breakdown">
              <div style={panelHead}>
                <h2 style={panelTitle}>Daily breakdown</h2>
                <button onClick={toggleCashMode} aria-pressed={cashMode}
                  style={{ ...btnGhost, padding: "0 10px", height: 32, fontSize: 11.5, color: cashMode ? "#1F6B48" : C.sub, borderColor: cashMode ? "#9CCFB5" : C.line }}>
                  {cashMode ? "Cash entry on" : "Enter cash sales"}
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr) minmax(0,1fr) 64px", gap: 8, padding: "0 0 6px", fontSize: 11, fontWeight: 700, color: C.sub, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                <span>Day</span><span style={{ textAlign: "right" }}>Sales</span><span style={{ textAlign: "right" }}>Labor</span><span style={{ textAlign: "right" }}>Labor %</span>
              </div>
              {salesWk.days.map((d, i) => {
                const labor = laborWk.days[i].labor;
                const p = d.revenue > 0 ? labor / d.revenue * 100 : null;
                return (
                  <div key={d.date} style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr) minmax(0,1fr) 64px", alignItems: "center", gap: 8, padding: "7px 0", borderTop: `1px solid ${C.line}`, fontVariantNumeric: "tabular-nums", fontSize: 12.5 }}>
                    <span style={{ fontWeight: 700, color: C.ink }}>{DAYS[i]}</span>
                    {cashMode ? (
                      <input type="number" min="0" step="0.01" aria-label={`Cash sales ${DAYS[i]}`} placeholder="Cash $"
                        defaultValue={cashEntries[d.date] > 0 ? cashEntries[d.date] : ""} key={`cash-${d.date}-${cashEntries[d.date]}`}
                        onBlur={e => saveCashEntry(d.date, e.target.value)} onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                        style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 8px", fontSize: 12.5, background: "white", color: C.ink, textAlign: "right" }} />
                    ) : (
                      <span style={{ color: d.revenue > 0 ? C.ink : C.sub, textAlign: "right" }}>{d.revenue > 0 ? fmtMoney(d.revenue) : "—"}</span>
                    )}
                    <span style={{ color: labor > 0 ? C.ink : C.sub, textAlign: "right" }}>{labor > 0 ? fmtMoney(labor) : "—"}</span>
                    <span style={{ textAlign: "right", fontWeight: 700, color: p == null ? C.sub : p > tgt + 5 ? "#A93226" : p > tgt - 5 ? "#8A5A00" : "#1F6B48" }}>{p != null ? `${p.toFixed(0)}%` : "—"}</span>
                  </div>
                );
              })}
            </section>
          </div>

          {/* Break-even — UI Batch 9: hidden until opened */}
          <section aria-label="Break-even">
            <button onClick={() => setBeOpen(o => !o)} aria-expanded={beOpen}
              style={{ ...panel, width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", fontFamily: "inherit", textAlign: "left", marginBottom: beOpen ? 10 : 0 }}>
              <span style={panelTitle}>Break-even</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: T.accent }}>
                {beOpen ? "Hide" : "View"}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: beOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}><path d="m6 9 6 6 6-6"/></svg>
              </span>
            </button>
            {beOpen && renderBreakEvenCard()}
          </section>

          {/* Widgets */}
          <section style={panel} aria-label="Your widgets">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={panelTitle}>Your widgets</h2>
              <button onClick={() => { setShowAddWidget(true); setAwOpenSection({ data:true, range:false, viz:false, size:false, style:false }); setNewWidget({ data_source:"sales", time_range:"last7", display:"stat", color:null, size:"sm", show_axis:true, show_legend:true }); }}
                style={{ ...btnGhost, background: T.accent, color: "white", border: "none" }}>+ Add widget</button>
            </div>
            {widgets.length === 0 ? (
              <div style={{ fontSize: 12.5, color: C.sub, textAlign: "center", padding: "18px 0", lineHeight: 1.6 }}>
                No widgets yet. Add a sales, labor, or forecast widget, or pin any report from Report Builder.
              </div>
            ) : (
              <div className="ov-widgets">{widgets.map(w => renderWidgetCard(w))}</div>
            )}
          </section>
        </div>
      </div>
    );
  }

  // Report Builder — lives under Dashboard → Report Builder
  function renderReportBuilderPanel() {
    return (
                  <Card T={T} style={{padding:"14px 16px"}}>
                    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:14,gap:12,flexWrap:"wrap"}}>
                      <div>
                        <div style={{fontWeight:800,fontSize:14,color:T.text}}>📊 Report Builder</div>
                        <div style={{fontSize:11,color:T.sub,marginTop:2}}>Pick sources, fields, and how to view them — cross-reference up to 3 at once.</div>
                      </div>
                      <div style={{display:"flex",gap:8}}>
                        <button onClick={rbResetAll} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,padding:"5px 10px",fontSize:11,fontWeight:600,color:T.sub,cursor:"pointer"}}>Reset</button>
                        <button onClick={()=>setDashSub("overview")} style={{background:T.muted,border:"none",borderRadius:"50%",width:28,height:28,fontSize:16,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>×</button>
                      </div>
                    </div>

                    {/* UI Batch 10b — Group by / Date range / Visualization as dropdowns at the top */}
                    {(()=>{
                      const sel = (on) => ({width:"100%",appearance:"none",WebkitAppearance:"none",height:40,border:`1.5px solid ${on?T.accent:T.border}`,borderRadius:9,background:T.surface,padding:"0 34px 0 12px",fontSize:13,fontWeight:on?700:500,color:on?T.text:T.sub,fontFamily:"inherit",boxSizing:"border-box",cursor:"pointer"});
                      const lab = {fontSize:11,fontWeight:700,color:T.sub};
                      const chev = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.sub} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{position:"absolute",right:12,top:13,pointerEvents:"none"}}><path d="m6 9 6 6 6-6"/></svg>;
                      const vizOpts = [{id:"number",label:"Number"},{id:"line",label:"Line"},{id:"bar",label:"Bar"},{id:"area",label:"Area"},{id:"combo",label:"Combo"},{id:"list",label:"List"},{id:"table",label:"Table"}]
                        .filter(v => !((rbGrouping==="Employee" || rbGrouping==="Shift Type" || rbGrouping==="Item" || rbGrouping==="Flag Type") && v.id==="number")); // "Number" is a first-vs-last delta — meaningless across rows
                      return (
                        <div style={{marginBottom:16}}>
                          <div className="rb-dd-row" style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:10}}>
                            <div style={{display:"flex",flexDirection:"column",gap:5,minWidth:0}}>
                              <label htmlFor="rb-group" style={lab}>Group by</label>
                              <div style={{position:"relative"}}>
                                <select id="rb-group" value={rbGrouping||""} onChange={e=>{ const g=e.target.value||null; setRbGrouping(g); setRbResult(null); if((g==="Employee"||g==="Shift Type"||g==="Item"||g==="Flag Type")&&rbVizType==="number") setRbVizType(null); }} style={sel(!!rbGrouping)}>
                                  <option value="">Choose…</option>
                                  {["Day","Week","Day of Week","Employee","Shift Type","Item","Flag Type"].map(g=><option key={g} value={g}>{g}</option>)}
                                </select>{chev}
                              </div>
                            </div>
                            <div style={{display:"flex",flexDirection:"column",gap:5,minWidth:0}}>
                              <label htmlFor="rb-date" style={lab}>Date range</label>
                              <div style={{position:"relative"}}>
                                <select id="rb-date" value={rbPreset||""} onChange={e=>{ setRbPreset(e.target.value||null); setRbResult(null); }} style={sel(!!rbPreset)}>
                                  <option value="">Choose…</option>
                                  {FILTERS.filter(f=>f.kind==="history").map(f=><option key={f.key} value={f.key}>{f.label}</option>)}
                                  <option value="custom">Custom…</option>
                                </select>{chev}
                              </div>
                            </div>
                            <div style={{display:"flex",flexDirection:"column",gap:5,minWidth:0}}>
                              <label htmlFor="rb-viz" style={lab}>Visualization</label>
                              <div style={{position:"relative"}}>
                                <select id="rb-viz" value={rbVizType||""} onChange={e=>setRbVizType(e.target.value||null)} style={sel(!!rbVizType)}>
                                  <option value="">Choose…</option>
                                  {vizOpts.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}
                                </select>{chev}
                              </div>
                            </div>
                          </div>
                          {rbPreset==="custom" && (
                            <div style={{marginTop:10}}>
                              <RangeCalendar T={T} start={rbCustomStart} end={rbCustomEnd} anchor={isDemoBiz ? DEMO_TODAY_ANCHOR : undefined}
                                onChange={(s,e)=>{ setRbCustomStart(s); setRbCustomEnd(e); setRbResult(null); }}/>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* UI Batch 11 — Option A: source chips, then per-source filter buttons that open scroll menus */}
                    {(()=>{
                      const activeIds = rbActiveSourceIds();
                      const CheckBox = ({on, color}) => (
                        <span aria-hidden="true" style={{width:18,height:18,borderRadius:5,border:`1.5px solid ${on?color:T.border}`,background:on?color:T.surface,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7"/></svg>}
                        </span>
                      );
                      const chev = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.sub} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>;
                      const xIcon = <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>;
                      const clearFilter = (sid, fid) => { setRbResult(null); setRbSources(p=>({...p,[sid]:{...p[sid],filters:{...p[sid].filters,[fid]:[]}}})); };
                      return (
                        <div style={{marginBottom:16}}>
                          <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:8}}>
                            <div style={{fontSize:14,fontWeight:800,color:T.text}}>Data sources</div>
                            <div style={{fontSize:12.5,fontWeight:600,color:T.sub}}>{activeIds.length} of 3</div>
                          </div>
                          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                            {Object.entries(REPORT_SOURCES).map(([sid,def])=>{
                              const on = !!rbSources[sid]?.active;
                              const capped = !on && activeIds.length >= 3;
                              return (
                                <button key={sid} onClick={()=>{ if (!capped) { rbToggleSource(sid); setRbMenu(null); } }} aria-pressed={on} disabled={capped}
                                  title={capped ? "Up to 3 sources — turn one off first" : undefined}
                                  style={{display:"flex",alignItems:"center",gap:8,minHeight:40,padding:"0 14px",borderRadius:999,border:`1.5px solid ${on?def.color:T.border}`,background:on?def.color+"14":T.surface,fontSize:13,fontWeight:700,color:T.text,cursor:capped?"not-allowed":"pointer",opacity:capped?0.45:1,fontFamily:"inherit"}}>
                                  <CheckBox on={on} color={def.color}/>{def.label}
                                </button>
                              );
                            })}
                          </div>

                          {activeIds.map(sid=>{
                            const def = REPORT_SOURCES[sid];
                            const state = rbSources[sid];
                            const chips = [
                              ...state.fields.map(fid => ({ key:"f"+fid, label: def.fields.find(f=>f.id===fid)?.label || fid, remove: ()=>rbToggleField(sid,fid) })),
                              ...def.filters.filter(fl => (state.filters[fl.id]||[]).length).map(fl => {
                                const picked = state.filters[fl.id];
                                const names = picked.map(v => fl.options.find(o=>o.value===v)?.label || v);
                                const short = names.length > 2 ? `${names.slice(0,2).join(", ")} +${names.length-2}` : names.join(", ");
                                return { key:"x"+fl.id, label:`${fl.label}: ${short}`, remove: ()=>clearFilter(sid, fl.id) };
                              }),
                            ];
                            const menus = [{ key:"fields", label:"Fields", count: state.fields.length, fl:null }, ...def.filters.map(fl => ({ key:fl.id, label:fl.label, count:(state.filters[fl.id]||[]).length, fl }))];
                            return (
                              <div key={sid} style={{marginTop:14,border:`1px solid ${def.color}55`,borderRadius:12,padding:14,background:def.color+"08"}}>
                                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:10}}>
                                  <div style={{fontSize:14,fontWeight:800,color:T.text}}>{def.label}</div>
                                  {sid==="shifttypes" && (
                                    <button onClick={()=>{ setTab("settings"); setSettingsSection("general"); setSettingsFolder("shifts"); }}
                                      style={{background:"none",border:"none",color:T.accent,fontWeight:700,fontSize:12,cursor:"pointer",padding:0}}>Edit shift types</button>
                                  )}
                                </div>
                                {chips.length > 0 ? (
                                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
                                    {chips.map(c => (
                                      <span key={c.key} style={{display:"inline-flex",alignItems:"center",gap:6,background:T.muted,border:`1px solid ${T.border}`,borderRadius:999,padding:"5px 6px 5px 12px",fontSize:12.5,fontWeight:600,color:T.text,maxWidth:"100%"}}>
                                        <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.label}</span>
                                        <button onClick={c.remove} aria-label={`Remove ${c.label}`}
                                          style={{width:24,height:24,borderRadius:999,border:"none",background:T.surface,color:T.sub,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0}}>{xIcon}</button>
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <div style={{fontSize:12.5,color:T.sub,marginBottom:12}}>Pick at least one field. Filters are optional.</div>
                                )}
                                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                                  {menus.map(m => {
                                    const mk = `${sid}|${m.key}`;
                                    const open = rbMenu === mk;
                                    const fl = m.fl;
                                    let items, search = null;
                                    if (!fl) {
                                      items = def.fields.map(f => ({ value:f.id, label:f.label, on: state.fields.includes(f.id), toggle: ()=>rbToggleField(sid,f.id) }));
                                    } else {
                                      const sKey = `${sid}|${fl.id}`;
                                      const q = (rbFilterSearch[sKey] || "").trim().toLowerCase();
                                      const chosen = state.filters[fl.id] || [];
                                      const long = fl.options.length > 8;
                                      const shown = !long ? fl.options
                                        : q ? fl.options.filter(o => chosen.includes(o.value) || o.label.toLowerCase().includes(q)).slice(0, 40)
                                            : fl.options.filter((o, i) => i < 12 || chosen.includes(o.value)); // top sellers first
                                      items = shown.map(o => ({ value:o.value, label:o.label, on: chosen.includes(o.value), toggle: ()=>rbToggleFilter(sid,fl.id,o.value) }));
                                      if (long) search = (
                                        <input value={rbFilterSearch[sKey] || ""} onChange={e=>setRbFilterSearch(p=>({...p,[sKey]:e.target.value}))}
                                          placeholder={`Search ${fl.options.length} ${fl.label.toLowerCase()}s…`} aria-label={`Search ${fl.label}`} autoFocus
                                          style={{width:"100%",height:38,boxSizing:"border-box",border:`1.5px solid ${T.border}`,borderRadius:8,padding:"0 12px",fontSize:13,outline:"none",background:T.surface,color:T.text,marginBottom:6}}/>
                                      );
                                    }
                                    return (
                                      <div key={m.key} style={{position:"relative"}}>
                                        <button onClick={()=>setRbMenu(open ? null : mk)} aria-expanded={open}
                                          style={{display:"flex",alignItems:"center",gap:8,minHeight:40,padding:"0 12px",borderRadius:9,border:`1.5px solid ${open||m.count?def.color:T.border}`,background:T.surface,fontSize:13,fontWeight:700,color:T.text,cursor:"pointer",fontFamily:"inherit"}}>
                                          {m.label}
                                          {m.count > 0 && <span style={{background:def.color,color:"white",borderRadius:999,padding:"1px 8px",fontSize:11}}>{m.count}</span>}
                                          <span style={{display:"flex",transform:open?"rotate(180deg)":"none",transition:"transform 0.15s"}}>{chev}</span>
                                        </button>
                                        {open && (
                                          <>
                                            <div onClick={()=>setRbMenu(null)} style={{position:"fixed",inset:0,zIndex:550}}/>
                                            <div role="dialog" aria-label={m.label} style={{position:"absolute",top:"calc(100% + 6px)",left:0,width:300,maxWidth:"calc(100vw - 48px)",background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,boxShadow:T.shadowMd,padding:10,zIndex:600}}>
                                              {sid==="itemsales" && fl?.id==="item" && itemNames && itemNames.length===0 && (
                                                <div style={{fontSize:12,color:T.sub,padding:"4px 6px 8px"}}>No item sales yet — items appear after a Square sync.</div>
                                              )}
                                              {search}
                                              <div style={{maxHeight:220,overflowY:"auto",display:"flex",flexDirection:"column",gap:2,paddingRight:2}}>
                                                {items.length === 0 && <div style={{fontSize:12.5,color:T.sub,padding:"8px 6px"}}>No matches.</div>}
                                                {items.map(it => (
                                                  <button key={it.value} onClick={it.toggle} aria-pressed={it.on}
                                                    style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",borderRadius:8,border:"none",background:it.on?def.color+"14":"transparent",fontSize:13.5,fontWeight:it.on?700:500,color:T.text,cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
                                                    <CheckBox on={it.on} color={def.color}/><span>{it.label}</span>
                                                  </button>
                                                ))}
                                              </div>
                                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderTop:`1px solid ${T.border}`,marginTop:8,paddingTop:8}}>
                                                <button onClick={()=>{ if (!fl) { state.fields.slice().forEach(fid=>rbToggleField(sid,fid)); } else clearFilter(sid, fl.id); }}
                                                  disabled={!m.count} style={{background:"none",border:"none",color:T.sub,fontSize:12.5,fontWeight:600,textDecoration:"underline",cursor:m.count?"pointer":"default",opacity:m.count?1:0.5,padding:0}}>Clear</button>
                                                <button onClick={()=>setRbMenu(null)} style={{background:T.accent,color:"white",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:700,cursor:"pointer"}}>Done</button>
                                              </div>
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    <button onClick={runCustomReportUI} disabled={rbLoading}
                      style={{width:"100%",background:rbLoading?T.muted:T.accent,border:"none",borderRadius:10,padding:"11px 0",fontSize:13,fontWeight:800,color:rbLoading?T.sub:"white",cursor:rbLoading?"not-allowed":"pointer",marginBottom:16}}>
                      {rbLoading ? "Running…" : "Run Report"}
                    </button>

                    {rbResult && (()=>{
                      const fieldKeys = rbActiveFieldKeys();
                      return (
                        <>
                          {renderReportResult(rbResult.data, rbVizType, rbGrouping, fieldKeys, rbResult.truncated, rbResult.emptyReason)}

                          {rbResult.data.length > 0 && <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                            <button onClick={rbExportCSV} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 12px",borderRadius:9,border:`1px solid ${T.border}`,background:"transparent",color:T.text,fontSize:11,fontWeight:600,cursor:"pointer"}}>⬇ Export CSV</button>
                            <button onClick={()=>{
                              const t = window.prompt("Name this widget for your Dashboard:", "Custom Report");
                              if (t !== null) addReportWidgetToDashboard(t);
                            }} disabled={widgetSaving} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 12px",borderRadius:9,border:"none",background:T.accent,color:"white",fontSize:11,fontWeight:700,cursor:widgetSaving?"default":"pointer",opacity:widgetSaving?0.6:1}}>+ Add to Dashboard</button>
                          </div>}

                          {rbVizType!=="table" && rbResult.data.length > 0 && (
                            <div style={{border:`1px solid ${T.border}`,borderRadius:10,overflow:"hidden"}}>
                              <button onClick={()=>setRbLineItemsOpen(o=>!o)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",background:"transparent",border:"none",cursor:"pointer",textAlign:"left"}}>
                                <span style={{fontSize:11.5,fontWeight:700,color:T.text}}>View Line Items ({rbResult.data.length} rows)</span>
                                <span style={{color:T.sub,fontSize:11}}>{rbLineItemsOpen?"▲":"▼"}</span>
                              </button>
                              {rbLineItemsOpen && (
                                <div style={{padding:"0 12px 12px",maxHeight:280,overflowY:"auto",overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                                  <table style={{width:"100%",minWidth:420,borderCollapse:"collapse",fontSize:11}}>
                                    <thead><tr style={{borderBottom:`1px solid ${T.border}`}}>
                                      <th style={{textAlign:"left",padding:"5px 6px",color:T.sub,fontWeight:700}}>{rbGrouping}</th>
                                      {fieldKeys.map(f=><th key={f.key} style={{textAlign:"left",padding:"5px 6px",color:T.sub,fontWeight:700}}>{f.label}</th>)}
                                    </tr></thead>
                                    <tbody>
                                      {rbResult.data.map((row,i)=>(
                                        <tr key={i} style={{borderBottom:`1px solid ${T.border}`}}>
                                          <td style={{padding:"5px 6px",color:T.text}}>{row.label}</td>
                                          {fieldKeys.map(f=><td key={f.key} style={{padding:"5px 6px",color:T.text}}>{row[f.key] ?? "—"}</td>)}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          )}

                          {rbResult.details && (
                            <div style={{border:`1px solid ${T.border}`,borderRadius:10,overflow:"hidden",marginTop:10}}>
                              <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",flexWrap:"wrap"}}>
                                <button onClick={()=>setRbFlagListOpen(o=>!o)} aria-expanded={rbFlagListOpen}
                                  style={{flex:1,display:"flex",alignItems:"center",justifyContent:"space-between",background:"transparent",border:"none",cursor:"pointer",padding:0,fontFamily:"inherit",minWidth:180}}>
                                  <span style={{fontSize:12.5,fontWeight:700,color:T.text}}>Flagged punches &amp; no-shows ({rbResult.details.length})</span>
                                  <span style={{color:T.sub,fontSize:11}}>{rbFlagListOpen?"▲":"▼"}</span>
                                </button>
                                {rbResult.details.length > 0 && (
                                  <button onClick={rbExportFlagDetailsCSV} style={{padding:"6px 11px",borderRadius:8,border:`1px solid ${T.border}`,background:T.surface,color:T.text,fontSize:11,fontWeight:700,cursor:"pointer"}}>Export list (CSV)</button>
                                )}
                              </div>
                              {rbFlagListOpen && (
                                rbResult.details.length === 0 ? (
                                  <div style={{padding:"0 12px 12px",fontSize:12,color:T.sub}}>No flags or no-shows match this report.</div>
                                ) : (
                                  <div style={{padding:"0 12px 12px",maxHeight:320,overflowY:"auto",overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                                    <table style={{width:"100%",minWidth:560,borderCollapse:"collapse",fontSize:12}}>
                                      <thead><tr style={{borderBottom:`1px solid ${T.border}`,position:"sticky",top:0,background:T.surface}}>
                                        {["Date","Time","Employee","Flag","Punch","Review"].map(h=><th key={h} style={{textAlign:"left",padding:"6px",color:T.sub,fontWeight:700}}>{h}</th>)}
                                      </tr></thead>
                                      <tbody>
                                        {rbResult.details.slice(0,300).map(d=>(
                                          <tr key={d.id} style={{borderBottom:`1px solid ${T.border}`}}>
                                            <td style={{padding:"6px",color:T.text,whiteSpace:"nowrap"}}>{dl(d.date)}</td>
                                            <td style={{padding:"6px",color:T.text,whiteSpace:"nowrap"}}>{d.time}</td>
                                            <td style={{padding:"6px",color:T.text}}>{d.empName}</td>
                                            <td style={{padding:"6px",color:FLAG_REPORT_COLORS[d.flag]||T.text,fontWeight:700}}>{d.flagLabel}</td>
                                            <td style={{padding:"6px",color:T.sub}}>{d.punchType}</td>
                                            <td style={{padding:"6px",color:T.sub}}>{d.review}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                    {rbResult.details.length > 300 && <div style={{fontSize:11,color:T.sub,marginTop:6}}>Showing the newest 300 — export the CSV for all {rbResult.details.length}.</div>}
                                  </div>
                                )
                              )}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </Card>
    );
  }

  // Resolves a widget config into the underlying Sales/Labor/Forecast data
  function computeWidgetResult(config) {
    const anchor = isDemoBiz ? DEMO_TODAY_ANCHOR : undefined;
    const filter = FILTERS.find(f => f.key === config.time_range);
    if (filter?.kind === "forecast") {
      return { kind:"forecast", forecast: getForecast(config.time_range, salesData, anchor) };
    }
    const result = { kind:"history" };
    if (config.data_source !== "labor") result.sales = getSales(config.time_range, salesData, anchor);
    if (config.data_source !== "sales") result.labor = getLabor(config.time_range, salesData, employees, eDayH, anchor);
    if (season.on) { // UI Batch 22 — closed days aren't $0 days
      const trim = r => { if (!r) return r; const days = r.days.filter(d => openDay(d.date)); const total = days.reduce((s,d) => s + (d.revenue ?? d.labor ?? 0), 0);
        return { ...r, days, dates: days.map(d => d.date), total, ...(r.daysWithData !== undefined ? { daysWithData: days.filter(d => d.hasData).length } : {}) }; };
      result.sales = trim(result.sales); result.labor = trim(result.labor);
    }
    return result;
  }

  // Renders a richer Recharts chart for one or more series — Line, Bar,
  // Area, or Combo (area for the first series, bars for the rest), matching
  // the same visualization types available in the Report Builder. Same
  // function signature as before — renderWidgetCard doesn't change.
  function renderMiniChart(series, display, options={}) {
    const { dates=[], showAxis=true, showLegend=true, height=80 } = options;
    const n = series[0]?.values.length || 0;
    const data = Array.from({ length: n }, (_, i) => {
      const row = { date: dates[i] };
      series.forEach(s => { row[s.label] = s.values[i]; });
      return row;
    });

    const axes = (
      <>
        {showAxis && <CartesianGrid stroke={UI.line} vertical={false} />}
        {showAxis && (
          <XAxis dataKey="date" tickFormatter={dl} stroke={UI.sub} fontSize={10}
            tickLine={false} axisLine={false} minTickGap={28} />
        )}
        {showAxis && (
          <YAxis stroke={UI.sub} fontSize={10} tickLine={false} axisLine={false}
            width={38} tickFormatter={v => `$${v >= 1000 ? (v/1000).toFixed(1) + "k" : v}`} />
        )}
        <RTooltip
          formatter={(v) => `$${Number(v).toFixed(0)}`}
          labelFormatter={(d) => dl(d)}
          contentStyle={{ fontSize: 11, borderRadius: 10, border: `1px solid ${UI.line}`, background: "#FFFFFF" }}
        />
        {showLegend && <RLegend wrapperStyle={{ fontSize: 10 }} iconSize={8} />}
      </>
    );

    let ChartComp, seriesEls;
    if (display === "line") {
      ChartComp = RLineChart;
      seriesEls = series.map((s, i) => <Line key={i} type="monotone" dataKey={s.label} stroke={s.color} strokeWidth={2.4} dot={false} activeDot={{ r: 4 }} />);
    } else if (display === "area") {
      ChartComp = RAreaChart;
      seriesEls = series.map((s, i) => <RArea key={i} type="monotone" dataKey={s.label} stroke={s.color} strokeWidth={2.4} fill={s.color} fillOpacity={0.12} />);
    } else if (display === "combo") {
      ChartComp = RComposedChart;
      seriesEls = series.map((s, i) => i === 0
        ? <RArea key={i} type="monotone" dataKey={s.label} stroke={s.color} strokeWidth={2} fill={s.color} fillOpacity={0.12} />
        : <Bar key={i} dataKey={s.label} fill={s.color} radius={[8, 8, 8, 8]} maxBarSize={26} />
      );
    } else { // "bar"
      ChartComp = RBarChart;
      seriesEls = series.map((s, i) => <Bar key={i} dataKey={s.label} fill={s.color} radius={[8, 8, 8, 8]} maxBarSize={26} />);
    }

    return (
      <div>
        <ResponsiveContainer width="100%" height={height}>
          <ChartComp data={data} margin={{ top: 4, right: 4, left: showAxis ? 0 : 4, bottom: 0 }}>
            {axes}
            {seriesEls}
          </ChartComp>
        </ResponsiveContainer>
      </div>
    );
  }

  // Renders one widget card based on its saved config
  function renderWidgetCard(config) {
    if (config.config?.report) {
      const def = config.config.report;
      const rw = reportWidgetData[config.id];
      const title = def.title || "Custom Report";
      const gridH = config.grid_h || 1;
      let body;
      if (!rw || rw.loading) {
        body = <div style={{fontSize:12,color:T.sub,textAlign:"center",padding:"24px 0"}}>Loading…</div>;
      } else if (rw.error) {
        body = <div style={{fontSize:12,color:"#C0392B",textAlign:"center",padding:"20px 0"}}>Couldn't load this report.</div>;
      } else {
        const fieldKeys = fieldKeysFromConfig(def.sources);
        body = renderReportResult(rw.result.data, def.vizType, def.grouping, fieldKeys, rw.result.truncated);
      }
      return renderWidgetChrome(config, title, body);
    }
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
            <div style={{fontSize:11,color:T.sub,marginTop:2}}>suggested labor: ${Math.round(result.forecast.total*(laborTargetPct||30)/100)}</div>
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
    } else if (config.display === "line" || config.display === "bar" || config.display === "area" || config.display === "combo") {
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

    return renderWidgetChrome(config, title, body);
  }

  function renderWidgetChrome(config, title, body) {
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
        style={{background:"#FFFFFF",border:`1px solid ${UI.line}`,borderRadius:14,padding:"12px 14px",position:"relative",gridColumn:`span ${config.grid_w||1}`,gridRow:`span ${config.grid_h||1}`,opacity:isDragging?0.4:1,outline:isDragOver?`2px dashed ${T.accent}`:"none",transition:"opacity 0.15s, outline 0.1s",cursor:"default"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:8}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:6,flex:1,minWidth:0}}>
            <span title="Drag to reorder" style={{color:T.sub,fontSize:14,cursor:"grab",lineHeight:1.2,flexShrink:0,marginTop:1}}>⠿</span>
            <div style={{fontSize:10,color:T.sub,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.04em"}}>{title}</div>
          </div>
          <div style={{display:"flex",gap:6,flexShrink:0,position:"relative"}}>
            <button onClick={()=>setSizeMenuFor(m=>m===config.id?null:config.id)} aria-label={`Widget size (currently ${WIDGET_SIZES[sizeKey].label})`} title={`Size: ${WIDGET_SIZES[sizeKey].label} — tap to change`}
              style={{background:"none",border:"none",color:T.sub,cursor:"pointer",fontSize:13,lineHeight:1,padding:0}}>
              ⤢
            </button>
            {sizeMenuFor === config.id && (
              <>
                <div onClick={()=>setSizeMenuFor(null)} style={{position:"fixed",inset:0,zIndex:998}}/>
                <div style={{position:"absolute",top:20,right:0,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:8,display:"flex",gap:6,zIndex:999,boxShadow:"0 8px 24px rgba(0,0,0,0.18)"}}>
                  {Object.entries(WIDGET_SIZES).map(([key,s])=>(
                    <button key={key} onClick={()=>setWidgetSize(config.id,key)}
                      style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,padding:"6px 8px",borderRadius:8,cursor:"pointer",
                        border:`1.5px solid ${sizeKey===key?T.accent:T.border}`,background:sizeKey===key?T.accent+"14":"transparent"}}>
                      <div style={{width:22,height:22,display:"grid",gridTemplateColumns:`repeat(${s.w},1fr)`,gridTemplateRows:`repeat(${s.h},1fr)`,gap:1.5}}>
                        {Array.from({length:s.w*s.h}).map((_,i)=>(
                          <div key={i} style={{background:sizeKey===key?T.accent:T.sub,borderRadius:1,opacity:sizeKey===key?1:0.4}}/>
                        ))}
                      </div>
                      <span style={{fontSize:9,fontWeight:700,color:sizeKey===key?T.accent:T.text,whiteSpace:"nowrap"}}>{s.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
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

  // ── Cash entry helpers ────────────────────────────────────────────────
  function toggleCashMode() {
    const next = !cashMode;
    setCashMode(next);
    if (bizId) {
      dbPatch(`businesses?id=eq.${bizId}`, { cash_mode: next })
        .catch(()=>{});
    }
  }

  function saveCashEntry(date, amount) {
    const num = parseFloat(amount);
    setCashEntries(prev => ({ ...prev, [date]: isNaN(num) ? 0 : num }));
    // Only the cash row for this day changes; that day's Square sales stay put
    setRawSales(prev => {
      const rest = prev.filter(r => !(r.source === "cash" && r.date === date));
      return !isNaN(num) && num > 0 ? [...rest, { date, revenue: num, transactions: 0, source: "cash" }] : rest;
    });
    if (bizId) {
      const save = !isNaN(num) && num > 0
        ? sbFetch("sales_data?on_conflict=business_id,sale_date,source", {
            method:"POST",
            body:JSON.stringify([{ business_id: bizId, sale_date: date, revenue: num, transactions: 0, source: "cash" }]),
            headers:{ "Prefer":"resolution=merge-duplicates,return=minimal" },
          })
        : dbDelete(`sales_data?business_id=eq.${bizId}&sale_date=eq.${date}&source=eq.cash`);
      save.catch(e => { console.warn("Cash entry save failed:", e); showError(friendlyError(e, "That cash entry didn't save — try again.")); });
    }
  }

  function saveBizNameIfChanged() {
    const ref = bizNameRef.current;
    const name = (biz || "").trim();
    if (!bizId || ref.id !== bizId || !name || name === ref.name) return;
    bizNameRef.current = { id: bizId, name };
    saveBizSettings({ name });
    showToast("Business name saved ✓");
  }

  async function saveBizSettings(fields) {
    if (!bizId) return;
    try { await dbPatch(`businesses?id=eq.${bizId}`, fields); }
    catch(e) { console.warn("Business save failed:", e); showError(friendlyError(e, "Couldn't save that setting — try again.")); }
  }

  // Schedule "Today" button: jump to the current week (demo-aware), with today
  // selected for the Day view; works from the Week, Day, and Month views.
  function goToTodaySchedule() {
    const t = demoToday;
    const s = getSunday(t);
    setWk1Start(s); setActiveWeek(s); setPrintWeek(s); setActiveDay(t);
  }

  // The "today" every date-comparison in the UI should use — real today for
  // real businesses, the fixed demo anchor for Cedar & Sage (whose seeded
  // data lives in June 2026, not whenever this is actually being viewed).
  const demoToday = isDemoBiz ? DEMO_TODAY_ANCHOR : toLocalDateStr(new Date());
  // UI Batch 22 — season status for today; openDay() is the shared "were we open?" check
  const seasonNow = seasonInfo(demoToday, season);
  const openDay = d => isSeasonOpen(d, season);

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
    const data = { _v:2, _at:new Date().toISOString(), biz,weekMode,wk1Start,wk2Start,weeklyBudget,employees,schedule,published,themeId,activeWeek,punches,auditLog,recognition,shiftTypes,salesData: rawSales };
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
        if (d.salesData) setRawSales(d.salesData.map(r => ({ ...r, source: r.source === "cash" ? "cash" : "square" })));
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
      if (!weekId) { console.warn("No weekId for week:", wk, "weekMap:", weekMap); return; }

      if (shift === null) {
        await dbDelete("shifts?week_id=eq." + weekId + "&employee_id=eq." + eid + "&day_index=eq." + di);
      } else {
        await sbFetch("shifts?on_conflict=week_id,employee_id,day_index", {
          method:"POST",
          body:JSON.stringify([{
            business_id:  bizId,
            week_id:      weekId,
            employee_id:  eid,
            day_index:    di,
            start_dec:    shift.start,
            end_dec:      shift.end,
            shift_types:  Array.isArray(shift.type) ? shift.type : [shift.type || "regular"],
            notes:        shift.notes || "",
          }]),
          headers:{"Prefer":"resolution=merge-duplicates,return=minimal"}
        });
      }
    } catch(e) { console.warn("Shift save failed:", e); showError(friendlyError(e, "Couldn't save that shift — try again.")); }
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

  // Global punch lookup map — O(1) getDayPunches access
  const punchMap = useMemo(() => {
    const map = {};
    for (const p of punches) {
      const pd = toLocalDateStr(new Date(p.time));
      const key = `${p.empId}|${pd}`;
      if (!map[key]) map[key] = [];
      map[key].push(p);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a,b) => new Date(a.time)-new Date(b.time));
    }
    return map;
  }, [punches]);

  function getDayPunches(empId, dateStr) {
    return punchMap[`${empId}|${dateStr}`] || [];
  }

  const tsWkDates = useMemo(() => Array.from({length:7},(_,i)=>{
    const d = new Date(tsWeekStart+"T12:00:00");
    d.setUTCDate(d.getUTCDate()+i);
    return toLocalDateStr(d);
  }), [tsWeekStart]);

  const tsWkLabel = useMemo(() => {
    const d0 = new Date(tsWeekStart+"T12:00:00");
    const d6 = new Date(tsWeekStart+"T12:00:00"); d6.setUTCDate(d6.getUTCDate()+6);
    return `${dl(d0)} – ${dl(d6)}`;
  }, [tsWeekStart]);

  const tsSchedKey = useMemo(() => Object.keys(schedule).find(wk => {
    const sun = new Date(wk+"T00:00:00");
    const dates = Array.from({length:7},(_,i)=>{ const d=new Date(sun.getTime()+i*24*60*60*1000); return toLocalDateStr(d); });
    return dates[0] === tsWeekStart;
  }) || null, [schedule, tsWeekStart]);

  const pendingFlags = useMemo(() => punches.filter(p =>
    p.flags?.length > 0 &&
    tsWkDates.includes(toLocalDateStr(new Date(p.time))) &&
    !punchReviews[p.id]
  ).length, [punches, tsWkDates, punchReviews]);

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
      const appEmp = { id:newEmp.id, name:"", role:"", hourlyRate:"", color, pin:"", availableDays:[0,1,2,3,4,5,6], availableHours:"40", notes:"", phone:"" };
      setEmployees(p=>[...p, appEmp]);
      setEditEmpId(newEmp.id);
      addAudit("Employee Added", "New employee created — name pending");
    } catch(e) { showError(friendlyError(e, "Couldn't add that employee — try again.")); }
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
    if (f.phone          !== undefined) dbFields.phone           = f.phone;
    if (Object.keys(dbFields).length > 0) {
      dbPatch(`employees?id=eq.${id}`, dbFields).catch(e => { console.warn("Employee update failed:", e); showError(friendlyError(e, "Couldn't save that employee change — try again.")); });
    }
  };

  async function rmEmp(id) {
    const emp = employees.find(e=>e.id===id);
    addAudit("Employee Removed", emp?.name || "Unknown employee", {empName:emp?.name});
    setEmployees(p=>p.filter(e=>e.id!==id));
    setSchedule(p=>{ const n=JSON.parse(JSON.stringify(p)); Object.keys(n).forEach(wk=>delete n[wk][id]); return n; });
    if(editEmpId===id) setEditEmpId(null);
    // Supabase: cascades to shifts automatically via foreign key
    dbDelete(`employees?id=eq.${id}`).catch(e => { console.warn("Employee delete failed:", e); showError(friendlyError(e, "Couldn't delete that employee — try again.")); });
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
        // Only flag LATE if more than 10 minutes late — minor variance is noise
        const minsLate = (nowDec - shift.start) * 60;
        if (minsLate > 5) flags.push("LATE");
        var message = flags.includes("LATE")
          ? `Clocked in ${Math.round(minsLate)} min late. Shift started at ${fmt(shift.start)}.`
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
    if (bizId) {
      dbPost("templates", { business_id: bizId, name: tpl.name, schedule_data: tpl.scheduleData, employee_snapshot: tpl.employeeSnapshot })
        .then(rows => { const id = rows?.[0]?.id; if (id) setTemplates(p => p.map(t => t.id === tpl.id ? { ...t, id } : t)); })
        .catch(e => showError(friendlyError(e, "That template didn't save — it may disappear on refresh.")));
    }
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
        .catch(e => { console.warn("Publish write failed:", e); showError(friendlyError(e, "The schedule didn't actually save to the server — try publishing again.")); });
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
      <div onClick={()=>setOpenCell(null)} className="time-picker-overlay" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
        <style>{`
          @media (pointer: fine) {
            .time-picker-overlay { align-items: center !important; padding: 20px; box-sizing: border-box; }
            .time-picker-sheet { border-radius: 20px !important; box-shadow: 0 24px 64px rgba(0,0,0,0.28) !important; max-height: 85vh; overflow-y: auto; }
            .time-picker-grabber { display: none !important; }
          }
        `}</style>
        <div onClick={e=>e.stopPropagation()} className="time-picker-sheet" style={{background:"white",borderRadius:"20px 20px 0 0",padding:"20px 20px calc(20px + env(safe-area-inset-bottom,0px))",width:"100%",maxWidth:500,boxShadow:"0 -12px 48px rgba(0,0,0,0.2)",borderTop:`4px solid ${emp.color}`}}>
          <div className="time-picker-grabber" style={{width:36,height:4,borderRadius:2,background:"#E0DAD2",margin:"0 auto 16px"}}/>
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
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:11,marginBottom:14,position:"relative"}}>
            {[["Start Time","start"],["End Time","end"]].map(([lbl,field])=>{
              const val = draft[field];
              const getHr  = v => { if(!v) return ""; const [h]=v.split(":").map(Number); const r=h%12===0?12:h%12; return String(r); };
              const getMin = v => { if(!v) return ""; const [,m]=v.split(":").map(Number); return String(m).padStart(2,"0"); };
              const getAp  = (v,fb) => { if(!v) return fb; const [h]=v.split(":").map(Number); return h<12?"AM":"PM"; };
              const build  = (hr,min,ap) => { let h=parseInt(hr||0)%12; if(ap==="PM") h+=12; return String(h).padStart(2,"0")+":"+String(min).padStart(2,"0"); };
              const fallbackAP = field==="start"?"AM":"PM";
              const ap = getAp(val,fallbackAP);
              const filled = !!val;
              return (
                <div key={field}>
                  <label style={{fontSize:11,fontWeight:700,color:T.sub,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em"}}>{lbl}</label>
                  <div style={{display:"flex",alignItems:"center",border:`2px solid ${filled?emp.color:T.border}`,borderRadius:999,background:T.surface,padding:"4px 6px"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"center",flex:1}}>
                      <input
                        id={`tp-hr-${field}`}
                        inputMode="numeric"
                        placeholder="9"
                        defaultValue={getHr(val)}
                        key={`hr-${field}`}
                        onFocus={e=>e.target.select()}
                        onChange={e=>{
                          const v=e.target.value.replace(/[^0-9]/g,"").slice(0,2);
                          e.target.value=v;
                          if(!v) return;
                          let n=parseInt(v); if(n>12) n=12;
                          const curMin=parseInt(getMin(draft[field])||"0");
                          const curAp=getAp(draft[field],fallbackAP);
                          setDraft(d=>({...d,[field]:build(n,curMin,curAp)}));
                        }}
                        onKeyDown={e=>{
                          if(e.key==="Enter"||(e.key==="Tab"&&!e.shiftKey)){e.preventDefault();document.getElementById(`tp-min-${field}`)?.focus();}
                        }}
                        style={{width:28,border:"none",outline:"none",fontSize:17,fontWeight:800,color:T.text,background:"transparent",textAlign:"center",padding:"9px 0"}}
                      />
                      <span style={{fontSize:17,fontWeight:800,color:T.sub}}>:</span>
                      <input
                        id={`tp-min-${field}`}
                        inputMode="numeric"
                        placeholder="00"
                        defaultValue={getMin(val)}
                        key={`min-${field}`}
                        onFocus={e=>e.target.select()}
                        onBlur={e=>{
                          const v=e.target.value.replace(/[^0-9]/g,"");
                          if(!v) return;
                          let n=parseInt(v); if(n>59) n=59;
                          e.target.value=String(n).padStart(2,"0");
                          const curHr=parseInt(getHr(draft[field])||"9");
                          const curAp=getAp(draft[field],fallbackAP);
                          setDraft(d=>({...d,[field]:build(curHr,n,curAp)}));
                        }}
                        onKeyDown={e=>{
                          if(e.key==="Enter"){e.preventDefault();e.target.blur();}
                        }}
                        style={{width:34,border:"none",outline:"none",fontSize:17,fontWeight:800,color:T.text,background:"transparent",textAlign:"center",padding:"9px 0"}}
                      />
                    </div>
                    <button type="button"
                      onClick={e=>{
                        e.stopPropagation();
                        const curHr=parseInt(getHr(draft[field])||"9");
                        const curMin=parseInt(getMin(draft[field])||"0");
                        setDraft(d=>({...d,[field]:build(curHr,curMin,ap==="AM"?"PM":"AM")}));
                      }}
                      style={{border:"none",borderRadius:999,background:ap?emp.color:T.muted,color:ap?"white":T.sub,fontSize:12,fontWeight:800,padding:"9px 14px",cursor:"pointer",letterSpacing:"0.03em"}}>
                      {ap||fallbackAP}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {draft.start&&draft.end&&!canSave&&(
            <div style={{background:"#FEF3E2",border:"1px solid #F39C12",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:"#E67E22",fontWeight:600}}>End time must be after start time</div>
          )}
          <div style={{background:T.muted,borderRadius:10,padding:"10px 14px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center",opacity:canSave?1:0,pointerEvents:canSave?"auto":"none",transition:"opacity 0.15s"}}>
              <div><div style={{fontSize:10,color:T.sub,marginBottom:2,textTransform:"uppercase",letterSpacing:"0.05em"}}>Hours</div>
                <div style={{fontWeight:800,fontSize:30,color:emp.color,lineHeight:1}}>{h}h</div></div>
              <div style={{textAlign:"right"}}><div style={{fontSize:10,color:T.sub,marginBottom:2,textTransform:"uppercase",letterSpacing:"0.05em"}}>Est. Pay</div>
                <div style={{fontWeight:800,fontSize:22,color:T.text}}>${pay.toFixed(2)}</div></div>
            </div>
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
          <div className="sw-apply-days" style={{padding:"10px 12px",background:T.muted,borderRadius:10,border:`1px solid ${T.border}`,marginBottom:16}}>
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

  timePickerImpl.current = TimePickerModal;

  const TABS = [
    {key:"grid",        icon:"📋", label:"Schedule"},
    {key:"coverage",    icon:"🚨", label:"Coverage"},
    {key:"insights",    icon:"🧠", label:"Insights"},
    {key:"dashboard",   icon:"💵", label:"Dashboard"},
    {key:"settings",    icon:"⚙️", label:"Settings"},
    ...(isDemoBiz ? [] : [{key:"feedback", icon:"💬", label:"Feedback"}]),
  ];

  // ── AUTH SCREENS: shared look (UI refresh — login) ─────────────────────────
  // Login follows the app theme saved on this device (sw_theme), same as the rest of the app.
  const authLabel  = {display:"block",fontSize:14,fontWeight:600,color:T.text,marginBottom:8};
  const authErrBox = {background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.35)",borderRadius:10,padding:"10px 14px",fontSize:13,color:"#DC2626",lineHeight:1.5};
  const authOkBox  = {background:"rgba(16,185,129,0.12)",border:"1px solid rgba(16,185,129,0.35)",borderRadius:10,padding:"12px 14px",fontSize:13,color:T.text,lineHeight:1.6};
  const authLink   = {background:"none",border:"none",color:T.accent,fontSize:13,fontWeight:600,cursor:"pointer",padding:0,fontFamily:"inherit"};
  const authBtn    = (enabled) => ({width:"100%",background:T.accent,opacity:enabled?1:0.45,color:"white",border:"none",borderRadius:10,padding:"14px 0",fontWeight:700,fontSize:15,cursor:enabled?"pointer":"not-allowed",transition:"background 0.15s",fontFamily:"inherit"});
  const AuthIcon = {
    mail: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>,
    lock: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>,
    store:<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10v10h16V10"/><path d="M3 10 5 4h14l2 6"/><path d="M10 20v-5h4v5"/></svg>,
    eye:  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>,
    eyeOff:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>,
  };
  const authField = ({id, label, icon, value, onChange, placeholder, type="text", name, autoComplete, toggle}) => (
    <div>
      <label htmlFor={id} style={authLabel}>{label}</label>
      <div style={{position:"relative"}}>
        <span style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",color:T.sub,display:"flex",pointerEvents:"none"}}>{icon}</span>
        <input id={id} className="sw-auth-input" value={value} onChange={onChange} placeholder={placeholder}
          type={type} name={name} autoComplete={autoComplete}
          style={{width:"100%",background:T.muted,border:`1px solid ${T.border}`,borderRadius:10,padding:toggle?"14px 46px 14px 44px":"14px 14px 14px 44px",fontSize:15,color:T.text,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
        {toggle && (
          <button type="button" onClick={()=>setShowPass(s=>!s)} aria-label={showPass?"Hide password":"Show password"}
            style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:T.sub,cursor:"pointer",padding:4,display:"flex"}}>
            {showPass ? AuthIcon.eyeOff : AuthIcon.eye}
          </button>
        )}
      </div>
    </div>
  );
  const authToday = new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"});
  const authShell = (content) => (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:"'Inter',system-ui,sans-serif"}}>
      <style>{CSS}</style>
      <style>{`.sw-auth-input::placeholder{color:${T.sub};opacity:.8}.sw-auth-input:focus{background:${T.surface} !important;border-color:${T.accent} !important;box-shadow:0 0 0 3px ${T.accent}26}`}</style>
      <div style={{width:"100%",maxWidth:420}}>
        {/* Logo — original ShiftWise | Veredian lockup */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{width:56,height:56,background:T.accent,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,margin:"0 auto 16px"}}>📅</div>
          <div style={{fontSize:26,fontWeight:900,color:T.text,letterSpacing:"-0.01em",display:"inline-flex",alignItems:"center",gap:0}}>
            ShiftWise
            <span style={{color:T.sub,margin:"0 7px",fontWeight:300}}>|</span>
            Veredian
            <span style={{fontSize:11,fontWeight:400,color:T.accent,position:"relative",bottom:"9px",marginLeft:3,letterSpacing:"0.06em"}}>Beta</span>
          </div>
          <div style={{fontSize:13,color:T.sub,marginTop:4}}>Schedule smarter. Run better.</div>
          <div style={{fontSize:12,color:T.sub,marginTop:6,opacity:0.8}}>{authToday}</div>
        </div>

        {/* Card */}
        <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:18,padding:"28px 28px 24px",boxShadow:T.shadowMd}}>
          {content}
        </div>

        <div style={{textAlign:"center",marginTop:20,fontSize:11,color:T.sub,lineHeight:1.6}}>
          Your data is stored securely in Supabase.<br/>
          Schedule, payroll, and team data sync across all your devices.
        </div>
      </div>
    </div>
  );
  const authHeading = (title, sub) => (
    <div style={{marginBottom:22}}>
      <div style={{fontSize:18,fontWeight:700,color:T.text,marginBottom:6}}>{title}</div>
      <div style={{fontSize:14,color:T.sub,lineHeight:1.5}}>{sub}</div>
    </div>
  );

  // ── SET NEW PASSWORD (arrived from reset email) ──────────────────────────
  if (authState === "recovery") {
    const canSave = newPass.length > 0 && newPass2.length > 0;
    return authShell(
      <>
        {authHeading("Set a new password", "Choose a new password for your ShiftWise account.")}
        <form onSubmit={handleSetNewPassword} style={{display:"flex",flexDirection:"column",gap:16}}>
          {authField({id:"sw-new-pass", label:"New password", icon:AuthIcon.lock, value:newPass, onChange:e=>setNewPass(e.target.value),
            placeholder:"At least 6 characters", type:showPass?"text":"password", name:"new-password", autoComplete:"new-password", toggle:true})}
          {authField({id:"sw-new-pass2", label:"Confirm new password", icon:AuthIcon.lock, value:newPass2, onChange:e=>setNewPass2(e.target.value),
            placeholder:"Re-enter your new password", type:showPass?"text":"password", name:"confirm-password", autoComplete:"new-password"})}
          {authError && <div style={authErrBox}>{authError}</div>}
          <button type="submit" disabled={!canSave} style={{...authBtn(canSave),marginTop:4}}>Save New Password</button>
        </form>
        <div style={{textAlign:"center",marginTop:16}}>
          <button type="button" onClick={()=>{ setAuthError(""); setAuthMode("forgot"); setResetSent(false); setAuthState("unauthenticated"); }} style={authLink}>
            Request a new reset link
          </button>
        </div>
      </>
    );
  }

  // ── LOGIN SCREEN ───────────────────────────────────────────────────────────
  if (authState === "unauthenticated") {
    const isSignup = authMode === "signup";
    const canSubmit = !authBusy && authEmail.trim() && authPass && (!isSignup || authBizName.trim());
    const submitAuth = async (e) => {
      e.preventDefault();
      if (!canSubmit) return;
      setAuthBusy(true);
      try { isSignup ? await handleSignUp(e) : await handleSignIn(e); }
      finally { setAuthBusy(false); }
    };

    if (authMode === "forgot") {
      return authShell(
        <>
          {authHeading("Reset your password", "Enter the email on your account and we'll send you a link to set a new password.")}
          {resetSent ? (
            <div style={authOkBox}>
              ✓ If an account exists for <strong>{authEmail}</strong>, a reset link is on its way. Check your inbox (and spam folder).
            </div>
          ) : (
            <form onSubmit={e=>{ e.preventDefault(); handleForgotPassword(); }} style={{display:"flex",flexDirection:"column",gap:16}}>
              {authField({id:"sw-reset-email", label:"Email", icon:AuthIcon.mail, value:authEmail, onChange:e=>setAuthEmail(e.target.value),
                placeholder:"you@yourbusiness.com", type:"email", name:"email", autoComplete:"username"})}
              {authError && <div style={authErrBox}>{authError}</div>}
              <button type="submit" disabled={!authEmail.trim()} style={{...authBtn(!!authEmail.trim()),marginTop:4}}>Send Reset Link</button>
            </form>
          )}
          <div style={{textAlign:"center",marginTop:16}}>
            <button type="button" onClick={()=>{setAuthMode("signin");setAuthError("");setResetSent(false);}} style={authLink}>
              ← Back to sign in
            </button>
          </div>
        </>
      );
    }

    return authShell(
      <>
        {isSignup
          ? authHeading("Create your account", "Set up ShiftWise for your business. Takes about 5 minutes.")
          : authHeading("Sign in", "Enter your email and password to continue.")}

        <form onSubmit={submitAuth} style={{display:"flex",flexDirection:"column",gap:16}}>
          {isSignup && authField({id:"sw-auth-biz", label:"Business name", icon:AuthIcon.store, value:authBizName, onChange:e=>setAuthBizName(e.target.value),
            placeholder:"e.g. Sneaux Ball Cafe", name:"organization", autoComplete:"organization"})}
          {authField({id:"sw-auth-email", label:"Email", icon:AuthIcon.mail, value:authEmail, onChange:e=>setAuthEmail(e.target.value),
            placeholder:"you@yourbusiness.com", type:"email", name:"email", autoComplete:"username"})}
          <div>
            {authField({id:"sw-auth-pass", label:"Password", icon:AuthIcon.lock, value:authPass, onChange:e=>setAuthPass(e.target.value),
              placeholder:isSignup?"At least 6 characters":"Enter your password", type:showPass?"text":"password", name:"password",
              autoComplete:isSignup?"new-password":"current-password", toggle:true})}
            {!isSignup && (
              <div style={{textAlign:"right",marginTop:8}}>
                <button type="button" onClick={()=>{setAuthMode("forgot");setAuthError("");setResetSent(false);}} style={{...authLink,fontSize:12}}>
                  Forgot password?
                </button>
              </div>
            )}
          </div>

          {authError && <div style={authErrBox}>{authError}</div>}

          <button type="submit" disabled={!canSubmit} style={{...authBtn(!!canSubmit),marginTop:4}}>
            {authBusy ? (isSignup ? "Creating account…" : "Signing in…") : (isSignup ? "Create Account" : "Sign In")}
          </button>
        </form>

        <div style={{textAlign:"center",marginTop:16,fontSize:13,color:T.sub}}>
          {isSignup ? "Already have an account? " : "New to ShiftWise? "}
          <button type="button" onClick={()=>{setAuthMode(isSignup?"signin":"signup");setAuthError("");}} style={authLink}>
            {isSignup ? "Sign in" : "Create an account"}
          </button>
        </div>

        {!isSignup && (
          <>
            <div style={{height:1,background:T.border,margin:"22px 0 18px"}}/>
            <div style={{textAlign:"center",fontSize:13,color:T.sub,marginBottom:12}}>Just looking? Explore a sample business.</div>
            <button type="button" onClick={()=>{ setAuthError(""); setAuthEmail(DEMO_EMAIL); setAuthPass(""); setTimeout(()=>document.getElementById("sw-auth-pass")?.focus(), 0); }}
              style={{width:"100%",background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 0",fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>
              Try the Cedar & Sage demo
            </button>

          </>
        )}

      </>
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
        onComplete={async (seeded) => {
          try { localStorage.removeItem("sw_setup_step"); } catch {}
          await loadAllData();
          setSetupComplete(true);
          if (seeded) showToast("We added an example week to your schedule — feel free to edit or clear it ✓", 6000);
        }}
      />
    );
  }

  return (
    <div style={{minHeight:"100vh",width:"100%",background:T.bg,color:T.text}}>
      <style>{CSS}</style>

        {/* TOP BAR */}
        <div style={{background:T.dark,position:"sticky",top:0,zIndex:400,borderBottom:"1px solid #2A2A2A"}}>
          <div className="top-bar-inner" style={{width:"100%",display:"flex",alignItems:"center",gap:14,height:70,padding:"0 24px"}}>
            {/* UI Batch 14 — larger logo, name, and tabs (70px bar, 14.5px tabs) */}
            <div style={{display:"flex",alignItems:"center",gap:11,flexShrink:0}}>
              <div style={{width:40,height:40,background:T.accent,borderRadius:11,display:"flex",alignItems:"center",justifyContent:"center",fontSize:21,flexShrink:0}}>📅</div>
              <input className="biz-input" value={biz} onChange={e=>setBiz(e.target.value)} aria-label="Business name"
                style={{background:"transparent",border:"none",color:"white",fontSize:19,fontWeight:700,outline:"none",width:210}}
                onBlur={saveBizNameIfChanged}/>
            </div>
            <div className="top-bar-tabs" style={{display:"flex",gap:12,flex:1,overflow:"hidden",minWidth:0,paddingLeft:8}}>
              {TABS.map(t=>(
                <button key={t.key} onClick={()=>setTab(t.key)} className="nav-tab-btn" style={{
                  background:tab===t.key?T.accent:"transparent",
                  color:tab===t.key?"white":"#888",
                  border:"none",borderRadius:10,padding:"10px 16px",
                  cursor:"pointer",fontWeight:600,fontSize:14.5,whiteSpace:"nowrap",transition:"all 0.15s"
                }}>{t.icon} {t.label}</button>
              ))}
            </div>
            <div className="top-stats" style={{display:"flex",alignItems:"center",gap:8,flexShrink:0,minWidth:0}}>

              {/* 🔔 Alert Bell */}
{(()=>{
  const ACTIONABLE_FLAGS = ["NO_SHIFT","ADJUSTMENT"];
  // Demo-aware "now" — otherwise the 30-day lookback compares against the
  // real live date, and Cedar & Sage's seeded flags (April-June 2026) fall
  // outside that window entirely, so the badge never shows anything.
  const bellNow = isDemoBiz ? new Date(DEMO_TODAY_ANCHOR+"T12:00:00") : new Date();
  const thirtyDaysAgoBell = new Date(bellNow - 30*24*60*60*1000);
  const unreviewed = punches.filter(p =>
    p.flags?.some(f=>ACTIONABLE_FLAGS.includes(f)) &&
    !punchReviews[p.id] &&
    new Date(p.time) > thirtyDaysAgoBell &&
    employees.some(e=>e.id===p.empId) &&
    p.flags?.includes("NO_SHIFT") // only NO_SHIFT needs bell alert — ADJUSTMENT is auto-approved now
  ).length;
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
        <div className="page-pad" style={{width:"100%",padding:"14px 20px 20px"}}>

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
        const token = (()=>{try{const s=JSON.parse(localStorage.getItem("sw_session")||"null");return s?.access_token||"";}catch{return "";}})();
        setPunches(prev => prev.filter(px => px.id !== p.id));
        setPunchReviews(prev => { const n={...prev}; delete n[p.id]; return n; });
        if (bizId) {
          // Archive the full punch record before deleting it
          await fetch(`${SUPABASE_URL}/rest/v1/deleted_punches`, {
            method:"POST",
            headers:{ apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${getToken()}`, "Content-Type":"application/json", Prefer:"return=minimal" },
            body: JSON.stringify({
              business_id: bizId,
              original_punch_id: p.id,
              employee_id: emp.id,
              employee_name: emp.name,
              punch_type: p.type,
              punched_at: p.time,
              flags: p.flags || [],
              adjustment_reason: p.adjustmentReason || null,
              delete_reason: reasonText,
              deleted_by: (()=>{try{const s=JSON.parse(localStorage.getItem("sw_session")||"null");return s?.user?.id||null;}catch{return null;}})(),
            })
          }).catch(e=>console.warn("Archive punch failed:", e));

          await fetch(`${SUPABASE_URL}/rest/v1/punches?id=eq.${p.id}`, {
            method:"DELETE",
            headers:{ apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${getToken()}` }
          });
        }
        addAudit("Punch Deleted", `${emp.name} — ${dateStr}: ${typeLabel} at ${new Date(p.time).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})} removed (${reasonText})`, {empName:emp.name});
        showToast("Punch deleted — archived for records ✓");
      } catch(e) { showError(friendlyError(e, "Couldn't delete that punch — try again.")); }
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


  punchRowImpl.current = PunchRowInline;
  tsCellPopupImpl.current = TimesheetCellPopup;

  function getTsShift(empId, di) {
    return tsSchedKey ? (schedule?.[tsSchedKey]?.[empId]?.[di] || null) : null;
  }




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
    if (bizId) {
      dbPost("timesheet_locks", {
        business_id: bizId, week_start: snapshot.weekStart, label: snapshot.label, snapshot,
        total_hours: snapshot.totalApprovedHrs, total_pay: snapshot.totalApprovedPay,
      })
        .then(rows => { const id = rows?.[0]?.id; if (id) setTimesheetHistory(p => p.map(s => s.id === snapshot.id ? { ...s, id } : s)); })
        .catch(e => showError(friendlyError(e, "That locked timesheet didn't save — export the CSV to be safe.")));
    }
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

    // Always start blank — the punch log above already shows existing times.
    // The adjust form is for entering corrections, not editing existing values.
    useEffect(()=>{
      if (!tsOpenCell) return;
      setEditIn("");
      setEditOut("");
      setReasonCode("missed_punch");
      setReasonNote("");
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
    const flags   = dp.flatMap(p=>p.flags||[]).filter((v,i,a)=>a.indexOf(v)===i&&["NO_SHIFT","ADJUSTMENT","LATE","EARLY_OUT"].includes(v));
    const punchId = dp[0]?.id;
    const status  = punchId ? (punchReviews[punchId]||"pending") : null;

    const FLAG_LABELS  = {NO_SHIFT:"No Shift",LATE:"Late Clock-In",EARLY_OUT:"Left Early",ADJUSTMENT:"Manual Entry"};
    const FLAG_COLORS  = {NO_SHIFT:"#C0392B",LATE:"#E8A93A",EARLY_OUT:"#E07020",ADJUSTMENT:"#3A9BE8"};
    const FLAG_ICONS   = {NO_SHIFT:"🔴",LATE:"🟡",EARLY_OUT:"🟠",ADJUSTMENT:"🔵"};
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
          }).catch(e=>{ console.warn("punch_reviews upsert failed:", e); showError(friendlyError(e, "Couldn't save that review status — try again.")); });
        }
      });
      setTsOpenCell(null);
      showToast(`Marked as ${val} ✓`);
    }

    async function saveManualTime() {
      if (!editIn && !editOut) { showToast("Enter at least a clock-in or clock-out time"); return; }
      if (reasonCode==="other" && !reasonNote.trim()) { showToast("Enter a reason for this adjustment"); return; }
      setSaving(true);
      try {
        const reasonLabel = ADJUSTMENT_REASONS.find(r=>r.value===reasonCode)?.label || "Manual adjustment";
        const reasonText  = reasonCode==="other" ? reasonNote.trim() : reasonLabel;

        // Build a real ISO timestamp WITH the local timezone offset, so the
        // moment stored in Supabase and the moment reconstructed by `new Date()`
        // on read-back are identical — no naive-timestamp ambiguity.
        // Always use Central Time offset for manual punch timestamps
        const getCSTOffset = (ds, timeStr) => {
          // Use Intl to determine the correct CST/CDT offset for this datetime
          const testDate = new Date(`${ds}T${timeStr}:00`);
          const cstStr = testDate.toLocaleString("en-US", {timeZone:"America/Chicago",hour12:false,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
          const utcMs = testDate.getTime();
          // Get CST time parts
          const parts = new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(testDate);
          const p = {}; parts.forEach(({type,value})=>{ p[type]=value; });
          const cstMs = new Date(`${p.year}-${p.month}-${p.day}T${p.hour === "24" ? "00" : p.hour}:${p.minute}:00`).getTime();
          const offMins = Math.round((utcMs - cstMs) / 60000);
          const sign = offMins >= 0 ? "-" : "+"; // UTC-5 means offset is -300 mins
          const abs = Math.abs(offMins);
          const pad = n => String(n).padStart(2,"0");
          return `${sign}${pad(Math.floor(abs/60))}:${pad(abs%60)}`;
        };
        const makeISO = (ds, timeStr, dayOffset=0) => {
          const [h,m] = timeStr.split(":").map(Number);
          // Build date using CST interpretation
          const d = new Date(ds+"T12:00:00");
          if (dayOffset) d.setDate(d.getDate()+dayOffset);
          const pad = n => String(n).padStart(2,"0");
          const dateStr2 = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
          const timeStr2 = `${pad(h)}:${pad(m)}`;
          // punched_at is `timestamp without time zone` — it stores exactly what we
          // send, no conversion. Appending an offset here would make Postgres resolve
          // it to an absolute instant first and store THAT as the naive value,
          // silently shifting the wall-clock time (this was the bug: manual edits
          // were landing ~5 hours later than what was actually typed).
          return `${dateStr2}T${timeStr2}:00`;
        };
        // If clock-out time is earlier than clock-in time, it's an overnight shift —
        // the clock-out lands on the following calendar day.
        const inMins  = editIn ? (()=>{const [h,m]=editIn.split(":").map(Number); return h*60+m;})() : null;
        const outMins = editOut ? (()=>{const [h,m]=editOut.split(":").map(Number); return h*60+m;})() : null;
        const isOvernight = inMins!=null && outMins!=null && outMins < inMins;

        const inTime  = editIn ? makeISO(dateStr, editIn) : null;
        const outTime = editOut ? makeISO(dateStr, editOut, isOvernight ? 1 : 0) : null;

        // Day window for delete queries — also needs explicit timezone offset
        const dayStart = makeISO(dateStr, "00:00");
        const dayEnd   = makeISO(dateStr, "23:59");

        const insertPunch = async (type, time) => {
          const punch = { id:(Date.now()+Math.random()).toString(), empId, empName:emp.name, type, time, scheduled:shift||null, flags:["ADJUSTMENT"], adjustmentReason:reasonText };
          setPunches(p=>[...p, punch]);
          let savedId = punch.id;
          if (bizId) {
            const saved = await dbPost("punches", { business_id:bizId, employee_id:empId, employee_name:emp.name, punch_type:type, punched_at:time, scheduled_start:shift?.start||null, scheduled_end:shift?.end||null, flags:["ADJUSTMENT"], adjustment_reason:reasonText });
            if (saved?.[0]?.id) savedId = saved[0].id;
          }
          return savedId;
        };

        const autoApprove = async (punchId) => {
          setPunchReviews(prev=>({...prev,[punchId]:"approved"}));
          if (bizId) {
            await fetch(`${SUPABASE_URL}/rest/v1/punch_reviews?on_conflict=punch_id`, {
              method:"POST",
              headers:{...SB_HEADERS, Authorization:`Bearer ${getToken()}`, Prefer:"resolution=merge-duplicates,return=minimal"},
              body:JSON.stringify({business_id:bizId, punch_id:punchId, status:"approved", reviewed_by:getSession()?.user?.id||null})
            }).catch(e=>console.warn("auto-approve failed:", e));
          }
        };

        // Just insert — never auto-delete existing punches
        // Managers handle duplicates manually via per-row delete with reason
        if (editIn) {
          const inId = await insertPunch("in", inTime);
          await autoApprove(inId);
        }
        if (editOut) {
          const outId = await insertPunch("out", outTime);
          await autoApprove(outId);
        }

        addAudit("Manual Time Entry", `${emp.name} — ${dateStr}: ${editIn||""}${editOut?" – "+editOut:""} (${reasonText}) — auto-approved`, {empName:emp.name});
        showToast("Time adjustment saved & approved ✓");
        setEditIn(""); setEditOut(""); setReasonCode("missed_punch"); setReasonNote("");
      } catch(e) { showError(friendlyError(e, "Couldn't save that time entry — try again.")); }
      finally { setSaving(false); }
    }

    return (
      <div onClick={()=>setTsOpenCell(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <div onClick={e=>e.stopPropagation()} style={{background:"white",borderRadius:20,width:"100%",maxWidth:420,boxShadow:"0 20px 60px rgba(0,0,0,0.3)",overflow:"hidden",maxHeight:"90vh",overflowY:"auto"}}>

          {/* Header */}
          <div style={{background:emp.color,padding:"13px 17px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,0.25)",display:"flex",alignItems:"center",justifyContent:"center",color:"white",fontWeight:800,fontSize:15}}>{emp.name?.[0]?.toUpperCase()||"?"}</div>
              <div>
                <div style={{color:"white",fontWeight:800,fontSize:15}}>{emp.name}</div>
                <div style={{color:"rgba(255,255,255,0.75)",fontSize:11}}>{new Date(dateStr+"T00:00:00").toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}</div>
              </div>
            </div>
            <button onClick={()=>setTsOpenCell(null)} style={{background:"rgba(255,255,255,0.2)",border:"none",borderRadius:"50%",width:30,height:30,color:"white",fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
          </div>

          <div style={{padding:"13px 16px",display:"flex",flexDirection:"column",gap:12}}>

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
                    <span key={i} style={{background:(FLAG_COLORS[f]||"#E8A93A")+"22",color:FLAG_COLORS[f]||"#E8A93A",border:`1px solid ${(FLAG_COLORS[f]||"#E8A93A")}44`,borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700}}>
                      {FLAG_ICONS[f]||""} {FLAG_LABELS[f]||f}
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
                    <PunchRowShell key={p.id||i} p={p} i={i} total={dp.length}
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
            <div style={{border:`1.5px solid ${T.border}`,borderRadius:10,padding:"10px 12px"}}>
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

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:6}}>
                {[["Clock in",editIn,setEditIn],["Clock out",editOut,setEditOut]].map(([lbl,val,setter])=>(
                  <div key={lbl}>
                    <label style={{fontSize:10,color:T.sub,display:"block",marginBottom:4,fontWeight:600}}>{lbl}</label>
                    <input type="time" value={val} onChange={e=>setter(e.target.value)}
                      style={{width:"100%",border:`1.5px solid ${T.border}`,borderRadius:8,padding:"8px 10px",fontSize:13,fontWeight:700,outline:"none",background:T.surface,color:T.text}}/>
                  </div>
                ))}
              </div>
              {(()=>{
                if (!editIn || !editOut) return null;
                const [ih,im]=editIn.split(":").map(Number), [oh,om]=editOut.split(":").map(Number);
                const overnight = (oh*60+om) < (ih*60+im);
                return overnight ? (
                  <div style={{background:"#FEF3E2",border:"1px solid #E8A93A40",borderRadius:7,padding:"6px 10px",fontSize:11,color:"#B7780F",marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
                    <span>🌙</span> Overnight shift detected — clock-out will be saved on the following day
                  </div>
                ) : null;
              })()}
              <button onClick={saveManualTime} disabled={saving||(!editIn&&!editOut)}
                style={{width:"100%",background:(editIn||editOut)?T.dark:T.muted,color:(editIn||editOut)?"white":T.sub,border:"none",borderRadius:8,padding:"10px 0",fontWeight:700,fontSize:13,cursor:(editIn||editOut)?"pointer":"not-allowed"}}>
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
                const hasFlags = dp.some(p=>p.flags?.some(f=>["NO_SHIFT","ADJUSTMENT","LATE","EARLY_OUT"].includes(f)));
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
                showToast(`${Object.keys(updates).length} punch${Object.keys(updates).length===1?"":"es"} approved ✓`);
              } catch(e) { console.warn("Approve all failed:", e); showError(friendlyError(e, "Some punches may not have been approved — refresh to check.")); }
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
      <div className="sw-datebar" style={{display:"inline-flex",alignItems:"center",gap:6,marginBottom:14,flexWrap:"wrap",background:T.muted,border:`1px solid ${T.border}`,borderRadius:12,padding:4,boxShadow:"inset 0 1px 0 rgba(255,255,255,0.6)"}}>
        <button onClick={()=>setTsWeekStart(getSunday(addDays(tsWeekStart,-7)))}
          style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,width:34,height:36,fontSize:16,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,flexShrink:0}}>‹</button>
        <div style={{display:"flex",alignItems:"center",borderRadius:9,overflow:"hidden",border:`2px solid ${T.accent}`,boxShadow:`0 0 0 2px ${T.accent}28`}}>
          <div style={{background:T.accent,color:"white",padding:"8px 16px",fontWeight:700,fontSize:12,whiteSpace:"nowrap",display:"flex",alignItems:"center",justifyContent:"center",gap:6,minWidth:170,boxSizing:"border-box",fontVariantNumeric:"tabular-nums"}}>
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
          style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,width:34,height:36,fontSize:16,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,flexShrink:0}}>›</button>
        {(()=>{ const atToday = tsWeekStart === getSunday(demoToday); return (
          <button onClick={()=>setTsWeekStart(getSunday(demoToday))} disabled={atToday} aria-disabled={atToday} title={atToday ? "Already on this week" : "Jump to this week"}
                          style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"0 14px",height:36,fontSize:12,fontWeight:700,color:T.accent,cursor:atToday?"default":"pointer",opacity:atToday?0.45:1,flexShrink:0}}>Today</button>
        ); })()}
      </div>

      {/* Grid */}
      <div className="grid-scroll" style={{borderRadius:T.radius,boxShadow:T.shadowMd,marginBottom:14}}>
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
                    const flags      = dp.flatMap(p=>p.flags||[]).filter(f=>["NO_SHIFT","ADJUSTMENT","LATE","EARLY_OUT"].includes(f));
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
                            borderRadius:8, padding:"4px 3px", minHeight:46,
                            border:`1.5px solid ${hasFlag?(()=>{const f=flags[0];return({NO_SHIFT:"#C0392B",LATE:"#E8A93A",EARLY_OUT:"#E07020",ADJUSTMENT:"#3A9BE8"}[f]||"#E8A93A")+"80"})():status==="approved"?"#4CAF7D40":status==="rejected"?"#C0392B40":(!hasPunch&&shift&&dateStr<demoToday)?"#E8A93A50":hasPunch?T.border:"transparent"}`,
                            background:hasFlag?(()=>{const f=flags[0];return({NO_SHIFT:"#C0392B",LATE:"#E8A93A",EARLY_OUT:"#E07020",ADJUSTMENT:"#3A9BE8"}[f]||"#E8A93A")+"11"})():status==="approved"?"#F0FFF420":status==="rejected"?"#FDECEA15":(!hasPunch&&shift&&dateStr<demoToday)?"#FEF3E210":hasPunch?T.surface:"transparent",
                            cursor:(hasPunch||shift)?"pointer":"default",
                            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                            transition:"all 0.12s",
                          }}>
                          {!hasPunch&&!shift ? (
                            <span style={{color:T.border,fontSize:11}}>—</span>
                          ) : !hasPunch&&shift ? (
                            <div style={{opacity:0.6,display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                              {dateStr < demoToday ? (
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
                              {hasFlag&&(()=>{
                                const topFlag = flags[0];
                                const fc = {NO_SHIFT:"#C0392B",LATE:"#E8A93A",EARLY_OUT:"#E07020",ADJUSTMENT:"#3A9BE8"}[topFlag]||"#E8A93A";
                                const fi = {NO_SHIFT:"🔴",LATE:"🟡",EARLY_OUT:"🟠",ADJUSTMENT:"🔵"}[topFlag]||"⚠";
                                return <div style={{fontSize:10,color:fc,fontWeight:800,background:fc+"18",borderRadius:4,padding:"2px 5px",marginTop:2,letterSpacing:"0.02em"}}>{fi} {topFlag==="NO_SHIFT"?"No Shift":topFlag==="LATE"?"Late":topFlag==="EARLY_OUT"?"Early Out":"Manual"}</div>;
                              })()}
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

      <div style={{fontSize:11,color:T.sub,textAlign:"center",marginBottom:14}}>
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
                      const wkDates = Array.from({length:7},(_,i)=>{ const d=new Date(snap.weekStart+"T12:00:00"); d.setUTCDate(d.getUTCDate()+i); return toLocalDateStr(d); });
                      exportTimesheetCSV(wkDates, snap.label, snap.employees, snap.reviewStatuses);
                    }} style={{background:T.accent,color:"white",border:"none",borderRadius:7,padding:"5px 12px",fontWeight:700,fontSize:11,cursor:"pointer"}}>Export CSV ↓</button>
                    <button onClick={()=>{ if(window.confirm("Delete this saved timesheet?")) { setTimesheetHistory(p=>p.filter(s=>s.id!==snap.id)); if (bizId) dbDelete(`timesheet_locks?id=eq.${snap.id}`).catch(e=>showError(friendlyError(e,"Couldn't delete that saved timesheet — try again."))); } }}
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
                        <div style={{display:"flex",gap:11,fontSize:12,color:T.sub,flexWrap:"wrap"}}>
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

      <TsCellPopupShell bizId={bizId}/>
    </div>
  );
})()}


{schedSubTab==="schedule" && <>
              <Card T={T} style={{marginBottom:14,padding:0,overflow:"visible",position:"relative",zIndex:300}}>
                {/* UI Batch 6 — Option B: controls row + always-visible budget/checks strip */}
                <div className="controls-bar" style={{display:"flex",gap:14,alignItems:"center",flexWrap:"wrap",padding:"10px 14px"}}>
                  <div>
                    <div style={{display:"flex",gap:5}}>
                      {[["daily","Day"],["weekly","Week"],["monthly","Month"]].map(([v,lbl])=>(
                        <Pill key={v} T={T} active={schedView===v} onClick={()=>setSchedView(v)}>{lbl}</Pill>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="sw-datebar" style={{display:"flex",alignItems:"center",gap:6,background:T.muted,border:`1px solid ${T.border}`,borderRadius:12,padding:4,boxShadow:"inset 0 1px 0 rgba(255,255,255,0.6)"}}>
                      <button onClick={()=>{ const prev=getSunday(addDays(activeWeek||wk1Start,-7)); setWk1Start(prev); setActiveWeek(prev); setPrintWeek(prev); }}
                        style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,width:34,height:36,fontSize:16,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,flexShrink:0}}>‹</button>
                      <div style={{display:"flex",alignItems:"center",borderRadius:9,overflow:"hidden",border:`2px solid ${T.accent}`,boxShadow:`0 0 0 2px ${T.accent}28`}}>
                        <div style={{background:T.accent,color:"white",padding:"8px 16px",fontWeight:700,fontSize:12,whiteSpace:"nowrap",display:"flex",alignItems:"center",justifyContent:"center",gap:6,minWidth:170,boxSizing:"border-box",fontVariantNumeric:"tabular-nums"}}>
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
                        style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,width:34,height:36,fontSize:16,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,flexShrink:0}}>›</button>
                      {(()=>{ const atToday = !(activeWeek !== getSunday(demoToday) || (schedView==="daily" && activeDay !== demoToday)); return (
                        <button onClick={goToTodaySchedule} disabled={atToday} aria-disabled={atToday} title={atToday ? "Already on this week" : "Jump to this week"}
                          style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"0 14px",height:36,fontSize:12,fontWeight:700,color:T.accent,cursor:atToday?"default":"pointer",opacity:atToday?0.45:1,flexShrink:0}}>Today</button>
                      ); })()}
                    </div>
                  </div>

                  <div style={{flex:"1 1 20px"}}/>
                  <button onClick={()=>setHistoryOpen(true)}
                    style={{background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:8,height:36,padding:"0 14px",fontWeight:700,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap"}}>
                    History
                    {published.length>0&&<span style={{background:T.accent,color:"white",borderRadius:10,padding:"1px 6px",fontSize:9}}>{published.length}</span>}
                  </button>
                  <div style={{position:"relative"}}>
                    <button onClick={()=>setActionsOpen(p=>!p)}
                      style={{background:actionsOpen?T.accent:T.muted,color:actionsOpen?"white":T.text,border:"none",borderRadius:8,height:36,padding:"0 14px",fontWeight:700,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap"}}>
                      Actions {actionsOpen?"▲":"▼"}
                    </button>
                    {actionsOpen&&(
                      <>
                        <div onClick={()=>setActionsOpen(false)} style={{position:"fixed",inset:0,zIndex:550}}/>
                        <div style={{position:"absolute",top:"calc(100% + 6px)",right:0,background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,boxShadow:T.shadowMd,zIndex:600,minWidth:240,overflow:"hidden"}}>

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

                  <button onClick={()=>{ if(window.confirm("Publish this schedule? It will be saved as a locked version in History.")) publishSchedule(); }}
                    style={{background:T.accent,color:"white",border:"none",borderRadius:8,height:36,padding:"0 16px",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>
                    Publish week
                  </button>
                </div>

                {(()=>{
                  const budget=parseFloat(weeklyBudget)||0;
                  const spent=activeWkPay;
                  const pct=budget>0?Math.min((spent/budget)*100,100):0;
                  const over=budget>0&&spent>budget;
                  const warn=!over&&pct>85;
                  const barColor=over?"#C0392B":warn?"#E8A93A":"#4CAF7D";
                  const be = activeWeek ? computeBreakEven(activeWeek) : null;
                  const targetPct = laborTargetPct || 30;
                  const laborPct = be && be.sales > 0 ? (be.labor / be.sales) * 100 : null;
                  const overtime = activeWeek ? employees.filter(e => eWkH(activeWeek, e.id) > 40) : [];
                  const statLabel = {fontSize:11.5,color:T.sub,fontWeight:600};
                  const statVal = {fontSize:14,fontWeight:800,marginTop:2,color:T.text};
                  const statCell = {borderLeft:`1px solid ${T.accent}40`,paddingLeft:16,minWidth:0};
                  return (
                    <div className="sched-strip" style={{background:`${T.accent}1F`,borderTop:`1px solid ${T.accent}55`,borderRadius:`0 0 ${T.radius}px ${T.radius}px`,padding:"12px 14px",display:"grid",gridTemplateColumns:"minmax(280px,1.6fr) repeat(2,minmax(0,1fr))",gap:18,alignItems:"center"}}>
                      <div style={{display:"flex",alignItems:"center",gap:12,minWidth:0}}>
                        <label htmlFor="sw-weekly-budget" style={{fontSize:12,fontWeight:700,color:T.sub,whiteSpace:"nowrap"}}>Weekly budget</label>
                        <div style={{position:"relative",flexShrink:0}}>
                          <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",fontWeight:700,fontSize:13,color:T.sub}}>$</span>
                          <input id="sw-weekly-budget" type="number" min="0" step="10" value={weeklyBudget}
                            onChange={e=>{ const v=e.target.value; if(v===""||(!isNaN(v)&&parseFloat(v)>=0)) setWeeklyBudget(v); }}
                            onBlur={e=>{ const v=parseFloat(e.target.value); const val=isNaN(v)||v<0?"":String(Math.round(v)); setWeeklyBudget(val); if(bizId) saveBizSettings({weekly_budget:parseFloat(val)||null}).catch(()=>{}); }}
                            placeholder="Set budget"
                            style={{width:100,height:34,border:`1.5px solid ${budget>0?"#4CAF7D":T.border}`,borderRadius:8,padding:"0 8px 0 22px",fontSize:13,outline:"none",fontWeight:700,background:T.surface,color:T.text,boxSizing:"border-box",transition:"border 0.15s"}}/>
                        </div>
                        <div style={{flex:1,minWidth:120}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:5,gap:8}}>
                            <span style={{fontWeight:800,fontSize:14,color:over?"#C0392B":T.text}}>${spent.toFixed(0)}{budget>0&&<span style={{fontWeight:400,fontSize:12,color:T.sub}}> of ${budget.toFixed(0)}</span>}</span>
                            {budget>0&&<span style={{fontSize:12,fontWeight:700,color:barColor,whiteSpace:"nowrap"}}>{over?`$${(spent-budget).toFixed(0)} over`:`$${(budget-spent).toFixed(0)} left`}</span>}
                          </div>
                          <div style={{height:6,background:T.surface,borderRadius:4,overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${pct}%`,background:barColor,borderRadius:4,transition:"width 0.3s,background 0.3s"}}/>
                          </div>
                        </div>
                      </div>
                      <div className="sched-stat" style={statCell}>
                        <div style={statLabel}>Labor % of sales</div>
                        <div style={{...statVal,color:laborPct!=null&&laborPct>targetPct?"#C0392B":T.text}}>
                          {laborPct==null ? <span style={{fontWeight:600,fontSize:12,color:T.sub}}>Needs 2+ weeks of sales history</span>
                            : <>{laborPct.toFixed(0)}% <span style={{fontWeight:500,fontSize:12,color:T.sub}}>target {targetPct}%</span></>}
                        </div>
                      </div>
                      <div className="sched-stat" style={statCell}>
                        <div style={statLabel}>Over 40 hours</div>
                        <div style={{...statVal,color:overtime.length?"#C0392B":T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                          title={overtime.map(e=>`${e.name||"Unnamed"} · ${eWkH(activeWeek,e.id)}h`).join(", ")}>
                          {overtime.length===0 ? "No one" : overtime.map(e=>`${(e.name||"Unnamed").split(" ")[0]} · ${eWkH(activeWeek,e.id)}h`).join(", ")}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </Card>

              {/* DAILY VIEW */}
              {schedView==="daily" && (() => {
                const dayIdx = new Date(activeDay+"T00:00:00").getDay();
                const dayDate = new Date(activeDay+"T00:00:00");
                const prevDay = addDays(activeDay,-1);
                const nextDay = addDays(activeDay,1);
                const wkForDay = weeks.find(wk => wk.dates.some(d => { const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return toLocalDateStr(dt)===activeDay; }));
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
                          <div key={emp.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 14px",borderBottom:i<employees.length-1?`1px solid ${T.border}`:"none",background:i%2===0?T.surface:T.bg}}>
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
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:T.dark,borderTop:`2px solid ${T.border}`}}>
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
                      <button onClick={()=>{ const d=new Date(year,month-1,1); setWk1Start(getSunday(toLocalDateStr(d))); }} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"7px 14px",fontWeight:700,fontSize:13,cursor:"pointer",color:T.text}}>← Prev</button>
                      <div style={{fontWeight:800,fontSize:18,color:T.text}}>{monthName}</div>
                      <button onClick={()=>{ const d=new Date(year,month+1,1); setWk1Start(getSunday(toLocalDateStr(d))); }} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"7px 14px",fontWeight:700,fontSize:13,cursor:"pointer",color:T.text}}>Next →</button>
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
                          const isToday = dateStr===demoToday;
                          const isActive = dateStr===activeDay;
                          const wkForDay = weeks.find(wk=>wk.dates.some(d=>{ const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return toLocalDateStr(dt)===dateStr; }));
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
                {activeWeek && employees.length > 0 && (() => {
                  const totalShiftsThisWeek = employees.reduce((s, e) => s + DAYS.reduce((ds, _, di) => ds + (getShift(activeWeek, e.id, di) ? 1 : 0), 0), 0);
                  if (totalShiftsThisWeek > 0) return null;
                  const hasAnyShiftsEver = Object.keys(schedule).some(wk =>
                    employees.some(e => DAYS.some((_, di) => getShift(wk, e.id, di)))
                  );
                  if (hasAnyShiftsEver) return null; // established schedule — just an empty week, no message needed
                  return (
                    <div style={{marginBottom:14, background:T.surface, borderRadius:T.radius, border:`2px dashed ${T.border}`, padding:"36px 24px", textAlign:"center", position:"relative"}}>
                      <div style={{width:44, height:44, borderRadius:"50%", background:T.accent+"18", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px", fontSize:22}}>📅</div>
                      <div style={{fontWeight:800, fontSize:15, color:T.text, marginBottom:6}}>Your team is ready — now add their shifts</div>
                      <div style={{fontSize:13, color:T.sub, lineHeight:1.6, marginBottom:16, maxWidth:340, margin:"0 auto 16px"}}>Tap any <strong style={{color:T.text}}>+</strong> cell on the grid below to schedule a shift. ShiftWise tracks labor cost as you go.</div>
                      <div style={{display:"inline-flex", alignItems:"center", gap:8, background:T.accent, color:"white", borderRadius:10, padding:"10px 22px", fontSize:13, fontWeight:700}}>Tap any cell below to start</div>
                    </div>
                  );
                })()}
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
                          const isToday = !!activeWkObj && toInputDate(activeWkObj.dates[i]) === demoToday;
                          return (
                            <th key={d} style={{padding:"12px 6px",textAlign:"center",color:"white",fontSize:13,fontWeight:700,background:isToday?T.accent:"transparent",borderRadius:isToday?"8px 8px 0 0":0}}>
                              <div>{d}</div>
                              <div style={{fontSize:10,color:isToday?"rgba(255,255,255,0.85)":"#777",fontWeight:isToday?700:400,marginTop:2}}>{isToday?"Today":activeWkObj?dl(activeWkObj.dates[i]):""}</div>
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
                            <td className="emp-name-cell" style={{padding:"10px 14px",verticalAlign:"middle",minWidth:180,maxWidth:220}}>
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
                                    <div style={{minHeight:46,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,opacity:0.6}}>
                                      <span style={{fontSize:14}}>🚫</span>
                                      <span style={{fontSize:9,color:T.sub,fontWeight:700,letterSpacing:"0.04em",textTransform:"uppercase"}}>Unavail.</span>
                                    </div>
                                  ) : shift ? (
                                    <div style={{position:"relative"}}
                                      draggable
                                      onDragStart={e=>{ e.dataTransfer.effectAllowed="move"; setDraggedShift({empId:emp.id,weekKey:activeWeek,dayIdx:di,shift}); }}
                                      onDragEnd={()=>{ setDraggedShift(null); setDragOverCell(null); }}>
                                      <div className="shift-badge" onClick={()=>setOpenCell({empId:emp.id,weekKey:activeWeek,dayIdx:di})}
                                        style={{background:emp.color,color:"white",borderRadius:10,padding:"8px 6px",cursor:"grab",fontSize:11,lineHeight:1.4,transition:"opacity 0.12s",opacity:draggedShift?.empId===emp.id&&draggedShift?.dayIdx===di?0.4:1,minHeight:46,display:"flex",flexDirection:"column",justifyContent:"center"}}>
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
                                      style={{width:"100%",minHeight:46}}>
                                      <button className="add-shift-btn" onClick={()=>toggleShift(activeWeek,emp.id,di)}
                                        style={{width:"100%",minHeight:46,background:dragOverCell?.empId===emp.id&&dragOverCell?.dayIdx===di?T.accent+"18":"transparent",border:`1.5px dashed ${dragOverCell?.empId===emp.id&&dragOverCell?.dayIdx===di?T.accent:T.border}`,borderRadius:10,color:dragOverCell?.empId===emp.id&&dragOverCell?.dayIdx===di?T.accent:"#C8C3BC",fontSize:22,cursor:"pointer",transition:"all 0.15s"}}>
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
                {activeWeek && <div style={{marginTop:8,fontSize:11,color:T.sub,textAlign:"center"}}>Tap <strong>+</strong> to add a shift · Tap a shift to edit · Tap <strong>×</strong> to remove · <strong>Drag</strong> a shift to move it</div>}
              </>}
            </>}
            </div>
          )}

          {/* COVERAGE */}
          {tab==="coverage" && (()=>{
            // Demo-aware "today" — same pattern used elsewhere for Cedar &
            // Sage, so Coverage doesn't compare against the real live date.
            const today = isDemoBiz ? new Date(DEMO_TODAY_ANCHOR+"T12:00:00") : new Date();
            const todayStr = demoToday;
            const nowDec = isDemoBiz ? 12 : (today.getHours() + today.getMinutes()/60);

            // Derive week dates from coverageWeek
            const covWkDates = Array.from({length:7},(_,i)=>{
              const d = new Date(coverageWeek+"T00:00:00");
              d.setDate(d.getDate()+i);
              return toLocalDateStr(d);
            });
            const covWkLabel = (() => {
              const s = new Date(coverageWeek+"T00:00:00");
              const e = new Date(coverageWeek+"T00:00:00"); e.setDate(e.getDate()+6);
              const fmt = d => d.toLocaleDateString("en-US",{month:"short",day:"numeric"});
              return `${fmt(s)} – ${fmt(e)}`;
            })();
            const isCurrentWeek = coverageWeek === getSunday(todayStr);

            // Selected day within coverage week (default today if in week, else first day)
            const covDayStr = covWkDates.includes(coverageDay) ? coverageDay : covWkDates[0];
            const covDayIdx = covWkDates.indexOf(covDayStr);
            const covDate   = new Date(covDayStr+"T00:00:00");
            const isToday   = covDayStr === todayStr;

            // ── Helpers ──────────────────────────────────────────────────────
            // `schedule` state is keyed directly by each week's week_start date
            // (see loadAllData step 7) — every seeded week is present at once,
            // regardless of what the Schedule tab's own selector happens to be
            // pointed at. Computing the key straight from the date (rather than
            // searching the Schedule tab's separate 1-2 week `weeks` array, as
            // this used to do) means Coverage works correctly for ANY week that
            // has shift data, not just whichever one Schedule also has open.
            function weekKeyForDate(dateStr) {
              return { weekKey: getSunday(dateStr), dayIdx: new Date(dateStr+"T00:00:00").getDay() };
            }

            const covWk = weekKeyForDate(covDayStr);
            const todayWeekKey = covWk?.weekKey ?? null;
            const todayDayIdx  = covWk?.dayIdx  ?? covDayIdx;
            const todayInSchedule = covWk !== null;

            // Build selected day's full shift status list
            const todayShifts = employees.map(emp => {
              if (!todayInSchedule) return null;
              const shift = schedule?.[todayWeekKey]?.[emp.id]?.[todayDayIdx] || null;
              if (!shift) return null;

              const openEntry = openShifts.find(o =>
                o.weekKey === todayWeekKey && o.empId === emp.id && o.dayIdx === todayDayIdx && o.status !== "cancelled"
              );

              const empPunches = punches.filter(p => {
                const pd = new Date(p.time);
                return p.empId === emp.id && pd.toDateString() === covDate.toDateString();
              }).sort((a,b) => new Date(a.time) - new Date(b.time));
              const lastPunchEntry = empPunches.length ? empPunches[empPunches.length-1] : null;
              const clockedIn = lastPunchEntry?.type === "in" || lastPunchEntry?.type === "break_in";
              const clockedOut = lastPunchEntry?.type === "out";

              // Determine status. Late/missed only make sense when the day
              // being VIEWED is actually today (or in the past) — this
              // previously applied "late" to any day regardless, so a future
              // shift (e.g. June 21 while demoToday is June 17) would show
              // "180m late" for a shift that hasn't happened yet.
              let status = "scheduled";
              if (openEntry) {
                status = openEntry.status === "claimed" ? "claimed" : "open";
              } else if (clockedOut) {
                status = "completed";
              } else if (clockedIn) {
                status = "active";
              } else if (covDayStr < todayStr) {
                status = "missed"; // past day, shift never got a punch
              } else if (covDayStr === todayStr) {
                if (nowDec > shift.end) status = "missed";
                else if (nowDec > shift.start + 0.25) status = "late";
                // else: today, but shift hasn't started yet — stays "scheduled"
              }
              // covDayStr > todayStr (a future day) stays "scheduled"

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
              // Save it, so it survives a refresh and the nightly job doesn't
              // count this call-out as a no-show
              (async () => {
                if (!bizId) return;
                try {
                  let weekId = weekMap[weekKey];
                  if (!weekId) {
                    const rows = await dbUpsert("schedule_weeks", [{ business_id:bizId, week_start:weekKey, label:"Week" }]);
                    weekId = rows?.[0]?.id;
                    if (weekId) setWeekMap(p => ({ ...p, [weekKey]: weekId }));
                  }
                  const saved = await dbPost("open_shifts", {
                    business_id: bizId, week_id: weekId, employee_id: empId, day_index: dayIdx,
                    shift_start: shift.start, shift_end: shift.end, reason: entry.reason, status: "open",
                  });
                  const realId = saved?.[0]?.id;
                  if (realId) setOpenShifts(p => p.map(o => o.id === entry.id ? { ...o, id: realId } : o));
                } catch (e) { showError(friendlyError(e, "That call-out didn't save — it may disappear on refresh.")); }
              })();
            }

            function markClaimed(openId, claimedByEmpId) {
              const claimer = employees.find(e => e.id === claimedByEmpId);
              setOpenShifts(p => p.map(o => o.id===openId ? {...o, status:"claimed", claimedBy:claimedByEmpId} : o));
              addAudit("Shift Claimed", `${claimer?.name} claimed open shift`);
              showToast(`${claimer?.name} assigned ✓`);
              if (bizId) dbPatch(`open_shifts?id=eq.${openId}`, { status:"claimed", claimed_by: claimedByEmpId })
                .catch(e => showError(friendlyError(e, "That assignment didn't save — try again.")));
            }

            function cancelOpen(openId) {
              setOpenShifts(p => p.map(o => o.id===openId ? {...o, status:"cancelled"} : o));
              showToast("Open shift cancelled");
              if (bizId) dbPatch(`open_shifts?id=eq.${openId}`, { status:"cancelled" })
                .catch(e => showError(friendlyError(e, "That change didn't save — try again.")));
            }

            // Week-level open shifts (all weeks)
            const allOpenShifts = openShifts.filter(o =>
              (o.status === "open" || o.status === "claimed") &&
              weeks.some(w => w.key === o.weekKey)
            );

            return (
              <div style={{display:"flex", flexDirection:"column", gap:12}}>

                {/* Header */}
                <div>
                  <h2 style={{margin:"0 0 4px", fontSize:20, fontWeight:800, color:T.text}}>Coverage</h2>
                  <p style={{margin:0, fontSize:12, color:T.sub}}>Live schedule vs reality — manage callouts, open shifts, and replacements.</p>
                </div>

                {/* Week selector */}
                <div className="sw-datebar" style={{display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", background:T.muted,border:`1px solid ${T.border}`,borderRadius:12,padding:4,boxShadow:"inset 0 1px 0 rgba(255,255,255,0.6)"}}>
                  <button onClick={()=>{ const w=getSunday(addDays(coverageWeek,-7)); setCoverageWeek(w); setCoverageDay(covWkDates[0]); }}
                    style={{background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, width:34, height:36, fontSize:16, cursor:"pointer", color:T.sub, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, flexShrink:0}}>‹</button>
                  <div style={{display:"flex", alignItems:"center", borderRadius:9, overflow:"hidden", border:`2px solid ${T.accent}`, boxShadow:`0 0 0 2px ${T.accent}28`}}>
                    <div style={{background:T.accent,color:"white",padding:"8px 16px",fontWeight:700,fontSize:12,whiteSpace:"nowrap",display:"flex",alignItems:"center",justifyContent:"center",gap:6,minWidth:170,boxSizing:"border-box",fontVariantNumeric:"tabular-nums"}}>
                      {isCurrentWeek && <span style={{fontSize:10}}>●</span>}
                      {covWkLabel}
                    </div>
                    <div style={{position:"relative", flexShrink:0, borderLeft:`1px solid ${T.accent}40`}}>
                      <input type="date" value={coverageWeek} onChange={e=>{ const w=getSunday(e.target.value); setCoverageWeek(w); setCoverageDay(w); }}
                        style={{opacity:0, position:"absolute", inset:0, cursor:"pointer", width:"100%", height:"100%"}}/>
                      <div style={{background:T.accent+"18", padding:"8px 10px", fontSize:13, cursor:"pointer", userSelect:"none", color:T.accent}}>📅</div>
                    </div>
                  </div>
                  <button onClick={()=>{ const w=getSunday(addDays(coverageWeek,7)); setCoverageWeek(w); setCoverageDay(w); }}
                    style={{background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, width:34, height:36, fontSize:16, cursor:"pointer", color:T.sub, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, flexShrink:0}}>›</button>
                  <button onClick={()=>{ setCoverageWeek(getSunday(todayStr)); setCoverageDay(todayStr); }} disabled={isCurrentWeek} aria-disabled={isCurrentWeek} title={isCurrentWeek ? "Already on this week" : "Jump to this week"}
                          style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,padding:"0 14px",height:36,fontSize:12,fontWeight:700,color:T.accent,cursor:isCurrentWeek?"default":"pointer",opacity:isCurrentWeek?0.45:1,flexShrink:0}}>Today</button>
                </div>

                {/* Day pills */}
                <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
                  {covWkDates.map((d,i) => {
                    const isSelected = d === covDayStr;
                    const isTod = d === todayStr;
                    const dayDate = new Date(d+"T00:00:00");
                    return (
                      <button key={d} onClick={()=>setCoverageDay(d)}
                        style={{padding:"6px 12px", borderRadius:20, border:`1.5px solid ${isSelected?T.accent:T.border}`, background:isSelected?T.accent:T.surface, color:isSelected?"white":isTod?T.accent:T.sub, fontWeight:isSelected||isTod?700:400, fontSize:12, cursor:"pointer", transition:"all 0.12s"}}>
                        {DAYS[i]} {dayDate.getDate()}
                        {isTod && !isSelected && <span style={{fontSize:9, marginLeft:3}}>●</span>}
                      </button>
                    );
                  })}
                </div>

                {/* Status bar */}
                <div style={{display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10}}>
                  {[
                    { label:"On Shift Now",  value:activeCount, color:"#4CAF7D", icon:"✅" },
                    { label:"Late / No Show",value:lateCount,   color:"#E8A93A", icon:"⏰" },
                    { label:"Open Shifts",   value:openCount,   color:"#C0392B", icon:"🔴" },
                  ].map(s => (
                    <div key={s.label} style={{background:T.surface, borderRadius:T.radius, boxShadow:T.shadow, padding:"11px 14px", borderLeft:`4px solid ${s.color}`}}>
                      <div style={{fontSize:10, fontWeight:700, color:T.sub, textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:4}}>{s.label}</div>
                      <div style={{fontSize:28, fontWeight:900, color:s.value>0?s.color:T.sub, lineHeight:1}}>{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* COVERAGE BOARD */}
                <div style={{background:T.surface, borderRadius:T.radius, boxShadow:T.shadow, overflow:"hidden"}}>
                  <div style={{background:T.dark, padding:"11px 18px", display:"flex", alignItems:"center", justifyContent:"space-between"}}>
                    <div>
                      <span style={{color:"white", fontWeight:800, fontSize:14}}>{isToday ? "Today's Shifts" : `${covDate.toLocaleDateString("en-US",{weekday:"long"})} Shifts`}</span>
                      <span style={{color:"#666", fontSize:11, marginLeft:10}}>
                        {covDate.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
                      </span>
                    </div>
                    <span style={{color:T.accent, fontSize:11, fontWeight:700}}>
                      {todayShifts.filter(s=>s.status==="active").length} active · {todayShifts.length} total
                    </span>
                  </div>

                  {todayShifts.length === 0 && (
                    <div style={{padding:"40px 24px", textAlign:"center", color:T.sub}}>
                      <div style={{fontSize:32, marginBottom:10}}>📅</div>
                      <div style={{fontWeight:700, fontSize:14, marginBottom:6}}>No shifts scheduled {isToday?"today":"on this day"}</div>
                      <div style={{fontSize:12}}>Head to the Schedule tab to add shifts for {covDate.toLocaleDateString("en-US",{weekday:"long"})}.</div>
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
                          <div style={{background:"#FEF3E2", borderTop:`1px solid #E8A93A20`, padding:"10px 15px"}}>
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
                      // Calculate actual hours from punches for the CURRENTLY
                      // VIEWED coverage week — this previously read `activeWeek
                      // || wk1Start` (the Schedule tab's own week state), which
                      // is why every week looked identical here regardless of
                      // which week Coverage was actually navigated to.
                      const wkKey = coverageWeek;
                      const wkDates = covWkDates;
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
                        <div key={emp.id} style={{padding:"10px 15px", borderBottom:i<employees.length-1?`1px solid ${T.border}`:"none"}}>
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

          {/* DASHBOARD — Overview */}
          {tab==="dashboard" && (
            <div>
              <div role="tablist" aria-label="Dashboard sections" style={{display:"flex",gap:6,marginBottom:14}}>
                {[["overview","Overview"],["reports","Report Builder"]].map(([v,lbl])=>(
                  <button key={v} role="tab" aria-selected={dashSub===v} onClick={()=>setDashSub(v)} style={{
                    background:dashSub===v?T.dark:T.muted, color:dashSub===v?"white":T.sub,
                    border:"none",borderRadius:8,padding:"8px 18px",fontWeight:700,fontSize:13,cursor:"pointer",transition:"all 0.15s",minHeight:40
                  }}>{lbl}</button>
                ))}
              </div>
              {dashSub==="overview" ? renderOverview() : renderReportBuilderPanel()}
            </div>
          )}

          {/* Add Widget modal */}
          {showAddWidget && (
            <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:"20px"}} onClick={()=>setShowAddWidget(false)}>
              <div onClick={e=>e.stopPropagation()} style={{background:T.surface,borderRadius:16,padding:"20px 18px",width:"100%",maxWidth:480,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
                <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16,gap:12}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:15,color:T.text}}>🧩 Add Widget</div>
                    <div style={{fontSize:11,color:T.sub,marginTop:2}}>Pick a data source, time range, and how to show it.</div>
                    <button onClick={()=>{ setShowAddWidget(false); setDashSub("reports"); }}
                      style={{background:"none",border:"none",padding:"6px 0 0",color:T.accent,fontWeight:700,fontSize:11.5,cursor:"pointer",textAlign:"left"}}>
                      Need Shift Types, Item Sales, Weather, or Timesheet? Build it in Report Builder and tap "+ Add to Dashboard" →
                    </button>
                  </div>
                  <button onClick={()=>setShowAddWidget(false)} style={{background:T.muted,border:"none",borderRadius:"50%",width:28,height:28,fontSize:16,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>×</button>
                </div>

                {(() => {
                  const DATA_OPTS = [{k:"sales",l:"Sales"},{k:"labor",l:"Labor"},{k:"both",l:"Sales & Labor"}];
                  const rangeLabel = (FILTERS.find(f=>f.key===newWidget.time_range) || {}).label || newWidget.time_range;
                  const dataLabel = (DATA_OPTS.find(o=>o.k===newWidget.data_source) || {}).l || newWidget.data_source;
                  const VIZ_OPTS = [
                    {k:"stat",l:"Stat Card",i:"🔢"},{k:"line",l:"Line Chart",i:"📈"},{k:"bar",l:"Bar Chart",i:"📊"},
                    {k:"area",l:"Area Chart",i:"🏔️"},{k:"combo",l:"Combo Chart",i:"🔀"},{k:"table",l:"Table",i:"📋"},
                  ];
                  const vizLabel = (VIZ_OPTS.find(o=>o.k===newWidget.display) || {}).l || newWidget.display;
                  const colorLabel = (WIDGET_COLORS.find(c=>c.hex===newWidget.color) || {}).key || "Default";
                  const sizeLabel = (WIDGET_SIZES[newWidget.size] || WIDGET_SIZES.sm).label;
                  const pill = (active, extraRadius) => ({
                    background: active?T.accent:T.muted, color: active?"white":T.text, border:"none",
                    borderRadius: extraRadius ?? 999, padding:"6px 12px", fontSize:11, fontWeight:700, cursor:"pointer",
                  });
                  const toggle = (key) => setAwOpenSection(s => ({ ...s, [key]: !s[key] }));
                  const AccHeader = ({ title, summary, open, onToggle }) => (
                    <button onClick={onToggle} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 2px",background:"transparent",border:"none",cursor:"pointer",textAlign:"left"}}>
                      <span style={{fontSize:12.5,fontWeight:700,color:T.text}}>{title}</span>
                      <span style={{display:"flex",alignItems:"center",gap:8}}>
                        {!open && <span style={{fontSize:11,color:T.sub}}>{summary}</span>}
                        <span style={{color:T.sub,fontSize:11,transform:open?"rotate(180deg)":"none",transition:"transform 0.15s",display:"inline-block"}}>▼</span>
                      </span>
                    </button>
                  );

                  return (
                    <>
                      {/* Data Source */}
                      <div style={{borderTop:`1px solid ${T.border}`}}>
                        <AccHeader title="Data Source" summary={dataLabel} open={awOpenSection.data} onToggle={()=>toggle("data")}/>
                        {awOpenSection.data && (
                          <div style={{display:"flex",gap:6,flexWrap:"wrap",paddingBottom:14}}>
                            {DATA_OPTS.map(o=>(
                              <button key={o.k} onClick={()=>setNewWidget(w=>({...w,data_source:o.k}))} style={pill(newWidget.data_source===o.k)}>
                                {o.l}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Time Range */}
                      <div style={{borderTop:`1px solid ${T.border}`}}>
                        <AccHeader title="Time Range" summary={rangeLabel} open={awOpenSection.range} onToggle={()=>toggle("range")}/>
                        {awOpenSection.range && (
                          <div style={{paddingBottom:14}}>
                            <div style={{fontSize:9.5,color:T.sub,fontWeight:700,letterSpacing:0.4,marginBottom:6}}>HISTORY</div>
                            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
                              {FILTERS.filter(f=>f.kind==="history").map(f=>(
                                <button key={f.key} onClick={()=>setNewWidget(w=>({...w,time_range:f.key}))} style={pill(newWidget.time_range===f.key)}>
                                  {f.label}
                                </button>
                              ))}
                            </div>
                            <div style={{fontSize:9.5,color:T.sub,fontWeight:700,letterSpacing:0.4,marginBottom:6}}>FORECAST</div>
                            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                              {FILTERS.filter(f=>f.kind==="forecast").map(f=>(
                                <button key={f.key} onClick={()=>setNewWidget(w=>({...w,time_range:f.key}))} style={pill(newWidget.time_range===f.key)}>
                                  {f.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Visualization */}
                      <div style={{borderTop:`1px solid ${T.border}`}}>
                        <AccHeader title="Visualization" summary={vizLabel} open={awOpenSection.viz} onToggle={()=>toggle("viz")}/>
                        {awOpenSection.viz && (
                          <div style={{paddingBottom:14}}>
                            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:newWidget.display!=="stat"&&newWidget.display!=="table"?12:0}}>
                              {VIZ_OPTS.map(o=>(
                                <button key={o.k} onClick={()=>setNewWidget(w=>({...w,display:o.k}))} style={{...pill(newWidget.display===o.k,10),display:"flex",alignItems:"center",gap:5}}>
                                  <span>{o.i}</span>{o.l}
                                </button>
                              ))}
                            </div>
                            {["line","bar","area","combo"].includes(newWidget.display) && (
                              <div style={{display:"flex",gap:18,flexWrap:"wrap"}}>
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
                          </div>
                        )}
                      </div>

                      {/* Size */}
                      <div style={{borderTop:`1px solid ${T.border}`}}>
                        <AccHeader title="Size" summary={sizeLabel} open={awOpenSection.size} onToggle={()=>toggle("size")}/>
                        {awOpenSection.size && (
                          <div style={{display:"flex",gap:8,flexWrap:"wrap",paddingBottom:14}}>
                            {Object.entries(WIDGET_SIZES).map(([key,s])=>(
                              <button key={key} onClick={()=>setNewWidget(w=>({...w,size:key}))}
                                style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,padding:"10px 12px",borderRadius:10,cursor:"pointer",
                                  border:`1.5px solid ${newWidget.size===key?T.accent:T.border}`,background:newWidget.size===key?T.accent+"14":"transparent"}}>
                                <div style={{width:32,height:32,display:"grid",gridTemplateColumns:`repeat(${s.w},1fr)`,gridTemplateRows:`repeat(${s.h},1fr)`,gap:2}}>
                                  {Array.from({length:s.w*s.h}).map((_,i)=>(
                                    <div key={i} style={{background:newWidget.size===key?T.accent:T.sub,borderRadius:2,opacity:newWidget.size===key?1:0.4}}/>
                                  ))}
                                </div>
                                <span style={{fontSize:10.5,fontWeight:700,color:newWidget.size===key?T.accent:T.text}}>{s.label}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Appearance */}
                      <div style={{borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`}}>
                        <AccHeader title="Appearance" summary={colorLabel} open={awOpenSection.style} onToggle={()=>toggle("style")}/>
                        {awOpenSection.style && (
                          <div style={{display:"flex",gap:8,paddingBottom:14}}>
                            {WIDGET_COLORS.map(c=>(
                              <button key={c.key} onClick={()=>setNewWidget(w=>({...w,color:c.hex}))} aria-label={`Color: ${c.key}`}
                                style={{width:28,height:28,borderRadius:"50%",background:c.hex,border:newWidget.color===c.hex?`2px solid ${T.text}`:"2px solid transparent",cursor:"pointer",padding:0}}/>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}

                <div style={{display:"flex",gap:8,marginTop:18}}>
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
            const hasData = employees.length > 0 && Object.keys(schedule).length > 0;
            const urgencyColor = { low:"#4CAF7D", medium:"#E8A93A", high:"#C0392B" };
            const scoreColor = v => v >= 75 ? "#4CAF7D" : v >= 50 ? "#E8A93A" : "#C0392B";
            const scoreBg    = v => v >= 75 ? "#F0FFF4" : v >= 50 ? "#FEF3E2" : "#FDECEA";

            return (
              <div style={{display:"flex", flexDirection:"column", gap:12}}>

                {/* Header */}
                <div style={{display:"flex", alignItems:"flex-start", justifyContent:"space-between", flexWrap:"wrap", gap:12}}>
                  <div>
                    <h2 style={{margin:"0 0 4px", fontSize:20, fontWeight:800, color:T.text}}>Business Insights</h2>
                    <p style={{margin:0, fontSize:12, color:T.sub, lineHeight:1.5}}>
                      Automated analysis of your schedule, labor costs, and team.
                      {insight && <span style={{marginLeft:6, color:T.sub}}>Last updated {new Date(insight.generatedAt).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</span>}
                    </p>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
                    <button onClick={()=>setInsightsPanel(p=>p==="notif"?null:"notif")}
                      title="Notification preferences"
                      style={{background:insightsPanel==="notif"?T.accent:T.muted,border:`1px solid ${insightsPanel==="notif"?T.accent:T.border}`,borderRadius:9,width:38,height:38,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,cursor:"pointer",transition:"all 0.15s",position:"relative"}}>
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
                    {pulseHistory.length > 0 && (
                      <button onClick={()=>setInsightsPanel(p=>p==="history"?null:"history")}
                        title="Score history"
                        style={{background:insightsPanel==="history"?T.accent:T.muted,border:`1px solid ${insightsPanel==="history"?T.accent:T.border}`,borderRadius:9,height:38,padding:"0 14px",display:"flex",alignItems:"center",gap:6,fontSize:12,fontWeight:700,color:insightsPanel==="history"?"white":T.sub,cursor:"pointer",transition:"all 0.15s"}}>
                        📈 History
                      </button>
                    )}
                    <button onClick={()=>{ const next = insightsPanel!=="prices"; setInsightsPanel(next?"prices":null); if (next && !priceData) loadPriceChanges(); }}
                      title="Price Changes"
                      style={{background:insightsPanel==="prices"?T.accent:T.muted,border:`1px solid ${insightsPanel==="prices"?T.accent:T.border}`,borderRadius:9,height:38,padding:"0 14px",display:"flex",alignItems:"center",gap:6,fontSize:12,fontWeight:700,color:insightsPanel==="prices"?"white":T.sub,cursor:"pointer",transition:"all 0.15s"}}>
                      💲 Price Changes{priceData?.changes?.length ? ` · ${priceData.changes.length}` : ""}
                    </button>
                  </div>
                </div>

                {/* Pulse Score History panel */}
                {insightsPanel==="history" && pulseHistory.length > 0 && (
                  <Card T={T} style={{padding:"13px 17px"}}>
                    <div style={{fontWeight:800,fontSize:14,color:T.text,marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <span>📈 Score History</span>
                      <span style={{fontSize:11,color:T.sub,fontWeight:500}}>{pulseHistory.length} week{pulseHistory.length!==1?"s":""} tracked</span>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {pulseHistory.slice(0,8).map((h,i)=>{
                        const color = h.score>=75?"#4CAF7D":h.score>=50?"#E8A93A":h.score>=30?"#C0392B":"#7B0000";
                        const bg    = h.score>=75?"#F0FFF4":h.score>=50?"#FEF3E2":h.score>=30?"#FDECEA":"#FDECEA";
                        const isCurrent = i===0;
                        const weekDate = h.weekStart ? new Date(h.weekStart+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}) : "—";
                        const genDate  = h.generatedAt ? new Date(h.generatedAt).toLocaleDateString("en-US",{month:"short",day:"numeric"}) : "—";
                        const prevScore = pulseHistory[i+1]?.score;
                        const delta = prevScore != null ? h.score - prevScore : null;
                        return (
                          <div key={h.id||i} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",borderRadius:10,background:isCurrent?bg:T.muted,border:`1px solid ${isCurrent?color+"40":T.border}`}}>
                            <div style={{width:44,height:44,borderRadius:10,background:isCurrent?color:T.border,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                              <span style={{fontSize:16,fontWeight:900,color:"white",lineHeight:1}}>{h.score}</span>
                            </div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:6}}>
                                <span style={{fontWeight:700,fontSize:13,color:isCurrent?color:T.text}}>{h.label}</span>
                                {isCurrent && <span style={{fontSize:9,fontWeight:700,color:color,background:bg,border:`1px solid ${color}30`,borderRadius:4,padding:"1px 5px"}}>THIS WEEK</span>}
                              </div>
                              <div style={{fontSize:11,color:T.sub,marginTop:2}}>Week of {weekDate} · Saved {genDate}</div>
                            </div>
                            {delta!=null && (
                              <div style={{fontSize:13,fontWeight:800,color:delta>0?"#4CAF7D":delta<0?"#C0392B":T.sub,flexShrink:0}}>
                                {delta>0?`+${delta}`:delta<0?`${delta}`:"—"}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {pulseHistory.length===1 && (
                      <div style={{fontSize:11,color:T.sub,textAlign:"center",marginTop:10,padding:"8px",background:T.muted,borderRadius:8}}>
                        Generate your Pulse from the weekly notification to build your score history.
                      </div>
                    )}
                  </Card>
                )}

                {/* Price Changes panel */}
                {insightsPanel==="prices" && renderPriceChangesPanel()}

                {/* Report Builder moved to Dashboard → Report Builder */}

                {/* Notification preferences panel */}
                {insightsPanel==="notif" && (
                  <Card T={T} style={{padding:"14px 16px",border:`1.5px solid ${T.accent}28`,background:T.accent+"08"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                      <div>
                        <div style={{fontWeight:800,fontSize:14,color:T.text}}>🔔 Pulse Notifications</div>
                        <div style={{fontSize:11,color:T.sub,marginTop:2}}>When should ShiftWise remind you to run your weekly analysis?</div>
                      </div>
                      <button onClick={()=>setInsightsPanel(null)} style={{background:T.muted,border:"none",borderRadius:"50%",width:28,height:28,fontSize:16,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
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
                {!insightsPanel && !seasonNow.open && (
                  <div role="status" style={{background:"#F6EEE3",border:"1px solid #E8D6BD",borderRadius:12,padding:"14px 16px",fontSize:14,color:T.text,marginBottom:12}}>
                    <strong>Closed for the season.</strong> The Weekly Pulse resumes when you reopen on {fmtLongDate(seasonNow.reopens)}.
                  </div>
                )}
                {!insightsPanel && insightError && (
                  <div style={{background:"#FDECEA", border:"1.5px solid #C0392B30", borderRadius:T.radius, padding:"14px 18px", color:"#C0392B", fontSize:13, fontWeight:600}}>
                    ⚠️ {insightError}
                  </div>
                )}

                {/* Loading skeleton */}
                {!insightsPanel && insightLoading && (
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
                {!insightsPanel && !insightLoading && !insight && !insightError && seasonNow.open && (() => {
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
                      <div style={{marginBottom:24}}>
                        <div style={{fontWeight:800, fontSize:17, color:T.text, marginBottom:4}}>Your first Pulse is 3 steps away</div>
                        <div style={{fontSize:13, color:T.sub, lineHeight:1.5}}>Complete these steps, then hit Generate Insights above to get your plain-English briefing.</div>
                      </div>

                      {/* Step 1 */}
                      {(() => { const s = stepIcon(hasEmployees, !hasEmployees); return (
                        <div style={{display:"flex", alignItems:"flex-start", gap:11, padding:"16px 0", borderBottom:`1px solid ${T.border}`}}>
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
                        <div style={{display:"flex", alignItems:"flex-start", gap:11, padding:"16px 0", borderBottom:`1px solid ${T.border}`}}>
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
                        <div style={{display:"flex", alignItems:"flex-start", gap:11, padding:"16px 0 0"}}>
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
                {!insightsPanel && !insightLoading && insight && (
                  <div style={{display:"flex", flexDirection:"column", gap:11}}>

                    {/* Headline + Score */}
                    <Card T={T} style={{padding:0, overflow:"hidden"}}>
                      <div style={{background:T.dark, padding:"13px 17px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:16, flexWrap:"wrap"}}>
                        <div style={{flex:1, minWidth:200}}>
                          <div style={{fontSize:10, fontWeight:700, color:"#666", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:6}}>This Week's Headline</div>
                          <div style={{fontSize:17, fontWeight:800, color:"white", lineHeight:1.4}}>{insight.headline}</div>
                        </div>
                        {insight.score && (
                          <ScoreCard score={insight.score} scoreColor={scoreColor} scoreBg={scoreBg} history={pulseHistory} isOpen={scoreOpen} onToggle={setScoreOpen} T={T} />
                        )}
                      </div>

                      {/* Scoring legend — full width */}
                      {scoreOpen && insight.score && (
                        <div style={{padding:"13px 17px", borderBottom:`1px solid ${T.border}`, background:T.surface}}>
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
                            display:"flex", gap:11, padding:"13px 18px",
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
                            {section.shiftTypes && renderShiftTypeRows(section.shiftTypes)}
                          </Card>
                        ))}
                      </div>
                    )}

                    {/* Next Week Focus */}
                    {insight.nextWeekFocus && (
                      <Card T={T} style={{padding:"13px 17px", background:T.accent+"10", border:`1.5px solid ${T.accent}28`}}>
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


          {/* SETTINGS */}


          {/* SETTINGS */}
          {tab==="settings" && (()=>{
            const SETTING_SECTIONS = [
              { id:"general",  icon:"🏢", label:"General",          sub:"Business, hours, labor target, shift types & appearance" },
              { id:"roster",   icon:"👥", label:"Team Roster",      sub:`${employees.length} employee${employees.length!==1?"s":""}` },
              { id:"kiosk",    icon:"🔐", label:"Kiosk & Clock-In", sub:"Manage owner PIN for kiosk app" },
              { id:"print",    icon:"🖨",  label:"Print Schedule",   sub:"Preview and print or save as PDF" },
              { id:"data",     icon:"💾", label:"Data & Backup",    sub:(()=>{ return bizId ? "Connected to Supabase ✓" : "Not connected"; })() },
              { id:"audit",    icon:"📋", label:"Audit Log",        sub:auditLog.length>0?`${auditLog.length} change${auditLog.length!==1?"s":""} recorded`:"No changes recorded yet" },
            ];

            const SETTING_FOLDERS = {
              general: [
                { id:"profile",    label:"Business profile",   sub: biz || "Name and address" },
                { id:"hours",      label:"Hours of operation", sub: (()=>{ const set = Object.values(businessHours).filter(h=>!h.closed).length; return set>0?`${set} day${set!==1?"s":""}  configured`:"Not configured yet"; })() },
                { id:"season",     label:"Season",             sub: (()=>{ if (!season.on) return "Open year-round"; const si = seasonInfo(demoToday, season); const md = s => `${SEASON_MONTHS[Number(s.slice(0,2))-1].slice(0,3)} ${Number(s.slice(3))}`; return `${md(season.open)} – ${md(season.close)} · ${si.open ? "open now" : "closed now"}`; })() },
                { id:"labor",      label:"Labor cost target",  sub: `${laborTargetPct || 30}% of sales` },
                { id:"shifts",     label:"Shift types",        sub: `${shiftTypes.length} type${shiftTypes.length!==1?"s":""}` },
                { id:"appearance", label:"Appearance",         sub: THEMES[themeId]?.name || "Theme" },
              ],
              roster: [{ id:"team",   label:"Team roster",      sub: `${employees.length} employee${employees.length!==1?"s":""}` }],
              kiosk:  [
                { id:"app",  label:"Kiosk app",     sub:"Standalone clock-in app" },
                { id:"link", label:"Kiosk link",    sub:"Open or share the kiosk" },
                { id:"pins", label:"Clock-in PINs", sub:"Employee PINs" },
              ],
              print:  [{ id:"print",  label:"Print schedule",   sub:"Preview, print or save as PDF" }],
              data:   [
                { id:"sales",   label:"Sales data",     sub: squareConnected ? "Square connected" : "Square or CSV" },
                { id:"backups", label:"Backups",        sub:"Auto-save, export, import" },
                { id:"clear",   label:"Clear all data", sub:"Start over" },
              ],
              audit:  [{ id:"log",    label:"Audit log",        sub: auditLog.length ? `${auditLog.length} change${auditLog.length!==1?"s":""}` : "No changes yet" }],
            };
            // Desktop always shows a selection (General → first folder); on phones
            // the raw state decides which one column is visible.
            const curSec = settingsSection === "hours" ? "general" : (settingsSection || "general");
            const folders = SETTING_FOLDERS[curSec] || [];
            const curFolder = settingsSection === "hours" ? "hours" : (folders.some(f=>f.id===settingsFolder) ? settingsFolder : folders[0]?.id);
            const gf = k => curFolder === k;
            const level = !settingsSection ? 0 : !settingsFolder ? 1 : 2;
            const curSecDef = SETTING_SECTIONS.find(s=>s.id===curSec);
            const curFolderDef = folders.find(f=>f.id===curFolder);
            const backBtn = (onClick, label) => (
              <button className="sw-set-back" onClick={onClick} aria-label={label}
                style={{display:"none",alignItems:"center",gap:6,background:"none",border:"none",color:T.accent,fontWeight:700,fontSize:13,cursor:"pointer",padding:"4px 0",marginBottom:8}}>
                ‹ {label}
              </button>
            );
            return (
              <div style={{paddingBottom:20}}>
                <div style={{marginBottom:14}}>
                  <h2 style={{margin:"0 0 2px", fontSize:22, fontWeight:800, color:T.text}}>Settings</h2>
                  <p style={{margin:0, fontSize:13, color:T.sub}}>Pick a category, then a section to edit.</p>
                </div>
                <div className={`sw-settings sw-set-lvl${level}`} style={{display:"grid",gridTemplateColumns:"230px 270px minmax(0,1fr)",background:T.surface,border:`1px solid ${T.border}`,borderRadius:16,overflow:"hidden",minHeight:620}}>
                  {/* Column 1 — categories */}
                  <nav aria-label="Settings categories" className="sw-set-col1" style={{padding:12,borderRight:`1px solid ${T.border}`,display:"flex",flexDirection:"column",gap:4}}>
                    {SETTING_SECTIONS.map(s => {
                      const on = s.id === curSec;
                      return (
                        <button key={s.id} onClick={()=>{ setSettingsSection(s.id); setSettingsFolder(null); }} aria-current={on ? "true" : undefined}
                          style={{width:"100%",display:"flex",alignItems:"center",gap:11,padding:"10px 12px",borderRadius:10,border:"none",background:on?T.accent:"transparent",color:on?"white":T.text,fontFamily:"inherit",textAlign:"left",cursor:"pointer"}}>
                          <span style={{width:32,height:32,borderRadius:8,background:on?"rgba(255,255,255,0.18)":T.muted,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{s.icon}</span>
                          <span style={{minWidth:0}}>
                            <span style={{display:"block",fontSize:14,fontWeight:700}}>{s.label}</span>
                            <span className="sw-set-catsub" style={{display:"none",fontSize:11.5,color:on?"rgba(255,255,255,0.8)":T.sub,marginTop:1}}>{s.sub}</span>
                          </span>
                        </button>
                      );
                    })}
                  </nav>
                  {/* Column 2 — folders */}
                  <div className="sw-set-col2" style={{padding:12,borderRight:`1px solid ${T.border}`,background:T.muted+"66",display:"flex",flexDirection:"column",gap:4}}>
                    {backBtn(()=>{ setSettingsSection(null); setSettingsFolder(null); }, "Settings")}
                    <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",color:T.sub,padding:"6px 12px 8px"}}>{curSecDef?.label}</div>
                    {folders.map(f => {
                      const on = f.id === curFolder;
                      return (
                        <button key={f.id} onClick={()=>{ if (!settingsSection || settingsSection==="hours") setSettingsSection(curSec); setSettingsFolder(f.id); }} aria-current={on ? "true" : undefined}
                          style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"11px 12px",borderRadius:10,border:`1px solid ${on?T.accent:"transparent"}`,background:on?T.accent+"14":"transparent",fontFamily:"inherit",textAlign:"left",cursor:"pointer"}}>
                          <span style={{minWidth:0}}>
                            <span style={{display:"block",fontSize:14,fontWeight:700,color:T.text}}>{f.label}</span>
                            <span style={{display:"block",fontSize:12,color:T.sub,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{f.sub}</span>
                          </span>
                          <span aria-hidden="true" style={{color:T.sub,fontSize:16,flexShrink:0}}>›</span>
                        </button>
                      );
                    })}
                  </div>
                  {/* Column 3 — details */}
                  <section className="sw-set-col3" aria-label={curFolderDef?.label} style={{padding:"20px 24px",minWidth:0}}>
                    {backBtn(()=>setSettingsFolder(null), curSecDef?.label || "Back")}
                    {curSec !== "roster" && <h3 style={{margin:"0 0 14px",fontSize:18,fontWeight:800,color:T.text}}>{curFolderDef?.label}</h3>}
                {/* GENERAL */}
                {curSec==="general" && (
                  <div style={{display:"flex", flexDirection:"column", gap:11}}>
                    {gf("profile") && (
                    <Card T={T} style={{padding:"14px 16px"}}>
                      <SectionLabel T={T}>Business Name</SectionLabel>
                      <p style={{margin:"0 0 12px", fontSize:12, color:T.sub, lineHeight:1.5}}>Appears in the top bar and on all printed schedules.</p>
                      <input value={biz} onChange={e=>setBiz(e.target.value)}
                        onBlur={saveBizNameIfChanged}
                        style={{width:"100%", border:`1.5px solid ${T.border}`, borderRadius:9, padding:"11px 13px", fontSize:16, fontWeight:700, outline:"none", color:T.text, background:T.surface}}
                        placeholder="Your business name"/>
                    </Card>
                    )}

                    <div>
                      {gf("profile") && (
                      <Card T={T} style={{padding:"14px 16px", marginBottom:16}}>
                        <SectionLabel T={T}>Business Address</SectionLabel>
                        <p style={{margin:"0 0 12px", fontSize:12, color:T.sub, lineHeight:1.5}}>Used to record each day's weather automatically, so you can see how weather affects sales and staffing.</p>
                        {(() => {
                          const a = addrDraft || bizAddress;
                          const setA = f => setAddrDraft({ ...(addrDraft || bizAddress), ...f });
                          const inp = {width:"100%",boxSizing:"border-box",border:`1.5px solid ${T.border}`,borderRadius:9,padding:"11px 13px",fontSize:14,outline:"none",color:T.text,background:T.surface};
                          const changed = addrDraft && JSON.stringify(addrDraft) !== JSON.stringify(bizAddress);
                          const has = bizAddress.line || bizAddress.zip;
                          const status = !has ? null
                            : weatherInfo.status === "not_found" ? { c:"#A93226", t:"We couldn't find that address. Check the street and ZIP, then save again." }
                            : weatherInfo.latestDate ? { c:"#2D6A4F", t:`Weather tracking is on · last recorded ${dl(weatherInfo.latestDate)}` }
                            : { c:T.sub, t:"Weather tracking starts tonight." };
                          return (
                            <div style={{display:"flex",flexDirection:"column",gap:8}}>
                              <input value={a.line} onChange={e=>setA({line:e.target.value})} placeholder="Street address" aria-label="Street address" autoComplete="street-address" style={inp}/>
                              <div style={{display:"grid",gridTemplateColumns:"minmax(0,2fr) minmax(0,1fr) minmax(0,1.2fr)",gap:8}}>
                                <input value={a.city} onChange={e=>setA({city:e.target.value})} placeholder="City" aria-label="City" autoComplete="address-level2" style={inp}/>
                                <input value={a.state} onChange={e=>setA({state:e.target.value})} placeholder="State" aria-label="State" maxLength={2} autoComplete="address-level1" style={inp}/>
                                <input value={a.zip} onChange={e=>setA({zip:e.target.value})} placeholder="ZIP" aria-label="ZIP code" inputMode="numeric" maxLength={10} autoComplete="postal-code" style={inp}/>
                              </div>
                              {status && !changed && <div style={{fontSize:11.5,color:status.c,lineHeight:1.5}}>{status.t}</div>}
                              {changed && (
                                <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:8}}>
                                  <button onClick={()=>setAddrDraft(null)} style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:9,padding:"11px 0",fontWeight:700,fontSize:13,color:T.sub,cursor:"pointer"}}>Cancel</button>
                                  <button onClick={async ()=>{
                                    const d = { line:a.line.trim(), city:a.city.trim(), state:a.state.trim().toUpperCase(), zip:a.zip.trim() };
                                    try {
                                      // Clearing the stored location makes the nightly job look the new address up again
                                      await dbPatch(`businesses?id=eq.${bizId}`, { address_line:d.line||null, city:d.city||null, state:d.state||null, zip:d.zip||null, latitude:null, longitude:null, weather_station:null, geocode_status:null });
                                      setBizAddress(d); setAddrDraft(null);
                                      setWeatherInfo(w => ({ ...w, status:null }));
                                      showToast("Address saved ✓");
                                    } catch (e) { showError(friendlyError(e, "Couldn't save the address — try again.")); }
                                  }} style={{background:T.accent,border:"none",borderRadius:9,padding:"11px 0",fontWeight:700,fontSize:13,color:"white",cursor:"pointer"}}>Save address</button>
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </Card>
                      )}
                      {gf("labor") && (
                      <Card T={T} style={{padding:"14px 16px", marginBottom:16}}>
                        <SectionLabel T={T}>Labor Cost Target</SectionLabel>
                        <p style={{margin:"0 0 12px", fontSize:12, color:T.sub, lineHeight:1.5}}>Labor as a % of sales you're aiming for. 30% is a common average; set what fits your business. Break-even, the week check, suggested budgets, and Insights all use it.</p>
                        <div style={{display:"flex", alignItems:"center", gap:8}}>
                          <input type="number" min="1" max="99" step="0.5" key={`lt-${laborTargetPct}`} defaultValue={laborTargetPct} aria-label="Labor cost target percent"
                            onBlur={e=>{ const n=parseFloat(e.target.value); if(isNaN(n)||n<=0||n>=100){ e.target.value=laborTargetPct; showToast("Enter a number between 1 and 99"); return; } if(n===laborTargetPct) return; setLaborTargetPct(n); saveBizSettings({labor_target_pct:n}); showToast(`Labor target set to ${n}% ✓`); }}
                            onKeyDown={e=>{ if(e.key==="Enter") e.target.blur(); }}
                            style={{width:100, border:`1.5px solid ${T.border}`, borderRadius:9, padding:"11px 13px", fontSize:16, fontWeight:700, outline:"none", color:T.text, background:T.surface}}/>
                          <span style={{fontSize:15, fontWeight:700, color:T.sub}}>% of sales</span>
                        </div>
                      </Card>
                      )}
                      {gf("shifts") && (<>
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
                      <Card T={T} style={{padding:"11px 14px",marginBottom:8}}>
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
                      </>)}
                    </div>

                    {gf("appearance") && (
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
                    )}
                  </div>
                )}

                {/* HOURS OF OPERATION */}
                {curSec==="general" && gf("season") && (()=>{
                  const save = next => { setSeason(next); saveBizSettings({ seasonal: next.on, season_open: next.open, season_close: next.close }); };
                  const si = seasonInfo(demoToday, season);
                  const daysIn = m => new Date(2024, m, 0).getDate(); // leap year, so Feb 29 is pickable
                  const part = (md) => ({ m: Number(md.slice(0,2)), d: Number(md.slice(3)) });
                  const mk = (m, d) => `${String(m).padStart(2,"0")}-${String(Math.min(d, daysIn(m))).padStart(2,"0")}`;
                  const sel = {appearance:"none",WebkitAppearance:"none",height:42,border:`1.5px solid ${T.border}`,borderRadius:9,background:T.surface,padding:"0 30px 0 12px",fontSize:14,fontWeight:600,color:T.text,fontFamily:"inherit",cursor:"pointer"};
                  const chev = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.sub} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{position:"absolute",right:10,top:14,pointerEvents:"none"}}><path d="m6 9 6 6 6-6"/></svg>;
                  const datePick = (key, label) => {
                    const { m, d } = part(season[key]);
                    return (
                      <fieldset style={{border:"none",padding:0,margin:0,display:"flex",gap:8,alignItems:"flex-end"}}>
                        <legend style={{fontSize:12,fontWeight:700,color:T.sub,marginBottom:5,padding:0}}>{label}</legend>
                        <div style={{position:"relative"}}>
                          <select aria-label={`${label} month`} value={m} disabled={!season.on} onChange={e=>save({ ...season, [key]: mk(Number(e.target.value), d) })} style={{...sel,width:150,opacity:season.on?1:0.5}}>
                            {SEASON_MONTHS.map((name,i)=><option key={name} value={i+1}>{name}</option>)}
                          </select>{chev}
                        </div>
                        <div style={{position:"relative"}}>
                          <select aria-label={`${label} day`} value={d} disabled={!season.on} onChange={e=>save({ ...season, [key]: mk(m, Number(e.target.value)) })} style={{...sel,width:84,opacity:season.on?1:0.5}}>
                            {Array.from({length:daysIn(m)},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}
                          </select>{chev}
                        </div>
                      </fieldset>
                    );
                  };
                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:14,maxWidth:640}}>
                      <p style={{margin:0,fontSize:13,color:T.sub,lineHeight:1.5}}>For businesses that close part of the year. The same dates repeat every year.</p>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,padding:"14px 16px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:12}}>
                        <div>
                          <div style={{fontSize:14.5,fontWeight:800,color:T.text}}>Seasonal business</div>
                          <div style={{fontSize:12.5,color:T.sub,marginTop:2}}>Turn off if you're open year-round.</div>
                        </div>
                        <button role="switch" aria-checked={season.on} aria-label="Seasonal business" onClick={()=>save({ ...season, on: !season.on })}
                          style={{width:48,height:28,borderRadius:999,border:"none",background:season.on?T.accent:T.border,position:"relative",cursor:"pointer",flexShrink:0,transition:"background 0.15s"}}>
                          <span style={{position:"absolute",top:3,left:season.on?23:3,width:22,height:22,borderRadius:999,background:"white",transition:"left 0.15s"}}/>
                        </button>
                      </div>
                      <div style={{display:"flex",gap:22,flexWrap:"wrap"}}>
                        {datePick("open","Opens")}
                        {datePick("close","Closes")}
                      </div>
                      {season.on && (
                        <div role="status" style={{background:si.open?T.accent+"12":"#F6EEE3",border:`1px solid ${si.open?T.accent+"40":"#E8D6BD"}`,borderRadius:12,padding:"12px 14px",fontSize:13.5,lineHeight:1.5,color:T.text}}>
                          {si.open
                            ? <><strong>Open now.</strong> This season closes {fmtLongDate(si.closes)}.</>
                            : <><strong>Closed now.</strong> Reopens {fmtLongDate(si.reopens)}. Last season ran {fmtLongDate(si.last.start)} – {fmtLongDate(si.last.end)} ({si.last.weeks} weeks).</>}
                        </div>
                      )}
                      {season.on && season.open === season.close && (
                        <div style={{fontSize:12.5,color:"#A93226"}}>Opens and closes on the same day — pick different dates.</div>
                      )}
                      <div>
                        <div style={{fontSize:12,fontWeight:800,letterSpacing:"0.06em",textTransform:"uppercase",color:T.sub,marginBottom:8}}>What this changes</div>
                        <ul style={{margin:0,paddingLeft:18,fontSize:13.5,lineHeight:1.55,color:T.text}}>
                          <li>Closed weeks are left out of averages — Pulse, trends, Labor %, widgets, Report Builder.</li>
                          <li>The Weekly Pulse email pauses until you reopen.</li>
                          <li>Week-over-week comparisons skip the closed stretch and compare to the same week last season.</li>
                          <li>Break-even stops flagging days you weren't open; fixed costs still show.</li>
                          <li>Employee value uses the open weeks they actually worked.</li>
                        </ul>
                      </div>
                      <div style={{fontSize:12,color:T.sub}}>Changes save automatically.</div>
                    </div>
                  );
                })()}

                {curSec==="general" && gf("hours") && (
                  <div style={{display:"flex",flexDirection:"column",gap:11}}>
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
                      <Card T={T} style={{padding:"13px 16px",background:T.accent+"10",border:`1.5px solid ${T.accent}28`}}>
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
                {curSec==="roster" && (
                  <div style={{paddingBottom:20}}>
                    {/* Roster header — not sticky, so it never covers the picker cards (UI Batch 20) */}
                    <div style={{paddingBottom:12,marginBottom:12,borderBottom:`1px solid ${T.border}`}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
                        <div>
                          <h2 style={{margin:"0 0 2px",fontSize:18,fontWeight:800,color:T.text}}>Team Roster</h2>
                          <p style={{margin:0,fontSize:12,color:T.sub}}>{employees.length} active · pick someone to open their card</p>
                        </div>
                        <div style={{display:"flex",gap:8,alignItems:"center"}}>
                          <div style={{position:"relative"}}>
                            <input value={rosterSearch} onChange={e=>setRosterSearch(e.target.value)} placeholder="Search team" aria-label="Search team"
                              style={{width:200,height:38,boxSizing:"border-box",border:`1.5px solid ${T.border}`,borderRadius:9,padding:"0 12px",fontSize:13,outline:"none",background:T.surface,color:T.text}}/>
                          </div>
                          <button onClick={()=>addEmp()} style={{background:T.accent,color:"white",border:"none",borderRadius:9,padding:"9px 18px",fontWeight:700,fontSize:13,cursor:"pointer",flexShrink:0}}>
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
                    {/* UI Batch 20 — picker cards (name + role only); tapping one opens a focused card */}
                    {(()=>{
                      const q = rosterSearch.trim().toLowerCase();
                      const shown = q ? employees.filter(e => `${e.name||""} ${e.role||""}`.toLowerCase().includes(q)) : employees;
                      const initials = n => (n||"?").split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase() || "?";
                      return (
                        <div className="team-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
                          {shown.map(emp => (
                            <button key={emp.id} className="emp-card" onClick={()=>setEditEmpId(emp.id)} aria-haspopup="dialog"
                              style={{display:"flex",alignItems:"center",gap:12,padding:14,borderRadius:14,border:`1.5px solid ${editEmpId===emp.id?emp.color:T.border}`,background:T.surface,boxShadow:T.shadow,fontFamily:"inherit",textAlign:"left",cursor:"pointer",minHeight:72}}>
                              <span aria-hidden="true" style={{width:44,height:44,borderRadius:"50%",background:emp.color,color:"white",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:16,flexShrink:0}}>{initials(emp.name)}</span>
                              <span style={{minWidth:0}}>
                                <span style={{display:"block",fontSize:15,fontWeight:800,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{emp.name||"New Employee"}</span>
                                <span style={{display:"block",fontSize:12.5,color:T.sub,marginTop:2}}>{emp.role||"No role"}</span>
                              </span>
                            </button>
                          ))}
                          {!q && employees.length > 0 && (
                            <button onClick={()=>addEmp()} style={{display:"flex",alignItems:"center",justifyContent:"center",padding:14,borderRadius:14,border:`1.5px dashed ${T.border}`,background:"transparent",fontFamily:"inherit",fontSize:14,fontWeight:700,color:T.accent,cursor:"pointer",minHeight:72}}>+ Add employee</button>
                          )}
                          {q && shown.length === 0 && <div style={{fontSize:13,color:T.sub,padding:"8px 2px"}}>No one matches "{rosterSearch}".</div>}
                        </div>
                      );
                    })()}

                    {(()=>{
                      const emp = employees.find(e => e.id === editEmpId);
                      if (!emp) return null;
                      const totalH=eTotalH(emp.id), totalP=eTotalP(emp);
                      const ex = rosterExit && rosterExit.empId === emp.id ? rosterExit : null;
                      const s = ex?.data;
                      const close = () => setEditEmpId(null);
                      const stat = (label, value, sub, warn) => (
                        <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 12px",display:"flex",flexDirection:"column",gap:2,minWidth:0}}>
                          <span style={{fontSize:11.5,fontWeight:600,color:T.sub}}>{label}</span>
                          <span style={{fontSize:16,fontWeight:800,color:warn?"#A93226":T.text}}>{value}</span>
                          {sub && <span style={{fontSize:11,color:T.sub}}>{sub}</span>}
                        </div>
                      );
                      const tenure = d => d == null ? "—" : d < 60 ? `${d} days` : d < 730 ? `${Math.round(d/30.4)} months` : `${(d/365).toFixed(1)} years`;
                      return (
                        <div onKeyDown={e=>{ if (e.key === "Escape") close(); }}
                          style={{position:"fixed",inset:0,zIndex:900,background:"rgba(20,28,22,0.45)",backdropFilter:"blur(3px)",WebkitBackdropFilter:"blur(3px)",overflowY:"auto",padding:"32px 16px",boxSizing:"border-box"}}
                          onClick={e=>{ if (e.target === e.currentTarget) close(); }}>
                          <div role="dialog" aria-modal="true" aria-label={emp.name || "New employee"} className="sw-emp-dialog"
                            style={{maxWidth:1040,margin:"0 auto",background:T.bg,borderRadius:18,boxShadow:"0 24px 60px rgba(0,0,0,0.3)",padding:"22px 24px",display:"flex",flexDirection:"column",gap:18}}>
                            <div style={{display:"flex",alignItems:"center",gap:14,paddingBottom:16,borderBottom:`1px solid ${T.border}`}}>
                              <span aria-hidden="true" style={{width:56,height:56,borderRadius:"50%",background:emp.color,color:"white",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:20,flexShrink:0}}>{(emp.name||"?").split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase()||"?"}</span>
                              <div style={{flex:1,minWidth:0}}>
                                <h2 style={{margin:0,fontSize:22,fontWeight:800,color:T.text}}>{emp.name || "New Employee"}</h2>
                                <div style={{fontSize:13,color:T.sub,marginTop:2}}>{[emp.role, emp.hourlyRate ? `$${emp.hourlyRate}/hr` : null, `${totalH}h scheduled`, `est. $${totalP.toFixed(0)}`].filter(Boolean).join(" · ")}</div>
                              </div>
                              <button onClick={close} aria-label="Close" autoFocus
                                style={{width:40,height:40,borderRadius:"50%",border:`1px solid ${T.border}`,background:T.surface,color:T.sub,fontSize:18,cursor:"pointer",flexShrink:0}}>✕</button>
                            </div>

                            <div className="sw-emp-cols" style={{display:"grid",gridTemplateColumns:"minmax(0,1.1fr) minmax(0,1fr)",gap:24,alignItems:"start"}}>
                              <div>
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
                                <div style={{marginBottom:10}}>
                                  <label htmlFor={`emp-phone-${emp.id}`} style={{fontSize:10,color:T.sub,display:"block",marginBottom:5,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>Phone Number</label>
                                  <input id={`emp-phone-${emp.id}`} type="tel" inputMode="tel" autoComplete="off" value={emp.phone||""} onChange={e=>updEmp(emp.id,{phone:e.target.value.replace(/[^0-9()+\-. ]/g,"")})} placeholder="(225) 555-0123"
                                    style={{width:"100%",border:`1.5px solid ${T.border}`,borderRadius:8,padding:"9px 11px",fontSize:14,outline:"none",background:T.surface,color:T.text}}/>
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
                                <div style={{marginBottom:14,padding:"10px 12px",background:T.accent+"10",borderRadius:10,border:`1px solid ${T.accent}25`}}>
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
                              </div>

                              <section aria-label="Exit review" style={{display:"flex",flexDirection:"column",gap:10}}>
                                <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                                  <h3 style={{margin:0,fontSize:12,fontWeight:800,letterSpacing:"0.06em",textTransform:"uppercase",color:T.sub}}>Exit review</h3>
                                  <span style={{fontSize:11.5,color:T.sub}}>Open weeks only · as of today</span>
                                </div>
                                {!emp.name ? (
                                  <div style={{fontSize:13,color:T.sub}}>Add a name to see this employee's exit review.</div>
                                ) : !ex || ex.loading ? (
                                  <div style={{fontSize:13,color:T.sub}}>Building exit review…</div>
                                ) : ex.error ? (
                                  <div style={{fontSize:13,color:T.sub}}>Couldn't build the exit review right now.</div>
                                ) : (
                                  <>
                                    {(()=>{ const P = v => v == null ? "—" : `${Math.round(v*100)}%`; const hrly = v => v == null ? "—" : `${fmtMoney(v)} / hr`; return (<>
                                    {s.basis?.kind === "season" && (
                                      <div style={{background:"#F6EEE3",border:"1px solid #E8D6BD",borderRadius:10,padding:"10px 12px",fontSize:12.5,lineHeight:1.5,color:T.text}}>{s.basis.text}</div>
                                    )}
                                    <div style={{background:T.accent+"12",border:`1px solid ${T.accent}40`,borderRadius:10,padding:"12px 14px",fontSize:13.5,lineHeight:1.5,color:T.text}}>
                                      <strong>If {(emp.name||"").split(" ")[0]} left:</strong> {s.headline.replace(/^Losing [^ ]+ costs/, "it would cost").replace(/^[^ ]+ didn't work/, "they didn't work")}
                                    </div>
                                    <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8}}>
                                      {stat("Sales per hour worked", hrly(s.salesPerHour), s.teamSalesPerHour != null ? `Team average ${fmtMoney(s.teamSalesPerHour)} / hr${s.salesEstimated !== "none" ? " · estimated" : ""}` : null)}
                                      {stat("Cost per hour worked", hrly(s.costPerHour), "Their pay")}
                                      {stat("Hours per week worked", `${(s.avgWeeklyHours||0).toFixed(1)}h`, `Across the ${s.weeksIn} week${s.weeksIn!==1?"s":""} they worked`)}
                                      {stat("Weeks worked", `${s.basis?.weeksWorked ?? s.weeksIn} of ${s.basis?.openWeeks ?? "—"}`, s.basis?.kind === "season" ? "Open weeks last season" : "Open weeks · last 12")}
                                      {stat("Late", `${s.late90} of ${s.shiftsWorked90} shifts`, `${P(s.lateRate)}${s.teamLateRate != null ? ` · team ${P(s.teamLateRate)}` : ""}`, s.lateRate != null && s.teamLateRate != null && s.lateRate > s.teamLateRate)}
                                      {stat("Early out · no-show", `${P(s.earlyOutRate)} · ${P(s.noShowRate)}`, `${s.earlyOut90} of ${s.shiftsWorked90} shifts · ${s.noShow90} of ${s.shiftsWorked90 + s.noShow90} scheduled`, s.noShow90 > 0)}
                                      {stat("Usual days", s.usualDays.length ? s.usualDays.join(", ") : "—", s.mainType ? `Mostly ${s.mainType}` : null)}
                                      {stat("Cost to replace", `${fmtMoney(s.replaceWeekly)} / wk`, `Using ${s.rateBasis}`)}
                                    </div>
                                    {s.gaps?.length > 0 && (
                                      <div style={{fontSize:12.5,color:T.text,lineHeight:1.5}}>
                                        <strong>Thin days:</strong> {s.gaps.map(g => `${g.day} (${g.names.length ? g.names.join(", ") : "no one else"} available)`).join("; ")}
                                      </div>
                                    )}
                                    <div style={{fontSize:11.5,color:T.sub}}>Rates use shifts they actually worked, so weeks they weren't scheduled don't count against them.</div>
                                    </>); })()}
                                    <div style={{fontSize:11.5,color:T.sub}}>These numbers are saved to the exit record if you offboard.</div>
                                  </>
                                )}
                              </section>
                            </div>

                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",paddingTop:16,borderTop:`1px solid ${T.border}`}}>
                              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                                <button onClick={()=>deactivateEmp(emp)} disabled={exitBusy}
                                  style={{height:44,padding:"0 16px",borderRadius:10,border:"1.5px solid #E7C4BF",background:T.surface,color:"#A93226",fontSize:14,fontWeight:700,cursor:"pointer",opacity:exitBusy?0.6:1}}>
                                  {exitBusy ? "Building exit summary…" : `Offboard ${(emp.name||"employee").split(" ")[0]}…`}
                                </button>
                                <button onClick={()=>{ if(window.confirm(`Delete ${emp.name||"this employee"} completely? Use this only for someone added by mistake — their shifts are deleted too and nothing is kept.`)) rmEmp(emp.id); }}
                                  style={{background:"none",border:"none",padding:0,color:T.sub,textDecoration:"underline",fontSize:11,cursor:"pointer",alignSelf:"flex-start"}}>
                                  Added by mistake? Delete instead
                                </button>
                              </div>
                              <div style={{display:"flex",alignItems:"center",gap:10}}>
                                <span style={{fontSize:12,color:T.sub}}>Changes save as you type</span>
                                <button onClick={close} style={{height:44,padding:"0 22px",borderRadius:10,border:"none",background:T.accent,color:"white",fontSize:14,fontWeight:700,cursor:"pointer"}}>Done</button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    {renderFormerEmployees()}
                  </div>
                )}

                {/* KIOSK */}
                {curSec==="kiosk" && (
                  <div style={{display:"flex", flexDirection:"column", gap:11}}>
                    {gf("app") && (
                    <Card T={T} style={{padding:"14px 16px"}}>
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
                    )}
                    {gf("link") && (
                    <Card T={T} style={{padding:"14px 16px"}}>
                      <SectionLabel T={T}>Your Kiosk Link</SectionLabel>
                      <p style={{margin:"0 0 12px", fontSize:12, color:T.sub, lineHeight:1.6}}>
                        Open this on the tablet, laptop, or POS device you'll use for clock-ins. Bookmark it once — employees never need to type anything but their PIN.
                      </p>
                      <div style={{background:T.muted,borderRadius:9,padding:"11px 14px",fontSize:12,color:T.text,fontFamily:"monospace",wordBreak:"break-all",marginBottom:10}}>
                        {`${window.location.origin}/kiosk?bizId=${bizId}`}
                      </div>
                      <div style={{display:"flex",gap:8}}>
                        <button onClick={()=>{
                          const url = `${window.location.origin}/kiosk?bizId=${bizId}`;
                          navigator.clipboard?.writeText(url).then(()=>showToast("Kiosk link copied ✓")).catch(()=>showToast(url, 6000));
                        }} style={{flex:1,background:"transparent",border:`1px solid ${T.border}`,borderRadius:9,padding:"11px 0",fontWeight:700,fontSize:13,color:T.text,cursor:"pointer"}}>
                          Copy Link
                        </button>
                        <button onClick={()=>window.open(`${window.location.origin}/kiosk?bizId=${bizId}`, "_blank")}
                          style={{flex:1,background:T.accent,color:"white",border:"none",borderRadius:9,padding:"11px 0",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                          Open Kiosk →
                        </button>
                      </div>
                    </Card>
                    )}
                    {gf("pins") && (
                    <Card T={T} style={{padding:"14px 16px"}}>
                      <SectionLabel T={T}>Employee Clock-In PINs</SectionLabel>
                      <p style={{margin:"0 0 12px", fontSize:12, color:T.sub, lineHeight:1.5}}>Set each employee's PIN in the Team Roster. They use it to clock in and out on the kiosk.</p>
                      <button onClick={()=>{ setSettingsSection("roster"); setSettingsFolder(null); }}
                        style={{background:T.accent,color:"white",border:"none",borderRadius:9,padding:"11px 0",fontWeight:700,fontSize:13,cursor:"pointer",width:"100%"}}>
                        Go to Team Roster →
                      </button>
                    </Card>
                    )}
                  </div>
                )}

                {/* AUDIT LOG */}
                {curSec==="audit" && (
                  <div style={{display:"flex",flexDirection:"column",gap:11}}>
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
                            <div key={entry.id} style={{display:"flex",gap:12,padding:"10px 14px",borderBottom:i<auditLog.length-1?`1px solid ${T.border}`:"none",alignItems:"flex-start"}}>
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
                {curSec==="print" && (()=>{
                  const wk = weeks.find(w=>w.key===printWeek) || weeks[0];
                  const wkDates = wk.dates.map(d => { const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return dt; });
                  const wkTH = employees.reduce((s,e)=>s+eWkH(wk.key,e.id),0);
                  const scheduledEmps = employees.filter(e => eWkH(wk.key,e.id) > 0);

                  return (
                    <div style={{background:"#F4F5F2",margin:"-16px",padding:"16px",minHeight:"100%"}}>
                      {/* Controls bar */}
                      <Card T={T} style={{padding:"13px 16px",marginBottom:16,overflow:"visible"}}>
                        <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-end"}}>
                          {/* Week picker */}
                          <div>
                            <label style={{fontSize:10,fontWeight:700,color:T.sub,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Schedule Week</label>
                            <div className="sw-datebar" style={{display:"inline-flex",alignItems:"center",gap:6,background:T.muted,border:`1px solid ${T.border}`,borderRadius:12,padding:4,boxShadow:"inset 0 1px 0 rgba(255,255,255,0.6)"}}>
                              <button onClick={()=>setPrintWeek(getSunday(addDays(printWeek,-7)))}
                                style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,width:34,height:36,fontSize:16,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,flexShrink:0}}>‹</button>
                              <div style={{display:"flex",alignItems:"center",borderRadius:9,overflow:"hidden",border:`2px solid ${T.accent}`,boxShadow:`0 0 0 2px ${T.accent}28`}}>
                                <div style={{background:T.accent,color:"white",padding:"8px 16px",fontWeight:700,fontSize:12,whiteSpace:"nowrap",display:"flex",alignItems:"center",justifyContent:"center",gap:6,minWidth:170,boxSizing:"border-box",fontVariantNumeric:"tabular-nums"}}>
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
                                style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,width:34,height:36,fontSize:16,cursor:"pointer",color:T.sub,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,flexShrink:0}}>›</button>
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
                          <table style={{width:"100%",borderCollapse:"collapse",tableLayout:"fixed",fontSize:11}}>
                            <colgroup>
                              <col style={{width:"16%"}}/>
                              {DAYS.map(d=><col key={d} style={{width:"11%"}}/>)}
                              <col style={{width:"7%"}}/>
                            </colgroup>
                            <thead>
                              <tr style={{background:"#1C1C1C"}}>
                                <th style={{padding:"10px 10px",color:"white",textAlign:"left",fontWeight:800,fontSize:11,letterSpacing:"0.05em",textTransform:"uppercase"}}>Employee</th>
                                {DAYS.map((d,i)=>(
                                  <th key={d} style={{padding:"8px 4px",color:"white",textAlign:"center",fontWeight:700,fontSize:11,borderLeft:"1px solid #333"}}>
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
                                    <td style={{padding:"10px 10px",borderRight:"2px solid #E8E4DF",verticalAlign:"middle"}}>
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
                                        <td key={di} style={{padding:"6px 4px",textAlign:"center",borderLeft:"1px solid #E8E4DF",verticalAlign:"middle",background:isOff?"#F8F6F3":shift?st.color+"0D":"white"}}>
                                          {shift ? (
                                            <div>
                                              <div style={{fontSize:11,fontWeight:900,color:"#1C1C1C",lineHeight:1.2}}>{fmt(shift.start)}</div>
                                              <div style={{fontSize:10,color:"#555",margin:"1px 0",fontWeight:600}}>to {fmt(shift.end)}</div>
                                              <div style={{display:"inline-block",background:st.color,color:"white",borderRadius:3,padding:"1px 4px",fontSize:8,fontWeight:800,letterSpacing:"0.03em",textTransform:"uppercase"}}>{st.label}</div>
                                              <div style={{fontSize:10,fontWeight:700,color:"#1C1C1C",marginTop:2}}>{h}h</div>
                                            </div>
                                          ) : isOff ? (
                                            <div style={{fontSize:10,color:"#CCC"}}>—</div>
                                          ) : (
                                            <div style={{fontSize:10,color:"#DDD"}}>Off</div>
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
                                <td style={{padding:"10px 14px",fontWeight:800,fontSize:12,color:"#1C1C1C",textTransform:"uppercase",letterSpacing:"0.05em"}}>Daily Total</td>
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
                                  <div style={{background:emp.color,padding:"10px 15px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
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
                                    <div style={{padding:"13px 16px",color:"#999",fontSize:13,fontStyle:"italic",textAlign:"center"}}>Not scheduled this week</div>
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
                {curSec==="data" && (
                  <div style={{display:"flex", flexDirection:"column", gap:11}}>
                    {gf("sales") && (
                    <Card T={T} style={{padding:"14px 16px"}}>
                      <SectionLabel T={T}>Sales Data</SectionLabel>
                      {squareConnected ? (
                        <div style={{fontSize:12, color:T.sub, lineHeight:1.5, marginBottom:8}}>
                          <div style={{fontWeight:700, color:T.text}}>Square connected{squareMerchantName ? ` · ${squareMerchantName}` : ""}</div>
                          <div>Last synced {squareLastSync ? new Date(squareLastSync).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) : "never"}</div>
                        </div>
                      ) : (
                        <p style={{margin:"0 0 10px", fontSize:12, color:T.sub, lineHeight:1.5}}>Connect Square to pull in sales automatically, or import a Square CSV.</p>
                      )}
                      <div style={{fontSize:12, color:T.sub, marginBottom:10}}>{salesData.length ? `${salesData.length} days of sales · ${dl(salesData[0].date)} – ${dl(salesData[salesData.length-1].date)}` : "No sales history yet."}</div>
                      <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
                        {squareConnected ? (
                          <>
                            <button onClick={handleSyncSquare} disabled={squareSyncing} style={{background:T.accent,color:"white",border:"none",borderRadius:9,padding:"9px 14px",fontWeight:700,fontSize:12,cursor:"pointer",opacity:squareSyncing?0.6:1}}>{squareSyncing ? "Syncing…" : "Sync Square"}</button>
                            <button onClick={handleDisconnectSquare} style={{background:T.surface,color:T.sub,border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 14px",fontWeight:700,fontSize:12,cursor:"pointer"}}>Disconnect</button>
                          </>
                        ) : (
                          <button onClick={handleConnectSquare} disabled={squareLoading} style={{background:T.accent,color:"white",border:"none",borderRadius:9,padding:"9px 14px",fontWeight:700,fontSize:12,cursor:"pointer"}}>Connect Square</button>
                        )}
                        <label style={{background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 14px",fontWeight:700,fontSize:12,cursor:"pointer",display:"inline-flex",alignItems:"center"}}>
                          Import CSV<input type="file" accept=".csv" onChange={e=>{ importSquareCSV(e.target.files[0]); e.target.value=""; }} style={{display:"none"}}/>
                        </label>
                        {salesData.length > 0 && (
                          <button onClick={()=>{ if (window.confirm("Clear all imported Square sales data? Cash entries are kept.")) { setRawSales(p=>p.filter(r=>r.source==="cash")); if (bizId) dbDelete(`sales_data?business_id=eq.${bizId}&source=eq.square`).catch(e=>showError(friendlyError(e,"Couldn't clear that data — try again."))); } }}
                            style={{background:T.surface,color:T.sub,border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 14px",fontWeight:700,fontSize:12,cursor:"pointer"}}>Clear Data</button>
                        )}
                      </div>
                    </Card>
                    )}
                    {gf("backups") && (
                    <Card T={T} style={{padding:"14px 16px"}}>
                      <SectionLabel T={T}>Auto-Save</SectionLabel>
                      <p style={{margin:"0 0 10px", fontSize:12, color:T.sub, lineHeight:1.5}}>ShiftWise automatically saves everything to this device every time you make a change.</p>
                      <div style={{padding:"10px 14px",background:T.accent+"14",border:`1px solid ${T.accent}28`,borderRadius:9,fontSize:12,color:T.text,fontWeight:600,display:"flex",alignItems:"center",gap:8}}>
                        <span style={{color:T.accent}}>✓</span>
                        {bizId ? "All data synced to Supabase ✓" : "Not connected to database"}
                      </div>
                    </Card>
                    )}
                    {gf("backups") && (
                    <Card T={T} style={{padding:"14px 16px"}}>
                      <SectionLabel T={T}>Export Backup</SectionLabel>
                      <p style={{margin:"0 0 12px", fontSize:12, color:T.sub, lineHeight:1.5}}>Download all your data as a single file. Use it to move ShiftWise to another device.</p>
                      <button onClick={exportData} style={{width:"100%",background:T.dark,color:"white",border:"none",borderRadius:9,padding:"12px 0",fontWeight:700,fontSize:13,cursor:"pointer"}}>Export Backup (.json)</button>
                    </Card>
                    )}
                    {gf("backups") && (
                    <Card T={T} style={{padding:"14px 16px"}}>
                      <SectionLabel T={T}>Import Backup</SectionLabel>
                      <p style={{margin:"0 0 12px", fontSize:12, color:T.sub, lineHeight:1.5}}>Restore from a previously exported file. Your current data will be replaced.</p>
                      <label style={{display:"block",width:"100%",background:"#EBF5FF",color:"#3A9BE8",border:"1.5px solid #3A9BE830",borderRadius:9,padding:"12px 0",fontWeight:700,fontSize:13,cursor:"pointer",textAlign:"center"}}>
                        Import Backup File
                        <input type="file" accept=".json" onChange={e=>{importData(e.target.files[0]);e.target.value="";}} style={{display:"none"}}/>
                      </label>
                    </Card>
                    )}
                    {gf("clear") && (
                    <Card T={T} style={{padding:"14px 16px"}}>
                      <SectionLabel T={T}>Clear All Data</SectionLabel>
                      <p style={{margin:"0 0 12px", fontSize:12, color:T.sub, lineHeight:1.5}}>Permanently removes all schedules, employees, settings, and history from this device.</p>
                      <button onClick={()=>{ if(window.confirm("Sign out and clear local session? Your cloud data is safe.")) { handleSignOut(); } }}
                        style={{background:"#FDECEA",color:"#C0392B",border:"1px solid #C0392B22",borderRadius:9,padding:"11px 18px",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                        Clear All Data
                      </button>
                    </Card>
                    )}
                  </div>
                )}
                  </section>
                </div>
              </div>
            );
          })()}
        </div>

{/* 🔔 ALERTS DRAWER */}
{alertsOpen&&(
  <>
    <div onClick={()=>setAlertsOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:600}}/>
    <div style={{position:"fixed",top:0,right:0,bottom:0,width:"min(420px,100vw)",background:T.bg,zIndex:700,display:"flex",flexDirection:"column",boxShadow:"-8px 0 40px rgba(0,0,0,0.18)",overflow:"hidden"}}>
      <div style={{background:T.dark,padding:"13px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div>
          <div style={{color:"white",fontWeight:800,fontSize:16}}>🔔 Alerts</div>
          <div style={{color:"#666",fontSize:11,marginTop:2}}>Punch flags · Pulse reminders</div>
        </div>
        <button onClick={()=>setAlertsOpen(false)} style={{background:"rgba(255,255,255,0.1)",border:"none",borderRadius:"50%",width:34,height:34,color:"white",fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
      </div>

      {(()=>{
        const ACTIONABLE_FLAGS = ["NO_SHIFT","ADJUSTMENT"];
        const drawerNow = isDemoBiz ? new Date(DEMO_TODAY_ANCHOR+"T12:00:00") : new Date();
        const thirtyDaysAgo = new Date(drawerNow - 30*24*60*60*1000);
        const flagged = punches.filter(p=>
          p.flags?.some(f=>ACTIONABLE_FLAGS.includes(f)) &&
          new Date(p.time) > thirtyDaysAgo &&
          employees.some(e=>e.id===p.empId) &&
          !punchReviews[p.id] // hide already-actioned punches
        ).sort((a,b)=>new Date(b.time)-new Date(a.time));
        if (flagged.length===0) return (
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32,textAlign:"center",color:T.sub}}>
            <div style={{fontSize:40,marginBottom:12}}>✅</div>
            <div style={{fontWeight:700,fontSize:15,color:"#888",marginBottom:8}}>No flagged punches</div>
            <div style={{fontSize:13,lineHeight:1.5}}>Punch flags and Pulse reminders will appear here. Only NO_SHIFT and manual adjustment punches from the last 30 days are shown.</div>
          </div>
        );
        const FLAG_LABELS = { NO_SHIFT:"No Shift", LATE:"Late Clock-In", EARLY_OUT:"Left Early", ADJUSTMENT:"Manual Entry" };
        const FLAG_COLORS = { NO_SHIFT:"#C0392B", LATE:"#E8A93A", EARLY_OUT:"#E07020", ADJUSTMENT:"#3A9BE8" };
        const FLAG_ICONS  = { NO_SHIFT:"🔴", LATE:"🟡", EARLY_OUT:"🟠", ADJUSTMENT:"🔵" };
        return (
          <div style={{flex:1,minHeight:0,overflowY:"auto",padding:14,display:"flex",flexDirection:"column",gap:10}}>
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
                    }).catch(e=>{ console.warn("punch_reviews insert failed:", e); showError(friendlyError(e, "Some review updates may not have saved — refresh to check.")); });
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
                <div key={p.id} style={{background:T.surface,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden",border:`1px solid ${status==="pending"?"#E8A93A30":T.border}`,borderLeft:`4px solid ${FLAG_COLORS[p.flags?.find(f=>FLAG_COLORS[f])]||"#E8A93A"}`}}>
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
                            {FLAG_ICONS[f]||""} {FLAG_LABELS[f]||f}
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
                          }).catch(e=>{ console.warn("punch_reviews insert failed:", e); showError(friendlyError(e, "Couldn't save that review status — try again.")); });
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
              <div style={{background:T.dark,padding:"13px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
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
                      <div style={{padding:"11px 14px"}}>
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
              padding:"11px 14px",
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
        {tab==="feedback" && !isDemoBiz && <FeedbackTab bizId={bizId} T={T} Card={Card} showToast={showToast} showError={showError} friendlyError={friendlyError} addAudit={addAudit} getSession={getSession} dbPost={dbPost}/>}

                <TimePickerShell/>

        {/* PULSE READY MODAL */}
        {pulsePrompt && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1200,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
            <div style={{background:T.surface,borderRadius:20,width:"100%",maxWidth:400,boxShadow:"0 20px 60px rgba(0,0,0,0.3)",overflow:"hidden"}}>
              {/* Header */}
              <div style={{background:T.dark,padding:"20px 24px",textAlign:"center"}}>
                <div style={{fontSize:40,marginBottom:8}}>🧠</div>
                <div style={{color:"white",fontWeight:800,fontSize:18,marginBottom:4}}>Your Weekly Pulse is Ready</div>
                <div style={{color:"#888",fontSize:12,lineHeight:1.5}}>Get your weekly scheduling analysis — labor costs, attendance patterns, and what to focus on next week.</div>
              </div>
              {/* Body */}
              <div style={{padding:"20px 24px",display:"flex",flexDirection:"column",gap:10}}>
                <button onClick={()=>{ setPulsePrompt(false); setTab("insights"); setTimeout(()=>generateInsight(true),100); }}
                  style={{background:T.accent,color:"white",border:"none",borderRadius:12,padding:"14px 0",fontWeight:800,fontSize:15,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                  <span>🧠</span> Generate My Pulse Now
                </button>
                <button onClick={()=>{ setPulsePrompt(false); setTab("insights"); }}
                  style={{background:T.muted,color:T.sub,border:`1px solid ${T.border}`,borderRadius:12,padding:"12px 0",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                  Go to Insights →
                </button>
                <button onClick={()=>setPulsePrompt(false)}
                  style={{background:"transparent",color:T.sub,border:"none",fontSize:12,cursor:"pointer",padding:"4px 0"}}>
                  Remind me later
                </button>
              </div>
            </div>
          </div>
        )}

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
          <div style={{position:"fixed",bottom:"calc(72px + env(safe-area-inset-bottom, 0px))",left:"50%",transform:"translateX(-50%)",background:toast.type==="error"?"#3B1414":T.dark,color:"white",border:toast.type==="error"?"1px solid rgba(248,113,113,0.4)":"none",borderRadius:12,padding:"12px 22px",fontSize:13,fontWeight:600,boxShadow:"0 8px 32px rgba(0,0,0,0.3)",zIndex:999,whiteSpace:"normal",textAlign:"left",display:"flex",alignItems:"center",gap:8,maxWidth:"calc(100vw - 32px)",animation:"fadeup 0.2s ease"}}>
            <span style={{color:toast.type==="error"?"#F87171":T.accent,fontSize:16,flexShrink:0}}>{toast.type==="error"?"⚠":"✓"}</span> {toast.msg}
          </div>
        )}
        <style>{`@keyframes fadeup{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}} @keyframes ticker{0%{transform:translateX(100vw)}100%{transform:translateX(-100%)}} .ticker-wrap{overflow:hidden;width:100%;} .ticker-track{display:inline-block;white-space:nowrap;animation:ticker 24s linear infinite;} .ticker-track:hover{animation-play-state:paused;}`}</style>
    </div>
  );
}