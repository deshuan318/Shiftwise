// /api/square-disconnect.js
// Removes the stored Square connection for a business. Imported/synced
// sales_data rows are left intact — disconnecting only stops future syncs.

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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { business_id } = req.body || {};
  if (!business_id) {
    return res.status(400).json({ error: "Missing business_id" });
  }

  if (!(await requireOwner(req, business_id))) {
    return res.status(403).json({ error: "Not authorized for this business" });
  }

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/square_connections?business_id=eq.${business_id}`, {
      method: "DELETE",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Prefer": "return=minimal",
      },
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error("square-disconnect delete failed:", errText);
      throw new Error("Could not disconnect");
    }

    return res.status(200).json({ disconnected: true });
  } catch (err) {
    console.error("square-disconnect error:", err);
    return res.status(500).json({ error: err.message });
  }
}
