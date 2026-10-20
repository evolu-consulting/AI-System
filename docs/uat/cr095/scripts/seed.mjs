// UAT CR-095 · seed qua API (chay tu may local qua tunnel): node seed.mjs <file-mat-khau-admin>
import { readFileSync, writeFileSync } from "node:fs";
const A = "http://127.0.0.1:13001", H = "http://127.0.0.1:14000";
const PW = "dev-password-1";
const call = async (base, m, p, b, t, raw) => {
  const r = await fetch(base + p, { method: m, headers: { ...(raw ? {} : { "Content-Type": "application/json" }), ...(t ? { Authorization: "Bearer " + t } : {}) }, body: b === undefined ? undefined : raw ? b : JSON.stringify(b) });
  const x = await r.text(); let j = {}; try { j = x ? JSON.parse(x) : {}; } catch { j = { raw: x.slice(0, 200) }; }
  return { s: r.status, j };
};
const must = (r, what) => { if (r.s >= 300) { console.log("FAIL", what, r.s, JSON.stringify(r.j).slice(0, 300)); } else console.log("ok  ", what, r.s); return r; };
const apw = readFileSync(process.argv[2], "utf8").trim().replace(/^[^=]*=/, "");
const adm = (await call(A, "POST", "/auth/login", { tenant_key: "platform", username: "admin", password: apw })).j.access_token;
const acme = (await call(A, "GET", "/admin/tenants?q=acme&limit=5", undefined, adm)).j.items.find((t) => t.key === "acme").id;
must(await call(A, "PUT", `/admin/tenants/${acme}/packs/contracts`, {}, adm), "enable pack contracts");
const users = { chu: "Chủ Owner", soan: "Soạn Editor", xem: "Xem Viewer", han: "Hẹp Restricted" };
const ids = {};
for (const [u, dn] of Object.entries(users)) {
  const c = await call(A, "POST", `/admin/users?tenant_id=${acme}`, { username: u, display_name: dn, role: "member", locale: "vi" }, adm);
  if (c.s >= 300) { console.log("user", u, c.s, JSON.stringify(c.j).slice(0, 150)); continue; }
  ids[u] = c.j.user.id;
  const l = await call(A, "POST", "/auth/login", { tenant_key: "acme", username: u, password: c.j.temp_password });
  if (l.j.status === "password_change_required") must(await call(A, "POST", "/auth/change-password", { change_token: l.j.change_token, new_password: PW }), "set pw " + u);
}
const ul = (await call(A, "GET", `/admin/users?tenant_id=${acme}&limit=100`, undefined, adm)).j.items; for (const u of ul) ids[u.username] = u.id;
const gl = (await call(A, "GET", `/admin/groups?tenant_id=${acme}&limit=100`, undefined, adm)).j.items; const gid = Object.fromEntries(gl.map((g) => [g.key, g.id]));
console.log("groups", Object.keys(gid).join(","));
const mem = { "contracts-owner": ["chu"], "contracts-editor": ["soan", "han", "lan"], "contracts-viewer": ["xem", "hoa"] };
for (const [g, us] of Object.entries(mem)) must(await call(A, "POST", `/admin/groups/${gid[g]}/members`, { usernames: us }, adm), "members " + g);
// org: xem là quản lý của soan => xem (viewer) thấy HĐ của soan; han đứng riêng.
must(await call(A, "PUT", `/admin/org/managers/${ids.soan}?tenant_id=${acme}`, { manager_id: ids.xem }, adm), "manager soan->xem");
const tok = {}; for (const u of ["chu", "soan", "xem", "han", "lan", "hoa", "tadmin"]) { const l = await call(A, "POST", "/auth/login", { tenant_key: "acme", username: u, password: PW }); tok[u] = l.j.access_token; if (!tok[u]) console.log("login", u, l.s, JSON.stringify(l.j).slice(0, 120)); }
const P = (m, p, b, u) => call(H, m, "/pack/contracts" + p, b, tok[u]);
console.log("visibility", JSON.stringify((await P("GET", "/visibility", undefined, "chu")).j));
const C = (title, partner, tax, dir, value, end, items) => ({ direction: dir, number: "HĐ-" + Math.floor(Math.random() * 9000 + 1000), title, partner_name: partner, partner_tax_id: tax, partner_signer: "Nguyễn Văn A", our_signer: "Trần Thị B", start_date: "2026-01-01", end_date: end, notice_days: 30, total_value: value, payment_terms: "Thanh toán 2 đợt", items });
const defs = [
  ["chu", C("Cung cấp bao bì Minh Phát", "Công ty Minh Phát", "0312345678", "purchase", 500000000, "2026-11-15", [{ name: "Thùng carton 5 lớp", unit: "cái", qty: 1000, unit_price: 25000 }, { name: "Giấy A4", unit: "ream", qty: 200, unit_price: 70000 }])],
  ["chu", C("Dịch vụ phần mềm Sao Mai", "Công ty Sao Mai", "0109876543", "sale", 1200000000, "2027-06-30", [{ name: "Giấy A4", unit: "ream", qty: 50, unit_price: 80000 }])],
  ["soan", C("Thuê văn phòng Tân Phát", "Công ty Tân Phát", "0301111222", "purchase", 240000000, "2027-01-31", [{ name: "Bút bi", unit: "hộp", qty: 100, unit_price: 40000 }])],
  ["soan", C("Bán thiết bị Hoàng Long", "Công ty Hoàng Long", "0302222333", "sale", 80000000, "2026-12-31", [])],
  ["han", C("Mua văn phòng phẩm Công ty Kín", "Công ty Kín", "0100000001", "purchase", 15000000, "2027-03-31", [{ name: "Bút bi", unit: "hộp", qty: 50, unit_price: 36000 }])],
];
const made = [];
for (const [u, body] of defs) { const r = must(await P("POST", "/contracts/manual", body, u), `contract ${body.title} (${u})`); if (r.j.id) made.push({ id: r.j.id, by: u, title: body.title, partner: body.partner_name }); }
const sched = (id, u, rows) => must(P("PUT", `/contracts/${id}/schedule`, { rows }, u), "schedule " + id.slice(0, 6));
for (const m of made.slice(0, 1)) must(await P("PUT", `/contracts/${m.id}/schedule`, { rows: [{ due_date: "2026-10-25", amount: 250000000, kind: "payment" }, { due_date: "2026-11-30", amount: 250000000, kind: "payment" }] }, "chu"), "schedule C1");
if (made[2]) must(await P("PUT", `/contracts/${made[2].id}/schedule`, { rows: [{ due_date: "2026-10-10", amount: 20000000, kind: "payment" }] }, "soan"), "schedule C3 (qua han)");
const q = [["chu", "Giấy A4", "ream", "Công ty Minh Phát", "0312345678", 70000], ["chu", "Giấy A4", "ream", "VPP Phương Nam", "0300999888", 65000], ["soan", "Bút bi", "hộp", "Công ty Tân Phát", "0301111222", 42000], ["han", "Bút bi", "hộp", "Công ty Kín", "0100000001", 30000]];
for (const [u, prod, unit, sup, tax, price] of q) must(await P("POST", "/prices/quotes", { product: prod.toLowerCase(), product_name: prod, unit, supplier_name: sup, supplier_tax_id: tax, price, quoted_at: "2026-10-15" }, u), `quote ${prod}/${sup}`);
writeFileSync(new URL("./seed-result.json", import.meta.url), JSON.stringify({ acme, ids, made, pw: PW }, null, 1));