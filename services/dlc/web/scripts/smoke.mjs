// End-to-end smoke of the default frontend server against a DLC engine, over HTTP only (Node 18+).
//
//   node scripts/smoke.mjs http://127.0.0.1:8795 [--pack <pack path on the engine host>] [--token <bearer>]
//
// Checks: the page and /api/fe/config load; the 3 flows are seeded; a run starts through the /api/dlc
// proxy (POST /api/packs then /api/runs, or a given pack); nodes, worklog and reports load; pause and
// resume answer; when the run completes, the app routes answer. Exit 0 = all checks passed.

const base = (process.argv[2] || 'http://127.0.0.1:8795').replace(/\/$/, '')
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : '' }
const pack = arg('--pack')
const token = arg('--token')
const waitS = Number(arg('--wait') || 240)
let fails = 0
const ok = (cond, msg, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + msg + (extra ? '  ' + extra : '')); if (!cond) fails++ }

async function call(method, path, body) {
  const h = { Accept: 'application/json' }
  if (body !== undefined) h['Content-Type'] = 'application/json'
  if (token) h.Authorization = 'Bearer ' + token
  const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await r.text()
  let d = null
  try { d = t ? JSON.parse(t) : null } catch { d = t }
  return { status: r.status, data: d }
}

const page = await fetch(base + '/')
ok(page.status === 200 && (await page.text()).includes('<div id="root">'), 'page served')
const cfg = await call('GET', '/api/fe/config')
ok(cfg.status === 200 && cfg.data.engine, 'fe config, engine configured', JSON.stringify(cfg.data?.auth))
const flows = await call('GET', '/api/fe/flows')
const ids = (flows.data?.flows || []).filter((f) => f.enabled).map((f) => f.id)
ok(['new-system', 'enhancement', 'bug-fix'].every((i) => ids.includes(i)), '3 flows seeded', ids.join(','))

let packPath = pack
if (!packPath) {
  const p = await call('POST', '/api/dlc/packs', { kind: 'new', name: 'smoke-hello', spec: '# Hello\n\n## F1 Greet\n- `hello NAME` prints `Hello, NAME!`\n' })
  ok(p.status === 201 && p.data.pack, 'POST /api/dlc/packs', String(p.status))
  packPath = p.data?.pack
}
const r = await call('POST', '/api/dlc/runs', { pack: packPath })
ok(r.status === 202 && r.data.run, 'POST /api/dlc/runs', String(r.status) + ' ' + JSON.stringify(r.data))
const run = r.data?.run
if (!run) process.exit(1)

const runs = await call('GET', '/api/dlc/runs')
ok((runs.data?.runs || []).some((x) => x.id === run), 'run listed')

const n1 = await call('GET', `/api/dlc/runs/${run}/nodes`)
ok(n1.status === 200 || n1.status === 404, 'nodes route answers', String(n1.status))
const hasNodes = n1.status === 200
const pz = await call('POST', `/api/dlc/runs/${run}:pause`, { reason: 'smoke' })
ok([200, 404, 409].includes(pz.status), 'pause answers', String(pz.status) + ' ' + JSON.stringify(pz.data))
const rs = await call('POST', `/api/dlc/runs/${run}:resume`, {})
ok([200, 404, 409].includes(rs.status), 'resume answers', String(rs.status) + ' ' + JSON.stringify(rs.data))

let state = ''
const t0 = Date.now()
while (Date.now() - t0 < waitS * 1000) {
  const g = await call('GET', `/api/dlc/runs/${run}`)
  state = g.data?.run?.state || g.data?.state || ''
  if (state === 'green' || state === 'escalated') break
  await new Promise((res) => setTimeout(res, 2000))
}
ok(state === 'green', 'run completed green', state)

const ev = await call('GET', `/api/dlc/runs/${run}/events?after_seq=0&limit=500`)
ok(ev.status === 200 && (ev.data?.events || []).length > 0, 'events', String((ev.data?.events || []).length))
if (hasNodes) {
  const n2 = await call('GET', `/api/dlc/runs/${run}/nodes`)
  const nodes = n2.data?.nodes || []
  ok(nodes.length > 0, 'nodes', nodes.map((n) => n.id + ':' + n.state).join(' '))
  const build = nodes.find((n) => n.id === 'build') || nodes[0]
  const w = await call('GET', `/api/dlc/runs/${run}/nodes/${build.id}/worklog`)
  ok(w.status === 200 && (w.data?.entries || []).length > 0, 'worklog of ' + build.id, String((w.data?.entries || []).length))
  const rp = await call('GET', `/api/dlc/runs/${run}/reports`)
  const reps = rp.data?.reports || []
  ok(rp.status === 200, 'reports listed', reps.map((x) => x.kind).join(','))
  if (reps[0]) {
    const one = await call('GET', `/api/dlc/runs/${run}/reports/${encodeURIComponent(reps[0].id)}`)
    ok(one.status === 200 && typeof one.data?.content === 'string', 'report content', reps[0].id)
  }
  const app = await call('GET', `/api/dlc/runs/${run}/app`)
  ok(app.status === 200, 'app state', JSON.stringify(app.data))
}
console.log(fails ? `${fails} check(s) failed` : 'all checks passed')
process.exit(fails ? 1 : 0)
