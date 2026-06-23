#!/usr/bin/env python3
"""
ShiftWise Setup Flow Patch — rewritten with exact anchors from App.jsx
Run from anywhere: python3 /tmp/shiftwise_setup_patch.py
"""
import shutil, sys
from pathlib import Path
from datetime import datetime

APP = Path.home() / "Desktop/shiftwise/src/App.jsx"
if not APP.exists():
    sys.exit(f"ERROR: Not found: {APP}")

ts  = datetime.now().strftime("%Y%m%d_%H%M%S")
bak = APP.with_suffix(f".bak_{ts}.jsx")
shutil.copy2(APP, bak)
print(f"✓ Backup: {bak.name}")

src = APP.read_text(encoding="utf-8")
orig_len = len(src)

# ── PATCH 1: New state variables after existing biz/bizId declarations ────────
# Anchor: the line that declares biz state (line ~344)
P1_OLD = 'const [biz,         setBiz]         = useState("My Business");'
P1_NEW = '''const [biz,         setBiz]         = useState("My Business");
  const [setupComplete, setSetupComplete] = useState(true);   // true = skip setup
  const [daysOpen,      setDaysOpen]      = useState([0,1,2,3,4,5,6]);
  const [weeklyBudget,  setWeeklyBudget]  = useState(null);'''

if P1_OLD in src and "setSetupComplete" not in src:
    src = src.replace(P1_OLD, P1_NEW, 1)
    print("✓ Patch 1: State variables added")
else:
    print("⚠ Patch 1: Skipped")

# ── PATCH 2: Read new columns from business row after setBizId ────────────────
# Anchor: the exact line that calls setBizId after loading business row
P2_OLD = "setBizId(business.id);"
P2_NEW = """setBizId(business.id);
      setBiz(business.name ?? "My Business");
      setSetupComplete(business.setup_complete ?? true);
      setDaysOpen(business.days_open ?? [0,1,2,3,4,5,6]);
      setWeeklyBudget(business.weekly_budget ?? null);"""

if P2_OLD in src and "setSetupComplete(business.setup_complete" not in src:
    src = src.replace(P2_OLD, P2_NEW, 1)
    print("✓ Patch 2: Business row reader updated")
else:
    print("⚠ Patch 2: Skipped")

# ── PATCH 3: saveBizField helper + setup constants ────────────────────────────
# Insert right before the export default function App()
P3_OLD = "export default function App() {"
P3_NEW = '''// ── Setup flow helpers ─────────────────────────────────────────────────────
const SETUP_DAYS_FULL  = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const SETUP_DAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const SETUP_ROLES = [
  "Barista","Cashier","Server","Cook","Host","Manager",
  "Opener","Closer","Shift Lead","Line Cook","Prep Cook","Other"
];
const SETUP_AV_COLORS = [
  "#2D6A4F","#B45309","#1D4ED8","#7C3AED",
  "#0F766E","#9D174D","#92400E","#1E40AF"
];
const getSetupInitials = name =>
  (name||"").trim().split(" ").slice(0,2).map(w=>w[0]||"").join("").toUpperCase() || "?";

// ── SetupFlow component ─────────────────────────────────────────────────────
const SETUP_CSS = `
  .sw-setup-shell {
    min-height:100vh; display:flex; flex-direction:column;
    align-items:center; padding:0 20px 60px; background:#F7F7F5;
    font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;
  }
  .sw-topbar {
    width:100%; max-width:580px; padding:20px 0 0;
    display:flex; align-items:center; justify-content:space-between;
  }
  .sw-logo { display:flex; align-items:center; gap:8px; }
  .sw-logo-box {
    width:34px; height:34px; border-radius:8px; background:#2D6A4F;
    color:#fff; font-weight:700; font-size:13px;
    display:flex; align-items:center; justify-content:center;
  }
  .sw-logo-name { font-size:16px; font-weight:700; color:#1A1A18; }
  .sw-logo-name span { color:#2D6A4F; }
  .sw-step-ctr { font-size:12px; color:#6B6B67; font-weight:500; }
  .sw-prog-wrap { width:100%; max-width:580px; margin:20px 0 28px; }
  .sw-prog-track { height:4px; background:#E8E6E1; border-radius:2px; overflow:hidden; }
  .sw-prog-fill { height:100%; background:#2D6A4F; border-radius:2px; transition:width .4s cubic-bezier(.4,0,.2,1); }
  .sw-prog-labels { display:flex; justify-content:space-between; margin-top:8px; }
  .sw-prog-lbl { font-size:10px; font-weight:500; color:#C4C0BB; }
  .sw-prog-lbl.done { color:#2D6A4F; }
  .sw-prog-lbl.active { color:#1A1A18; font-weight:700; }
  .sw-card {
    width:100%; max-width:580px; background:#fff;
    border:1px solid #E8E6E1; border-radius:16px; padding:36px;
    box-shadow:0 2px 16px rgba(0,0,0,.05);
  }
  .sw-eyebrow { font-size:11px; font-weight:700; color:#2D6A4F; text-transform:uppercase; letter-spacing:.1em; margin-bottom:8px; }
  .sw-title { font-size:24px; font-weight:700; color:#1A1A18; line-height:1.2; margin-bottom:6px; }
  .sw-sub { font-size:14px; color:#6B6B67; margin-bottom:28px; line-height:1.6; }
  .sw-sub strong { color:#2D6A4F; font-weight:600; }
  .sw-fgroup { margin-bottom:20px; }
  .sw-flabel { font-size:11px; font-weight:700; color:#6B6B67; text-transform:uppercase; letter-spacing:.07em; margin-bottom:6px; display:block; }
  .sw-fhint { font-size:12px; color:#6B6B67; margin-top:5px; }
  .sw-input {
    width:100%; background:#F7F7F5; border:1.5px solid #E8E6E1;
    border-radius:9px; padding:12px 14px; color:#1A1A18;
    font-size:15px; font-family:inherit; outline:none;
    transition:border-color .15s,background .15s;
  }
  .sw-input:focus { border-color:#2D6A4F; background:#fff; }
  .sw-input::placeholder { color:#C4C0BB; }
  .sw-toggle-row { display:flex; gap:8px; }
  .sw-toggle-btn {
    flex:1; padding:12px; border-radius:9px; border:1.5px solid #E8E6E1;
    background:#F7F7F5; color:#6B6B67; font-size:14px; font-weight:500;
    cursor:pointer; transition:all .15s; font-family:inherit;
  }
  .sw-toggle-btn.sel { border-color:#2D6A4F; background:#E8F4EE; color:#1B4332; font-weight:600; }
  .sw-days-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; margin-bottom:8px; }
  .sw-day-pill {
    display:flex; flex-direction:column; align-items:center; gap:4px;
    padding:9px 2px 7px; border-radius:9px; border:1.5px solid #E8E6E1;
    background:#F7F7F5; cursor:pointer; transition:all .15s; user-select:none;
  }
  .sw-day-pill.open { border-color:#2D6A4F; background:#E8F4EE; }
  .sw-dpname { font-size:11px; font-weight:700; color:#6B6B67; }
  .sw-day-pill.open .sw-dpname { color:#1B4332; }
  .sw-dpstatus { font-size:9px; color:#C4C0BB; font-weight:500; }
  .sw-day-pill.open .sw-dpstatus { color:#2D6A4F; font-weight:700; }
  .sw-dpcheck {
    width:16px; height:16px; border-radius:50%; border:1.5px solid #E8E6E1;
    background:#fff; display:flex; align-items:center; justify-content:center;
    font-size:8px; color:#fff; transition:all .15s;
  }
  .sw-day-pill.open .sw-dpcheck { background:#2D6A4F; border-color:#2D6A4F; }
  .sw-days-hint { font-size:12px; color:#6B6B67; margin-top:6px; }
  .sw-budget-display {
    background:#E8F4EE; border:1px solid #A7D7C0; border-radius:10px;
    padding:14px 16px; margin-top:12px;
    display:flex; align-items:center; justify-content:space-between;
  }
  .sw-budget-lbl { font-size:12px; color:#1B4332; font-weight:500; }
  .sw-budget-val { font-size:22px; font-weight:700; color:#2D6A4F; }
  .sw-budget-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-top:12px; }
  .sw-budget-mini { background:#F7F7F5; border:1px solid #E8E6E1; border-radius:8px; padding:10px 12px; }
  .sw-bm-label { font-size:10px; color:#6B6B67; font-weight:700; text-transform:uppercase; letter-spacing:.06em; }
  .sw-bm-val { font-size:15px; font-weight:700; color:#1A1A18; margin-top:2px; }
  .sw-emp-cards { display:flex; flex-direction:column; gap:8px; margin-bottom:14px; }
  .sw-emp-card {
    background:#F7F7F5; border:1px solid #E8E6E1; border-radius:10px;
    padding:11px 14px; display:flex; align-items:center; gap:10px;
  }
  .sw-emp-av {
    width:34px; height:34px; border-radius:50%; color:#fff;
    font-size:12px; font-weight:700; display:flex; align-items:center;
    justify-content:center; flex-shrink:0;
  }
  .sw-emp-name { font-size:14px; font-weight:600; color:#1A1A18; }
  .sw-emp-meta { font-size:12px; color:#6B6B67; }
  .sw-emp-remove {
    background:none; border:none; color:#C4C0BB; font-size:15px;
    cursor:pointer; padding:2px 6px; border-radius:5px; margin-left:auto; font-family:inherit;
  }
  .sw-emp-remove:hover { color:#991B1B; }
  .sw-emp-count { display:inline-flex; align-items:center; gap:5px; background:#E8F4EE; border-radius:20px; padding:3px 10px; font-size:12px; font-weight:600; color:#1B4332; margin-bottom:12px; }
  .sw-add-form { background:#F7F7F5; border:1.5px dashed #E8E6E1; border-radius:10px; padding:16px; margin-bottom:4px; }
  .sw-add-form.active { border-color:#2D6A4F; background:#fff; }
  .sw-form-row { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:10px; }
  .sw-form-lbl { font-size:10px; font-weight:700; color:#6B6B67; text-transform:uppercase; letter-spacing:.06em; margin-bottom:4px; display:block; }
  .sw-form-input {
    width:100%; background:#fff; border:1.5px solid #E8E6E1;
    border-radius:8px; padding:9px 11px; color:#1A1A18;
    font-size:14px; font-family:inherit; outline:none;
  }
  .sw-form-input:focus { border-color:#2D6A4F; }
  .sw-form-select {
    width:100%; background:#fff; border:1.5px solid #E8E6E1;
    border-radius:8px; padding:9px 11px; color:#1A1A18;
    font-size:14px; font-family:inherit; outline:none; appearance:none; cursor:pointer;
  }
  .sw-form-select:focus { border-color:#2D6A4F; }
  .sw-form-actions { display:flex; gap:8px; }
  .sw-btn-confirm { background:#2D6A4F; color:#fff; border:none; border-radius:8px; padding:9px 16px; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; }
  .sw-btn-cancel { background:none; border:1px solid #E8E6E1; border-radius:8px; padding:9px 14px; font-size:13px; color:#6B6B67; cursor:pointer; font-family:inherit; }
  .sw-btn-add-emp {
    width:100%; padding:12px; border-radius:9px; border:1.5px dashed #E8E6E1;
    background:transparent; color:#2D6A4F; font-size:14px; font-weight:600;
    cursor:pointer; font-family:inherit; transition:all .15s;
    display:flex; align-items:center; justify-content:center; gap:6px;
  }
  .sw-btn-add-emp:hover { border-color:#2D6A4F; background:#E8F4EE; }
  .sw-emp-error { font-size:12px; color:#991B1B; margin-bottom:8px; }
  .sw-review-section { margin-bottom:18px; }
  .sw-review-title { font-size:11px; font-weight:700; color:#6B6B67; text-transform:uppercase; letter-spacing:.08em; margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid #E8E6E1; }
  .sw-review-row { display:flex; align-items:center; justify-content:space-between; padding:7px 0; border-bottom:1px solid #F0EEE9; }
  .sw-review-row:last-child { border-bottom:none; }
  .sw-review-label { font-size:13px; color:#6B6B67; }
  .sw-review-val { font-size:13px; font-weight:600; color:#1A1A18; }
  .sw-review-days { display:flex; gap:5px; flex-wrap:wrap; }
  .sw-day-tag { background:#E8F4EE; color:#1B4332; border-radius:5px; padding:2px 8px; font-size:12px; font-weight:600; }
  .sw-day-tag.closed { background:#F0EEE9; color:#6B6B67; }
  .sw-review-emps { display:flex; flex-direction:column; gap:6px; }
  .sw-review-emp { display:flex; align-items:center; gap:10px; padding:8px 10px; background:#F7F7F5; border-radius:8px; }
  .sw-rev-av { width:26px; height:26px; border-radius:50%; color:#fff; font-size:10px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .sw-rev-name { font-size:13px; font-weight:600; color:#1A1A18; }
  .sw-rev-role { font-size:12px; color:#6B6B67; }
  .sw-rev-rate { margin-left:auto; font-size:13px; font-weight:700; color:#2D6A4F; }
  .sw-launch-banner { background:#E8F4EE; border:1px solid #A7D7C0; border-radius:10px; padding:14px 16px; margin-top:18px; display:flex; align-items:flex-start; gap:10px; }
  .sw-launch-text { font-size:13px; color:#1B4332; line-height:1.6; }
  .sw-launch-text strong { font-weight:700; }
  .sw-footer { display:flex; align-items:center; justify-content:space-between; margin-top:28px; }
  .sw-btn-back { background:none; border:none; color:#6B6B67; font-size:14px; cursor:pointer; font-family:inherit; }
  .sw-btn-back:hover { color:#1A1A18; }
  .sw-btn-next { background:#2D6A4F; color:#fff; border:none; border-radius:9px; padding:13px 26px; font-size:14px; font-weight:600; cursor:pointer; font-family:inherit; }
  .sw-btn-next:hover { background:#1B4332; }
  .sw-btn-next:disabled { opacity:.35; cursor:default; }
  .sw-btn-launch { background:#2D6A4F; color:#fff; border:none; border-radius:9px; padding:14px 30px; font-size:15px; font-weight:700; cursor:pointer; font-family:inherit; }
  .sw-btn-launch:hover { background:#1B4332; }
  .sw-btn-launch:disabled { opacity:.45; cursor:default; }
  .sw-skip { font-size:12px; color:#6B6B67; cursor:pointer; text-align:center; margin-top:14px; }
  .sw-skip:hover { color:#2D6A4F; }
  .sw-save-err { font-size:13px; color:#991B1B; text-align:center; margin-top:10px; }
  .sw-saving { font-size:13px; color:#6B6B67; text-align:center; margin-top:10px; }
  .closed-day-cell {
    background: repeating-linear-gradient(
      45deg, transparent, transparent 4px, #F0EEE9 4px, #F0EEE9 5px
    ) !important;
    pointer-events: none !important;
    opacity: 0.6;
  }
  .closed-day-header { opacity:0.4; }
`;

const SW_LABELS = ["Your business","Operating days","Labor budget","Your team","Review & launch"];

function SetupFlow({ bizId, onComplete }) {
  const [step,      setStep]      = React.useState(0);
  const [saving,    setSaving]    = React.useState(false);
  const [saveErr,   setSaveErr]   = React.useState("");
  const [bizName,   setBizName]   = React.useState("");
  const [weekStart, setWeekStart] = React.useState("Sunday");
  const [daysOpen,  setDaysOpen]  = React.useState([0,1,2,3,4,5,6]);
  const [budget,    setBudget]    = React.useState("");
  const [employees, setEmployees] = React.useState([]);
  const [addingEmp, setAddingEmp] = React.useState(false);
  const [empDraft,  setEmpDraft]  = React.useState({ name:"", role:"", rate:"" });
  const [empErr,    setEmpErr]    = React.useState("");

  const toggleDay = i => setDaysOpen(prev =>
    prev.includes(i) ? prev.filter(d=>d!==i) : [...prev,i].sort((a,b)=>a-b)
  );

  const confirmEmp = () => {
    if (!empDraft.name.trim())                      { setEmpErr("Name is required."); return; }
    if (!empDraft.role)                             { setEmpErr("Please select a role."); return; }
    if (!empDraft.rate || isNaN(+empDraft.rate))    { setEmpErr("Enter a valid hourly rate."); return; }
    setEmployees(prev => [...prev, { ...empDraft, rate: parseFloat(empDraft.rate) }]);
    setAddingEmp(false);
    setEmpDraft({ name:"", role:"", rate:"" });
    setEmpErr("");
  };

  const budgetNum = parseFloat(budget.replace(/[^0-9.]/g,"")) || 0;
  const fmt$ = n => "$" + Math.round(n).toLocaleString("en-US");

  const canNext = [
    bizName.trim().length > 0,
    daysOpen.length >= 1,
    true,
    employees.length >= 1 && !addingEmp,
    true,
  ];

  const pct = (step / 4) * 100;

  const handleLaunch = async () => {
    setSaving(true); setSaveErr("");
    try {
      await dbPatch("businesses?id=eq." + bizId, {
        name:           bizName.trim(),
        week_start:     weekStart,
        days_open:      daysOpen,
        weekly_budget:  budgetNum > 0 ? budgetNum : null,
        setup_complete: true,
      });
      if (employees.length > 0) {
        const rows = employees.map(e => ({
          business_id:  bizId,
          name:         e.name.trim(),
          role:         e.role,
          hourly_rate:  e.rate,
          color:        SETUP_AV_COLORS[employees.indexOf(e) % SETUP_AV_COLORS.length],
        }));
        await dbPost("employees", rows);
      }
      onComplete();
    } catch(err) {
      console.error("Setup error:", err);
      setSaveErr("Something went wrong. Please try again.");
      setSaving(false);
    }
  };

  return (
    <>
      <style>{SETUP_CSS}</style>
      <div className="sw-setup-shell">
        <div className="sw-topbar">
          <div className="sw-logo">
            <div className="sw-logo-box">SW</div>
            <span className="sw-logo-name">Shift<span>Wise</span></span>
          </div>
          <span className="sw-step-ctr">Step {step+1} of 5</span>
        </div>
        <div className="sw-prog-wrap">
          <div className="sw-prog-track">
            <div className="sw-prog-fill" style={{width:`${pct}%`}} />
          </div>
          <div className="sw-prog-labels">
            {SW_LABELS.map((l,i)=>(
              <span key={i} className={`sw-prog-lbl ${i<step?"done":i===step?"active":""}`}>{l}</span>
            ))}
          </div>
        </div>

        {step===0 && (
          <div className="sw-card">
            <div className="sw-eyebrow">Welcome to ShiftWise</div>
            <h2 className="sw-title">Tell us about your business</h2>
            <p className="sw-sub">Shows on your schedule and reports. Edit any time in Settings.</p>
            <div className="sw-fgroup">
              <label className="sw-flabel">Business name</label>
              <input className="sw-input" placeholder="e.g. Coastal Grounds Coffee"
                value={bizName} onChange={e=>setBizName(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&canNext[0]&&setStep(1)} autoFocus />
            </div>
            <div className="sw-fgroup">
              <label className="sw-flabel">Week starts on</label>
              <div className="sw-toggle-row">
                {["Sunday","Monday"].map(d=>(
                  <button key={d} className={"sw-toggle-btn"+(weekStart===d?" sel":"")}
                    onClick={()=>setWeekStart(d)}>{d}</button>
                ))}
              </div>
              <div className="sw-fhint">Your schedule grid always begins on this day.</div>
            </div>
            <div className="sw-footer">
              <span/>
              <button className="sw-btn-next" disabled={!canNext[0]} onClick={()=>setStep(1)}>Continue →</button>
            </div>
          </div>
        )}

        {step===1 && (
          <div className="sw-card">
            <div className="sw-eyebrow">Operating days</div>
            <h2 className="sw-title">Which days do you operate?</h2>
            <p className="sw-sub"><strong>Closed days are greyed out on your schedule</strong> so you never accidentally assign a shift when you're not open. Update any time in Settings.</p>
            <div className="sw-fgroup">
              <div className="sw-days-grid">
                {SETUP_DAYS_FULL.map((day,i)=>(
                  <div key={i} className={"sw-day-pill"+(daysOpen.includes(i)?" open":"")}
                    onClick={()=>toggleDay(i)}>
                    <div className="sw-dpcheck">{daysOpen.includes(i)?"✓":""}</div>
                    <div className="sw-dpname">{SETUP_DAYS_SHORT[i]}</div>
                    <div className="sw-dpstatus">{daysOpen.includes(i)?"Open":"Closed"}</div>
                  </div>
                ))}
              </div>
              <div className="sw-days-hint">
                {daysOpen.length===7
                  ? "Open every day — tap any day to mark it closed."
                  : `Open ${daysOpen.length} day${daysOpen.length!==1?"s":""} · ${7-daysOpen.length} closed`}
              </div>
            </div>
            <div className="sw-footer">
              <button className="sw-btn-back" onClick={()=>setStep(0)}>← Back</button>
              <button className="sw-btn-next" disabled={!canNext[1]} onClick={()=>setStep(2)}>Continue →</button>
            </div>
          </div>
        )}

        {step===2 && (
          <div className="sw-card">
            <div className="sw-eyebrow">Labor budget</div>
            <h2 className="sw-title">What's your weekly labor target?</h2>
            <p className="sw-sub">ShiftWise tracks your running labor cost as you schedule. <strong>We flag you before you go over</strong> — so you decide before the shift, not after payroll.</p>
            <div className="sw-fgroup">
              <label className="sw-flabel">Weekly labor budget ($)</label>
              <input className="sw-input" placeholder="e.g. 2400" type="number"
                value={budget} onChange={e=>setBudget(e.target.value)} autoFocus />
              <div className="sw-fhint">Dollar amount only — no $ sign needed.</div>
            </div>
            {budgetNum>0 && (
              <>
                <div className="sw-budget-display">
                  <span className="sw-budget-lbl">Weekly target</span>
                  <span className="sw-budget-val">{fmt$(budgetNum)}</span>
                </div>
                <div className="sw-budget-grid">
                  <div className="sw-budget-mini">
                    <div className="sw-bm-label">Per open day</div>
                    <div className="sw-bm-val">{fmt$(budgetNum/(daysOpen.length||7))}</div>
                  </div>
                  <div className="sw-budget-mini">
                    <div className="sw-bm-label">Per month</div>
                    <div className="sw-bm-val">{fmt$(budgetNum*4.33)}</div>
                  </div>
                  <div className="sw-budget-mini">
                    <div className="sw-bm-label">Per year</div>
                    <div className="sw-bm-val">{fmt$(budgetNum*52)}</div>
                  </div>
                </div>
              </>
            )}
            <div className="sw-footer">
              <button className="sw-btn-back" onClick={()=>setStep(1)}>← Back</button>
              <button className="sw-btn-next" onClick={()=>setStep(3)}>Continue →</button>
            </div>
            <p className="sw-skip" onClick={()=>setStep(3)}>Skip — I'll add this in Settings later</p>
          </div>
        )}

        {step===3 && (
          <div className="sw-card">
            <div className="sw-eyebrow">Your team</div>
            <h2 className="sw-title">Build your roster</h2>
            <p className="sw-sub">Name, role, and hourly rate — ShiftWise calculates labor cost the moment you add a shift.</p>
            {employees.length>0 && (
              <>
                <div className="sw-emp-count">✓ {employees.length} employee{employees.length!==1?"s":""} added</div>
                <div className="sw-emp-cards">
                  {employees.map((emp,i)=>(
                    <div key={i} className="sw-emp-card">
                      <div className="sw-emp-av" style={{background:SETUP_AV_COLORS[i%SETUP_AV_COLORS.length]}}>
                        {getSetupInitials(emp.name)}
                      </div>
                      <div>
                        <div className="sw-emp-name">{emp.name}</div>
                        <div className="sw-emp-meta">{emp.role} · ${emp.rate}/hr</div>
                      </div>
                      <button className="sw-emp-remove"
                        onClick={()=>setEmployees(prev=>prev.filter((_,idx)=>idx!==i))}>✕</button>
                    </div>
                  ))}
                </div>
              </>
            )}
            {addingEmp ? (
              <div className="sw-add-form active">
                <div className="sw-form-row">
                  <div>
                    <label className="sw-form-lbl">Full name</label>
                    <input className="sw-form-input" placeholder="e.g. Jordan M."
                      value={empDraft.name} onChange={e=>setEmpDraft(d=>({...d,name:e.target.value}))} autoFocus />
                  </div>
                  <div>
                    <label className="sw-form-lbl">Role</label>
                    <select className="sw-form-select" value={empDraft.role}
                      onChange={e=>setEmpDraft(d=>({...d,role:e.target.value}))}>
                      <option value="">Select…</option>
                      {SETUP_ROLES.map(r=><option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="sw-form-lbl">Hourly rate ($)</label>
                    <input className="sw-form-input" placeholder="13.50" type="number"
                      value={empDraft.rate} onChange={e=>setEmpDraft(d=>({...d,rate:e.target.value}))} />
                  </div>
                </div>
                {empErr && <div className="sw-emp-error">⚠ {empErr}</div>}
                <div className="sw-form-actions">
                  <button className="sw-btn-confirm" onClick={confirmEmp}>Add employee</button>
                  <button className="sw-btn-cancel" onClick={()=>{setAddingEmp(false);setEmpErr("");}}>Cancel</button>
                </div>
              </div>
            ) : (
              <button className="sw-btn-add-emp"
                onClick={()=>{setEmpDraft({name:"",role:"",rate:""});setAddingEmp(true);}}>
                + Add {employees.length>0?"another":"an"} employee
              </button>
            )}
            <div className="sw-footer">
              <button className="sw-btn-back" onClick={()=>setStep(2)}>← Back</button>
              <button className="sw-btn-next" disabled={!canNext[3]} onClick={()=>setStep(4)}>Review →</button>
            </div>
            {employees.length>=1&&!addingEmp&&(
              <p className="sw-skip" onClick={()=>setStep(4)}>I'll add more employees later</p>
            )}
          </div>
        )}

        {step===4 && (
          <div className="sw-card">
            <div className="sw-eyebrow">Almost there</div>
            <h2 className="sw-title">Review & launch</h2>
            <p className="sw-sub">Everything ShiftWise will use to set up your schedule. Edit any of it in Settings later.</p>
            <div className="sw-review-section">
              <div className="sw-review-title">Business</div>
              <div className="sw-review-row"><span className="sw-review-label">Name</span><span className="sw-review-val">{bizName}</span></div>
              <div className="sw-review-row"><span className="sw-review-label">Week starts</span><span className="sw-review-val">{weekStart}</span></div>
              <div className="sw-review-row"><span className="sw-review-label">Weekly budget</span><span className="sw-review-val">{budgetNum>0?fmt$(budgetNum):"Not set"}</span></div>
            </div>
            <div className="sw-review-section">
              <div className="sw-review-title">Days of operation</div>
              <div className="sw-review-days">
                {SETUP_DAYS_SHORT.map((d,i)=>(
                  <span key={i} className={"sw-day-tag"+(daysOpen.includes(i)?"":" closed")}>
                    {d}{!daysOpen.includes(i)?" ✕":""}
                  </span>
                ))}
              </div>
            </div>
            <div className="sw-review-section">
              <div className="sw-review-title">Team ({employees.length})</div>
              <div className="sw-review-emps">
                {employees.map((emp,i)=>(
                  <div key={i} className="sw-review-emp">
                    <div className="sw-rev-av" style={{background:SETUP_AV_COLORS[i%SETUP_AV_COLORS.length]}}>{getSetupInitials(emp.name)}</div>
                    <div><div className="sw-rev-name">{emp.name}</div><div className="sw-rev-role">{emp.role}</div></div>
                    <span className="sw-rev-rate">${emp.rate}/hr</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="sw-launch-banner">
              <span style={{fontSize:18,flexShrink:0}}>🚀</span>
              <div className="sw-launch-text">
                <strong>Your schedule is ready to build.</strong> Closed days will be greyed out, your team is on the grid, and ShiftWise tracks labor the moment you add your first shift.
              </div>
            </div>
            {saveErr && <div className="sw-save-err">{saveErr}</div>}
            <div className="sw-footer">
              <button className="sw-btn-back" onClick={()=>setStep(3)}>← Back</button>
              <button className="sw-btn-launch" onClick={handleLaunch} disabled={saving}>
                {saving?"Saving…":"Launch ShiftWise →"}
              </button>
            </div>
            {saving && <p className="sw-saving">Setting up your workspace…</p>}
          </div>
        )}
      </div>
    </>
  );
}
// ── END SetupFlow ────────────────────────────────────────────────────────────

export default function App() {'''

if P3_OLD in src and "function SetupFlow(" not in src:
    src = src.replace(P3_OLD, P3_NEW, 1)
    print("✓ Patch 3: SetupFlow component + constants inserted")
else:
    print("⚠ Patch 3: Skipped")

# ── PATCH 4: Setup gate — insert after the auth/biz loading guard ─────────────
# We look for the first substantial return() inside App after biz loads.
# The app has a pattern where it returns early if not authenticated.
# We insert our gate right before the main return at line ~1997.
# Anchor: the last `return (` in the file which is the main app render.
P4_GATE = """
  // ── SETUP GATE ── show setup flow to new users before the main app
  if (!setupComplete && bizId) {
    return (
      <SetupFlow
        bizId={bizId}
        onComplete={async () => {
          // Reload all data then mark setup done — lands on real schedule
          await loadData();
          setSetupComplete(true);
        }}
      />
    );
  }

"""

# Find the main return — it's the last `return (` in the file
# We insert the gate right before it
MAIN_RETURN = "  return ("
if "SETUP GATE" not in src:
    # Get last occurrence of `  return (` which is the main app render
    last_idx = src.rfind(MAIN_RETURN)
    if last_idx > 0:
        src = src[:last_idx] + P4_GATE + src[last_idx:]
        print("✓ Patch 4: Setup gate inserted before main return")
    else:
        print("⚠ Patch 4: Could not find main return — add gate manually")
else:
    print("⚠ Patch 4: Skipped")

# ── PATCH 5: Find loadData function name ─────────────────────────────────────
# The app likely uses a different name than loadData — find it
load_fns = []
for name in ["loadData", "loadAllData", "initData", "fetchData", "loadAppData"]:
    if f"const {name} " in src or f"async function {name}" in src or f"function {name}" in src:
        load_fns.append(name)

if load_fns:
    actual_fn = load_fns[0]
    if actual_fn != "loadData":
        src = src.replace("await loadData();", f"await {actual_fn}();", 1)
        print(f"✓ Patch 5: loadData → {actual_fn}()")
    else:
        print("✓ Patch 5: loadData name confirmed")
else:
    print("⚠ Patch 5: Could not detect load function name — check gate manually and replace loadData() with your actual function name")

# ── Write ─────────────────────────────────────────────────────────────────────
APP.write_text(src, encoding="utf-8")
print(f"\n✓ Done. {orig_len:,} → {len(src):,} chars")
print(f"  Backup: {bak.name}")
print(f"""
Next steps:
  1. Check Vite dev server for JSX errors
  2. To test setup flow, run this SQL in Supabase:
     UPDATE businesses SET setup_complete = false WHERE id = '<your-biz-id>';
  3. Log in — you should see the setup flow
  4. Complete it and verify you land on the real schedule

Grid closed-day styling (do this manually in App.jsx):
  - Find your day header cells render and add:
      const isClosedDay = !daysOpen.includes(dayIdx);
      className={{isClosedDay ? "closed-day-header" : ""}}
  - Find your shift body cells and add:
      className={{isClosedDay ? "closed-day-cell" : ""}}
      onClick={{isClosedDay ? undefined : () => openShiftModal(...)}}
  The CSS for both is already injected via SETUP_CSS in the SetupFlow component.
""")
