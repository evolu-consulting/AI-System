// UAT CR-095 · phan 3c: chay lai buoc cham diem/ghi viec/CKS/viewer sau khi chinh selector (loi script).
import { browser, userPage, snap, step, ok, settle, body, CW, apiTok, hub } from "./lib.mjs";
const b = await browser(); const tk = { xem: await apiTok("xem") };
{ const { p, done } = await userPage(b, "chu");
  await step("Điểm uy tín: thêm tiêu chí tự chấm + lưu & tính lại", "chu", async () => {
    await p.goto(CW + "/settings/scoring"); await settle(p, 2000);
    for (const tab of ["Khách hàng", "Nhà cung cấp"]) { await p.getByText(tab, { exact: true }).first().click(); await p.waitForTimeout(500); await p.locator("select").first().selectOption({ index: 1 }); await p.getByRole("button", { name: /Thêm tiêu chí tự chấm/ }).click(); await p.waitForTimeout(500); }
    const e0 = await snap(p, "11-scoring-config"); await p.locator("button", { hasText: "tính lại điểm" }).first().click(); await settle(p, 2000); const t = await body(p); return { evidence: e0 + ", " + await snap(p, "11-scoring-saved"), note: (t.match(/Đã lưu[^\n]*|Tổng \d+%[^\n]*/) || [""])[0] }; }, p);
  await step("Đối tác: ghi việc (giao hàng) + hộp chấm điểm tự chấm", "chu", async () => {
    await p.goto(CW + "/partners"); await settle(p, 2500); await p.getByRole("button", { name: "+ Ghi việc" }).nth(1).click(); await p.waitForTimeout(700); const dlg = p.getByRole("dialog"); const e0 = await snap(p, "11-partner-event-form");
    await p.locator("select").filter({ hasText: "Giao hàng" }).last().selectOption({ label: "Giao hàng" }); await p.getByRole("button", { name: "Ghi", exact: true }).click(); await settle(p, 1800); const t1 = await body(p); const e1 = await snap(p, "11-partner-event-after");
    ok(!/Chưa ghi việc gì/.test(t1), "sự kiện không hiện ở 'Đã ghi gần đây'"); await p.reload(); await settle(p, 2500); await p.getByRole("button", { name: "Chấm điểm" }).nth(1).click(); await p.waitForTimeout(800);
    return { evidence: [e0, e1, await snap(p, "11-partner-rate")].join(", "), note: (t1.match(/Giao hàng[^\n]*/) || [""])[0] }; }, p);
  await step("CKS: mở rộng nhóm khách (người giữ chữ ký)", "chu", async () => {
    await p.goto(CW + "/cks"); await settle(p, 2000); await p.locator("table tbody tr").first().getByRole("button").first().click(); await settle(p, 1500); const t = await body(p); ok(/Nguyễn Văn Delta/.test(t), "không thấy người giữ chữ ký"); return { evidence: await snap(p, "13-cks-customer") }; }, p);
  await done(); }
{ const { p, done } = await userPage(b, "xem");
  await step("Viewer: nút ghi/chấm điểm ở Đối tác phải ẩn (server trả 403)", "xem", async () => {
    await p.goto(CW + "/partners"); await settle(p, 2500); const n = await p.getByRole("button", { name: /\+ Ghi việc|Chấm điểm/ }).count(); const e = await snap(p, "15-viewer-partners");
    await p.getByRole("button", { name: "+ Ghi việc" }).first().click(); await p.waitForTimeout(500); await p.locator("select").filter({ hasText: "Giao hàng" }).last().selectOption({ label: "Giao hàng" }); await p.getByRole("button", { name: "Ghi", exact: true }).click(); await settle(p, 1500); const t = await body(p); const e2 = await snap(p, "15-viewer-write-attempt");
    const r = await hub(tk.xem, "POST", "/partner-events", { party: "tax:0302222333", role: "customer", type: "delivered" });
    ok(n === 0, `viewer thấy ${n} nút ghi/chấm điểm trên /partners, bấm Ghi → ${(t.match(/(Không có quyền|Bạn không|lỗi|Lỗi|không thể)[^\n]*/) || ["không có thông báo lỗi rõ"])[0]}; server POST /partner-events = ${r.s}`); return { evidence: e + ", " + e2 }; }, p);
  await done(); }
await b.close();