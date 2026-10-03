/// <reference lib="dom" />
// CHAT-AC-24..27, 30 · thẻ lỗi theo mã, Báo admin, Thử lại, không lộ nội bộ (test-plan §6 E-R1…R5).
import { expect, type Page, test } from "@playwright/test";
import {
  log,
  login,
  nextSend,
  nextSendResponse,
  openConversation,
  resetMock,
  sendMain,
} from "./_support";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.beforeEach(async ({ page }) => {
  await resetMock();
  await login(page);
});

const card = (page: Page) => log(page).getByRole("article").last().getByRole("alert");

test("CHAT-AC-24 · ALL_PROVIDERS_EXHAUSTED: tiêu đề, câu, Thử lại, Báo admin, dòng mã + run [E-R1]", async ({
  page,
}) => {
  await sendMain(page, "#scn:err-exhausted x");
  const c = card(page);
  await expect(c).toContainText("Hệ thống đang quá tải");
  await expect(c).toContainText("AI tạm hết lượt dùng. Hãy thử lại sau ít phút.");
  await expect(c.getByRole("button", { name: "Thử lại" })).toBeVisible();
  await expect(c.getByRole("button", { name: "Báo admin" })).toBeVisible();
  await expect(c).toContainText(/ALL_PROVIDERS_EXHAUSTED · run [0-9a-f-]{36}/);
});

test("CHAT-AC-25 · Báo admin chép 'MÃ · run id'; Thử lại gửi lại cùng nội dung, run mới [E-R2]", async ({
  page,
}) => {
  const first = nextSendResponse(page);
  await sendMain(page, "#scn:err-exhausted x");
  const oldRun = (await first).headers()["x-run-id"];
  const c = card(page);
  await c.getByRole("button", { name: "Báo admin" }).click();
  const shown = (await c.innerText()).match(/ALL_PROVIDERS_EXHAUSTED · run [0-9a-f-]{36}/)?.[0];
  expect(shown).toBeTruthy();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(shown);
  const body = nextSend(page);
  const second = nextSendResponse(page);
  await c.getByRole("button", { name: "Thử lại" }).click();
  expect((await body).content).toBe("#scn:err-exhausted x");
  expect((await second).headers()["x-run-id"]).not.toBe(oldRun);
});

test("CHAT-AC-26 · TIMEOUT: 'Hệ thống xử lý quá lâu' + Thử lại, cả khi tải lại và ở seed [E-R3]", async ({
  page,
}) => {
  await sendMain(page, "#scn:err-timeout x");
  await expect(card(page)).toContainText("Hệ thống xử lý quá lâu");
  await expect(card(page).getByRole("button", { name: "Thử lại" })).toBeVisible();
  await page.reload();
  await expect(card(page)).toContainText("Hệ thống xử lý quá lâu");
  await page.goto("/c/new");
  await openConversation(page, "Tóm tắt họp giao ban");
  await expect(card(page)).toContainText("Hệ thống xử lý quá lâu");
  await expect(card(page).getByRole("button", { name: "Thử lại" })).toBeVisible();
});

test("CHAT-AC-27 · UPSTREAM_ERROR: 'Dịch vụ AI đang gặp sự cố' + Thử lại [E-R4]", async ({
  page,
}) => {
  await sendMain(page, "#scn:err-upstream x");
  await expect(card(page)).toContainText("Dịch vụ AI đang gặp sự cố");
  await expect(card(page).getByRole("button", { name: "Thử lại" })).toBeVisible();
});

test("CHAT-AC-30 · thẻ lỗi không lộ agent/provider/stack trace [E-R5]", async ({ page }) => {
  const banned = /agent|provider|claude|anthropic|openai|gpt|gemini|stack|at \S+ \(/i;
  for (const scn of ["err-exhausted", "err-timeout", "err-upstream"]) {
    await sendMain(page, `#scn:${scn} x`);
    await expect(card(page)).toBeVisible();
    const text = (await card(page).innerText()).replace(/ALL_PROVIDERS_EXHAUSTED/g, "");
    expect(text, scn).not.toMatch(banned);
    await page.goto("/c/new");
  }
});
