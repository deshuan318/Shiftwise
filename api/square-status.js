// /api/square-status.js
// Tells the frontend whether this business has a Square connection,
// without ever exposing the access/refresh tokens themselves.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kyrjgfeowmflazywsuir.supabase.co";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── Owner check: caller must be signed in AND own this business ──────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function requireOwner(req, businessId) {
  if (!UUID_RE.test(String(businessId || ""))) return null;
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!u.ok) return null;
  const user = await u.json();
  if (!user?.id) return null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/businesses?select=id&id=eq.${businessId}&owner_id=eq.${user.id}&limit=1`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const rows = r.ok ? await r.json() : [];
  return rows?.[0] ? user : null;
}

export default async function handler(req, res) {
  const { business_id } = req.query;

  if (!business_id) {
    return res.status(400).json({ connected: false });
  }
  if (!(await requireOwner(req, business_id))) {
    return res.status(403).json({ connected: false });
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
