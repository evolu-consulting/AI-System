// CHAT-AC-41 · CHAT-AC-42 · CHAT-AC-43 · CHAT-AC-44 · e2e X2a — nhóm (test-plan X2a §6 E04–E06; plan-frontend-e2e §1 "Tạo nhóm",
// "Thêm người", "Thành viên", "Xác nhận"). A = lan "Lan Tran" (chủ), B = thu "Thu Ha".
import { expect, type Page, test } from "@playwright/test";
import {
  apiGroup,
  apiSay,
  chatLogin,
  NAMES,
  QE,
  roomLink,
  roomLog,
  roomOptions,
  token,
  twoUsers,
  USER_ID,
  uniq,
} from "./_x2a-support";

async function pick(dialog: ReturnType<Page["getByRole"]>, q: string, name: string): Promise<void> {
  await dialog.getByRole("searchbox", { name: "Tìm người trong công ty" }).fill(q);
  await dialog.getByRole("checkbox", { name }).check();
}

test('CHAT-AC-41 · E04 · "Nhóm mới" ⇒ dialog "Tạo nhóm"; "Tạo nhóm" disabled khi tên rỗng; tên + 2 người ⇒ vào phòng, "chủ nhóm"; nhóm 49 + thêm 2 ⇒ "Nhóm đã đủ 50 người"', async ({
  page,
}) => {
  await chatLogin(page, "lan");
  await page.getByRole("button", { name: "Nhóm mới" }).click();
  const dlg = page.getByRole("dialog", { name: "Tạo nhóm" });
  await expect(dlg).toBeVisible();
  const create = dlg.getByRole("button", { name: "Tạo nhóm" });
  await expect(create).toBeDisabled();
  const name = uniq("E04 Nhóm");
  await dlg.getByRole("textbox", { name: "Tên nhóm" }).fill(name);
  await pick(dlg, "Thu", NAMES.thu);
  await pick(dlg, "An", NAMES.an);
  await expect(dlg.getByRole("status").filter({ hasText: "3 / 50" })).toBeVisible();
  await create.click();
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText(/chủ nhóm/).first()).toBeVisible();
  // nhóm 49 (A + 48) dựng qua API; thêm Thu + An qua UI ⇒ đủ 50 + 1
  const g49 = await apiGroup(
    await token("lan"),
    uniq("E04 49"),
    QE.map((q) => q.id),
  );
  await page.goto(`/rooms/${g49}`);
  await page.getByRole("button", { name: "Thêm người" }).click();
  const add = page.getByRole("dialog", { name: "Thêm người vào nhóm" });
  await pick(add, "Thu", NAMES.thu);
  await pick(add, "An", NAMES.an);
  await add.getByRole("button", { name: "Thêm" }).click();
  await expect(page.getByText("Nhóm đã đủ 50 người").first()).toBeVisible();
});

test('CHAT-AC-42 · CHAT-AC-44 · E05 · chủ thêm/bớt/đổi tên; B không thấy "Thêm người", không menuitem "Đổi tên nhóm"/"Xoá nhóm"; người mới thêm thấy tin đầu', async ({
  browser,
}) => {
  const a = await token("lan");
  const name = uniq("E05");
  const g = await apiGroup(a, name, [USER_ID.thu]);
  const firstMsg = uniq("E05 tin đầu tiên");
  await apiSay(a, g, firstMsg);
  const u = await twoUsers(browser);
  try {
    await u.pb.goto(`/rooms/${g}`);
    await expect(u.pb.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(u.pb.getByRole("button", { name: "Thêm người" })).toHaveCount(0);
    await roomOptions(u.pb).click();
    await expect(u.pb.getByRole("menuitem", { name: "Đổi tên nhóm" })).toHaveCount(0);
    await expect(u.pb.getByRole("menuitem", { name: "Xoá nhóm" })).toHaveCount(0);
    await expect(u.pb.getByRole("menuitem", { name: "Rời nhóm" })).toBeVisible();
    await u.pb.keyboard.press("Escape");

    await u.pa.goto(`/rooms/${g}`);
    await u.pa.getByRole("button", { name: "Thêm người" }).click();
    const add = u.pa.getByRole("dialog", { name: "Thêm người vào nhóm" });
    await pick(add, "An", NAMES.an);
    await expect(add.getByRole("checkbox", { name: NAMES.thu })).toBeDisabled();
    await add.getByRole("button", { name: "Thêm" }).click();
    await expect(add).toBeHidden();

    const ctx = await browser.newContext();
    const pc = await ctx.newPage();
    await chatLogin(pc, "an");
    await pc.goto(`/rooms/${g}`);
    await expect(roomLog(pc).getByRole("article").filter({ hasText: firstMsg })).toBeVisible();
    await ctx.close();

    await u.pa.getByRole("button", { name: /^Thành viên \(\d+\)$/ }).click();
    const mem = u.pa.getByRole("dialog", { name: "Thành viên" });
    await mem.getByRole("button", { name: `Tuỳ chọn của ${NAMES.an}` }).click();
    await u.pa.getByRole("menuitem", { name: "Bớt khỏi nhóm" }).click();
    await u.pa
      .getByRole("alertdialog", { name: "Bớt khỏi nhóm?" })
      .getByRole("button", { name: "Bớt" })
      .click();
    await expect(mem.getByRole("listitem").filter({ hasText: NAMES.an })).toHaveCount(0);
    await u.pa.keyboard.press("Escape");

    const renamed = uniq("E05 đổi tên");
    await roomOptions(u.pa).click();
    await u.pa.getByRole("menuitem", { name: "Đổi tên nhóm" }).click();
    const rn = u.pa.getByRole("dialog", { name: "Đổi tên nhóm" });
    await rn.getByRole("textbox", { name: "Tên nhóm" }).fill(renamed);
    await rn.getByRole("button", { name: "Lưu" }).click();
    await expect(u.pa.getByRole("heading", { level: 1, name: renamed })).toBeVisible();
    await expect(u.pb.getByRole("heading", { level: 1, name: renamed })).toBeVisible({
      timeout: 5_000,
    });
  } finally {
    await u.close();
  }
});

test('CHAT-AC-43 · E06 · B "Rời nhóm" ⇒ alertdialog "Rời nhóm?" ⇒ phòng mất khỏi sidebar; chủ rời khi còn người ⇒ "Chuyển quyền chủ nhóm trước khi rời"; chuyển rồi rời được', async ({
  browser,
}) => {
  const a = await token("lan");
  const name = uniq("E06");
  const g = await apiGroup(a, name, [USER_ID.thu, USER_ID.an]);
  await apiSay(a, g, uniq("E06 mồi"));
  const u = await twoUsers(browser);
  try {
    await u.pb.goto(`/rooms/${g}`);
    await roomOptions(u.pb).click();
    await u.pb.getByRole("menuitem", { name: "Rời nhóm" }).click();
    await u.pb
      .getByRole("alertdialog", { name: "Rời nhóm?" })
      .getByRole("button", { name: "Rời nhóm" })
      .click();
    await expect(roomLink(u.pb, name)).toHaveCount(0);

    await u.pa.goto(`/rooms/${g}`);
    await roomOptions(u.pa).click();
    await u.pa.getByRole("menuitem", { name: "Rời nhóm" }).click();
    const must = u.pa.getByRole("alertdialog", { name: "Chuyển quyền chủ nhóm trước khi rời" });
    await expect(must).toBeVisible();
    await must.getByRole("button", { name: "Mở danh sách thành viên" }).click();
    const mem = u.pa.getByRole("dialog", { name: "Thành viên" });
    await mem.getByRole("button", { name: `Tuỳ chọn của ${NAMES.an}` }).click();
    await u.pa.getByRole("menuitem", { name: "Chuyển quyền chủ nhóm" }).click();
    await u.pa
      .getByRole("alertdialog", { name: "Chuyển quyền chủ nhóm?" })
      .getByRole("button", { name: "Chuyển quyền" })
      .click();
    await expect(mem.getByRole("listitem").filter({ hasText: NAMES.an })).toContainText("Chủ nhóm");
    await u.pa.keyboard.press("Escape");
    await roomOptions(u.pa).click();
    await u.pa.getByRole("menuitem", { name: "Rời nhóm" }).click();
    await u.pa
      .getByRole("alertdialog", { name: "Rời nhóm?" })
      .getByRole("button", { name: "Rời nhóm" })
      .click();
    await expect(roomLink(u.pa, name)).toHaveCount(0);
  } finally {
    await u.close();
  }
});
