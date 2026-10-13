// Kịch bản 2/3 bổ sung — (D1) no_changes ⇒ gate "Không có thay đổi" ⇒ Đạt; (D2) lệnh cài lỗi ⇒ nhóm "Cài phụ thuộc" (pha cài có mạng)
// A = thomas.tran · B = vio.ngo (người duyệt)
import { launch, chatLogin, mkSnap, mkStep, startRun, waitRun } from "./lib.mjs";
import { setDef, b64, BASE_INSTR } from "./cfg.mjs";
import { cancelRun } from "./api.mjs";
import { sql } from "./sql.mjs";
import { writeFileSync } from "node:fs";
const OUT = "D:/AI/ai-system/docs/specs/P-c-autofix/evidence/2026-10-14";
const REV = "a7ed5de4-bb6f-45bb-bdd7-a4f5598983be";
const A = await launch(OUT), B = await launch(OUT);
const snap = mkSnap(OUT);
const { step, log, save } = mkStep(OUT, () => ({ A: A.page, B: B.page }), snap);
const S = {};
const dec = (p) => p.getByRole("region", { name: "Cần người quyết" });
const region = (p) => p.getByRole("region", { name: "Kết quả tự sửa mã" });

await step("D00", "chuẩn bị (install=null) + đăng nhập", async () => {
  await setDef({ enabled: true, af: { install_cmd: null, write_allowlist: ["src/**", "test/**"], test_cmd: "bun test" }, instruction: BASE_INSTR, reviewGroup: REV });
  for (const r of sql("select id from hub.process_runs where status in ('running','needs_decision','waiting_review')").split("\n").filter(Boolean)) await cancelRun(r);
  await chatLogin(A.page, "thomas.tran"); await chatLogin(B.page, "vio.ngo");
});
await step("D01", "no_changes (test_cmd=true để test đạt khi không sửa): agent không sửa gì ⇒ gate 'Không có thay đổi' + hướng dẫn, vẫn có Đạt/Chưa đạt", async () => {
  await setDef({ af: { test_cmd: "true" } });
  const { runId } = await startRun(A.page, "fixbug-apply", "Tìm hiểu hàm add, chưa cần sửa.", snap, "d01-A");
  S.d1 = runId;
  const st = await waitRun(runId, /needs_decision|waiting_review|done|failed|cancel/, 150);
  if (st !== "waiting_review") throw new Error("trạng thái " + st);
  await B.page.goto(`http://localhost:3100/runs/${runId}`);
  const r = region(B.page); await r.waitFor();
  await r.getByText("Không có thay đổi", { exact: true }).waitFor();
  await snap(B.page, "d01-B-gate-no-changes", true);
  if (await r.getByRole("list", { name: "Danh sách file" }).count()) throw new Error("no_changes mà có danh sách file");
  await B.page.getByRole("button", { name: "Đạt", exact: true }).waitFor();
  await B.page.getByRole("button", { name: "Chưa đạt", exact: true }).waitFor();
  console.log("  kết quả:", sql(`select status,branch,diff_attachment_id is null from hub.autofix_results where process_run_id='${runId}'`));
});
await step("D02", "[B] Đạt trên no_changes ⇒ run hoàn thành", async () => {
  await B.page.getByRole("button", { name: "Đạt", exact: true }).click();
  const st = await waitRun(S.d1, /done|completed|failed|cancel|needs_decision/, 60);
  if (!/done|completed/.test(st)) throw new Error("run " + st);
});
await step("D10", "lệnh cài lỗi (exit 3) ⇒ nhóm 'Cài phụ thuộc'", async () => {
  await setDef({ af: { install_cmd: "exit 3", test_cmd: "bun test" } });
  const { runId } = await startRun(A.page, "fixbug-apply", `Sửa add. #fake:ws_write=src/calc.ts|${b64("export function add(a: number, b: number): number {\n  return a + b;\n}\n")}`, snap, "d10-A");
  S.d2 = runId;
  const st = await waitRun(runId, /needs_decision|waiting_review|done|failed|cancel/, 200);
  console.log("  trạng thái:", st, "· failures:", sql(`select status||' '||failures::text from hub.autofix_results where process_run_id='${runId}'`));
  await A.page.goto(`http://localhost:3100/runs/${runId}`); await A.page.waitForTimeout(2500);
  await snap(A.page, "d10-A-decision-install", true);
  if (st !== "needs_decision") throw new Error("trạng thái " + st);
  await dec(A.page).getByText("Cài phụ thuộc", { exact: true }).waitFor();
});
await step("D11", "lệnh cài ok (echo) ⇒ chạy tới gate; trả lại install=null", async () => {
  await cancelRun(S.d2);
  await setDef({ af: { install_cmd: "echo cai-xong" } });
  const { runId } = await startRun(A.page, "fixbug-apply", `Sửa add. #fake:ws_write=src/calc.ts|${b64("export function add(a: number, b: number): number {\n  return a + b;\n}\n")}`, snap, "d11-A");
  S.d3 = runId;
  const st = await waitRun(runId, /needs_decision|waiting_review|done|failed|cancel/, 200);
  await B.page.goto(`http://localhost:3100/runs/${runId}`); await B.page.waitForTimeout(2500);
  await snap(B.page, "d11-B-gate-after-install", true);
  await cancelRun(runId);
  await setDef({ af: { install_cmd: null } });
  if (st !== "waiting_review") throw new Error("trạng thái " + st);
});
writeFileSync(`${OUT}/run-d.json`, JSON.stringify(S, null, 2));
save("result-d-more");
for (const x of [A, B]) await x.browser.close();
