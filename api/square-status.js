// /api/square-status.js
// Tells the frontend whether this business has a Square connection,
// without ever exposing the access/refresh tokens themselves.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kyrjgfeowmflazywsuir.supabase.co";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  const { business_id } = req.query;

  if (!business_id) {
    return res.status(400).json({ connected: false });
  }

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/square_connections?business_id=eq.${business_id}&select=merchant_name,last_synced_at,access_token`,
      { headers: { "apikey": SERVICE_KEY, "Authorization": `Bearer ${SERVICE_KEY}` } }
    );

    if (!r.ok) throw new Error("Lookup failed");

    const rows = await r.json();
    const row = rows?.[0];

    if (!row || !row.access_token) {
      return res.status(200).json({ connected: false });
    }

    return res.status(200).json({
      connected: true,
      merchantName: row.merchant_name || "",
      lastSyncedAt: row.last_synced_at || null,
    });
  } catch (err) {
    console.error("square-status error:", err);
    return res.status(200).json({ connected: false });
  }
}
