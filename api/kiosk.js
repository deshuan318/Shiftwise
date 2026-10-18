// /api/kiosk.js
// Server-side kiosk API. The kiosk never touches the database directly and
// never receives PINs or pay rates.
//
//   GET  /api/kiosk?bizId=…                         → roster + this/next week's shifts
//   POST /api/kiosk { action:"verify", bizId, empId, pin }        → today's punches
//   POST /api/kiosk { action:"punch",  bizId, empId, pin, punch } → writes the punch
//
// PINs are checked here. 5 wrong PINs for one employee locks that employee
// out for 5 minutes (tracked in kiosk_pin_attempts, service-role only).

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kyrjgfeowmflazywsuir.supabase.co";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HEADERS = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

const APP_TZ = "America/Chicago";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUNCH_TYPES = ["in", "out", "break_out", "break_in"];
const PUNCH_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const MAX_FAILS = 5;
const LOCK_MINUTES = 5;

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`GET ${path.split("?")[0]} failed: ${r.status}`);
  return r.json();
}
async function sbSend(method, path, body, prefer = "return=minimal") {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: { ...HEADERS, Prefer: prefer }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path.split("?")[0]} failed: ${r.status} ${await r.text()}`);
  return prefer.includes("representation") ? r.json() : null;
}

const localDate = d => {
  const p = {};
  new Intl.DateTimeFormat("en-US", { timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).forEach(({ type, value }) => { p[type] = value; });
  return `${p.year}-${p.month}-${p.day}`;
};

const localNow = () => {
  const p = {};
  new Intl.DateTimeFormat("en-US", { timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).forEach(({ type, value }) => { p[type] = value; });
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
};

async function loadActiveEmployee(bizId, empId) {
  const rows = await sbGet(`employees?select=id,name,pin,status,business_id&id=eq.${empId}&business_id=eq.${bizId}&limit=1`);
  const emp = rows?.[0];
  return emp && emp.status !== "inactive" ? emp : null;
}

// Returns { ok:true } or { ok:false, status, error }
async function checkPin(bizId, emp, pin) {
  if (!emp.pin) return { ok: false, status: 403, error: "no_pin" };
  const [att] = await sbGet(`kiosk_pin_attempts?select=*&employee_id=eq.${emp.id}&limit=1`);
  if (att?.locked_until && new Date(att.locked_until) > new Date()) {
    return { ok: false, status: 423, error: "locked", lockedUntil: att.locked_until };
  }
  if (String(pin) === String(emp.pin)) {
    if (att) await sbSend("DELETE", `kiosk_pin_attempts?employee_id=eq.${emp.id}`);
    return { ok: true };
  }
  const fails = (att?.failed_count || 0) + 1;
  const lock = fails >= MAX_FAILS;
  await sbSend("POST", "kiosk_pin_attempts?on_conflict=employee_id", [{
    employee_id: emp.id, business_id: bizId,
    failed_count: lock ? 0 : fails,
    locked_until: lock ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null,
    updated_at: new Date().toISOString(),
  }], "resolution=merge-duplicates,return=minimal");
  return lock
    ? { ok: false, status: 423, error: "locked" }
    : { ok: false, status: 401, error: "bad_pin", remaining: MAX_FAILS - fails };
}

async function todayPunches(empId) {
  const today = localDate(new Date());
  const rows = await sbGet(`punches?select=id,punch_type,punched_at,scheduled_start,scheduled_end,flags&employee_id=eq.${empId}&punched_at=gte.${today}T00:00:00&order=punched_at.asc`);
  return (rows || []).map(r => ({
    id: r.id, type: r.punch_type, time: r.punched_at,
    scheduled: r.scheduled_start != null ? { start: parseFloat(r.scheduled_start), end: parseFloat(r.scheduled_end) } : null,
    flags: r.flags || [],
  }));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!SERVICE_KEY) return res.status(500).json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY" });

  try {
    // ── Roster: names/colors and shifts only ─────────────────────────
    if (req.method === "GET") {
      const bizId = String(req.query.bizId || "");
      if (!UUID.test(bizId)) return res.status(400).json({ error: "Invalid business ID" });

      const [biz] = await sbGet(`businesses?select=id,name&id=eq.${bizId}&limit=1`);
      if (!biz) return res.status(404).json({ error: "Business not found" });

      // This week and later only (Sunday of the current week, minus a day of slack)
      const since = localDate(new Date(Date.now() - 8 * 86400000));
      const [empRows, weekRows] = await Promise.all([
        sbGet(`employees?select=id,name,role,color,available_days,status,pin&business_id=eq.${bizId}&order=sort_order.asc,created_at.asc`),
        sbGet(`schedule_weeks?select=id,week_start&business_id=eq.${bizId}&week_start=gte.${since}&order=week_start.asc`),
      ]);
      const wkIds = (weekRows || []).map(w => w.id);
      const shiftRows = wkIds.length
        ? await sbGet(`shifts?select=week_id,employee_id,day_index,start_dec,end_dec,shift_types&week_id=in.(${wkIds.join(",")})`)
        : [];

      const schedule = {};
      for (const row of shiftRows || []) {
        const wk = weekRows.find(w => w.id === row.week_id);
        if (!wk) continue;
        ((schedule[wk.week_start] ||= {})[row.employee_id] ||= {})[row.day_index] = {
          start: parseFloat(row.start_dec), end: parseFloat(row.end_dec), type: row.shift_types || ["regular"],
        };
      }
      return res.status(200).json({
        businessId: biz.id, businessName: biz.name || "ShiftWise",
        employees: (empRows || []).filter(e => e.status !== "inactive").map(e => ({
          id: e.id, name: e.name, role: e.role || "", color: e.color || "#2D6A4F",
          availableDays: e.available_days || [0, 1, 2, 3, 4, 5, 6], hasPin: !!e.pin,
        })),
        schedule, weeks: (weekRows || []).map(w => w.week_start),
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { action, bizId, empId, pin, punch } = req.body || {};
    if (!UUID.test(String(bizId || "")) || !UUID.test(String(empId || ""))) {
      return res.status(400).json({ error: "Invalid business or employee" });
    }
    if (!/^\d{4,6}$/.test(String(pin || ""))) return res.status(401).json({ error: "bad_pin" });

    const emp = await loadActiveEmployee(bizId, empId);
    if (!emp) return res.status(404).json({ error: "Employee not found" });

    const chk = await checkPin(bizId, emp, pin);
    if (!chk.ok) return res.status(chk.status).json({ error: chk.error, remaining: chk.remaining });

    // ── Verify PIN → today's punches ─────────────────────────────────
    if (action === "verify") {
      return res.status(200).json({ ok: true, punches: await todayPunches(emp.id) });
    }

    // ── Write a punch ─────────────────────────────────────────────────
    if (action === "punch") {
      if (!punch || !PUNCH_TYPES.includes(punch.type)) return res.status(400).json({ error: "Invalid punch type" });
      if (punch.time && !PUNCH_TIME.test(punch.time)) return res.status(400).json({ error: "Invalid punch time" });
      // Queued offline punches keep their original time, but never more than 3 days back or in the future
      if (punch.time) {
        const t = new Date(punch.time + "Z").getTime(), nowLocal = new Date(localDate(new Date()) + "T23:59:59Z").getTime();
        if (t > nowLocal + 86400000 || t < nowLocal - 4 * 86400000) return res.status(400).json({ error: "Punch time out of range" });
      }
      const flags = Array.isArray(punch.flags) ? punch.flags.filter(f => typeof f === "string").slice(0, 10) : [];
      const sch = punch.scheduled && isFinite(punch.scheduled.start) && isFinite(punch.scheduled.end) ? punch.scheduled : null;
      await sbSend("POST", "punches", {
        business_id: bizId, employee_id: emp.id, employee_name: emp.name,
        punch_type: punch.type, punched_at: punch.time || localNow(),
        scheduled_start: sch ? sch.start : null, scheduled_end: sch ? sch.end : null, flags,
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    console.error("kiosk api error:", err);
    return res.status(500).json({ error: "Kiosk server error" });
  }
}
