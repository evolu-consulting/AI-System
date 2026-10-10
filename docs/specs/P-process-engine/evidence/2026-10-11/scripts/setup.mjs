// Setup UAT P-a: user minh + nhóm Kế toán + grant agent + tadmin có mật khẩu. Chỉ qua API admin/hub (không sửa code).
const A = "http://localhost:3001", H = "http://localhost:4000", NEW = "Uat-pass-12345";
const J = (t, b) => ({ method: b ? "POST" : "GET", headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const jf = async (u, o) => { const r = await fetch(u, o); const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t } return { s: r.status, j } };
const pl = (await jf(`${A}/auth/login`, J(null, { tenant_key: "platform", username: "admin", password: "1234567890" }))).j.access_token;
const acme = (await jf(`${A}/admin/tenants?limit=50`, J(pl))).j; 
const tid = (acme.items ?? acme.data ?? acme).find((t) => t.key === "acme").id;
const g = async (path, b) => jf(`${A}${path}${path.includes("?") ? "&" : "?"}tenant_id=${tid}`, J(pl, b));
const groups = (await g("/admin/groups?limit=100")).j; const gl = groups.items ?? groups.data ?? groups;
const kt = gl.find((x) => x.key === "ke-toan");
console.log("members", (await g(`/admin/groups/${kt.id}/members`, { usernames: ["hoa", "minh"] })).s);
// đổi mật khẩu minh + tadmin
const users = (await g("/admin/users?limit=100")).j; const ul = users.items ?? users.data ?? users;
for (const name of ["minh", "tadmin"]) {
  const u = ul.find((x) => x.username === name);
  const r = (await g(`/admin/users/${u.id}/reset-password`, {})).j;
  const l = (await jf(`${A}/auth/login`, J(null, { tenant_key: "acme", username: name, password: r.temp_password }))).j;
  console.log(name, l.status);
  if (l.change_token) console.log("chg", (await jf(`${A}/auth/change-password`, J(null, { change_token: l.change_token, new_password: NEW }))).s);
}
// grant agent
const ag = (await jf(`${H}/agents?limit=100`, J(pl))); console.log("agents", ag.s);
const ap = await jf(`${H}/agent-grants?tenant_id=${tid}`, J(pl)); console.log("grants", ap.s, JSON.stringify(ap.j).slice(0, 200));
