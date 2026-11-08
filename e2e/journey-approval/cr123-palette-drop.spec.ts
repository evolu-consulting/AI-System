// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-123 · u4 · HÀNH TRÌNH kéo-thả (FLOW3-FR-04/08) trong trình sửa flow CỦA CÔNG TY trên stack thật `playwright.journey.config.ts`:
// platform_admin dựng + gán flow Thư viện (chuẩn bị qua API) ⇒ tenant_admin "Sao chép để sửa" ⇒ mở trình sửa ⇒ menu "Thêm bước" ⇒ KÉO mục
// "Thông báo" thả vào khoảng trống của canvas ⇒ thêm đúng MỘT node mới. (Luật "Ký số cần bước duyệt ngay trước" khi thả: unit `lib/u4-canvas-ux.test.ts`.)
import { expect, type Page, test } from "@playwright/test";
import { apiLogin, assignCompanyFlow } from "../_kit/api";
import {
  approve,
  createLibraryFlow,
  enableFlowTriggers,
  finish,
  notifyCreator,
} from "../_kit/flows";
import { flowRow, flowRows, loginTenantAdminUi, openCompanyFlows } from "../_kit/ui";
import { viStorageState } from "../support/locale-vi";
import { U } from "./_journey";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
const SFX = need("JA_D5_SUFFIX");
const HUB = need("JA_HUB_URL");
const ADMIN = need("JA_ADMIN_URL");
const TENANT_KEY = `e2e-c22-${SFX}`;
const FLOW = `Kéo thả u4 ${SFX}`;
const ctxPage = async (browser: import("@playwright/test").Browser): Promise<Page> =>
  (
    await browser.newContext({
      locale: "vi-VN",
      storageState: viStorageState([ADMIN]),
      viewport: { width: 1600, height: 1000 },
    })
  ).newPage();

test.describe.configure({ mode: "serial" });
let tenantId = "";

test.beforeAll(async () => {
  const platform = await apiLogin({
    base: need("JA_API_URL"),
    tenantKey: "platform",
    username: need("SEED_ADMIN_USERNAME"),
    password: need("SEED_ADMIN_PASSWORD"),
  });
  const flowId = await createLibraryFlow(HUB, platform.token, {
    key: `c23-u4-${SFX}`,
    name: FLOW,
    app: "contracts",
    trigger: { event: "contract.submitted" },
    stages: [
      approve("duyet", "Duyệt hợp đồng", 0, "pb-ke-toan", { reject: 2 }),
      notifyCreator("bao", "Thông báo người gửi", 1, "Hợp đồng đã được duyệt"),
      finish("tu-choi", "Từ chối", 2, "rejected"),
    ],
  });
  tenantId = await enableFlowTriggers(TENANT_KEY);
  await assignCompanyFlow(HUB, platform, tenantId, flowId); // chuẩn bị: gán là việc của platform_admin, không phải bước được kiểm
});

test("U4 · công ty sao chép flow, mở trình sửa, KÉO 'Thông báo' từ menu Thêm bước thả vào canvas ⇒ thêm một node, node mới nằm trong sơ đồ", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const page = await ctxPage(browser);
  await loginTenantAdminUi(page, ADMIN, TENANT_KEY, U.director, need("JA_USER_PW"));
  await page.goto(`${ADMIN}/tenants/${tenantId}?tab=processes`);
  const box = await openCompanyFlows(page);
  await flowRow(box, FLOW).getByRole("button", { name: "Sao chép để sửa" }).click();
  await page.getByTestId("copy-confirm").click();
  const copy = flowRows(box).filter({ hasText: `Sao từ ${FLOW} · v1` });
  await expect(copy).toBeVisible();
  await copy
    .getByRole("link", { name: /^(Mở|Sửa)/ })
    .first()
    .click();

  const nodes = page.locator("[data-stage-uid]");
  await expect(nodes.first()).toBeVisible({ timeout: 30_000 });
  // CR-123 · u13: bố cục ELK tính bất đồng bộ (worker) ⇒ đợi số node ổn định rồi mới đếm
  let before = 0;
  await expect
    .poll(async () => {
      const n = await nodes.count();
      const same = n === before;
      before = n;
      return same && n > 1;
    })
    .toBe(true);
  const pane = page.locator(".react-flow__pane").first();
  const paneBox = await pane.boundingBox();
  if (!paneBox) throw new Error("không thấy canvas");
  const at = { x: paneBox.width * 0.88, y: paneBox.height * 0.55 };

  // u5 · thả "Thông báo" ⇒ node ĐỨNG RIÊNG: thêm đúng một node, KHÔNG có cạnh mới, có gợi ý nối
  const edges = page.locator(".react-flow__edge");
  const edgesBefore = await edges.count();
  await page.getByTestId("flow-add-step").click();
  await page
    .getByRole("menuitem", { name: /^Thông báo/ })
    .first()
    .dragTo(pane, { targetPosition: at, force: true });
  await expect(nodes).toHaveCount(before + 1);
  await expect(edges).toHaveCount(edgesBefore);
  const free = page.locator(".react-flow__node").filter({ has: page.getByTestId("free-hint") });
  await expect(free).toHaveCount(1);
  await expect(page.getByTestId("free-hint")).toContainText("Kéo mũi tên để nối bước này");
  // (nối bằng kéo mũi tên + gỡ cờ: unit lib/u5-free-drop.test.ts; kéo chuột thật tới cổng chưa ổn định trong stack này — hàng chờ)
});
