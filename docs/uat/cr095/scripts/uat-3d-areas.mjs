// UAT CR-095 · phan 3d: cham diem (tong trong so), ghi viec theo ten doi tac, viewer.
import { browser, userPage, snap, step, ok, settle, body, CW, apiTok, hub } from "./lib.mjs";
const b = await browser();
const rowOf = (p, name) => p.locator("div").filter({ has: p.getByText(name, { exact: true }) }).filter({ has: p.getByRole("button", { name: "+ Ghi việc" }) }).last();
{ const { p, done } = await userPage(b, "chu");
  await step("Điểm uy tín: tổng trọng số ≠ 100% thì không cho lưu; sửa về 100% rồi lưu & tính lại", "chu", async () => {
    await p.goto(CW + "/settings/scoring"); await settle(p, 2000);
    for (const tab of ["Khách hàng", "Nhà cung cấp"]) { await p.getByText(tab, { exact: true }).first().click(); await p.waitForTimeout(500); const sel = p.locator("select").first(); if (!(await sel.locator("option").allInnerTexts()).includes("Thái độ hợp tác")) continue; await sel.selectOption({ index: 1 }); await p.getByRole("button", { name: /Thêm tiêu chí tự chấm/ }).click(); await p.waitForTimeout(400);
      const t = await body(p); if (/Tổng 110%/.test(t)) { const dis = await p.locator("button", { hasText: "tính lại điểm" }).first().isDisabled(); ok(dis, "tổng 110% mà nút Lưu vẫn bật"); await p.locator("input[type=number]").first().fill("30"); await p.waitForTimeout(300); } }
    const e0 = await snap(p, "11-scoring-config"); await p.locator("button", { hasText: "tính lại điểm" }).first().click(); await settle(p, 2000); const t = await body(p); return { evidence: e0 + ", " + await snap(p, "11-scoring-saved"), note: (t.match(/Đã lưu[^\n]*|Tổng \d+%[^\n]*/) || [""])[0] }; }, p);
  await step("Đối tác: ghi việc 'Giao hàng' cho Công ty Hoàng Long", "chu", async () => {
    await p.goto(CW + "/partners"); await settle(p, 2500); await rowOf(p, "Công ty Hoàng Long").getByRole("button", { name: "+ Ghi việc" }).click(); await p.waitForTimeout(700); const e0 = await snap(p, "11-partner-event-form");
    await p.locator("select").filter({ hasText: "Giao hàng" }).last().selectOption({ label: "Khiếu nại / tranh chấp" }); await p.getByRole("button", { name: "Ghi", exact: true }).click(); await settle(p, 1800); const t1 = await body(p); const e1 = await snap(p, "11-partner-event-after");
    ok(!/Chưa ghi việc gì/.test(t1) && /Khiếu nại/.test(t1.split("Đã ghi gần đây")[1] || ""), "sự kiện không hiện ở 'Đã ghi gần đây'"); return { evidence: e0 + ", " + e1 }; }, p);
  await step("Đối tác: ghi việc cho Công ty Gamma (HĐ nhập tay do soan tự xác nhận)", "chu", async () => {
    await p.goto(CW + "/partners"); await settle(p, 2500); await rowOf(p, "Công ty Gamma").getByRole("button", { name: "+ Ghi việc" }).click(); await p.waitForTimeout(700);
    await p.getByRole("button", { name: "Ghi", exact: true }).click(); await settle(p, 1500); const t = await body(p); const e = await snap(p, "11-partner-event-gamma");
    ok(!/Không tìm thấy/.test(t), "Ghi việc cho Gamma báo: " + (t.match(/Không tìm thấy[^\n]*/) || [""])[0] + " (API POST /partner-events party=tax:0311111999 → 404, các đối tác khác → 201)"); return { evidence: e }; }, p);
  await done(); }
{ const { p, done } = await userPage(b, "xem");
  await step("Viewer: nút ghi/chấm điểm ở Đối tác phải ẩn (server trả 403)", "xem", async () => {
    await p.goto(CW + "/partners"); await settle(p, 2500); const n = await p.getByRole("button", { name: /\+ Ghi việc|Chấm điểm/ }).count(); const e = await snap(p, "15-viewer-partners");
    await p.getByRole("button", { name: "+ Ghi việc" }).first().click(); await p.waitForTimeout(600); const e2 = await snap(p, "15-viewer-write-attempt");
    ok(n === 0, `viewer thấy ${n} nút "+ Ghi việc"/"Chấm điểm" ở /partners (server POST /partner-events/PUT ratings → 403 PACK_FORBIDDEN)`); return { evidence: e + ", " + e2 }; }, p);
  await done(); }
await b.close();