// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// e2e-journey-approval · auth-refresh-reload · TẢI LẠI TRANG (F5) khi `POST /auth/refresh` lúc khởi động SPA còn dở KHÔNG được đăng xuất người dùng.
// Máy chủ đã xoay token nhưng phản hồi mang Set-Cookie bị trình duyệt huỷ ⇒ lượt refresh kế tiếp trình token cũ. Phải được cấp lại (ân hạn ≤ 30 s).
// Stack thật (admin-api + workspace-web), không mock: lỗi chỉ lộ khi phản hồi thật bị mất, nên ca 1 mô phỏng đúng việc đó bằng route.fetch (máy chủ
// xử lý thật) + abort (trình duyệt không nhận phản hồi) rồi trả cookie cũ về — đúng trạng thái sau khi huỷ phản hồi.
import type { Page } from "@playwright/test";
import { type Env, loginCw, U } from "./_journey";
import { expect, test } from "./_test";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
const E: Env = {
  cw: need("JA_CW_URL"),
  admin: need("JA_ADMIN_URL"),
  tenantKey: "e2e-approval",
  tenantName: "E2E Approval Journey",
  pw: need("JA_USER_PW"),
  adminUser: need("SEED_ADMIN_USERNAME"),
  adminPw: need("SEED_ADMIN_PASSWORD"),
};
const isRefresh = (url: string): boolean => new URL(url).pathname.endsWith("/auth/refresh");
const stillSignedIn = async (page: Page): Promise<void> => {
  const done = page.waitForResponse((r) => isRefresh(r.url()), { timeout: 30_000 });
  await page.reload();
  expect((await done).status(), "refresh sau tải lại phải 200, không phải 401").toBe(200);
  await expect(page).not.toHaveURL(/\/login/);
};

test("1 · phản hồi refresh bị huỷ lúc tải lại ⇒ lần tải sau vẫn đăng nhập (token cũ được cấp lại trong ân hạn)", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginCw(page, E, U.employee);
  const before = await ctx.cookies();

  let served!: () => void;
  const swallowed = new Promise<void>((r) => {
    served = r;
  });
  await page.route(
    (u) => isRefresh(u.toString()),
    async (route) => {
      await route.fetch(); // máy chủ xoay token thật…
      await route.abort("failed"); // …nhưng trình duyệt không bao giờ nhận Set-Cookie
      served();
    },
    { times: 1 },
  );
  await page.reload({ waitUntil: "commit" }).catch(() => {});
  await swallowed;
  await page.unroute(() => true);
  await ctx.clearCookies();
  await ctx.addCookies(before); // trình duyệt vẫn giữ cookie cũ (đã bị xoay phía máy chủ)

  await stillSignedIn(page);
  await ctx.close();
});

test("2 · tải lại liên tiếp ngay khi refresh vừa gửi đi (3 lần) ⇒ không bị đăng xuất", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loginCw(page, E, U.employee);
  for (let i = 0; i < 3; i++) {
    const sent = page.waitForRequest((r) => isRefresh(r.url()), { timeout: 30_000 });
    await page.reload({ waitUntil: "commit" }).catch(() => {});
    await sent;
    await page.reload({ waitUntil: "commit" }).catch(() => {}); // tải lại khi lượt refresh vừa rồi có thể chưa xong
  }
  await stillSignedIn(page);
  await ctx.close();
});
