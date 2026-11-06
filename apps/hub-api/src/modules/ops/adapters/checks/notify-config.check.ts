// CR-121 c21 (D4) · ops-checks · "Cấu hình gửi mail": cấu hình mail có MỘT nguồn = kho secret Hub (secret nền tảng `smtp_password`,
// JSON host/cổng/người gửi/mật khẩu). Kho chưa có secret này ⇒ warn "chưa cấu hình mail" (KHÔNG chặn khởi động, không phải lỗi:
// Hub chạy được khi `HUB_NOTIFY_MODE=off`). Một câu SQL đếm theo tập trên cột công khai (id/kind/tenant — hub_rw không đọc bản mã);
// không giải mã nên không lộ giá trị. Giá trị sai định dạng chỉ lộ lúc gửi: `mailConfigReader` bật cờ trong tiến trình (`lib/mail-config-state`), check đọc cờ này.
import { sql } from "drizzle-orm";
import { isMailConfigInvalid } from "../../../../lib/mail-config-state";
import type { OpsCheck, OpsCheckResult } from "../../application/ops.check";
import { systemRead } from "./check-kit";

/** Thuần. 0 secret mail ⇒ warn; có nhưng lần đọc gần nhất không parse được (cờ `mail_config_invalid`) ⇒ warn riêng; có ⇒ ok. */
export function evaluateNotifyConfig(n: number, invalid = false): OpsCheckResult {
  if (n > 0 && invalid)
    return {
      status: "warn",
      value: { configured: n, code: "mail_config_invalid" },
      message: "Cấu hình mail không đọc được — tạo lại secret",
      hint: "Secret nền tảng smtp_password sai định dạng (kiểu cũ hoặc hỏng): xoá hàng đó trong kho secret Hub rồi khởi động lại Hub với SMTP_PASSWORD/HUB_SMTP_* để khởi tạo lại, hoặc tạo lại secret JSON v:1.",
    };
  if (n > 0) return { status: "ok", value: { configured: n }, message: "Đã cấu hình gửi mail" };
  return {
    status: "warn",
    value: { configured: 0 },
    message: "Chưa cấu hình mail: kho secret Hub chưa có cấu hình gửi email (smtp_password)",
    hint: "Đặt SMTP_PASSWORD (và HUB_SMTP_*) rồi khởi động Hub với HUB_NOTIFY_MODE=live để khởi tạo kho một lần, hoặc tạo secret nền tảng smtp_password trong kho secret Hub.",
  };
}

/** Một câu, văn bản cố định. */
export const notifyConfigQuery = () => sql`
  select count(*)::int as n from hub.secrets where kind = 'smtp_password' and tenant_id is null`;

export const notifyConfigCheck: OpsCheck = {
  key: "notify_config",
  async run(d) {
    const rows = await systemRead(d.db, (tx) => tx.execute<{ n: number }>(notifyConfigQuery()));
    return evaluateNotifyConfig(Number(rows[0]?.n ?? 0), isMailConfigInvalid());
  },
};
