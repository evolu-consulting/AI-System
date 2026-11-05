// CR-120 · cr120-community-flow-ui · mapper trạng thái duyệt bài / lỗi tranh chấp.
import { describe, expect, it } from "bun:test";
import type { ModerationItem } from "@ai/contracts/community";
import { byPostId, isConflict, moderationNote, queueReasonKey } from "./flows";

const base: ModerationItem = {
  id: "00000000-0000-4000-8000-000000000001",
  taskId: null,
  moderation: "pending",
  screen: null,
  reason: null,
  awaitingReview: true,
  type: "sell",
  title: "t",
  authorName: "a",
  createdAt: "2026-11-05T00:00:00Z",
  decidedBy: null,
  feedback: null,
};

describe("moderationNote", () => {
  it("không qua duyệt ⇒ không hiện", () => {
    expect(moderationNote({ ...base, moderation: "none" })).toBeNull();
  });
  it("chờ duyệt: đang kiểm tra khác chờ người duyệt, đều có gợi ý sửa", () => {
    expect(moderationNote(base)?.whyKey).toBe("community.flows.mod.pendingReview");
    expect(moderationNote({ ...base, awaitingReview: false })?.whyKey).toBe(
      "community.flows.mod.pendingChecking",
    );
    expect(moderationNote(base)?.hintKey).toBe("community.flows.mod.editHint");
  });
  it("từ chối kèm lý do (feedback ưu tiên hơn reason)", () => {
    const n = moderationNote({
      ...base,
      moderation: "rejected",
      feedback: "Thiếu giá",
      reason: "x",
    });
    expect(n?.labelKey).toBe("community.flows.mod.rejected");
    expect(n?.params).toEqual({ reason: "Thiếu giá" });
    expect(moderationNote({ ...base, moderation: "rejected" })?.labelKey).toBe(
      "community.flows.mod.rejectedNoReason",
    );
  });
  it("đã duyệt", () => {
    expect(moderationNote({ ...base, moderation: "approved" })?.tone).toBe("ok");
  });
});

describe("hàng chờ + lỗi", () => {
  it("lý do vào hàng chờ", () => {
    expect(queueReasonKey({ ...base, awaitingReview: false }).key).toBe(
      "community.flows.review.checking",
    );
    expect(queueReasonKey({ ...base, screen: "flagged", reason: "spam" }).params).toEqual({
      reason: "spam",
    });
    expect(queueReasonKey({ ...base, screen: "error" }).key).toBe(
      "community.flows.review.unchecked",
    );
  });
  it("409 = tranh chấp", () => {
    expect(isConflict({ status: 409 })).toBe(true);
    expect(isConflict({ status: 500 })).toBe(false);
    expect(isConflict(null)).toBe(false);
  });
  it("gộp theo id một lần", () => {
    expect(byPostId([base]).get(base.id)).toBe(base);
  });
});
