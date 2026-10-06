// X1-AC01, AC02 (combine) · S4 mock · HUB-FR-10/11/12: menu `/` theo quyền thật của Hub, chạy lệnh qua Dify mock, gợi ý khi gõ sai,
// thiếu tham số (test-plan §4). `lan` ∈ group ke-toan (grant feature x1-demo); `an` không thuộc group nào.
import { expect, test } from "@playwright/test";
import { chatLog, chatLogin, composer, difyRuns, MOCK_TEXT, sendChat } from "./_support";

test("X1-AC01 · lan gõ '/': thấy /mock-send và /mock-dich; an (không trong ke-toan) không thấy", async ({
  browser,
}) => {
  const lanCtx = await browser.newContext({ locale: "vi-VN" });
  const lan = await lanCtx.newPage();
  await chatLogin(lan, "lan");
  await composer(lan).fill("/");
  const menu = lan.getByRole("listbox", { name: "Lệnh" });
  await expect(menu.getByRole("option", { name: /^\/mock-send/ })).toBeVisible();
  await expect(menu.getByRole("option", { name: /^\/mock-dich/ })).toBeVisible();
  await lanCtx.close();

  const anCtx = await browser.newContext({ locale: "vi-VN" });
  const an = await anCtx.newPage();
  await chatLogin(an, "an");
  await composer(an).fill("/");
  await expect(an.getByRole("listbox", { name: "Lệnh" })).toBeVisible();
  await expect(an.getByRole("option", { name: /^\/mock-/ })).toHaveCount(0);
  await anCtx.close();
});

test("X1-AC02 · lan: '/mock-dich en hi' ⇒ kết quả của Dify mock; '/mock-dic' ⇒ gợi ý '/mock-dich'; '/mock-send' thiếu arg ⇒ alert", async ({
  page,
}) => {
  const base = (await difyRuns()).length;
  await chatLogin(page, "lan");
  await sendChat(page, "/mock-dich en hi");
  await expect(chatLog(page)).toContainText(MOCK_TEXT, { timeout: 20_000 });
  const calls = (await difyRuns()).slice(base);
  expect(calls).toHaveLength(1);
  expect(JSON.stringify((calls[0]?.body as { inputs?: unknown })?.inputs)).toContain("hi");

  await page.goto("/c/new");
  await sendChat(page, "/mock-dic en hi");
  const notFound = page.getByRole("alert").filter({ hasText: "Không có lệnh /mock-dic." });
  await expect(notFound).toBeVisible();
  await expect(notFound.getByRole("button", { name: "/mock-dich", exact: true })).toBeVisible();

  await page.goto("/c/new");
  await sendChat(page, "/mock-send ");
  await expect(
    page.getByRole("alert").filter({ hasText: "Lệnh /mock-send thiếu: text." }),
  ).toBeVisible();
});
