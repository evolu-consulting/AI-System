// CR-181 · Ký trên tài liệu — hình học dùng chung web ↔ API (docs/specs/CR-181/decisions.md §4).
// Đơn vị điểm PDF, gốc DƯỚI-TRÁI của trang đã xoay như hiển thị (pdf.js viewport scale 1). Lát s8 thêm schema API vào file này.
import { z } from "zod";

/** BR-L4 · một chữ ký giáp lai trùm tối đa 5 trang. */
export const SIGN_SEAM_PAGES_MAX = 5;
/** BR-T3 · tệp cần ký tối đa 50 trang. */
export const SIGN_DOC_PAGES_MAX = 50;
/** Tỉ lệ rộng:cao của ô chỗ ký (bản mẫu `ar: 2.4`). */
export const SIGN_FIELD_ASPECT = 2.4;
/** Q11 · chép sang mọi trang (ký nháy, kiểu «thu nhỏ chữ ký chính») = 40% cỡ. */
export const SIGN_INITIALS_SCALE = 0.4;
/** Trần số dấu (chữ ký/ô) mỗi lần Lưu một tệp: 50 trang ký nháy + vài chữ ký chính. */
export const SIGN_MARKS_MAX = 60;
/** Trần chỗ ký mỗi tệp. */
export const SIGN_FIELDS_MAX = 40;

const Pt = z.number().finite().min(-5000).max(5000);
const Len = z.number().finite().positive().max(5000);

/** Phần của một chữ ký trên MỘT trang: (x,y,w,h) = khung cả chữ ký; (cx,cy,cw,ch) = phần cắt thuộc trang này. */
export const SignPartSchema = z.strictObject({
  page: z
    .number()
    .int()
    .min(0)
    .max(SIGN_DOC_PAGES_MAX - 1),
  x: Pt,
  y: Pt,
  w: Len,
  h: Len,
  cx: Pt,
  cy: Pt,
  cw: Len,
  ch: Len,
});
export type SignPart = z.infer<typeof SignPartSchema>;

/** Một chữ ký / một ô = 1..5 phần, mỗi trang tối đa một phần, trang liên tiếp tăng dần. */
export const SignPartsSchema = z
  .array(SignPartSchema)
  .min(1)
  .max(SIGN_SEAM_PAGES_MAX)
  .refine((ps) => ps.every((p, i) => i === 0 || p.page === (ps[i - 1]?.page ?? -2) + 1), {
    message: "các phần phải nằm trên các trang liên tiếp, tăng dần",
  });
export type SignParts = z.infer<typeof SignPartsSchema>;

export const SIGN_SIDES = ["A", "B"] as const;
export const SignSideSchema = z.enum(SIGN_SIDES);
export type SignSide = z.infer<typeof SignSideSchema>;

/** Loại chữ ký (Q12): nội bộ | số. Đợt 1 `digital` luôn bị từ chối (409 `DIGITAL_SIGN_NOT_ENABLED`). */
export const SIGNATURE_KINDS = ["internal", "digital"] as const;
export const SignatureKindSchema = z.enum(SIGNATURE_KINDS);
export type SignatureKind = z.infer<typeof SignatureKindSchema>;

/** Kiểu dấu trên tệp: vào ô chỗ ký · tự đặt · giáp lai · ký nháy. */
export const SIGN_PLACEMENTS = ["field", "free", "seam", "initials"] as const;
export const SignPlacementSchema = z.enum(SIGN_PLACEMENTS);
export type SignPlacement = z.infer<typeof SignPlacementSchema>;

// ---- Lát s8 · API chuẩn bị chỗ ký (`/contracts/:id/…`) ---------------------------------------------------------------------------

/** `PATCH /sign-docs/:fileId` (BR-T1) */
export const SignNeedsSignBodySchema = z.strictObject({ needs_sign: z.boolean() });
export type SignNeedsSignBody = z.infer<typeof SignNeedsSignBodySchema>;

export const SIGNER_KINDS = ["user", "group", "partner"] as const;
export const SignerKindSchema = z.enum(SIGNER_KINDS);
export type SignerKindApi = z.infer<typeof SignerKindSchema>;

/** Một chỗ ký gửi lên. `id` lạ (không phải chỗ chưa ký của tệp này) bị bỏ, máy chủ sinh id mới. `label` do máy chủ điền theo người ký. */
export const SignFieldInSchema = z.strictObject({
  id: z.uuid().optional(),
  side: SignSideSchema,
  signer_kind: SignerKindSchema,
  /** user/group ⇒ uuid; partner ⇒ email liên hệ (chữ thường). */
  signer_ref: z.string().trim().min(1).max(300),
  parts: SignPartsSchema,
});
/** `PUT /sign-docs/:fileId/fields` (BR-C2): đặt TOÀN BỘ chỗ ký chưa ký của tệp. */
export const SignFieldsPutSchema = z.strictObject({
  fields: z.array(SignFieldInSchema).max(SIGN_FIELDS_MAX),
});
export type SignFieldsPut = z.infer<typeof SignFieldsPutSchema>;

export type SignSignerOut = {
  side: SignSide;
  kind: SignerKindApi;
  ref: string;
  /** Người: tên; nhóm: «Đại diện <nhóm>»; đối tác: tên liên hệ. */
  name: string;
  mine: boolean;
  /** Người ký kiểu NHÓM: thành viên (tên đầy đủ) để màn hình nói đích danh ai ký tiếp; vắng/rỗng ⇒ chỉ có tên nhóm. */
  members?: { id: string; name: string }[];
};

/** Họ tên đầy đủ, cách nhau dấu phẩy: «Nguyễn Văn An, Hoàng Em». */
export function membersLabel(names: readonly string[]): string {
  const n = names.map((x) => x.trim()).filter((x) => x !== "");
  return n.join(", ");
}
/** Người ký nói đích danh: nhóm có thành viên ⇒ tên người; còn lại ⇒ `name`. */
export const signerWho = (s: Pick<SignSignerOut, "name" | "members">): string =>
  s.members?.length ? membersLabel(s.members.map((m) => m.name)) : s.name;
export type SignFieldOut = {
  id: string;
  side: SignSide;
  signer_kind: SignerKindApi;
  signer_ref: string;
  label: string;
  parts: SignParts;
  mine: boolean;
  signed: boolean;
  signed_by: string | null;
  signed_version_id: string | null;
};
export type SignReadinessMissing =
  | { code: "NO_SIGN_FILE" }
  | {
      code: "NO_FIELD";
      file_id: string;
      file_name: string;
      signer_kind: SignerKindApi;
      signer_ref: string;
      signer_name: string;
    };
export type SignReadinessOut = { ready: boolean; missing: SignReadinessMissing[] };
export type SignTurnOut = {
  allowed: boolean;
  run_id?: string;
  step?: "approve" | "sign";
  reason?: string;
  /** CR-184 · người vắng mà người gọi ký thay (uỷ quyền còn hiệu lực); không có ⇒ tự mình. */
  behalf?: { user_id: string; name: string | null }[];
};
export type SignFileOut = {
  file_id: string;
  name: string;
  is_main: boolean;
  is_pdf: boolean;
  /** Người tải lên (tệp chính = người tạo HĐ). */
  uploader_id: string;
  /** Người gọi bật/tắt «Cần ký» + đặt chỗ ký được (BR-T1/C2). */
  can_prep: boolean;
  pages: number | null;
  needs_sign: boolean;
  /** Chính người gọi đã Lưu chữ ký (bản chưa huỷ) trên tệp này trong lượt hiện tại (`turn.run_id`); không có lượt ⇒ false. */
  signed_by_me_in_turn: boolean;
  /** Bản mới nhất chưa huỷ: `version_id` null + `seq` 0 = bản gốc. `url` = đường dẫn tương đối dưới `/pack/contracts`. */
  latest: { version_id: string | null; seq: number; url: string };
  fields: SignFieldOut[];
};
/** Trạng thái link mà phía công ty thấy (phiên ký, trang HĐ). `null` ở phiên ký = HĐ chưa gửi link. */
export type PartnerLinkStatusOut = {
  state: "open" | "signed" | "declined" | "expired" | "revoked";
  sent_at: string | null;
  opened_at: string | null;
  expires_at: string;
  signed_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  /** Tên liên hệ nhận link (không lộ email). */
  contact_name: string | null;
};

export type SignSessionOut = {
  enabled: boolean;
  mode: "prep" | "sign" | "view";
  locked: boolean;
  files: SignFileOut[];
  signers: SignSignerOut[];
  readiness: SignReadinessOut;
  turn: SignTurnOut;
  kinds: { internal: true; digital: { enabled: false; reason: string } };
  /** CR-182 · link ký của đối tác (mới nhất); null = chưa gửi. */
  partner_link?: PartnerLinkStatusOut | null;
};

// ---- Lát s8 phần B · Lưu chữ ký, các bản -------------------------------------------------------------------------------------------

/** Một dấu trên tệp. KHÔNG có ảnh (BR-K3): máy chủ lấy chữ ký đang dùng của người gọi. `caption` = in dòng tên/ngày dưới chữ ký hay không. */
export const SignMarkInSchema = z.strictObject({
  field_id: z.uuid().optional(),
  placement: SignPlacementSchema,
  parts: SignPartsSchema,
  caption: z.boolean(),
});
/** `POST /sign-docs/:fileId/sign` — strict: trường lạ (kể cả ảnh) ⇒ 400. */
export const SignSaveBodySchema = z.strictObject({
  kind: SignatureKindSchema,
  marks: z.array(SignMarkInSchema).min(1).max(SIGN_MARKS_MAX),
});
export type SignSaveBody = z.infer<typeof SignSaveBodySchema>;
export type SignSaveOut = { version_id: string; seq: number; my_open_fields_left: number };

export type SignVersionMarkOut = {
  signer_id: string;
  signer_name: string | null;
  field_id: string | null;
  placement: SignPlacement;
  /** Các trang (đánh số từ 0) mà dấu nằm trên. */
  pages: number[];
  parts: SignParts;
  caption: string | null;
};
export type SignVersionItemOut = {
  /** null + `seq` 0 = bản gốc. */
  version_id: string | null;
  seq: number;
  original: boolean;
  signed_by: string | null;
  signed_by_name: string | null;
  /** CR-184 · «B ký thay A (uỷ quyền)»: người vắng (A); null = người ký tự ký. */
  on_behalf_of?: string | null;
  on_behalf_of_name?: string | null;
  signed_at: string | null;
  kind: SignatureKind | null;
  voided: boolean;
  sha256: string | null;
  url: string;
  marks: SignVersionMarkOut[];
};
export type SignVersionsOut = {
  file_id: string;
  name: string;
  pages: number | null;
  versions: SignVersionItemOut[];
  /** Chỗ ký còn chờ (chưa ký). */
  pending_fields: SignFieldOut[];
};
