// /api/weather-history.js
// Backfills past weather for every day the business has sales, using NOAA's
// climate archive (NCEI Climate Data Online, GHCN-Daily). The National Weather
// Service feed in /api/weather only keeps ~7 days, so this is what lets an
// owner who imports a year of Square sales get weather comparisons on day one.
//
//   POST /api/weather-history { business_id }   (owner's Bearer token)
//
// Needs env var NOAA_TOKEN (free: https://www.ncdc.noaa.gov/cdo-web/token).
// Never overwrites a day already recorded (NWS rows have hourly detail).
// NOAA daily data has no cloud cover, so a dry day is recorded as "sunny";
// rain, storms and snow come from precipitation and weather-type flags.

export const config = { maxDuration: 60 };

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kyrjgfeowmflazywsuir.supabase.co";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NOAA_TOKEN   = process.env.NOAA_TOKEN;
const CDO = "https://www.ncei.noaa.gov/cdo-web/api/v2";
const TZ = "America/Chicago";
const MAX_YEARS_BACK = 3;
const RECENT_GAP_DAYS = 8;   // the last week is covered by NWS in /api/weather

const HEADERS = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`GET ${path.split("?")[0]} failed: ${r.status} ${await r.text()}`);
  return r.json();
}
// Supabase returns at most 1,000 rows per request — page through
async function sbGetAll(path) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await sbGet(`${path}&limit=1000&offset=${offset}`);
    out.push(...(page || []));
    if (!page || page.length < 1000) return out;
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function noaa(path) {
  // NOAA allows 5 requests/second per token — stay well under it
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${CDO}/${path}`, { headers: { token: NOAA_TOKEN } });
    if (r.status === 429 || r.status === 503) { await sleep(1200 * (attempt + 1)); continue; }
    if (!r.ok) throw new Error(`NOAA ${path.split("?")[0]} ${r.status}`);
    const text = await r.text();
    await sleep(250);
    return text ? JSON.parse(text) : {};
  }
  throw new Error("NOAA busy — try again later");
}

const centralDate = ms => {
  const p = {};
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(ms)).forEach(({ type, value }) => { p[type] = value; });
  return `${p.year}-${p.month}-${p.day}`;
};
const addDays = (ds, n) => { const [y, m, d] = ds.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10); };
const dist2 = (a, b, c, d) => (a - c) ** 2 + ((b - d) * Math.cos(a * Math.PI / 180)) ** 2;

// Nearest GHCN-Daily station that reports temperature AND precipitation over the range
async function findStation(lat, lon, start, end) {
  for (const pad of [0.25, 0.5, 1.0]) {
    const ext = [lat - pad, lon - pad, lat + pad, lon + pad].map(v => v.toFixed(4)).join(",");
    const j = await noaa(`stations?datasetid=GHCND&datatypeid=TMAX&datatypeid=PRCP&extent=${ext}&startdate=${start}&enddate=${end}&limit=50`);
    const list = (j.results || []).filter(s => (s.datacoverage ?? 0) >= 0.8);
    if (list.length) {
      list.sort((a, b) => dist2(lat, lon, a.latitude, a.longitude) - dist2(lat, lon, b.latitude, b.longitude));
      return list[0];
    }
  }
  return null;
}

async function fetchDaily(stationId, start, end) {
  const byDate = {};
  let s = start;
  while (s <= end) {
    const e = addDays(s, 360) < end ? addDays(s, 360) : end;   // NOAA caps a request at one year
    let offset = 1, total = Infinity;
    while (offset <= total) {
      const j = await noaa(`data?datasetid=GHCND&stationid=${encodeURIComponent(stationId)}&datatypeid=TMAX&datatypeid=TMIN&datatypeid=PRCP&datatypeid=SNOW&datatypeid=WT03&datatypeid=WT16&startdate=${s}&enddate=${e}&units=standard&limit=1000&offset=${offset}`);
      total = j?.metadata?.resultset?.count ?? 0;
      for (const r of j.results || []) {
        const d = String(r.date).slice(0, 10);
        (byDate[d] ||= {})[r.datatype] = r.value;
      }
      offset += 1000;
      if (!j.results?.length) break;
    }
    s = addDays(e, 1);
  }
  return byDate;
}

function toRow(businessId, stationId, date, v) {
  if (v.TMAX == null && v.TMIN == null && v.PRCP == null) return null;
  const precip = v.PRCP != null ? Math.round(v.PRCP * 100) / 100 : null;
  let condition = "sunny";
  if (v.WT03 != null) condition = "storm";
  else if ((v.SNOW ?? 0) >= 0.1) condition = "snowy";
  else if ((precip ?? 0) >= 0.1 || v.WT16 != null) condition = "rainy";
  return {
    business_id: businessId, weather_date: date, condition,
    high_f: v.TMAX != null ? Math.round(v.TMAX) : null,
    low_f: v.TMIN != null ? Math.round(v.TMIN) : null,
    precip_in: precip, station: stationId, source: "noaa",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!SERVICE_KEY) return res.status(500).json({ error: "Server not configured" });
  if (!NOAA_TOKEN) return res.status(200).json({ status: "no_token" });

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const { business_id } = req.body || {};
  if (!token || !UUID_RE.test(String(business_id || ""))) return res.status(400).json({ error: "Missing sign-in or business_id" });

  try {
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
    if (!u.ok) return res.status(401).json({ error: "Not signed in" });
    const user = await u.json();
    const [b] = await sbGet(`businesses?select=id,latitude,longitude,is_demo&id=eq.${business_id}&owner_id=eq.${user.id}&limit=1`);
    if (!b) return res.status(403).json({ error: "Not your business" });
    if (b.is_demo) return res.status(200).json({ status: "demo" });
    if (b.latitude == null || b.longitude == null) return res.status(200).json({ status: "no_location" });

    // Range: first sales day (capped at 3 years) → a week ago
    const today = centralDate(Date.now());
    const end = addDays(today, -RECENT_GAP_DAYS);
    const floor = addDays(today, -365 * MAX_YEARS_BACK);
    const [first] = await sbGet(`sales_data?select=date&business_id=eq.${b.id}&order=date.asc&limit=1`);
    if (!first?.date) return res.status(200).json({ status: "no_sales" });
    const start = first.date > floor ? first.date : floor;
    if (start > end) return res.status(200).json({ status: "up_to_date", inserted: 0 });

    // Which sales days are still missing weather?
    const [salesDays, haveDays] = await Promise.all([
      sbGetAll(`sales_data?select=date&business_id=eq.${b.id}&date=gte.${start}&date=lte.${end}&order=date.asc`),
      sbGetAll(`daily_weather?select=weather_date&business_id=eq.${b.id}&weather_date=gte.${start}&weather_date=lte.${end}&order=weather_date.asc`),
    ]);
    const have = new Set((haveDays || []).map(r => r.weather_date));
    const missing = [...new Set((salesDays || []).map(r => r.date))].filter(d => !have.has(d)).sort();
    if (!missing.length) return res.status(200).json({ status: "up_to_date", inserted: 0 });

    const station = await findStation(Number(b.latitude), Number(b.longitude), missing[0], missing[missing.length - 1]);
    if (!station) return res.status(200).json({ status: "no_station" });

    const daily = await fetchDaily(station.id, missing[0], missing[missing.length - 1]);
    const rows = missing.map(d => daily[d] ? toRow(b.id, station.id, d, daily[d]) : null).filter(Boolean);

    for (let i = 0; i < rows.length; i += 500) {
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/daily_weather?on_conflict=business_id,weather_date`, {
        method: "POST",
        headers: { ...HEADERS, Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(rows.slice(i, i + 500)),
      });
      if (!ins.ok) throw new Error(`daily_weather insert failed: ${ins.status} ${await ins.text()}`);
    }

    return res.status(200).json({
      status: "ok", inserted: rows.length, missing: missing.length,
      station: { id: station.id, name: station.name }, from: missing[0], to: missing[missing.length - 1],
    });
  } catch (e) {
    console.error("weather-history error:", e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
