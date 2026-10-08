// I2 manual test (thay người dùng) — 2 user evolu, chat-web thật :3100 → Hub :4000. Chụp evidence.
import { chromium, expect } from "file:///D:/AI/ai-system/node_modules/@playwright/test/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3100";
const PW = "1234567890";
const J = "Julian Bui", T = "Thomas Tran", V = "Vio Ngo", R = "Rowan Hoang";
const log = [];
const stamp = Date.now().toString(36).slice(-4);
const GROUP = `Dự án X2a demo ${stamp}`;
const GROUP2 = `Dự án X2a (đổi tên) ${stamp}`;

const b = await chromium.launch();
const ctxA = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: "vi-VN" });
const ctxB = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: "vi-VN" });
const A = await ctxA.newPage(), B = await ctxB.newPage();
const snap = async (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });
const rooms = (p) => p.getByRole("region", { name: "Tin nhắn & Nhóm" });
const roomLink = (p, n) => rooms(p).getByRole("link", { name: n, exact: true });
const roomLog = (p) => p.getByRole("log", { name: "Tin nhắn của phòng" });
const composer = (p, t) => p.getByRole("textbox", { name: [J, T, V, R].includes(t) ? `Tin nhắn cho ${t}` : "Tin nhắn cho nhóm" });
const opts = (p) => p.getByRole("button", { name: "Tuỳ chọn phòng" });
async function say(p, target, text) {
  await composer(p, target).fill(text);
  await p.getByRole("button", { name: "Gửi" }).click();
  await expect(roomLog(p).getByRole("article").filter({ hasText: text })).toBeVisible();
}
async function login(p, user) {
  await p.goto(`${BASE}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill("evolu");
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(user);
  await p.getByLabel("Mật khẩu").fill(PW);
  await p.getByRole("button", { name: "Đăng nhập" }).click();
  await p.waitForURL(/\/c\/new$/);
}
async function openDm(p, peer) {
  await p.getByRole("searchbox", { name: "Tìm hội thoại, người, nhóm" }).fill(peer.split(" ")[0]);
  await p.getByRole("button", { name: `Nhắn tin với ${peer}` }).click();
  await expect(p.getByRole("heading", { level: 1, name: peer })).toBeVisible();
  await p.getByRole("searchbox", { name: "Tìm hội thoại, người, nhóm" }).fill("");
}
async function step(id, title, fn) {
  const t0 = Date.now();
  try {
    await fn();
    log.push({ id, title, ok: true, ms: Date.now() - t0 });
    console.log("PASS", id, title);
  } catch (e) {
    log.push({ id, title, ok: false, err: String(e.message).split("\n")[0].slice(0, 300) });
    console.log("FAIL", id, title, String(e.message).split("\n")[0]);
    await snap(A, `${id}-FAIL-A`).catch(() => {});
    await snap(B, `${id}-FAIL-B`).catch(() => {});
  }
}

await step("01", "Julian & Thomas đăng nhập evolu; sidebar có nhóm Evolu team", async () => {
  await login(A, "julian.bui");
  await login(B, "thomas.tran");
  await expect(roomLink(A, "Evolu team")).toBeVisible();
  await expect(roomLink(B, "Evolu team")).toBeVisible();
  await snap(A, "01-A-julian-sidebar");
  await snap(B, "01-B-thomas-sidebar");
});

const m1 = `Chào Thomas, test realtime ${stamp}`;
await step("02", "Julian tìm Thomas → mở DM → gửi tin; Thomas thấy huy hiệu chưa đọc (không reload)", async () => {
  await openDm(A, T);
  await say(A, T, m1);
  await snap(A, "02-A-julian-sent-dm");
  await expect(roomLink(B, J).getByTestId("unread-badge")).toBeVisible({ timeout: 10_000 });
  await expect(B.getByTestId("unread-total")).toBeVisible();
  await snap(B, "02-B-thomas-unread-badge");
});

await step("03", "Thomas mở DM thấy tin; Julian thấy 'Đã xem'", async () => {
  await roomLink(B, J).click();
  await expect(roomLog(B).getByRole("article").filter({ hasText: m1 })).toBeVisible();
  await snap(B, "03-B-thomas-reads-dm");
  await expect(A.getByRole("status").filter({ hasText: "Đã xem" })).toBeVisible({ timeout: 10_000 });
  await snap(A, "03-A-julian-seen");
});

const m2 = `Ok anh Julian, nhận được rồi ${stamp}`;
await step("04", "Thomas trả lời → Julian nhận realtime", async () => {
  await say(B, J, m2);
  await expect(roomLog(A).getByRole("article").filter({ hasText: m2 })).toBeVisible({ timeout: 10_000 });
  await snap(A, "04-A-julian-receives-reply");
});

const m3 = `Chào cả team Evolu ${stamp}`;
await step("05", "Julian nhắn nhóm Evolu team → Thomas thấy huy hiệu, mở nhóm thấy tên người gửi", async () => {
  await roomLink(A, "Evolu team").click();
  await say(A, "Evolu team", m3);
  await expect(roomLink(B, "Evolu team").getByTestId("unread-badge")).toBeVisible({ timeout: 10_000 });
  await snap(B, "05-B-thomas-group-badge");
  await roomLink(B, "Evolu team").click();
  const art = roomLog(B).getByRole("article").filter({ hasText: m3 });
  await expect(art).toBeVisible();
  await expect(art).toContainText(J);
  await snap(B, "05-B-thomas-group-message");
});

await step("06", "Julian tạo nhóm mới (Thomas + Vio) → Thomas thấy nhóm xuất hiện", async () => {
  await A.getByRole("button", { name: "Nhóm mới" }).click();
  const dlg = A.getByRole("dialog", { name: "Tạo nhóm" });
  await dlg.getByRole("textbox", { name: "Tên nhóm" }).fill(GROUP);
  for (const [q, n] of [["Thomas", T], ["Vio", V]]) {
    await dlg.getByRole("searchbox", { name: "Tìm người trong công ty" }).fill(q);
    await dlg.getByRole("checkbox", { name: n }).check();
  }
  await snap(A, "06-A-create-group-dialog");
  await dlg.getByRole("button", { name: "Tạo nhóm" }).click();
  await expect(A.getByRole("heading", { level: 1, name: GROUP })).toBeVisible();
  await say(A, GROUP, `Mở nhóm ${stamp}`);
  await expect(roomLink(B, GROUP)).toBeVisible({ timeout: 10_000 });
  await snap(A, "06-A-group-created");
  await snap(B, "06-B-thomas-sees-new-group");
});

await step("07", "Julian (chủ) thêm Rowan vào nhóm; xem danh sách thành viên", async () => {
  await A.getByRole("button", { name: "Thêm người" }).click();
  const add = A.getByRole("dialog", { name: "Thêm người vào nhóm" });
  await add.getByRole("searchbox", { name: "Tìm người trong công ty" }).fill("Rowan");
  await add.getByRole("checkbox", { name: R }).check();
  await snap(A, "07-A-add-member-dialog");
  await add.getByRole("button", { name: "Thêm" }).click();
  await expect(add).toBeHidden();
  await A.getByRole("button", { name: /^Thành viên \(\d+\)$/ }).click();
  const mem = A.getByRole("dialog", { name: "Thành viên" });
  await expect(mem.getByRole("listitem").filter({ hasText: R })).toBeVisible();
  await snap(A, "07-A-members-list");
  await A.keyboard.press("Escape");
});

await step("08", "Thomas (thành viên) không có Đổi tên/Xoá; Julian đổi tên → Thomas thấy tên mới", async () => {
  await roomLink(B, GROUP).click();
  await expect(B.getByRole("button", { name: "Thêm người" })).toHaveCount(0);
  await opts(B).click();
  await expect(B.getByRole("menuitem", { name: "Đổi tên nhóm" })).toHaveCount(0);
  await expect(B.getByRole("menuitem", { name: "Xoá nhóm" })).toHaveCount(0);
  await snap(B, "08-B-member-menu");
  await B.keyboard.press("Escape");
  await opts(A).click();
  await A.getByRole("menuitem", { name: "Đổi tên nhóm" }).click();
  const rn = A.getByRole("dialog", { name: "Đổi tên nhóm" });
  await rn.getByRole("textbox", { name: "Tên nhóm" }).fill(GROUP2);
  await rn.getByRole("button", { name: "Lưu" }).click();
  await expect(B.getByRole("heading", { level: 1, name: GROUP2 })).toBeVisible({ timeout: 10_000 });
  await snap(B, "08-B-sees-renamed");
});

await step("09", "Julian ẩn DM Thomas → Thomas nhắn → DM hiện lại ở Julian", async () => {
  await roomLink(A, T).click();
  await A.getByRole("button", { name: "Ẩn hội thoại" }).click();
  await expect(roomLink(A, T)).toHaveCount(0);
  await snap(A, "09-A-dm-hidden");
  await roomLink(B, J).click();
  await say(B, J, `Anh ơi xem lại DM ${stamp}`);
  await expect(roomLink(A, T)).toBeVisible({ timeout: 10_000 });
  await snap(A, "09-A-dm-unhidden");
});

const m4 = `Tin gửi lúc Thomas mất mạng ${stamp}`;
await step("10", "Thomas mất mạng → Julian gửi → Thomas có mạng lại thì nhận bù tin", async () => {
  await ctxB.setOffline(true);
  await B.waitForTimeout(1500);
  await snap(B, "10-B-offline-banner");
  await roomLink(A, T).click();
  await say(A, T, m4);
  await ctxB.setOffline(false);
  await expect(roomLog(B).getByRole("article").filter({ hasText: m4 })).toBeVisible({ timeout: 30_000 });
  await snap(B, "10-B-back-online-catchup");
});

await step("11", "Thomas mở DM với Vio qua tìm người", async () => {
  await openDm(B, V);
  await say(B, V, `Chào Vio ${stamp}`);
  await snap(B, "11-B-dm-with-vio");
});

await step("12", "Julian xoá nhóm khi Thomas đang mở → Thomas bị đưa ra kèm thông báo", async () => {
  await roomLink(B, GROUP2).click();
  await expect(B.getByRole("heading", { level: 1, name: GROUP2 })).toBeVisible();
  await roomLink(A, GROUP2).click();
  await opts(A).click();
  await A.getByRole("menuitem", { name: "Xoá nhóm" }).click();
  await snap(A, "12-A-delete-confirm");
  await A.getByRole("alertdialog", { name: "Xoá nhóm?" }).getByRole("button", { name: "Xoá" }).click();
  await expect(B).toHaveURL(/\/c\/new$/, { timeout: 10_000 });
  await expect(B.getByRole("status").first()).toBeVisible();
  await snap(B, "12-B-bounced-toast");
  await expect(roomLink(A, GROUP2)).toHaveCount(0);
});

await step("13", "Giao diện điện thoại (390px) — Thomas", async () => {
  await B.setViewportSize({ width: 390, height: 844 });
  await B.goto(`${BASE}/c/new`);
  await B.getByRole("button", { name: "Danh sách hội thoại" }).click();
  await B.waitForTimeout(500);
  await snap(B, "13-B-mobile-sidebar");
  await roomLink(B, "Evolu team").click();
  await B.waitForTimeout(800);
  await snap(B, "13-B-mobile-group");
});

writeFileSync(`${OUT}/result.json`, JSON.stringify(log, null, 2));
await b.close();
const fail = log.filter((x) => !x.ok).length;
console.log(`DONE ${log.length - fail}/${log.length} pass`);
