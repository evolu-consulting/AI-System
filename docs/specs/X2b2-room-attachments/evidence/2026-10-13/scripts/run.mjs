// UAT X2b-2 — chat-web :3100 -> Hub :4000 thật; Runtime fake-cli (container). Chạy bằng node.
import { chromium, expect } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3100", HUB = "http://localhost:4000", AUTH = "http://localhost:3001";
const PW = "1234567890";
const J = "Julian Bui", T = "Thomas Tran";
const log = [];
const stamp = Date.now().toString(36).slice(-4);

const b = await chromium.launch();
const mk = async () => {
  const c = await b.newContext({ viewport: { width: 1280, height: 850 }, locale: "vi-VN", acceptDownloads: true });
  await c.addInitScript(() => localStorage.setItem("ai.locale", "vi"));
  return c.newPage();
};
const A = await mk(), B = await mk();
const snap = async (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });
const roomLog = (p) => p.getByRole("log", { name: "Tin nhắn của phòng" });
const composer = (p, t) => p.getByRole("textbox", { name: `Tin nhắn cho ${t}` });
const sendBtn = (p) => p.getByRole("button", { name: "Gửi", exact: true });
const chips = (p) => p.getByRole("list", { name: "Tệp đính kèm" });
const inMsg = (p) => roomLog(p).getByRole("list", { name: "Tệp trong tin" });
const note = (p) => p.getByRole("note");
const PDF = (name, n = 4096) => { const x = Buffer.alloc(n, 0x41); x.write("%PDF-1.7\n", 0, "latin1"); return { name, mimeType: "application/pdf", buffer: x }; };
async function attach(p, f) {
  await expect(p.getByRole("button", { name: "Đính kèm tệp" })).toBeVisible();
  await p.locator('input[type="file"]').first().setInputFiles(f);
}
async function login(p, user) {
  await p.goto(`${BASE}/login`);
  
  await p.getByRole("textbox", { name: "Mã công ty" }).fill("evolu");
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(user);
  await p.getByLabel("Mật khẩu").fill(PW);
  await p.getByRole("button", { name: "Đăng nhập" }).click();
  await p.waitForURL(/\/c\/new$/);
}
async function tok(u) {
  const r = await fetch(`${AUTH}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenant_key: "evolu", username: u, password: PW }) });
  const j = await r.json();
  return { t: j.access_token, id: j.user?.id };
}
const api = async (t, method, path, body) => {
  const r = await fetch(`${HUB}${path}`, { method, headers: { authorization: `Bearer ${t}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  let json;
  try { json = JSON.parse(txt); } catch {}
  return { status: r.status, json, headers: r.headers, txt };
};
async function step(id, title, fn) {
  const t0 = Date.now();
  try { await fn(); log.push({ id, title, ok: true, ms: Date.now() - t0 }); console.log("PASS", id, title); }
  catch (e) {
    log.push({ id, title, ok: false, err: String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 400) });
    console.log("FAIL", id, title, String(e.message).split("\n")[0]);
    await snap(A, `${id}-FAIL-A`).catch(() => {});
    await snap(B, `${id}-FAIL-B`).catch(() => {});
  }
}
async function send(p, target, text) {
  await composer(p, target).fill(text);
  const resp = p.waitForResponse((r) => r.request().method() === "POST" && /\/rooms\/[^/]+\/messages$/.test(new URL(r.url()).pathname));
  await sendBtn(p).click();
  const r = await resp;
  return { status: r.status(), runId: r.headers()["x-run-id"] };
}
async function dl(p, name, scope) {
  const d = p.waitForEvent("download");
  await (scope ?? inMsg(p)).getByRole("button", { name: `Tải ${name}` }).last().click();
  const f = await d;
  return { name: f.suggestedFilename(), path: await f.path() };
}
const items = (j) => (Array.isArray(j) ? j : j.items ?? j.messages ?? []);
const jt = await tok("julian.bui"), tt = await tok("thomas.tran"), vt = await tok("vio.ngo");
const T_ID = tt.id;
console.log("ids", jt.id, T_ID, vt.id);

await login(A, "julian.bui");
await login(B, "thomas.tran");
const dm = (await api(jt.t, "POST", "/rooms", { kind: "dm", user_id: T_ID })).json.id;
const grp = (await api(jt.t, "POST", "/rooms", { kind: "group", name: `x2b2-uat-nhom-${stamp}`, member_ids: [T_ID] })).json.id;
const grp2 = (await api(jt.t, "POST", "/rooms", { kind: "group", name: `x2b2-uat-leave-${stamp}`, member_ids: [T_ID] })).json.id;
const state = { dm, grp, grp2 };

// ---- K1 DM
await step("K1a", "DM: A đính kèm file, chip + note chia sẻ; không chữ => Gửi disabled + note cần chữ", async () => {
  await A.goto(`${BASE}/rooms/${dm}`);
  await B.goto(`${BASE}/rooms/${dm}`);
  await expect(composer(B, J)).toBeVisible();
  await expect(note(A)).toHaveCount(0);
  await attach(A, PDF("x2b2-uat-hoadon.pdf"));
  await expect(chips(A).getByRole("listitem")).toHaveCount(1);
  await expect(chips(A).getByText("Đang tải lên…")).toHaveCount(0);
  await expect(note(A).filter({ hasText: `${T} sẽ xem và tải được tệp này` })).toBeVisible();
  await expect(sendBtn(A)).toBeDisabled();
  await expect(note(A).filter({ hasText: "Nhập nội dung tin để gửi kèm tệp." })).toBeVisible();
  await snap(A, "01-A-dm-chip-note-needtext");
});
await step("K1b", "DM: A nhập chữ, gửi; B (không reload) thấy chip, tải đúng file", async () => {
  const r = await send(A, T, "đây là hoá đơn x2b2-uat");
  expect(r.status).toBe(201);
  await expect(inMsg(A).getByRole("button", { name: "Tải x2b2-uat-hoadon.pdf" }).last()).toBeVisible();
  await expect(inMsg(B).getByRole("button", { name: "Tải x2b2-uat-hoadon.pdf" }).last()).toBeVisible({ timeout: 10000 });
  await snap(A, "02-A-dm-sent");
  await snap(B, "02-B-dm-received-chip");
  const f = await dl(B, "x2b2-uat-hoadon.pdf");
  expect(f.name).toBe("x2b2-uat-hoadon.pdf");
  const buf = readFileSync(f.path);
  expect(buf.length).toBe(4096);
  expect(buf.subarray(0, 8).toString()).toBe("%PDF-1.7");
  await expect(note(A)).toHaveCount(0);
});
await step("K1c", "DM: loại file .exe và >20MB báo câu C1", async () => {
  await attach(A, { name: "cai-dat.exe", mimeType: "application/octet-stream", buffer: Buffer.from([0x4d, 0x5a, 0x90, 0]) });
  await expect(A.getByText("Loại tệp không được hỗ trợ.")).toBeVisible();
  await attach(A, PDF("x2b2-uat-lon.pdf", 20 * 1048576 + 1));
  await expect(A.getByText("Tệp lớn hơn 20 MB.")).toBeVisible();
  await snap(A, "03-A-dm-errors");
});

// ---- K2 nhóm
await step("K2a", "Nhóm {A,B}: A gửi file; B thấy chip + tải; note nhóm", async () => {
  await A.goto(`${BASE}/rooms/${grp}`);
  await B.goto(`${BASE}/rooms/${grp}`);
  await expect(composer(B, "nhóm")).toBeVisible();
  await attach(A, PDF("x2b2-uat-nhom.pdf", 2048));
  await expect(chips(A).getByText("Đang tải lên…")).toHaveCount(0);
  await expect(note(A).filter({ hasText: "Mọi thành viên của nhóm đều xem và tải được tệp này" })).toBeVisible();
  await snap(A, "04-A-group-note");
  expect((await send(A, "nhóm", "tệp cho nhóm x2b2-uat")).status).toBe(201);
  await expect(inMsg(B).getByRole("button", { name: "Tải x2b2-uat-nhom.pdf" }).last()).toBeVisible({ timeout: 10000 });
  await snap(B, "05-B-group-chip");
  const f = await dl(B, "x2b2-uat-nhom.pdf");
  expect(f.name).toBe("x2b2-uat-nhom.pdf");
});
await step("K2b", "Nhóm: C (vio, ngoài nhóm) GET /attachments/:id[/content] => 404; B => 200 (API)", async () => {
  const msgs = await api(jt.t, "GET", `/rooms/${grp}/messages`);
  const m = items(msgs.json).find((x) => x.attachments?.length);
  const id = m.attachments[0].id;
  const c1 = await api(vt.t, "GET", `/attachments/${id}`);
  const c2 = await api(vt.t, "GET", `/attachments/${id}/content`);
  const b2 = await api(tt.t, "GET", `/attachments/${id}/content`);
  state.k2b = { c_meta: c1.status, c_content: c2.status, b_content: b2.status, hdr: Object.fromEntries(["content-type", "content-disposition", "x-content-type-options", "cache-control"].map((h) => [h, b2.headers.get(h)])) };
  expect(c1.status).toBe(404);
  expect(c2.status).toBe(404);
  expect(b2.status).toBe(200);
});

// ---- K4 agent
await step("K4a", "Nhóm: A '@pb-doc-fake … #fake:files #fake:out=…' kèm file => agent đọc file, tin agent có chip; B tải được", async () => {
  await A.goto(`${BASE}/rooms/${grp}`);
  await B.goto(`${BASE}/rooms/${grp}`);
  await attach(A, PDF("x2b2-uat-agent.pdf", 3000));
  await expect(chips(A).getByText("Đang tải lên…")).toHaveCount(0);
  const r = await send(A, "nhóm", "@pb-doc-fake kiểm tra file #fake:files #fake:out=x2b2-uat-report.md");
  expect(r.status).toBe(201);
  expect(r.runId).toBeTruthy();
  await snap(A, "07-A-agent-sent");
  const blockA = A.getByRole("article", { name: /Trả lời của agent/ });
  await expect(blockA.first()).toBeVisible({ timeout: 60000 });
  await expect(A.getByRole("button", { name: "Tải x2b2-uat-report.md" }).first()).toBeVisible({ timeout: 90000 });
  await snap(A, "08-A-agent-reply-out");
  state.agentReply = (await blockA.first().innerText()).slice(0, 600);
  await expect(B.getByRole("button", { name: "Tải x2b2-uat-report.md" }).first()).toBeVisible({ timeout: 15000 });
  await snap(B, "09-B-agent-reply-out");
  const f = await dl(B, "x2b2-uat-report.md", roomLog(B));
  expect(f.name).toBe("x2b2-uat-report.md");
  state.outContent = readFileSync(f.path, "utf8");
  expect(state.outContent).toContain("fake output");
  expect(state.agentReply).toContain("x2b2-uat-agent.pdf");
});

// ---- K3 thread
await step("K3", "Thread: mở thread từ khối agent, gửi file trong thread; hiển thị đúng; B thấy", async () => {
  await A.goto(`${BASE}/rooms/${grp}`);
  await B.goto(`${BASE}/rooms/${grp}`);
  await A.getByRole("article", { name: /Trả lời của agent/ }).first().getByRole("button", { name: "Trả lời tiếp" }).click();
  const pane = A.getByRole("complementary", { name: "Flow đang mở" });
  await expect(pane).toBeVisible();
  await expect(pane.getByRole("button", { name: "Đính kèm tệp" })).toBeVisible();
  await pane.locator('input[type="file"]').first().setInputFiles(PDF("x2b2-uat-thread.pdf", 1500));
  await expect(pane.getByText("Đang tải lên…")).toHaveCount(0);
  await expect(pane.getByRole("note").filter({ hasText: "Mọi thành viên của phòng đều xem và tải được tệp này" })).toBeVisible();
  await snap(A, "10-A-thread-chip-note");
  await pane.getByRole("textbox", { name: "Tin nhắn trong flow" }).fill("tệp trong thread x2b2-uat");
  const resp = A.waitForResponse((r) => r.request().method() === "POST" && /\/rooms\/[^/]+\/messages$/.test(new URL(r.url()).pathname));
  await pane.getByRole("button", { name: "Gửi trong flow" }).click();
  expect((await resp).status()).toBe(201);
  await expect(pane.getByRole("button", { name: "Tải x2b2-uat-thread.pdf" })).toBeVisible();
  await snap(A, "11-A-thread-sent");
  await B.getByRole("article", { name: /Trả lời của agent/ }).first().getByRole("button", { name: "Trả lời tiếp" }).click();
  const paneB = B.getByRole("complementary", { name: "Flow đang mở" });
  await expect(paneB.getByRole("button", { name: "Tải x2b2-uat-thread.pdf" })).toBeVisible({ timeout: 10000 });
  await snap(B, "12-B-thread-view");
  const f = await dl(B, "x2b2-uat-thread.pdf", paneB);
  expect(f.name).toBe("x2b2-uat-thread.pdf");
});

// ---- K6 !key + file
await step("K6", "Timeline: '!hoa-don …' kèm file => câu lỗi noAttach", async () => {
  await A.goto(`${BASE}/rooms/${grp}`);
  await attach(A, PDF("x2b2-uat-bang.pdf", 1200));
  await expect(chips(A).getByText("Đang tải lên…")).toHaveCount(0);
  await composer(A, "nhóm").fill("!hoa-don kiểm tra x2b2-uat");
  await sendBtn(A).click();
  await expect(A.getByText("Quy trình chưa nhận tệp đính kèm. Gỡ tệp hoặc bỏ “!” rồi gửi lại.")).toBeVisible({ timeout: 10000 });
  await snap(A, "13-A-bang-noattach");
});

// ---- K7 rời phòng
await step("K7", "Rời phòng: B rời nhóm qua UI => tải file 404; A vẫn tải được", async () => {
  await A.goto(`${BASE}/rooms/${grp2}`);
  await B.goto(`${BASE}/rooms/${grp2}`);
  await attach(A, PDF("x2b2-uat-roi.pdf", 1000));
  await expect(chips(A).getByText("Đang tải lên…")).toHaveCount(0);
  expect((await send(A, "nhóm", "tệp trước khi B rời x2b2-uat")).status).toBe(201);
  await expect(inMsg(B).getByRole("button", { name: "Tải x2b2-uat-roi.pdf" }).last()).toBeVisible({ timeout: 10000 });
  const msgs = await api(jt.t, "GET", `/rooms/${grp2}/messages`);
  const id = items(msgs.json).find((x) => x.attachments?.length).attachments[0].id;
  expect((await api(tt.t, "GET", `/attachments/${id}/content`)).status).toBe(200);
  await B.getByRole("button", { name: "Tuỳ chọn phòng" }).click();
  await snap(B, "14-B-room-options");
  await B.getByRole("menuitem", { name: "Rời nhóm" }).click();
  await B.getByRole("button", { name: "Rời nhóm" }).last().click();
  await B.waitForURL(/\/c\/new$/, { timeout: 10000 });
  await snap(B, "15-B-after-leave");
  const after = await api(tt.t, "GET", `/attachments/${id}/content`);
  const afterMeta = await api(tt.t, "GET", `/attachments/${id}`);
  state.k7 = { after: after.status, afterMeta: afterMeta.status, a: (await api(jt.t, "GET", `/attachments/${id}/content`)).status };
  expect(after.status).toBe(404);
  expect(afterMeta.status).toBe(404);
  expect(state.k7.a).toBe(200);
});

writeFileSync(`${OUT}/result.json`, JSON.stringify({ log, state, stamp }, null, 2));
await b.close();
console.log(JSON.stringify(state, null, 1));
