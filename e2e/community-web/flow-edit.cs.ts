// QC · qc-community-flow · hành trình "quản trị nền tảng soạn quy trình Duyệt bài cho công ty community → Áp dụng cho công ty" (stack community-web + ai-admin, CS_ADMIN_URL).
// CR-127 Z5b: chỉ quản trị nền tảng soạn (tạo từ sơ đồ trống, vẽ theo khối); quản trị công ty chỉ xem + câu «Quy trình do quản trị nền tảng soạn…», không có nút Tạo/Sao chép.
import { expect, test } from "@playwright/test";
import {
  addMainStep,
  createFlowUi,
  flowRow,
  loginPlatformAdminUi,
  loginTenantAdminUi,
  openCompanyFlows,
} from "../_kit/ui";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e
const ADMIN = process.env.CS_ADMIN_URL ?? "";
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e
const OWNER_PW = process.env.DEMO_OWNER_PW ?? "";
const TENANT_NAME = "Demo Sổ Hợp Tác";
const FLOW = `Duyệt bài (soạn mới) ${Date.now().toString(36)}`;

test("quản trị community: nền tảng tạo quy trình Duyệt bài từ sơ đồ trống, thêm bước Duyệt, Áp dụng cho công ty; quản trị công ty chỉ xem", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const pctx = await browser.newContext({
    locale: "vi-VN",
    viewport: { width: 1600, height: 1000 },
  });
  const page = await pctx.newPage();
  await loginPlatformAdminUi(
    page,
    ADMIN,
    process.env.SEED_ADMIN_USERNAME ?? "",
    process.env.SEED_ADMIN_PASSWORD ?? "",
  );
  await createFlowUi(page, ADMIN, { company: TENANT_NAME, app: "Community", name: FLOW });
  // sơ đồ trống chỉ có Bắt đầu → Hoàn tất; thêm một bước Duyệt giữa hai khối
  await expect(page.getByTestId("outline-start")).toBeVisible();
  await addMainStep(page, 0, "approve");
  await page
    .getByRole("combobox", { name: /Ai duyệt/ })
    .first()
    .click();
  await page.getByRole("option").first().click();
  await expect(page.getByTestId("outline-chip-error")).toHaveCount(0);
  const applied = page.waitForResponse(
    (r) => /\/company-flows\/apply/.test(r.url()) && r.request().method() === "POST",
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: "Áp dụng cho công ty" }).click();
  const res = await applied;
  expect(res.status(), (await res.text()).slice(0, 300)).toBe(200);
  await expect(page.getByRole("alert").filter({ hasText: /Chưa lưu được/ })).toHaveCount(0);
  await expect(page.getByTestId("apply-status").first()).toContainText("Đã áp dụng", {
    timeout: 60_000,
  });
  await pctx.close();

  // quản trị công ty: thấy quy trình đã áp dụng nhưng chỉ xem
  const tctx = await browser.newContext({
    locale: "vi-VN",
    viewport: { width: 1600, height: 1000 },
  });
  const tpage = await tctx.newPage();
  await loginTenantAdminUi(tpage, ADMIN, "demo", "demo-owner", OWNER_PW);
  await tpage.getByRole("link", { name: "Công ty" }).first().click();
  const box = await openCompanyFlows(tpage);
  await expect(flowRow(box, FLOW)).toBeVisible();
  await expect(box.getByTestId("company-flow-readonly-note")).toContainText(
    "Quy trình do quản trị nền tảng soạn",
  );
  await expect(box.getByTestId("create-flow-open")).toHaveCount(0);
  await expect(box.getByRole("button", { name: "Sao chép để sửa" })).toHaveCount(0);
  await tctx.close();
});
