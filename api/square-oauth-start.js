// /api/square-oauth-start.js
// Starts the Square OAuth flow. The app POSTs here with the owner's sign-in
// token and business_id; we confirm ownership and return Square's authorize
// URL carrying a signed, 15-minute `state`. The callback rejects any state
// that wasn't issued here, so nobody can attach a Square account to a
// business they don't own.

import crypto from "crypto";

const SQUARE_BASE = process.env.SQUARE_ENV === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kyrjgfeowmflazywsuir.supabase.co";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_BASE_URL = process.env.APP_BASE_URL || "https://shiftwise-ten.vercel.app";
const STATE_SECRET = process.env.OAUTH_STATE_SECRET || process.env.SQUARE_APP_SECRET;
const STATE_TTL_MS = 15 * 60 * 1000;

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

function signState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", STATE_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!STATE_SECRET || !SERVICE_KEY) return res.status(500).json({ error: "Server not configured" });

  const { business_id } = req.body || {};
  const user = await requireOwner(req, business_id);
  if (!user) return res.status(403).json({ error: "Not authorized for this business" });

  const state = signState({
    b: business_id, u: user.id, exp: Date.now() + STATE_TTL_MS,
    n: crypto.randomBytes(8).toString("hex"),
  });
  const params = new URLSearchParams({
    client_id: process.env.SQUARE_APP_ID,
    scope: "MERCHANT_PROFILE_READ ORDERS_READ ITEMS_READ",
    session: "false",
    state,
    redirect_uri: `${APP_BASE_URL}/api/square-oauth-callback`,
  });
  return res.status(200).json({ url: `${SQUARE_BASE}/oauth2/authorize?${params.toString()}` });
}
