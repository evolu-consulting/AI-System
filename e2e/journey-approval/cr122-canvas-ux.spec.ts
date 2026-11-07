// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-122 · p22 · hành trình UI của canvas trên stack thật `playwright.journey.config.ts`, công ty MỚI `e2e-c22x-<hậu tố>`:
//  1) kéo cổng "Sai" của node Nếu sang node ở bước sau ⇒ ô "Sai thì tới bước" trong ngăn chi tiết đổi ngay và hiện "Bước N · tên";
//  2) kéo ngược về bước đứng trước ⇒ không đổi gì + thông báo nói lý do;
//  3) ô chọn bước liệt kê "Bước N · tên bước".
// Dữ liệu riêng: flow Thư viện `c22x-<hậu tố>` (dựng bằng SQL như cr122-editor) gán qua API; bản sao do quản trị công ty tạo ở UI.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { apiLogin, assignCompanyFlow } from "../_kit/api";
import { createLibraryFlow, enableFlowTriggers, finish, ifFact, plainSet } from "../_kit/flows";
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
const KEY = `e2e-c22u-${SFX}`; // cùng công ty với cr122-editor (đã có trong stack hành trình)
const CANVAS = { name: "Canvas quy trình" };
let tenantId = "";

/** 0 Nếu (Đúng→1, Sai→2) · 1 Nhận dữ liệu · 2 Chuẩn bị · 3 Kết thúc Đã duyệt. */
const stages = () => [
  ifFact("nhanh", "Giá trị lớn", 0, { fact: "total_value", op: "gt", value: 100_000_000 }, 1, 2),
  plainSet("nhan", "Nhận dữ liệu", 1),
  plainSet("chuan", "Chuẩn bị", 2),
  finish("xong", "Đã duyệt", 3, "approved"),
];

async function openCopy(page: Page): Promise<void> {
  await loginTenantAdminUi(page, ADMIN, KEY, U.director, PW);
  await page.goto(`${ADMIN}/tenants/${tenantId}?tab=processes`);
  const box = await openCompanyFlows(page);
  let copy = flowRows(box)
    .filter({ hasText: "Sao từ" })
    .filter({ hasText: `Canvas ${SFX}` });
  if ((await copy.count()) === 0) {
    await flowRows(box)
      .filter({ hasText: `Canvas ${SFX}` })
      .getByRole("button", { name: "Sao chép để sửa" })
      .click();
    copy = flowRows(box)
      .filter({ hasText: "Sao từ" })
      .filter({ hasText: `Canvas ${SFX}` });
    await expect(copy).toBeVisible();
  }
  await copy.getByRole("link", { name: "Mở", exact: true }).click();
  await expect(page.getByRole("application", CANVAS)).toBeVisible();
}

/** Kéo từ giữa `from` tới giữa `to` bằng chuột thật (xyflow cần các bước di chuyển trung gian). */
async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("không thấy cổng hoặc node đích");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

const node = (page: Page, name: string): Locator =>
  page.getByRole("application", CANVAS).getByRole("button", { name: new RegExp(name) });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const platform = await apiLogin({
    base: API,
    tenantKey: "platform",
    username: need("SEED_ADMIN_USERNAME"),
    password: need("SEED_ADMIN_PASSWORD"),
  });
  const flowId = await createLibraryFlow(HUB, platform.token, {
    key: `c22x-${SFX}`,
    name: `Canvas ${SFX}`,
    app: "contracts",
    trigger: { event: "contract.submitted" },
    stages: stages(),
  });
  tenantId = await enableFlowTriggers(KEY, false);
  await assignCompanyFlow(HUB, platform, tenantId, flowId);
});

test("1 · kéo cổng Sai của node Nếu sang bước sau ⇒ ô 'Sai thì tới bước' đổi ngay, hiện 'Bước N · tên'", async ({
  page,
}) => {
  await openCopy(page);
  await drag(page, page.getByTestId("port-no"), node(page, "Chuẩn bị"));
  await node(page, "Giá trị lớn").click();
  const field = page.getByRole("combobox", { name: "Sai thì tới bước" });
  await expect(field).toContainText("Bước 3 · Chuẩn bị");
  await field.click();
  await expect(page.getByRole("option", { name: "Bước 2 · Nhận dữ liệu" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Bước 4 · Đã duyệt" })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("2 · kéo về bước đứng trước ⇒ không đổi gì và có câu báo lý do", async ({ page }) => {
  await openCopy(page);
  await drag(page, page.getByTestId("port-next").nth(1), node(page, "Giá trị lớn"));
  await expect(page.getByText("Chỉ nối được tới bước đứng sau.")).toBeVisible();
});
