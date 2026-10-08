// UAT trình duyệt X2b (manual-test-I2, 17 kịch bản) — chat-web dev :3100 → Hub dev :4000, Runtime GIẢ (rt-server.ts :4058).
// A = julian.bui (hoadon, trello) · B = thomas.tran (trello) · C = vio.ngo (hoadon). Chạy: node run.mjs <outDir>
import { chromium, expect } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
import postgres from "file:///D:/AI/ai-system/node_modules/postgres/src/index.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3100", HUB = "http://localhost:4000", AUTH = "http://localhost:3001", RT = "http://localhost:4058";
const PW = "1234567890";
const env = readFileSync("D:/AI/ai-system/.env.local", "utf8");
const DBURL = /^DATABASE_URL=(.*)$/m.exec(env)[1].trim();
const sql = postgres(DBURL, { max: 2, onnotice: () => {} });
const stamp = Date.now().toString(36).slice(-4);
const SECRET = "PARAM-SECRET-77";
const log = [];
const notes = {};
const note = (id, t) => { notes[id] = t; };

const b = await chromium.launch();
const mk = (w = 1280, h = 800) => b.newContext({ viewport: { width: w, height: h }, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
const [cA, cB, cC] = await Promise.all([mk(), mk(), mk()]);
const [A, B, C] = await Promise.all([cA.newPage(), cB.newPage(), cC.newPage()]);
const NAME = { A: "Julian Bui", B: "Thomas Tran", C: "Vio Ngo" };
const snap = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` }).catch(() => {});

const roomLog = (p) => p.getByRole("log", { name: "Tin nhắn của phòng" });
const box = (p) => p.getByRole("textbox", { name: "Tin nhắn cho nhóm" });
const menu = (p) => p.getByRole("listbox", { name: "Agent" });
const block = (p, agent = "hoadon") => roomLog(p).getByRole("article", { name: `Trả lời của agent ${agent}` });
const working = (p, agent = "hoadon") => p.getByRole("status").filter({ hasText: `${agent} đang xử lý…` });
const flowPane = (p) => p.getByRole("complementary", { name: "Flow đang mở" });
const flowBox = (p) => p.getByRole("textbox", { name: "Tin nhắn trong flow" });
const roomLink = (p, n) => p.getByRole("region", { name: "Tin nhắn & Nhóm" }).getByRole("link", { name: n, exact: true });

async function rt(op, run_id, result) {
  const r = await fetch(`${RT}/rt/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ run_id, result }) });
  if (r.status !== 200) throw new Error(`rt ${op}: ${r.status} ${await r.text()}`);
}
const answer = (id, text) => rt("answer", id, { status: "done", text });
async function login(p, user) {
  await p.goto(`${BASE}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill("evolu");
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(user);
  await p.getByLabel("Mật khẩu").fill(PW);
  await p.getByRole("button", { name: "Đăng nhập" }).click();
  await p.waitForURL(/\/c\/new$/);
}
async function token(user) {
  const r = await fetch(`${AUTH}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenant_key: "evolu", username: user, password: PW }) });
  const j = await r.json();
  return j.access_token ?? j.token ?? j.data?.access_token;
}
async function sendRoom(p, text, inFlow = false) {
  const tb = inFlow ? flowBox(p) : box(p);
  await tb.fill(text);
  const resp = p.waitForResponse((r) => r.request().method() === "POST" && /\/rooms\/[^/]+\/messages$/.test(new URL(r.url()).pathname));
  await p.getByRole("button", { name: inFlow ? "Gửi trong flow" : "Gửi", exact: true }).click();
  const r = await resp;
  return { runId: r.headers()["x-run-id"] ?? null, flowId: r.headers()["x-flow-id"] ?? null, status: r.status() };
}
async function mkRoom(label) {
  const name = `UAT X2b ${label} ${stamp}`;
  await A.goto(`${BASE}/c/new`);
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
  for (const p of [B, C]) await p.goto(`${BASE}/rooms/${id}`);
  for (const p of [A, B, C]) await expect(box(p)).toBeVisible();
  return { id, name };
}
async function settle() {
  await sql`update hub.jobs set status = 'succeeded', finished_at = now() where status in ('queued','running')`;
  await sql`update hub.runs set status='cancelled', error_code='CANCELLED', error_message='uat settle', error_hint='uat settle', finished_at=now(), owner=null, lease_until=null where status in ('running','waiting')`;
}
async function userId(u) { return (await sql`select u.id from admin.users u join admin.tenants t on t.id=u.tenant_id where t.key='evolu' and u.username=${u}`)[0].id; }
async function step(id, title, fn) {
  const t0 = Date.now();
  try { await fn(); log.push({ id, title, ok: true, ms: Date.now() - t0, note: notes[id] }); console.log("PASS", id, title); }
  catch (e) {
    const err = String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400);
    log.push({ id, title, ok: false, err }); console.log("FAIL", id, title, err);
    for (const [n, p] of [["A", A], ["B", B], ["C", C]]) await snap(p, `${id}-FAIL-${n}`);
  }
  await settle().catch(() => {});
}

await step("00", "Đăng nhập A/B/C (evolu)", async () => {
  await login(A, "julian.bui"); await login(B, "thomas.tran"); await login(C, "vio.ngo");
});

await step("01", "A mở Evolu team, gõ @ ⇒ orchestrator, hoadon, trello; không panel/chip agent", async () => {
  await roomLink(A, "Evolu team").click();
  await box(A).fill("@");
  await expect(menu(A)).toBeVisible();
  console.log("menu A:", (await menu(A).innerText()).replace(/\n/g, " ¦ "));
  for (const k of ["@hoadon", "@trello"]) await expect(menu(A).getByRole("option").filter({ hasText: k })).toHaveCount(1);
  // spec R14 + e2e E-A1: menu = GET /agents (2 option); `@orchestrator` gõ tay được, KHÔNG liệt kê (manual-test-I2 #1 ghi 3 ⇒ lệch tài liệu)
  await expect(menu(A).getByRole("option")).toHaveCount(2);
  note("01", "menu A có 2 option (hoadon, trello), không có orchestrator — đúng spec R14/e2e, lệch manual-test-I2 #1");
  await expect(A.getByRole("complementary")).toHaveCount(0);
  await snap(A, "01-A-menu-at");
});
await step("02", "B gõ @ ⇒ chỉ orchestrator, trello (không hoadon)", async () => {
  await roomLink(B, "Evolu team").click();
  await box(B).fill("@");
  await expect(menu(B)).toBeVisible();
  console.log("menu B:", (await menu(B).innerText()).replace(/\n/g, " ¦ "));
  await expect(menu(B).getByRole("option").filter({ hasText: "@trello" })).toHaveCount(1);
  await expect(menu(B).getByRole("option").filter({ hasText: "@hoadon" })).toHaveCount(0);
  await expect(menu(B).getByRole("option")).toHaveCount(1);
  note("02", "menu B chỉ có trello (không hoadon, không orchestrator) — đúng spec/e2e");
  await snap(B, "02-B-menu-at");
  await box(A).fill(""); await box(B).fill("");
});

const R = await mkRoom("chính").catch(async (e) => { console.log("mkRoom lỗi", e.message); await snap(A, "mkroom-FAIL"); throw e; });
await step("03", "A @hoadon ⇒ B/C thấy 'đang xử lý…' rồi khối 'Julian Bui hỏi'; huy hiệu B +2, A không", async () => {
  for (const p of [A, B, C]) await p.goto(`${BASE}/rooms/${R.id}`);
  const s = await sendRoom(A, "@hoadon tổng hợp hoá đơn tháng này");
  expect(s.runId).toBeTruthy();
  await expect(A.getByRole("button", { name: "Dừng" })).toBeVisible();
  for (const p of [B, C]) await expect(working(p)).toBeVisible();
  await expect(B.getByRole("button", { name: "Dừng" })).toHaveCount(0);
  await expect(B.getByText(`Chỉ ${NAME.A} dừng được`)).toBeVisible();
  await snap(A, "03-A-working"); await snap(B, "03-B-working");
  await answer(s.runId, "HD-12 hợp lệ. Tổng tháng: 3 hoá đơn.");
  for (const p of [A, B, C]) { await expect(block(p)).toContainText("HD-12 hợp lệ"); await expect(working(p)).toHaveCount(0); }
  await expect(block(A)).toContainText("Bạn hỏi");
  await expect(block(B)).toContainText(`${NAME.A} hỏi`);
  await expect(block(B)).toContainText(`Chạy bằng quyền của ${NAME.A}`);
  await snap(B, "03-B-result"); await snap(C, "03-C-result");
  await B.goto(`${BASE}/c/new`);
  const s2 = await sendRoom(A, "@hoadon lần hai"); await answer(s2.runId, "HD-13 hợp lệ.");
  await expect(roomLink(B, R.name).getByTestId("unread-badge")).toHaveText("2", { timeout: 10_000 });
  await expect(roomLink(A, R.name).getByTestId("unread-badge")).toHaveCount(0);
  await snap(B, "03-B-badge-2");
  await B.goto(`${BASE}/rooms/${R.id}`);
});
await step("04", "A bấm Dừng khi chạy ⇒ khối 'Đã huỷ' cho mọi người", async () => {
  const s = await sendRoom(A, "@hoadon việc sẽ bị dừng");
  await rt("claim", s.runId);
  await expect(working(B).last()).toBeVisible();
  await A.getByRole("button", { name: "Dừng" }).click();
  for (const p of [A, B, C]) await expect(roomLog(p).getByText("Đã huỷ").last()).toBeVisible({ timeout: 10_000 });
  await snap(A, "04-A-cancelled"); await snap(B, "04-B-cancelled");
});
await step("05", "B @hoadon (không quyền) ⇒ alert 'Không tìm thấy agent @hoadon.', ô giữ chữ, không run", async () => {
  const before = (await sql`select count(*)::int n from hub.runs`)[0].n;
  const text = "@hoadon kiểm tra chui";
  const s = await sendRoom(B, text);
  expect(s.runId).toBeNull();
  await expect(B.getByRole("alert").filter({ hasText: "Không tìm thấy agent @hoadon." })).toBeVisible();
  await expect(box(B)).toHaveValue(text);
  await expect(roomLog(A).getByRole("article").filter({ hasText: text })).toHaveCount(0);
  expect((await sql`select count(*)::int n from hub.runs`)[0].n).toBe(before);
  await snap(B, "05-B-denied");
  await box(B).fill("");
});
await step("06", "C @hoadon ⇒ khối ghi 'Chạy bằng quyền của Vio Ngo'", async () => {
  const s = await sendRoom(C, "@hoadon hoá đơn của Vio");
  await answer(s.runId, "Xong phần của Vio.");
  for (const p of [A, B, C]) await expect(block(p).last()).toContainText("Xong phần của Vio.");
  await expect(block(A).last()).toContainText(`Chạy bằng quyền của ${NAME.C}`);
  await expect(block(A).last()).toContainText(`${NAME.C} hỏi`);
  await snap(A, "06-A-vio-run");
});
await step("07", "A và C gọi gần nhau ⇒ 2 khối song song, không lẫn", async () => {
  const sa = await sendRoom(A, "@hoadon việc của Julian");
  const sc = await sendRoom(C, "@hoadon việc của Vio 2");
  await expect(working(B)).toHaveCount(2);
  await snap(B, "07-B-two-working");
  await answer(sc.runId, "KQ-VIO-2"); await answer(sa.runId, "KQ-JULIAN");
  await expect(working(B)).toHaveCount(0);
  const t = (await block(B).allInnerTexts()).filter((x) => /KQ-/.test(x));
  const ja = t.find((x) => x.includes("KQ-JULIAN")), vi = t.find((x) => x.includes("KQ-VIO-2"));
  expect(ja).toContain(`${NAME.A} hỏi`); expect(ja).not.toContain("KQ-VIO-2");
  expect(vi).toContain(`${NAME.C} hỏi`); expect(vi).not.toContain("KQ-JULIAN");
  await snap(B, "07-B-two-results");
});
const openThread = async (p) => { await block(p).first().getByRole("button", { name: "Trả lời tiếp" }).click(); await expect(flowPane(p)).toBeVisible(); };
await step("08", "A mở thread ⇒ B, C cũng có composer; B nhắn thường OK (không run); C tag @hoadon ⇒ 'Chạy bằng quyền của Vio'", async () => {
  for (const p of [A, B, C]) await p.goto(`${BASE}/rooms/${R.id}`);
  await openThread(A); await openThread(B); await openThread(C);
  for (const p of [A, B, C]) await expect(flowBox(p)).toBeVisible();
  await snap(A, "08-A-thread");
  const before = (await sql`select count(*)::int n from hub.runs`)[0].n;
  await flowBox(B).fill("Mình xem rồi, ok nhé"); await B.getByRole("button", { name: "Gửi trong flow" }).click();
  for (const p of [A, B, C]) await expect(flowPane(p).getByText("Mình xem rồi, ok nhé")).toBeVisible();
  expect((await sql`select count(*)::int n from hub.runs`)[0].n).toBe(before);
  await snap(C, "08-C-sees-B-message");
  const s = await sendRoom(C, "@hoadon kiểm tra tiếp trong thread", true);
  expect(s.runId).toBeTruthy();
  await expect(flowPane(C).getByRole("button", { name: "Dừng" })).toBeVisible();
  await expect(working(A)).toBeVisible();
  await snap(A, "08-A-sees-C-working");
  await answer(s.runId, "Thread: hợp lệ.");
  const blk = flowPane(A).getByRole("article", { name: "Trả lời của agent hoadon" }).last();
  await expect(blk).toContainText("Thread: hợp lệ.");
  await expect(blk).toContainText(`Chạy bằng quyền của ${NAME.C}`);
  await snap(A, "08-A-thread-vio-block");
});
await step("09", "Trong thread B @trello ⇒ run của B, trả lời hiện trong thread, A xem được; B @hoadon ⇒ lỗi giữ chữ", async () => {
  const s = await sendRoom(B, "@trello tạo thẻ mới", true);
  expect(s.runId).toBeTruthy();
  expect((await sql`select user_id from hub.runs where id=${s.runId}`)[0].user_id).toBe(await userId("thomas.tran"));
  await answer(s.runId, "Đã tạo thẻ TR-1.");
  const blk = flowPane(A).getByRole("article", { name: "Trả lời của agent Trello" }).last();
  await expect(blk).toContainText("Đã tạo thẻ TR-1.");
  await expect(blk).toContainText(`Chạy bằng quyền của ${NAME.B}`);
  await snap(A, "09-A-sees-B-trello");
  const t = "@hoadon kiểm tra giúp";
  await flowBox(B).fill(t); await B.getByRole("button", { name: "Gửi trong flow" }).click();
  await expect(B.getByRole("alert").filter({ hasText: "Không tìm thấy agent @hoadon." })).toBeVisible();
  await expect(flowBox(B)).toHaveValue(t);
  await snap(B, "09-B-thread-denied");
});
await step("10", "need_input: A có chip, B thấy 'Đang chờ … trả lời agent.', không nút; B forge answer_run_id ⇒ 403", async () => {
  const room = await mkRoom("hỏi lại");
  for (const p of [A, B]) await p.goto(`${BASE}/rooms/${room.id}`);
  const s = await sendRoom(A, "@hoadon kiểm tra hoá đơn");
  await rt("answer", s.runId, { status: "need_input", question: "Số hoá đơn nào?", choices: ["HD-12", "HD-13"] });
  const ask = A.getByRole("region", { name: /hoadon cần thêm thông tin/ });
  await expect(ask).toBeVisible();
  await expect(B.getByText("Số hoá đơn nào?").first()).toBeVisible();
  await expect(B.getByRole("region", { name: /cần thêm thông tin/ })).toHaveCount(0);
  await expect(B.getByRole("button", { name: "HD-12", exact: true })).toHaveCount(0);
  await expect(B.getByText(`Đang chờ ${NAME.A} trả lời agent.`)).toBeVisible();
  await snap(A, "10-A-chip"); await snap(B, "10-B-waiting");
  const tb = await token("thomas.tran");
  const r = await fetch(`${HUB}/rooms/${room.id}/messages`, { method: "POST", headers: { authorization: `Bearer ${tb}`, "content-type": "application/json" }, body: JSON.stringify({ client_msg_id: crypto.randomUUID(), content: "HD-12", flow_id: s.flowId, answer_run_id: s.runId }) });
  const j = await r.json().catch(() => ({}));
  console.log("forge B:", r.status, JSON.stringify(j).slice(0, 120));
  expect(r.status).toBe(403);
  const req = A.waitForRequest((q) => q.method() === "POST" && /\/rooms\/[^/]+\/messages$/.test(new URL(q.url()).pathname));
  await ask.getByRole("button", { name: "HD-12", exact: true }).click();
  expect((await req).postDataJSON().answer_run_id).toBe(s.runId);
  await expect(flowPane(A).getByText("HD-12").first()).toBeVisible();
  await snap(A, "10-A-answered");
});
await step("11", "side_effect: A thấy Đồng ý/Huỷ; B chỉ 'Đang chờ … xác nhận', DOM B không có chi tiết", async () => {
  const room = await mkRoom("xác nhận");
  for (const p of [A, B]) await p.goto(`${BASE}/rooms/${room.id}`);
  const s = await sendRoom(A, "@hoadon tạo thẻ thanh toán");
  await rt("claim", s.runId);
  const run = (await sql`select flow_id, agent_id, tenant_id from hub.runs where id=${s.runId}`)[0];
  await sql`insert into hub.tool_confirmations (tenant_id, user_id, flow_id, run_id, agent_id, workflow_id, status)
    values (${run.tenant_id}, ${await userId("julian.bui")}, ${run.flow_id}, ${s.runId}, ${run.agent_id}, 'a2bb0000-0000-4000-8000-000000008001', 'pending')`;
  await answer(s.runId, `Xác nhận tạo thẻ ${SECRET} trên bảng Kế toán?`);
  const ask = A.getByRole("region", { name: /hoadon cần bạn xác nhận/ });
  await expect(ask.getByRole("button", { name: "Đồng ý" })).toBeVisible();
  await expect(ask.getByRole("button", { name: "Huỷ" })).toBeVisible();
  const wait = B.getByRole("article", { name: "Agent hoadon đang chờ xác nhận" });
  await expect(wait).toContainText(`Đang chờ ${NAME.A} xác nhận — chỉ người hỏi mới bấm được.`);
  await expect(B.getByRole("button", { name: "Đồng ý" })).toHaveCount(0);
  expect(await B.content()).not.toContain(SECRET);
  await snap(A, "11-A-confirm"); await snap(B, "11-B-waiting-confirm");
});
await step("12", "A @orchestrator tóm tắt ⇒ chạy; nhãn gửi 'Orchestrator'", async () => {
  await A.goto(`${BASE}/rooms/${R.id}`);
  const s = await sendRoom(A, "@orchestrator tóm tắt");
  expect(s.runId).toBeTruthy();
  // Orchestrator: job 1 là quyết định (JSON `decision`), runtime giả trả `answer` ⇒ khối kết thúc
  const d = await fetch(`${RT}/rt/decide`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ run_id: s.runId, text: JSON.stringify({ decision: "answer", text: "Tóm tắt: 3 hoá đơn." }) }) });
  if (d.status !== 200) throw new Error(`rt decide: ${d.status} ${await d.text()}`);
  const blk = roomLog(A).getByRole("article", { name: /Trả lời của agent/ }).last();
  await expect(blk).toContainText("Tóm tắt: 3 hoá đơn.");
  console.log("orchestrator block:", (await blk.innerText()).replace(/\n/g, " ¦ ").slice(0, 200));
  await expect(blk).toContainText(/Orchestrator/i);
  await snap(A, "12-A-orchestrator-streaming");
  await expect(A.getByRole("button", { name: "Dừng" })).toHaveCount(0, { timeout: 15_000 });
  await expect(blk.getByRole("button", { name: "Trả lời tiếp" })).toBeVisible();
  await snap(A, "12-A-orchestrator");
});
await step("13", "Không có nút đính kèm trong composer phòng", async () => {
  await expect(A.getByRole("button", { name: /Đính kèm|Tệp|Attach/i })).toHaveCount(0);
  await expect(A.locator("input[type=file]")).toHaveCount(0);
  await snap(A, "13-A-no-attach");
});
await step("14", "Rời nhóm khi run đang chạy ⇒ run của người rời bị huỷ", async () => {
  const room = await mkRoom("rời nhóm");
  for (const p of [A, B]) await p.goto(`${BASE}/rooms/${room.id}`);
  const s = await sendRoom(B, "@trello việc dở dang");
  await rt("claim", s.runId);
  await expect(working(A, "Trello")).toBeVisible();
  await snap(A, "14-A-before-leave");
  await B.getByRole("button", { name: "Tuỳ chọn phòng" }).click();
  await B.getByRole("menuitem", { name: "Rời nhóm" }).click();
  await B.getByRole("alertdialog", { name: "Rời nhóm?" }).getByRole("button", { name: "Rời nhóm" }).click();
  await expect(roomLink(B, room.name)).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(async () => (await sql`select status from hub.runs where id=${s.runId}`)[0].status, { timeout: 15_000 }).toBe("cancelled");
  await expect(working(A, "Trello")).toHaveCount(0, { timeout: 10_000 });
  await snap(A, "14-A-after-leave-live"); await snap(B, "14-B-left");
  const live = await roomLog(A).getByText("Đã huỷ").count();
  await A.reload();
  await expect(box(A)).toBeVisible();
  const reloaded = await roomLog(A).getByText("Đã huỷ").count();
  console.log("14: 'Đã huỷ' hiện ở A — live:", live, "· sau F5:", reloaded);
  await snap(A, "14-A-after-leave-reloaded");
  expect(live, "A thấy 'Đã huỷ' ngay (realtime) sau khi B rời").toBeGreaterThan(0);
  expect(reloaded, "A thấy 'Đã huỷ' sau F5").toBeGreaterThan(0);
});
await step("15", "Thu hồi hoadon của C ⇒ C gọi lại bị từ chối ngay (không chờ làm tươi cache)", async () => {
  await C.goto(`${BASE}/rooms/${R.id}`);
  const vid = await userId("vio.ngo");
  const [g] = await sql`select agent_id, tenant_id from hub.agent_grants where subject_type='user' and subject_id=${vid} and agent_id=(select id from hub.agents where key='hoadon')`;
  try {
    await sql`delete from hub.agent_grants where agent_id=${g.agent_id} and subject_type='user' and subject_id=${vid}`;
    await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
    const t0 = Date.now();
    const text = "@hoadon sau khi thu hồi";
    const s = await sendRoom(C, text);
    console.log("C sau thu hồi: runId", s.runId, "status", s.status, "sau", Date.now() - t0, "ms");
    expect(s.runId).toBeNull();
    await expect(C.getByRole("alert").filter({ hasText: "Không tìm thấy agent @hoadon." })).toBeVisible();
    await expect(box(C)).toHaveValue(text);
    await snap(C, "15-C-revoked-denied");
  } finally {
    await sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id) values (${g.agent_id}, ${g.tenant_id}, 'user', ${vid}) on conflict do nothing`;
    await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  }
});
await step("16", "F5 khi run đang chạy ⇒ khối 'đang xử lý' còn; kết quả hiện khi xong; không mất/lặp tin", async () => {
  const room = await mkRoom("tải lại");
  for (const p of [A, B]) await p.goto(`${BASE}/rooms/${room.id}`);
  const text = "@hoadon kiểm tra F5";
  const s = await sendRoom(A, text);
  await rt("claim", s.runId);
  await expect(working(B)).toBeVisible();
  await A.reload(); await B.reload();
  for (const p of [A, B]) await expect(working(p)).toBeVisible();
  await expect(roomLog(A).getByRole("article").filter({ hasText: text })).toHaveCount(1);
  await snap(A, "16-A-after-f5"); await snap(B, "16-B-after-f5");
  await answer(s.runId, "F5 xong.");
  for (const p of [A, B]) { await expect(block(p)).toContainText("F5 xong."); await expect(block(p)).toHaveCount(1); await expect(working(p)).toHaveCount(0); }
  await expect(roomLog(A).getByRole("article").filter({ hasText: text })).toHaveCount(1);
  await snap(A, "16-A-result-after-f5");
});
await step("17", "Hỏi AI: /c/new vẫn như cũ, không lẫn tin phòng vào danh sách hội thoại", async () => {
  await A.goto(`${BASE}/c/new`);
  await expect(A.getByRole("heading", { level: 1 }).first()).toBeVisible();
  const body = await A.locator("body").innerText();
  expect(body).not.toContain("tổng hợp hoá đơn tháng này");
  expect(body).not.toContain("kiểm tra F5");
  await snap(A, "17-A-hoi-ai");
});
await step("18", "Điện thoại 390px: thread là dialog 'Flow đang mở', có 'Đóng khung flow'", async () => {
  const cm = await mk(390, 800); const M = await cm.newPage();
  await login(M, "julian.bui");
  await M.goto(`${BASE}/rooms/${R.id}`);
  await snap(M, "18-M-room");
  await block(M).first().getByRole("button", { name: "Trả lời tiếp" }).click();
  await expect(M.getByRole("dialog", { name: "Flow đang mở" })).toBeVisible();
  await expect(M.getByRole("button", { name: "Đóng khung flow" })).toBeVisible();
  await expect(flowBox(M)).toBeVisible();
  await snap(M, "18-M-flow-sheet");
  await flowBox(M).fill("@");
  await expect(M.getByRole("listbox", { name: "Agent" }).getByRole("option")).toHaveCount(2, { timeout: 10_000 });
  await snap(M, "18-M-flow-menu");
  await cm.close();
});

writeFileSync(`${OUT}/result.json`, JSON.stringify({ stamp, log }, null, 2));
const bad = log.filter((x) => !x.ok);
console.log(`\n${log.length - bad.length}/${log.length} PASS`);
await sql.end(); await b.close();
