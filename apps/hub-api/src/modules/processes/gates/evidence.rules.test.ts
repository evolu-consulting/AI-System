// CR-127 · E4 · unit: luật bằng chứng khi quyết định (`evidenceCheck`, `reviewDecisionCheck` nhận ý kiến của bằng chứng) + ẩn với người chỉ xem.
import { describe, expect, it } from "bun:test";
import {
  evidenceReadable,
  redactEvidence,
  redactHistoryEvidence,
} from "../domain/runs/run-redact.rules";
import { evidenceCheck, reviewDecisionCheck } from "./gate.rules";

const FILE = "11111111-1111-4111-8111-111111111111";
describe("evidenceCheck (Q13)", () => {
  it("opinion_plus + Duyệt: cần ý kiến + (chữ ký hoặc ≥ 1 tệp)", () => {
    const m = "opinion_plus" as const;
    expect(evidenceCheck({ result: "pass", mode: m })).toBe("EVIDENCE_REQUIRED");
    expect(evidenceCheck({ result: "pass", mode: m, evidence: { note: "  " } })).toBe(
      "EVIDENCE_REQUIRED",
    );
    expect(evidenceCheck({ result: "pass", mode: m, evidence: { note: "ok" } })).toBe(
      "EVIDENCE_REQUIRED",
    );
    expect(
      evidenceCheck({ result: "pass", mode: m, evidence: { note: "ok", attachment_ids: [] } }),
    ).toBe("EVIDENCE_REQUIRED");
    expect(
      evidenceCheck({ result: "pass", mode: m, evidence: { note: "ok", attachment_ids: [FILE] } }),
    ).toBe("ok");
    expect(
      evidenceCheck({
        result: "pass",
        mode: m,
        evidence: { note: "ok", signature_attachment_id: FILE },
      }),
    ).toBe("ok");
  });
  it("chỉ ý kiến / vắng / Trả lại / Từ chối: không đòi chữ ký-tệp ở luật này", () => {
    expect(evidenceCheck({ result: "pass", mode: "opinion" })).toBe("ok");
    expect(evidenceCheck({ result: "pass", mode: null })).toBe("ok");
    expect(evidenceCheck({ result: "reject", mode: "opinion_plus" })).toBe("ok");
    expect(evidenceCheck({ result: "fail", mode: "opinion_plus" })).toBe("ok");
  });
  it("Trả lại/Từ chối luôn cần ý kiến: feedback hoặc evidence.note", () => {
    expect(reviewDecisionCheck({ result: "reject" })).toBe("FEEDBACK_REQUIRED");
    expect(reviewDecisionCheck({ result: "fail", evidence: { note: " " } })).toBe(
      "FEEDBACK_REQUIRED",
    );
    expect(reviewDecisionCheck({ result: "reject", evidence: { note: "Sai giá" } })).toBe("ok");
    expect(reviewDecisionCheck({ result: "fail", feedback: "x" })).toBe("ok");
    expect(reviewDecisionCheck({ result: "pass" })).toBe("ok");
  });
});

describe("BR-26 · evidenceReadable / redact", () => {
  const T = "t1";
  const r = { tenantId: T, startedBy: "s", taskAssignee: false };
  const v = (
    userId: string,
    role: "platform_admin" | "tenant_admin" | "member" = "member",
    tenantId = T,
  ) => ({ userId, tenantId, role });
  it("người chỉ xem không đọc; người gửi / được giao / phụ trách / đã quyết / quản trị đọc; tenant khác không bao giờ", () => {
    expect(evidenceReadable(v("x"), r)).toBe(false);
    expect(evidenceReadable(v("s"), r)).toBe(true);
    expect(evidenceReadable(v("x"), { ...r, taskAssignee: true })).toBe(true);
    expect(evidenceReadable(v("o"), { ...r, ownerUserId: "o" })).toBe(true);
    expect(evidenceReadable(v("d"), { ...r, decidedBy: new Set(["d"]) })).toBe(true);
    expect(evidenceReadable(v("a", "tenant_admin"), r)).toBe(true);
    expect(evidenceReadable(v("a", "tenant_admin", "t2"), r)).toBe(false);
    expect(evidenceReadable(v("s", "member", "t2"), r)).toBe(false);
  });
  it("ẩn nội dung nhưng giữ id/người/lúc; lịch sử bỏ evidence_id", () => {
    const ev = {
      id: "e",
      note: "mật",
      signature_attachment_id: FILE,
      attachment_ids: [FILE],
      by_user: "u",
    };
    expect(redactEvidence(ev, true)).toEqual(ev);
    expect(redactEvidence(ev, false)).toEqual({
      id: "e",
      by_user: "u",
      note: null,
      signature_attachment_id: null,
      attachment_ids: [],
    });
    const h = [
      { task_id: "t", evidence_id: "e", feedback: "ý kiến" },
      { task_id: "u", feedback: "lý do" },
    ];
    expect(redactHistoryEvidence(h, false)).toEqual<unknown>([
      { task_id: "t" },
      { task_id: "u", feedback: "lý do" },
    ]);
    expect(redactHistoryEvidence(h, true)).toEqual(h);
  });
});
