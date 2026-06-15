// /api/square-disconnect.js
// Removes the stored Square connection for a business. Imported/synced
// sales_data rows are left intact — disconnecting only stops future syncs.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kyrjgfeowmflazywsuir.supabase.co";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { business_id } = req.body || {};
  if (!business_id) {
    return res.status(400).json({ error: "Missing business_id" });
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
