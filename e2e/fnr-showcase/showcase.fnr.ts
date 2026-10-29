// CR-103 · R4 fnr-showcase · e2e (KHÔNG chạy trong lát; chạy một lần cuối đợt, sau phase B + seed flow mẫu cho tenant demo):
// admin mở `/processes/showcase`, "Chạy thử" 150.000.000 + "mua sắm" ⇒ hai bước song song ⇒ tới "Giám đốc duyệt";
// 50.000.000 ⇒ nhánh else "Hoàn tất". Không phụ thuộc AI (node set/if).
import { expect, test } from "@playwright/test";
import { ADMIN_URL, adminLogin, settle } from "../P-a/_pa-support";

test.afterEach(() => settle());

async function runWith(p: import("@playwright/test").Page, amount: string) {
  await p.goto(`${ADMIN_URL}/processes/showcase`);
  await expect(p.getByRole("heading", { name: /Duyệt đề nghị chi/ })).toBeVisible();
  await p.getByLabel("Số tiền").fill(amount);
  await p.getByLabel("Mục đích").fill("mua sắm");
  await p.getByRole("button", { name: "Chạy thử" }).last().click();
  await expect(p.getByTestId("showcase-run")).toBeVisible();
}

test("CR-103 · R4 · 150 triệu mua sắm ⇒ duyệt song song ⇒ tới Giám đốc duyệt", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await adminLogin(p);
    await runWith(p, "150000000");
    const run = p.getByTestId("showcase-run");
    await expect(run.getByRole("row").filter({ hasText: "Pháp chế" })).toBeVisible();
    await expect(run.getByRole("row").filter({ hasText: "Kế toán" })).toBeVisible();
    // Duyệt hai bước song song bằng nút Đạt (RunActions) rồi chờ tới Giám đốc duyệt.
    for (const _ of [0, 1]) await run.getByRole("button", { name: "Đạt" }).first().click();
    // Nhánh Đúng: Giám đốc duyệt ĐANG chờ kiểm (không phải Bỏ qua) và cả run chưa Hoàn tất.
    const director = run.getByRole("row").filter({ hasText: "Giám đốc duyệt" });
    await expect(director).toContainText("Chờ kiểm");
    await expect(director).not.toContainText("Bỏ qua");
    await expect(run.locator('[data-slot="badge"]').first()).not.toHaveText("Hoàn tất");
  } finally {
    await ctx.close();
  }
});

test("CR-103 · R4 · 50 triệu ⇒ nhánh else Hoàn tất", async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await adminLogin(p);
    await runWith(p, "50000000");
    const run = p.getByTestId("showcase-run");
    for (const _ of [0, 1]) await run.getByRole("button", { name: "Đạt" }).first().click();
    // Nhánh else: cả run xong (huy hiệu "Hoàn tất" đầu tiên) và "Giám đốc duyệt" không bao giờ chạy.
    await expect(run.locator('[data-slot="badge"]').first()).toHaveText("Hoàn tất");
    await expect(run.getByRole("row").filter({ hasText: "Giám đốc duyệt" })).toContainText(
      "Bỏ qua",
    );
  } finally {
    await ctx.close();
  }
});
