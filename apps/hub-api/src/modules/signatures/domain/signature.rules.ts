// CR-181 · lát s2 · luật thuần của chữ ký nội bộ (lớp 1): quyết `needs_create`, `can_change`, ai phải có quyền đổi, kiểm PNG.
// Không I/O. Route/service chỉ ghép; QC viết test trên các hàm này.
import {
  pngDimensions,
  SIGNATURE_PNG_MAX_BYTES,
  SIGNATURE_PNG_MAX_HEIGHT,
  SIGNATURE_PNG_MAX_WIDTH,
  type SignatureChangeState,
  type SignatureKind,
  type SignatureMethod,
  type SignatureSettings,
} from "@ai/contracts/signature";

/** Phần cần biết của một chữ ký đang dùng. */
export type ActiveSig = { method: SignatureMethod } | null;

/** Cách tạo của bản đang dùng còn nằm trong `methods` của công ty (BR-K4). */
export const methodStillAllowed = (s: SignatureSettings, a: ActiveSig): boolean =>
  a !== null && s.methods.includes(a.method);

/**
 * Phải (tạo/tạo lại) chữ ký ngay: bật ký trên tài liệu ∧ (chưa có main ∨ cách tạo của main đã bỏ ∨
 * (`initials = own` ∧ chưa có initials ∨ cách tạo của initials đã bỏ)). `required` chỉ quyết có «Làm sau» — không đổi kết quả này.
 */
export function needsCreate(
  s: SignatureSettings,
  active: { main: ActiveSig; initials: ActiveSig },
): boolean {
  if (!s.on_doc_enabled) return false;
  if (!methodStillAllowed(s, active.main)) return true;
  return s.initials === "own" && !methodStillAllowed(s, active.initials);
}

/** Tạo bản mới cho `kind` cần quyền đổi (một lần)? Chỉ khi policy `admin` ∧ đã có bản dùng được theo định dạng hiện hành. Lần tạo đầu / bản đã lỗi thời: không. */
export const changeNeedsGrant = (s: SignatureSettings, existing: ActiveSig): boolean =>
  s.change_policy === "admin" && methodStillAllowed(s, existing);

/** Bấm «Đổi chữ ký» được ngay (không phải xin): policy self ∨ đã được cho phép ∨ đang buộc tạo lại. */
export const canChangeNow = (
  s: SignatureSettings,
  change: SignatureChangeState,
  mustCreate: boolean,
): boolean => s.change_policy === "self" || change === "granted" || mustCreate;

/** Trạng thái xin đổi từ hàng mở (null = chưa xin). */
export const changeStateOf = (row: { grantedAt: string | null } | null): SignatureChangeState =>
  row === null ? "none" : row.grantedAt === null ? "requested" : "granted";

/** Xin đổi chỉ có nghĩa khi policy `admin` ∧ có bản đang dùng theo định dạng hiện hành (còn lại: tự đổi được / tạo mới được). */
export const changeRequestApplies = (
  s: SignatureSettings,
  active: { main: ActiveSig; initials: ActiveSig },
): boolean =>
  s.change_policy === "admin" &&
  (methodStillAllowed(s, active.main) || methodStillAllowed(s, active.initials));

/** Loại chữ ký tạo được: `initials` chỉ khi công ty chọn «chữ ký tắt riêng». */
export const kindAllowed = (s: SignatureSettings, kind: SignatureKind): boolean =>
  kind === "main" || s.initials === "own";

export type PngCheck = "ok" | "too_large" | "not_png" | "dimensions_too_large";

/** Hạn dung lượng kiểm trước (413), rồi magic bytes + IHDR PNG (415), rồi kích thước ảnh ≤ 2000×1000 (422). Rỗng ⇒ not_png. */
export function checkPng(bytes: Uint8Array): PngCheck {
  if (bytes.length > SIGNATURE_PNG_MAX_BYTES) return "too_large";
  const d = pngDimensions(bytes);
  if (!d) return "not_png";
  if (d.width > SIGNATURE_PNG_MAX_WIDTH || d.height > SIGNATURE_PNG_MAX_HEIGHT)
    return "dimensions_too_large";
  return "ok";
}

/** «Quản trị công ty» (Q15, BR-G1): tenant_admin ∨ có quyền `admin` gói Sổ Hợp Tác. platform_admin KHÔNG (không sửa hộ công ty). */
export const isCompanyAdmin = (role: string, hasPackAdmin: boolean): boolean =>
  role === "tenant_admin" || hasPackAdmin;
