// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-125 · UX-S7 (H7) · HÀNH TRÌNH THẬT bật «Đối tác xác nhận hợp đồng» bằng giao diện rồi dùng nó, hai công ty MỚI `e2e-s7a-<hậu tố>` (A gửi) và `e2e-s7b-<hậu tố>` (B nhận),
// stack `playwright.journey.config.ts` (HUB_PARTNER_MAILBOX bật). KHÔNG cấp tính năng bằng API, không seed cờ:
//  1. Platform admin mở Công ty › Ứng dụng: thẻ «Đối tác xác nhận hợp đồng» đang tắt, mỗi điều kiện có trạng thái + lý do; bấm «Bật tính năng» (A và B);
//     với B bấm «Gán quy trình nhận» ⇒ điều kiện «quy trình nhận» xong. (Hồ sơ pháp lý, «cho phép tìm thấy» và nhóm xác nhận là việc của quản trị công ty / mở hồ sơ: dựng bằng API
//     như q6; quy trình GỬI của A dựng bằng API vì UI thêm node đã có spec editor riêng.)
//  2. Quản trị công ty (B) mở Ứng dụng: thấy trạng thái thật, KHÔNG có công tắc/nút làm hộ (quyền cấp chỉ ở platform).
//  3. A gửi hợp đồng cho B → B thấy ở hộp thư đối tác, nhận lời mời, xác nhận → A thấy «đã xác nhận».
import type { Page } from "@playwright/test";
import {
  apiLogin,
  assignCompanyFlow,
  createGroupWith,
  setCompanyProfile,
  setDirectoryListed,
  tenantIdByKey,
} from "../_kit/api";
import {
  approve,
  createLibraryFlow,
  enableFlowTriggers,
  finish,
  partnerSendNode,
} from "../_kit/flows";
import { loginTenantAdminUi, openTenantAppsTab, safeReload } from "../_kit/ui";
import {
  approveAs,
  confirmAndSave,
  type Env,
  loginAdmin,
  loginCw,
  stepOf,
  U,
  uploadAndOpen,
} from "./_journey";
import { expectMailboxTo, pickPartnerAndSend, seedPartner } from "./_partner-pick";
import { expect, test } from "./_test";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
const SFX = need("JA_D5_SUFFIX");
const API = need("JA_API_URL");
const HUB = need("JA_HUB_URL");
const PW = need("JA_USER_PW");
const env = (k: string, name: string): Env => ({
  cw: need("JA_CW_URL"),
  admin: need("JA_ADMIN_URL"),
  pw: PW,
  adminUser: need("SEED_ADMIN_USERNAME"),
  adminPw: need("SEED_ADMIN_PASSWORD"),
  tenantKey: k,
  tenantName: name,
});
const EA = env(`e2e-s7a-${SFX}`, `E2E S7A ${SFX}`);
const EB = env(`e2e-s7b-${SFX}`, `E2E S7B ${SFX}`);
const RUN = Date.now().toString(36);
const shot = (n: string): string => test.info().outputPath(`cr125-s7-${n}.png`);
const ctx = async (browser: import("@playwright/test").Browser, w = 1440): Promise<Page> =>
  (await browser.newContext({ locale: "vi-VN", viewport: { width: w, height: 900 } })).newPage();
const item = (page: Page, key: string) =>
  page.getByTestId("partner-confirm").getByTestId(`partner-item-${key}`);

test.describe.configure({ mode: "serial" });

let sendFlowId = "";
let platformSession: Awaited<ReturnType<typeof apiLogin>>;
let idA = "";
let idB = "";

test.beforeAll(async () => {
  test.setTimeout(240_000);
  platformSession = await apiLogin({
    base: API,
    tenantKey: "platform",
    username: EA.adminUser,
    password: EA.adminPw,
  });
  idA = await tenantIdByKey(API, platformSession, EA.tenantKey);
  idB = await tenantIdByKey(API, platformSession, EB.tenantKey);
  // Hồ sơ pháp lý (việc ở tab Hồ sơ) + phần của quản trị công ty B: «cho phép tìm thấy» và nhóm xác nhận có người.
  await setCompanyProfile(API, platformSession, idA, {
    legal_name: `Công ty Gửi S7A ${SFX}`,
    tax_code: "0100000033",
    address: "1 Phố Gửi, Hà Nội",
  });
  await setCompanyProfile(API, platformSession, idB, {
    legal_name: `Công ty Nhận S7B ${SFX}`,
    tax_code: "0100000044",
    address: "2 Phố Nhận, Hà Nội",
  });
  const bAdmin = await apiLogin({
    base: API,
    tenantKey: EB.tenantKey,
    username: U.director,
    password: PW,
  });
  await setDirectoryListed(API, bAdmin, idB, true);
  for (const [key, name] of [
    ["phong-kinh-doanh", "Phòng Kinh doanh"],
    ["ke-toan", "Kế toán"],
    ["giam-doc", "Giám đốc"],
  ] as const)
    await createGroupWith(API, bAdmin, { key, name, usernames: [U.director, U.accounting] });
  await enableFlowTriggers(EB.tenantKey);
  await enableFlowTriggers(EA.tenantKey);
  await seedPartner(EA.tenantKey, "0100000044", `Công ty Nhận S7B ${SFX}`, U.accounting); // đối tác của A cho danh sách chọn
  // Flow GỬI của A (mẫu Thư viện có bước «Gửi đối tác xác nhận»): dựng sẵn, gán SAU khi bật tính năng ở giao diện (readiness chặn gán khi chưa có tính năng).
  sendFlowId = await createLibraryFlow(HUB, platformSession.token, {
    key: `s7a-${SFX}`,
    name: `Gửi đối tác S7 ${SFX}`,
    app: "contracts",
    trigger: { event: "contract.submitted" },
    inputs: [{ key: "contract_id", label: "Hợp đồng", type: "text", required: true }],
    stages: [
      approve("giam-doc", "Giám đốc duyệt", 0, "pb-giam-doc", { reject: 5, ret: 6 }),
      ...partnerSendNode(
        1,
        {
          assignee_group: "pb-giam-doc", // mã nhóm (flow Thư viện dùng mã, không id công ty)
          send_fields: "total_value",
          reply_days: 7,
          message: "Xin quý công ty xác nhận hợp đồng",
        },
        { returned: 6, declined: 5, expired: 5 },
      ),
      finish("da-xac-nhan", "Đã xác nhận", 4, "approved"),
      finish("tu-choi", "Đối tác từ chối", 5, "rejected"),
      finish("tra-lai", "Trả lại sửa", 6, "returned"),
    ],
  });
});

test("1 · platform admin bật Đối tác xác nhận bằng giao diện: điều kiện hiện đúng trạng thái, bấm Làm bước này", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const page = await ctx(browser);
  await loginAdmin(page, EA);

  // --- B (bên nhận) ---
  await openTenantAppsTab(page, EB.tenantName);
  const card = page.getByTestId("partner-confirm");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toHaveAttribute("data-on", "no");
  await expect(page.getByTestId("partner-status")).toHaveText("Đang tắt");
  await expect(item(page, "feature")).toHaveAttribute("data-state", "todo");
  await expect(item(page, "feature")).toContainText("chưa được cấp");
  await expect(item(page, "profile")).toHaveAttribute("data-state", "ok");
  await expect(item(page, "listed")).toHaveAttribute("data-state", "ok");
  await expect(item(page, "channel")).toHaveAttribute("data-state", "ok");
  await page.screenshot({ path: shot("b-off"), fullPage: true });
  await page.getByTestId("partner-fix-grant-feature").click();
  await expect(card).toHaveAttribute("data-on", "yes");
  await expect(item(page, "feature")).toHaveAttribute("data-state", "ok");
  await expect(item(page, "receive_flow")).toHaveAttribute("data-state", "todo");
  await page.getByTestId("partner-fix-assign-receive-flow").click();
  await expect(item(page, "receive_flow")).toHaveAttribute("data-state", "ok");
  await expect(item(page, "groups")).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("partner-status")).toContainText("còn 1 điều kiện"); // chỉ thiếu quy trình GỬI (B chỉ nhận)
  await page.screenshot({ path: shot("b-on"), fullPage: true });

  // --- A (bên gửi) ---
  await openTenantAppsTab(page, EA.tenantName);
  await expect(page.getByTestId("partner-confirm")).toHaveAttribute("data-on", "no", {
    timeout: 60_000,
  });
  // công tắc thật (không chỉ nút trong danh sách)
  await page.getByTestId("partner-confirm-switch").click();
  await expect(page.getByTestId("partner-confirm")).toHaveAttribute("data-on", "yes");
  await assignCompanyFlow(HUB, platformSession, idA, sendFlowId);
  await safeReload(page);
  await expect(item(page, "send_flow")).toHaveAttribute("data-state", "ok", { timeout: 60_000 });
  await expect(item(page, "feature")).toHaveAttribute("data-state", "ok");
  await page.screenshot({ path: shot("a-on"), fullPage: true });
});

test("2 · quản trị công ty chỉ xem: thấy trạng thái thật, không có công tắc bật/tắt hay nút làm hộ", async ({
  browser,
}) => {
  const page = await ctx(browser);
  await loginTenantAdminUi(page, EB.admin, EB.tenantKey, U.director, PW);
  await page.goto(`${EB.admin}/tenants/${idB}?tab=apps`);
  const card = page.getByTestId("partner-confirm");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toHaveAttribute("data-on", "yes");
  await expect(page.getByTestId("partner-confirm-switch")).toBeDisabled();
  await expect(card.locator('[data-testid^="partner-fix-"]')).toHaveCount(0);
  await expect(card).toContainText("Quản trị công ty làm");
  await page.screenshot({ path: shot("company-view"), fullPage: true });

  // Cài đặt của Sổ Hợp Tác (quản trị công ty B): trạng thái thật + điều kiện, nói ai phải làm (rule 3), không có công tắc nào.
  const cw = await ctx(browser);
  await loginCw(cw, EB, U.director);
  await cw.goto(`${EB.cw}/contracts/settings?sec=flow`);
  const st = cw.getByTestId("partner-confirm-status");
  await expect(st).toBeVisible({ timeout: 60_000 });
  await expect(st).toHaveAttribute("data-on", "yes");
  await expect(cw.getByTestId("partner-confirm-item-feature")).toHaveAttribute("data-state", "ok");
  await expect(cw.getByTestId("partner-confirm-item-receive_flow")).toHaveAttribute(
    "data-state",
    "ok",
  );
  await expect(cw.getByTestId("partner-confirm-item-send_flow")).toContainText(
    "Quản trị công ty làm",
  );
  await expect(cw.getByTestId("partner-receive-settings")).toBeVisible();
  await cw.screenshot({ path: shot("cw-settings"), fullPage: true });
});

test("3 · công ty A gửi hợp đồng cho B: B thấy ở hộp thư đối tác, nhận lời mời, xác nhận ⇒ A thấy «đã xác nhận»", async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const emp = await ctx(browser);
  await loginCw(emp, EA, U.employee);
  const id = await uploadAndOpen(emp, EA, `${RUN}s7`, 600_000_000);
  await confirmAndSave(emp);
  await expect(stepOf(emp, "Giám đốc duyệt")).toBeVisible({ timeout: 120_000 });
  const dir = await ctx(browser);
  await approveAs(dir, EA, U.director, id, "Giám đốc duyệt");
  // CR-126: bước «Chọn đối tác & người nhận» (Việc của tôi) trước khi gửi; thư đi tới email đã chọn.
  const chosen = await pickPartnerAndSend(await ctx(browser), EA, U.director, {
    partnerTaxCode: "0100000044",
    email: `chon-${RUN}s7@doitac.test`,
    contractCreator: U.employee,
    partnerAddedBy: U.accounting, // G3
  });

  // B: lời mời nối → nhận → hộp thư → xác nhận
  const b = await ctx(browser);
  await loginCw(b, EB, U.director);
  await b.goto(`${EB.cw}/contracts/partner-inbox`);
  await expect(b.getByTestId("partner-invite")).toBeVisible({ timeout: 120_000 });
  await b.getByRole("button", { name: "Nhận HĐ từ công ty này" }).click();
  const card = b.getByTestId("partner-inbox-card").first();
  let n = 0;
  await expect(async () => {
    if (n++ > 0) await safeReload(b);
    await expect(card).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 120_000 });
  await expect(card.getByTestId("partner-inbox-card-status")).toContainText(
    "Chờ công ty bạn xác nhận",
  );
  await b.screenshot({ path: shot("b-inbox"), fullPage: true });
  await expectMailboxTo(id, chosen, EB.tenantKey);
  await card.getByRole("link", { name: "Mở" }).click();
  await b.waitForURL(/\/contracts\/c\/[0-9a-f-]{36}/);
  const inboxId = /\/contracts\/c\/([0-9a-f-]{36})/.exec(b.url())?.[1] ?? "";
  expect(inboxId).not.toBe("");
  await approveAs(await ctx(browser), EB, U.director, inboxId, "Người xác nhận");

  // A: thẻ vòng gửi «đã xác nhận», HĐ khoá
  await emp.goto(`${EA.cw}/contracts/c/${id}`);
  let m = 0;
  await expect(async () => {
    if (m++ > 0) await safeReload(emp);
    await expect(emp.getByTestId("partner-round-status").first()).toHaveText(/đã xác nhận/, {
      timeout: 5_000,
    });
  }).toPass({ timeout: 120_000 });
  await expect(emp.getByTestId("banner-locked")).toBeVisible({ timeout: 120_000 });
  await emp.screenshot({ path: shot("a-confirmed"), fullPage: true });
});
