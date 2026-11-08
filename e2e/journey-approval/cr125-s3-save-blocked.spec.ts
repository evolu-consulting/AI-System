// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-125 · S3 · C3 · HÀNH TRÌNH: sao chép quy trình Thư viện có bước Ký số → (người ký được điền sẵn từ nhóm duyệt) → bỏ người ký →
// "Lưu và áp dụng" KHÔNG được im lặng: thông báo nói bước nào thiếu gì + "Đến bước" → chọn người ký → lưu và áp dụng xong.
// Công ty MỚI `e2e-s3-<hậu tố>`; flow Thư viện dựng như cr123-u6 (`_kit/flows.ts`), gán + sao chép bằng UI.
import { expect, test } from "@playwright/test";
import { apiLogin } from "../_kit/api";
import {
  approve,
  createLibraryFlow,
  enableFlowTriggers,
  esignNode,
  finish,
  plainSet,
} from "../_kit/flows";
import {
  assignFlowUi,
  flowRows,
  loginPlatformAdminUi,
  loginTenantAdminUi,
  openCompanyFlows,
  openTenantPage,
} from "../_kit/ui";
import { withOwner } from "../support/helpers";
import { type Env, U } from "./_journey";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
const SFX = need("JA_D5_SUFFIX");
const HUB = need("JA_HUB_URL");
const E: Env = {
  cw: need("JA_CW_URL"),
  admin: need("JA_ADMIN_URL"),
  pw: need("JA_USER_PW"),
  adminUser: need("SEED_ADMIN_USERNAME"),
  adminPw: need("SEED_ADMIN_PASSWORD"),
  tenantKey: `e2e-s3-${SFX}`,
  tenantName: `E2E S3 ${SFX}`,
};
const FLOW = `Duyệt + Ký số S3 ${SFX}`;
const CANVAS = { name: "Canvas quy trình" };

test("C3 · Lưu và áp dụng thiếu người ký nói rõ lý do rồi áp dụng được", async ({
  browser,
}, testInfo) => {
  test.setTimeout(420_000);
  const platform = await apiLogin({
    base: need("JA_API_URL"),
    tenantKey: "platform",
    username: E.adminUser,
    password: E.adminPw,
  });
  const flowId = await createLibraryFlow(HUB, platform.token, {
    key: `s3-${SFX}`,
    name: FLOW,
    app: "contracts",
    trigger: { event: "contract.submitted" },
    inputs: [{ key: "contract_id", label: "Hợp đồng", type: "text", required: true }],
    stages: [
      plainSet("khoi", "Tiếp nhận", 0),
      approve("duyet", "Duyệt hợp đồng", 1, "pb-ke-toan", { reject: 5, next: 2 }),
      ...esignNode(2).map((s, i) =>
        i === 0
          ? {
              ...s,
              executor: {
                ...(s.executor as object),
                args: { contract_id: { from: "input", key: "contract_id" } },
              },
            }
          : s,
      ),
      finish("xong", "Hoàn tất", 4, "approved"),
      finish("tu-choi", "Từ chối", 5, "rejected"),
    ],
  });
  const tenantId = await enableFlowTriggers(E.tenantKey, false);
  await withOwner(async (sql) => {
    const [u] = await sql<
      { id: string }[]
    >`select id::text from admin.users where tenant_id = ${tenantId}::uuid and username = ${U.director}`;
    await sql`insert into contracts.approval_settings (tenant_id, esign_enabled, esign_default_provider, updated_by)
      values (${tenantId}::uuid, true, 'selfsign', ${u?.id as string}::uuid)
      on conflict (tenant_id) do update set esign_enabled = true, esign_default_provider = 'selfsign'`;
  });

  // — platform admin gán flow (UI) —
  const admin = await (
    await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } })
  ).newPage();
  await loginPlatformAdminUi(admin, E.admin, E.adminUser, E.adminPw);
  await openTenantPage(admin, E.tenantName);
  await assignFlowUi(await openCompanyFlows(admin), FLOW);

  // — quản trị công ty: Sao chép để sửa ⇒ Mở —
  const page = await (
    await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } })
  ).newPage();
  await loginTenantAdminUi(page, E.admin, E.tenantKey, U.director, E.pw);
  await page.goto(`${E.admin}/tenants/${tenantId}?tab=processes`);
  const box = await openCompanyFlows(page);
  await flowRows(box)
    .filter({ hasText: "Được gán" })
    .getByRole("button", { name: "Sao chép để sửa" })
    .click();
  await page.getByTestId("copy-confirm").click();
  const copy = flowRows(box).filter({ hasText: "Sao từ" });
  await expect(copy).toBeVisible();
  await copy.getByRole("link", { name: "Mở", exact: true }).click();
  await expect(page.getByRole("application", CANVAS)).toBeVisible();

  // — mở node Ký số: người ký công ty đã điền sẵn (nhóm duyệt) —
  await page
    .getByRole("application", CANVAS)
    .getByRole("button", { name: /^Ký số(?! \d)/ })
    .first()
    .click();
  const cfg = page.getByTestId("node-config");
  await expect(cfg).toBeVisible();
  const boxes = cfg.getByRole("checkbox");
  const checked = cfg.locator('[role="checkbox"][aria-checked="true"]');
  await expect(checked).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("s3-1-prefilled.png") });

  // — bỏ người ký ⇒ Lưu và áp dụng: KHÔNG im lặng —
  await checked.first().click();
  await expect(checked).toHaveCount(0);
  await page.getByRole("button", { name: "Lưu và áp dụng" }).first().click();
  const alert = page.getByRole("alert").filter({ hasText: "Chưa lưu được" });
  await expect(alert).toContainText("Ký số");
  await expect(alert).toContainText("chưa có người ký");
  await expect(alert.getByRole("button", { name: "Đến bước" })).toBeVisible();
  await expect(page.getByTestId("apply-status").first()).not.toContainText("Đã áp dụng");
  await page.screenshot({ path: testInfo.outputPath("s3-2-blocked.png") });

  // — Đến bước ⇒ chọn người ký ⇒ lưu và áp dụng xong —
  await alert.getByRole("button", { name: "Đến bước" }).click();
  await boxes.first().click();
  await expect(checked).toHaveCount(1);
  await page.getByRole("button", { name: "Lưu và áp dụng" }).first().click();
  await expect(page.getByTestId("apply-status").first()).toContainText(
    "Đã áp dụng — hợp đồng từ giờ dùng quy trình này",
    { timeout: 60_000 },
  );
  await page.screenshot({ path: testInfo.outputPath("s3-3-applied.png") });
});
