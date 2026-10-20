// UAT CR-095 · seed2: cap quan ly han->soan, chu vao contracts-editor, HĐ do soan/han tao, chu duyet mot so cho co du lieu active.
import { readFileSync } from "node:fs";
const A = "http://127.0.0.1:13001", H = "http://127.0.0.1:14000", PW = "dev-password-1";
const call = async (base, m, p, b, t) => { const r = await fetch(base + p, { method: m, headers: { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); const x = await r.text(); let j = {}; try { j = x ? JSON.parse(x) : {}; } catch { j = { raw: x.slice(0, 200) }; } return { s: r.status, j }; };
const must = (r, w) => { console.log(r.s >= 300 ? "FAIL" : "ok  ", w, r.s, r.s >= 300 ? JSON.stringify(r.j).slice(0, 200) : ""); return r; };
const apw = readFileSync(process.argv[2], "utf8").trim().replace(/^[^=]*=/, "");
const adm = (await call(A, "POST", "/auth/login", { tenant_key: "platform", username: "admin", password: apw })).j.access_token;
const acme = (await call(A, "GET", "/admin/tenants?q=acme&limit=5", undefined, adm)).j.items.find((t) => t.key === "acme").id;
const ids = Object.fromEntries((await call(A, "GET", `/admin/users?tenant_id=${acme}&limit=100`, undefined, adm)).j.items.map((u) => [u.username, u.id]));
const gid = Object.fromEntries((await call(A, "GET", `/admin/groups?tenant_id=${acme}&limit=100`, undefined, adm)).j.items.map((g) => [g.key, g.id]));
must(await call(A, "PUT", `/admin/org/managers/${ids.han}?tenant_id=${acme}`, { manager_id: ids.soan }, adm), "manager han->soan");
must(await call(A, "POST", `/admin/groups/${gid["contracts-editor"]}/members`, { usernames: ["chu"] }, adm), "chu in editor group");
const tok = {}; for (const u of ["chu", "soan", "xem", "han", "lan", "hoa"]) tok[u] = (await call(A, "POST", "/auth/login", { tenant_key: "acme", username: u, password: PW })).j.access_token;
const P = (m, p, b, u) => call(H, m, "/pack/contracts" + p, b, tok[u]);
const C = (n, title, partner, tax, dir, value, end, items) => ({ direction: dir, number: n, title, partner_name: partner, partner_tax_id: tax, partner_signer: "Nguyễn Văn A", our_signer: "Trần Thị B", start_date: "2026-01-01", end_date: end, notice_days: 30, total_value: value, payment_terms: "Thanh toán 2 đợt", items });
const defs = [
  ["soan", "approve2", C("BB-01", "Bao bì Minh Phát 2026", "Công ty Minh Phát", "0312345678", "purchase", 500000000, "2026-11-20", [{ name: "Giấy A4", unit: "ream", qty: 5000, unit_price: 70000 }, { name: "Thùng carton", unit: "cái", qty: 6000, unit_price: 25000 }])],
  ["soan", "l1", C("SM-02", "Phần mềm Sao Mai 2026", "Công ty Sao Mai", "0109876543", "sale", 1200000000, "2027-06-30", [{ name: "Giấy A4", unit: "ream", qty: 5000, unit_price: 80000 }, { name: "Thùng carton", unit: "cái", qty: 8000, unit_price: 100000 }])],
  ["soan", "none", C("TP-03", "Thuê văn phòng Tân Phát 2026", "Công ty Tân Phát", "0301111222", "purchase", 240000000, "2027-01-31", [{ name: "Bút bi", unit: "hộp", qty: 6000, unit_price: 40000 }])],
  ["soan", "l1", C("HL-04", "Thiết bị Hoàng Long 2026", "Công ty Hoàng Long", "0302222333", "sale", 80000000, "2026-12-31", [{ name: "Bút bi", unit: "hộp", qty: 1000, unit_price: 80000 }])],
  ["han", "none", C("K-05", "Văn phòng phẩm Kín 2026", "Công ty Kín", "0100000001", "purchase", 15000000, "2027-03-31", [{ name: "Bút bi", unit: "hộp", qty: 500, unit_price: 30000 }])],
];
const made = [];
for (const [u, mode, body] of defs) { const r = must(await P("POST", "/contracts/manual", body, u), `contract ${body.title} (${u})`); if (r.j.id) made.push({ id: r.j.id, by: u, title: body.title, partner: body.partner_name, mode }); }
for (const m of made) {
  if (m.mode === "approve2" || m.mode === "l1") must(await P("POST", `/contracts/${m.id}/approval`, { action: "approve" }, "chu"), "L1 " + m.title);
  if (m.mode === "approve2") must(await P("POST", `/contracts/${m.id}/approval`, { action: "approve" }, "chu"), "L2 " + m.title);
}
const sched = made.find((m) => m.title.startsWith("Bao bì"));
must(await P("PUT", `/contracts/${sched.id}/schedule`, { rows: [{ due_date: "2026-10-25", amount: 250000000, kind: "payment" }, { due_date: "2026-11-30", amount: 250000000, kind: "payment" }] }, "chu"), "schedule Bao bì");
const q = [["chu", "giấy a4", "Giấy A4", "ream", "Công ty Minh Phát", "0312345678", 70000], ["chu", "giấy a4", "Giấy A4", "ream", "VPP Phương Nam", "0300999888", 65000], ["soan", "bút bi", "Bút bi", "hộp", "Công ty Tân Phát", "0301111222", 42000], ["han", "bút bi", "Bút bi", "hộp", "Công ty Kín", "0100000001", 30000]];
for (const [u, key, name, unit, sup, tax, price] of q) must(await P("POST", "/prices/quotes", { product: key, product_name: name, unit, supplier_name: sup, supplier_tax_id: tax, price, quoted_at: "2026-10-15" }, u), `quote ${name}/${sup}`);
console.log("products", JSON.stringify((await P("GET", "/prices/products", undefined, "chu")).j).slice(0, 400));
console.log("partners han", JSON.stringify((await P("GET", "/partners?role=supplier", undefined, "han")).j).slice(0, 300));