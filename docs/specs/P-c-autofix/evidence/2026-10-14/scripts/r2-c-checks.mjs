// Kịch bản 3 + 5 (quyết định) — kiểm diff trượt: paths / secrets / tests ⇒ "Cần người quyết" autofix_check_failed (sandbox Docker thật).
// A = thomas.tran (người khởi chạy, chat-web) · B = vio.ngo (người duyệt, KHÔNG phải người khởi chạy) · D = julian.bui (tenant_admin, admin-web)
import { launch, chatLogin, adminLogin, mkSnap, mkStep, startRun, waitRun } from "./lib.mjs";
import { setDef, b64, BASE_INSTR } from "./cfg.mjs";
import { login, hub, cancelRun } from "./api.mjs";
import { sql } from "./sql.mjs";
import { writeFileSync } from "node:fs";
const OUT = "D:/AI/ai-system/docs/specs/P-c-autofix/evidence/2026-10-14/round2";
const REV = "a7ed5de4-bb6f-45bb-bdd7-a4f5598983be";
const A = await launch(OUT), B = await launch(OUT), D = await launch(OUT);
const snap = mkSnap(OUT);
const { step, log, save } = mkStep(OUT, () => ({ A: A.page, B: B.page, D: D.page }), snap);
const S = {};
const dec = (p) => p.getByRole("region", { name: "Cần người quyết" });
const BUG = "Hàm add(2,3) trả -1 thay vì 5, sửa lại.";
const reasonOf = (run) => sql(`select reason from hub.review_tasks where process_run_id='${run}' and status='open' order by created_at desc limit 1`);
const fails = (run) => sql(`select round||':'||status||':'||failures::text from hub.autofix_results where process_run_id='${run}' order by created_at`).split("\n");

async function start(page, tag, directive) {
  const { runId } = await startRun(page, "fixbug-apply", `${BUG} ${directive}`, snap, tag);
  const st = await waitRun(runId, /needs_decision|waiting_review|done|failed|cancel/, 150);
  return { runId, st };
}

await step("C00", "chuẩn bị: allowlist src/** + test/**, install=null, test 'bun test'; huỷ run dở", async () => {
  await setDef({ enabled: true, af: { install_cmd: null, write_allowlist: ["src/**", "test/**"], test_cmd: "bun test" }, instruction: BASE_INSTR, reviewGroup: REV });
  for (const r of sql("select id from hub.process_runs where status in ('running','needs_decision','waiting_review')").split("\n").filter(Boolean)) await cancelRun(r);
  await chatLogin(A.page, "thomas.tran"); await chatLogin(B.page, "vio.ngo"); await adminLogin(D.page, "julian.bui", "evolu");
});

// ---- C1: paths ----
await step("C01", "[A] ghi docs/NOTE.md (ngoài allowlist) ⇒ Cần người quyết 'Kiểm bản sửa không đạt', nhóm Đường dẫn; chỉ 2 nút", async () => {
  const r = await start(A.page, "c01-A", `#fake:ws_write=docs/NOTE.md|${b64("ghi chu\n")}`);
  S.c1 = r.runId;
  if (r.st !== "needs_decision") throw new Error("trạng thái " + r.st);
  if (reasonOf(S.c1) !== "autofix_check_failed") throw new Error("lý do " + reasonOf(S.c1));
  await A.page.goto(`http://localhost:3100/runs/${S.c1}`);
  const d = dec(A.page); await d.waitFor();
  await d.getByRole("heading", { name: "Kiểm bản sửa không đạt" }).waitFor();
  await d.getByText("Đường dẫn", { exact: true }).waitFor();
  await d.getByText("docs/NOTE.md").first().waitFor();
  await d.getByRole("button", { name: "Thêm 1 lần làm lại" }).waitFor();
  await d.getByRole("button", { name: "Huỷ lượt chạy" }).waitFor();
  if (await d.getByRole("button", { name: "Dùng bản hiện có" }).count()) throw new Error("có 'Dùng bản hiện có'");
  if (await A.page.getByRole("region", { name: "Kết quả tự sửa mã" }).count()) console.log("  (khối diff vẫn hiện?)");
  await snap(A.page, "c01-A-decision-paths", true);
  console.log("  failures:", fails(S.c1).join(" | "));
});
await step("C02", "[A] thread phòng: thẻ run 'Cần người quyết' có dòng 'Kiểm không đạt'", async () => {
  await A.page.goto("http://localhost:3100/rooms/d2a00000-0000-4000-8000-000000000002"); await A.page.waitForTimeout(3000);
  await snap(A.page, "c02-A-thread-check-failed");
});
await step("C03", "[D] admin-web cùng run: cùng nhóm lỗi + 2 nút, không 'Dùng bản hiện có'", async () => {
  const defId = sql(`select process_def_id from hub.process_runs where id='${S.c1}'`); S.defId = defId;
  await D.page.goto(`http://localhost:3000/processes/${defId}/runs/${S.c1}`); await D.page.waitForTimeout(3000);
  await snap(D.page, "c03-D-admin-decision-paths", true);
  const txt = await D.page.locator("main").innerText();
  if (!/Đường dẫn/.test(txt) || !/docs\/NOTE\.md/.test(txt)) throw new Error("admin thiếu nhóm Đường dẫn");
  await D.page.getByRole("button", { name: "Thêm 1 lần làm lại" }).waitFor();
  await D.page.getByRole("button", { name: "Huỷ lượt chạy" }).first().waitFor();
  if (await D.page.getByRole("button", { name: "Dùng bản hiện có" }).count()) throw new Error("admin có 'Dùng bản hiện có'");
});
await step("C04", "quyền quyết định: vio.ngo (người duyệt, không phải người khởi chạy) bị từ chối; use_current => 409; thomas/julian được", async () => {
  const tv = await login("evolu", "vio.ngo"), tt = await login("evolu", "thomas.tran");
  const r1 = await hub(tv, "POST", `/process-runs/${S.c1}/decide`, { option: "add_attempt", stage_idx: 0 });
  const r2 = await hub(tt, "POST", `/process-runs/${S.c1}/decide`, { option: "use_current", stage_idx: 0 });
  const out = { vio_add_attempt: [r1.status, r1.json?.error?.code], thomas_use_current: [r2.status, r2.json?.error?.code] };
  writeFileSync(`${OUT}/api-decide-perms.json`, JSON.stringify(out, null, 2)); console.log("  ", JSON.stringify(out));
  if (![403, 404].includes(r1.status)) throw new Error("vio quyết được autofix_*: " + r1.status);
  if (r2.status !== 409) throw new Error("use_current " + r2.status);
  if (reasonOf(S.c1) !== "autofix_check_failed") throw new Error("run bị đổi trạng thái");
  await B.page.goto(`http://localhost:3100/runs/${S.c1}`); await B.page.waitForTimeout(2500);
  await snap(B.page, "c04-B-vio-view");
});
await step("C05", "[A] 'Thêm 1 lần làm lại' ⇒ vòng 2 chạy tiếp; lỗi của vòng 1 không còn hiển thị như lỗi hiện tại", async () => {
  await A.page.goto(`http://localhost:3100/runs/${S.c1}`);
  await dec(A.page).getByRole("button", { name: "Thêm 1 lần làm lại" }).click();
  for (let i = 0; i < 60 && fails(S.c1).length < 2; i++) await A.page.waitForTimeout(2000);
  await waitRun(S.c1, /waiting_review|needs_decision|done|failed|cancel/, 90);
  await A.page.waitForTimeout(3000);
  await A.page.reload(); await A.page.waitForTimeout(2500);
  await snap(A.page, "c05-A-after-add-attempt", true);
  const f = fails(S.c1); console.log("  kết quả:", f.join(" | "));
  if (f.length < 2) throw new Error("không có vòng 2");
  if (!/^2:/.test(f[1])) throw new Error("vòng 2 sai: " + f[1]);
  const prompt = sql(`select right(payload->>'prompt', 600) from hub.jobs where payload->>'type'='agent.cli' order by created_at desc limit 1`);
  S.retryPrompt = prompt; console.log("  prompt lượt thêm (đuôi):", prompt.replace(/\n/g, " ⏎ ").slice(-400));
});
await step("C06", "[A] huỷ run C1 từ UI (nút Huỷ lượt chạy / Huỷ) để dọn", async () => {
  const st = sql(`select status from hub.process_runs where id='${S.c1}'`);
  if (/cancel|done/.test(st)) return;
  await cancelRun(S.c1);
});

// ---- C2: secrets ----
await step("C10", "[A] ws_secret (dòng AKIA…) ⇒ nhóm 'Bí mật (không hiện giá trị)' chỉ path:line · quy tắc; KHÔNG lộ giá trị (UI, API run view, log, DB)", async () => {
  const r = await start(A.page, "c10-A", "#fake:ws_secret=src/cfg.ts");
  S.c2 = r.runId;
  if (r.st !== "needs_decision" || reasonOf(S.c2) !== "autofix_check_failed") throw new Error(r.st + " " + reasonOf(S.c2));
  await A.page.goto(`http://localhost:3100/runs/${S.c2}`);
  const d = dec(A.page); await d.waitFor();
  await d.getByText("Bí mật (không hiện giá trị)").waitFor();
  const txt = await A.page.locator("body").innerText();
  const m = /src\/cfg\.ts:\d+ · quy tắc [a-z_]+/.exec(txt); if (!m) throw new Error("thiếu dòng path:line · quy tắc");
  console.log("  dòng:", m[0]);
  if (/AKIA[0-9A-Z]{4}/.test(txt)) throw new Error("LỘ giá trị bí mật trên UI");
  await snap(A.page, "c10-A-decision-secrets", true);
  const dump = JSON.stringify((await hub(await login("evolu", "thomas.tran"), "GET", "/process-runs/" + S.c2)).json) + sql(`select failures::text||commands::text from hub.autofix_results where process_run_id='${S.c2}'`);
  S.secretLeak = /AKIA[0-9A-Z]{6}/.test(dump); console.log("  AKIA trong API/DB:", S.secretLeak);
  if (S.secretLeak) throw new Error("LỘ giá trị bí mật trong API/DB");
});
await step("C11", "[D] admin-web: nhóm Bí mật cùng cách hiển thị, không lộ giá trị; 'Huỷ lượt chạy' => run đã huỷ", async () => {
  await D.page.goto(`http://localhost:3000/processes/${S.defId}/runs/${S.c2}`); await D.page.waitForTimeout(3000);
  await snap(D.page, "c11-D-admin-decision-secrets", true);
  const txt = await D.page.locator("main").innerText();
  if (!/Bí mật/.test(txt)) throw new Error("admin thiếu nhóm Bí mật");
  if (/AKIA[0-9A-Z]{4}/.test(txt)) throw new Error("admin lộ giá trị");
  await D.page.getByRole("button", { name: "Huỷ lượt chạy" }).last().click();
  const c = D.page.getByRole("button", { name: /Xác nhận|Huỷ lượt chạy|Đồng ý/ }).last();
  await D.page.waitForTimeout(1500); await snap(D.page, "c11b-D-cancel-dialog");
  await waitRun(S.c2, /cancel/, 20).catch(async () => { await D.page.getByRole("dialog").getByRole("button").last().click().catch(() => {}); await waitRun(S.c2, /cancel/, 20); });
});

// ---- C3: tests ----
await step("C20", "[A] sửa sai (a*b) ⇒ nhóm 'Test đỏ · exit 1', đuôi log + 'Tải log đầy đủ'", async () => {
  const r = await start(A.page, "c20-A", `#fake:ws_write=src/calc.ts|${b64("export function add(a: number, b: number): number {\n  return a * b;\n}\n")}`);
  S.c3 = r.runId;
  if (r.st !== "needs_decision" || reasonOf(S.c3) !== "autofix_check_failed") throw new Error(r.st + " " + reasonOf(S.c3));
  await A.page.goto(`http://localhost:3100/runs/${S.c3}`);
  const d = dec(A.page); await d.waitFor();
  await d.getByText(/Test đỏ · exit \d+/).waitFor();
  await snap(A.page, "c20-A-decision-tests", true);
  const dl = A.page.waitForEvent("download");
  await d.getByRole("button", { name: "Tải log đầy đủ" }).or(d.getByRole("link", { name: "Tải log đầy đủ" })).click();
  const f = await dl; await f.saveAs(`${OUT}/dl-${f.suggestedFilename()}`); console.log("  tải:", f.suggestedFilename());
  console.log("  failures:", fails(S.c3).join(" | ").slice(0, 300));
});
await step("C21", "[A] huỷ run C3", async () => { await dec(A.page).getByRole("button", { name: "Huỷ lượt chạy" }).click(); await waitRun(S.c3, /cancel/, 30).catch(() => cancelRun(S.c3)); });

// ---- C4: nguồn local_path không bị ghi ngược ----
await step("C30", "nguồn local_path KHÔNG bị ghi ngược: .data/uat-autofix-repo/src/calc.ts còn nguyên bug", async () => {
  const { readFileSync } = await import("node:fs");
  const t = readFileSync("D:/AI/ai-system/.data/uat-autofix-repo/src/calc.ts", "utf8");
  if (!/a - b/.test(t)) throw new Error("nguồn bị sửa: " + t);
});
writeFileSync(`${OUT}/run-r2-c.json`, JSON.stringify(S, null, 2));
save("result-r2-c");
for (const x of [A, B, D]) await x.browser.close();
