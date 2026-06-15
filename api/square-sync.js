// /api/square-sync.js
// Pulls completed orders for the last 60 days from Square, aggregates them
// into daily revenue totals, and upserts into sales_data — the same table
// the CSV import writes to, so the Sales Intelligence card doesn't care
// which source the numbers came from.

const SQUARE_BASE = process.env.SQUARE_ENV === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com";

const SUPABASE_URL   = process.env.SUPABASE_URL || "https://kyrjgfeowmflazywsuir.supabase.co";
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SQUARE_VERSION = "2024-01-18";
const LOOKBACK_DAYS  = 60;

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { business_id } = req.body || {};
  if (!business_id) {
    return res.status(400).json({ error: "Missing business_id" });
  }

  try {
    // 1. Load the connection
    const connRes = await fetch(
      `${SUPABASE_URL}/rest/v1/square_connections?business_id=eq.${business_id}&select=*`,
      { headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` } }
    );
    const conns = await connRes.json();
    const conn = conns?.[0];
    if (!conn) return res.status(404).json({ error: "Square is not connected for this business" });

    let accessToken = conn.access_token;

    // 2. Refresh if expired or expiring within the hour
    if (conn.token_expires_at && new Date(conn.token_expires_at) < new Date(Date.now() + 60 * 60 * 1000)) {
      accessToken = await refreshAccessToken(conn);
    }

    // 3. Find this merchant's active locations
    const locRes = await fetch(`${SQUARE_BASE}/v2/locations`, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Square-Version": SQUARE_VERSION,
      },
    });
    const locData = await locRes.json();
    if (!locRes.ok) {
      console.error("Square locations fetch failed:", locData);
      throw new Error(locData?.errors?.[0]?.detail || "Square locations fetch failed");
    }
    const locationIds = (locData.locations || [])
      .filter(l => l.status === "ACTIVE")
      .map(l => l.id);
    if (locationIds.length === 0) {
      throw new Error("No active Square locations found for this account");
    }

    // 4. Pull completed orders for the lookback window (paginated)
    const startAt = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    let orders = [];
    let cursor = null;

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

      const ordersRes = await fetch(`${SQUARE_BASE}/v2/orders/search`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Square-Version": SQUARE_VERSION,
        },
        body: JSON.stringify(body),
      });
      const ordersData = await ordersRes.json();
      if (!ordersRes.ok) {
        console.error("Square orders/search failed:", ordersData);
        throw new Error(ordersData?.errors?.[0]?.detail || "Square orders fetch failed");
      }

      orders = orders.concat(ordersData.orders || []);
      cursor = ordersData.cursor || null;
    } while (cursor);

    // 5. Aggregate to daily revenue
    const dayTotals = {};
    for (const order of orders) {
      const ts = order.closed_at || order.created_at;
      if (!ts) continue;
      const date = ts.split("T")[0];
      const amount = (order.total_money?.amount || 0) / 100;
      if (!dayTotals[date]) dayTotals[date] = { revenue: 0, transactions: 0 };
      dayTotals[date].revenue += amount;
      dayTotals[date].transactions += 1;
    }

    const salesData = Object.entries(dayTotals)
      .map(([date, d]) => ({ date, revenue: Math.round(d.revenue * 100) / 100, transactions: d.transactions }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // 6. Upsert into sales_data
    if (salesData.length > 0) {
      const rows = salesData.map(d => ({
        business_id, sale_date: d.date, revenue: d.revenue, transactions: d.transactions,
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
      if (!upsertRes.ok) {
        const errText = await upsertRes.text();
        console.error("sales_data upsert failed:", errText);
        throw new Error("Could not save synced sales data");
      }
    }

    // 7. Record sync time
    const now = new Date().toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/square_connections?business_id=eq.${business_id}`, {
      method: "PATCH",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({ last_synced_at: now }),
    });

    return res.status(200).json({ salesData, daysSynced: salesData.length, lastSyncedAt: now });
  } catch (err) {
    console.error("square-sync error:", err);
    return res.status(500).json({ error: err.message });
  }
}
