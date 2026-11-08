// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-125 · cr125-parallel-approval-ui · HÀNH TRÌNH «A + B cùng duyệt» trên stack thật `playwright.journey.config.ts`, công ty MỚI `e2e-par-<hậu tố>`:
//  1) quản trị công ty mở bản sao của quy trình, bật «Duyệt cùng lúc nhiều nhóm» cho 2 nhóm (Kế toán + Giám đốc), luật «Tất cả», Lưu và áp dụng
//     ⇒ canvas hiện «Cùng duyệt: … · Tất cả»; HĐ gửi duyệt ⇒ kế toán duyệt (bước còn mở, chờ Giám đốc) ⇒ Giám đốc duyệt ⇒ bước qua.
//  2) HĐ khác: kế toán Từ chối ⇒ thẻ của Giám đốc đóng, hiện lý do «Đã có người từ chối/trả lại».
// Ảnh (outputPath của lượt chạy) sao vào docs/specs/cr125-parallel-approval-ui/.
import { expect, type Page, test } from "@playwright/test";
import { apiLogin, assignCompanyFlow } from "../_kit/api";
import { approve, createLibraryFlow, enableFlowTriggers, finish } from "../_kit/flows";
import { flowRows, loginTenantAdminUi, openCompanyFlows } from "../_kit/ui";
import { withOwner } from "../support/helpers";
import { approveAs, confirmAndSave, type Env, loginCw, stepOf, U, uploadAndOpen } from "./_journey";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
const SFX = need("JA_D5_SUFFIX");
const API = need("JA_API_URL");
const HUB = need("JA_HUB_URL");
const E: Env = {
  cw: need("JA_CW_URL"),
  admin: need("JA_ADMIN_URL"),
  pw: need("JA_USER_PW"),
  adminUser: need("SEED_ADMIN_USERNAME"),
  adminPw: need("SEED_ADMIN_PASSWORD"),
  tenantKey: `e2e-par-${SFX}`,
  tenantName: `E2E PAR ${SFX}`,
};
const FLOW = `Cùng duyệt ${SFX}`;
const STEP = "Duyệt hợp đồng";
const CANVAS = { name: "Canvas quy trình" };

const ctxPage = async (browser: import("@playwright/test").Browser): Promise<Page> =>
  (await browser.newContext({ locale: "vi-VN", viewport: { width: 1280, height: 900 } })).newPage();

let tenantId = "";
let acc = "";
let dir = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const platform = await apiLogin({
    base: API,
    tenantKey: "platform",
    username: E.adminUser,
    password: E.adminPw,
  });
  const flowId = await createLibraryFlow(HUB, platform.token, {
    key: `par-${SFX}`,
    name: FLOW,
    app: "contracts",
    trigger: { event: "contract.submitted" },
    stages: [
      approve("duyet", STEP, 0, "pb-ke-toan", { reject: 2 }),
      finish("xong", "Đã duyệt", 1, "approved"),
      finish("tu-choi", "Từ chối", 2, "rejected"),
    ],
  });
  tenantId = await enableFlowTriggers(E.tenantKey, false);
  await assignCompanyFlow(HUB, platform, tenantId, flowId);
  const names = await withOwner(
    (sql) => sql<
      { key: string; name: string }[]
    >`select key, coalesce(name->>'vi', name::text) as name
      from admin.groups where tenant_id = ${tenantId}::uuid and key in ('pb-ke-toan', 'pb-giam-doc')`,
  );
  acc = names.find((n) => n.key === "pb-ke-toan")?.name ?? "";
  dir = names.find((n) => n.key === "pb-giam-doc")?.name ?? "";
});

/** Mở HĐ và chờ bước `STEP` có trạng thái `status` (tải lại tới khi lượt chạy đã mở thẻ — trang không tự làm mới). */
async function seeStep(page: Page, id: string, status: string): Promise<void> {
  await expect(async () => {
    await page.goto(`${E.cw}/contracts/c/${id}`);
    await expect(stepOf(page, STEP)).toHaveAttribute("data-status", status, { timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
}

/** Quản trị công ty: «Sao chép để sửa» (lần đầu) rồi mở bản sao ở trình sửa. */
async function openCopy(page: Page): Promise<void> {
  await loginTenantAdminUi(page, E.admin, E.tenantKey, U.director, E.pw);
  await page.goto(`${E.admin}/tenants/${tenantId}?tab=processes`);
  const box = await openCompanyFlows(page);
  let copy = flowRows(box).filter({ hasText: "Sao từ" });
  if ((await copy.count()) === 0) {
    await flowRows(box)
      .filter({ hasText: "Được gán" })
      .getByRole("button", { name: "Sao chép để sửa" })
      .click();
    await page.getByTestId("copy-confirm").click();
    copy = flowRows(box).filter({ hasText: "Sao từ" });
    await expect(copy).toBeVisible();
  }
  await copy.getByRole("link", { name: "Mở", exact: true }).click();
  await expect(page.getByRole("application", CANVAS)).toBeVisible();
}

test("1 · quản trị công ty bật Cùng duyệt (Tất cả, 2 nhóm) ⇒ canvas nói rõ; cả hai lần lượt duyệt ⇒ bước qua", async ({
  browser,
}, testInfo) => {
  test.setTimeout(420_000);
  const page = await ctxPage(browser);
  await openCopy(page);
  const canvas = page.getByRole("application", CANVAS);
  await canvas.locator("[data-stage-uid]").filter({ hasText: STEP }).first().click();

  // panel: công tắc → hai nhóm → luật Tất cả
  await page.getByTestId("parallel-toggle").click();
  await expect(page.getByTestId("parallel-groups").locator("li")).toHaveCount(2);
  await page.getByRole("combobox", { name: "Nhóm 2" }).click();
  await page.getByRole("option", { name: dir, exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Khi nào bước được duyệt" })).toContainText(
    "Tất cả",
  );
  await page
    .getByTestId("stage-approve-parallel")
    .screenshot({ path: testInfo.outputPath("panel.png") });

  // canvas: «Cùng duyệt: A + B · Tất cả»
  const node = canvas.locator("[data-stage-uid]").filter({ hasText: STEP }).first();
  await expect(node).toContainText("Cùng duyệt:");
  await expect(node).toContainText(`${acc} + ${dir}`);
  await expect(node).toContainText("Tất cả");
  await node.screenshot({ path: testInfo.outputPath("canvas-node.png") });

  await page.getByRole("button", { name: "Lưu và áp dụng" }).first().click();
  await expect(page.getByRole("alert").filter({ hasText: /PARALLEL_/ })).toHaveCount(0);
  await page.reload();
  await expect(
    page
      .getByRole("application", CANVAS)
      .locator("[data-stage-uid]")
      .filter({ hasText: "Cùng duyệt:" }),
  ).toBeVisible();

  // HĐ chạy: nhân viên gửi; kế toán duyệt ⇒ bước còn mở (chờ Giám đốc); Giám đốc duyệt ⇒ bước qua
  const emp = await ctxPage(browser);
  await loginCw(emp, E, U.employee);
  const id = await uploadAndOpen(emp, E, `p${Date.now().toString(36)}`, 50_000_000);
  await confirmAndSave(emp);

  const a = await ctxPage(browser);
  await loginCw(a, E, U.accounting);
  await seeStep(a, id, "open");
  await a.locator("[data-approval=pass], [data-approval=approve]").first().click();
  await expect(a.locator("[data-approval=pass], [data-approval=approve]")).toHaveCount(0);
  await expect(stepOf(a, STEP)).toHaveAttribute("data-status", "open"); // còn chờ Giám đốc
  await a.screenshot({ path: testInfo.outputPath("the-ke-toan-da-duyet.png") });

  await approveAs(await ctxPage(browser), E, U.director, id, STEP);
  await emp.goto(`${E.cw}/contracts/c/${id}`);
  await expect(stepOf(emp, STEP)).toHaveAttribute("data-status", "passed", { timeout: 60_000 });
});

test("2 · một nhóm Từ chối ⇒ bước dừng; thẻ nhóm còn lại đóng và nói lý do", async ({
  browser,
}, testInfo) => {
  test.setTimeout(420_000);
  const emp = await ctxPage(browser);
  await loginCw(emp, E, U.employee);
  const id = await uploadAndOpen(emp, E, `q${Date.now().toString(36)}`, 50_000_000);
  await confirmAndSave(emp);

  const a = await ctxPage(browser);
  await loginCw(a, E, U.accounting);
  await seeStep(a, id, "open");
  await a.locator("[data-approval=reject]").click();
  const form = a.locator("[data-approval=reason]");
  await form.getByRole("textbox").fill("Giá cao hơn hạn mức");
  await form.getByRole("button", { name: "Từ chối" }).click();
  // Từ chối đi theo `reject_step` (node Kết thúc · Từ chối) ⇒ bước đã quyết xong, không còn mở
  await expect(stepOf(a, STEP)).not.toHaveAttribute("data-status", "open", { timeout: 60_000 });

  const d = await ctxPage(browser);
  await loginCw(d, E, U.director);
  await d.goto(`${E.cw}/contracts/c/${id}`);
  await expect(d.locator("[data-approval=pass], [data-approval=approve]")).toHaveCount(0);
  await expect(stepOf(d, STEP)).toContainText("Đã đóng");
  await expect(stepOf(d, STEP)).toContainText("Đã có người từ chối/trả lại");
  await d.screenshot({ path: testInfo.outputPath("the-giam-doc-da-dong.png") });
});
