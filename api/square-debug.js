// /api/square-debug.js
// Diagnostic only — open this URL directly in a browser to see what
// Square thinks of the stored connection: merchant info, token status,
// and which locations the access token can actually see.
//
// Usage: https://<your-app>/api/square-debug?business_id=<bizId>

const SQUARE_BASE = process.env.SQUARE_ENV === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kyrjgfeowmflazywsuir.supabase.co";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SQUARE_VERSION = "2024-01-18";

export default async function handler(req, res) {
  let { business_id } = req.query;

  try {
    // Always list businesses on file so we can confirm/find the right id
    const bizRes = await fetch(
      `${SUPABASE_URL}/rest/v1/businesses?select=id,name`,
      { headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` } }
    );
    const businesses = bizRes.ok ? await bizRes.json() : [];

    // If no business_id given, default to the first business on file
    if (!business_id && businesses.length > 0) {
      business_id = businesses[0].id;
    }

    if (!business_id) {
      return res.status(200).json({ error: "No business_id given and no businesses found", businesses });
    }

    const connRes = await fetch(
      `${SUPABASE_URL}/rest/v1/square_connections?business_id=eq.${business_id}&select=*`,
      { headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` } }
    );

    if (!connRes.ok) {
      const t = await connRes.text();
      return res.status(200).json({ step: "load_connection", supabase_status: connRes.status, supabase_error: t });
    }

    const conns = await connRes.json();
    const conn = conns?.[0];
    if (!conn) {
      return res.status(200).json({ connected: false, business_id_used: business_id, businesses, message: "No square_connections row for this business_id" });
    }

    const result = {
      connected: true,
      business_id_used: business_id,
      businesses,
      merchant_id: conn.merchant_id,
      merchant_name: conn.merchant_name,
      token_expires_at: conn.token_expires_at,
      last_synced_at: conn.last_synced_at,
      has_access_token: !!conn.access_token,
      has_refresh_token: !!conn.refresh_token,
    };

    // Try the access token against Square's Locations API
    const locRes = await fetch(`${SQUARE_BASE}/v2/locations`, {
      headers: {
        "Authorization": `Bearer ${conn.access_token}`,
        "Square-Version": SQUARE_VERSION,
      },
    });
    const locData = await locRes.json();

    result.locations_call_status = locRes.status;
    result.locations = (locData.locations || []).map(l => ({ id: l.id, name: l.name, status: l.status }));
    result.locations_errors = locData.errors || null;

    const locationIds = (locData.locations || []).filter(l => l.status === "ACTIVE").map(l => l.id);
    const startAt = new Date(Date.now() - 110 * 24 * 60 * 60 * 1000).toISOString();

    // ── Orders Search (what square-sync.js currently uses) ──────────────
    if (locationIds.length > 0) {
      let orders = [];
      let cursor = null;
      let ordersError = null;
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
          headers: {
            "Authorization": `Bearer ${conn.access_token}`,
            "Content-Type": "application/json",
            "Square-Version": SQUARE_VERSION,
          },
          body: JSON.stringify(body),
        });
        const data = await r.json();
        if (!r.ok) { ordersError = data; break; }
        orders = orders.concat(data.orders || []);
        cursor = data.cursor || null;
      } while (cursor);

      result.orders_window_days = 110;
      result.orders_count = orders.length;
      result.orders_total = Math.round(orders.reduce((s,o)=>s+(o.total_money?.amount||0),0)) / 100;
      result.orders_date_range = orders.length
        ? [orders[0].closed_at || orders[0].created_at, orders[orders.length-1].closed_at || orders[orders.length-1].created_at]
        : null;
      result.orders_error = ordersError;
    }

    // ── Payments list (alternative source — every money-in event) ───────
    let payments = [];
    let payCursor = null;
    let paymentsError = null;
    do {
      const params = new URLSearchParams({ begin_time: startAt, sort_order: "ASC", limit: "100" });
      if (payCursor) params.set("cursor", payCursor);
      const r = await fetch(`${SQUARE_BASE}/v2/payments?${params.toString()}`, {
        headers: {
          "Authorization": `Bearer ${conn.access_token}`,
          "Square-Version": SQUARE_VERSION,
        },
      });
      const data = await r.json();
      if (!r.ok) { paymentsError = data; break; }
      payments = payments.concat(data.payments || []);
      payCursor = data.cursor || null;
    } while (payCursor);

    const completedPayments = payments.filter(p => p.status === "COMPLETED");
    result.payments_window_days = 110;
    result.payments_count = payments.length;
    result.payments_completed_count = completedPayments.length;
    result.payments_total = Math.round(completedPayments.reduce((s,p)=>s+(p.total_money?.amount||0),0)) / 100;
    result.payments_date_range = payments.length
      ? [payments[0].created_at, payments[payments.length-1].created_at]
      : null;
    result.payments_error = paymentsError;

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
