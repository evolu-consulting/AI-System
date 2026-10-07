// X2a-AC15 · CHAT-AC-40 · e2e X2a — khung (test-plan X2a §6 E01, E10, E11; plan-frontend-e2e §1; plan-frontend D9).
// Dữ liệu dựng trong ca qua Hub thật (`_x2a-support.ts`). Không khẳng định màu/ảnh chụp.
import { expect, test } from "@playwright/test";
import {
  aiRegion,
  apiGroup,
  apiSay,
  chatLogin,
  roomComposer,
  roomLog,
  roomsRegion,
  token,
  twoUsers,
  USER_ID,
  uniq,
} from "./_x2a-support";

test('X2a-AC15 · E01 · sidebar có region "Tin nhắn & Nhóm" + "Hỏi AI"; không panel agent; composer phòng không mở listbox khi gõ @ hay /, không nút Đính kèm [CHAT-AC-40]', async ({
  page,
}) => {
  const a = await token("lan");
  const g = await apiGroup(a, uniq("E01"), [USER_ID.thu]);
  await chatLogin(page, "lan");
  await expect(roomsRegion(page)).toBeVisible();
  await expect(aiRegion(page)).toBeVisible();
  await expect(page.getByRole("link", { name: "Hỏi AI" })).toBeVisible();
  await page.goto(`/rooms/${g}`);
  const box = roomComposer(page, "nhóm");
  await expect(box).toBeVisible();
  await expect(page.getByRole("complementary", { name: /agent/i })).toHaveCount(0);
  await box.fill("@");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await box.fill("/");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Đính kèm" })).toHaveCount(0);
});

test('X2a-AC15 · E10 · A cuộn lên, B gửi tin ⇒ A thấy button "1 tin mới"; bấm ⇒ xuống đáy thấy tin mới [CHAT-AC-39]', async ({
  browser,
}) => {
  const a = await token("lan");
  const name = uniq("E10");
  const g = await apiGroup(a, name, [USER_ID.thu]);
  for (let i = 1; i <= 40; i++)
    await apiSay(a, g, `E10 tin cũ số ${i} — nội dung đủ dài để cuộn được danh sách`);
  const u = await twoUsers(browser);
  try {
    await u.pa.goto(`/rooms/${g}`);
    const log = roomLog(u.pa);
    await expect(log.getByRole("article").filter({ hasText: "E10 tin cũ số 40" })).toBeVisible();
    await log.evaluate((el) => {
      el.scrollTop = 0;
    });
    await apiSay(await token("thu"), g, "E10 tin mới của Thu");
    const pill = u.pa.getByRole("button", { name: "1 tin mới" });
    await expect(pill).toBeVisible({ timeout: 5_000 });
    await pill.click();
    await expect(
      log.getByRole("article").filter({ hasText: "E10 tin mới của Thu" }),
    ).toBeInViewport();
  } finally {
    await u.close();
  }
});

test.describe("mobile 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('X2a-AC15 · E11 · phòng toàn màn, nút "Danh sách hội thoại" mở Sheet có region "Tin nhắn & Nhóm"; không hàng chip agent [plan-frontend D9]', async ({
    page,
  }) => {
    const a = await token("lan");
    const name = uniq("E11");
    const g = await apiGroup(a, name, [USER_ID.thu]);
    await chatLogin(page, "lan");
    await page.goto(`/rooms/${g}`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(roomsRegion(page)).toBeHidden();
    await page.getByRole("button", { name: "Danh sách hội thoại" }).click();
    await expect(roomsRegion(page)).toBeVisible();
    await expect(roomsRegion(page).getByRole("link", { name, exact: true })).toBeVisible();
    await expect(page.getByRole("complementary", { name: /agent/i })).toHaveCount(0);
  });
});
