// CHAT-AC-37 · CHAT-AC-38 · CHAT-AC-39 · CHAT-AC-45 · X2a-AC05 · X2a-AC06 · X2a-AC09 · e2e X2a — DM, realtime, 404, ẩn
// (test-plan X2a §6 E02, E03, E07, E09, E12; plan-frontend-e2e §1). A = lan "Lan Tran", B = thu "Thu Ha" (2 context).
import { expect, test } from "@playwright/test";
import {
  apiDm,
  apiGroup,
  apiSay,
  badgeOf,
  chatLogin,
  NAMES,
  roomLink,
  roomLog,
  roomsRegion,
  search,
  sendInRoom,
  token,
  twoUsers,
  USER_ID,
  uniq,
} from "./_x2a-support";

test('CHAT-AC-37 · CHAT-AC-38 · E02 · A tìm "Thu" ⇒ button "Nhắn tin với Thu Ha" ⇒ /rooms/:id; lần 2 cùng id; DM có "Ẩn hội thoại", không đổi tên/thêm/xoá/rời', async ({
  page,
}) => {
  await chatLogin(page, "lan");
  await search(page).fill("Thu");
  await page.getByRole("button", { name: `Nhắn tin với ${NAMES.thu}` }).click();
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}$/);
  const first = page.url();
  await expect(page.getByRole("heading", { level: 1, name: NAMES.thu })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ẩn hội thoại" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Thêm người" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tuỳ chọn phòng" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Đổi tên nhóm" })).toHaveCount(0);
  await page.goto("/c/new");
  await search(page).fill("Thu");
  await page.getByRole("button", { name: `Nhắn tin với ${NAMES.thu}` }).click();
  await expect(page).toHaveURL(first);
});

test('CHAT-AC-39 · X2a-AC09 · E03 · A gửi ⇒ B thấy tin ≤ 2 s + unread-badge=1, unread-total; B mở ⇒ 0; A thấy status "Đã xem"', async ({
  browser,
}) => {
  const a = await token("lan");
  const dm = await apiDm(a, USER_ID.thu);
  await apiSay(a, dm, uniq("E03 mồi"));
  const u = await twoUsers(browser);
  try {
    const bTok = await token("thu");
    await apiSay(bTok, dm, uniq("E03 B đọc hết"));
    await u.pa.goto(`/rooms/${dm}`);
    await expect(roomLink(u.pb, NAMES.lan)).toBeVisible();
    const text = uniq("E03 tin realtime");
    await sendInRoom(u.pa, NAMES.thu, text);
    await expect(badgeOf(u.pb, NAMES.lan)).toHaveText("1", { timeout: 2_000 });
    await expect(u.pb.getByTestId("unread-total")).toBeVisible();
    await roomLink(u.pb, NAMES.lan).click();
    await expect(roomLog(u.pb).getByRole("article").filter({ hasText: text })).toBeVisible();
    await expect(badgeOf(u.pb, NAMES.lan)).toHaveCount(0);
    await expect(u.pa.getByRole("status").filter({ hasText: "Đã xem" })).toBeVisible({
      timeout: 5_000,
    });
  } finally {
    await u.close();
  }
});

test('CHAT-AC-45 · E07 · /rooms/<uuid lạ> và phòng của người khác ⇒ heading "Không tìm thấy cuộc trò chuyện" giống nhau', async ({
  page,
}) => {
  const other = await apiGroup(await token("thu"), uniq("E07 của Thu"), [USER_ID.an]);
  await chatLogin(page, "lan");
  await page.goto("/rooms/a2e0ffff-0000-4000-8000-00000000ffff");
  const nf = page.getByRole("heading", { name: "Không tìm thấy cuộc trò chuyện" });
  await expect(nf).toBeVisible();
  const unknownText = await page.getByRole("main").innerText();
  await page.goto(`/rooms/${other}`);
  await expect(nf).toBeVisible();
  expect(await page.getByRole("main").innerText()).toBe(unknownText);
  await expect(page.getByRole("link", { name: "Về trang chào" })).toBeVisible();
});

test("X2a-AC06 · E09 · A ẩn DM ⇒ mất khỏi sidebar; B gửi ⇒ DM hiện lại + badge", async ({
  browser,
}) => {
  const a = await token("lan");
  const dm = await apiDm(a, USER_ID.an);
  await apiSay(a, dm, uniq("E09 mồi"));
  const u = await twoUsers(browser, "lan", "an");
  try {
    await u.pa.goto(`/rooms/${dm}`);
    await u.pa.getByRole("button", { name: "Ẩn hội thoại" }).click();
    await expect(roomLink(u.pa, NAMES.an)).toHaveCount(0);
    await apiSay(await token("an"), dm, uniq("E09 hiện lại"));
    await expect(roomLink(u.pa, NAMES.an)).toBeVisible({ timeout: 5_000 });
    await expect(badgeOf(u.pa, NAMES.an)).toHaveText("1");
  } finally {
    await u.close();
  }
});

test("CHAT-AC-37 · X2a-AC05 · E12 · user globex (Khang Ly) không xuất hiện khi A tìm; chủ xoá nhóm ⇒ B đang mở về /c/new + toast", async ({
  browser,
}) => {
  const a = await token("lan");
  const name = uniq("E12");
  const g = await apiGroup(a, name, [USER_ID.thu]);
  const u = await twoUsers(browser);
  try {
    await search(u.pa).fill("Khang");
    await expect(roomsRegion(u.pa)).toBeVisible();
    await expect(u.pa.getByRole("button", { name: `Nhắn tin với ${NAMES.khang}` })).toHaveCount(0);
    await u.pb.goto(`/rooms/${g}`);
    await expect(u.pb.getByRole("heading", { level: 1, name })).toBeVisible();
    await u.pa.goto(`/rooms/${g}`);
    await u.pa.getByRole("button", { name: "Tuỳ chọn phòng" }).click();
    await u.pa.getByRole("menuitem", { name: "Xoá nhóm" }).click();
    const dlg = u.pa.getByRole("alertdialog", { name: "Xoá nhóm?" });
    await dlg.getByRole("button", { name: "Xoá" }).click();
    await expect(u.pb).toHaveURL(/\/c\/new$/, { timeout: 5_000 });
    await expect(u.pb.getByRole("status").first()).toBeVisible();
  } finally {
    await u.close();
  }
});
