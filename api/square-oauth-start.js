// /api/square-oauth-start.js
// Kicks off the Square OAuth flow. The frontend navigates here
// (full page redirect) with ?business_id=..., and we redirect on to
// Square's authorize page with the right scopes + state.

const SQUARE_BASE = process.env.SQUARE_ENV === "sandbox"
  ? "https://connect.squareupsandbox.com"
  : "https://connect.squareup.com";

const APP_BASE_URL = process.env.APP_BASE_URL || "https://shiftwise-ten.vercel.app";

export default async function handler(req, res) {
  const { business_id } = req.query;

  if (!business_id) {
    return res.status(400).send("Missing business_id");
  }

  // NOTE: state carries the business_id so the callback knows which
  // business to attach the connection to. For a single-tenant setup
  // this is fine; if ShiftWise becomes multi-tenant with public signup,
  // this should be a signed/opaque token instead of the raw id.
  const params = new URLSearchParams({
    client_id: process.env.SQUARE_APP_ID,
    scope: "MERCHANT_PROFILE_READ ORDERS_READ",
    session: "false",
    state: business_id,
    redirect_uri: `${APP_BASE_URL}/api/square-oauth-callback`,
  });

  res.redirect(302, `${SQUARE_BASE}/oauth2/authorize?${params.toString()}`);
}
