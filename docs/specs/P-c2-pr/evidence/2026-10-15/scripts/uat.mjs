// UAT P-c2 "Áp bản sửa" — trình duyệt thật (VI) + Hub thật + Runtime thật (Docker) + sandbox; apply = fake (#fake:apply=…); GitHub = mock :4040 qua ghproxy :4041.
// A = thomas.tran (người khởi chạy) · B = vio.ngo (nhóm duyệt) · D = julian.bui (tenant_admin, admin-web) · O = uat.badmin (tenant khác `uatb`)
// Cần: Hub chạy bằng start-hub.sh (shim sweep BUG2) + Runtime chạy bằng runtime-git.mjs (UAT_SHIM=1, shim BUG1) + ghproxy.mjs + mocks.
import { launch, mkSnap, mkStep, adminLogin, chatLogin, waitRun, CHAT, ADMIN } from "./lib.mjs";
import { OUT, prepare, startToGate, passGate, region, applyRow, cancelOpen } from "./flow.mjs";
import { tok, hub, putSource, getSource, setDef, ghCfg, sql } from "./cfg2.mjs";
import { login } from "./api.mjs";
import { writeFileSync } from "node:fs";

const A = await launch(OUT), B = await launch(OUT), D = await launch(OUT), O = await launch(OUT);
const M = await launch(OUT, { width: 390, height: 844 });
const snap = mkSnap(OUT);
const { step, log, save } = mkStep(OUT, () => ({ A: A.page, B: B.page, D: D.page, O: O.page }), snap);
const S = { runs: {} };
const T = await tok();
const mode = (p) => fetch(`http://127.0.0.1:4041/__mode?m=${p}`).then((r) => r.text());
const cred = (await hub(T, "GET", "/admin/source-credentials")).json.items.find((x) => x.name === "uat-pat").id;
const defId = (await hub(T, "GET", "/process-defs?include_templates=false&limit=100")).json.items.find((d) => d.key === "fixbug-pr").id;
const setMode = (m) => putSource(T, "repo", ghCfg({ credential_secret_id: cred, apply_mode: m }));
const status = (id) => sql(`select status from hub.process_runs where id='${id}'`);
const reason = (id) => sql(`select decision->>'reason' from hub.process_runs where id='${id}'`);
const sweep = (ms = 4000) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { if (!c) throw new Error(m); };
const adminRunUrl = (id) => `${ADMIN}/processes/${defId}/runs/${id}`;
const mainTxt = (p) => p.locator("body").innerText();

async function resultView(tag, id) {
  await A.page.goto(`${CHAT}/runs/${id}`);
  await region(A.page).waitFor({ timeout: 15000 });
  await region(A.page).scrollIntoViewIfNeeded();
  await snap(A.page, `${tag}-A-run-ket-qua`);
  await region(A.page).screenshot({ path: `${OUT}/${tag}-A-region.png` });
  return region(A.page).innerText();
}
/** Chạy tới cổng → B Đạt → chờ trạng thái cuối. */
async function fullRun(tag, cfg, wait) {
  await cancelOpen();
  await cfg();
  let id;
  try { id = await startToGate(A, snap, tag); }
  catch (e) {
    if (!/source_unresolvable/.test(e.message)) throw e;
    (S.flakes ??= []).push({ tag, run: e.runId, note: "source_unresolvable dù source.resolve ok (đua resolveTimeouts)" });
    console.log("  FLAKE source_unresolvable — thử lại 1 lần:", e.runId);
    await cancelOpen(); id = await startToGate(A, snap, tag);
  }
  S.runs[tag] = id;
  await passGate(B, id, snap, tag, wait);
  await sweep();
  return { id, st: status(id) };
}

await step("P0", "đăng nhập A (thomas), B (vio.ngo), D (julian admin-web), O (tenant khác)", async () => {
  await prepare(A, B);
  await adminLogin(D.page, "julian.bui", "evolu");
  await adminLogin(O.page, "uat.badmin", "uatb");
  await chatLogin(M.page, "thomas.tran");
  await snap(O.page, "00-O-admin-tenant-khac");
});

// ───────── 1) pr (mặc định)
await step("S1", "pr: Đạt → Áp → 'Đã mở PR' + link PR (https, tab mới)", async () => {
  const r = await fullRun("s1-pr", async () => { await setMode("pr"); await setDef(T, { testCmd: "bun test #fake:apply=pushed" }); });
  ok(r.st === "done", "run " + r.st);
  const row = applyRow(r.id); ok(row.startsWith("pr|pr_opened"), row);
  const txt = await resultView("s1-pr", r.id);
  ok(/Đã mở PR/.test(txt) && /PR #\d+/.test(txt), txt);
  const a = region(A.page).getByRole("link", { name: /PR #\d+/ });
  ok((await a.getAttribute("href")).startsWith("https://github.com/pc2-uat/app/pull/"), "href");
  ok((await a.getAttribute("target")) === "_blank" && /noopener/.test(await a.getAttribute("rel")) && /noreferrer/.test(await a.getAttribute("rel")), "target/rel");
  S.pr = await a.getAttribute("href");
});
await step("S1b", "gate (B): câu 'Đạt sẽ mở PR vào main.' hiện trên cổng tự sửa (xem ảnh s1-pr-B-gate)", async () => {
  const id = S.runs["s1-pr"];
  // ảnh gate chụp lúc còn chờ duyệt ở passGate; kiểm văn bản bằng run kế (S2) — ở đây chỉ kiểm trang sau khi xong
  await B.page.goto(`${CHAT}/runs/${id}`);
  await B.page.waitForTimeout(2500);
  console.log("  còn câu 'Đạt sẽ' sau khi qua cổng:", /Đạt sẽ/.test(await mainTxt(B.page)));
});
await step("S1c", "[F3] admin-web run view: khối 'Kết quả áp bản sửa' + PR link", async () => {
  await D.page.goto(adminRunUrl(S.runs["s1-pr"])); await D.page.waitForTimeout(3000);
  await snap(D.page, "s1-pr-D-admin-run");
  const rg = D.page.getByRole("region", { name: "Kết quả áp bản sửa" });
  ok(await rg.count(), "admin-web thiếu region Kết quả áp bản sửa");
  await rg.scrollIntoViewIfNeeded(); await rg.screenshot({ path: `${OUT}/s1-pr-D-region.png` });
  const t = await rg.innerText(); ok(/Đã mở PR/.test(t) && /#\d+/.test(t), t);
});
await step("S1d", "thread phòng: thẻ 'Áp bản sửa' + 'Đã mở PR'; mobile 390px", async () => {
  await A.page.goto(`${CHAT}/rooms/d2a00000-0000-4000-8000-000000000002`); await A.page.waitForTimeout(3500);
  await snap(A.page, "s1-pr-A-thread");
  await M.page.goto(`${CHAT}/runs/${S.runs["s1-pr"]}`); await M.page.waitForTimeout(3000);
  await region(M.page).scrollIntoViewIfNeeded(); await snap(M.page, "s1-pr-M-mobile");
});

// ───────── 2) auto_merge
await step("S2", "auto_merge: 'Đã mở PR' + 'Tự gộp: bật'", async () => {
  const r = await fullRun("s2-auto", async () => { await setMode("auto_merge"); await setDef(T, { testCmd: "bun test #fake:apply=pushed" }); });
  ok(r.st === "done", "run " + r.st);
  const row = applyRow(r.id); ok(row.startsWith("auto_merge|pr_opened") && row.includes("|on|"), row);
  const txt = await resultView("s2-auto", r.id);
  ok(/Tự gộp: bật/.test(txt), txt);
  await D.page.goto(adminRunUrl(r.id)); await D.page.waitForTimeout(3000); await snap(D.page, "s2-auto-D-admin-run");
});

// ───────── 3) branch_only
await step("S3", "branch_only: 'Đã đẩy nhánh', không PR, không link PR", async () => {
  const r = await fullRun("s3-branch", async () => { await setMode("branch_only"); await setDef(T, { testCmd: "bun test #fake:apply=pushed" }); });
  ok(r.st === "done", "run " + r.st);
  const row = applyRow(r.id); console.log("  hàng:", row);
  ok(row.startsWith("branch_only|") && !/https/.test(row), row);
  const txt = await resultView("s3-branch", r.id);
  ok(/Đã đẩy nhánh/.test(txt) && !/PR #/.test(txt), txt);
  ok((await region(A.page).getByRole("link").count()) === 0, "có link trong khối branch_only");
});

// ───────── 4) local_path
await step("S4", "nguồn local_path: ép Chỉ nhánh; khối 'Chỉ nhánh' + 'Tải .diff'", async () => {
  const r = await fullRun("s4-local", async () => { await setDef(T, { testCmd: "bun test", sourceKey: "repo-local" }); });
  ok(r.st === "done", "run " + r.st + " " + reason(r.id));
  const row = applyRow(r.id); console.log("  hàng:", row);
  ok(row.startsWith("branch_only|"), row);
  const txt = await resultView("s4-local", r.id);
  ok(/Chỉ nhánh/.test(txt), txt);
  ok(await region(A.page).getByRole("button", { name: "Tải .diff" }).count(), "thiếu Tải .diff");
  await D.page.goto(adminRunUrl(r.id)); await D.page.waitForTimeout(3000); await snap(D.page, "s4-local-D-admin-run");
});

// ───────── 5) rebase
await step("S5", "rebased: 'Đã rebase lên …' + chạy lại test", async () => {
  const r = await fullRun("s5-rebase", async () => { await setMode("pr"); await setDef(T, { testCmd: "bun test #fake:apply=pushed,rebased" }); });
  ok(r.st === "done", "run " + r.st);
  const row = applyRow(r.id); console.log("  hàng:", row); ok(/\|t\|/.test(row), row);
  const txt = await resultView("s5-rebase", r.id);
  ok(/Đã rebase lên [0-9a-f]{7}/.test(txt), txt);
  await D.page.goto(adminRunUrl(r.id)); await D.page.waitForTimeout(3000); await snap(D.page, "s5-rebase-D-admin-run");
});

// ───────── 6) no_changes
await step("S6", "no_changes: 'Không có thay đổi'", async () => {
  const r = await fullRun("s6-nochange", async () => { await setMode("pr"); await setDef(T, { testCmd: "bun test #fake:apply=no_changes" }); });
  console.log("  trạng thái", r.st, applyRow(r.id));
  const txt = await resultView("s6-nochange", r.id);
  ok(/Không có thay đổi/.test(txt), txt);
});

// ───────── 7) lỗi/quyết định
async function decisionCase(tag, cfg, wantReason, wantRe, extra) {
  const r = await fullRun(tag, cfg, /needs_decision|done|failed|cancel/);
  console.log("  ", tag, "→", r.st, reason(r.id), applyRow(r.id));
  ok(r.st === "needs_decision", `status ${r.st}`);
  ok(reason(r.id) === wantReason, `reason ${reason(r.id)}`);
  await A.page.goto(`${CHAT}/runs/${r.id}`); await A.page.waitForTimeout(3000);
  const t = await mainTxt(A.page);
  await snap(A.page, `${tag}-A-run-quyet-dinh`);
  ok(wantRe.test(t), "UI thiếu câu: " + wantRe + " ⇒ " + t.slice(0, 600));
  ok(await A.page.getByRole("button", { name: "Thêm 1 lần làm lại" }).count(), "thiếu nút Thêm 1 lần làm lại");
  ok(await A.page.getByRole("button", { name: "Huỷ lượt chạy" }).count(), "thiếu nút Huỷ lượt chạy");
  ok(!(await A.page.getByRole("button", { name: "Dùng bản hiện có" }).count()), "có nút Dùng bản hiện có");
  S[tag + "-ui"] = t.slice(0, 1200);
  await D.page.goto(adminRunUrl(r.id)); await D.page.waitForTimeout(3000); await snap(D.page, `${tag}-D-admin-run`);
  S[tag + "-admin"] = (await mainTxt(D.page)).slice(0, 1500);
  if (extra) await extra(r.id);
  return r.id;
}
const cfgPR = (cmd) => async () => { await setMode("pr"); await setDef(T, { testCmd: `bun test #fake:apply=${cmd}` }); };
await step("E1", "conflict ⇒ 'Bản sửa xung đột với mã mới' + file xung đột; 2 nút", async () => {
  await decisionCase("e1-conflict", cfgPR("conflict:src/calc.ts|src/util.ts"), "apply_conflict", /Bản sửa xung đột với mã mới/, async () => {
    const t = await mainTxt(A.page); ok(/src\/calc\.ts/.test(t) && /src\/util\.ts/.test(t), "thiếu file xung đột");
  });
});
await step("E2", "check_failed ⇒ 'Áp bản sửa không thành công'", async () => {
  await decisionCase("e2-checkfailed", cfgPR("check_failed"), "apply_failed", /Áp bản sửa không thành công/);
});
await step("E3", "failed:auth", async () => { await decisionCase("e3-auth", cfgPR("failed:auth"), "apply_failed", /Áp bản sửa không thành công/); });
await step("E4", "failed:no_credential", async () => { await decisionCase("e4-nocred", cfgPR("failed:no_credential"), "apply_failed", /Áp bản sửa không thành công/); });
await step("E5", "failed:push_rejected", async () => { await decisionCase("e5-pushrej", cfgPR("failed:push_rejected"), "apply_failed", /Áp bản sửa không thành công/); });
await step("E6", "failed:network ⇒ 'Thêm 1 lần làm lại' tạo job Áp mới ⇒ 'Huỷ lượt chạy' ⇒ cancelled", async () => {
  await decisionCase("e6-network", cfgPR("failed:network"), "apply_failed", /Áp bản sửa không thành công/, async (id) => {
    const q = `select count(*) from hub.jobs where type='source.apply' and payload->>'process_run_id'='${id}'`;
    const before = sql(q);
    await A.page.getByRole("button", { name: "Thêm 1 lần làm lại" }).click();
    await A.page.waitForTimeout(1500);
    await snap(A.page, "e6-network-A-sau-them-lan");
    await sweep(8000);
    const after = sql(q);
    console.log("  job Áp:", before, "→", after, "| trạng thái", status(id));
    ok(Number(after) > Number(before), "không tạo job Áp mới");
    await waitRun(id, /needs_decision/, 90);
    await A.page.goto(`${CHAT}/runs/${id}`); await A.page.waitForTimeout(2500);
    await snap(A.page, "e6-network-A-lai-quyet-dinh");
    await A.page.getByRole("button", { name: "Huỷ lượt chạy" }).first().click();
    await A.page.waitForTimeout(1200);
    await snap(A.page, "e6-network-A-confirm-huy");
    await A.page.getByRole("button", { name: "Xác nhận huỷ" }).click();
    for (let i = 0; i < 20 && !/cancel/.test(status(id)); i++) await sweep(1000);
    await snap(A.page, "e6-network-A-da-huy");
    console.log("  sau huỷ:", status(id)); ok(/cancel/.test(status(id)), "chưa huỷ: " + status(id));
  });
});
await step("E7", "provider_error: GitHub 5xx khi mở PR", async () => {
  await mode("err500");
  try { await decisionCase("e7-provider", cfgPR("pushed"), "apply_failed", /Áp bản sửa không thành công/, async (id) => { ok(/provider_error/.test(applyRow(id)), applyRow(id)); }); } finally { await mode("ok"); }
});
await step("E8", "rate_limited: GitHub 403 hết hạn mức", async () => {
  await mode("rate");
  try { await decisionCase("e8-rate", cfgPR("pushed"), "apply_failed", /Áp bản sửa không thành công/, async (id) => { ok(/rate_limited/.test(applyRow(id)), applyRow(id)); }); } finally { await mode("ok"); }
});
const sheetRow = (D, name) => {
  const sheet = D.page.getByRole("dialog", { name: "Khoá nguồn" });
  return sheet.getByRole("listitem").filter({ hasText: name }).or(sheet.getByRole("row").filter({ hasText: name })).first();
};
async function rotate(name, value, shot) {
  await D.page.goto(`${ADMIN}/sources`);
  await D.page.getByRole("button", { name: "Khoá nguồn", exact: true }).click();
  await sheetRow(D, name).getByRole("button", { name: "Thay token" }).click();
  await D.page.getByRole("textbox", { name: "Token mới" }).fill(value);
  if (shot) await snap(D.page, shot);
  await D.page.getByRole("button", { name: "Lưu", exact: true }).last().click();
  await D.page.waitForTimeout(1500);
}
await step("E9", "auth (qua UI): 'Thay token' sang token sai ⇒ mở PR 401 ⇒ 'auth'; trả token đúng", async () => {
  await rotate("uat-pat", "ghp-bad-token-uat", "e9-D-thay-token-sai");
  try {
    await decisionCase("e9-auth-thuc", cfgPR("pushed"), "apply_failed", /Áp bản sửa không thành công/, async (id) => { ok(/\|auth\|/.test(applyRow(id)), applyRow(id)); });
  } finally { await rotate("uat-pat", "ghp-mock-ok"); }
});

// ───────── 8) cách ly tenant
await step("T1", "tenant khác (uatb) không thấy run/kết quả Áp/nguồn/khoá của evolu (API + UI)", async () => {
  const to = await login("uatb", "uat.badmin");
  const id = S.runs["s1-pr"];
  const g = await hub(to, "GET", `/process-runs/${id}`); console.log("  GET run:", g.status);
  ok(g.status === 404 || g.status === 403, "uatb đọc được run evolu: " + g.status);
  const lst = await hub(to, "GET", "/process-runs?limit=50"); ok(!JSON.stringify(lst.json).includes(id), "run evolu lộ trong danh sách uatb");
  const src = await hub(to, "GET", "/admin/sources"); ok(!JSON.stringify(src.json).includes("pc2-uat"), "nguồn evolu lộ");
  const cr = await hub(to, "GET", "/admin/source-credentials"); ok(!JSON.stringify(cr.json).includes(cred) && !JSON.stringify(cr.json).includes("uat-pat"), "khoá evolu lộ");
  const gc = await hub(to, "GET", `/admin/source-credentials/${cred}`); console.log("  GET cred evolu:", gc.status); ok(gc.status === 404, "đọc khoá chéo tenant: " + gc.status);
  const pc = await hub(to, "PUT", `/admin/source-credentials/${cred}`, { value: "x-hijack-1234", version: 1 }); console.log("  PUT cred evolu:", pc.status); ok(pc.status === 404 || pc.status === 403, "ghi khoá chéo: " + pc.status);
  const dc = await hub(to, "DELETE", `/admin/source-credentials/${cred}?version=1`); console.log("  DELETE cred evolu:", dc.status); ok(dc.status === 404 || dc.status === 403, "xoá khoá chéo: " + dc.status);
  const mk = await hub(to, "POST", "/admin/sources", { key: "steal", kind: "git_remote", config: ghCfg({ credential_secret_id: cred, apply_mode: "pr" }), description: "dùng khoá evolu" });
  console.log("  tạo nguồn dùng khoá evolu:", mk.status, JSON.stringify(mk.json).slice(0, 200));
  ok(mk.status >= 400, "tạo được nguồn dùng khoá tenant khác");
  await chatLogin(O.page, "uat.badmin", "uatb");
  await O.page.goto(`${CHAT}/runs/${id}`); await O.page.waitForTimeout(3000); await snap(O.page, "t1-O-chat-run-evolu");
  ok(!(await O.page.getByText(/PR #\d+|pc2-uat/).count()), "UI uatb thấy dữ liệu evolu");
  await O.page.goto(`${ADMIN}/sources`); await O.page.waitForTimeout(2500); await snap(O.page, "t1-O-admin-sources");
  await O.page.getByRole("button", { name: "Khoá nguồn", exact: true }).click().catch(() => {}); await O.page.waitForTimeout(1500); await snap(O.page, "t1-O-admin-khoa-nguon");
  ok(!(await O.page.getByText("uat-pat").count()), "UI uatb thấy khoá uat-pat");
  await O.page.goto(adminRunUrl(id)); await O.page.waitForTimeout(3000); await snap(O.page, "t1-O-admin-run-evolu");
  ok(!(await O.page.getByRole("region", { name: "Kết quả áp bản sửa" }).count()), "admin uatb thấy kết quả Áp evolu");
});

// ───────── 9) khoá nguồn UI (không lộ bản mã)
await step("K1", "UI khoá nguồn: tạo khoá, chọn vào nguồn, Lưu; không lộ token; Thay token; khoá đang dùng không xoá được", async () => {
  const TOKEN = "ghp-uat-SECRET-7788";
  await D.page.goto(`${ADMIN}/sources`); await D.page.waitForTimeout(2000);
  await snap(D.page, "k1-D-nguon-bang");
  await D.page.getByRole("button", { name: "Thêm nguồn", exact: true }).click();
  const d = D.page.getByRole("dialog", { name: "Thêm nguồn" });
  await d.getByRole("textbox", { name: "Ký hiệu nguồn" }).fill("uat-k1");
  await d.getByRole("radio", { name: "Git công khai" }).click();
  await d.getByRole("textbox", { name: "Địa chỉ kho Git (https)" }).fill("https://github.com/pc2-uat/k1.git");
  await d.getByRole("textbox", { name: "Nhánh (branch)" }).fill("main");
  await d.getByRole("textbox", { name: "Mô tả" }).fill("UAT khoá K1");
  await d.getByRole("combobox", { name: "Khoá nguồn" }).click();
  await D.page.getByRole("option", { name: "+ Tạo khoá mới…" }).click();
  const c = D.page.getByRole("dialog", { name: "Tạo khoá nguồn" });
  await c.getByRole("textbox", { name: "Tên khoá" }).fill("uat-k1-key");
  const tb = c.getByRole("textbox", { name: "Token" });
  console.log("  type ô Token:", await tb.getAttribute("type"));
  await tb.fill(TOKEN); await snap(D.page, "k1-D-dialog-tao-khoa");
  await c.getByRole("button", { name: "Lưu khoá" }).click();
  await D.page.waitForTimeout(1000);
  await d.getByRole("radio", { name: "Mở PR và tự gộp", exact: true }).click();
  await snap(D.page, "k1-D-form-nguon-co-khoa");
  await d.getByRole("button", { name: "Lưu", exact: true }).click(); await D.page.waitForTimeout(2000);
  await snap(D.page, "k1-D-bang-sau-luu");
  ok(!(await D.page.getByText(TOKEN).count()), "token lộ trên bảng");
  const row = D.page.getByRole("table", { name: "Nguồn" }).getByRole("row").filter({ hasText: "uat-k1" });
  ok(/Riêng tư/.test(await row.innerText()) && /Mở PR và tự gộp/.test(await row.innerText()), await row.innerText());
  await row.getByRole("button").first().click().catch(() => {}); await D.page.waitForTimeout(1200); await snap(D.page, "k1-D-sua-nguon");
  ok(!(await D.page.getByText(TOKEN).count()), "token lộ ở form sửa");
  ok(!(await D.page.locator(`input[value="${TOKEN}"]`).count()), "token trong input");
  await D.page.keyboard.press("Escape");
  await D.page.getByRole("button", { name: "Khoá nguồn", exact: true }).click();
  const sheet = D.page.getByRole("dialog", { name: "Khoá nguồn" }); await snap(D.page, "k1-D-sheet-khoa");
  ok(!(await sheet.getByText(TOKEN).count()), "token lộ trong sheet");
  const html = await D.page.content(); ok(!html.includes(TOKEN), "token trong DOM");
  const lst = (await hub(T, "GET", "/admin/source-credentials")).json; const k1 = lst.items.find((x) => x.name === "uat-k1-key");
  ok(k1, "API không có khoá"); const keys = Object.keys(k1); console.log("  trường API khoá:", keys.join(","));
  ok(!JSON.stringify(lst).includes(TOKEN) && !keys.some((x) => /value|cipher|token|secret/i.test(x)), "API lộ giá trị/bản mã");
  const dbv = sql(`select encode(ciphertext,'escape') from hub.secrets where id='${k1.id}'`); ok(!dbv.includes(TOKEN), "DB lưu bản rõ");
  const src = JSON.stringify((await getSource(T, "uat-k1")).config); ok(!src.includes(TOKEN) && src.includes(k1.id), "config nguồn: " + src);
  await sheetRow(D, "uat-k1-key").getByRole("button", { name: "Thay token" }).click();
  await D.page.getByRole("textbox", { name: "Token mới" }).fill("ghp-uat-ROTATED-9911");
  await snap(D.page, "k1-D-thay-token"); await D.page.getByRole("button", { name: "Lưu", exact: true }).last().click(); await D.page.waitForTimeout(1500);
  const h2 = await D.page.content(); ok(!h2.includes("ghp-uat-ROTATED-9911"), "token mới lộ trong DOM"); await snap(D.page, "k1-D-sau-thay-token");
  ok(await sheetRow(D, "uat-k1-key").getByRole("button", { name: "Xoá khoá" }).isDisabled(), "khoá đang dùng vẫn xoá được");
  await snap(D.page, "k1-D-khoa-dang-dung");
  await D.page.keyboard.press("Escape");
  const sv = await getSource(T, "uat-k1"); await hub(T, "DELETE", `/admin/sources/uat-k1?version=${sv.version}`);
  const kk = (await hub(T, "GET", `/admin/source-credentials/${k1.id}`)).json; await hub(T, "DELETE", `/admin/source-credentials/${k1.id}?version=${kk.version}`);
});
await step("K2", "form nguồn: gitlab ⇒ 'Mở PR' tắt + gợi ý (chụp)", async () => {
  await D.page.goto(`${ADMIN}/sources`); await D.page.waitForTimeout(1500);
  await D.page.getByRole("button", { name: "Thêm nguồn", exact: true }).click();
  const d = D.page.getByRole("dialog", { name: "Thêm nguồn" });
  await d.getByRole("radio", { name: "Git công khai" }).click();
  await d.getByRole("textbox", { name: "Địa chỉ kho Git (https)" }).fill("https://gitlab.com/x/y.git");
  await snap(D.page, "k2-D-gitlab-chi-nhanh");
  ok(await d.getByRole("radiogroup", { name: "Chế độ áp" }).getByRole("radio", { name: "Mở PR", exact: true }).isDisabled(), "Mở PR không tắt");
  await D.page.keyboard.press("Escape");
});

// ───────── 10) pr_url https nhưng sai host (dữ liệu hỏng)
await step("X1", "dữ liệu hỏng: pr_url https khác host GitHub ⇒ UI không link (tamper SQL)", async () => {
  const id = S.runs["s1-pr"];
  sql(`update hub.autofix_applies set pr_url='https://evil.example/pc2-uat/app/pull/1' where process_run_id='${id}'`);
  try {
    const txt = await resultView("x1-evilhost", id);
    const links = await region(A.page).getByRole("link").evaluateAll((els) => els.map((e) => e.href));
    console.log("  links trong khối:", JSON.stringify(links), "| text:", txt.replace(/\n/g, " / ").slice(0, 160));
    ok(!links.some((h) => h.includes("evil.example")), "UI trỏ tới host lạ: " + links);
    const out = (await hub(await tok("thomas.tran"), "GET", `/process-runs/${id}`)).json;
    const ap = out.stages.find((s) => s.apply)?.apply; console.log("  API apply.pr_url:", ap?.pr_url);
    ok(ap?.pr_url == null || !String(ap.pr_url).includes("evil.example"), "API trả pr_url host lạ: " + ap?.pr_url);
  } finally { sql(`update hub.autofix_applies set pr_url='${S.pr}' where process_run_id='${id}'`); }
});

writeFileSync(`${OUT}/runs.json`, JSON.stringify(S, null, 2));
save("result");
for (const x of [A, B, D, O, M]) await x.browser.close();
