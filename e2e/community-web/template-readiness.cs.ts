// CR-125 · c5b · HÀNH TRÌNH THẬT (D5) "mẫu Thư viện chưa dùng được → platform sửa một chạm → gán → công ty sao chép và áp dụng được".
//  1. Chuẩn bị (owner SQL, phần sản phẩm chưa có đường làm): công ty demo chưa được bật «Community · Sửa» + một mẫu Thư viện đã xuất bản
//     có bước Hiện bài (cần tính năng đó) và bước Duyệt theo mã nhóm công ty chưa có.
//  2. Platform ở ai-admin chọn mẫu: thấy thiếu gì, nút Gán KHÓA; bấm "Bật tính năng cho công ty" + "Tạo nhóm theo gợi ý" ⇒ dùng được ⇒ Gán.
//  3. Quản trị công ty: "Sao chép để sửa" ⇒ hộp nói mẫu dùng được ⇒ Sao chép ⇒ mở bản riêng ⇒ Lưu và áp dụng không bị chặn.
// Ảnh chụp: thư mục env E2E_SHOTS_DIR (vắng ⇒ không chụp).
import { expect, type Page, test } from "@playwright/test";
import { approve, finish } from "../_kit/flows";
import {
  flowRow,
  loginPlatformAdminUi,
  loginTenantAdminUi,
  openCompanyFlows,
  openTenantAppsTab,
} from "../_kit/ui";
import { withOwner } from "../support/helpers";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e
const ADMIN = process.env.CS_ADMIN_URL ?? "";
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e
const OWNER_PW = process.env.DEMO_OWNER_PW ?? "";
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến môi trường của runner e2e
const SHOTS = process.env.E2E_SHOTS_DIR ?? "";
const RUN = Date.now().toString(36);
const NAME = `Mẫu thử c5b ${RUN}`;
const GROUP = `nhom-c5b-${RUN}`;
const TENANT_NAME = "Demo Sổ Hợp Tác";

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

async function prepare(): Promise<void> {
  const stages = [
    approve("duyet", "Quản trị duyệt", 0, GROUP, { reject: 2, ret: 2 }),
    { ...finish("hien-bai", "Hiện bài", 1, "shown"), node: "community.show-post" },
    finish("an-bai", "Ẩn bài", 2, "hidden"),
  ];
  await withOwner(async (sql) => {
    await sql`update admin.feature_entitlements set revoked_at = now()
      where tenant_id = (select id from admin.tenants where key = 'demo') and revoked_at is null
        and feature_id = (select id from admin.features where key = 'community-write')`;
    const st = JSON.stringify(stages);
    const [d] = await sql<{ id: string }[]>`insert into hub.process_defs
        (tenant_id, key, name, stages, trigger, app, inputs, published_version)
      values (null, ${`c5b-${RUN}`}, ${NAME}, ${st}::text::jsonb, '{"event":"post.created"}'::jsonb, 'community',
        '[{"key":"post_id","label":"Bài","type":"text","required":true}]'::jsonb, 1) returning id::text as id`;
    await sql`insert into hub.process_def_releases (def_id, rel_version, name, stages)
      values (${d?.id as string}, 1, ${NAME}, ${st}::text::jsonb)`;
  });
}

test.describe.configure({ mode: "serial" });

test("1 · platform: mẫu chưa dùng được ⇒ Gán khóa, bấm sửa một chạm ⇒ gán được", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await prepare();
  const ctx = await browser.newContext({
    locale: "vi-VN",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await ctx.newPage();
  await loginPlatformAdminUi(
    page,
    ADMIN,
    process.env.SEED_ADMIN_USERNAME ?? "",
    process.env.SEED_ADMIN_PASSWORD ?? "",
  );
  await openTenantAppsTab(page, TENANT_NAME);
  const box = await openCompanyFlows(page);
  const pick = box.getByRole("combobox", { name: "Flow trong Thư viện" });
  await expect(pick.locator("option", { hasText: NAME })).toHaveCount(1, { timeout: 30_000 });
  await pick.selectOption({ label: NAME });
  const panel = box.getByTestId("flow-readiness");
  await expect(panel).toHaveAttribute("data-ready", "no");
  await expect(panel.getByTestId("readiness-feature")).toContainText("Hiện bài");
  await expect(box.getByRole("button", { name: "Gán", exact: true })).toBeDisabled();
  await shot(page, "01-platform-chua-dung-duoc");
  await panel.getByTestId("readiness-fix-enable-feature").click();
  await expect(panel).toHaveAttribute("data-ready", "yes", { timeout: 30_000 });
  await expect(panel.getByTestId("readiness-feature")).toHaveCount(0);
  await panel.getByTestId("readiness-fix-create-group").click();
  await expect(panel.getByTestId("readiness-group")).toHaveCount(0, { timeout: 30_000 });
  await shot(page, "02-platform-da-sua");
  await box.getByRole("button", { name: "Gán", exact: true }).click();
  await expect(flowRow(box, NAME)).toBeVisible();
  await shot(page, "03-platform-da-gan");
  await ctx.close();
});

test("2 · quản trị công ty: hộp Sao chép nói mẫu dùng được ⇒ sao chép ⇒ Lưu và áp dụng", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const page = await (
    await browser.newContext({ locale: "vi-VN", viewport: { width: 1600, height: 1000 } })
  ).newPage();
  await loginTenantAdminUi(page, ADMIN, "demo", "demo-owner", OWNER_PW);
  await page.getByRole("link", { name: "Công ty" }).first().click();
  const box = await openCompanyFlows(page);
  const rows = flowRow(box, NAME);
  await rows.first().getByRole("button", { name: "Sao chép để sửa" }).click();
  const dialog = page.getByTestId("copy-dialog");
  await expect(dialog.getByTestId("flow-readiness")).toHaveAttribute("data-ready", "yes");
  await expect(dialog.getByTestId("readiness-group")).toHaveCount(0); // nhóm đã tạo ⇒ không còn cảnh báo
  await shot(page, "04-cong-ty-hop-sao-chep");
  await dialog.getByTestId("copy-confirm").click();
  await expect(rows).toHaveCount(2);
  await rows
    .last()
    .getByRole("link", { name: /^(Mở|Sửa)/ })
    .click();
  const own = page.getByRole("link", { name: "Mở bản riêng" });
  await expect(page.getByTestId("flow-add-step").or(own)).toBeVisible({ timeout: 30_000 });
  if (await own.isVisible()) await own.click();
  await expect(page.getByTestId("flow-add-step")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Lưu và áp dụng" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Chưa lưu được/ })).toHaveCount(0);
  await shot(page, "05-cong-ty-da-ap-dung");
});
