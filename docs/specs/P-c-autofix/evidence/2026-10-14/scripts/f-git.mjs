// Kịch bản 2b — nguồn git_remote (repo công khai octocat/Hello-World): SHA ghim hiển thị "uat-gh@7fd1a60", diff thêm file mới.
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
await step("F01", "def dùng nguồn git_remote uat-gh; run => gate hiển thị 'uat-gh@7fd1a60' + file mới NOTES.md", async () => {
  await setDef({ enabled: true, defSources: ["uat-gh"], af: { source_key: "uat-gh", install_cmd: null, write_allowlist: [], test_cmd: "test -f README" }, instruction: BASE_INSTR, reviewGroup: REV });
  await chatLogin(A.page, "thomas.tran"); await chatLogin(B.page, "vio.ngo");
  const { runId } = await startRun(A.page, "fixbug-apply", `Thêm ghi chú. #fake:ws_write=NOTES.md|${b64("ghi chu uat\n")}`, snap, "f01-A");
  S.run = runId;
  const st = await waitRun(runId, /needs_decision|waiting_review|done|failed|cancel/, 200);
  console.log("  trạng thái:", st, sql(`select status,base_sha,failures::text from hub.autofix_results where process_run_id='${runId}'`));
  await B.page.goto(`http://localhost:3100/runs/${runId}`); await B.page.waitForTimeout(3000);
  await snap(B.page, "f01-B-gate-git-remote", true);
  if (st !== "waiting_review") throw new Error("trạng thái " + st);
  const txt = await B.page.getByRole("region", { name: "Kết quả tự sửa mã" }).innerText();
  if (!txt.includes("uat-gh@7fd1a60")) throw new Error("không thấy uat-gh@7fd1a60: " + txt.slice(0, 200));
});
await step("F02", "khôi phục def về nguồn repo + install=null", async () => {
  await cancelRun(S.run);
  await setDef({ defSources: ["repo"], af: { source_key: "repo", install_cmd: null, write_allowlist: ["src/**", "test/**"], test_cmd: "bun test" } });
});
writeFileSync(`${OUT}/run-f.json`, JSON.stringify(S, null, 2));
save("result-f-git");
for (const x of [A, B]) await x.browser.close();
