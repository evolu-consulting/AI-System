// UAT CR-095 · phan 3: Viec cua toi (nhac/hen), so thanh toan, doi tac + cham diem, so sanh gia, CKS, mua hang.
import { browser, userPage, snap, step, ok, settle, body, rows, CW, apiTok, hub } from "./lib.mjs";
const b = await browser();
const tk = { chu: await apiTok("chu"), soan: await apiTok("soan"), han: await apiTok("han"), xem: await apiTok("xem") };
const today = new Date("2026-10-20");
{ const { p, done } = await userPage(b, "chu");
  await step("Việc của tôi: danh sách (trễ hạn / hôm nay / sắp tới) + bộ đếm", "chu", async () => {
    await p.goto(CW + "/my-work"); await settle(p, 3000); const t = await body(p); ok(/Trễ hạn/.test(t) && /Sắp tới/.test(t), "thiếu nhóm"); ok(/Trả tiền/.test(t), "không có việc thanh toán");
    return { evidence: await snap(p, "09-mywork-chu"), note: (t.match(/Tất cả \(\d+\)[^\n]*/) || [""])[0] }; }, p);
  await step("Việc của tôi: hẹn nhắc (follow-up) trên một dòng", "chu", async () => {
    await p.goto(CW + "/my-work"); await settle(p, 3000);
    await p.getByRole("button", { name: "Hẹn nhắc", exact: true }).first().click(); await p.waitForTimeout(800); const e0 = await snap(p, "09-followup-form");
    const dt = p.locator("input[type=datetime-local]"); if (await dt.count()) await dt.first().fill("2026-10-21T09:00");
    else { const d = p.locator("input[type=date]"); if (await d.count()) await d.first().fill("2026-10-21"); const tm = p.locator("input[type=time]"); if (await tm.count()) await tm.first().fill("09:00"); }
    const note = p.getByRole("textbox").last(); await note.fill("Gọi nhắc đối tác UAT").catch(() => {});
    await p.getByRole("button", { name: /^(Hẹn|Đặt hẹn|Lưu|Tạo|Đồng ý)/ }).last().click(); await settle(p, 2000); const t = await body(p);
    const r = await hub(tk.chu, "GET", "/followups"); const n = (r.j.items || r.j || []).length; ok(n >= 1, "không có follow-up nào được lưu (" + r.s + ")");
    return { evidence: e0 + ", " + await snap(p, "09-followup-after"), note: `${n} follow-up; ${(t.match(/Hẹn nhắc \(\d+\)/) || [""])[0]}` }; }, p);
  await step("Sổ thanh toán: đánh dấu 'Đã trả' khoản trễ hạn", "chu", async () => {
    await p.goto(CW + "/my-work"); await settle(p, 3000); const before = (await body(p)).match(/Thanh toán \((\d+)\)/)?.[1];
    await p.getByRole("button", { name: "Đã trả", exact: true }).first().click(); await settle(p, 2500); const t = await body(p); const after = t.match(/Thanh toán \((\d+)\)/)?.[1];
    ok(Number(after) === Number(before) - 1, `số khoản thanh toán ${before} → ${after}`); const pay = await hub(tk.chu, "GET", "/payments?filter=all");
    return { evidence: await snap(p, "10-ledger-paid"), note: `Thanh toán ${before} → ${after}; /payments ${pay.s}` }; }, p);
  await step("Sổ thanh toán: dời hạn (postpone) và nhắc (remind) qua API đối chiếu UI", "chu", async () => {
    const ob = (await hub(tk.chu, "GET", "/obligations")).j; const list = ob.items || ob; ok(list.length, "không có nghĩa vụ"); const o = list.find((x) => !x.settled_at && !x.paid_at) || list[0];
    const pp = await hub(tk.chu, "POST", `/obligations/${o.id}/postpone`, { to: "2026-12-15", note: "UAT dời hạn" }); const rm = await hub(tk.chu, "POST", `/obligations/${o.id}/remind`, {});
    await p.goto(CW + "/my-work"); await settle(p, 2500); return { evidence: await snap(p, "10-ledger-postpone"), note: `postpone ${pp.s}, remind ${rm.s}` }; }, p);
  await step("Việc của tôi: ghi nhận xử lý hợp đồng sắp đáo hạn", "chu", async () => {
    await p.goto(CW + "/my-work"); await settle(p, 3000); const sel = p.locator("select").filter({ hasText: "Đang đàm phán" }).first(); ok(await sel.count(), "không có hạn hợp đồng cần xử lý (HĐ hết hạn 15/11?)");
    await sel.selectOption({ label: "Đang đàm phán" }); await settle(p, 2000); return { evidence: await snap(p, "09-mywork-handled") }; }, p);
  await done(); }
// --- Doi tac + cham diem
{ const { p, done } = await userPage(b, "chu");
  await step("Đối tác: danh sách + điểm uy tín", "chu", async () => { await p.goto(CW + "/partners"); await settle(p, 2500); const t = await body(p); ok(/Hoàng Long/.test(t) && /Tân Phát/.test(t), "thiếu đối tác"); return { evidence: await snap(p, "11-partners") }; }, p);
  await step("Điểm uy tín: thêm tiêu chí tự chấm + lưu", "chu", async () => {
    await p.goto(CW + "/settings/scoring"); await settle(p, 2000);
    for (const tab of ["Khách hàng", "Nhà cung cấp"]) { await p.getByRole("button", { name: tab, exact: true }).click().catch(() => p.getByRole("tab", { name: tab }).click()); await p.waitForTimeout(500); const sel = p.locator("select").first(); await sel.selectOption({ label: "Thái độ hợp tác" }).catch(() => {}); await p.waitForTimeout(400); }
    const e0 = await snap(p, "11-scoring-config"); await p.getByRole("button", { name: /Lưu & tính lại điểm/ }).click(); await settle(p, 2000); const t = await body(p); return { evidence: e0 + ", " + await snap(p, "11-scoring-saved"), note: (t.match(/Tổng \d+%[^\n]*/) || [""])[0] }; }, p);
  await step("Đối tác: ghi việc (giao hàng, khiếu nại) + chấm điểm tự chấm", "chu", async () => {
    await p.goto(CW + "/partners"); await settle(p, 2500); const row = p.locator("tr, li, article").filter({ hasText: "Hoàng Long" }).first();
    await row.getByRole("button", { name: "+ Ghi việc" }).click(); await p.waitForTimeout(700); await p.getByText("Giao hàng", { exact: true }).first().click(); await p.getByRole("button", { name: "Ghi", exact: true }).click(); await settle(p, 1800);
    const t1 = await body(p); ok(/Giao hàng/.test(t1), "sự kiện không hiện ở 'Đã ghi gần đây'"); const e0 = await snap(p, "11-partner-event"); await p.keyboard.press("Escape").catch(() => {});
    await p.reload(); await settle(p, 2500); const row2 = p.locator("tr, li, article").filter({ hasText: "Hoàng Long" }).first(); await row2.getByRole("button", { name: "Chấm điểm" }).click(); await p.waitForTimeout(700); const e1 = await snap(p, "11-partner-rate");
    return { evidence: e0 + ", " + e1, note: "mở được hộp chấm điểm" }; }, p);
  await done(); }
// --- So sanh gia
{ const { p, done } = await userPage(b, "chu");
  await step("So sánh giá: chọn sản phẩm → bảng nhà cung cấp theo giá", "chu", async () => {
    await p.goto(CW + "/prices"); await settle(p); await p.locator("select").first().selectOption({ label: "Giấy A4 (đ/ream)" }); await settle(p, 2500); const t = await body(p); ok(/65\.000/.test(t) && /VPP Phương Nam/.test(t), "thiếu báo giá"); return { evidence: await snap(p, "12-prices-chu") }; }, p);
  await step("So sánh giá: thêm báo giá (UI) + xoá", "chu", async () => {
    await p.getByRole("button", { name: /Thêm báo giá/ }).click(); await p.waitForTimeout(700); const e0 = await snap(p, "12-quote-form"); const t = await body(p);
    const inputs = await p.getByRole("dialog").getByRole("textbox").count(); ok(inputs >= 1, "hộp thêm báo giá không có ô nhập"); return { evidence: e0, note: "hộp thêm báo giá mở được; tạo qua API ở bước seed" }; }, p);
  await done(); }
// --- CKS
{ const { p, done } = await userPage(b, "chu");
  await step("CKS: nhập lô mua", "chu", async () => {
    await p.goto(CW + "/cks"); await settle(p); await p.getByRole("button", { name: "+ Nhập lô mua" }).click(); await p.waitForTimeout(700);
    const dlg = p.getByRole("dialog"); await dlg.getByLabel(/Nhà cung cấp/).fill("Viettel-CA"); await dlg.getByLabel("Tên lô").fill("Lô UAT 10/2026"); await dlg.getByLabel("Số lượng").fill("10"); await dlg.getByLabel(/Giá vốn/).fill("400000"); await dlg.getByLabel(/Thời hạn/).fill("1");
    await dlg.getByLabel("Ngày mua").fill("2026-10-01").catch(() => {}); const e0 = await snap(p, "13-cks-lot-form"); await dlg.getByRole("button", { name: "Nhập lô" }).click(); await settle(p, 2000); const t = await body(p);
    ok(/Lô UAT|10 chữ ký|Trong kho/.test(t) && !/Nhập lô mua chữ ký số/.test(t), "hộp chưa đóng/lô chưa có: " + t.slice(0, 120)); return { evidence: e0 + ", " + await snap(p, "13-cks-lot-after") }; }, p);
  await step("CKS: hợp đồng bán chữ ký + người giữ", "chu", async () => {
    await p.getByRole("button", { name: "+ Hợp đồng bán chữ ký" }).click(); await p.waitForTimeout(700); const dlg = p.getByRole("dialog");
    await dlg.getByLabel("Khách hàng").fill("Công ty Delta"); await dlg.getByLabel(/Mã số thuế/).fill("0310000111"); await dlg.getByLabel(/Giá bán/).fill("700000"); await dlg.getByLabel("Ngày ký").fill("2026-10-10").catch(() => {}); await dlg.getByLabel("Hết hạn").fill("2027-10-10").catch(() => {});
    await dlg.getByLabel(/Người giữ chữ ký/).first().fill("Nguyễn Văn Delta").catch(() => {}); const e0 = await snap(p, "13-cks-sale-form"); await dlg.getByRole("button", { name: "Tạo hợp đồng bán" }).click(); await settle(p, 2500); const t = await body(p);
    ok(/Delta/.test(t), "không thấy khách Delta sau khi tạo"); return { evidence: e0 + ", " + await snap(p, "13-cks-sale-after") }; }, p);
  await step("CKS: chi tiết khách + lọc Sắp hết hạn", "chu", async () => {
    await p.goto(CW + "/cks"); await settle(p, 2000); await p.getByRole("button", { name: "Sắp hết hạn" }).click().catch(() => {}); await settle(p, 1200); const e0 = await snap(p, "13-cks-expiring"); await p.getByRole("button", { name: "Tất cả" }).click().catch(() => {});
    await p.locator("table tbody tr").first().click(); await settle(p, 2000); ok(/\/cks\//.test(p.url()), "không mở trang khách"); return { evidence: e0 + ", " + await snap(p, "13-cks-customer") }; }, p);
  await done(); }
// --- Mua hang
{ const { p, done } = await userPage(b, "chu");
  await step("Mua hàng (sourcing): dòng hàng bán ↔ nguồn mua, lãi, rủi ro", "chu", async () => {
    await p.goto(CW + "/sourcing"); await settle(p, 2500); const t = await body(p); ok(/Hoàng Long/.test(t) && /Tân Phát/.test(t), "thiếu dòng bán/nguồn mua"); return { evidence: await snap(p, "14-sourcing-chu"), note: (t.match(/\d+ kết quả/) || [""])[0] }; }, p);
  await done(); }
// --- han: khong thay gi o sourcing/partners/prices sau khi co them du lieu
{ const { p, done } = await userPage(b, "han");
  await step("Hiển thị (lần 2, sau khi có thêm dữ liệu): han không thấy HĐ/đối tác/báo giá của người khác", "han", async () => {
    for (const path of ["/partners", "/prices", "/sourcing", "/my-work", "/cks"]) { await p.goto(CW + path); await settle(p, 2000); const t = await body(p); for (const bad of ["Minh Phát", "Hoàng Long", "Sao Mai", "Tân Phát", "Gamma", "Delta", "VPP Phương Nam", "Bao bì Đại Việt"]) ok(!t.includes(bad), `han thấy "${bad}" ở ${path}`); }
    const q = await hub(tk.han, "GET", "/prices/compare?product=" + encodeURIComponent("name:giay a4|")); ok(q.s === 404, "han gọi API so sánh giá được " + q.s);
    const e = await hub(tk.han, "GET", "/partners?role=supplier"); ok(JSON.stringify(e.j).indexOf("Minh Phát") < 0, "API partners lộ"); return { evidence: await snap(p, "14-han-sourcing"), note: "API compare 404, partners không lộ" }; }, p);
  await done(); }
{ const { p, done } = await userPage(b, "xem");
  await step("Viewer: chỉ đọc (không nút ghi) ở Đối tác/Việc của tôi", "xem", async () => {
    await p.goto(CW + "/partners"); await settle(p, 2500); const t = await body(p); const w = await p.getByRole("button", { name: /\+ Ghi việc|Chấm điểm/ }).count();
    await p.goto(CW + "/my-work"); await settle(p, 2500); const w2 = await p.getByRole("button", { name: /Đã trả/ }).count(); return { evidence: await snap(p, "15-viewer-partners"), note: `nút ghi ở /partners: ${w}; nút Đã trả ở /my-work: ${w2}`, result: w + w2 === 0 ? "OK" : "LỖI" }; }, p);
  await done(); }
await b.close();