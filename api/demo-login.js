import { randomUUID } from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TEMPLATE_BUSINESS_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const DEMO_OWNER_ID = 'aeee94c4-64af-44ab-abda-7d72da38fd0b';

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

async function sbInsert(table, rows) {
  if (!rows || (Array.isArray(rows) && rows.length === 0)) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`INSERT ${table} failed: ${res.status} ${await res.text()}`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars' });
  }

  let newBusinessId;
  try {
    newBusinessId = randomUUID();

    // 1. Clone the business row
    const [templateBiz] = await sbGet(`businesses?id=eq.${TEMPLATE_BUSINESS_ID}&select=*`);
    if (!templateBiz) throw new Error('Template business not found — check TEMPLATE_BUSINESS_ID');

    const { id: _oldId, created_at, updated_at, is_template, ...bizRest } = templateBiz;
    await sbInsert('businesses', {
      ...bizRest,
      id: newBusinessId,
      owner_id: DEMO_OWNER_ID,
      is_demo: true,
      is_template: false,
    });

    // 2. Clone employees — build old_id -> new_id map
    const employees = await sbGet(`employees?business_id=eq.${TEMPLATE_BUSINESS_ID}&select=*`);
    const employeeIdMap = {};
    const newEmployees = employees.map((e) => {
      const newId = randomUUID();
      employeeIdMap[e.id] = newId;
      const { id, created_at: _ca, updated_at: _ua, ...rest } = e;
      return { ...rest, id: newId, business_id: newBusinessId };
    });
    await sbInsert('employees', newEmployees);

    // 3. Clone schedule_weeks — build old_id -> new_id map
    const weeks = await sbGet(`schedule_weeks?business_id=eq.${TEMPLATE_BUSINESS_ID}&select=*`);
    const weekIdMap = {};
    const newWeeks = weeks.map((w) => {
      const newId = randomUUID();
      weekIdMap[w.id] = newId;
      const { id, created_at: _ca, ...rest } = w;
      return { ...rest, id: newId, business_id: newBusinessId };
    });
    await sbInsert('schedule_weeks', newWeeks);

    // 4. Clone shifts — remap employee_id + week_id
    const shifts = await sbGet(`shifts?business_id=eq.${TEMPLATE_BUSINESS_ID}&select=*`);
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
    await sbInsert('shifts', newShifts);

    // 5. Clone published_schedules — remap employee ids inside the jsonb payloads
    const schedules = await sbGet(`published_schedules?business_id=eq.${TEMPLATE_BUSINESS_ID}&select=*`);
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
    await sbInsert('published_schedules', newSchedules);

    // 6. Clone punches — remap employee_id, build old_id -> new_id map for reviews
    const punches = await sbGet(`punches?business_id=eq.${TEMPLATE_BUSINESS_ID}&select=*`);
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
    await sbInsert('punches', newPunches);

    // 7. Clone sales_data (no employee refs)
    const sales = await sbGet(`sales_data?business_id=eq.${TEMPLATE_BUSINESS_ID}&select=*`);
    const newSales = sales.map((s) => {
      const { id, created_at: _ca, updated_at: _ua, ...rest } = s;
      return { ...rest, id: randomUUID(), business_id: newBusinessId };
    });
    await sbInsert('sales_data', newSales);

    // 8. Clone pulse_history
    const pulse = await sbGet(`pulse_history?business_id=eq.${TEMPLATE_BUSINESS_ID}&select=*`);
    const newPulse = pulse.map((p) => {
      const { id, ...rest } = p;
      return { ...rest, id: randomUUID(), business_id: newBusinessId };
    });
    await sbInsert('pulse_history', newPulse);

    // 9. Clone punch_reviews — remap punch_id and reviewed_by
    const reviews = await sbGet(`punch_reviews?business_id=eq.${TEMPLATE_BUSINESS_ID}&select=*`);
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
    await sbInsert('punch_reviews', newReviews);

    // 10. Clone dashboard_widgets (no employee refs, straightforward copy)
    const widgets = await sbGet(`dashboard_widgets?business_id=eq.${TEMPLATE_BUSINESS_ID}&select=*`);
    const newWidgets = widgets.map((w) => {
      const { id, created_at: _ca, ...rest } = w;
      return { ...rest, id: randomUUID(), business_id: newBusinessId };
    });
    await sbInsert('dashboard_widgets', newWidgets);

    return res.status(200).json({ business_id: newBusinessId });
  } catch (err) {
    console.error('Demo clone failed:', err);
    // Best-effort cleanup: if the business row was created but a later step
    // failed, delete it rather than leaving a broken, incomplete sandbox
    // behind for resolveDemoBusinessId() to mistakenly reuse later.
    if (newBusinessId) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/businesses?id=eq.${newBusinessId}`, {
          method: 'DELETE',
          headers: { ...HEADERS, Prefer: 'return=minimal' },
        });
      } catch (cleanupErr) {
        console.error('Failed to clean up partial clone:', cleanupErr);
      }
    }
    return res.status(500).json({ error: 'Failed to create demo sandbox', details: err.message });
  }
}
