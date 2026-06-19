// /api/square-sync-cron.js
// Called automatically by Vercel Cron once per day (configured in vercel.json).
// Loops over every business with an active Square connection and runs an
// incremental sync for each one, exactly like the manual "Sync Now" button
// but without needing anyone to tap it.
//
// Security: verifies Vercel's CRON_SECRET header so this endpoint can't be
// triggered by anyone other than Vercel's cron infrastructure.

export const config = { maxDuration: 60 };

const SQUARE_BASE = process.env.SQUARE_ENV === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com";

const SUPABASE_URL   = process.env.SUPABASE_URL || "https://kyrjgfeowmflazywsuir.supabase.co";
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SQUARE_VERSION = "2024-01-18";
const FULL_BACKFILL_DAYS     = 1095;
const INCREMENTAL_OVERLAP_DAYS = 3;

const APP_BASE_URL = process.env.APP_BASE_URL || "https://shiftwise-ten.vercel.app";

async function refreshAccessToken(conn) {
  const r = await fetch(`${SQUARE_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SQUARE_APP_ID,
      client_secret: process.env.SQUARE_APP_SECRET,
      refresh_token: conn.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || "Token refresh failed");

  await fetch(`${SUPABASE_URL}/rest/v1/square_connections?business_id=eq.${conn.business_id}`, {
    method: "PATCH",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: data.expires_at || null,
    }),
  });

  return data.access_token;
}

async function syncBusiness(conn) {
  let accessToken = conn.access_token;

  if (conn.token_expires_at && new Date(conn.token_expires_at) < new Date(Date.now() + 60 * 60 * 1000)) {
    accessToken = await refreshAccessToken(conn);
  }

  // Fetch active locations + timezone
  const locRes = await fetch(`${SQUARE_BASE}/v2/locations`, {
    headers: { "Authorization": `Bearer ${accessToken}`, "Square-Version": SQUARE_VERSION },
  });
  const locData = await locRes.json();
  if (!locRes.ok) throw new Error(locData?.errors?.[0]?.detail || "Locations fetch failed");

  const activeLocations = (locData.locations || []).filter(l => l.status === "ACTIVE");
  const locationIds = activeLocations.map(l => l.id);
  if (locationIds.length === 0) throw new Error("No active locations");

  const timeZone = activeLocations[0]?.timezone || "America/Chicago";
  const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone, year:"numeric", month:"2-digit", day:"2-digit" });

  // Determine sync window
  let startAt, syncType;
  if (conn.last_synced_at) {
    const since = new Date(conn.last_synced_at);
    since.setUTCDate(since.getUTCDate() - INCREMENTAL_OVERLAP_DAYS);
    startAt = since.toISOString();
    syncType = "incremental";
  } else {
    startAt = new Date(Date.now() - FULL_BACKFILL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    syncType = "full_backfill";
  }

  // Fetch completed orders
  let orders = [], cursor = null;
  do {
    const body = {
      location_ids: locationIds,
      query: {
        filter: {
          state_filter: { states: ["COMPLETED"] },
          date_time_filter: { closed_at: { start_at: startAt } },
        },
        sort: { sort_field: "CLOSED_AT", sort_order: "ASC" },
      },
      limit: 500,
    };
    if (cursor) body.cursor = cursor;
    const r = await fetch(`${SQUARE_BASE}/v2/orders/search`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json", "Square-Version": SQUARE_VERSION },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.errors?.[0]?.detail || "Orders fetch failed");
    orders = orders.concat(data.orders || []);
    cursor = data.cursor || null;
  } while (cursor);

  // Aggregate to daily revenue in location's timezone
  const dayTotals = {};
  for (const order of orders) {
    const ts = order.closed_at || order.created_at;
    if (!ts) continue;
    const date = dayFormatter.format(new Date(ts));
    const amount = (order.total_money?.amount || 0) / 100;
    if (!dayTotals[date]) dayTotals[date] = { revenue: 0, transactions: 0 };
    dayTotals[date].revenue += amount;
    dayTotals[date].transactions += 1;
  }

  const salesData = Object.entries(dayTotals)
    .map(([date, d]) => ({ date, revenue: Math.round(d.revenue * 100) / 100, transactions: d.transactions }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Upsert to sales_data
  if (salesData.length > 0) {
    const rows = salesData.map(d => ({
      business_id: conn.business_id, sale_date: d.date, revenue: d.revenue, transactions: d.transactions,
    }));
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/sales_data`, {
      method: "POST",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    });
    if (!upsertRes.ok) throw new Error("sales_data upsert failed");
  }

  // Update last_synced_at
  const now = new Date().toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/square_connections?business_id=eq.${conn.business_id}`, {
    method: "PATCH",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({ last_synced_at: now }),
  });

  return { business_id: conn.business_id, daysSynced: salesData.length, syncType };
}

export default async function handler(req, res) {
  // Verify this is actually coming from Vercel's cron infrastructure
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Load all Square connections
    const connsRes = await fetch(`${SUPABASE_URL}/rest/v1/square_connections?select=*`, {
      headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` },
    });
    if (!connsRes.ok) throw new Error("Could not load connections");
    const connections = await connsRes.json();

    if (connections.length === 0) {
      return res.status(200).json({ message: "No Square connections on file", synced: 0 });
    }

    // Sync each business, collect results
    const results = [];
    for (const conn of connections) {
      try {
        const result = await syncBusiness(conn);
        results.push({ ...result, status: "ok" });
        console.log(`[cron] Synced ${conn.business_id}: ${result.daysSynced} days (${result.syncType})`);
      } catch (err) {
        results.push({ business_id: conn.business_id, status: "error", error: err.message });
        console.error(`[cron] Failed ${conn.business_id}:`, err.message);
      }
    }

    const succeeded = results.filter(r => r.status === "ok").length;
    const failed    = results.filter(r => r.status === "error").length;

    return res.status(200).json({
      ran_at: new Date().toISOString(),
      total: connections.length,
      succeeded,
      failed,
      results,
    });
  } catch (err) {
    console.error("[cron] square-sync-cron error:", err);
    return res.status(500).json({ error: err.message });
  }
}
