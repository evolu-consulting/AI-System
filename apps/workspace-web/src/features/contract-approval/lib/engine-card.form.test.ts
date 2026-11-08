// CR-125 · cr125-form-step-card · bước «Điền thông tin» (form) đang mở trên thẻ HĐ: người làm điền + «Gửi» trên dòng bước, đầu trang KHÔNG có
// Duyệt / Trả lại / Từ chối; người không thuộc nhóm làm chỉ thấy ghi chú chờ.
import { describe, expect, test } from "bun:test";
import type { ContractApproval } from "@ai/contracts/pack-contracts";
import { engineApprovalView } from "./engine-card";

const card = (o: Partial<ContractApproval>): ContractApproval =>
  ({
    mode: "engine",
    step: "level1",
    engine_run_id: "r1",
    from_run: true,
    can_act: true,
    steps: [
      {
        idx: 0,
        key: "bao-gia",
        name: "Lập bảng so sánh giá",
        kind: "form",
        status: "open",
        form: { fields: [] },
      },
    ],
    ...o,
  }) as unknown as ContractApproval;

describe("thẻ HĐ · bước form đang mở", () => {
  test("người làm (can_act) ⇒ không nút Duyệt/Trả lại/Từ chối ở đầu trang", () => {
    const v = engineApprovalView(card({}), { write: true, hasSource: true });
    expect(v).toEqual({ confirm: false, approve: false, reject: false, redo: false, note: null });
  });
  test("người ngoài nhóm làm ⇒ ghi chú chờ, không nút", () => {
    const v = engineApprovalView(card({ can_act: false, block_reason: "not_reviewer" }), {
      write: true,
      hasSource: true,
    });
    expect(v.pass).toBeUndefined();
    expect(v.note).toBe("contracts.approval.engine.blocked.notReviewer");
  });
});
