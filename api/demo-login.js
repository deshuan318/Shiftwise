import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// Fixed template business — Cedar & Sage. Only ever READ from here, never written to.
const TEMPLATE_BUSINESS_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
// The shared demo Auth user's id — every cloned business is owned by this id.
const DEMO_OWNER_ID = 'aeee94c4-64af-44ab-abda-7d72da38fd0b';

// Service role key bypasses RLS — required for cross-table clone inserts.
// Server-side only. Never expose this key or this file's logic to the frontend.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const newBusinessId = randomUUID();

    // 1. Clone the business row
    const { data: templateBiz, error: bizErr } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', TEMPLATE_BUSINESS_ID)
      .single();
    if (bizErr) throw bizErr;

    const { id: _oldId, created_at, updated_at, is_template, ...bizRest } = templateBiz;
    const { error: insertBizErr } = await supabase.from('businesses').insert({
      ...bizRest,
      id: newBusinessId,
      owner_id: DEMO_OWNER_ID,
      is_demo: true,
      is_template: false,
    });
    if (insertBizErr) throw insertBizErr;

    // 2. Clone employees — build old_id -> new_id map
    const { data: employees, error: empErr } = await supabase
      .from('employees')
      .select('*')
      .eq('business_id', TEMPLATE_BUSINESS_ID);
    if (empErr) throw empErr;

    const employeeIdMap = {};
    const newEmployees = employees.map((e) => {
      const newId = randomUUID();
      employeeIdMap[e.id] = newId;
      const { id, created_at: _ca, updated_at: _ua, ...rest } = e;
      return { ...rest, id: newId, business_id: newBusinessId };
    });
    const { error: insertEmpErr } = await supabase.from('employees').insert(newEmployees);
    if (insertEmpErr) throw insertEmpErr;

    // 3. Clone schedule_weeks — build old_id -> new_id map
    const { data: weeks, error: weekErr } = await supabase
      .from('schedule_weeks')
      .select('*')
      .eq('business_id', TEMPLATE_BUSINESS_ID);
    if (weekErr) throw weekErr;

    const weekIdMap = {};
    const newWeeks = weeks.map((w) => {
      const newId = randomUUID();
      weekIdMap[w.id] = newId;
      const { id, created_at: _ca, ...rest } = w;
      return { ...rest, id: newId, business_id: newBusinessId };
    });
    const { error: insertWeekErr } = await supabase.from('schedule_weeks').insert(newWeeks);
    if (insertWeekErr) throw insertWeekErr;

    // 4. Clone shifts — remap employee_id + week_id
    const { data: shifts, error: shiftErr } = await supabase
      .from('shifts')
      .select('*')
      .eq('business_id', TEMPLATE_BUSINESS_ID);
    if (shiftErr) throw shiftErr;

    const newShifts = shifts.map((s) => {
      const { id, created_at: _ca, updated_at: _ua, ...rest } = s;
      return {
        ...rest,
        id: randomUUID(),
        business_id: newBusinessId,
        week_id: weekIdMap[s.week_id],
        employee_id: employeeIdMap[s.employee_id],
      };
    });
    const { error: insertShiftErr } = await supabase.from('shifts').insert(newShifts);
    if (insertShiftErr) throw insertShiftErr;

    // 5. Clone published_schedules — remap employee ids inside the jsonb payloads
    const { data: schedules, error: schedErr } = await supabase
      .from('published_schedules')
      .select('*')
      .eq('business_id', TEMPLATE_BUSINESS_ID);
    if (schedErr) throw schedErr;

    const newSchedules = schedules.map((ps) => {
      const { id, published_at: _pa, ...rest } = ps;
      const remappedScheduleData = (ps.schedule_data || []).map((entry) => ({
        ...entry,
        employee_id: employeeIdMap[entry.employee_id] || entry.employee_id,
      }));
      const remappedSnapshot = (ps.employee_snapshot || []).map((emp) => ({
        ...emp,
        id: employeeIdMap[emp.id] || emp.id,
      }));
      return {
        ...rest,
        id: randomUUID(),
        business_id: newBusinessId,
        schedule_data: remappedScheduleData,
        employee_snapshot: remappedSnapshot,
      };
    });
    const { error: insertSchedErr } = await supabase.from('published_schedules').insert(newSchedules);
    if (insertSchedErr) throw insertSchedErr;

    // 6. Clone punches — remap employee_id, build old_id -> new_id map for reviews
    const { data: punches, error: punchErr } = await supabase
      .from('punches')
      .select('*')
      .eq('business_id', TEMPLATE_BUSINESS_ID);
    if (punchErr) throw punchErr;

    const punchIdMap = {};
    const newPunches = punches.map((p) => {
      const newId = randomUUID();
      punchIdMap[p.id] = newId;
      const { id, created_at: _ca, ...rest } = p;
      return {
        ...rest,
        id: newId,
        business_id: newBusinessId,
        employee_id: employeeIdMap[p.employee_id] || p.employee_id,
      };
    });
    const { error: insertPunchErr } = await supabase.from('punches').insert(newPunches);
    if (insertPunchErr) throw insertPunchErr;

    // 7. Clone sales_data (no employee refs)
    const { data: sales, error: salesErr } = await supabase
      .from('sales_data')
      .select('*')
      .eq('business_id', TEMPLATE_BUSINESS_ID);
    if (salesErr) throw salesErr;

    if (sales.length) {
      const newSales = sales.map((s) => {
        const { id, created_at: _ca, updated_at: _ua, ...rest } = s;
        return { ...rest, id: randomUUID(), business_id: newBusinessId };
      });
      const { error: insertSalesErr } = await supabase.from('sales_data').insert(newSales);
      if (insertSalesErr) throw insertSalesErr;
    }

    // 8. Clone pulse_history
    const { data: pulse, error: pulseErr } = await supabase
      .from('pulse_history')
      .select('*')
      .eq('business_id', TEMPLATE_BUSINESS_ID);
    if (pulseErr) throw pulseErr;

    if (pulse.length) {
      const newPulse = pulse.map((p) => {
        const { id, ...rest } = p;
        return { ...rest, id: randomUUID(), business_id: newBusinessId };
      });
      const { error: insertPulseErr } = await supabase.from('pulse_history').insert(newPulse);
      if (insertPulseErr) throw insertPulseErr;
    }

    // 9. Clone punch_reviews — remap punch_id and reviewed_by (employee id)
    const { data: reviews, error: reviewErr } = await supabase
      .from('punch_reviews')
      .select('*')
      .eq('business_id', TEMPLATE_BUSINESS_ID);
    if (reviewErr) throw reviewErr;

    const newReviews = reviews
      .filter((r) => punchIdMap[r.punch_id])
      .map((r) => {
        const { id, ...rest } = r;
        return {
          ...rest,
          id: randomUUID(),
          business_id: newBusinessId,
          punch_id: punchIdMap[r.punch_id],
          reviewed_by: employeeIdMap[r.reviewed_by] || r.reviewed_by,
        };
      });
    if (newReviews.length) {
      const { error: insertReviewErr } = await supabase.from('punch_reviews').insert(newReviews);
      if (insertReviewErr) throw insertReviewErr;
    }

    return res.status(200).json({ business_id: newBusinessId });
  } catch (err) {
    console.error('Demo clone failed:', err);
    return res.status(500).json({ error: 'Failed to create demo sandbox', details: err.message });
  }
}
