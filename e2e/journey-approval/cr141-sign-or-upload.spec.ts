// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-141 · HÀNH TRÌNH bước «Ký hợp đồng» khi công ty KHÔNG bật ký số: người được giao ký (giám đốc, KHÔNG phải người tạo HĐ) tải lên bản đã ký
// ⇒ bước xong, HĐ hiện «Đã ký», «Hồ sơ» có bản đã ký; người không được giao (người tạo HĐ) không thấy khối tải.
// Công ty MỚI `e2e-u141-<hậu tố>`; quy trình công ty dựng từ sơ đồ trống qua API platform admin (`_kit/flows.ts`), khuôn như cr123-u6-run-card.
// Viết cho đợt chạy e2e cuối (chưa chạy trong lát).

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
  tenantKey: `e2e-u141-${SFX}`,
  tenantName: `E2E U141 ${SFX}`,
};
const FLOW = `Duyệt + Ký hợp đồng ${SFX}`;
const ctxPage = async (browser: import("@playwright/test").Browser): Promise<Page> =>
  (await browser.newContext({ locale: "vi-VN", viewport: { width: 1280, height: 900 } })).newPage();

/** PDF tối thiểu hợp lệ về đầu tệp (máy chủ nhận theo loại tệp). */
const SIGNED_PDF = {
  name: "hop-dong-da-ky.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"),
};

test("CR-141 · ký hợp đồng bằng tải lên: người được giao (không phải người tạo) tải bản đã ký ⇒ Đã ký + Hồ sơ", async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const platform = await apiLogin({
    base: need("JA_API_URL"),
    tenantKey: "platform",
    username: E.adminUser,
    password: E.adminPw,
  });
  const tenantId = await enableFlowTriggers(E.tenantKey);
  // người được giao ký = giám đốc (khác nhân viên tạo HĐ); công ty KHÔNG bật ký số (không chèn approval_settings)
  const signerId = await withOwner(async (sql) => {
    const [u] = await sql<
      { id: string }[]
    >`select id::text from admin.users where tenant_id = ${tenantId}::uuid and username = ${U.director}`;
    return u?.id as string;
  });
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
                  company_signers: { from: "const", value: `user:${signerId}` },
                },
              },
            }
          : s,
      ),
      finish("xong", "Hoàn tất", 4, "approved"),
      finish("tu-choi", "Từ chối", 5, "rejected"),
    ],
  });

  // — nhân viên gửi HĐ; kế toán duyệt; bước Ký hợp đồng mở chờ bản đã ký —
  const emp = await ctxPage(browser);
  await loginCw(emp, E, U.employee);
  const id = await uploadAndOpen(emp, E, Date.now().toString(36), 50_000_000);
  await confirmAndSave(emp);
  await approveAs(await ctxPage(browser), E, U.accounting, id, "Duyệt hợp đồng");

  // — người tạo HĐ (không được giao ký) KHÔNG thấy khối tải lên —
  await emp.goto(`${E.cw}/contracts/c/${id}`);
  await expect(emp.getByTestId("approval-step-module")).toHaveCount(1, { timeout: 90_000 });
  await expect(emp.getByTestId("signed-upload-box")).toHaveCount(0);
  await expect(emp.getByTestId("signed-upload-input")).toHaveCount(0);

  // — người được giao (giám đốc) thấy khối, chọn tệp sai định dạng ⇒ báo bằng chữ nghiệp vụ; tệp PDF ⇒ xong —
  const dir = await ctxPage(browser);
  await loginCw(dir, E, U.director);
  await dir.goto(`${E.cw}/contracts/c/${id}`);
  const box = dir.getByTestId("signed-upload-box");
  await expect(box).toBeVisible({ timeout: 90_000 });
  await expect(box.getByTestId("signed-upload-override")).toHaveCount(0); // đúng người được giao, không phải «duyệt thay»
  await expect(box.getByTestId("signed-upload-submit")).toBeDisabled(); // chưa chọn tệp
  await box.getByTestId("signed-upload-input").setInputFiles({
    name: "hop-dong.exe",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("MZ"),
  });
  await box.getByTestId("signed-upload-submit").click();
  await expect(box.getByTestId("signed-upload-error")).toContainText("Chưa nhận định dạng này");

  await box.getByTestId("signed-upload-input").setInputFiles(SIGNED_PDF);
  await box.getByTestId("signed-upload-submit").click();

  // — bước xong: khối tải biến mất, HĐ hiện «Đã ký» —
  await expect(dir.getByTestId("signed-upload-box")).toHaveCount(0, { timeout: 60_000 });
  await expect(dir.getByTestId("esign-status")).toContainText("Đã ký", { timeout: 60_000 });
  await emp.reload();
  await expect(emp.getByTestId("approval-step-module")).toContainText("Đã ký", { timeout: 90_000 });

  // — «Hồ sơ» có bản đã ký tải về được —
  await dir.getByTestId("file-record-btn").click();
  await expect(dir.getByTestId("file-record")).toBeVisible();
  await expect(dir.getByTestId("frec-signed-download")).toBeVisible();
});
