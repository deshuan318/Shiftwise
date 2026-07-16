import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { business_id } = req.body || {};
  if (!business_id) {
    return res.status(400).json({ error: 'business_id required' });
  }

  try {
    // SAFETY CHECK — this is the guard that matters most in this whole file.
    // Refuses to delete anything that isn't explicitly flagged as a disposable
    // demo clone. Real businesses and the permanent Cedar & Sage template both
    // fail this check and are protected, regardless of what business_id is passed in.
    const { data: biz, error: bizErr } = await supabase
      .from('businesses')
      .select('id, is_demo, is_template')
      .eq('id', business_id)
      .single();

    if (bizErr || !biz) {
      return res.status(404).json({ error: 'Business not found' });
    }
    if (!biz.is_demo || biz.is_template) {
      return res.status(403).json({ error: 'Refusing to delete a non-demo or template business' });
    }

    // Delete children first (FK-safe order), then the business row itself
    await supabase.from('punch_reviews').delete().eq('business_id', business_id);
    await supabase.from('pulse_history').delete().eq('business_id', business_id);
    await supabase.from('sales_data').delete().eq('business_id', business_id);
    await supabase.from('punches').delete().eq('business_id', business_id);
    await supabase.from('published_schedules').delete().eq('business_id', business_id);
    await supabase.from('shifts').delete().eq('business_id', business_id);
    await supabase.from('schedule_weeks').delete().eq('business_id', business_id);
    await supabase.from('employees').delete().eq('business_id', business_id);
    await supabase.from('businesses').delete().eq('id', business_id);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Demo destroy failed:', err);
    return res.status(500).json({ error: 'Failed to destroy demo sandbox', details: err.message });
  }
}
