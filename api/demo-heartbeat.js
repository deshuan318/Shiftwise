const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars' });
  }

  const { business_id } = req.body || {};
  if (!business_id) {
    return res.status(400).json({ error: 'business_id required' });
  }

  try {
    // Only ever touches demo businesses — same safety principle as
    // demo-logout.js. A heartbeat for a non-demo business_id is a no-op.
    const res2 = await fetch(
      `${SUPABASE_URL}/rest/v1/businesses?id=eq.${business_id}&is_demo=eq.true`,
      {
        method: 'PATCH',
        headers: { ...HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
      }
    );
    if (!res2.ok) throw new Error(`Heartbeat update failed: ${res2.status} ${await res2.text()}`);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Demo heartbeat failed:', err);
    return res.status(500).json({ error: 'Heartbeat failed', details: err.message });
  }
}
