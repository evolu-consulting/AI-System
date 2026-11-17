// CR-181 · fix · `signer_ref` khớp CHECK `sign_fields_text_ck` ở 0121 (≤ 300 ký tự) — chặn ở biên 400, không để DB trả 23514.
import { describe, expect, test } from "bun:test";
import { SignFieldInSchema } from "./doc-sign";

const field = (ref: string) => ({
  side: "B",
  signer_kind: "partner",
  signer_ref: ref,
  parts: [{ page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.1, cx: 0.1, cy: 0.1, cw: 0.2, ch: 0.1 }],
});

describe("SignFieldInSchema.signer_ref", () => {
  test("đúng 300 ký tự ⇒ hợp lệ, 301 ⇒ bị từ chối ở biên", () => {
    expect(SignFieldInSchema.safeParse(field("a".repeat(300))).success).toBe(true);
    expect(SignFieldInSchema.safeParse(field("a".repeat(301))).success).toBe(false);
  });
});
