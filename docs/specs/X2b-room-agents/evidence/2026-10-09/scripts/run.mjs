// UAT X2b (manual-test-I2) 2026-10-09 — agent THẬT (claude-sub + Dify). Chạy: node run.mjs <outDir>
// A = julian.bui (consultant, dify-chatbot, invoices) · B = thomas.tran (đã thu hồi invoices qua UI Admin) · C = vio.ngo (như A)
import { chromium, expect, CHAT, PW, makeRunner, login } from "./lib.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const OUT = process.argv[2];
const R = makeRunner(OUT, process.env.ONLY ? "rerun" : "run");
const stamp = Date.now().toString(36).slice(-4);
const NAME = { A: "Julian Bui", B: "Thomas Tran", C: "Vio Ngo" };
let calls = 0;
const callLog = [];
const b = await chromium.launch();
const mk = async () => { const c = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" }); await c.addInitScript(() => { try { localStorage.setItem("ai.locale", "vi"); } catch {} }); return c; };
const [A, B, C] = await Promise.all([mk(), mk(), mk()].map(async (c) => (await c).newPage()));
R.pages.push(A, B, C);
const snap = R.snap;
const notes = {};
const roomLog = (p) => p.getByRole("log", { name: "Tin nhắn của phòng" });
const box = (p) => p.getByRole("textbox", { name: "Tin nhắn cho nhóm" });
const menu = (p) => p.getByRole("listbox", { name: "Agent" });
const blocks = (p) => roomLog(p).getByRole("article", { name: /Trả lời của agent/ });
const working = (p) => p.getByRole("status").filter({ hasText: /đang xử lý…/ });
const flowPane = (p) => p.getByRole("complementary", { name: "Flow đang mở" });
const flowBox = (p) => p.getByRole("textbox", { name: "Tin nhắn trong flow" });
const roomLink = (p, n) => p.getByRole("region", { name: "Tin nhắn & Nhóm" }).getByRole("link", { name: n, exact: true });
const denied = (p, k) => p.getByRole("alert").filter({ hasText: `Không tìm thấy agent @${k}.` });

async function send(p, text, inFlow = false, real = true) {
  if (real) { calls++; callLog.push(text); }
  const tb = inFlow ? flowBox(p) : box(p);
  await tb.fill(text);
  const resp = p.waitForResponse((r) => r.request().method() === "POST" && /\/rooms\/[^/]+\/messages$/.test(new URL(r.url()).pathname));
  await p.getByRole("button", { name: inFlow ? "Gửi trong flow" : "Gửi", exact: true }).click();
  const r = await resp;
  return { runId: r.headers()["x-run-id"] ?? null, status: r.status() };
}
const idle = async (...ps) => { for (const p of ps) await expect(working(p)).toHaveCount(0, { timeout: 240_000 }); };
async function mkRoom(label) {
  const name = `UAT X2b ${label} ${stamp}`;
  await A.goto(`${CHAT}/c/new`);
  await A.getByRole("button", { name: "Nhóm mới" }).click();
  const dlg = A.getByRole("dialog", { name: "Tạo nhóm" });
  await dlg.getByRole("textbox", { name: "Tên nhóm" }).fill(name);
  for (const [q, n] of [["Thomas", NAME.B], ["Vio", NAME.C]]) {
    await dlg.getByRole("searchbox", { name: "Tìm người trong công ty" }).fill(q);
    await dlg.getByRole("checkbox", { name: n }).check();
  }
  await dlg.getByRole("button", { name: "Tạo nhóm" }).click();
  await expect(A.getByRole("heading", { level: 1, name })).toBeVisible();
  await A.waitForURL(/\/rooms\/[0-9a-f-]{36}/);
  const id = /\/rooms\/([0-9a-f-]{36})/.exec(A.url())[1];
  for (const p of [B, C]) await p.goto(`${CHAT}/rooms/${id}`);
  for (const p of [A, B, C]) await expect(box(p)).toBeVisible();
  return { id, name };
}
const goRoom = async (r, ...ps) => {
  for (const p of ps) await p.goto(`${CHAT}/rooms/${r.id}`);
  for (const p of ps) await expect(box(p)).toBeVisible();
};
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const step = (id, t, f) => (!ONLY || id === "00" || ONLY.includes(id) ? R.step(id, t, f) : null);

await step("00", "Đăng nhập A/B/C (evolu)", async () => {
  const nl = (u) => !u.pathname.startsWith("/login");
  await login(A, CHAT, "evolu", "julian.bui", PW, nl);
  await login(B, CHAT, "evolu", "thomas.tran", PW, nl);
  await login(C, CHAT, "evolu", "vio.ngo", PW, nl);
  for (const p of [A, B, C]) await p.reload();
});
await step("01", "A mở Evolu team, gõ @ => consultant, dify-chatbot, invoices; không panel/chip", async () => {
  await roomLink(A, "Evolu team").click();
  await box(A).fill("@");
  await expect(menu(A)).toBeVisible();
  notes.menuA = (await menu(A).innerText()).replace(/\n/g, " ¦ ");
  await expect(menu(A).getByRole("option")).toHaveCount(3);
  for (const k of ["@consultant", "@dify-chatbot", "@invoices"]) await expect(menu(A).getByRole("option").filter({ hasText: k })).toHaveCount(1);
  await expect(A.getByRole("complementary")).toHaveCount(0);
  await snap(A, "01-A-menu-at");
  await box(A).fill("");
});
await step("02", "B gõ @ => không có invoices; @orchestrator không nằm trong menu", async () => {
  await roomLink(B, "Evolu team").click();
  await box(B).fill("@");
  await expect(menu(B)).toBeVisible();
  notes.menuB = (await menu(B).innerText()).replace(/\n/g, " ¦ ");
  await expect(menu(B).getByRole("option").filter({ hasText: "@invoices" })).toHaveCount(0);
  await expect(menu(B).getByRole("option")).toHaveCount(2);
  await expect(menu(B).getByRole("option").filter({ hasText: "@orchestrator" })).toHaveCount(0);
  await snap(B, "02-B-menu-at");
  await box(B).fill("");
});
let room;
try { room = ONLY ? null : await mkRoom("chính"); } catch (e) { console.log("mkRoom lỗi", e.message); await snap(A, "mkroom-FAIL"); throw e; }

await step("03", "A @invoices => B/C thấy 'đang xử lý…', B không có Dừng; xong: khối 'Julian Bui hỏi' cho cả 3", async () => {
  await goRoom(room, A, B, C);
  const s = await send(A, "@invoices chỉ trả lời đúng một từ: ok. Không tra cứu gì.");
  expect(s.runId).toBeTruthy();
  await expect(A.getByRole("button", { name: "Dừng" })).toBeVisible();
  for (const p of [B, C]) await expect(working(p)).toBeVisible({ timeout: 30_000 });
  await expect(B.getByRole("button", { name: "Dừng" })).toHaveCount(0);
  await expect(B.getByText(`Chỉ ${NAME.A} dừng được`)).toBeVisible();
  await snap(A, "03-A-working");
  await snap(B, "03-B-working");
  await idle(A, B, C);
  for (const p of [A, B, C]) await expect(blocks(p)).toHaveCount(1);
  await expect(blocks(A).last()).toContainText("Bạn hỏi");
  await expect(blocks(B).last()).toContainText(`${NAME.A} hỏi`);
  await expect(blocks(B).last()).toContainText(`Chạy bằng quyền của ${NAME.A}`);
  notes.s03 = (await blocks(B).last().innerText()).replace(/\n/g, " ¦ ").slice(0, 300);
  await snap(B, "03-B-result");
  await snap(C, "03-C-result");
});
await step("04", "A bấm Dừng khi chạy => 'Đã huỷ' cho mọi người", async () => {
  await send(A, "@consultant đếm từ 1 đến 80, mỗi số một dòng, giải thích từng số.");
  await expect(A.getByRole("button", { name: "Dừng" })).toBeVisible({ timeout: 30_000 });
  await expect(working(B).last()).toBeVisible({ timeout: 30_000 });
  await A.getByRole("button", { name: "Dừng" }).click();
  for (const p of [A, B, C]) await expect(roomLog(p).getByText("Đã huỷ").last()).toBeVisible({ timeout: 20_000 });
  await snap(A, "04-A-cancelled");
  await snap(B, "04-B-cancelled");
});
await step("05", "B @invoices (không quyền) => alert 'Không tìm thấy agent @invoices.', ô giữ chữ, không run", async () => {
  const text = "@invoices kiểm tra chui";
  const s = await send(B, text, false, false);
  expect(s.runId).toBeNull();
  await expect(denied(B, "invoices")).toBeVisible();
  await expect(box(B)).toHaveValue(text);
  await expect(roomLog(A).getByRole("article").filter({ hasText: text })).toHaveCount(0);
  await snap(B, "05-B-denied");
  await box(B).fill("");
});
await step("06", "C @invoices => 'Chạy bằng quyền của Vio Ngo'", async () => {
  const n0 = await blocks(A).count();
  await send(C, "@invoices chỉ trả lời đúng một từ: ok. Không tra cứu gì.");
  await idle(A, B, C);
  await expect(blocks(A)).toHaveCount(n0 + 1);
  await expect(blocks(A).last()).toContainText(`Chạy bằng quyền của ${NAME.C}`);
  await expect(blocks(A).last()).toContainText(`${NAME.C} hỏi`);
  await snap(A, "06-A-vio-run");
});
await step("07", "A và C gọi gần nhau => 2 khối song song, không lẫn", async () => {
  const n0 = await blocks(B).count();
  await send(A, "@consultant trả lời đúng một từ: ALPHA");
  await send(C, "@invoices trả lời đúng một từ: BETA. Không tra cứu gì.");
  await expect(working(B)).toHaveCount(2, { timeout: 30_000 });
  await snap(B, "07-B-two-working");
  await idle(A, B, C);
  await expect(blocks(B)).toHaveCount(n0 + 2);
  const t = await blocks(B).allInnerTexts();
  const ja = t.find((x) => /ALPHA/i.test(x) && x.includes(`${NAME.A} hỏi`));
  const vi = t.find((x) => /BETA/i.test(x) && x.includes(`${NAME.C} hỏi`));
  expect(ja, "khối của A có ALPHA").toBeTruthy();
  expect(vi, "khối của C có BETA").toBeTruthy();
  notes.s07 = { ja: ja.replace(/\n/g, " ¦ ").slice(0, 200), vi: vi.replace(/\n/g, " ¦ ").slice(0, 200) };
  await snap(B, "07-B-two-results");
});
const openThread = async (p) => {
  await blocks(p).first().getByRole("button", { name: "Trả lời tiếp" }).click();
  await expect(flowPane(p)).toBeVisible();
};
await step("08", "A mở thread => B, C cũng có composer; B nhắn thường: không run", async () => {
  await goRoom(room, A, B, C);
  await openThread(A); await openThread(B); await openThread(C);
  for (const p of [A, B, C]) await expect(flowBox(p)).toBeVisible();
  await snap(A, "08-A-thread");
  await flowBox(B).fill("Mình xem rồi, ok nhé");
  await B.getByRole("button", { name: "Gửi trong flow" }).click();
  for (const p of [A, B, C]) await expect(flowPane(p).getByText("Mình xem rồi, ok nhé")).toBeVisible();
  await expect(working(A)).toHaveCount(0);
  await snap(C, "08-C-sees-B-message");
});
await step("09", "Trong thread B @consultant => run của B, A xem được; B @invoices => từ chối giữ chữ", async () => {
  const s = await send(B, "@consultant trả lời đúng một từ: GAMMA", true);
  expect(s.runId).toBeTruthy();
  await expect(working(A)).toBeVisible({ timeout: 30_000 });
  await idle(A, B);
  const blk = flowPane(A).getByRole("article", { name: /Trả lời của agent/ }).last();
  await expect(blk).toContainText(`Chạy bằng quyền của ${NAME.B}`);
  await expect(blk).toContainText(/GAMMA/i);
  await snap(A, "09-A-sees-B-run");
  const t = "@invoices kiểm tra giúp";
  await flowBox(B).fill(t);
  await B.getByRole("button", { name: "Gửi trong flow" }).click();
  await expect(denied(B, "invoices")).toBeVisible();
  await expect(flowBox(B)).toHaveValue(t);
  await snap(B, "09-B-thread-denied");
  await flowBox(B).fill("");
});
await step("10", "need_input: thử ép bằng @orchestrator mơ hồ; nếu hiện thì A có nút, B chỉ 'Đang chờ…'", async () => {
  const r2 = await mkRoom("hỏi lại");
  await goRoom(r2, A, B);
  await send(A, "@orchestrator giúp tôi với");
  await idle(A, B);
  const ask = A.getByRole("region", { name: /cần thêm thông tin/ });
  await snap(A, "10-A-orch-ambiguous");
  await snap(B, "10-B-orch-ambiguous");
  const shown = await ask.count();
  notes.s10 = shown ? "need_input hiện" : "Orchestrator không hỏi lại — không ép được need_input";
  if (!shown) throw new Error(`SKIP: ${notes.s10}`);
  await expect(B.getByText(`Đang chờ ${NAME.A} trả lời agent.`)).toBeVisible();
  await expect(B.getByRole("region", { name: /cần thêm thông tin/ })).toHaveCount(0);
});
notes.s11 = "side_effect cần workflow ghi có xác nhận; không ép được với agent thật — bỏ qua";
await step("12", "A @orchestrator => chạy, nhãn 'Orchestrator'", async () => {
  await goRoom(room, A, B);
  const n0 = await blocks(A).count();
  await send(A, "@orchestrator 1+1 bằng mấy? trả lời một câu.");
  await expect(A.getByRole("button", { name: "Dừng" })).toBeVisible({ timeout: 30_000 });
  await snap(A, "12-A-orchestrator-streaming");
  await idle(A, B);
  await expect(blocks(A)).toHaveCount(n0 + 1);
  notes.s12 = (await blocks(A).last().innerText()).replace(/\n/g, " ¦ ").slice(0, 300);
  await snap(A, "12-A-orchestrator");
});
await step("13", "Không có nút đính kèm trong composer phòng", async () => {
  await expect(A.getByRole("button", { name: /Đính kèm|Tệp|Attach/i })).toHaveCount(0);
  await expect(A.locator("input[type=file]")).toHaveCount(0);
  await snap(A, "13-A-no-attach");
});
const optMenu = (p) => p.getByRole("button", { name: "Tuỳ chọn phòng" }).click();
await step("14a", "B rời nhóm khi run đang chạy => run của B bị huỷ", async () => {
  const r3 = await mkRoom("rời nhóm");
  await goRoom(r3, A, B);
  await send(B, "@consultant đếm từ 1 đến 80, mỗi số một dòng, giải thích từng số.");
  await expect(working(A)).toBeVisible({ timeout: 30_000 });
  await snap(A, "14a-A-before-leave");
  await optMenu(B);
  await B.getByRole("menuitem", { name: "Rời nhóm" }).click();
  await B.getByRole("alertdialog", { name: "Rời nhóm?" }).getByRole("button", { name: "Rời nhóm" }).click();
  await expect(roomLink(B, r3.name)).toHaveCount(0, { timeout: 15_000 });
  await expect(working(A)).toHaveCount(0, { timeout: 30_000 });
  await snap(A, "14a-A-after-leave");
  await snap(B, "14a-B-left");
  await A.waitForTimeout(20_000);
  notes.s14a = { cancelledTextA: await roomLog(A).getByText("Đã huỷ").count(), blocksAfter: await blocks(A).count() };
  await snap(A, "14a-A-after-20s");
});
await step("14b", "Chủ xoá nhóm khi C đang chạy => run bị huỷ, phòng biến mất", async () => {
  const r4 = await mkRoom("xoá nhóm");
  await goRoom(r4, A, C);
  await send(C, "@consultant đếm từ 1 đến 300, mỗi số một dòng, phân tích từng số thật chi tiết.");
  await expect(working(A)).toBeVisible({ timeout: 30_000 });
  await optMenu(A);
  await A.getByRole("menuitem", { name: /Xoá nhóm/ }).click();
  await A.getByRole("alertdialog").getByRole("button", { name: "Xoá", exact: true }).click();
  await expect(roomLink(A, r4.name)).toHaveCount(0, { timeout: 15_000 });
  await C.waitForTimeout(3000);
  await snap(A, "14b-A-after-delete");
  await snap(C, "14b-C-after-delete");
  await expect(roomLink(C, r4.name)).toHaveCount(0, { timeout: 15_000 });
});
await step("15", "Thu hồi invoices của C (UI Admin) => C gọi lại bị từ chối ngay", async () => {
  await goRoom(room, C);
  const run = (op) => execFileSync("node", [fileURLToPath(new URL("./perms.mjs", import.meta.url)), op, "invoices", "Vio Ngo", OUT], { encoding: "utf8" });
  try {
    notes.s15revoke = run("revoke");
    const text = "@invoices sau khi thu hồi";
    const t0 = Date.now();
    const s = await send(C, text, false, false);
    notes.s15ms = Date.now() - t0;
    expect(s.runId).toBeNull();
    await expect(denied(C, "invoices")).toBeVisible();
    await expect(box(C)).toHaveValue(text);
    await snap(C, "15-C-revoked-denied");
  } finally { notes.s15restore = run("restore"); }
});
await step("16", "F5 khi run đang chạy => khối 'đang xử lý' còn; kết quả hiện khi xong; không mất/lặp", async () => {
  const r5 = await mkRoom("tải lại");
  await goRoom(r5, A, B);
  const text = "@consultant đếm từ 1 đến 25, mỗi số một dòng.";
  await send(A, text);
  await expect(working(B)).toBeVisible({ timeout: 30_000 });
  await A.reload(); await B.reload();
  for (const p of [A, B]) await expect(working(p)).toBeVisible({ timeout: 20_000 });
  await expect(roomLog(A).getByRole("article").filter({ hasText: text })).toHaveCount(1);
  await snap(A, "16-A-after-f5");
  await snap(B, "16-B-after-f5");
  await idle(A, B);
  for (const p of [A, B]) await expect(blocks(p)).toHaveCount(1);
  await expect(roomLog(A).getByRole("article").filter({ hasText: text })).toHaveCount(1);
  await snap(A, "16-A-result-after-f5");
});
await step("17", "Hỏi AI: C1 như cũ; tin phòng không lẫn; @dify-chatbot (Dify thật) trả lời", async () => {
  await A.goto(`${CHAT}/c/new`);
  await expect(A.getByRole("heading", { level: 1 }).first()).toBeVisible();
  const body = await A.locator("body").innerText();
  for (const s of ["ALPHA", "đếm từ 1 đến 25", "sau khi thu hồi"]) expect(body).not.toContain(s);
  await snap(A, "17-A-hoi-ai");
  calls++; callLog.push("Hỏi AI @dify-chatbot (Dify thật)");
  await A.getByRole("textbox").first().fill("@dify-chatbot xin chào, trả lời ngắn một câu.");
  await A.getByRole("button", { name: /^Gửi/ }).first().click();
  await A.waitForTimeout(40_000);
  await snap(A, "17-A-dify-reply");
  notes.s17 = (await A.locator("main").innerText()).replace(/\n/g, " ¦ ").slice(0, 400);
});

await step("17b", "Phòng: @dify-chatbot (Dify thật) trả lời; xem xem trước phòng ở sidebar", async () => {
  const r6 = await mkRoom("dify");
  await goRoom(r6, A, B);
  const n0 = await blocks(A).count();
  await send(A, "@dify-chatbot xin chào, trả lời ngắn một câu.");
  await expect(working(B)).toBeVisible({ timeout: 30_000 });
  await idle(A, B);
  await snap(A, "17b-A-dify-room");
  await snap(B, "17b-B-dify-room");
  notes.s17b = (await roomLog(A).innerText()).replace(/\n/g, " ¦ ").slice(0, 400);
  notes.sidebar = (await A.getByRole("region", { name: "Tin nhắn & Nhóm" }).innerText()).replace(/\n/g, " ¦ ");
  await expect(blocks(A)).toHaveCount(n0 + 1);
});

R.finish();
const RES = ONLY ? "result-rerun.json" : "result.json";
writeFileSync(`${OUT}/${RES}`, JSON.stringify({ stamp, agentCalls: calls, callLog, notes, log: R.log }, null, 2));
const bad = R.log.filter((x) => !x.ok);
console.log(`\n${R.log.length - bad.length}/${R.log.length} PASS · agent calls ${calls}`);
await b.close();
