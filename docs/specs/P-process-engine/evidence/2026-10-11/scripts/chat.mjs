// UAT P-a · chat-web: S1 (khởi chạy 3 đường), nhánh needs_decision (template_invalid), S4 (ngoài phòng / starter-left), S5 Token.
import { launch, ctx, snap, chatLogin, mkRoom, mkStep, save, expect, CHAT, roomLog, results } from "./lib.mjs";
import { execFileSync } from "node:child_process";
const sql = (q) => execFileSync("docker", ["exec", "ai-system-postgres-1", "psql", "-U", "ai", "-d", "ai_system", "-Atc", q]).toString().trim();
const b = await launch();
const L = await ctx(b), H = await ctx(b), M = await ctx(b);
const step = mkStep(() => ({ L: L.p, H: H.p, M: M.p }));
const stamp = String(Date.now() % 100000);
for (const [n, c] of Object.entries({ L, H })) c.p.on("response", (r) => { const u = new URL(r.url()); if (u.port === "3100" && r.status() >= 400 && !u.pathname.includes("auth/refresh")) console.log("   HTTP", n, r.status(), u.pathname); });
const box = (p) => p.getByRole("textbox", { name: "Tin nhắn cho nhóm" });
const block = (p) => roomLog(p).getByRole("article", { name: "Quy trình Xử lý hoá đơn" });
const flowPane = (p) => p.getByRole("complementary", { name: "Flow đang mở" });
let R1, R2, runA, runB, runC;
async function send(p, urlRe) {
  const resp = p.waitForResponse((r) => r.request().method() === "POST" && urlRe.test(new URL(r.url()).pathname));
  await p.getByRole("button", { name: "Gửi", exact: true }).click();
  const r = await resp;
  return { status: r.status(), run: r.headers()["x-process-run-id"] ?? null };
}
const ROOMMSG = /\/rooms\/[^/]+\/messages$/;
await step("01", "lan / hoa / minh đăng nhập chat-web (3 context, vi-VN)", async () => {
  R1 = await mkRoom("lan", `HĐ R1 ${stamp}`, ["hoa"]);
  R2 = await mkRoom("hoa", `HĐ R2 ${stamp}`, ["lan"]);
  await chatLogin(L.p, "lan"); await chatLogin(H.p, "hoa"); await chatLogin(M.p, "minh");
  await snap(L.p, "01-L-login");
});
await step("02", "S1a · lan gõ !hoa-don trong phòng ⇒ khối quy trình hiện ở cả lan và hoa", async () => {
  await L.p.goto(`${CHAT}/rooms/${R1}`); await H.p.goto(`${CHAT}/rooms/${R1}`);
  await box(L.p).fill("!hoa-don HD-101 5.000.000");
  const s = await send(L.p, ROOMMSG); runA = s.run;
  expect(s.status).toBe(201); expect(runA, "header X-Process-Run-Id").toBeTruthy();
  await expect(block(L.p)).toBeVisible(); await expect(block(H.p)).toBeVisible({ timeout: 15000 });
  await snap(L.p, "02-L-block-started"); await snap(H.p, "02-H-block-seen");
});
await step("03", "S1b · nút Quy trình: chọn mẫu ⇒ chèn !hoa-don, gửi ⇒ khối thứ 2", async () => {
  await L.p.getByRole("button", { name: "Quy trình", exact: true }).click();
  await snap(L.p, "03-L-menu");
  await L.p.getByRole("option", { name: /Xử lý hoá đơn/ }).click();
  await expect(box(L.p)).toHaveValue(/^!hoa-don\s/);
  await box(L.p).pressSequentially("HD-102 7.000.000");
  const s = await send(L.p, ROOMMSG); runB = s.run; expect(runB).toBeTruthy();
  await expect(block(L.p)).toHaveCount(2, { timeout: 15000 }); await snap(L.p, "03-L-two-blocks");
});
await step("04", "S1c · Hỏi AI (/c/new): !hoa-don khởi chạy từ hội thoại AI", async () => {
  await L.p.goto(`${CHAT}/c/new`);
  const tb = L.p.getByRole("textbox").first(); await tb.fill("!hoa-don HD-103 9.000.000");
  const resp = L.p.waitForResponse((r) => r.request().method() === "POST" && /messages|process-runs|chat/.test(new URL(r.url()).pathname));
  await L.p.keyboard.press("Enter"); const r = await resp; const run = r.headers()["x-process-run-id"] ?? null;
  console.log("   askAI POST", r.status(), new URL(r.url()).pathname, "run=", run);
  await L.p.waitForTimeout(6000); await snap(L.p, "04-L-askai");
  expect(run, "Hỏi AI !key phải trả X-Process-Run-Id").toBeTruthy();
});
await step("05", "Giai đoạn chạy bằng fake-cli ⇒ dừng Cần người quyết (template_invalid): khối + thẻ", async () => {
  await L.p.goto(`${CHAT}/rooms/${R1}`); await H.p.goto(`${CHAT}/rooms/${R1}`);
  await L.p.waitForTimeout(15000); console.log("   block text:", (await block(L.p).first().innerText()).replace(/\s+/g, " ").slice(0, 200));
  await expect(block(L.p).first()).toContainText("Cần người quyết", { timeout: 20000 });
  await snap(L.p, "05-L-needs-decision"); await snap(H.p, "05-H-needs-decision");
  console.log("   DB run A:", sql(`select status||'/'||coalesce(decision->>'reason','') from hub.process_runs where id='${runA}'`));
});
await step("06", "Quyết định: Thêm 1 lần làm lại; Huỷ lượt chạy", async () => {
  await block(L.p).first().getByRole("button", { name: "Trả lời tiếp" }).click();
  const fp = flowPane(L.p); await expect(fp).toBeVisible();
  const before = sql(`select count(*) from hub.process_outputs where process_run_id='${runA}'`);
  await fp.getByRole("button", { name: "Thêm 1 lần làm lại" }).last().click();
  await L.p.waitForTimeout(8000); await snap(L.p, "06-L-after-addattempt");
  console.log("   outputs", before, "->", sql(`select count(*) from hub.process_outputs where process_run_id='${runA}'`), sql(`select status from hub.process_runs where id='${runA}'`));
  await fp.getByRole("button", { name: "Huỷ lượt chạy" }).last().click();
  await L.p.waitForTimeout(1200); await snap(L.p, "06-L-cancel-confirm");
  const dlg = L.p.getByRole("alertdialog").or(L.p.getByRole("dialog"));
  if (await dlg.count()) await dlg.getByRole("button", { name: /Huỷ lượt chạy|Xác nhận|Đồng ý/ }).last().click();
  await L.p.waitForTimeout(2500); await snap(L.p, "06-L-cancelled");
  console.log("   run A status:", sql(`select status from hub.process_runs where id='${runA}'`));
});
await step("07", "S4 · lan: DM Quy trình (hộp thư) có thẻ quyết định", async () => {
  await L.p.getByRole("link", { name: /^Quy trình/ }).first().click();
  await expect(L.p.getByRole("log", { name: "Thông báo quy trình" })).toBeVisible();
  await snap(L.p, "07-L-inbox");
});
await step("08", "S4 · minh (ngoài phòng, không phải người khởi chạy): hộp thư + mở /runs/:id của lan", async () => {
  await M.p.getByRole("link", { name: /^Quy trình/ }).first().click(); await M.p.waitForTimeout(1500); await snap(M.p, "08-M-inbox");
  await M.p.goto(`${CHAT}/runs/${runB}`); await M.p.waitForTimeout(2500); await snap(M.p, "08-M-runpage");
  console.log("   minh /runs :", (await M.p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300));
});
await step("09", "S4 U5 · lan rời phòng R2 (đã khởi chạy run ở R2) ⇒ xem /runs/:id", async () => {
  await L.p.goto(`${CHAT}/rooms/${R2}`); await box(L.p).fill("!hoa-don HD-201 1.000.000");
  runC = (await send(L.p, ROOMMSG)).run; expect(runC).toBeTruthy();
  await expect(block(L.p)).toBeVisible();
  await L.p.getByRole("button", { name: "Tuỳ chọn phòng" }).click(); await snap(L.p, "09-L-room-options");
  await L.p.getByRole("menuitem", { name: /Rời/ }).click();
  const dlg = L.p.getByRole("alertdialog").or(L.p.getByRole("dialog"));
  if (await dlg.count()) { await snap(L.p, "09-L-leave-confirm"); await dlg.getByRole("button", { name: /Rời/ }).last().click(); }
  await L.p.waitForTimeout(2500);
  await L.p.goto(`${CHAT}/runs/${runC}`); await L.p.waitForTimeout(2500); await snap(L.p, "09-L-runpage-after-leave");
  console.log("   lan(left) /runs:", (await L.p.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 300));
});
await step("10", "S5 · tab Token trên /runs/:id khớp Σ usage_logs", async () => {
  await L.p.goto(`${CHAT}/runs/${runB}?tab=token`);
  await expect(L.p.getByRole("table", { name: "Token theo giai đoạn" })).toBeVisible();
  const tot = await L.p.getByTestId("process-total-tokens").innerText();
  const sum = sql(`select coalesce(sum(ul.input_tokens+ul.output_tokens),0) from hub.usage_logs ul join hub.runs r on r.id=ul.run_id where r.process_run_id='${runB}'`);
  console.log("   UI total:", tot, "DB sum:", sum);
  expect(tot.replace(/\D/g, "")).toBe(sum); await snap(L.p, "10-L-token");
});
save("chat-result"); await b.close();
console.log(JSON.stringify(results.map((r) => [r.id, r.ok])));
