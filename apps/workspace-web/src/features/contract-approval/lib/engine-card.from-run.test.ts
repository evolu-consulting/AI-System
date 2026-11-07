// CR-124 · q6 · lượt flow THEO SỰ KIỆN có stage Duyệt ở vị trí 0: người duyệt thấy Đạt / Trả lại / Từ chối (không phải «Gửi duyệt» của bước soạn máy cũ).
// Trước sửa: `engineApprovalView` coi mọi bước idx 0 là bước soạn ⇒ Giám đốc (quản trị) chỉ có «Gửi duyệt»; nhân viên vẫn thấy «Bản nháp».
import { describe, expect, test } from "bun:test";
import type { ContractApproval } from "@ai/contracts/pack-contracts";
import { engineApprovalView, submittedForReview } from "./engine-card";
import { isDraftConfirm, movedToStep } from "./moved-to";

const open0 = (o: Partial<ContractApproval>): ContractApproval =>
  ({
    mode: "engine",
    step: "level1",
    engine_run_id: "r1",
    can_act: true,
    steps: [{ idx: 0, key: "giam-doc", name: "Giám đốc duyệt", kind: "review", status: "open" }],
    ...o,
  }) as unknown as ContractApproval;

describe("thẻ lượt flow theo sự kiện, bước Duyệt ở idx 0", () => {
  test("from_run ⇒ Đạt + Trả lại + Từ chối, không «Xác nhận và lưu»", () => {
    const v = engineApprovalView(open0({ from_run: true }), { write: true, hasSource: true });
    expect(v).toMatchObject({ pass: true, back: true, reject: true, confirm: false });
  });
  test("thẻ máy cũ: idx 0 vẫn là bước soạn (Xác nhận và lưu)", () => {
    const v = engineApprovalView(open0({}), { write: true, hasSource: true });
    expect(v).toMatchObject({ confirm: true });
    expect(v.pass).toBeUndefined();
  });
  test("from_run ⇒ HĐ đã gửi đi, không còn là bản nháp; thẻ nói đã chuyển tới bước", () => {
    expect(submittedForReview(open0({ from_run: true }))).toBe(true);
    expect(submittedForReview(open0({}))).toBe(false);
    expect(movedToStep(open0({ from_run: true }))).toBe("Giám đốc duyệt");
    expect(isDraftConfirm(open0({ from_run: true }))).toBe(false);
    expect(isDraftConfirm(open0({}))).toBe(true);
  });
});
