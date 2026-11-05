import { describe, expect, test } from "bun:test";
import { type HeadRuleIn, headRule } from "./head-rule";

const base: HeadRuleIn = {
  status: "needs_review",
  locked: false,
  write: true,
  approvalLoaded: true,
  approvalStep: null,
  approvalConfirm: false,
  edited: false,
};
const r = (o: Partial<HeadRuleIn>) => headRule({ ...base, ...o });

describe("lock-strict · thanh nút đầu trang HĐ", () => {
  test("tenant tắt duyệt, chờ xác nhận ⇒ Lưu nháp + Xác nhận và lưu", () => {
    expect(r({})).toMatchObject({ sticky: true, draftSave: true, confirmSave: true });
  });
  test("tenant bật duyệt: người xác nhận được ⇒ chỉ nút của thẻ duyệt (không Lưu nháp, không nút trang)", () => {
    expect(r({ approvalStep: "level1", approvalConfirm: true })).toMatchObject({
      draftSave: false,
      confirmSave: false,
    });
  });
  test("tenant bật duyệt: không xác nhận được ⇒ Lưu nháp, KHÔNG có Xác nhận và lưu của trang", () => {
    expect(r({ approvalStep: "level1" })).toMatchObject({ draftSave: true, confirmSave: false });
  });
  test("chưa tải trạng thái duyệt ⇒ chưa hiện Xác nhận và lưu", () => {
    expect(r({ approvalLoaded: false })).toMatchObject({ draftSave: true, confirmSave: false });
  });
  test("viewer ⇒ không có nút nào", () => {
    expect(r({ write: false })).toMatchObject({
      canSave: false,
      sticky: false,
      draftSave: false,
      confirmSave: false,
    });
  });
  test("HĐ đã khoá ⇒ không lưu được, thanh dính tắt", () => {
    expect(r({ status: "active", locked: true })).toMatchObject({
      canSave: false,
      sticky: false,
      draftSave: false,
      confirmSave: false,
    });
  });
  test("HĐ đã mở lại (needs_review, chưa khoá) tenant tắt duyệt ⇒ có Xác nhận và lưu", () => {
    expect(r({ status: "needs_review", locked: false }).confirmSave).toBe(true);
  });
  test("Huỷ: có sửa ⇒ reset; chưa sửa ⇒ về danh sách", () => {
    expect(r({ edited: true }).cancel).toBe("reset");
    expect(r({ edited: false }).cancel).toBe("back");
  });
  test("HĐ đang hiệu lực chưa khoá (hiếm) ⇒ canSave nhưng không thanh dính", () => {
    expect(r({ status: "active" })).toMatchObject({
      canSave: true,
      sticky: false,
      draftSave: false,
    });
  });
});
