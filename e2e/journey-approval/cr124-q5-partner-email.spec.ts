// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-124 · q5 · FLOW4-FR-12/13 · HÀNH TRÌNH đường email trên stack thật `playwright.journey.config.ts` (công ty MỚI `e2e-q5-<hậu tố>`, HUB_PARTNER_MAILBOX bật):
//  nhân viên gửi HĐ ⇒ flow có node chờ `partner.confirmed` ⇒ người liên hệ của công ty ngoài MỞ LINK (không đăng nhập, ngữ cảnh trình duyệt trống)
//  ⇒ xem đúng một HĐ ⇒ bấm Xác nhận ⇒ bộ chuyển phát `partner.confirmed` ⇒ lượt phía gửi CHẠY TIẾP (HĐ khoá · Đã duyệt). Cộng: dùng lại link ⇒ "đã ghi nhận".
// LỆCH SO VỚI SPEC: dòng hộp thư kênh email được dựng bằng SQL (đường tạo dòng + gửi thư đã có int `partners/email.int.test.ts`, stack không có SMTP);
// token là bản rõ do test tự chọn, DB chỉ giữ băm — đúng như dòng thật.
import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { apiLogin, assignCompanyFlow } from "../_kit/api";
import { createLibraryFlow, enableFlowTriggers, finish, waitEvent } from "../_kit/flows";
import { withOwner } from "../support/helpers";
import { type Env, loginCw, stepOf, U, uploadAndOpen } from "./_journey";

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
  tenantKey: `e2e-q5-${SFX}`,
  tenantName: `E2E Q5 ${SFX}`,
};
const WAIT = `Chờ đối tác xác nhận ${SFX}`;
const RUN = Date.now().toString(36);
const TOKEN = randomBytes(32).toString("base64url");

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const platform = await apiLogin({
    base: API,
    tenantKey: "platform",
    username: E.adminUser,
    password: E.adminPw,
  });
  const flowId = await createLibraryFlow(HUB, platform.token, {
    key: `q5-${SFX}`,
    name: `Gửi đối tác qua email ${SFX}`,
    app: "contracts",
    trigger: { event: "contract.submitted" },
    stages: [
      waitEvent("cho-doi-tac", WAIT, 0, "partner.confirmed"),
      finish("xong", "Đã duyệt", 1, "approved"),
    ],
  });
  const tenantId = await enableFlowTriggers(E.tenantKey);
  await assignCompanyFlow(HUB, platform, tenantId, flowId);
});

test("mở link email ⇒ xem HĐ ⇒ Xác nhận ⇒ lượt phía gửi chạy tiếp (HĐ khoá)", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const emp = await (
    await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } })
  ).newPage();
  await loginCw(emp, E, U.employee);
  const id = await uploadAndOpen(emp, E, `${RUN}q5`, 600_000_000);
  await emp.getByRole("button", { name: "Xác nhận và lưu" }).click();
  // Lượt đầu sau khi vừa gán flow có thể chưa thấy flow mới (cấu hình hub nạp lại định kỳ): chờ thẻ có node chờ đối tác.
  const waiting = stepOf(emp, WAIT);
  await expect(waiting).toBeVisible({ timeout: 120_000 });

  // Dòng hộp thư kênh email của lần gửi này (bản rõ token chỉ ở đây; DB chỉ giữ băm).
  const hash = createHash("sha256").update(TOKEN).digest("hex");
  await withOwner(
    (sql) => sql`insert into hub.partner_mailbox
      (from_tenant, to_email, channel, from_ref, payload, file_ref, status, expires_at, token_hash, email_sent_at)
      select c.tenant_id, 'lienhe@congty-b.test', 'email', c.id::text,
        jsonb_build_object('title', c.title, 'message', 'Xin quý công ty xác nhận hợp đồng', 'importance_hint', 'auto',
          'fields', jsonb_build_object('total_value', 600000000)),
        c.file_id::text, 'delivered', now() + interval '7 days', decode(${hash}, 'hex'), now()
      from contracts.contracts c where c.id = ${id}::uuid`,
  );

  // Người liên hệ công ty ngoài: ngữ cảnh trình duyệt TRỐNG (không đăng nhập)
  const guest = await (
    await browser.newContext({ locale: "vi-VN", viewport: { width: 1100, height: 1000 } })
  ).newPage();
  await guest.goto(`${HUB}/partner-reply/${TOKEN}`);
  await expect(guest.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(guest.getByText("600.000.000")).toBeVisible();
  await expect(guest.getByRole("button", { name: "Xác nhận" })).toBeVisible();
  await expect(guest.getByRole("button", { name: "Trả lại sửa" })).toBeVisible();
  await expect(guest.getByRole("button", { name: "Từ chối" })).toBeVisible();
  await guest.screenshot({
    path: "test-results/journey-approval/cr124-q5-public-open.png",
    fullPage: true,
  });
  await guest.getByLabel("Họ tên người trả lời").fill("Trần Văn B");
  await guest.getByLabel("Chức vụ").fill("Giám đốc");
  await guest.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(guest.getByRole("heading", { name: /ý kiến đã được ghi nhận/ })).toBeVisible();
  await guest.screenshot({
    path: "test-results/journey-approval/cr124-q5-public-done.png",
    fullPage: true,
  });

  // Phía gửi chạy tiếp: node chờ xong ⇒ Kết thúc · Đã duyệt ⇒ HĐ khoá
  await emp.goto(`${E.cw}/contracts/c/${id}`);
  await expect(emp.getByTestId("banner-locked")).toBeVisible({ timeout: 120_000 });

  // Mở lại link: chỉ xem, không còn form (dùng một lần)
  await guest.goto(`${HUB}/partner-reply/${TOKEN}`);
  await expect(guest.getByRole("heading", { name: /ý kiến đã được ghi nhận/ })).toBeVisible();
  await expect(guest.getByRole("button", { name: "Xác nhận", exact: true })).toHaveCount(0);
});
