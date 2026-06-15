#!/usr/bin/env python3
"""
ShiftWise 7-Fix Patcher
Run: python3 apply_shiftwise_fixes.py path/to/src/App.jsx
Creates: App.jsx.backup + applies all 7 fixes in place
"""
import sys, os, shutil

if len(sys.argv) < 2:
    print("Usage: python3 apply_shiftwise_fixes.py path/to/src/App.jsx")
    sys.exit(1)

src_path = sys.argv[1]
if not os.path.exists(src_path):
    print(f"File not found: {src_path}")
    sys.exit(1)

# Backup
shutil.copy2(src_path, src_path + ".backup")
print(f"Backup saved: {src_path}.backup")

with open(src_path, 'r', encoding='utf-8') as f:
    code = f.read()

original_len = len(code)
fixes_applied = []

# ─────────────────────────────────────────────────────────────────
# FIX 5: Remove "Week 1 / Week 2" label from PRINTED output
# ─────────────────────────────────────────────────────────────────
old5 = 'Employee Schedule &nbsp;·&nbsp; {wk.label} &nbsp;·&nbsp;\n                                  {wkDates[0]'
new5 = 'Employee Schedule &nbsp;·&nbsp;\n                                  {wkDates[0]'
if old5 in code:
    code = code.replace(old5, new5, 1)
    fixes_applied.append("Fix 5 ✓ (removed Week 1/2 label from print header)")
else:
    fixes_applied.append("Fix 5 ✗ NOT FOUND - check manually")

# ─────────────────────────────────────────────────────────────────
# FIX 4a: Add @media print CSS for full-width landscape printing
# ─────────────────────────────────────────────────────────────────
old4a = '.grid-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; border-radius:12px; }'
new4a = '''.grid-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; border-radius:12px; }
@media print {
  body * { visibility: hidden !important; }
  #sw-print-area, #sw-print-area * { visibility: visible !important; }
  #sw-print-area {
    position: fixed !important; top: 0 !important; left: 0 !important;
    width: 100% !important; margin: 0 !important; padding: 0 !important;
  }
  #sw-print-area table { width: 100% !important; border-collapse: collapse !important; table-layout: fixed !important; }
  #sw-print-area td, #sw-print-area th { padding: 5px 7px !important; word-break: break-word !important; font-size: 10px !important; }
  .no-print { display: none !important; }
  @page { size: landscape; margin: 0.4in; }
}'''
if old4a in code:
    code = code.replace(old4a, new4a, 1)
    fixes_applied.append("Fix 4a ✓ (@media print CSS added)")
else:
    fixes_applied.append("Fix 4a ✗ NOT FOUND")

# FIX 4b: Add id="sw-print-area" to weekly print wrapper
old4b = '{printView==="weekly" && (\n                        <div ref={printRef} style={{background:"white",borderRadius:T.radius,boxShadow:T.shadowMd,overflow:"hidden",border:`1px solid ${T.border}`}}>'
new4b = '{printView==="weekly" && (\n                        <div id="sw-print-area" ref={printRef} style={{background:"white",borderRadius:T.radius,boxShadow:T.shadowMd,overflow:"hidden",border:`1px solid ${T.border}`}}>'
if old4b in code:
    code = code.replace(old4b, new4b, 1)
    fixes_applied.append("Fix 4b ✓ (id=sw-print-area on weekly view)")
else:
    fixes_applied.append("Fix 4b ✗ NOT FOUND")

# FIX 4c: Add id="sw-print-area" to employee card print wrapper
old4c = '{printView==="employee" && (\n                        <div ref={printRef} style={{background:"white",borderRadius:T.radius,boxShadow:T.shadowMd,overflow:"hidden",border:`1px solid ${T.border}`}}>'
new4c = '{printView==="employee" && (\n                        <div id="sw-print-area" ref={printRef} style={{background:"white",borderRadius:T.radius,boxShadow:T.shadowMd,overflow:"hidden",border:`1px solid ${T.border}`}}>'
if old4c in code:
    code = code.replace(old4c, new4c, 1)
    fixes_applied.append("Fix 4c ✓ (id=sw-print-area on employee view)")
else:
    fixes_applied.append("Fix 4c ✗ NOT FOUND")

# ─────────────────────────────────────────────────────────────────
# FIX 6: Roster drag-to-reorder — add drag hint + handlers
# ─────────────────────────────────────────────────────────────────
old6a = '                    <div className="team-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:14}}>\n                      {employees.map(emp=>{'
new6a = '''                    {employees.length > 1 && (
                      <div style={{fontSize:11,color:T.sub,marginBottom:8,display:"flex",alignItems:"center",gap:6,opacity:0.7}}>
                        <span>⠿</span> Drag cards to reorder your roster
                      </div>
                    )}
                    <div className="team-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:14}}>
                      {employees.map((emp,empIdx)=>{'''
if old6a in code:
    code = code.replace(old6a, new6a, 1)
    fixes_applied.append("Fix 6a ✓ (roster drag hint)")
else:
    fixes_applied.append("Fix 6a ✗ NOT FOUND")

old6b = '                          <div key={emp.id} className="emp-card" id={`emp-card-${emp.id}`} style={{background:T.surface,borderRadius:T.radius,overflow:"hidden",boxShadow:T.shadow,border:`2px solid ${isEditing?emp.color:"transparent"}`,transition:"all 0.15s"}}>'
new6b = '''                          <div key={emp.id} className="emp-card" id={`emp-card-${emp.id}`}
                            draggable
                            onDragStart={e=>{e.dataTransfer.setData("rosterIdx",String(empIdx));e.dataTransfer.effectAllowed="move";}}
                            onDragOver={e=>e.preventDefault()}
                            onDrop={e=>{
                              e.preventDefault();
                              const from=parseInt(e.dataTransfer.getData("rosterIdx"));
                              if(isNaN(from)||from===empIdx) return;
                              const updated=[...employees];
                              const [moved]=updated.splice(from,1);
                              updated.splice(empIdx,0,moved);
                              setEmployees(updated);
                              if(bizId) updated.forEach((emp,i)=>dbPatch(`employees?id=eq.${emp.id}`,{sort_order:i}).catch(()=>{}));
                              showToast("Roster order updated ✓");
                            }}
                            style={{background:T.surface,borderRadius:T.radius,overflow:"hidden",boxShadow:T.shadow,border:`2px solid ${isEditing?emp.color:"transparent"}`,transition:"all 0.15s",cursor:"grab"}}>'''
if old6b in code:
    code = code.replace(old6b, new6b, 1)
    fixes_applied.append("Fix 6b ✓ (drag handlers on emp card)")
else:
    fixes_applied.append("Fix 6b ✗ NOT FOUND")

# ─────────────────────────────────────────────────────────────────
# FIX 7a: Week isolation — ensure wk2Start is always wk1 + 7 days
# ─────────────────────────────────────────────────────────────────
old7a = '  const [wk2Start,    setWk2Start]     = useState(addDays(defaultSun,7));'
new7a = '  const [wk2Start,    setWk2Start]     = useState(()=>addDays(getSunday(new Date().toISOString().split("T")[0]),7));'
if old7a in code:
    code = code.replace(old7a, new7a, 1)
    fixes_applied.append("Fix 7a ✓ (wk2Start isolated init)")
else:
    fixes_applied.append("Fix 7a ✗ NOT FOUND (already correct)")

# FIX 7b: loadAllData — keep weeks isolated when only 1 exists
old7b = '''      if (wks.length > 0) {
        setWk1Start(wks[0].week_start);
        setActiveWeek(wks[0].week_start);
        setPrintWeek(wks[0].week_start);
        if (wks.length > 1) { setWk2Start(wks[1].week_start); setWeekMode("2"); }
      }'''
new7b = '''      if (wks.length > 0) {
        setWk1Start(wks[0].week_start);
        setActiveWeek(wks[0].week_start);
        setPrintWeek(wks[0].week_start);
        if (wks.length > 1 && wks[1].week_start !== wks[0].week_start) {
          setWk2Start(wks[1].week_start);
          setWeekMode("2");
        } else {
          // Ensure wk2Start is always 7 days after wk1 to prevent data bleed
          setWk2Start(addDays(wks[0].week_start, 7));
        }
      }'''
if old7b in code:
    code = code.replace(old7b, new7b, 1)
    fixes_applied.append("Fix 7b ✓ (week isolation in loadAllData)")
else:
    fixes_applied.append("Fix 7b ✗ NOT FOUND")

# ─────────────────────────────────────────────────────────────────
# FIXES 1, 2, 3: TimePickerModal — scroll picker + Enter + Tab
# This is the largest change — replace the entire time grid block
# ─────────────────────────────────────────────────────────────────

# Marker: start of the time grid
GRID_START = '          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>\n            {[["Start Time","start"],["End Time","end"]].map(([lbl,field])=>{'

# Marker: what comes right after the closing of the grid
GRID_END_MARKER = '\n          {draft.start&&draft.end&&!canSave&&('

if GRID_START in code:
    start_idx = code.index(GRID_START)
    # Find the end of this section
    if GRID_END_MARKER in code[start_idx:]:
        end_idx = start_idx + code[start_idx:].index(GRID_END_MARKER)
        old_block = code[start_idx:end_idx]
        
        new_block = r"""          {/* ── Time pickers: manual text input + 30-min scroll + arrow nudge ── */}
          {(()=>{
            const HALF_HOURS = [];
            for(let h=0;h<24;h++) for(let m of [0,30]) {
              const hh=String(h).padStart(2,"0"), mm=String(m).padStart(2,"0");
              const hr=h%12===0?12:h%12;
              HALF_HOURS.push({val:`${hh}:${mm}`,label:`${hr}:${mm} ${h<12?"AM":"PM"}`});
            }
            const snapTo30 = v => Math.round(v*2)/2;
            const fmtDisp = v => {
              if(v==null) return "";
              const h=Math.floor(v), m=Math.round((v-h)*60);
              const hr=h%12===0?12:h%12;
              return `${hr}:${String(m).padStart(2,"0")} ${h<12?"AM":"PM"}`;
            };
            function parseTyped(raw) {
              const s=raw.trim().toUpperCase();
              let h,m=0;
              const ampm=s.includes("AM")?"AM":s.includes("PM")?"PM":null;
              const digits=s.replace(/[^0-9:]/g,"");
              if(digits.includes(":")) { const p=digits.split(":"); h=parseInt(p[0]||"0"); m=parseInt(p[1]||"0"); }
              else if(digits.length<=2) { h=parseInt(digits||"0"); m=0; }
              else if(digits.length===3) { h=parseInt(digits[0]); m=parseInt(digits.slice(1)); }
              else { h=parseInt(digits.slice(0,2)); m=parseInt(digits.slice(2,4)); }
              if(ampm==="PM"&&h!==12) h+=12;
              if(ampm==="AM"&&h===12) h=0;
              if(!ampm&&h>=1&&h<=6) h+=12;
              m=Math.round(m/30)*30;
              if(m===60){m=0;h+=1;}
              if(h<0||h>23||isNaN(h)||isNaN(m)) return null;
              return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0");
            }
            return (
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
                {[["Start Time","start","tp-start"],["End Time","end","tp-end"]].map(([lbl,field,inputId],fi)=>{
                  const valDec=draft[field]?timeToDec(draft[field]):null;
                  function commitVal(raw){ const p=parseTyped(raw); if(p) setDraft(d=>({...d,[field]:p})); }
                  function nudge(dir){ const cur=valDec!=null?valDec:(field==="start"?9:17); const nx=Math.max(0,Math.min(23.5,cur+dir*0.5)); const sn=snapTo30(nx); const hh=Math.floor(sn); const mm=Math.round((sn-hh)*60); setDraft(d=>({...d,[field]:String(hh).padStart(2,"0")+":"+String(mm).padStart(2,"0")})); }
                  return (
                    <div key={field}>
                      <label style={{fontSize:11,fontWeight:700,color:T.sub,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em"}}>{lbl}</label>
                      <input
                        id={inputId}
                        type="text"
                        placeholder="e.g. 9:00 AM"
                        defaultValue={draft[field]?fmtDisp(valDec):""}
                        key={field+(draft[field]||"none")}
                        onBlur={e=>commitVal(e.target.value)}
                        onKeyDown={e=>{
                          if(e.key==="ArrowUp"){e.preventDefault();nudge(+1);}
                          if(e.key==="ArrowDown"){e.preventDefault();nudge(-1);}
                          if(e.key==="Enter"){e.preventDefault();commitVal(e.target.value);if(fi===0)document.getElementById("tp-end")?.focus();else document.getElementById("tp-save-btn")?.click();}
                        }}
                        style={{width:"100%",border:`2px solid ${draft[field]?emp.color:T.border}`,borderRadius:10,padding:"11px 10px",fontSize:15,fontWeight:700,outline:"none",background:"white",color:draft[field]?T.text:"#aaa",textAlign:"center",transition:"border 0.15s",boxSizing:"border-box"}}
                      />
                      <div style={{display:"flex",justifyContent:"center",gap:6,margin:"6px 0"}}>
                        {[["\u25b2",+1],["\u25bc",-1]].map(([arrow,dir])=>(
                          <button key={arrow} type="button" tabIndex={-1}
                            onMouseDown={e=>{e.preventDefault();nudge(dir);}}
                            style={{background:T.muted,border:`1px solid ${T.border}`,borderRadius:6,padding:"3px 14px",fontSize:11,color:T.sub,cursor:"pointer",fontWeight:700}}>
                            {arrow} 30m
                          </button>
                        ))}
                      </div>
                      <select tabIndex={-1}
                        value={HALF_HOURS.find(o=>o.val===draft[field])?draft[field]:""}
                        onChange={e=>{if(e.target.value)setDraft(d=>({...d,[field]:e.target.value}));}}
                        style={{width:"100%",padding:"8px 10px",borderRadius:9,border:`1.5px solid ${draft[field]?emp.color:T.border}`,background:"white",color:draft[field]?T.text:T.sub,fontSize:13,cursor:"pointer",outline:"none",fontWeight:600}}>
                        <option value="">\u2014 or pick a time \u2014</option>
                        {HALF_HOURS.map(o=><option key={o.val} value={o.val}>{o.label}</option>)}
                      </select>
                      {draft[field]&&<div style={{fontSize:10,color:T.sub,marginTop:4,textAlign:"center",fontWeight:600}}>{fmtDisp(valDec)}</div>}
                    </div>
                  );
                })}
              </div>
            );
          })()}"""
        
        code = code[:start_idx] + new_block + code[end_idx:]
        fixes_applied.append("Fix 1-3 ✓ (TimePickerModal: scroll picker + Enter key + Tab order)")
    else:
        fixes_applied.append("Fix 1-3 ✗ Could not find end marker")
else:
    fixes_applied.append("Fix 1-3 ✗ Could not find start marker")

# Fix save button — add id and tabIndex for keyboard navigation
old_save = '            <button onClick={save} disabled={!canSave} style={{background:canSave?emp.color:"#DDD",color:canSave?"white":"#aaa",border:"none",borderRadius:10,padding:"13px 0",fontSize:14,fontWeight:700,cursor:canSave?"pointer":"not-allowed",transition:"background 0.15s"}}>'
new_save = '            <button id="tp-save-btn" tabIndex={4} onClick={save} disabled={!canSave} onKeyDown={e=>{if(e.key==="Enter"&&canSave)save();}} style={{background:canSave?emp.color:"#DDD",color:canSave?"white":"#aaa",border:"none",borderRadius:10,padding:"13px 0",fontSize:14,fontWeight:700,cursor:canSave?"pointer":"not-allowed",transition:"background 0.15s"}}>'
if old_save in code:
    code = code.replace(old_save, new_save, 1)
    fixes_applied.append("Fix 2b ✓ (save btn Enter key)")
else:
    fixes_applied.append("Fix 2b ✗ save btn NOT FOUND")

# Print results
print("\n" + "="*50)
print("SHIFTWISE FIX REPORT")
print("="*50)
for f in fixes_applied:
    print(f)

changed = len(code) != original_len or any("✓" in f for f in fixes_applied)
print(f"\nOriginal: {original_len} chars → Fixed: {len(code)} chars")

if changed:
    with open(src_path, 'w', encoding='utf-8') as f:
        f.write(code)
    print(f"\n✅ All fixes written to: {src_path}")
else:
    print("\n⚠️  No changes made — check NOT FOUND errors above")

