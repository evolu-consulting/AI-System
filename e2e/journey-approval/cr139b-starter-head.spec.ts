// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-139 · Q1/Q13 · HÀNH TRÌNH «Trưởng phòng của người đề xuất» trên công ty mẫu `demo` (bun run demo:org): HĐ mẫu do cuong.le gửi
// (Phòng Kinh doanh) ⇒ thẻ «Các bước duyệt» hiện TÊN trưởng phòng (Trần Thị Bình) ⇒ binh.tran thấy nút Duyệt, cuong.le thì không;
// «Sơ đồ tổ chức» hiện cây phòng ban + trưởng phòng cho mọi nhân viên. Không chạy trong lát (Luật 0d.10) — chạy MỘT lần cuối đợt.
import { expect, test } from "@playwright/test";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt`);
  return v;
};
const CW = process.env.JA_CW_URL ?? "http://localhost:3300";
const PW = need("DEMO_OWNER_PW");
const SAMPLE_SALES = "c139c000-0000-4000-8000-000000000001"; // HĐ mẫu: cuong.le gửi ⇒ binh.tran duyệt

async function login(page: import("@playwright/test").Page, user: string): Promise<void> {
  await page.goto(`${CW}/login`);
  await page.getByRole("textbox", { name: "Mã công ty" }).fill("demo");
  await page.getByRole("textbox", { name: "Email" }).fill(user);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(PW);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("starter_head · thẻ hiện tên trưởng phòng; chỉ trưởng phòng duyệt được", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const sender = await (await browser.newContext({ locale: "vi-VN" })).newPage();
  await login(sender, "cuong.le");
  await sender.goto(`${CW}/contracts/c/${SAMPLE_SALES}`);
  await expect(sender.getByTestId("approval-person").first()).toContainText("Trần Thị Bình");
  await expect(sender.locator("[data-approval=pass], [data-approval=approve]")).toHaveCount(0);

  const head = await (await browser.newContext({ locale: "vi-VN" })).newPage();
  await login(head, "binh.tran");
  await head.goto(`${CW}/contracts/c/${SAMPLE_SALES}`);
  await expect(head.getByTestId("approval-person").first()).toContainText("Trần Thị Bình");
  await expect(head.locator("[data-approval=pass], [data-approval=approve]").first()).toBeVisible();
});

test("sơ đồ tổ chức · cây phòng ban + trưởng phòng, tìm người", async ({ browser }) => {
  const page = await (await browser.newContext({ locale: "vi-VN" })).newPage();
  await login(page, "cuong.le");
  await page.getByRole("link", { name: "Sơ đồ tổ chức" }).first().click();
  await expect(page.getByRole("heading", { name: "Sơ đồ tổ chức" })).toBeVisible();
  await expect(page.getByTestId("org-tree")).toContainText("Phòng Kinh doanh");
  await expect(page.getByTestId("org-tree")).toContainText("Trần Thị Bình");
  await page.getByRole("searchbox", { name: "Tìm phòng ban hoặc người" }).fill("ke toan");
  await expect(page.getByTestId("org-tree")).toContainText("Kế toán");
  await expect(page.getByTestId("org-tree")).not.toContainText("Phòng Pháp chế");
});
