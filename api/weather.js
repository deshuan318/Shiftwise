// /api/weather.js
// Called by the app when it opens and right after the business address is saved.
// For the signed-in owner's business it:
//   1. Finds the nearest National Weather Service station (cached on the business row)
//   2. Fills any of the last 7 days missing from daily_weather (NWS keeps ~7 days of history)
//   3. Returns current conditions + hourly and daily forecast for the header weather widget
// The nightly cron still runs; this just means tracking never depends on it alone.

export const config = { maxDuration: 30 };

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kyrjgfeowmflazywsuir.supabase.co";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TZ = "America/Chicago";
const BACKFILL_DAYS = 7;

const HEADERS = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
const NWS_HEADERS = {
  "User-Agent": process.env.NWS_USER_AGENT || "ShiftWise weather (shiftwise-ten.vercel.app)",
  "Accept": "application/geo+json",
};

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`GET ${path.split("?")[0]} failed: ${r.status} ${await r.text()}`);
  return r.json();
}
async function sbPatch(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: "PATCH", headers: { ...HEADERS, Prefer: "return=minimal" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH ${path.split("?")[0]} failed: ${r.status} ${await r.text()}`);
}

// ── Central-time date helpers (same as nightly.js) ─────────────────────────
const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function centralParts(ms) { const p = {}; partsFmt.formatToParts(new Date(ms)).forEach(({ type, value }) => { p[type] = value; }); return p; }
function centralDateStr(ms) { const p = centralParts(ms); return `${p.year}-${p.month}-${p.day}`; }
function centralWallToUtc(y, mo, d, h, mi, s = 0) {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  const p = centralParts(naive);
  const wallOfNaive = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return naive - (wallOfNaive - naive);
}
function addDaysStr(ds, n) { const [y, m, d] = ds.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10); }

// ── Station lookup (same as nightly.js) ────────────────────────────────────
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

// ── Daily summary (same rules as nightly.js) ───────────────────────────────
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
const toF = c => c == null ? null : Math.round(c * 9 / 5 + 32);

function summarizeWeather(obs, startMs) {
  let hi = null, lo = null, precipMm = 0;
  const byHour = {};
  for (const f of obs) {
    const p = f.properties || {};
    const t = p.temperature?.value;
    if (t != null) { hi = hi == null ? t : Math.max(hi, t); lo = lo == null ? t : Math.min(lo, t); }
    const pr = p.precipitationLastHour?.value;
    if (pr != null) precipMm += pr;
    const ts = Date.parse(p.timestamp);
    if (!(ts >= startMs && ts < startMs + 24 * 3600000)) continue;
    const hour = Math.floor((ts - startMs) / 3600000);
    const c = classify(p.textDescription, pr);
    if (!c) continue;
    const cur = byHour[hour];
    if (!cur || SEVERITY[c] > SEVERITY[cur.c]) byHour[hour] = { c, t: t == null ? cur?.t ?? null : t };
  }
  const hourly = Object.keys(byHour).map(Number).sort((a, b) => a - b).map(h => ({ h, c: byHour[h].c, t: toF(byHour[h].t) }));
  const day = hourly.filter(x => x.h >= 7 && x.h <= 21);
  const counts = {}; day.forEach(x => { counts[x.c] = (counts[x.c] || 0) + 1; });
  const precipIn = precipMm / 25.4;
  let condition = "sunny";
  if (counts.storm) condition = "storm";
  else if (counts.snowy) condition = "snowy";
  else if ((counts.rainy || 0) >= 2 || precipIn >= 0.1) condition = "rainy";
  else if (day.length && (counts.cloudy || 0) / day.length >= 0.5) condition = "cloudy";
  const runs = [];
  day.forEach(x => { const last = runs[runs.length - 1]; if (last && last.c === x.c) last.to = x.h; else runs.push({ c: x.c, from: x.h, to: x.h }); });
  const kept = runs.filter(r => r.to > r.from || SEVERITY[r.c] >= 2);
  const merged = [];
  kept.forEach(r => { const last = merged[merged.length - 1]; if (last && last.c === r.c) last.to = r.to; else merged.push({ ...r }); });
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

async function recordDay(b, date) {
  const [y, m, d] = date.split("-").map(Number);
  const startMs = centralWallToUtc(y, m, d, 0, 0);
  const endMs = startMs + 24 * 3600000;
  const r = await fetch(`https://api.weather.gov/stations/${b.weather_station}/observations?start=${new Date(startMs).toISOString()}&end=${new Date(endMs).toISOString()}`, { headers: NWS_HEADERS });
  if (!r.ok) throw new Error(`NWS observations ${r.status}`);
  const obs = (await r.json())?.features || [];
  if (!obs.length) return 0;
  const w = summarizeWeather(obs, startMs);
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/daily_weather?on_conflict=business_id,weather_date`, {
    method: "POST",
    headers: { ...HEADERS, Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify([{ business_id: b.id, weather_date: date, ...w, station: b.weather_station, source: "nws" }]),
  });
  if (!ins.ok) throw new Error(`daily_weather insert failed: ${ins.status} ${await ins.text()}`);
  return 1;
}

// ── Current conditions + forecast for the widget ───────────────────────────
async function getNow(b) {
  const out = { current: null, hourly: [], daily: [] };
  const [latest, pt] = await Promise.all([
    fetch(`https://api.weather.gov/stations/${b.weather_station}/observations/latest`, { headers: NWS_HEADERS }),
    fetch(`https://api.weather.gov/points/${b.latitude},${b.longitude}`, { headers: NWS_HEADERS }),
  ]);
  if (latest.ok) {
    const p = (await latest.json())?.properties || {};
    out.current = { tempF: toF(p.temperature?.value), text: p.textDescription || null, condition: classify(p.textDescription, null), at: p.timestamp || null };
  }
  if (pt.ok) {
    const props = (await pt.json())?.properties || {};
    out.place = [props.relativeLocation?.properties?.city, props.relativeLocation?.properties?.state].filter(Boolean).join(", ") || null;
    const [fh, fd] = await Promise.all([
      props.forecastHourly ? fetch(props.forecastHourly, { headers: NWS_HEADERS }) : null,
      props.forecast ? fetch(props.forecast, { headers: NWS_HEADERS }) : null,
    ]);
    if (fh && fh.ok) {
      out.hourly = ((await fh.json())?.properties?.periods || []).slice(0, 8).map(p => ({
        time: p.startTime, tempF: p.temperature, condition: classify(p.shortForecast, null), text: p.shortForecast,
        isDay: p.isDaytime, pop: p.probabilityOfPrecipitation?.value ?? null,
      }));
      if (out.current && out.hourly[0]) out.current.isDay = out.hourly[0].isDay;
    }
    if (fd && fd.ok) {
      // NWS gives day/night halves — pair them into one row per day
      const periods = (await fd.json())?.properties?.periods || [];
      const days = [];
      for (const p of periods) {
        const date = p.startTime.slice(0, 10);
        let row = days.find(x => x.date === date);
        if (!row) { row = { date, name: p.isDaytime ? p.name : null, highF: null, lowF: null, condition: null, text: null, pop: null }; days.push(row); }
        if (p.isDaytime) { row.name = p.name; row.highF = p.temperature; row.condition = classify(p.shortForecast, null); row.text = p.shortForecast; }
        else { row.lowF = p.temperature; if (!row.condition) { row.condition = classify(p.shortForecast, null); row.text = p.shortForecast; } }
        const pop = p.probabilityOfPrecipitation?.value;
        if (pop != null) row.pop = Math.max(row.pop ?? 0, pop);
      }
      out.daily = days.slice(0, 5);
    }
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!SERVICE_KEY) return res.status(500).json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY" });

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const { business_id } = req.body || {};
  if (!token || !business_id) return res.status(400).json({ error: "Missing sign-in or business_id" });

  try {
    // Only the business's owner can trigger this
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
    if (!u.ok) return res.status(401).json({ error: "Not signed in" });
    const user = await u.json();
    const rows = await sbGet(`businesses?select=*&id=eq.${business_id}&owner_id=eq.${user.id}&limit=1`);
    let b = rows?.[0];
    if (!b) return res.status(403).json({ error: "Not your business" });
    if (!b.address_line && !b.zip) return res.status(200).json({ status: "no_address" });
    if (b.geocode_status === "not_found") return res.status(200).json({ status: "not_found" });

    b = await ensureStation(b);
    if (!b) return res.status(200).json({ status: "not_found" });

    // Backfill missing days (yesterday back 7 days)
    const today = centralDateStr(Date.now());
    const want = Array.from({ length: BACKFILL_DAYS }, (_, i) => addDaysStr(today, -(i + 1)));
    const have = await sbGet(`daily_weather?select=weather_date&business_id=eq.${b.id}&weather_date=gte.${want[want.length - 1]}&weather_date=lte.${want[0]}`);
    const haveSet = new Set((have || []).map(r => r.weather_date));
    let recorded = 0;
    const errors = [];
    // Demo sandboxes show live weather but never backfill — their history comes from the template clone
    for (const d of (b.is_demo ? [] : want.filter(d => !haveSet.has(d)))) {
      try { recorded += await recordDay(b, d); } catch (e) { errors.push(`${d}: ${e.message || e}`); }
    }
    const latestRow = await sbGet(`daily_weather?select=weather_date,condition,high_f,low_f&business_id=eq.${b.id}&order=weather_date.desc&limit=1`);

    let now = { current: null, hourly: [], daily: [] };
    try { now = await getNow(b); } catch (e) { errors.push(`forecast: ${e.message || e}`); }

    return res.status(200).json({
      status: "ok",
      recorded,
      latestRecorded: latestRow?.[0]?.weather_date || null,
      yesterday: latestRow?.[0] || null,
      ...now,
      fetchedAt: new Date().toISOString(),
      errors,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
