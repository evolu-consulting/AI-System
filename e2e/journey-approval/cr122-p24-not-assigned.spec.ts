// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-122 · p24 · HÀNH TRÌNH "chưa gán quy trình ⇒ lý do + Mở lại" trên stack thật `playwright.journey.config.ts` (công ty MỚI
// `e2e-c22n-<hậu tố>`: cờ FLOW_TRIGGERS BẬT nhưng CHƯA gán flow nào). Nhân viên gửi HĐ ("Gửi duyệt") ⇒ bộ điều phối không có flow khớp
// ⇒ thẻ duyệt nói rõ vì sao + cách sửa (quản trị gán quy trình) và chủ HĐ có nút "Mở lại"; thẻ KHÔNG còn nút "Gửi duyệt".

import { enableFlowTriggers } from "../_kit/flows";
import { confirmAndSave, type Env, loginCw, U, uploadAndOpen } from "./_journey";
import { expect, test } from "./_test";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
const SFX = need("JA_D5_SUFFIX");
const KEY = `e2e-c22n-${SFX}`;
const E: Env = {
  cw: need("JA_CW_URL"),
  admin: need("JA_ADMIN_URL"),
  pw: need("JA_USER_PW"),
  adminUser: need("SEED_ADMIN_USERNAME"),
  adminPw: need("SEED_ADMIN_PASSWORD"),
  tenantKey: KEY,
  tenantName: `E2E C22N ${SFX}`,
};

test.beforeAll(async () => {
  await enableFlowTriggers(KEY); // chỉ bật cờ; KHÔNG gán flow
});

test("chưa gán quy trình: thẻ nói rõ lý do + chủ HĐ có nút Mở lại, không còn Gửi duyệt", async ({
  browser,
}) => {
  const page = await (
    await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } })
  ).newPage();
  await loginCw(page, E, U.employee);
  const id = await uploadAndOpen(page, E, `p24${Date.now().toString(36)}`, 150_000_000);
  await confirmAndSave(page);
  // bộ điều phối chạy nền (≈ 2 s) ⇒ thẻ đổi sang "đang dừng" kèm lý do nghiệp vụ
  await expect(page.getByText("chưa có quy trình duyệt cho loại hợp đồng này")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Công ty › Quy trình")).toBeVisible();
  await expect(page.getByRole("button", { name: "Gửi duyệt" })).toHaveCount(0);
  // người gửi không phải quản trị gói ⇒ chỉ được dặn báo chủ HĐ; quản trị (Giám đốc) mới có nút Mở lại
  const admin = await (
    await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } })
  ).newPage();
  await loginCw(admin, E, U.director);
  await admin.goto(`${E.cw}/contracts/c/${id}`);
  await expect(admin.getByRole("button", { name: /Mở lại/ }).first()).toBeVisible({
    timeout: 30_000,
  });
});
