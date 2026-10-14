// /api/nightly.js
// Runs once a night via Vercel Cron (see vercel.json). One endpoint for all
// nightly work so the project stays within the Hobby plan's cron limit.
//
// Job 1 — No-shows: for every real (non-demo) business, find shifts from the
// last 2 days that ended with no clock-in and save a NO_SHOW record to
// attendance_events. Saved once (re-runs never duplicate). The owner can
// mark any of them "excused" in the app.
//
// Job 2 — Weather: for every business with an address, record yesterday's
// weather (condition, high/low °F, rain) to daily_weather. The address is
// looked up once (US Census geocoder), its nearest National Weather Service
// station cached, then reused. Both services are free and need no key.
//
// Security: only Vercel Cron (which sends CRON_SECRET) can call this.

export const config = { maxDuration: 60 };

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kyrjgfeowmflazywsuir.supabase.co";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET;
const TZ = "America/Chicago"; // ShiftWise operates in Central Time

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET ${path.split("?")[0]} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Central-time date helpers ──────────────────────────────────────────────
const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function centralParts(ms) {
  const p = {};
  partsFmt.formatToParts(new Date(ms)).forEach(({ type, value }) => { p[type] = value; });
  return p;
}
function centralDateStr(ms) {
  const p = centralParts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}
// Central wall-clock time → real instant (ms)
function centralWallToUtc(y, mo, d, h, mi, s = 0) {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  const p = centralParts(naive);
  const wallOfNaive = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return naive - (wallOfNaive - naive);
}
function addDaysStr(ds, n) {
  const [y, m, d] = ds.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n, 12));
  return t.toISOString().slice(0, 10);
}
function sundayOf(ds) {
  const [y, m, d] = ds.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return addDaysStr(ds, -dow);
}

// Punch times may be stored either as UTC or as Central wall-clock time
// (kiosk punches and manual edits have historically differed). To never mark
// someone a no-show because of how a time was stored, a punch counts if
// EITHER reading of it lands inside the shift window.
function punchInstants(raw) {
  if (!raw) return [];
  const s = String(raw).replace(" ", "T");
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(s)) return [Date.parse(s)];
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return [];
  const [, y, mo, d, h, mi, sec] = m.map(Number);
  return [Date.UTC(y, mo - 1, d, h, mi, sec || 0), centralWallToUtc(y, mo, d, h, mi, sec || 0)];
}

const EARLY_WINDOW_MS = 3 * 60 * 60 * 1000; // clock-in up to 3h before the shift counts
const LATE_WINDOW_MS  = 1 * 60 * 60 * 1000; // ...or up to 1h after it ended

async function sweepNoShows(business, dates) {
  const bizId = business.id;
  const employees = (await sbGet(`employees?select=id,name,status&business_id=eq.${bizId}`))
    .filter(e => e.status !== "inactive");
  if (!employees.length) return 0;
  const empById = Object.fromEntries(employees.map(e => [e.id, e]));

  const weekStarts = [...new Set(dates.map(sundayOf))];
  const weeks = await sbGet(`schedule_weeks?select=id,week_start&business_id=eq.${bizId}&week_start=in.(${weekStarts.join(",")})`);
  if (!weeks.length) return 0;
  const weekIdByStart = Object.fromEntries(weeks.map(w => [w.week_start, w.id]));
  const shifts = await sbGet(`shifts?select=week_id,employee_id,day_index,start_dec,end_dec&week_id=in.(${weeks.map(w => w.id).join(",")})`);

  // Shifts the owner already marked open (a call-out) are not no-shows
  let openKeys = new Set();
  try {
    const open = await sbGet(`open_shifts?select=week_id,employee_id,day_index,status&business_id=eq.${bizId}&status=neq.cancelled`);
    openKeys = new Set(open.map(o => `${o.week_id}|${o.employee_id}|${o.day_index}`));
  } catch { /* table missing or empty — nothing to skip */ }

  const from = addDaysStr(dates[0], -1), to = addDaysStr(dates[dates.length - 1], 2);
  const punches = await sbGet(`punches?select=employee_id,punch_type,punched_at&business_id=eq.${bizId}&punch_type=in.(in,break_in)&punched_at=gte.${from}&punched_at=lt.${to}&limit=5000`);
  const punchesByEmp = {};
  punches.forEach(p => { (punchesByEmp[p.employee_id] ||= []).push(...punchInstants(p.punched_at)); });

  const rows = [];
  const now = Date.now();
  for (const date of dates) {
    const weekId = weekIdByStart[sundayOf(date)];
    if (!weekId) continue;
    const [y, m, d] = date.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
    for (const sh of shifts) {
      if (sh.week_id !== weekId || sh.day_index !== dow) continue;
      const emp = empById[sh.employee_id];
      if (!emp) continue;
      if (openKeys.has(`${weekId}|${sh.employee_id}|${dow}`)) continue;
      const startDec = parseFloat(sh.start_dec), endDec = parseFloat(sh.end_dec);
      const startMs = centralWallToUtc(y, m, d, Math.floor(startDec), Math.round((startDec % 1) * 60));
      const endMs   = centralWallToUtc(y, m, d, Math.floor(endDec),   Math.round((endDec % 1) * 60));
      if (endMs + LATE_WINDOW_MS > now) continue; // shift hasn't fully passed yet
      const showedUp = (punchesByEmp[sh.employee_id] || [])
        .some(t => t >= startMs - EARLY_WINDOW_MS && t <= endMs + LATE_WINDOW_MS);
      if (showedUp) continue;
      rows.push({
        business_id: bizId, employee_id: sh.employee_id, employee_name: emp.name || null,
        event_date: date, event_type: "NO_SHOW", shift_start: startDec, shift_end: endDec, status: "open",
      });
    }
  }
  if (!rows.length) return 0;
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/attendance_events?on_conflict=business_id,employee_id,event_date,event_type`, {
    method: "POST",
    headers: { ...HEADERS, Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!ins.ok) throw new Error(`attendance_events insert failed: ${ins.status} ${await ins.text()}`);
  return rows.length;
}

// ── Weather ────────────────────────────────────────────────────────────────
const NWS_HEADERS = {
  "User-Agent": process.env.NWS_USER_AGENT || "ShiftWise weather (shiftwise-ten.vercel.app)",
  "Accept": "application/geo+json",
};
async function sbPatch(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: "PATCH", headers: { ...HEADERS, Prefer: "return=minimal" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH ${path.split("?")[0]} failed: ${r.status} ${await r.text()}`);
}

async function ensureStation(b) {
  if (b.weather_station && b.latitude != null) return b;
  let lat = b.latitude, lon = b.longitude;
  if (lat == null || lon == null) {
    const one = [b.address_line, b.city, [b.state, b.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const g = await fetch(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(one)}&benchmark=Public_AR_Current&format=json`);
    const gj = g.ok ? await g.json() : null;
    const m = gj?.result?.addressMatches?.[0]?.coordinates;
    if (!m) { await sbPatch(`businesses?id=eq.${b.id}`, { geocode_status: "not_found" }); return null; }
    lat = Number(m.y.toFixed(4)); lon = Number(m.x.toFixed(4));
  }
  const pt = await fetch(`https://api.weather.gov/points/${lat},${lon}`, { headers: NWS_HEADERS });
  if (!pt.ok) throw new Error(`NWS points ${pt.status}`);
  const stationsUrl = (await pt.json())?.properties?.observationStations;
  const st = stationsUrl ? await fetch(stationsUrl, { headers: NWS_HEADERS }) : null;
  const station = st && st.ok ? (await st.json())?.features?.[0]?.properties?.stationIdentifier : null;
  if (!station) throw new Error("No NWS station near this address");
  await sbPatch(`businesses?id=eq.${b.id}`, { latitude: lat, longitude: lon, weather_station: station, geocode_status: "ok" });
  return { ...b, latitude: lat, longitude: lon, weather_station: station };
}

// Classify one observation's description
function classify(desc, precipMm) {
  const d = (desc || "").toLowerCase();
  if (/thunder|t-storm|tstorm/.test(d)) return "storm";
  if (/snow|sleet|ice|freezing/.test(d)) return "snowy";
  if (/rain|drizzle|shower/.test(d) || (precipMm != null && precipMm >= 0.5)) return "rainy";
  if (/cloudy|overcast|fog|mist|haze/.test(d) && !/partly/.test(d)) return "cloudy";
  if (d) return "sunny";
  return null;
}
const SEVERITY = { storm: 4, snowy: 3, rainy: 2, cloudy: 1, sunny: 0 };
const WORD = { sunny: "sunny", cloudy: "cloudy", rainy: "rain", storm: "storms", snowy: "snow" };
const hourLabel = h => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;

// The day's main word (judged on 7 AM – 9 PM), an hourly breakdown, and a
// plain-English timeline when conditions changed during the day.
function summarizeWeather(obs, startMs) {
  let hi = null, lo = null, precipMm = 0;
  const byHour = {}; // hour -> { c, t }
  for (const f of obs) {
    const p = f.properties || {};
    const t = p.temperature?.value; // °C
    if (t != null) { hi = hi == null ? t : Math.max(hi, t); lo = lo == null ? t : Math.min(lo, t); }
    const pr = p.precipitationLastHour?.value;
    if (pr != null) precipMm += pr;
    const ts = Date.parse(p.timestamp);
    if (!(ts >= startMs && ts < startMs + 24 * 3600000)) continue;
    const hour = Math.floor((ts - startMs) / 3600000); // Central hour (DST days are off by an hour at most)
    const c = classify(p.textDescription, pr);
    if (!c) continue;
    const cur = byHour[hour];
    // Keep the most severe condition seen in that hour
    if (!cur || SEVERITY[c] > SEVERITY[cur.c]) byHour[hour] = { c, t: t == null ? cur?.t ?? null : t };
  }
  const toF = c => c == null ? null : Math.round(c * 9 / 5 + 32);
  const hourly = Object.keys(byHour).map(Number).sort((a, b) => a - b)
    .map(h => ({ h, c: byHour[h].c, t: toF(byHour[h].t) }));

  const day = hourly.filter(x => x.h >= 7 && x.h <= 21);
  const counts = {}; day.forEach(x => { counts[x.c] = (counts[x.c] || 0) + 1; });
  const precipIn = precipMm / 25.4;
  let condition = "sunny";
  if (counts.storm) condition = "storm";
  else if (counts.snowy) condition = "snowy";
  else if ((counts.rainy || 0) >= 2 || precipIn >= 0.1) condition = "rainy";
  else if (day.length && (counts.cloudy || 0) / day.length >= 0.5) condition = "cloudy";

  // Timeline over business-ish hours: merge runs; ignore single-hour blips
  // unless they're rain/storm/snow (those matter even if brief).
  const runs = [];
  day.forEach(x => {
    const last = runs[runs.length - 1];
    if (last && last.c === x.c) last.to = x.h;
    else runs.push({ c: x.c, from: x.h, to: x.h });
  });
  const kept = runs.filter(r => r.to > r.from || SEVERITY[r.c] >= 2);
  const merged = [];
  kept.forEach(r => {
    const last = merged[merged.length - 1];
    if (last && last.c === r.c) last.to = r.to; else merged.push({ ...r });
  });
  let timeline = null;
  if (merged.length > 1) {
    timeline = merged.map((r, i) => {
      const w = WORD[r.c];
      const cap = i === 0 ? w[0].toUpperCase() + w.slice(1) : w;
      if (i === 0) return `${cap} until ${hourLabel(merged[1].from)}`;
      if (i === merged.length - 1) return `then ${w}`;
      return `then ${w} until ${hourLabel(merged[i + 1].from)}`;
    }).join(", ");
  }
  return { condition, high_f: toF(hi), low_f: toF(lo), precip_in: Math.round(precipIn * 100) / 100, observations: obs.length, hourly, timeline };
}

async function recordWeather(withStation, date) {
  const b = withStation;
  const have = await sbGet(`daily_weather?select=weather_date&business_id=eq.${b.id}&weather_date=eq.${date}&limit=1`);
  if (have.length) return 0;
  const [y, m, d] = date.split("-").map(Number);
  const startMs = centralWallToUtc(y, m, d, 0, 0);
  const endMs = startMs + 24 * 3600000;
  const url = `https://api.weather.gov/stations/${withStation.weather_station}/observations?start=${new Date(startMs).toISOString()}&end=${new Date(endMs).toISOString()}`;
  const r = await fetch(url, { headers: NWS_HEADERS });
  if (!r.ok) throw new Error(`NWS observations ${r.status}`);
  const obs = (await r.json())?.features || [];
  if (!obs.length) return 0; // station had no data; try again tomorrow (2-day window)
  const w = summarizeWeather(obs, startMs);
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/daily_weather?on_conflict=business_id,weather_date`, {
    method: "POST",
    headers: { ...HEADERS, Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify([{ business_id: b.id, weather_date: date, ...w, station: withStation.weather_station, source: "nws" }]),
  });
  if (!ins.ok) throw new Error(`daily_weather insert failed: ${ins.status} ${await ins.text()}`);
  return 1;
}

export default async function handler(req, res) {
  if (!CRON_SECRET || req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!SERVICE_KEY) return res.status(500).json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY" });

  const today = centralDateStr(Date.now());
  const dates = [addDaysStr(today, -2), addDaysStr(today, -1)]; // re-checking 2 days covers a missed night
  const summary = { dates, businesses: 0, noShowsChecked: 0, weatherDays: 0, errors: [] };

  try {
    const businesses = (await sbGet(`businesses?select=*`)).filter(b => !b.is_demo);
    summary.businesses = businesses.length;
    for (const b of businesses) {
      try { summary.noShowsChecked += await sweepNoShows(b, dates); }
      catch (e) { summary.errors.push({ business_id: b.id, job: "no_show", error: String(e.message || e) }); }
      if ((b.address_line || b.zip) && b.geocode_status !== "not_found") {
        try {
          const wb = await ensureStation(b); // address lookup + station, cached after the first night
          if (wb) for (const d of dates) summary.weatherDays += await recordWeather(wb, d);
        }
        catch (e) { summary.errors.push({ business_id: b.id, job: "weather", error: String(e.message || e) }); }
      }
    }
  } catch (e) {
    return res.status(500).json({ ...summary, error: String(e.message || e) });
  }
  return res.status(200).json(summary);
}
