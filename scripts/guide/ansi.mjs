import fs from 'node:fs'
const src = fs.readFileSync(process.argv[2], 'utf8')
const base = ['#1d1f21','#e5534b','#57ab5a','#c69026','#539bf5','#b083f0','#39c5cf','#c9d1d9','#636e7b','#ff938a','#6bc46d','#daaa3f','#6cb6ff','#dcbdfb','#56d4dd','#ffffff']
const c256 = (n) => { if (n < 16) return base[n]; if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})` } n -= 16; const r = Math.floor(n / 36), g = Math.floor(n / 6) % 6, b = n % 6; const f = (x) => x ? 55 + x * 40 : 0; return `rgb(${f(r)},${f(g)},${f(b)})` }
let st = {}, out = ''
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const span = (t) => { if (!t) return; const css = []; let fg = st.fg, bg = st.bg; if (st.rev) [fg, bg] = [bg || '#0d1117', fg || '#c9d1d9']; if (fg) css.push(`color:${fg}`); if (bg) css.push(`background:${bg}`); if (st.bold) css.push('font-weight:700'); if (st.dim) css.push('opacity:.6'); if (st.it) css.push('font-style:italic'); out += css.length ? `<span style="${css.join(';')}">${esc(t)}</span>` : esc(t) }
const re = /\x1b\[([\d;]*)m/g; let last = 0, m
while ((m = re.exec(src))) { span(src.slice(last, m.index)); last = re.lastIndex
  const a = m[1] === '' ? [0] : m[1].split(';').map(Number)
  for (let i = 0; i < a.length; i++) { const x = a[i]
    if (x === 0) st = {}; else if (x === 1) st.bold = 1; else if (x === 2) st.dim = 1; else if (x === 3) st.it = 1; else if (x === 7) st.rev = 1; else if (x === 22) { st.bold = 0; st.dim = 0 } else if (x === 23) st.it = 0; else if (x === 27) st.rev = 0
    else if (x >= 30 && x <= 37) st.fg = base[x - 30]; else if (x >= 90 && x <= 97) st.fg = base[x - 82]; else if (x === 39) st.fg = null
    else if (x >= 40 && x <= 47) st.bg = base[x - 40]; else if (x >= 100 && x <= 107) st.bg = base[x - 92]; else if (x === 49) st.bg = null
    else if (x === 38 || x === 48) { const k = x === 38 ? 'fg' : 'bg'; if (a[i + 1] === 5) { st[k] = c256(a[i + 2]); i += 2 } else if (a[i + 1] === 2) { st[k] = `rgb(${a[i + 2]},${a[i + 3]},${a[i + 4]})`; i += 4 } } } }
span(src.slice(last))
fs.writeFileSync(process.argv[3], `<!doctype html><meta charset=utf8><body style="margin:0;background:#0d1117"><pre style="margin:0;padding:18px 20px;font:13px/1.35 'SF Mono',Menlo,monospace;color:#c9d1d9;background:#0d1117;display:inline-block">${out}</pre>`)
