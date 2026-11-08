// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-125 · cr125-subprocess-ui · HÀNH TRÌNH "Quy trình con" trên stack thật `playwright.journey.config.ts`, công ty MỚI `e2e-sub-<hậu tố>`:
// quản trị công ty mở bản sao của quy trình cha ở trình sửa → menu "+ Thêm bước" có "Quy trình con" (kèm mô tả) → chọn "Mua hàng · Phần 2"
// → panel nói quy trình con CẦN / TRẢ gì → Lưu và áp dụng → canvas có ô (tên, huy hiệu "quy trình con", Xong / Từ chối / Huỷ, liên kết "Mở quy trình con")
// → bấm liên kết mở đúng quy trình con. Ảnh ô canvas + panel ghi vào docs/specs/cr125-subprocess-ui/.
// ĐANG CHỜ: chạy trên evotest SAU KHI lát cr125-subprocess-engine gộp (node `core.subprocess` ở bảng node + executor `subprocess` ở hub).
import { expect, type Page, test } from "@playwright/test";
import { apiLogin, assignCompanyFlow } from "../_kit/api";
import { approve, createLibraryFlow, enableFlowTriggers, finish } from "../_kit/flows";
import { flowRows, loginTenantAdminUi, openCompanyFlows } from "../_kit/ui";
import { U } from "./_journey";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
const SFX = need("JA_D5_SUFFIX");
const API = need("JA_API_URL");
const HUB = need("JA_HUB_URL");
const ADMIN = need("JA_ADMIN_URL");
const PW = need("JA_USER_PW");
const KEY = `e2e-sub-${SFX}`;
const PARENT = `Mua hàng · Phần 1 ${SFX}`;
const CHILD = "Mua hàng · Phần 2";
const CANVAS = { name: "Canvas quy trình" };
const SHOTS = "docs/specs/cr125-subprocess-ui";

let tenantId = "";

const simple = () => [
  approve("duyet", "Trưởng bộ phận duyệt", 0, "pb-ke-toan", {}),
  finish("xong", "Đã duyệt", 1, "approved"),
];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const platform = await apiLogin({
    base: API,
    tenantKey: "platform",
    username: need("SEED_ADMIN_USERNAME"),
    password: need("SEED_ADMIN_PASSWORD"),
  });
  const parentId = await createLibraryFlow(HUB, platform.token, {
    key: `sub-p1-${SFX}`,
    name: PARENT,
    app: "contracts",
    trigger: { event: "contract.submitted" },
    stages: simple(),
  });
  // quy trình con: tên đúng như người dùng gọi; không cần trigger riêng để được gọi từ cha
  const childId = await createLibraryFlow(HUB, platform.token, {
    key: `sub-p2-${SFX}`,
    name: CHILD,
    app: "contracts",
    trigger: { event: "contract.submitted" },
    stages: simple(),
  });
  tenantId = await enableFlowTriggers(KEY, false);
  await assignCompanyFlow(HUB, platform, tenantId, parentId);
  await assignCompanyFlow(HUB, platform, tenantId, childId);
});

async function openParentCopy(page: Page): Promise<void> {
  await loginTenantAdminUi(page, ADMIN, KEY, U.director, PW);
  await page.goto(`${ADMIN}/tenants/${tenantId}?tab=processes`);
  const box = await openCompanyFlows(page);
  const row = flowRows(box).filter({ hasText: PARENT });
  await row.getByRole("button", { name: "Sao chép để sửa" }).click();
  await page.getByTestId("copy-confirm").click();
  await flowRows(box)
    .filter({ hasText: "Sao từ" })
    .filter({ hasText: PARENT })
    .getByRole("link", { name: "Mở", exact: true })
    .click();
  await expect(page.getByRole("application", CANVAS)).toBeVisible();
}

test("1 · quản trị công ty thêm 'Quy trình con', chọn 'Mua hàng · Phần 2', lưu; canvas hiện ô + liên kết mở", async ({
  page,
}, testInfo) => {
  await openParentCopy(page);
  // menu: mục + mô tả nghiệp vụ ngắn
  await page.getByTestId("flow-add-step").click();
  const item = page.getByRole("menu").getByTestId("flow-node-core.subprocess");
  await expect(item).toContainText("Quy trình con");
  await expect(item).toContainText("Chạy một quy trình khác rồi quay lại");
  await item.click();

  // panel: chọn quy trình con bằng ô tìm (tên + trạng thái)
  const canvas = page.getByRole("application", CANVAS);
  await canvas.getByTestId("subprocess-node").first().click();
  const panel = page.getByTestId("node-config-subprocess");
  await expect(panel).toBeVisible();
  await panel.getByRole("combobox").click();
  await page.getByRole("searchbox").fill("Phần 2");
  await page.getByRole("option", { name: new RegExp(CHILD) }).click();
  await expect(panel.getByTestId("subprocess-chosen")).toContainText(CHILD);
  await expect(panel.getByTestId("subprocess-io")).toContainText("Cần");
  await expect(panel.getByTestId("subprocess-io")).toContainText("Trả về");
  await panel.screenshot({ path: `${SHOTS}/panel.png` });

  await page.getByRole("button", { name: "Lưu và áp dụng" }).first().click();
  await expect(page.getByRole("alert").filter({ hasText: /SUBPROCESS_/ })).toHaveCount(0);

  // sau khi lưu + tải lại: canvas vẫn có ô với tên quy trình con, huy hiệu, ba đầu ra và liên kết
  await page.reload();
  const node = page
    .getByRole("application", CANVAS)
    .getByTestId("module-node")
    .filter({
      has: page.getByTestId("subprocess-node"),
    });
  await expect(node.getByTestId("subprocess-badge")).toHaveText(/quy trình con/i);
  await expect(node.getByTestId("subprocess-child")).toContainText(CHILD);
  for (const x of ["done", "rejected", "cancelled"])
    await expect(node.getByTestId(`module-exit-${x}`)).toBeVisible();
  await expect(node.getByTestId("module-exit-done")).toHaveText("Xong");
  await expect(node.getByTestId("module-exit-rejected")).toHaveText("Từ chối");
  await expect(node.getByTestId("module-exit-cancelled")).toHaveText("Huỷ");
  await node.screenshot({ path: `${SHOTS}/canvas-node.png` });
  testInfo.annotations.push({ type: "shots", description: SHOTS });

  // liên kết mở đúng quy trình con trong trình sửa
  await node.getByTestId("subprocess-open").click();
  await expect(page).toHaveURL(/\/processes\//);
  await expect(page.getByRole("application", CANVAS)).toBeVisible();
  await expect(page.getByText(CHILD).first()).toBeVisible();
});
