// UAT CR-095 · phan 3b: chay lai cac buoc phan 3 sau khi chinh selector (loi script, khong phai loi app).
import { browser, userPage, snap, step, ok, settle, body, CW, apiTok, hub } from "./lib.mjs";
const b = await browser(); const tk = { chu: await apiTok("chu"), xem: await apiTok("xem") };
{ const { p, done } = await userPage(b, "chu");
  await step("Việc của tôi: hẹn nhắc (follow-up) trên một dòng", "chu", async () => {
    await p.goto(CW + "/my-work"); await settle(p, 3000); await p.getByRole("button", { name: "Hẹn nhắc", exact: true }).first().click(); await p.waitForTimeout(600);
    await p.locator("input[type=datetime-local]").first().fill("2026-10-21T09:00"); await p.getByRole("button", { name: "Đồng ý" }).click(); await settle(p, 2000);
    const r = await hub(tk.chu, "GET", "/followups"); const n = (r.j.items || r.j || []).length; const t = await body(p); ok(n >= 1, "không lưu follow-up"); ok(/Hẹn nhắc \(1\)/.test(t), "tab Hẹn nhắc không tăng: " + (t.match(/Hẹn nhắc \(\d+\)/) || [""])[0]);
    return { evidence: await snap(p, "09-followup-after"), note: n + " follow-up; " + (t.match(/Hẹn nhắc \(\d+\)/) || [""])[0] }; }, p);
  await step("Sổ thanh toán: dời hạn + nhắc khoản thanh toán thủ công", "chu", async () => {
    const list = (await hub(tk.chu, "GET", "/obligations")).j; const o = list.find((x) => x.source === "manual" && x.status === "open"); ok(o, "không có khoản mở");
    const pp = await hub(tk.chu, "POST", `/obligations/${o.id}/postpone`, { to: "2026-12-15", note: "UAT dời hạn" }); const rm = await hub(tk.chu, "POST", `/obligations/${o.id}/remind`, {});
    ok(pp.s === 200 && rm.s === 200, `postpone ${pp.s} ${JSON.stringify(pp.j).slice(0, 100)}, remind ${rm.s} ${JSON.stringify(rm.j).slice(0, 100)}`);
    await p.goto(CW + "/my-work"); await settle(p, 2500); return { evidence: await snap(p, "10-ledger-postpone"), note: `postpone ${pp.s}, remind ${rm.s}` }; }, p);
  await step("Hạn hợp đồng: ghi nhận xử lý (Đang đàm phán) trên trang chi tiết", "chu", async () => {
    const tp = (await hub(tk.chu, "GET", "/contracts?page=1&page_size=100")).j.items.find((x) => x.number === "TP-03"); await p.goto(CW + "/contracts/" + tp.id); await settle(p, 2500);
    await p.locator("select").filter({ hasText: "Đang đàm phán" }).first().selectOption({ label: "Đang đàm phán" }); await settle(p, 2000); const t = await body(p); ok(/Đã xử lý: Đang đàm phán/.test(t), "không hiện 'Đã xử lý'"); return { evidence: await snap(p, "09-handled") }; }, p);
  await step("Điểm uy tín: thêm tiêu chí tự chấm + lưu", "chu", async () => {
    await p.goto(CW + "/settings/scoring"); await settle(p, 2000);
    for (const tab of ["Khách hàng", "Nhà cung cấp"]) { await p.getByText(tab, { exact: true }).first().click(); await p.waitForTimeout(500); await p.locator("select").first().selectOption({ index: 1 }); await p.getByRole("button", { name: /\+ Thêm tiêu chí tự chấm/ }).click(); await p.waitForTimeout(500); }
    const e0 = await snap(p, "11-scoring-config"); await p.getByRole("button", { name: /Lưu & tính lại điểm/ }).click(); await settle(p, 2000); const t = await body(p); return { evidence: e0 + ", " + await snap(p, "11-scoring-saved"), note: (t.match(/Tổng \d+%[^\n]*/) || [""])[0] }; }, p);
  await step("Đối tác: ghi việc (giao hàng) + hộp chấm điểm tự chấm", "chu", async () => {
    await p.goto(CW + "/partners"); await settle(p, 2500); await p.getByRole("button", { name: "+ Ghi việc" }).nth(1).click(); await p.waitForTimeout(700); const e0 = await snap(p, "11-partner-event-form");
    await p.getByText("Giao hàng", { exact: true }).first().click(); await p.getByRole("button", { name: "Ghi", exact: true }).click(); await settle(p, 1800); const t1 = await body(p); const e1 = await snap(p, "11-partner-event-after"); ok(/Giao hàng/.test(t1) && !/Chưa ghi việc gì/.test(t1), "sự kiện không hiện ở 'Đã ghi gần đây'");
    await p.reload(); await settle(p, 2500); await p.getByRole("button", { name: "Chấm điểm" }).nth(1).click(); await p.waitForTimeout(800); return { evidence: [e0, e1, await snap(p, "11-partner-rate")].join(", ") }; }, p);
  await step("CKS: hợp đồng bán chữ ký + người giữ", "chu", async () => {
    await p.goto(CW + "/cks"); await settle(p, 2000); await p.getByRole("button", { name: "+ Hợp đồng bán chữ ký" }).click(); await p.waitForTimeout(700); const dlg = p.getByRole("dialog");
    await dlg.getByLabel("Khách hàng").fill("Công ty Delta"); await dlg.getByLabel(/Mã số thuế/).fill("0310000111"); await dlg.getByLabel(/Giá bán/).fill("700000"); await dlg.getByLabel("Ngày ký").fill("2026-10-10"); await dlg.getByLabel("Hết hạn").fill("2027-10-10");
    await dlg.getByPlaceholder(/^Tên/).first().fill("Nguyễn Văn Delta"); const e0 = await snap(p, "13-cks-sale-form"); await dlg.getByRole("button", { name: "Tạo hợp đồng bán" }).click(); await settle(p, 2500); const t = await body(p);
    ok(/Delta/.test(t), "không thấy khách Delta sau khi tạo"); return { evidence: e0 + ", " + await snap(p, "13-cks-sale-after") }; }, p);
  await step("CKS: lọc Sắp hết hạn + chi tiết khách", "chu", async () => {
    await p.goto(CW + "/cks"); await settle(p, 2000); await p.getByRole("button", { name: "Sắp hết hạn" }).click(); await settle(p, 1200); const e0 = await snap(p, "13-cks-expiring"); await p.getByRole("button", { name: "Tất cả" }).click();
    await settle(p, 800); await p.locator("table tbody tr").first().click(); await settle(p, 2000); ok(/\/cks\//.test(p.url()), "không mở trang khách: " + p.url()); return { evidence: e0 + ", " + await snap(p, "13-cks-customer") }; }, p);
  await done(); }
{ const { p, done } = await userPage(b, "xem");
  await step("Viewer: nút ghi/chấm điểm ở Đối tác (UI) phải ẩn — server trả 403", "xem", async () => {
    await p.goto(CW + "/partners"); await settle(p, 2500); const n = await p.getByRole("button", { name: /\+ Ghi việc|Chấm điểm/ }).count(); const e = await snap(p, "15-viewer-partners");
    await p.getByRole("button", { name: "+ Ghi việc" }).first().click(); await p.waitForTimeout(500); await p.getByText("Giao hàng", { exact: true }).first().click(); await p.getByRole("button", { name: "Ghi", exact: true }).click(); await settle(p, 1500); const t = await body(p);
    const r = await hub(tk.xem, "POST", "/partner-events", { party: "tax:0302222333", role: "customer", type: "delivered" });
    ok(n === 0, `viewer thấy ${n} nút ghi/chấm điểm; server ${r.s}; UI sau khi bấm: ${(t.match(/(Không có quyền|Bạn không|lỗi|Lỗi)[^\n]*/) || ["không báo lỗi?"])[0]}`); return { evidence: e }; }, p);
  await done(); }
await b.close();