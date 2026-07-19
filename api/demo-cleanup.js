const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

// Anything idle longer than this (no heartbeat) is considered abandoned —
// tab closed without signing out, idle-timeout never got a chance to fire, etc.
const STALE_THRESHOLD_MINUTES = 120;

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbDelete(table, businessId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?business_id=eq.${businessId}`, {
    method: 'DELETE',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
  });
  if (!res.ok) throw new Error(`DELETE ${table} failed: ${res.status} ${await res.text()}`);
}

export default async function handler(req, res) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically.
  // This also blocks anyone else from hitting this endpoint and mass-deleting
  // demo sandboxes, since only Vercel (and you) know the secret.
  const authHeader = req.headers.authorization;
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars' });
  }

  try {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000).toISOString();

    // Only ever matches is_demo=true AND is_template=false — same safety
    // principle as demo-logout.js. The permanent Cedar & Sage template and
    // any real business are structurally impossible to match this query.
    const stale = await sbGet(
      `businesses?select=id&is_demo=eq.true&is_template=eq.false&last_seen_at=lt.${cutoff}`
    );

    const deleted = [];
    for (const biz of stale) {
      await sbDelete('punch_reviews', biz.id);
      await sbDelete('pulse_history', biz.id);
      await sbDelete('sales_data', biz.id);
      await sbDelete('punches', biz.id);
      await sbDelete('published_schedules', biz.id);
      await sbDelete('shifts', biz.id);
      await sbDelete('schedule_weeks', biz.id);
      await sbDelete('employees', biz.id);
      await sbDelete('dashboard_widgets', biz.id);
      await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${biz.id}`, {
        method: 'DELETE',
        headers: { ...HEADERS, Prefer: 'return=minimal' },
      });
      deleted.push(biz.id);
    }

    return res.status(200).json({ success: true, deleted_count: deleted.length, deleted });
  } catch (err) {
    console.error('Demo cleanup failed:', err);
    return res.status(500).json({ error: 'Cleanup failed', details: err.message });
  }
}
