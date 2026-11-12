// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-123 · u6b · FLOW3-FR-14 · HÀNH TRÌNH thẻ duyệt: HĐ đi qua bước Duyệt tới node Ký số (gửi + chờ) bằng "Ký thử" (selfsign, không cần DocuSign).
// Thẻ phải có MỘT dòng "Ký số" với "Đang chờ ký" + tên người ký (không có dòng "Chờ ký" riêng); sau khi người ký bấm "Ký ngay" ⇒ "Đã ký".
// Công ty MỚI `e2e-u6-<hậu tố>`; quy trình công ty dựng từ sơ đồ trống qua API platform admin (`_kit/flows.ts`).

import type { Page } from "@playwright/test";
import { apiLogin } from "../_kit/api";
import {
  approve,
  createCompanyFlow,
  enableFlowTriggers,
  esignNode,
  finish,
  plainSet,
} from "../_kit/flows";
import { withOwner } from "../support/helpers";
import { approveAs, confirmAndSave, type Env, loginCw, U, uploadAndOpen } from "./_journey";
import { expect, test } from "./_test";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
const SFX = need("JA_D5_SUFFIX");
const E: Env = {
  cw: need("JA_CW_URL"),
  admin: need("JA_ADMIN_URL"),
  pw: need("JA_USER_PW"),
  adminUser: need("SEED_ADMIN_USERNAME"),
  adminPw: need("SEED_ADMIN_PASSWORD"),
  tenantKey: `e2e-u6-${SFX}`,
  tenantName: `E2E U6 ${SFX}`,
};
const FLOW = `Duyệt + Ký số ${SFX}`;
const SHOTS = "docs/specs/CR-123/shots/u6";
const ctxPage = async (browser: import("@playwright/test").Browser): Promise<Page> =>
  (await browser.newContext({ locale: "vi-VN", viewport: { width: 1280, height: 900 } })).newPage();

test("u6 · thẻ duyệt: MỘT dòng Ký số — Đang chờ ký + người ký, sau khi ký ⇒ Đã ký", async ({
  browser,
}, testInfo) => {
  test.setTimeout(420_000);
  // — chuẩn bị: flow Duyệt → Ký số → Kết thúc; công ty bật ký số với nhà cung cấp Ký thử; người ký = nhân viên gửi HĐ —
  const platform = await apiLogin({
    base: need("JA_API_URL"),
    tenantKey: "platform",
    username: E.adminUser,
    password: E.adminPw,
  });
  // người ký công ty = nhân viên (tải HĐ): lấy id trước, ghi thẳng vào args của node Ký số
  const tenantId = await enableFlowTriggers(E.tenantKey);
  const uid = await withOwner(async (sql) => {
    const [u] = await sql<
      { id: string }[]
    >`select id::text from admin.users where tenant_id = ${tenantId}::uuid and username = ${U.employee}`;
    return u?.id as string;
  });
  // CR-127 Z7: quy trình công ty dựng từ SƠ ĐỒ TRỐNG qua API + áp dụng (không còn gán mẫu)
  await createCompanyFlow(need("JA_HUB_URL"), platform.token, tenantId, {
    name: FLOW,
    app: "contracts",
    event: "contract.submitted",
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
                args: {
                  contract_id: { from: "input", key: "contract_id" },
                  company_signers: { from: "const", value: `user:${uid}` },
                },
              },
            }
          : s,
      ),
      finish("xong", "Hoàn tất", 4, "approved"),
      finish("tu-choi", "Từ chối", 5, "rejected"),
    ],
  });
  const signer = await withOwner(async (sql) => {
    const [u] = await sql<
      { n: string }[]
    >`select coalesce(nullif(u.display_name, ''), u.username) as n from admin.users u
      join admin.tenants t on t.id = u.tenant_id where t.key = ${E.tenantKey} and u.username = ${U.employee}`;
    return u?.n as string;
  });

  // — nhân viên gửi HĐ; kế toán duyệt; HĐ tới node Ký số —
  const emp = await ctxPage(browser);
  await loginCw(emp, E, U.employee);
  const id = await uploadAndOpen(emp, E, Date.now().toString(36), 50_000_000);
  // Ký số chỉ nhận PDF (ESIGN_UNSUPPORTED_FILE): HĐ mẫu của stack là .md ⇒ đổi loại tệp của HĐ này (Ký thử không đọc nội dung tệp).
  await withOwner(
    (sql) => sql`update contracts.files set mime = 'application/pdf'
      where id = (select file_id from contracts.contracts where id = ${id}::uuid)`,
  );
  // CR-125 · UX H6: công ty bật ký số ⇒ danh sách chỉ nhận PDF (hộp chọn loại không hiện với .md). Nên bật "Ký thử" SAU khi tải HĐ lên, trước khi gửi duyệt.
  await withOwner(
    (
      sql,
    ) => sql`insert into contracts.approval_settings (tenant_id, esign_enabled, esign_default_provider, updated_by)
      select t.id, true, 'selfsign', u.id from admin.tenants t
      join admin.users u on u.tenant_id = t.id and u.username = ${U.employee} where t.key = ${E.tenantKey}
      on conflict (tenant_id) do update set esign_enabled = true, esign_default_provider = 'selfsign'`,
  );
  await confirmAndSave(emp);
  await approveAs(await ctxPage(browser), E, U.accounting, id, "Duyệt hợp đồng");

  await emp.goto(`${E.cw}/contracts/c/${id}`);
  const card = emp.locator('[data-approval="timeline"]');
  const row = card.getByTestId("approval-step-module");
  await expect(row).toHaveCount(1, { timeout: 90_000 });
  await expect(row).toContainText("Ký số");
  await expect(row).toContainText("Đang chờ ký");
  await expect(row).toContainText(`Người ký: ${signer}`);
  await expect(card.getByTestId(/^approval-step-/).filter({ hasText: /^Chờ ký/ })).toHaveCount(0); // không có dòng "Chờ ký" riêng
  await card.screenshot({ path: testInfo.outputPath("u6-1-dang-cho-ky.png") });
  // CR-125 · x2 · thẻ ký số của NGƯỜI KÝ: MỘT banner "Đến lượt bạn ký" + MỘT nút "Ký ngay"; không "Làm mới trạng thái"; "Huỷ ký" trong menu "…".
  const panel = emp.getByTestId("esign-panel");
  await expect(panel.getByTestId("esign-turn")).toContainText("Đến lượt bạn ký");
  await expect(panel.getByRole("button", { name: "Ký ngay" })).toHaveCount(1);
  await expect(panel.getByRole("button", { name: "Làm mới trạng thái" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Huỷ ký" })).toHaveCount(0);
  await panel.getByTestId("esign-menu").click();
  await expect(panel.getByTestId("esign-cancel")).toBeVisible();
  await panel.getByTestId("esign-menu").click();
  await panel.screenshot({ path: testInfo.outputPath("x2-1-nguoi-ky.png") });

  // — người KHÔNG phải người ký (giám đốc) thấy "Đang chờ <tên> ký", không nút nào —
  const dir = await ctxPage(browser);
  await loginCw(dir, E, U.director);
  await dir.goto(`${E.cw}/contracts/c/${id}`);
  const dp = dir.getByTestId("esign-panel");
  await expect(dp.getByTestId("esign-status")).toContainText(`Đang chờ ${signer} ký`);
  // Người có quyền ghi (không phải người ký): "Cập nhật trạng thái ký" (9a11b235f) + nút "…" (Huỷ ký); không Ký ngay.
  await expect(dp.getByRole("button")).toHaveCount(2);
  await expect(dp.getByRole("button", { name: "Cập nhật trạng thái ký" })).toHaveCount(1);
  await expect(dp.getByRole("button", { name: "Ký ngay" })).toHaveCount(0);
  await dp.screenshot({ path: testInfo.outputPath("x2-2-nguoi-khac.png") });

  // — người ký bấm "Ký ngay" (Ký thử) ⇒ Đã ký —
  await emp.getByRole("button", { name: "Ký ngay" }).click();
  await expect(emp).toHaveURL(/esign=return/, { timeout: 60_000 });
  await expect(row).toContainText("Đã ký", { timeout: 90_000 });
  await expect(card.getByTestId(/^approval-step-/).filter({ hasText: /^Chờ ký/ })).toHaveCount(0); // không có dòng "Chờ ký" riêng
  await card.screenshot({ path: testInfo.outputPath("u6-2-da-ky.png") });
  testInfo.annotations.push({ type: "shots", description: SHOTS });
});
