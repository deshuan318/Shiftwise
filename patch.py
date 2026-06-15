with open("/Users/deshuanobey/Desktop/shiftwise/src/App.jsx", "r") as f:
    src = f.read()

changes = []

# 1. Add payWeek state
if 'const [payWeek' not in src:
    old = '  const [printWeek,   setPrintWeek]    = useState(defaultSun);'
    new = old + '\n  const [payWeek,     setPayWeek]      = useState(defaultSun);'
    if old in src:
        src = src.replace(old, new, 1)
        changes.append("payWeek state")
    else:
        changes.append("SKIP payWeek state")

# 2. Always open current week
old = ('        const todaySun = getSunday(new Date().toISOString().split("T")[0]);\n'
       '        const best = wks.reduce((prev, curr) => {\n'
       '          const prevDiff = Math.abs(new Date(prev.week_start) - new Date(todaySun));\n'
       '          const currDiff = Math.abs(new Date(curr.week_start) - new Date(todaySun));\n'
       '          return currDiff < prevDiff ? curr : prev;\n'
       '        });\n'
       '        setWk1Start(best.week_start);\n'
       '        setActiveWeek(best.week_start);\n'
       '        setPrintWeek(best.week_start);')
new = ('        const todaySun = getSunday(new Date().toISOString().split("T")[0]);\n'
       '        setWk1Start(todaySun);\n'
       '        setActiveWeek(todaySun);\n'
       '        setPrintWeek(todaySun);')
if old in src:
    src = src.replace(old, new, 1)
    changes.append("current week default")
else:
    changes.append("SKIP current week default")

# 3. Remove role from print weekly table
old = '{emp.role&&<div style={{fontSize:10,color:"#888",marginTop:2}}>{emp.role}</div>}'
if old in src:
    src = src.replace(old, '', 1)
    changes.append("role removed print weekly")
else:
    changes.append("SKIP role print weekly")

# 4. Remove role from print per-employee card
old = '{emp.role&&<div style={{color:"rgba(255,255,255,0.75)",fontSize:12,marginTop:2}}>{emp.role}</div>}'
if old in src:
    src = src.replace(old, '', 1)
    changes.append("role removed print card")
else:
    changes.append("SKIP role print card")

# 5. Remove hourly rate from weekly schedule grid
old = '\n                                  <div style={{fontSize:9,color:T.sub}}>${emp.hourlyRate||0}/hr</div>'
if old in src:
    src = src.replace(old, '', 1)
    changes.append("hourly rate removed from grid")
else:
    changes.append("SKIP hourly rate grid")

with open("/Users/deshuanobey/Desktop/shiftwise/src/App.jsx", "w") as f:
    f.write(src)

for c in changes:
    print(c)
