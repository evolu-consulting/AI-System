/// <reference lib="dom" />
// CHAT-AC-36 · đổi ngôn ngữ; CHAT-AC-35 (theme) · Sáng/Tối/Theo hệ thống (test-plan §6 E-I1, E-T1/T2 theme).
import { expect, test } from "@playwright/test";
import { login, openSettings, resetMock } from "./_support";

test.beforeEach(async () => {
  await resetMock();
});

test("CHAT-AC-36 · chọn English: lời chào tiếng Anh, không lộ chuỗi dạng key [E-I1]", async ({
  page,
}) => {
  await login(page);
  const dlg = await openSettings(page);
  await dlg.getByRole("radio", { name: "English" }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Hi Minh, what do you need today?" }),
  ).toBeVisible();
  const text = await page.getByRole("main").innerText();
  expect(text).not.toMatch(
    /\b(?:chat|common|errors?|login|sidebar|welcome|composer|settings|toast|steps|flow)\.[a-zA-Z.]+/,
  );
});

const BODY_BG = () => getComputedStyle(document.body).backgroundColor;

test("CHAT-AC-35 · theme T1: Tối đặt class dark + nền body rgb(15, 16, 32) (CR-049 #0F1020), nhớ sau tải lại, theo hệ thống [E-T1-theme]", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await login(page);
  const dlg = await openSettings(page);
  await dlg
    .getByRole("radiogroup", { name: "Giao diện" })
    .getByRole("radio", { name: "Tối" })
    .click();
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
  expect(await page.evaluate(BODY_BG)).toBe("rgb(15, 16, 32)");
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
  const dlg2 = await openSettings(page);
  await dlg2.getByRole("radio", { name: "Theo hệ thống" }).click();
  await expect(page.locator("html")).not.toHaveClass(/(^|\s)dark(\s|$)/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/(^|\s)dark(\s|$)/);
});

test("CHAT-AC-35 · theme T2: không nháy — html.dark có trước khi React gắn nội dung; localStorage ném lỗi vẫn hiện trang [E-T2-theme]", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("ai-chat-theme", "dark");
    const w = window as unknown as { __darkAtMount?: boolean };
    new MutationObserver(() => {
      const root = document.getElementById("root");
      if (w.__darkAtMount === undefined && root && root.childElementCount > 0) {
        w.__darkAtMount = document.documentElement.classList.contains("dark");
      }
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Đăng nhập" })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { __darkAtMount?: boolean }).__darkAtMount),
  ).toBe(true);
});

test("CHAT-AC-35 · theme T2b: localStorage ném lỗi — trang đăng nhập vẫn hiện [E-T2-theme]", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const boom = (): never => {
      throw new Error("blocked");
    };
    Storage.prototype.getItem = boom;
    Storage.prototype.setItem = boom;
  });
  await page.goto("/login");
  // [CR-052] localStorage bị chặn → không đọc được lựa chọn VI → mặc định EN ("Sign in").
  await expect(page.getByRole("button", { name: /^(Sign in|Đăng nhập)$/ })).toBeVisible();
});
