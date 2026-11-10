// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-124 · q6 · FLOW4-FR-01/02/06/07/11/16 · HÀNH TRÌNH gửi hợp đồng cho đối tác trên stack thật `playwright.journey.config.ts` (HUB_PARTNER_MAILBOX bật),
// hai công ty MỚI `e2e-q6a-<hậu tố>` (A, gửi) và `e2e-q6b-<hậu tố>` (B, nhận). Chuẩn bị đi đường thật (D5): platform admin điền hồ sơ + bật tính năng
// `contracts-partner-confirm` qua API entitlement; quản trị B bật "cho phép tìm thấy" và tạo nhóm duyệt; flow gán qua danh sách flow công ty (mẫu Thư viện
// «Nhận HĐ thường» của hub 0121 gán cho B). Khác DUY NHẤT so với người dùng thật: flow phía A dựng bằng API (UI thêm node đã có spec editor riêng).
//  1. NV A tải HĐ 600 triệu → Gửi duyệt → Giám đốc A duyệt → node «Gửi đối tác xác nhận» chạy; B CHƯA nối ⇒ thẻ A «Đang chờ công ty nhận đồng ý kết nối».
//  2. Quản trị B thấy lời mời ở «Hợp đồng đối tác gửi», bấm «Nhận HĐ từ công ty này» ⇒ lần gửi được thả ⇒ HĐ nhận hiện ở hộp thư B.
//  3. Flow nhận của B: người xác nhận bấm Đạt ⇒ A nhận `partner.confirmed` ⇒ flow A chạy tiếp «Đã xác nhận» ⇒ HĐ A khoá; thẻ A «đã xác nhận».
//  4. Biến thể «Trả lại sửa»: B trả lại có lý do ⇒ A thấy thẻ «đã trả lại» + đúng lý do.
// CR-126: trước khi gửi, người của «Nhóm phụ trách gửi đối tác» làm bước «Chọn đối tác & người nhận» ở «Việc của tôi» (đối tác + email điền sẵn, đổi email, «Gửi»);
//  thư/hộp thư đi tới đúng email ĐÃ CHỌN.
import type { Page } from "@playwright/test";
import {
  apiLogin,
  assignCompanyFlow,
  createGroupWith,
  featureIdByKey,
  grantFeature,
  libraryDefIdByName,
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
import { safeReload } from "../_kit/ui";
import { withOwner } from "../support/helpers";
import { confirmAndSave, type Env, loginCw, stepOf, U, uploadAndOpen } from "./_journey";
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
const EA = env(`e2e-q6a-${SFX}`, `E2E Q6A ${SFX}`);
const EB = env(`e2e-q6b-${SFX}`, `E2E Q6B ${SFX}`);
const TAX_A = "0100000011";
const TAX_B = "0100000022";
const RUN = Date.now().toString(36);
/** Ảnh chụp ghi vào thư mục kết quả của ca (evotest kéo về cùng báo cáo). */
const shot = (n: string): string => test.info().outputPath(`cr124-q6-${n}.png`);
const ctx = async (browser: import("@playwright/test").Browser, w = 1440): Promise<Page> =>
  (await browser.newContext({ locale: "vi-VN", viewport: { width: w, height: 900 } })).newPage();

test.describe.configure({ mode: "serial" });

/** Gửi HĐ mới ở A: nhân viên tải + Gửi duyệt, Giám đốc A duyệt, rồi chọn đối tác & email người nhận (CR-126). Trả {id, emp, chosen}. */
async function sendFromA(browser: import("@playwright/test").Browser, tag: string) {
  const emp = await ctx(browser);
  await loginCw(emp, EA, U.employee);
  const id = await uploadAndOpen(emp, EA, `${RUN}${tag}`, 600_000_000);
  await confirmAndSave(emp);
  await expect(stepOf(emp, "Giám đốc duyệt")).toBeVisible({ timeout: 120_000 });
  const dir = await ctx(browser);
  const { approveAs } = await import("./_journey");
  await approveAs(dir, EA, U.director, id, "Giám đốc duyệt");
  const chosen = await pickPartnerAndSend(await ctx(browser), EA, U.director, {
    partnerTaxCode: TAX_B,
    email: `chon-${RUN}${tag}@doitac.test`,
    contractCreator: U.employee,
    partnerAddedBy: U.accounting, // G3: đối tác do kế toán thêm, giám đốc (người chọn) không phải người thêm
  });
  return { id, emp, chosen };
}

/** Mở lại trang HĐ cho tới khi khối «Gửi đối tác xác nhận» có thẻ vòng gửi chứa `text`. */
async function expectRound(page: Page, cw: string, id: string, text: RegExp) {
  await page.goto(`${cw}/contracts/c/${id}`);
  let n = 0;
  try {
    await expect(async () => {
      if (n++ > 0) await safeReload(page);
      await expect(page.getByTestId("partner-round-status").first()).toHaveText(text, {
        timeout: 5_000,
      });
    }).toPass({ timeout: 120_000 });
  } catch (e) {
    // Chẩn đoán: bước nào của lượt chạy dừng và vì sao (DB test, không dữ liệu nhạy cảm).
    const rows = await withOwner(
      (
        sql,
      ) => sql`select s.stage_idx, s.status, left(coalesce(s.feedback, ''), 200) as fb, r.status as run_status, left(coalesce(r.decision::text, ''), 300) as decision
        from hub.stage_runs s join hub.process_runs r on r.id = s.process_run_id
        where r.tenant_id = (select id from admin.tenants where key = ${EA.tenantKey}) order by r.started_at desc, s.stage_idx`,
    );
    const audit = await withOwner(
      (sql) => sql`select action, left(summary::text, 300) as summary from hub.audit_log
        where tenant_id = (select id from admin.tenants where key = ${EA.tenantKey}) order by seq desc limit 12`,
    );
    console.log("DIAG-STAGES", JSON.stringify(rows));
    console.log("DIAG-AUDIT", JSON.stringify(audit));
    throw e;
  }
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const platform = await apiLogin({
    base: API,
    tenantKey: "platform",
    username: EA.adminUser,
    password: EA.adminPw,
  });
  const idA = await tenantIdByKey(API, platform, EA.tenantKey);
  const idB = await tenantIdByKey(API, platform, EB.tenantKey);
  // Hồ sơ công ty (tên pháp lý + MST) — nguồn duy nhất của danh bạ (admin.tenants).
  await setCompanyProfile(API, platform, idA, {
    legal_name: `Công ty Gửi Q6A ${SFX}`,
    tax_code: TAX_A,
    address: "1 Phố Gửi, Hà Nội",
  });
  await setCompanyProfile(API, platform, idB, {
    legal_name: `Công ty Nhận Q6B ${SFX}`,
    tax_code: TAX_B,
    address: "2 Phố Nhận, Hà Nội",
  });
  // Bật tính năng bằng đường entitlement thật (không seed cờ).
  const fid = await featureIdByKey(API, platform, "contracts-partner-confirm");
  await grantFeature(API, platform, fid, idA);
  await grantFeature(API, platform, fid, idB);
  // Quản trị B: cho phép tìm thấy + nhóm duyệt mà flow nhận dùng.
  const bAdmin = await apiLogin({
    base: API,
    tenantKey: EB.tenantKey,
    username: U.director,
    password: PW,
  });
  await setDirectoryListed(API, bAdmin, idB, true);
  // Người duyệt của B = kế toán; quản trị (Giám đốc) là người nhận hộp thư (người gây sự kiện, bị loại khỏi duyệt).
  for (const [key, name] of [
    ["phong-kinh-doanh", "Phòng Kinh doanh"],
    ["ke-toan", "Kế toán"],
    ["giam-doc", "Giám đốc"],
  ] as const)
    await createGroupWith(API, bAdmin, { key, name, usernames: [U.director, U.accounting] });
  // B: flow nhận mặc định (đường sự kiện bắt buộc) gán qua danh sách flow công ty.
  await enableFlowTriggers(EB.tenantKey);
  await assignCompanyFlow(
    HUB,
    platform,
    idB,
    await libraryDefIdByName(HUB, platform, "Nhận HĐ thường"),
  );
  await seedPartner(EA.tenantKey, TAX_B, `Công ty Nhận Q6B ${SFX}`, U.accounting); // đối tác của A (danh sách chọn ở bước «Chọn đối tác & người nhận»)
  // A: Duyệt → Gửi đối tác xác nhận → (Đã xác nhận | Trả lại sửa | Từ chối).
  const flowId = await createLibraryFlow(HUB, platform.token, {
    key: `q6a-${SFX}`,
    name: `Gửi đối tác ${SFX}`,
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
  await enableFlowTriggers(EA.tenantKey);
  await assignCompanyFlow(HUB, platform, idA, flowId);
});

test("1 · gửi lần đầu: giữ chờ kết nối → B nhận lời mời → thả → B duyệt → A chạy tiếp «Đã xác nhận»", async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const { id, emp, chosen } = await sendFromA(browser, "a");

  // A: lần gửi đầu tới công ty chưa nối ⇒ thẻ chờ kết nối (không «bị chặn»)
  await expectRound(emp, EA.cw, id, /Đang chờ công ty nhận đồng ý kết nối/);
  await emp.screenshot({ path: shot("a-held"), fullPage: true });

  // B: lời mời nối ở hộp «Hợp đồng đối tác gửi»
  const b = await ctx(browser);
  await loginCw(b, EB, U.director);
  await b.goto(`${EB.cw}/contracts/partner-inbox`);
  await expect(b.getByTestId("partner-invite")).toBeVisible({ timeout: 60_000 });
  await b.screenshot({ path: shot("b-invite"), fullPage: true });
  await b.getByRole("button", { name: "Nhận HĐ từ công ty này" }).click();

  // lần gửi được thả ⇒ HĐ nhận hiện ở hộp thư B, thẻ 3 dòng
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
  await expectMailboxTo(id, chosen, EB.tenantKey); // thư đi tới email người dùng đã chọn ở bước «Chọn đối tác & người nhận»
  await card.getByRole("link", { name: "Mở" }).click();
  await b.waitForURL(/\/contracts\/c\/[0-9a-f-]{36}/);
  const inboxId = /\/contracts\/c\/([0-9a-f-]{36})/.exec(b.url())?.[1] ?? "";
  expect(inboxId).not.toBe("");

  // B: flow nhận mặc định chạy ⇒ người xác nhận bấm Đạt
  const { approveAs } = await import("./_journey");
  const bApprover = await ctx(browser);
  await approveAs(bApprover, EB, U.director, inboxId, "Người xác nhận");

  // A: chạy tiếp «Đã xác nhận», HĐ khoá, thẻ vòng gửi «đã xác nhận»
  await expectRound(emp, EA.cw, id, /đã xác nhận/);
  await expect(emp.getByTestId("banner-locked")).toBeVisible({ timeout: 120_000 });
  // Bước «Gửi đối tác xác nhận» nói chữ đối tác (không «Đã ký»): đối tác đã xác nhận.
  await expect(emp.getByTestId("approval-step-module")).toContainText("Đối tác đã xác nhận");
  await emp.screenshot({ path: shot("a-confirmed"), fullPage: true });
});

test("2 · «Trả lại sửa»: B trả lại có lý do ⇒ A thấy thẻ «đã trả lại» + đúng lý do, flow A rẽ nhánh Trả lại sửa", async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const REASON = "Sai đơn giá mục 3";
  const { id, emp } = await sendFromA(browser, "b");
  const b = await ctx(browser);
  await loginCw(b, EB, U.director);
  await b.goto(`${EB.cw}/contracts/partner-inbox`);
  const card = b.getByTestId("partner-inbox-card").filter({ hasText: "Chờ công ty bạn xác nhận" });
  let n = 0;
  await expect(async () => {
    if (n++ > 0) await safeReload(b);
    await expect(card.first()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 120_000 });
  await card.first().getByRole("link", { name: "Mở" }).click();
  await b.waitForURL(/\/contracts\/c\/[0-9a-f-]{36}/);
  await expect(stepOf(b, "Người xác nhận")).toHaveAttribute("data-status", "open", {
    timeout: 60_000,
  });
  await b.locator("[data-approval=return]").click();
  const form = b.locator("[data-approval=reason]");
  await form.getByRole("textbox").fill(REASON);
  await form.getByRole("button", { name: /^Trả lại/ }).click();

  await expectRound(emp, EA.cw, id, /đã trả lại/);
  const round = emp.getByTestId("partner-round").first();
  await expect(round).toContainText(REASON);
  await expect(round).toContainText("Sửa hợp đồng");
  await expect(emp.getByTestId("banner-locked")).toHaveCount(0); // trả lại ⇒ HĐ chưa khoá, sửa được
  await emp.screenshot({ path: shot("a-returned"), fullPage: true });
});

test("3 · Cài đặt nhận HĐ đối tác của B: ngưỡng + người phụ trách (chụp màn hình)", async ({
  browser,
}) => {
  const b = await ctx(browser);
  await loginCw(b, EB, U.director);
  await b.goto(`${EB.cw}/contracts/settings?sec=flow`);
  const box = b.getByTestId("partner-receive-settings");
  await expect(box).toBeVisible({ timeout: 60_000 });
  await box.scrollIntoViewIfNeeded();
  await b.screenshot({ path: shot("b-settings") });
});
