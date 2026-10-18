// /api/square-oauth-callback.js
// Square redirects here after the merchant approves (or denies) access.
// Exchanges the auth code for tokens, fetches the merchant name, stores
// everything in square_connections via the service role, then redirects
// back to the app.

import crypto from "crypto";

const SQUARE_BASE = process.env.SQUARE_ENV === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kyrjgfeowmflazywsuir.supabase.co";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_BASE_URL = process.env.APP_BASE_URL || "https://shiftwise-ten.vercel.app";
const SQUARE_VERSION = "2024-01-18";
const STATE_SECRET = process.env.OAUTH_STATE_SECRET || process.env.SQUARE_APP_SECRET;

// Verifies the signed state issued by /api/square-oauth-start, then confirms
// the signer still owns the business. Returns the business_id or null.
async function verifyState(state) {
  if (!state || !STATE_SECRET) return null;
  const [body, sig] = String(state).split(".");
  if (!body || !sig) return null;
  const expect = crypto.createHmac("sha256", STATE_SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p; try { p = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
  if (!p?.b || !p?.u || !(p.exp > Date.now())) return null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/businesses?select=id&id=eq.${p.b}&owner_id=eq.${p.u}&limit=1`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const rows = r.ok ? await r.json() : [];
  return rows?.[0]?.id || null;
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;
  const businessId = await verifyState(state).catch(() => null);

  if (error || !code || !businessId) {
    console.error("Square OAuth callback error param:", error);
    return res.redirect(302, `${APP_BASE_URL}/?square=error`);
  }

  try {
    // 1. Exchange code for tokens
    const tokenRes = await fetch(`${SQUARE_BASE}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SQUARE_APP_ID,
        client_secret: process.env.SQUARE_APP_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${APP_BASE_URL}/api/square-oauth-callback`,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error("Square token exchange failed:", tokenData);
      throw new Error(tokenData.message || "Token exchange failed");
    }

    const { access_token, refresh_token, expires_at, merchant_id } = tokenData;

    // 2. Look up the merchant's display name (best-effort)
    let merchantName = "";
    try {
      const merchRes = await fetch(`${SQUARE_BASE}/v2/merchants/${merchant_id}`, {
        headers: {
          "Authorization": `Bearer ${access_token}`,
          "Square-Version": SQUARE_VERSION,
        },
      });
      const merchData = await merchRes.json();
      merchantName = merchData?.merchant?.business_name || "";
    } catch (e) {
      console.warn("Could not fetch merchant name:", e);
    }

    // 3. Upsert the connection (service role bypasses RLS)
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/square_connections`, {
      method: "POST",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([{
        business_id: businessId,
        merchant_id,
        merchant_name: merchantName,
        access_token,
        refresh_token,
        token_expires_at: expires_at || null,
      }]),
    });

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      console.error("Supabase upsert failed:", errText);
      throw new Error("Could not save Square connection");
    }

    return res.redirect(302, `${APP_BASE_URL}/?square=connected`);
  } catch (err) {
    console.error("Square OAuth callback error:", err);
    return res.redirect(302, `${APP_BASE_URL}/?square=error`);
  }
}
