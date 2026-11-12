// CR-127 · U4 · luật thuần của dải nhận việc (BR-27…34) + bảng mã lỗi §9.
import { describe, expect, test } from "bun:test";
import { claimView, cr127ErrorKey, whoOf } from "./claim";

const A = { id: "11111111-1111-4111-8111-111111111111", display_name: "Lan" };

describe("claimView", () => {
  test("việc không có thông tin nhận ⇒ không dải, không khoá", () => {
    const v = claimView({});
    expect(v.claimable).toBe(false);
    expect(v.decideLocked).toBeNull();
  });
  test("chưa ai nhận ⇒ hiện Nhận việc, khoá nút quyết", () => {
    const v = claimView({ claim: { state: "unclaimed" }, need: "one" });
    expect(v).toMatchObject({ canClaim: true, canRelease: false, decideLocked: "unclaimed" });
  });
  test("mình giữ ⇒ hiện Trả về nhóm, mở nút quyết", () => {
    const v = claimView({ claim: { state: "mine", by: A } });
    expect(v).toMatchObject({ canClaim: false, canRelease: true, decideLocked: null });
  });
  test("người khác giữ ⇒ «X đang xử lý», khoá", () => {
    const v = claimView({ claim: { state: "other", by: A } });
    expect(v).toMatchObject({ holder: "Lan", decideLocked: "other", canClaim: false });
  });
  test("Cần tất cả ⇒ không nhận việc, chỉ x/n", () => {
    const v = claimView({
      claim: { state: "unclaimed" },
      need: "all",
      votes: { done: 2, total: 5 },
    });
    expect(v).toMatchObject({ claimable: false, decideLocked: null, votesText: "2/5" });
  });
  test("làm thay người uỷ quyền ⇒ nhãn Thay A", () => {
    expect(claimView({ delegated_from: A }).onBehalfOf).toBe("Lan");
  });
});

describe("mã lỗi", () => {
  test("mã của lát ⇒ khoá i18n; mã lạ ⇒ null", () => {
    expect(cr127ErrorKey("TASK_CLAIMED")).toBe("contracts.work.u4.err.TASK_CLAIMED");
    expect(cr127ErrorKey("EVIDENCE_REQUIRED")).toBe("contracts.work.u4.err.EVIDENCE_REQUIRED");
    expect(cr127ErrorKey("NOPE")).toBeNull();
    expect(cr127ErrorKey(undefined)).toBeNull();
  });
  test("tên người từ details.by", () => {
    expect(whoOf({ by: "Hùng" }, "người khác")).toBe("Hùng");
    expect(whoOf({ by: { display_name: "Mai" } }, "người khác")).toBe("Mai");
    expect(whoOf(undefined, "người khác")).toBe("người khác");
  });
});

describe("U4b-1 · canReassign", () => {
  test("chỉ true khi hub báo can_reassign=true trên việc nhóm", () => {
    expect(claimView({ claim: { state: "unclaimed" }, need: "one" }).canReassign).toBe(false);
    expect(
      claimView({ claim: { state: "unclaimed" }, need: "one", can_reassign: true }).canReassign,
    ).toBe(true);
    expect(claimView({ need: "one", can_reassign: true }).canReassign).toBe(false);
  });
});
