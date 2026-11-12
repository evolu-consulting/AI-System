// CR-127 · E1 · `EvidenceInputSchema` (dùng chung mọi nơi), `StageEscalate` có `user_id`, `FlowTrigger.params`, uỷ quyền.
import { describe, expect, test } from "bun:test";
import { StageEscalateSchema } from "../hub-admin/process-group-refs";
import { FlowTriggerSchema } from "../hub-admin/process-trigger";
import {
  CreateDelegationRequestSchema,
  EVIDENCE_FILES_MAX,
  EVIDENCE_NOTE_MAX,
  EvidenceInputSchema,
  PutFlowSettingsRequestSchema,
} from "./evidence";
import { ReviewDecisionRequestSchema } from "./processes-api";

const U = "01900000-0000-7000-8000-000000000001";

describe("CR-127 · E1 · EvidenceInputSchema", () => {
  test("ý kiến 1..4000 (cắt khoảng trắng), tệp ≤ 5, chữ ký là uuid, khoá lạ bị chặn", () => {
    expect(EvidenceInputSchema.safeParse({ note: " ok " }).data).toEqual({ note: "ok" });
    expect(EvidenceInputSchema.safeParse({ note: "   " }).success).toBe(false);
    expect(EvidenceInputSchema.safeParse({ note: "x".repeat(EVIDENCE_NOTE_MAX) }).success).toBe(
      true,
    );
    expect(EvidenceInputSchema.safeParse({ note: "x".repeat(EVIDENCE_NOTE_MAX + 1) }).success).toBe(
      false,
    );
    const files = (n: number) => Array.from({ length: n }, () => U);
    expect(
      EvidenceInputSchema.safeParse({ note: "a", attachment_ids: files(EVIDENCE_FILES_MAX) })
        .success,
    ).toBe(true);
    expect(
      EvidenceInputSchema.safeParse({ note: "a", attachment_ids: files(EVIDENCE_FILES_MAX + 1) })
        .success,
    ).toBe(false);
    expect(EvidenceInputSchema.safeParse({ note: "a", signature_attachment_id: "x" }).success).toBe(
      false,
    );
    expect(EvidenceInputSchema.safeParse({ note: "a", extra: 1 }).success).toBe(false);
  });
  test("ReviewDecisionRequest nhận evidence tuỳ chọn", () => {
    expect(
      ReviewDecisionRequestSchema.safeParse({
        result: "pass",
        evidence: { note: "ok", signature_attachment_id: U },
      }).success,
    ).toBe(true);
    expect(ReviewDecisionRequestSchema.safeParse({ result: "pass" }).success).toBe(true);
    expect(ReviewDecisionRequestSchema.safeParse({ result: "pass", evidence: {} }).success).toBe(
      false,
    );
  });
});

describe("CR-127 · E1 · escalate user_id · trigger params · uỷ quyền · cài đặt", () => {
  test("StageEscalate: đúng một trong group_id / group_key / user_id", () => {
    expect(StageEscalateSchema.safeParse({ after_h: 24, user_id: U }).success).toBe(true);
    expect(StageEscalateSchema.safeParse({ after_h: 24, group_id: U }).success).toBe(true);
    expect(StageEscalateSchema.safeParse({ after_h: 24 }).success).toBe(false);
    expect(StageEscalateSchema.safeParse({ after_h: 24, group_id: U, user_id: U }).success).toBe(
      false,
    );
  });
  test("FlowTrigger.params.days 1..365", () => {
    expect(
      FlowTriggerSchema.safeParse({ event: "milestone.due", params: { days: 3 } }).success,
    ).toBe(true);
    expect(FlowTriggerSchema.safeParse({ event: "milestone.due" }).success).toBe(true);
    expect(
      FlowTriggerSchema.safeParse({ event: "milestone.due", params: { days: 0 } }).success,
    ).toBe(false);
    expect(
      FlowTriggerSchema.safeParse({ event: "milestone.due", params: { days: 366 } }).success,
    ).toBe(false);
  });
  test("CreateDelegationRequest: to_at > from_at, loại trong danh sách, ≥ 1 loại", () => {
    const ok = {
      to_user_id: U,
      from_at: "2026-11-10T00:00:00.000Z",
      to_at: "2026-11-12T00:00:00.000Z",
      kinds: ["approve"],
    };
    expect(CreateDelegationRequestSchema.safeParse(ok).success).toBe(true);
    expect(CreateDelegationRequestSchema.safeParse({ ...ok, to_at: ok.from_at }).success).toBe(
      false,
    );
    expect(CreateDelegationRequestSchema.safeParse({ ...ok, kinds: [] }).success).toBe(false);
    expect(CreateDelegationRequestSchema.safeParse({ ...ok, kinds: ["bogus"] }).success).toBe(
      false,
    );
  });
  test("claim_release_h 1..168", () => {
    expect(PutFlowSettingsRequestSchema.safeParse({ claim_release_h: 24 }).success).toBe(true);
    expect(PutFlowSettingsRequestSchema.safeParse({ claim_release_h: 0 }).success).toBe(false);
    expect(PutFlowSettingsRequestSchema.safeParse({ claim_release_h: 169 }).success).toBe(false);
  });
});
