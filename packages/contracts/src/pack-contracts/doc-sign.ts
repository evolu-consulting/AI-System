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
