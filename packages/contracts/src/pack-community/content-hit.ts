// Khoảng bị che trong bài/bình luận (tách khỏi post.ts để comment.ts ↔ post.ts không vòng import).
import { z } from "zod";

/** Khoảng bị che (chỉ chủ quản nhận, dùng tô đậm raw). `field`: trường chứa khoảng này. */
export const CONTACT_HIT_KINDS = ["phone", "email", "link", "taxId", "company"] as const;
export const ContentHitSchema = z.strictObject({
  field: z.enum(["title", "body"]),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  kind: z.enum(CONTACT_HIT_KINDS),
});
export type ContentHit = z.infer<typeof ContentHitSchema>;
