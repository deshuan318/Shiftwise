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

const PAGE = 1000;   // Supabase returns at most 1,000 rows per request
const CHUNK = 500;   // rows per insert request

// Reads EVERY row (pages past Supabase's 1,000-row cap — the old version
// silently stopped at 1,000, which could cut off punches and sales).
async function sbGetAll(path) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}${sep}limit=${PAGE}&offset=${offset}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
    const page = await res.json();
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

async function sbInsert(table, rows) {
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  for (let i = 0; i < list.length; i += CHUNK) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify(list.slice(i, i + CHUNK)),
    });
    if (!res.ok) throw new Error(`INSERT ${table} failed: ${res.status} ${await res.text()}`);
  }
}

// Swaps any old employee / week / shift / punch id for its new id, anywhere in
// the row — plain columns and inside JSON (templates, exit summaries, etc.).
function remapDeep(value, idMap) {
  if (typeof value === 'string') return idMap[value] || value;
  if (Array.isArray(value)) return value.map((v) => remapDeep(v, idMap));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = remapDeep(v, idMap);
    return out;
  }
  return value;
}

// Copies every row of a table from the template to the new business.
// Each row gets a new id; references to cloned rows are remapped.
async function cloneTable(table, newBusinessId, idMap, { keepIdMap, order } = {}) {
  const rows = await sbGetAll(`${table}?business_id=eq.${TEMPLATE_BUSINESS_ID}&select=*${order ? `&order=${order}` : ''}`);
  const out = rows.map((r) => {
    const { id, created_at: _ca, updated_at: _ua, ...rest } = r;
    const remapped = remapDeep(rest, idMap);
    // Rows other tables point at get a known new id; everything else lets the
    // database assign one (works whether the table uses uuid or serial ids).
    if (keepIdMap && id !== undefined) {
      const newId = randomUUID();
      keepIdMap[id] = newId;
      return { ...remapped, id: newId, business_id: newBusinessId };
    }
    return { ...remapped, business_id: newBusinessId };
  });
  await sbInsert(table, out);
  return rows.length;
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
    const idMap = {}; // old id -> new id, for employees, weeks, shifts, punches

    // 1. Business row (select=* so new columns — phone, season, etc. — come along)
    const [templateBiz] = await sbGetAll(`businesses?id=eq.${TEMPLATE_BUSINESS_ID}&select=*`);
    if (!templateBiz) throw new Error('Template business not found — check TEMPLATE_BUSINESS_ID');
    const { id: _oldId, created_at, updated_at, is_template, ...bizRest } = templateBiz;
    await sbInsert('businesses', {
      ...bizRest,
      id: newBusinessId,
      owner_id: DEMO_OWNER_ID,
      is_demo: true,
      is_template: false,
    });

    // 2–5. Tables other rows point at — cloned in order so every id is mapped first
    await cloneTable('employees', newBusinessId, idMap, { keepIdMap: idMap });
    await cloneTable('schedule_weeks', newBusinessId, idMap, { keepIdMap: idMap });
    await cloneTable('shifts', newBusinessId, idMap, { keepIdMap: idMap });
    await cloneTable('punches', newBusinessId, idMap, { keepIdMap: idMap, order: 'punched_at.asc' });

    // 6. Everything else, in parallel. Previously cloned: published_schedules,
    //    sales_data, pulse_history, punch_reviews, dashboard_widgets.
    //    Added (were missing from the demo): hours, shift types, fixed costs,
    //    hourly + item sales, item names, price history, weather, no-shows,
    //    exit records, open shifts, templates, timesheet locks, recognition.
    const rest = [
      'published_schedules', 'sales_data', 'pulse_history', 'punch_reviews', 'dashboard_widgets',
      'business_hours', 'shift_types', 'business_costs',
      'sales_hourly', 'sales_items_daily', 'sales_item_names', 'catalog_price_history', 'daily_weather',
      'attendance_events', 'employee_exits', 'open_shifts', 'templates', 'timesheet_locks', 'recognition',
    ];
    await Promise.all(rest.map((t) => cloneTable(t, newBusinessId, idMap)));

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
