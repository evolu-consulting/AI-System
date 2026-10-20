// W1 · hẹn nhắc chung: biên zod của `subject_id` (review B #16 — NUL làm Postgres lỗi 22021 ⇒ 5xx).
import { describe, expect, test } from "bun:test";
import { FollowupCreateSchema, FollowupsQuerySchema } from "./followups";

const ok = { subject_kind: "company", subject_id: "tax:0300000001", at: "2026-10-20T09:00" };

describe("W1 · FollowupCreateSchema / FollowupsQuerySchema", () => {
  test("khoá chủ thể thường hợp lệ", () => {
    expect(FollowupCreateSchema.safeParse(ok).success).toBe(true);
    expect(FollowupsQuerySchema.safeParse({ subject_id: "tax:1" }).success).toBe(true);
  });
  test("NUL trong subject_id ⇒ từ chối ở cả hai schema", () => {
    for (const s of ["a\u0000b", "\u0000"]) {
      expect(FollowupCreateSchema.safeParse({ ...ok, subject_id: s }).success).toBe(false);
      expect(FollowupsQuerySchema.safeParse({ subject_id: s }).success).toBe(false);
    }
  });
});
