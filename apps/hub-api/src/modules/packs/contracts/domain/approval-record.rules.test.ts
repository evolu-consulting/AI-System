// CR-127 · E4 · BR-26 · unit: hồ sơ duyệt HĐ — ai đọc được nội dung bằng chứng + dựng danh sách đã lọc.
import { describe, expect, it } from "bun:test";
import { buildApprovalRecord, canReadEvidence, type RecordRow } from "./approval-record.rules";

const row: RecordRow = {
  taskId: "t1",
  stage: "s0",
  action: "reject",
  at: "2026-11-10T01:00:00.000Z",
  actor: "u1",
  feedback: "Sai giá",
  evidence: {
    id: "e1",
    note: "Sai giá",
    signature_attachment_id: null,
    attachment_ids: ["f1"],
    by_user: "u1",
    on_behalf_of: "u9",
    at: "2026-11-10T01:00:00.000Z",
  },
};
describe("canReadEvidence", () => {
  const c = { startedBy: "s", owner: "o", involved: new Set(["u1"]) };
  it("quản trị · người gửi · phụ trách · người trong quy trình đọc; người chỉ xem không", () => {
    expect(canReadEvidence({ userId: "a", admin: true }, c)).toBe(true);
    expect(canReadEvidence({ userId: "s", admin: false }, c)).toBe(true);
    expect(canReadEvidence({ userId: "o", admin: false }, c)).toBe(true);
    expect(canReadEvidence({ userId: "u1", admin: false }, c)).toBe(true);
    expect(canReadEvidence({ userId: "x", admin: false }, c)).toBe(false);
    expect(canReadEvidence({ userId: "x", admin: false }, { ...c, owner: null })).toBe(false);
  });
});
describe("buildApprovalRecord", () => {
  const names = new Map([
    ["u1", "An"],
    ["u9", "Bình"],
  ]);
  it("đọc được ⇒ đủ nội dung + tên (người làm thay hiện cả hai)", () => {
    const r = buildApprovalRecord([row], names, true);
    expect(r.can_read_evidence).toBe(true);
    expect(r.items[0]?.evidence).toMatchObject({
      readable: true,
      note: "Sai giá",
      attachment_ids: ["f1"],
      by_user: { id: "u1", display_name: "An" },
      on_behalf_of: { id: "u9", display_name: "Bình" },
    });
    expect(r.items[0]?.feedback).toBe("Sai giá");
  });
  it("người chỉ xem ⇒ chỉ thấy tiến trình: không ý kiến/tệp/feedback, vẫn biết có bằng chứng", () => {
    const r = buildApprovalRecord(
      [row, { ...row, taskId: "t2", evidence: null, feedback: "Lý do" }],
      names,
      false,
    );
    expect(r.can_read_evidence).toBe(false);
    expect(r.items[0]).toMatchObject({
      feedback: null,
      evidence: { readable: false, note: null, signature_attachment_id: null, attachment_ids: [] },
    });
    expect(r.items[1]?.feedback).toBe("Lý do"); // không có bằng chứng kèm ⇒ như cũ
    expect(JSON.stringify(r)).not.toContain("f1");
  });
});
