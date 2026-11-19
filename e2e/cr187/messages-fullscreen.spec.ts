// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-187 BR-187-4 · Tin nhắn toàn màn: trang không có thanh cuộn chung (document không cuộn), tên công ty dài không tràn sang khung phải.
// Cần stack như e2e/cr169 (JA_CW_URL, JA_USER_PW, SEED_ADMIN_*, tenant NitiGroup-test, người dùng Vy). VIẾT, CHƯA CHẠY (chạy cuối đợt).
import { expect, test } from "@playwright/test";
import { CO, WHO } from "../_kit/two-companies";
import { type Env, loginCw } from "../journey-approval/_journey";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt`);
  return v;
};

test("Tin nhắn: không có thanh cuộn trang, dòng hội thoại không tràn sang khung phải", async ({
  page,
}) => {
  const e: Env = {
    cw: need("JA_CW_URL"),
    admin: need("JA_ADMIN_URL"),
    pw: need("JA_USER_PW"),
    adminUser: need("SEED_ADMIN_USERNAME"),
    adminPw: need("SEED_ADMIN_PASSWORD"),
    tenantKey: CO.a.key(),
    tenantName: CO.a.name,
  };
  await page.setViewportSize({ width: 1280, height: 720 });
  await loginCw(page, e, WHO.vy);
  await page.goto(`${e.cw}/contracts/messages`);
  await expect(page.getByTestId("messages-page")).toBeVisible();
  const noPageScroll = await page.evaluate(() => {
    const d = document.scrollingElement as HTMLElement;
    return d.scrollHeight <= d.clientHeight + 1;
  });
  expect(noPageScroll).toBe(true);
  const aside = await page.getByTestId("messages-page").locator("aside").boundingBox();
  for (const row of await page.getByTestId("conv-row").all()) {
    const b = await row.boundingBox();
    expect((b?.x ?? 0) + (b?.width ?? 0)).toBeLessThanOrEqual(
      (aside?.x ?? 0) + (aside?.width ?? 0) + 1,
    );
  }
});
