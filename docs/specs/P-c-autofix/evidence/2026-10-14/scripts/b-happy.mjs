// Kịch bản 2 + 5 + 6 — run fixbug-apply (sandbox Docker thật, provider fake-cli) -> gate diff -> Chưa đạt (vòng cộng dồn) -> Đạt.
// A = thomas.tran (người khởi chạy, member) · B = vio.ngo (người duyệt: group "SDLC - người duyệt") · C = rowan.nguyen (member không liên quan)
// D = julian.bui (tenant_admin, admin-web) · admin = platform_admin
import { launch, chatLogin, adminLogin, mkSnap, mkStep, startRun, waitRun } from "./lib.mjs";
import { setDef, b64, FIXED, BASE_INSTR } from "./cfg.mjs";
import { login, runView, attGet, cancelRun } from "./api.mjs";
import { sql } from "./sql.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const OUT = "D:/AI/ai-system/docs/specs/P-c-autofix/evidence/2026-10-14";
const REV = "a7ed5de4-bb6f-45bb-bdd7-a4f5598983be";
const A = await launch(OUT), B = await launch(OUT), D = await launch(OUT);
const snap = mkSnap(OUT);
const { step, log, save } = mkStep(OUT, () => ({ A: A.page, B: B.page, D: D.page }), snap);
const S = {}; // trạng thái chia sẻ giữa các bước
const SECT = "#fake:sections=Thay đổi|Test|Bàn giao";
const TEST2 = ['import { expect, test } from "bun:test";', 'import { add } from "../src/calc";', 'test("add", () => { expect(add(2, 3)).toBe(5); });', 'test("add neg", () => { expect(add(-1, 1)).toBe(0); });', ""].join("\n");
const region = (p) => p.getByRole("region", { name: "Kết quả tự sửa mã" });

await step("B00", "chuẩn bị: bật def (install=null, allowlist src/**+test/**, review=SDLC-người duyệt), huỷ run dở", async () => {
  await setDef({ enabled: true, af: { install_cmd: null, write_allowlist: ["src/**", "test/**"], test_cmd: "bun test" }, instruction: BASE_INSTR, reviewGroup: REV });
  for (const r of sql("select id from hub.process_runs where status in ('running','needs_decision','waiting_review')").split("\n").filter(Boolean)) await cancelRun(r);
});
await step("B01", "[A] thomas.tran bắt đầu !fixbug-apply trong phòng Evolu team (chat-web)", async () => {
  await chatLogin(A.page, "thomas.tran");
  const { runId } = await startRun(A.page, "fixbug-apply", `Hàm add(2,3) trả -1 thay vì 5, sửa lại. #fake:ws_write=src/calc.ts|${b64(FIXED)}`, snap, "01-A");
  S.run = runId; S.defId = sql(`select process_def_id from hub.process_runs where id='${runId}'`);
  await A.page.waitForTimeout(2500);
  await snap(A.page, "01-A-thread-started");
});
await step("B02", "[A] job chạy trong sandbox Docker => chờ người duyệt; thẻ thread có khối Tự sửa mã + Xem diff", async () => {
  const st = await waitRun(S.run, /needs_decision|waiting_review|done|failed|cancel/, 180);
  S.afterFirst = st; if (st !== "waiting_review") throw new Error("trạng thái " + st);
  await A.page.waitForTimeout(2500);
  await snap(A.page, "02-A-thread-needs-decision");
  const card = A.page.getByRole("article").filter({ hasText: "Tự sửa mã" }).filter({ hasText: "Xem diff" }).last();
  await card.waitFor({ timeout: 8000 });
  if (!/Vòng \d/.test(await card.innerText())) throw new Error("thiếu 'Vòng k'");
});
await step("B03", "[A] trang run: khối Tự sửa mã (nhánh ai/<uuid>/fix, +1 −1, 1 file, Test đạt); người khởi chạy KHÔNG có nút Đạt/Chưa đạt (không thuộc nhóm duyệt)", async () => {
  await A.page.goto(`http://localhost:3100/runs/${S.run}`);
  const r = region(A.page); await r.waitFor();
  const txt = await r.innerText();
  if (!txt.includes(`ai/${S.run.slice(0, 4)}`)) throw new Error("không thấy nhánh ai/<run>");
  if (!/Test đạt/.test(txt) || !/\+1/.test(txt) || !/1 file/.test(txt)) throw new Error("thiếu số liệu: " + txt.slice(0, 200));
  S.aCanPass = await A.page.getByRole("button", { name: "Đạt", exact: true }).count();
  await snap(A.page, "03-A-run-page-needs-decision", true);
});
await step("B04", "[A] 'Xem log' mở hộp thoại log test; 'Tải .diff' + 'Tải log' tải đúng tên/nội dung", async () => {
  await region(A.page).getByRole("button", { name: "Xem log" }).click();
  await A.page.getByRole("dialog").waitFor();
  await snap(A.page, "04-A-log-dialog");
  await A.page.keyboard.press("Escape");
  const d1 = A.page.waitForEvent("download");
  await region(A.page).getByRole("button", { name: "Tải .diff" }).click();
  const f1 = await d1; const p1 = `${OUT}/dl-${f1.suggestedFilename()}`; await f1.saveAs(p1);
  const d2 = A.page.waitForEvent("download");
  await region(A.page).getByRole("button", { name: "Tải log" }).click();
  const f2 = await d2; const p2 = `${OUT}/dl-${f2.suggestedFilename()}`; await f2.saveAs(p2);
  const diff = readFileSync(p1, "utf8"), lg = readFileSync(p2, "utf8");
  S.dl = [f1.suggestedFilename(), f2.suggestedFilename()];
  if (!/^diff --git a\/src\/calc.ts b\/src\/calc.ts/m.test(diff) || !/\+  return a \+ b;/.test(diff)) throw new Error("diff sai: " + diff.slice(0, 200));
  if (!/pass|0 fail/i.test(lg)) throw new Error("log sai: " + lg.slice(0, 200));
  console.log("  tải:", S.dl.join(", "));
});
await step("B06", "[B] vio.ngo (người duyệt) thấy gate: khối kết quả có diff (src/calc.ts, +1 −1), Test đạt, nút Đạt/Chưa đạt", async () => {
  await chatLogin(B.page, "vio.ngo");
  await B.page.goto(`http://localhost:3100/runs/${S.run}`);
  const r = region(B.page); await r.waitFor();
  await snap(B.page, "06-B-gate-run-page", true);
  const txt = await r.innerText();
  S.round = /Vòng (\d+)/.exec(txt)?.[1];
  if (!txt.includes("src/calc.ts") || !/Test đạt/.test(txt)) throw new Error("khối thiếu: " + txt.slice(0, 300));
  await B.page.getByRole("button", { name: "Đạt", exact: true }).waitFor();
  await B.page.getByRole("button", { name: "Chưa đạt", exact: true }).waitFor();
});
await step("B07", "[B] mục 'Chờ tôi kiểm' trong thanh bên có gate", async () => {
  await B.page.goto("http://localhost:3100/c/new");
  await B.page.getByText("Chờ tôi kiểm").first().waitFor();
  await snap(B.page, "07-B-inbox-cho-toi-kiem");
});
await step("B08", "quyền tải file: A,B,D 200; C (uat-outsider, ngoài phòng) 403/404; R (rowan, thành viên phòng) ghi nhận; admin+tenant_id 200; không token 401", async () => {
  const v = (await runView(S.run)).json; const af = v.stages[0].autofix;
  S.diffId = af.diff_file.id; S.logId = af.test_log_file.id;
  const res = {};
  for (const [who, tn, u] of [["A", "evolu", "thomas.tran"], ["B", "evolu", "vio.ngo"], ["D", "evolu", "julian.bui"], ["C", "evolu", "uat-outsider"],["R", "evolu", "rowan.nguyen"]]) {
    const t = await login(tn, u);
    res[who] = { diff: (await attGet(t, S.diffId)).status, log: (await attGet(t, S.logId)).status };
  }
  const pa = await login("platform", "admin");
  res.admin_with_tenant = (await attGet(pa, S.diffId, "?tenant_id=01a11c1d-ca4e-7000-b4eb-212defbb548f")).status;
  res.admin_no_tenant = (await attGet(pa, S.diffId)).status;
  res.no_token = (await fetch(`http://localhost:4000/attachments/${S.diffId}/content`)).status;
  writeFileSync(`${OUT}/api-download-perms.json`, JSON.stringify(res, null, 2));
  console.log("  ", JSON.stringify(res));
  if (res.A.diff !== 200 || res.B.diff !== 200 || res.B.log !== 200 || res.D.diff !== 200) throw new Error("người có quyền bị chặn");
  if (![403, 404].includes(res.C.diff) || res.no_token !== 401) throw new Error("rowan/anon: " + JSON.stringify(res.C));
});
await step("B09", "[C] uat-outsider (member evolu ngoài phòng) mở trang run của người khác => không thấy khối diff", async () => {
  const C = await launch(OUT); await chatLogin(C.page, "uat-outsider");
  await C.page.goto(`http://localhost:3100/runs/${S.run}`); await C.page.waitForTimeout(2500);
  await snap(C.page, "09-C-rowan-run-page");
  const has = await C.page.getByRole("region", { name: "Kết quả tự sửa mã" }).count();
  await C.browser.close();
  if (has) throw new Error("rowan thấy diff của run người khác");
});
await step("B10", "[B] 'Chưa đạt' + góp ý => làm lại cùng nhánh, vòng tăng; gate mới", async () => {
  const q = `select count(*) from hub.autofix_results where process_run_id='${S.run}'`;
  const before = sql(q);
  await B.page.goto(`http://localhost:3100/runs/${S.run}`);
  await B.page.getByRole("button", { name: "Chưa đạt", exact: true }).click();
  await snap(B.page, "10-B-chua-dat-form");
  await B.page.getByRole("textbox").last().fill(`Thêm test số âm. #fake:ws_write=test/calc.test.ts|${b64(TEST2)}`);
  await B.page.getByRole("button", { name: /Gửi|Xác nhận|Làm lại/ }).last().click().catch(() => {});
  for (let i = 0; i < 90 && sql(q) === before; i++) await B.page.waitForTimeout(1000);
  await waitRun(S.run, /waiting_review|needs_decision/, 120);
  await B.page.waitForTimeout(3000);
  await B.page.reload(); await region(B.page).waitFor();
  const txt = await region(B.page).innerText();
  const r2 = /Vòng (\d+)/.exec(txt)?.[1];
  const branches = sql(`select distinct branch from hub.autofix_results where process_run_id='${S.run}'`).split("\n");
  console.log("  vòng", S.round, "->", r2, "· nhánh:", branches.join(","));
  await snap(B.page, "10b-B-gate-round2", true);
  if (!(Number(r2) > Number(S.round))) throw new Error(`vòng không tăng ${S.round}->${r2}`);
  if (branches.length !== 1) throw new Error("nhiều nhánh: " + branches);
});
await step("B11", "[B] 'Đạt' => run hoàn thành", async () => {
  await B.page.getByRole("button", { name: "Đạt", exact: true }).click();
  const st = await waitRun(S.run, /done|completed|failed|cancel|needs_decision/, 90);
  await B.page.waitForTimeout(1500);
  await snap(B.page, "11-B-after-pass", true);
  if (!/done|completed/.test(st)) throw new Error("run " + st);
});
await step("B12", "[A] thomas thấy run xong trong phòng", async () => {
  await A.page.goto("http://localhost:3100/rooms/d2a00000-0000-4000-8000-000000000002"); await A.page.waitForTimeout(3000);
  await snap(A.page, "12-A-thread-done");
});
await step("B13", "[D] admin-web (julian.bui): trang lượt chạy hiển thị khối Tự sửa mã + diff", async () => {
  await adminLogin(D.page, "julian.bui", "evolu");
  await D.page.goto(`http://localhost:3000/processes/${S.defId}/runs/${S.run}`); await D.page.waitForTimeout(3000);
  await snap(D.page, "13-D-admin-run-page", true);
  const n = await D.page.getByRole("region", { name: "Kết quả tự sửa mã" }).count();
  if (!n) throw new Error("admin-web không có khối kết quả (URL có thể sai)");
});
writeFileSync(`${OUT}/run-b.json`, JSON.stringify(S, null, 2));
save("result-b-happy");
for (const x of [A, B, D]) await x.browser.close();
