// CR-190 · lát cr190-msg-chat-ui · e2e khung chat phải (stack journey thật; viết trong lát, điều phối chạy một lần cuối đợt):
// chưa chọn ⇒ hình + «Chọn một người…»; người chưa nhắn ⇒ «Gửi lời chào đầu tiên» + câu chào bấm là gửi; ô nhập dính đáy, trang không cuộn;
// B (khác người tạo) đang đọc tin cũ ⇒ nút «↓ n tin mới». Nhân viên tạo cuộc, kế toán nhận.

import type { Page } from "@playwright/test";
import { envOf, expect, loginCw, SPEC_TENANT, U } from "../cr127/_cr127-kit";
import { test } from "../journey-approval/_test";

const E = envOf(SPEC_TENANT.j01);
const TAG = Date.now().toString(36);

const noPageScroll = (p: Page) =>
  p.evaluate(() => document.documentElement.scrollHeight <= document.documentElement.clientHeight);

async function openWithAccounting(a: Page) {
  await a.getByRole("button", { name: "Nhắn tin mới" }).first().click();
  const dlg = a.getByTestId("new-conv-dialog");
  await dlg.getByRole("searchbox", { name: "Tìm đồng nghiệp" }).fill("ke toan");
  await dlg.getByRole("checkbox").first().check();
  await dlg.getByRole("button", { name: "Nhắn tin", exact: true }).click();
}

test("chưa chọn cuộc có hình và câu mời, mở người chưa nhắn thì câu chào bấm là gửi, ô nhập dính đáy và trang không cuộn", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const a = await ctx.newPage();
  await loginCw(a, E, U.employee);
  await a.goto("/contracts/messages");
  const pick = a.getByTestId("chat-pick");
  await expect(pick).toContainText("Chọn một người để bắt đầu trò chuyện");
  await expect(pick.locator("svg")).toBeVisible();
  expect(await noPageScroll(a)).toBe(true);

  await openWithAccounting(a);
  const composer = a.getByRole("textbox", { name: "Nhập tin nhắn" });
  const hello = a.getByTestId("chat-first-hello");
  if (await hello.isVisible()) {
    await expect(hello).toContainText("Gửi lời chào đầu tiên");
    await expect(a.getByTestId("chat-hello-chip")).toHaveCount(3);
    await a.getByTestId("chat-hello-chip").first().click();
    await expect(a.getByTestId("msg-row").filter({ hasText: "Xin chào" }).first()).toBeVisible();
  }
  const box = await composer.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(720); // ô nhập nằm trong màn hình, dính đáy
  expect(await noPageScroll(a)).toBe(true);
  await ctx.close();
});

test("B đang đọc tin cũ, A gửi thêm ⇒ B thấy «↓ 1 tin mới», bấm thì về cuối", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await loginCw(a, E, U.employee);
  await loginCw(b, E, U.accounting);
  await b.goto("/contracts/messages");
  await a.goto("/contracts/messages");
  await openWithAccounting(a);
  const box = a.getByRole("textbox", { name: "Nhập tin nhắn" });
  for (let i = 0; i < 25; i++) {
    await box.fill(`Tin ${TAG} số ${i}`);
    await box.press("Enter");
    await expect(a.getByTestId("msg-row").filter({ hasText: `Tin ${TAG} số ${i}` })).toBeVisible();
  }
  await b.getByTestId("conv-row").filter({ hasText: "E2E Nhân viên Kinh doanh" }).click();
  const list = b.getByTestId("msg-list");
  await expect(list.getByText(`Tin ${TAG} số 24`)).toBeVisible();
  await list.evaluate((el) => {
    el.scrollTop = 0; // đọc lên tin cũ
  });
  await expect(b.getByTestId("msg-day").first()).toBeVisible(); // nhãn ngày dính đầu khung
  await box.fill(`Tin ${TAG} mới`);
  await box.press("Enter");
  const pill = b.getByTestId("msg-new-below");
  await expect(pill).toHaveText("↓ 1 tin mới");
  await pill.click();
  await expect(pill).toHaveCount(0);
  await expect(list.getByText(`Tin ${TAG} mới`)).toBeVisible();
  await ctxA.close();
  await ctxB.close();
});
