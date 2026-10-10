const A = "http://localhost:3001", H = "http://localhost:4000";
const J = (t, b) => ({ method: b ? "POST" : "GET", headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: b ? JSON.stringify(b) : undefined });
const jf = async (u, o) => { const r = await fetch(u, o); const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t } return { s: r.status, j } };
const pl = (await (await fetch(`${A}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenant_key: "platform", username: "admin", password: "1234567890" }) })).json()).access_token;
const L = (x) => x.items ?? x.data ?? x;
const tid = L((await jf(`${A}/admin/tenants?limit=50`, J(pl))).j).find((t) => t.key === "acme").id;
const users = L((await jf(`${A}/admin/users?limit=100&tenant_id=${tid}`, J(pl))).j);
const agents = L((await jf(`${H}/agent-grants?tenant_id=${tid}`, J(pl))).j).map((i) => i.agent);
console.log(agents.length);
for (const ak of ["hoa-don-doc", "intake-analyst", "docs-architect", "backend-lead", "frontend-lead", "qc", "qc-uat", "spec-readiness", "reviewer"]) {
  const a = agents.find((x) => x.key === ak); if (!a) { console.log("no agent", ak); continue; }
  for (const un of ["lan", "hoa", "minh"]) {
    const u = users.find((x) => x.username === un);
    const r = await jf(`${H}/agent-grants?tenant_id=${tid}`, J(pl, { agent_id: a.id, subject_type: "user", subject_id: u.id }));
    if (r.s > 201) console.log(ak, un, r.s, JSON.stringify(r.j).slice(0, 120));
  }
}
console.log("done");
