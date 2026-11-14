// CR-147b · hồ sơ người (hub `/people*`): ảnh đại diện + ảnh bìa cá nhân do CHÍNH người đó đổi; chức vụ do quản trị nhập ở Cơ cấu
// (admin `PUT /admin/org/members/:id/title`). Ảnh = data URL PNG/JPG/WebP — cùng bộ kiểm với ảnh bìa công ty CR-138 (`coverBytes`, G1).
import { z } from "zod";
import { UuidSchema as Uuid } from "./common";
import { COMPANY_COVER_MAX_BYTES, coverBytes } from "./pack-contracts/company";

/** fix-review-r1 · server chỉ nhận avatar đã cắt vuông ~256 px WebP (vài chục KB): trần 150 KB (≤ 205 000 ký tự base64 + tiền tố). */
export const AVATAR_MAX_BYTES = 153_600;
export const AVATAR_MAX_CHARS = 205_000;
/** Ảnh bìa cá nhân cùng luật với ảnh bìa công ty (PNG/JPG/WebP ≤ 3 MB). */
export const PERSON_COVER_MAX_BYTES = COMPANY_COVER_MAX_BYTES;
export const JOB_TITLE_MAX = 80;
/** Tối đa số người mỗi lần đọc theo lô (ảnh data URL nhỏ do client cắt vuông). */
export const PEOPLE_BATCH_MAX = 50;

const image = (maxBytes: number, chars: number, msg: string) =>
  z
    .string()
    .max(chars)
    .refine((v) => (coverBytes(v) ?? Number.POSITIVE_INFINITY) <= maxBytes, { message: msg });

export const AvatarSetSchema = z.strictObject({
  avatar: image(
    AVATAR_MAX_BYTES,
    AVATAR_MAX_CHARS,
    "Ảnh đại diện phải là PNG, JPG hoặc WebP, tối đa 150 KB",
  ).nullable(),
});
export type AvatarSet = z.infer<typeof AvatarSetSchema>;

export const PersonCoverSetSchema = z.strictObject({
  cover: image(
    PERSON_COVER_MAX_BYTES,
    4_300_000,
    "Ảnh bìa phải là PNG, JPG hoặc WebP, tối đa 3 MB",
  ).nullable(),
});
export type PersonCoverSet = z.infer<typeof PersonCoverSetSchema>;

/** `GET /people/me` — hồ sơ của chính mình (ảnh đầy đủ). */
export const MyPeopleProfileSchema = z.strictObject({
  avatar: z.string().nullable(),
  cover: z.string().nullable(),
  job_title: z.string().nullable(),
});
export type MyPeopleProfile = z.infer<typeof MyPeopleProfileSchema>;

/** `GET /people?ids=a,b,c` — 1..50 id (uuid, phân tách dấu phẩy), trùng id được gộp. */
export const PeopleQuerySchema = z.object({
  ids: z
    .string()
    .transform((s) => [
      ...new Set(
        s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    ])
    .pipe(z.array(Uuid).min(1).max(PEOPLE_BATCH_MAX)),
});

export const PersonCardSchema = z.strictObject({
  user_id: Uuid,
  display_name: z.string(),
  job_title: z.string().nullable(),
  avatar: z.string().nullable(),
  /** Phòng ban (đầu tiên theo khoá) mà người đó thuộc; chưa thuộc phòng nào ⇒ null. */
  department: z.strictObject({ id: Uuid, name: z.string() }).nullable(),
});
export type PersonCard = z.infer<typeof PersonCardSchema>;
export const PeopleResponseSchema = z.strictObject({ items: z.array(PersonCardSchema) });
export type PeopleResponse = z.infer<typeof PeopleResponseSchema>;
