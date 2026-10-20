// UAT CR-095 · phan 2b: nguoi gui bam Xac nhan HĐ cua chinh minh (luat "starter").
import { browser, userPage, snap, step, ok, settle, body, CW, apiTok, hub } from "./lib.mjs";
const b = await browser(); const tk = { chu: await apiTok("chu") };
const all = (await hub(tk.chu, "GET", "/contracts?page=1&page_size=100")).j.items;
for (const [u, no, label] of [["soan", "UAT-001", "soan gửi HĐ UAT-001"], ["chu", "HĐ-3214", "chu gửi HĐ-3214"]]) {
  const c = all.find((x) => x.number === no); const { p, done } = await userPage(b, u);
  await step(`Duyệt: người gửi bấm Xác nhận HĐ của mình bị chặn (${label})`, u, async () => {
    await p.goto(CW + "/contracts/" + c.id); await settle(p); const btn = p.getByRole("button", { name: "Xác nhận", exact: true }); const shown = await btn.count();
    ok(shown, "không có nút Xác nhận để thử"); await btn.click(); await settle(p, 2000); const t = await body(p);
    const st = JSON.stringify((await hub(tk.chu, "GET", "/contracts/" + c.id)).j).match(/"status":"([a-z_]+)"/)?.[1];
    ok(st === "needs_review", "người gửi tự duyệt được! status=" + st); ok(/không thể duyệt/.test(t), "không có thông báo lỗi rõ ràng");
    return { evidence: await snap(p, `07-approval-starter-click-${u}`), note: "nút Xác nhận vẫn hiện cho người gửi; bấm → báo: " + (/[^\n]*không thể duyệt[^\n]*/.exec(t)?.[0] || "") + " (UX: nên ẩn/khoá nút)" }; }, p);
  await done();
}
await b.close();