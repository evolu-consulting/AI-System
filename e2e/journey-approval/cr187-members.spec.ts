// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-187 · BR-187-2 · HÀNH TRÌNH «Thành viên chỉ người nội bộ» trên công ty mẫu `demo`: quản trị công ty (JA_ORG_ADMIN, mặc định owner)
// mở trang Thành viên ⇒ KHÔNG thấy tài khoản đối tác (CR187_PARTNER_NAME: họ tên một người đối tác đã có sẵn ở `demo`),
// tìm đúng tên đó cũng không ra (ca gán đối tác ⇒ 422 đã khoá ở external-deny.int.test.ts).
// Không chạy trong lát; chạy MỘT lần cuối đợt.
import { expect, test } from "@playwright/test";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt`);
  return v;
};
const CW = process.env.JA_CW_URL ?? "http://localhost:3300";
const PW = need("DEMO_OWNER_PW");
const ADMIN = process.env.JA_ORG_ADMIN ?? "owner";
const PARTNER = need("CR187_PARTNER_NAME");

test("quản trị thấy danh sách thành viên không có đối tác", async ({ browser }) => {
  const page = await (await browser.newContext({ locale: "vi-VN" })).newPage();
  await page.goto(`${CW}/login`);
  await page.getByRole("textbox", { name: "Mã công ty" }).fill("demo");
  await page.getByRole("textbox", { name: "Email" }).fill(ADMIN);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(PW);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto(`${CW}/contracts/org`);
  await expect(page.getByTestId("org-tree")).toBeVisible({ timeout: 30_000 });
  const list = await page.request.get(
    `${CW}/admin/org/members?limit=200&offset=0&q=${encodeURIComponent(PARTNER)}`,
  );
  expect(list.status()).toBe(200);
  expect(((await list.json()) as { total: number }).total).toBe(0);
  const all = await page.request.get(`${CW}/admin/org/members?limit=200&offset=0`);
  const names = ((await all.json()) as { items: { display_name: string }[] }).items.map(
    (m) => m.display_name,
  );
  expect(names).not.toContain(PARTNER);
});
