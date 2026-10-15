// Luồng chung: A (thomas.tran) bắt đầu !fixbug-pr → vòng sửa → B (vio.ngo, nhóm duyệt) bấm Đạt → Áp (fake apply) → chụp kết quả.
import { chatLogin, startRun, waitRun } from "./lib.mjs";
import { sql } from "./sql.mjs";
import { b64, FIXED } from "./cfg2.mjs";
export const OUT = "D:/AI/ai-system/docs/specs/P-c2-pr/evidence/2026-10-15/r2tmp"; // vòng 2: ảnh ra r2tmp rồi đổi tên hậu tố -r2
export const timing = {};
export const region = (p) => p.getByRole("region", { name: "Kết quả áp bản sửa" });
export async function prepare(A, B) { await chatLogin(A.page, "thomas.tran"); await chatLogin(B.page, "vio.ngo"); }
export async function cancelOpen() {
  const { login, hub } = await import("./api.mjs");
  const t = await login("evolu", "thomas.tran");
  for (const r of sql("select id from hub.process_runs where status in ('running','needs_decision','waiting_review')").split("\n").filter(Boolean)) await hub(t, "POST", `/process-runs/${r}/cancel`, {});
}
/** Bắt đầu run + chờ tới cổng duyệt. Trả runId. */
export async function startToGate(A, snap, tag, note = "") {
  const { runId } = await startRun(A.page, "fixbug-pr", `Hàm add(2,3) trả -1 thay vì 5 (${tag}). #fake:ws_write=src/calc.ts|${b64(FIXED)}`, snap, `${tag}-A`);
  const st = await waitRun(runId, /needs_decision|waiting_review|done|failed|cancel/, 240);
  if (st !== "waiting_review") {
    const e = new Error(`${tag}: tới cổng bị ${st} (${sql(`select decision->>'reason' from hub.process_runs where id='${runId}'`)})`);
    e.runId = runId;
    throw e;
  }
  return runId;
}
/** B bấm Đạt trên cổng tự-sửa; chờ run rời waiting_review/running tới trạng thái cuối hoặc quyết định. */
export async function passGate(B, runId, snap, tag, wait = /done|completed|failed|cancel|needs_decision/) {
  await B.page.goto(`http://localhost:3100/runs/${runId}`);
  await B.page.getByRole("region", { name: "Kết quả tự sửa mã" }).waitFor();
  await snap(B.page, `${tag}-B-gate`, true);
  const t0 = Date.now();
  await B.page.getByRole("button", { name: "Đạt", exact: true }).click();
  // đo Đạt → PR mở (không sweep tay; vòng nền thật startProcessSweeper)
  const prDeadline = Date.now() + 60000;
  while (Date.now() < prDeadline) {
    const r = sql(`select status||'|'||coalesce(pr_url,'') from hub.autofix_applies where process_run_id='${runId}' order by created_at desc limit 1`);
    if (/^(pr_opened|branch_only|pushed|failed|conflict|check_failed|no_changes)/.test(r) && r.split("|")[0] !== "pushed" || /pr_opened/.test(r)) { timing[tag] = { ms: Date.now() - t0, row: r }; break; }
    await new Promise((x) => setTimeout(x, 250));
  }
  return waitRun(runId, wait, 180);
}
export const applyRow = (runId) => sql(`select mode,status,coalesce(error_code,''),rebased,coalesce(pr_url,''),coalesce(auto_merge,''),coalesce(branch,'') from hub.autofix_applies where process_run_id='${runId}' order by created_at desc limit 1`);
