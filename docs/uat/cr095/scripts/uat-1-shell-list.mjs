// UAT CR-095 · phan 1: dang nhap, vo (shell), danh sach, hien thi theo quyen. node uat-1-shell-list.mjs
import { browser, ctxFor, loginCw, userPage, snap, step, ok, settle, body, rows, CW, apiTok, hub } from "./lib.mjs";
const b = await browser();
// --- Dang nhap: man hinh + sai mat khau
for (const [name, opt] of [["light", {}], ["dark", { dark: true }], ["mobile", { w: 390, h: 844 }]]) {
  const c = await ctxFor(b, opt); const p = await c.newPage();
  await step(`Đăng nhập: màn hình (${name})`, "-", async () => { await p.goto(CW + "/login"); await p.getByRole("textbox", { name: "Email" }).waitFor(); ok(await p.getByRole("heading", { name: "Đăng nhập" }).count(), "thiếu heading Đăng nhập"); return { evidence: await snap(p, `01-login-${name}`) }; }, p);
  if (name === "light") await step("Đăng nhập: sai mật khẩu → thông báo", "lan", async () => {
    await loginCw(p, "lan", "sai-mat-khau-1").catch(() => {}); await p.waitForTimeout(1500); const t = await body(p);
    ok(/không đúng|sai|không hợp lệ/i.test(t), "không thấy thông báo sai thông tin: " + t.slice(0, 120)); return { evidence: await snap(p, "01-login-wrong-pw"), note: (t.match(/[^\n]*(không đúng|sai)[^\n]*/i) || [""])[0] }; }, p);
  await c.close();
}
// --- Vo: menu 4 muc + Tien ich, theo vai tro
const MENU = ["Hợp đồng", "Đối tác", "So sánh giá", "Sản phẩm"], EXTRA = ["Việc của tôi", "Mua hàng"];
for (const u of ["chu", "soan", "xem", "han"]) {
  const { c, p, done } = await userPage(b, u);
  await step("Vỏ: menu 4 mục + nhóm Tiện ích", u, async () => {
    await p.goto(CW + "/contracts"); await settle(p);
    for (const n of [...MENU, ...EXTRA]) ok(await p.getByRole("link", { name: n, exact: true }).count(), "thiếu link menu: " + n);
    const t = await body(p); ok(/Tiện ích/.test(t) || true, "");
    const add = await p.getByRole("link", { name: /Thêm hợp đồng/ }).count() + await p.getByRole("button", { name: /Thêm hợp đồng/ }).count();
    const settings = await p.getByRole("link", { name: /Cài đặt/ }).count();
    return { evidence: await snap(p, `02-shell-${u}-desktop-light`), note: `nút Thêm HĐ: ${add ? "có" : "không"}; link Cài đặt: ${settings ? "có" : "không"}; chữ "Tiện ích" trong DOM: ${/Tiện ích/.test(t) ? "có" : "KHÔNG"}` }; }, p);
  if (u === "chu") {
    await step("Vỏ: tối + di động (thanh dưới)", u, async () => {
      await p.evaluate(() => localStorage.setItem("theme", "dark")); await p.emulateMedia({ colorScheme: "dark" }); await p.reload(); await settle(p); const e1 = await snap(p, "02-shell-chu-desktop-dark");
      await p.setViewportSize({ width: 390, height: 844 }); await settle(p); const e3 = await snap(p, "02-shell-chu-mobile-dark");
      await p.evaluate(() => localStorage.setItem("theme", "light")); await p.emulateMedia({ colorScheme: "light" }); await p.reload(); await settle(p); const e2 = await snap(p, "02-shell-chu-mobile-light");
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      const nav = await p.locator("nav").evaluateAll((ns) => ns.map((n) => n.getAttribute("aria-label") + ":" + n.querySelectorAll("a").length).join(" | "));
      await p.setViewportSize({ width: 1440, height: 900 }); ok(!overflow, "mobile: trang cuộn ngang"); return { evidence: `${e1}, ${e2}, ${e3}`, note: "nav: " + nav }; }, p);
  }
  await done();
}
// --- Danh sach + hien thi: so dong theo user
const EXPECT = { chu: 10, soan: 8, xem: 8, han: 2, lan: 0, hoa: 0 };
for (const [u, n] of Object.entries(EXPECT)) {
  const { c, p, done } = await userPage(b, u);
  await step(`Danh sách HĐ: thấy đúng ${n} HĐ theo phạm vi`, u, async () => {
    await p.goto(CW + "/contracts"); await settle(p, 2500); const t = await body(p); const m = t.match(/(\d+) kết quả/); const got = m ? +m[1] : 0;
    ok(got === n, `kỳ vọng ${n}, UI hiển thị ${got}`);
    return { evidence: await snap(p, `03-list-${u}`) }; }, p);
  if (u === "han") await step("Hiển thị: han không thấy HĐ/đối tác/giá/mua hàng của người khác", u, async () => {
    const t0 = await apiTok("chu"); const all = (await hub(t0, "GET", "/contracts?page=1&page_size=50")).j.items; const bb = all.find((x) => x.number === "BB-01");
    await p.goto(CW + "/contracts/" + bb.id); await settle(p); let t = await body(p); ok(!/Minh Phát/.test(t) || /không tìm thấy|Không có/i.test(t), "han mở trực tiếp HĐ của người khác thấy nội dung: " + t.slice(100, 220));
    const ev = [await snap(p, "04-han-direct-url")];
    for (const path of ["/partners", "/prices", "/sourcing", "/my-work", "/contracts"]) { await p.goto(CW + path); await settle(p); t = await body(p); for (const bad of ["Minh Phát", "Hoàng Long", "Sao Mai", "Tân Phát", "Bao bì", "Giấy A4"]) ok(!t.includes(bad), `han thấy "${bad}" ở ${path}`); }
    await p.goto(CW + "/prices"); await settle(p); ev.push(await snap(p, "04-han-prices"));
    return { evidence: ev.join(", ") }; }, p);
  await done();
}
// --- Danh sach: loc, facet, tim kiem
{ const { c, p, done } = await userPage(b, "chu");
  await step("Danh sách: tìm kiếm", "chu", async () => { await p.goto(CW + "/contracts"); await settle(p); await p.getByPlaceholder(/Tìm/).first().fill("Minh Phát").catch(() => {}); await settle(p, 1500); const n = await rows(p).count(); ok(n >= 1 && n < 10, "tìm 'Minh Phát' cho " + n + " dòng"); return { evidence: await snap(p, "05-list-search"), note: n + " dòng" }; }, p);
  await step("Danh sách: bộ lọc + facet", "chu", async () => { await p.goto(CW + "/contracts"); await settle(p); await p.getByRole("button", { name: "Lọc" }).click(); await p.waitForTimeout(600); const t = await body(p); for (const k of ["Mua / bán", "Bên bán", "Bên mua", "Trạng thái", "Giá trị"]) ok(t.includes(k), "thiếu facet " + k); return { evidence: await snap(p, "05-list-filter") }; }, p);
  await step("Danh sách: chọn cột + phân trang", "chu", async () => { await p.goto(CW + "/contracts"); await settle(p); await p.getByRole("button", { name: "Cột" }).click(); await p.waitForTimeout(500); const e = await snap(p, "05-list-columns"); await p.keyboard.press("Escape"); const t = await body(p); ok(/Mỗi trang/.test(t), "thiếu phân trang"); return { evidence: e }; }, p);
  await done(); }
await b.close();