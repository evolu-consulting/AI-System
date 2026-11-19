// CR-181 · s5 · Cài đặt › Chữ ký (CR-188: bỏ tuỳ chọn «dòng dưới chữ ký» của công ty; cột `caption` vẫn gửi nguyên, ngừng đọc): hàm thuần của form định dạng (bật/tắt nhiều lựa chọn, bắt buộc ≥ 1 cách tạo, so nháp với bản lưu).
import { SIGNATURE_METHODS, type SignatureSettings } from "@ai/contracts/signature";

type Method = (typeof SIGNATURE_METHODS)[number];

/** Bật/tắt một phần tử, giữ thứ tự cố định của contract (không trùng). */
function flip<T extends string>(order: readonly T[], cur: readonly T[], k: T, on: boolean): T[] {
  return order.filter((x) => (x === k ? on : cur.includes(x)));
}

export type ToggleResult = { next: SignatureSettings; blocked: boolean };

/** Bật/tắt cách tạo. Bỏ nốt cách cuối ⇒ chặn (`blocked`), giữ nguyên (BR: ít nhất một cách). */
export function toggleMethod(s: SignatureSettings, k: Method, on: boolean): ToggleResult {
  const methods = flip(SIGNATURE_METHODS, s.methods, k, on);
  if (methods.length === 0) return { next: s, blocked: true };
  return { next: { ...s, methods }, blocked: false };
}

/** Thân PUT: đúng `SignatureSettingsSchema` (strict, thay cả bộ) — chỉ lấy các khoá của schema, bỏ gì thừa. */
export function putBody(s: SignatureSettings): SignatureSettings {
  return {
    methods: [...s.methods],
    required: s.required,
    caption: [...s.caption],
    ink: s.ink,
    initials: s.initials,
    change_policy: s.change_policy,
    on_doc_enabled: s.on_doc_enabled,
    digital_enabled: s.digital_enabled,
    digital_provider: s.digital_provider,
  };
}

export const sameSettings = (a: SignatureSettings, b: SignatureSettings) =>
  JSON.stringify(putBody(a)) === JSON.stringify(putBody(b));

/** Bật «Ký trên tài liệu» sau hộp xác nhận: lưu ngay, chỉ đổi cờ này trên bản đã lưu (không kéo theo chỗ đang sửa dở). */
export function onDocBody(saved: SignatureSettings): SignatureSettings {
  return putBody({ ...saved, on_doc_enabled: true });
}
