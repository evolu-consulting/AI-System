// Kịch bản 4 — không có sandbox ⇒ "Cần người quyết" sandbox_unavailable (chỉ 2 nút). Hai biến thể:
//  E1 RUNTIME_SANDBOX=off (tắt hẳn) · E2 RUNTIME_SANDBOX=docker nhưng ảnh không tồn tại (mô phỏng Docker/ảnh không dùng được).
// Docker Desktop thật KHÔNG bị tắt (sẽ làm hỏng cả stack dev); đây là giả lập cấu hình, ghi rõ trong REPORT.
import { launch, chatLogin, adminLogin, mkSnap, mkStep, startRun, waitRun } from "./lib.mjs";
import { setDef, b64, BASE_INSTR } from "./cfg.mjs";
import { cancelRun } from "./api.mjs";
import { sql } from "./sql.mjs";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const OUT = "D:/AI/ai-system/docs/specs/P-c-autofix/evidence/2026-10-14";
const REV = "a7ed5de4-bb6f-45bb-bdd7-a4f5598983be";
const A = await launch(OUT), D = await launch(OUT);
const snap = mkSnap(OUT);
const { step, log, save } = mkStep(OUT, () => ({ A: A.page, D: D.page }), snap);
const S = {};
const sh = (mode) => execFileSync("bash", ["D:/AI/ai-system/docs/specs/P-c-autofix/evidence/2026-10-14/scripts/runtime.sh", mode], { encoding: "utf8" });
const dec = (p) => p.getByRole("region", { name: "Cần người quyết" });
const FIX = `Sửa add. #fake:ws_write=src/calc.ts|${b64("export function add(a: number, b: number): number {\n  return a + b;\n}\n")}`;

async function case_(id, mode, tag) {
  await step(id, `Runtime ${mode} ⇒ run => sandbox_unavailable; chat-web: heading 'Không có môi trường chạy an toàn', 2 nút, không nhóm lỗi`, async () => {
    const out = sh(mode); console.log("  runtime:", out.trim());
    const { runId } = await startRun(A.page, "fixbug-apply", FIX, snap, `${tag}-A`);
    S[tag] = runId;
    const st = await waitRun(runId, /needs_decision|waiting_review|done|failed|cancel/, 150);
    const reason = sql(`select reason from hub.review_tasks where process_run_id='${runId}' and status='open'`);
    console.log("  trạng thái:", st, "· lý do:", reason, "· job:", sql(`select status||' '||coalesce(error_reason,'')||' '||coalesce(error_code,'') from hub.jobs where payload->>'type'='agent.cli' order by created_at desc limit 1`));
    await A.page.goto(`http://localhost:3100/runs/${runId}`); await A.page.waitForTimeout(2500);
    await snap(A.page, `${tag}-A-decision-sandbox`, true);
    if (reason !== "sandbox_unavailable") throw new Error("lý do " + reason);
    const d = dec(A.page); await d.waitFor();
    await d.getByRole("heading", { name: "Không có môi trường chạy an toàn" }).waitFor();
    await d.getByRole("button", { name: "Thêm 1 lần làm lại" }).waitFor();
    await d.getByRole("button", { name: "Huỷ lượt chạy" }).waitFor();
    if (await d.getByRole("button", { name: "Dùng bản hiện có" }).count()) throw new Error("có 'Dùng bản hiện có'");
    if (await d.getByText("Đường dẫn", { exact: true }).count()) throw new Error("có nhóm lỗi kiểm");
  });
}
await step("E00", "chuẩn bị + đăng nhập", async () => {
  await setDef({ enabled: true, af: { install_cmd: null, write_allowlist: ["src/**", "test/**"], test_cmd: "bun test" }, instruction: BASE_INSTR, reviewGroup: REV });
  for (const r of sql("select id from hub.process_runs where status in ('running','needs_decision','waiting_review')").split("\n").filter(Boolean)) await cancelRun(r);
  await chatLogin(A.page, "thomas.tran"); await adminLogin(D.page, "julian.bui", "evolu");
});
await case_("E01", "off", "e01");
await step("E02", "[D] admin-web cùng run: tiêu đề + 2 nút", async () => {
  const defId = sql(`select process_def_id from hub.process_runs where id='${S.e01}'`);
  await D.page.goto(`http://localhost:3000/processes/${defId}/runs/${S.e01}`); await D.page.waitForTimeout(3000);
  await snap(D.page, "e02-D-admin-decision-sandbox", true);
  const txt = await D.page.locator("main").innerText();
  if (!/Không có môi trường chạy an toàn/.test(txt)) throw new Error("admin thiếu tiêu đề");
  await D.page.getByRole("button", { name: "Thêm 1 lần làm lại" }).waitFor();
  await cancelRun(S.e01);
});
await case_("E03", "badimage", "e03");
await step("E04", "khôi phục Runtime sandbox=docker; run lại thành công tới gate", async () => {
  await cancelRun(S.e03);
  const out = sh("docker"); console.log("  runtime:", out.trim());
  const { runId } = await startRun(A.page, "fixbug-apply", FIX, snap, "e04-A");
  S.e04 = runId;
  const st = await waitRun(runId, /needs_decision|waiting_review|done|failed|cancel/, 150);
  await cancelRun(runId);
  if (st !== "waiting_review") throw new Error("trạng thái " + st);
});
writeFileSync(`${OUT}/run-e.json`, JSON.stringify(S, null, 2));
save("result-e-sandbox");
for (const x of [A, D]) await x.browser.close();
