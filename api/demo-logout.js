const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    // SAFETY CHECK — refuses to delete anything that isn't explicitly flagged
    // as a disposable demo clone. Real businesses and the permanent Cedar &
    // Sage template both fail this check and are protected no matter what
    // business_id is passed in.
    const [biz] = await sbGet(`businesses?id=eq.${business_id}&select=id,is_demo,is_template`);
    if (!biz) {
      return res.status(404).json({ error: 'Business not found' });
    }
    if (!biz.is_demo || biz.is_template) {
      return res.status(403).json({ error: 'Refusing to delete a non-demo or template business' });
    }

    // Delete children first (FK-safe order), then the business row itself
    await sbDelete('punch_reviews', business_id);
    await sbDelete('pulse_history', business_id);
    await sbDelete('sales_data', business_id);
    await sbDelete('punches', business_id);
    await sbDelete('published_schedules', business_id);
    await sbDelete('shifts', business_id);
    await sbDelete('schedule_weeks', business_id);
    await sbDelete('employees', business_id);

    const res2 = await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${business_id}`, {
      method: 'DELETE',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
    });
    if (!res2.ok) throw new Error(`DELETE businesses failed: ${res2.status} ${await res2.text()}`);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Demo destroy failed:', err);
    return res.status(500).json({ error: 'Failed to destroy demo sandbox', details: err.message });
  }
}
