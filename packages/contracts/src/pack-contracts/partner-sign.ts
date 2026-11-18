// CR-182 · đợt 2 · «Đối tác ký qua link riêng» (BR-C5): contract của route công khai `/sign-link/:token/*` (KHÔNG JWT) và của phía công ty
// (`POST /contracts/:id/partner-sign/resend`, trạng thái link trong phiên ký). KHÔNG nhận ảnh chữ ký trong `sign`: chữ ký nhanh gửi MỘT lần
// qua `quick-signature` (máy chủ lưu), lúc Lưu chỉ gửi vị trí (BR-K3).
import { z } from "zod";
import {
  type PartnerLinkStatusOut,
  SIGN_MARKS_MAX,
  SignMarkInSchema,
  type SignParts,
  type SignPlacement,
} from "./doc-sign";

/** PNG chữ ký nhanh tối đa 200 KB (byte); base64 ≈ 4/3 ⇒ trần chuỗi 273 068 ký tự. */
export const PARTNER_QUICK_PNG_MAX_BYTES = 204_800;
export const PARTNER_QUICK_B64_MAX = Math.ceil(PARTNER_QUICK_PNG_MAX_BYTES / 3) * 4;
export const PARTNER_QUICK_METHODS = ["type", "draw"] as const;
export type PartnerQuickMethod = (typeof PARTNER_QUICK_METHODS)[number];
/** Hạn mặc định của link khi bước không có hạn (ngày). */
export const PARTNER_LINK_DEFAULT_DAYS = 7;
export const PARTNER_DECLINE_REASON_MAX = 2000;

/** `POST /sign-link/:token/quick-signature` — strict. */
export const PartnerQuickSignatureBodySchema = z.strictObject({
  method: z.enum(PARTNER_QUICK_METHODS),
  png: z.string().min(8).max(PARTNER_QUICK_B64_MAX),
});
export type PartnerQuickSignatureBody = z.infer<typeof PartnerQuickSignatureBodySchema>;

/** `POST /sign-link/:token/sign` — strict: trường lạ (nhất là ảnh) ⇒ 400. Một lần Lưu = một tệp. */
export const PartnerSignBodySchema = z.strictObject({
  file_id: z.uuid(),
  marks: z.array(SignMarkInSchema).min(1).max(SIGN_MARKS_MAX),
});
export type PartnerSignBody = z.infer<typeof PartnerSignBodySchema>;

/** `POST /sign-link/:token/decline` — lý do bắt buộc. */
export const PartnerDeclineBodySchema = z.strictObject({
  reason: z.string().trim().min(1).max(PARTNER_DECLINE_REASON_MAX),
});
export type PartnerDeclineBody = z.infer<typeof PartnerDeclineBodySchema>;

export const PARTNER_LINK_STATES = ["open", "signed", "declined", "expired", "revoked"] as const;
export type PartnerLinkState = (typeof PARTNER_LINK_STATES)[number];

export type PartnerSignFileOut = {
  file_id: string;
  name: string;
  pages: number | null;
  /** Chỗ ký Bên B của tệp (chưa ký + đã ký). */
  fields: {
    id: string;
    label: string;
    parts: SignParts;
    signed: boolean;
  }[];
  /** Bản đã ký mới nhất của tệp (nếu có): `GET /sign-link/:token/versions/:fileId/:versionId`. */
  latest_version_id: string | null;
  latest_seq: number;
};

/** `GET /sign-link/:token` (200 khi `open` hoặc `signed` ⇒ chỉ xem; hết hạn/thu hồi ⇒ 410; sai ⇒ 404). */
export type PartnerSignViewOut = {
  state: "open" | "signed" | "declined";
  company_name: string;
  contract_title: string;
  contact_name: string;
  expires_at: string;
  signed_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  has_quick_signature: boolean;
  quick_method: PartnerQuickMethod | null;
  files: PartnerSignFileOut[];
};

export type PartnerSignSaveOut = {
  version_id: string;
  seq: number;
  /** Số chỗ ký Bên B còn lại (mọi tệp); 0 ⇒ link đã chốt «đã ký» và HĐ hoàn tất. */
  open_fields_left: number;
  completed: boolean;
};

export type PartnerResendOut = {
  sent: boolean;
  /** Link ký đầy đủ — CHỈ khi thư chưa gửi được (`sent=false`), để người tải lên / quản trị sao chép gửi đối tác; còn lại null. */
  url: string | null;
  expires_at: string;
  link: PartnerLinkStatusOut;
};

/** Mã lỗi của route công khai (`error.code`). */
export const PARTNER_SIGN_ERRORS = {
  gone: "SIGN_LINK_GONE",
  closed: "SIGN_LINK_CLOSED",
  noQuick: "SIGN_QUICK_MISSING",
  pngBad: "SIGN_QUICK_PNG_INVALID",
  fieldForbidden: "SIGN_FIELD_FORBIDDEN",
  markInvalid: "SIGN_MARK_INVALID",
  fileNotFound: "SIGN_FILE_NOT_FOUND",
  stale: "SIGN_VERSION_STALE",
  noContact: "PARTNER_CONTACT_MISSING",
  notNeeded: "PARTNER_SIGN_NOT_NEEDED",
} as const;

export type PartnerMarkKind = SignPlacement;
