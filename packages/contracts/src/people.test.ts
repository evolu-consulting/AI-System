// fix-review-r1 · trần avatar 150 KB ở biên (zod ⇒ 422); ảnh bìa vẫn ≤ 3 MB.
import { describe, expect, it } from "bun:test";
import { AvatarSetSchema, PersonCoverSetSchema } from "./people";

const webp = (kb: number) => `data:image/webp;base64,${"A".repeat(Math.ceil((kb * 1024 * 4) / 3))}`;

describe("AvatarSetSchema [fix-review-r1]", () => {
  it("avatar 200 KB bị từ chối, 100 KB và null được nhận", () => {
    expect(AvatarSetSchema.safeParse({ avatar: webp(200) }).success).toBe(false);
    expect(AvatarSetSchema.safeParse({ avatar: webp(100) }).success).toBe(true);
    expect(AvatarSetSchema.safeParse({ avatar: webp(150) }).success).toBe(true);
    expect(AvatarSetSchema.safeParse({ avatar: webp(151) }).success).toBe(false);
    expect(AvatarSetSchema.safeParse({ avatar: null }).success).toBe(true);
  });
  it("ảnh bìa 1 MB vẫn được nhận", () => {
    expect(PersonCoverSetSchema.safeParse({ cover: webp(1024) }).success).toBe(true);
  });
});
