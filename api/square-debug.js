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

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
