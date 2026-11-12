import { describe, expect, test } from "bun:test";
import { type HeadActIn, type HeadRuleIn, headActs, headRule } from "./head-rule";

const can = {
  submit: true,
  withdraw: false,
  recreate: false,
  new_version: false,
  hold: false,
  release: false,
};
const base: HeadRuleIn = {
  status: "draft",
  extractState: "ready",
  round: 0,
  superseded: false,
  write: true,
  can,
  hold: false,
  approvalLoaded: true,
  approvalStep: null,
  approvalConfirm: false,
  edited: false,
};
const r = (o: Partial<HeadRuleIn>) => headRule({ ...base, ...o });

describe("CR-127 U5 · đầu trang chi tiết theo 4 trạng thái", () => {
  test("DRAFT lần đầu, tenant tắt duyệt ⇒ thanh dính Lưu nháp + Xác nhận và lưu, không băng", () => {
    expect(r({})).toMatchObject({
      sticky: true,
      draftSave: true,
      confirmSave: true,
      resubmit: false,
      banner: null,
    });
  });
  test("bật duyệt: người xác nhận được ⇒ nút của thẻ duyệt, không nút trang", () => {
    expect(r({ approvalStep: "level1", approvalConfirm: true })).toMatchObject({
      draftSave: false,
      confirmSave: false,
    });
  });
  test("DRAFT bị trả lại (vòng > 0) ⇒ băng 'returned' + Gửi lại, không thanh dính", () => {
    expect(r({ round: 1 })).toMatchObject({
      banner: "returned",
      resubmit: true,
      sticky: false,
      canSave: true,
    });
  });
  test("AI đang đọc ⇒ không sửa được, nói lý do", () => {
    expect(r({ extractState: "reading" })).toMatchObject({
      canSave: false,
      banner: "reading",
      why: "reading",
    });
  });
  test("AI đọc lỗi ở DRAFT ⇒ băng 'readFailed' (sửa tay hoặc Đọc lại)", () => {
    expect(r({ extractState: "failed" })).toMatchObject({ banner: "readFailed", why: "failed" });
  });
  test("PROCESSING ⇒ chữ đọc (không canSave), băng 'waiting', Rút về theo can", () => {
    expect(r({ status: "processing", can: { ...can, withdraw: true } })).toMatchObject({
      canSave: false,
      sticky: false,
      banner: "waiting",
      withdraw: true,
    });
  });
  test("REJECT ⇒ băng 'rejected' + Tạo lại theo can", () => {
    expect(r({ status: "reject", can: { ...can, recreate: true } })).toMatchObject({
      banner: "rejected",
      recreate: true,
      canSave: false,
    });
  });
  test("DONE ⇒ không băng; Tải phiên bản mới theo can; tạm khoá ⇒ băng 'hold' + Mở khoá", () => {
    expect(r({ status: "done", can: { ...can, new_version: true, hold: true } })).toMatchObject({
      banner: null,
      newVersion: true,
      hold: true,
    });
    expect(
      r({ status: "done", hold: true, can: { ...can, release: true, hold: false } }),
    ).toMatchObject({ banner: "hold", release: true });
  });
  test("bản đã bị thay ⇒ chỉ đọc + băng 'superseded'", () => {
    expect(r({ status: "done", superseded: true, write: false })).toMatchObject({
      banner: "superseded",
      canSave: false,
    });
  });
  test("HĐ nhận chờ người phụ trách quyết ⇒ 3 nút quyết + băng 'inbox'", () => {
    expect(r({ status: "processing", awaitingDecision: true })).toMatchObject({
      inboxDecision: true,
      banner: "inbox",
    });
  });
  test("Huỷ: có sửa ⇒ bỏ sửa; chưa sửa ⇒ về danh sách", () => {
    expect(r({ edited: true }).cancel).toBe("reset");
    expect(r({}).cancel).toBe("back");
  });
});

describe("NF1 · công ty chưa có quy trình duyệt (submit_block=no_flow)", () => {
  const base = {
    status: "draft",
    extractState: "ready",
    round: 0,
    superseded: false,
    write: true,
    can: { submit: false },
    hold: false,
    approvalLoaded: true,
    approvalStep: null,
    approvalConfirm: false,
    edited: false,
  } as unknown as Parameters<typeof headRule>[0];
  test("lần đầu: ẩn Xác nhận và lưu, còn Lưu nháp + lý do", () => {
    const r = headRule({ ...base, submitBlock: "no_flow" });
    expect(r.confirmSave).toBe(false);
    expect(r.draftSave).toBe(true);
    expect(r.submitBlocked).toBe(true);
    expect(headRule({ ...base, submitBlock: null }).confirmSave).toBe(true);
  });
  test("sau khi bị trả lại: Gửi lại hiện nhưng khoá kèm lý do", () => {
    const r = headRule({ ...base, round: 1, submitBlock: "no_flow" });
    expect(r.resubmit).toBe(true);
    expect(r.submitBlocked).toBe(true);
  });
  test("không chặn ⇒ không lý do", () => {
    expect(headRule({ ...base }).submitBlocked).toBe(false);
  });
});

describe("headActs (CR-128 e)", () => {
  const rule = (o: Partial<HeadActIn["rule"]> = {}): HeadActIn["rule"] => ({
    sticky: false,
    resubmit: false,
    submitBlocked: false,
    confirmSave: false,
    withdraw: false,
    recreate: false,
    newVersion: false,
    hold: false,
    release: false,
    ...o,
  });
  const view = { confirm: false, approve: false, reject: false };
  test("Duyệt thắng Gửi lại; Từ chối/Trả lại vào menu", () => {
    const a = headActs({
      rule: rule({ resubmit: true }),
      view: { ...view, approve: true, reject: true, back: true },
      canDelete: false,
    });
    expect(a.primary).toBe("approve");
    expect(a.menu.map((m) => m.key)).toEqual(["resubmit", "back", "reject"]);
  });
  test("ưu tiên Mở khoá > Tải phiên bản mới > Tạo lại; Xoá cuối, danger", () => {
    const a = headActs({
      rule: rule({ release: true, newVersion: true, recreate: true, hold: true }),
      view,
      canDelete: true,
    });
    expect(a.primary).toBe("release");
    expect(a.menu.map((m) => m.key)).toEqual(["newVersion", "recreate", "hold", "delete"]);
    expect(a.menu.at(-1)?.danger).toBe(true);
  });
  test("Gửi lại bị chặn ⇒ không là nút chính, menu mờ kèm lý do", () => {
    const a = headActs({
      rule: rule({ resubmit: true, submitBlocked: true }),
      view,
      canDelete: false,
    });
    expect(a.primary).toBeNull();
    expect(a.menu).toEqual([{ key: "resubmit", whyKey: "contracts.u5.err.NO_APPROVAL_FLOW" }]);
  });
  test("Rút về/Tạm khoá không bao giờ là nút chính", () => {
    expect(
      headActs({ rule: rule({ withdraw: true, hold: true }), view, canDelete: false }).primary,
    ).toBeNull();
  });
  test("CR-135 Q2: nháp lần đầu — chính = Xác nhận/Gửi duyệt, Lưu nháp + Huỷ + Xoá trong menu", () => {
    const a = headActs({
      rule: rule({ sticky: true }),
      view: { ...view, confirm: true },
      canDelete: true,
    });
    expect(a.primary).toBe("approvalConfirm");
    expect(a.menu.map((m) => m.key)).toEqual(["saveDraft", "cancel", "delete"]);
  });
  test("CR-135 Q2: nháp chưa gửi duyệt được ⇒ Lưu nháp là nút chính, menu còn Huỷ", () => {
    const a = headActs({ rule: rule({ sticky: true }), view, canDelete: false });
    expect(a.primary).toBe("saveDraft");
    expect(a.menu.map((m) => m.key)).toEqual(["cancel"]);
  });
  test("CR-135 Q12: chỉ DRAFT + người ghi mới đổi tên được", () => {
    expect(headRule({ ...base }).rename).toBe(true);
    expect(headRule({ ...base, write: false }).rename).toBe(false);
    expect(headRule({ ...base, status: "processing" }).rename).toBe(false);
    expect(headRule({ ...base, superseded: true }).rename).toBe(false);
  });
});
