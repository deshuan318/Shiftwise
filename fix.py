import re

path = "/Users/deshuanobey/Desktop/shiftwise/src/App.jsx"

with open(path, "r") as f:
    code = f.read()

count = 0

# Fix 1: toLocalDateStr - use CST timezone
old1 = 'const toLocalDateStr = d => { const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; };'
new1 = 'const APP_TZ = "America/Chicago";\nconst toLocalDateStr = d => {\n  const parts = new Intl.DateTimeFormat("en-US",{timeZone:APP_TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);\n  const p = {}; parts.forEach(({type,value}) => { p[type]=value; });\n  return `${p.year}-${p.month}-${p.day}`;\n};'
if old1 in code: code = code.replace(old1, new1); count+=1; print("Fixed: toLocalDateStr")

# Fix 2: getSunday - use CST day of week
old2 = 'const getSunday = ds => { const d = new Date(ds+"T00:00:00"); d.setDate(d.getDate()-d.getDay()); const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; };'
new2 = 'const getSunday = ds => {\n  const d = new Date(ds+"T12:00:00");\n  const dowStr = new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",weekday:"short"}).format(d);\n  const dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(dowStr);\n  const result = new Date(d.getTime() - dow*24*60*60*1000);\n  const parts = new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(result);\n  const p = {}; parts.forEach(({type,value})=>{p[type]=value;});\n  return `${p.year}-${p.month}-${p.day}`;\n};'
if old2 in code: code = code.replace(old2, new2); count+=1; print("Fixed: getSunday")

# Fix 3: addDays
old3 = 'const addDays = (ds,n) => { const d = new Date(ds+"T00:00:00"); d.setDate(d.getDate()+n); return d.toISOString().split("T")[0]; };'
new3 = 'const addDays = (ds,n) => { const d = new Date(ds+"T00:00:00"); d.setDate(d.getDate()+n); return toLocalDateStr(d); };'
if old3 in code: code = code.replace(old3, new3); count+=1; print("Fixed: addDays")

# Fix 4: getDayPunches
old4 = 'new Date(p.time).toISOString().split("T")[0]'
new4 = 'toLocalDateStr(new Date(p.time))'
if old4 in code: code = code.replace(old4, new4); count+=1; print("Fixed: getDayPunches")

# Fix 5: tsWkDates
old5 = '    const d = new Date(tsWeekStart+"T00:00:00");\n    d.setDate(d.getDate()+i);\n    return d.toISOString().split("T")[0];'
new5 = '    const d = new Date(tsWeekStart+"T12:00:00");\n    d.setUTCDate(d.getUTCDate()+i);\n    return toLocalDateStr(d);'
if old5 in code: code = code.replace(old5, new5); count+=1; print("Fixed: tsWkDates")

# Fix 6: weekDatesFromSunday
old6 = 'const weekDatesFromSunday = s => { const sun=new Date(s+"T00:00:00"); return DAYS.map((_,i)=>{ const d=new Date(sun); d.setDate(sun.getDate()+i); return d; }); };'
new6 = 'const weekDatesFromSunday = s => { const sun=new Date(s+"T12:00:00"); return DAYS.map((_,i)=>{ const d=new Date(sun.getTime()+i*24*60*60*1000); return d; }); };'
if old6 in code: code = code.replace(old6, new6); count+=1; print("Fixed: weekDatesFromSunday")

# Fix 7: defaultSun
old7 = 'const defaultSun = useMemo(() => getSunday(new Date().toISOString().split("T")[0]), []);'
new7 = 'const defaultSun = useMemo(() => getSunday(toLocalDateStr(new Date())), []);'
if old7 in code: code = code.replace(old7, new7); count+=1; print("Fixed: defaultSun")

# Fix 8: tsWeekStart init
old8 = 'useState(()=>getSunday(new Date().toISOString().split("T")[0]))'
new8 = 'useState(()=>getSunday(toLocalDateStr(new Date())))'
if old8 in code: code = code.replace(old8, new8); count+=1; print("Fixed: tsWeekStart")

with open(path, "w") as f:
    f.write(code)

print(f"\nDone. {count} fixes applied.")
