import { describe, expect, test } from "bun:test";
import type { FlowWhen } from "@ai/contracts/pack-contracts";
import {
  flowReducer,
  groupKeysOf,
  type LibNotifyStep,
  type LibStep,
  type LibWaitStep,
  newEsign,
  newNotify,
  newReview,
  newWait,
  parseSlotBody,
  toSlotBody,
  validateFlow,
} from "./flow-form";
import { DEFAULT_FIELDS, whenAdd } from "./flow-when";

const r = (over: Partial<ReturnType<typeof newReview>> = {}, steps: LibStep[] = []) => ({
  ...newReview(steps, "pb-ke-toan"),
  name: "Kế toán",
  ...over,
});

describe("flow-form reducer", () => {
  test("thêm bước duyệt chèn trước bước Ký số, Ký số luôn cuối và chỉ một", () => {
    let s: LibStep[] = [r()];
    s = flowReducer(s, { type: "addEsign", name: "Ký số" });
    s = flowReducer(s, { type: "addEsign", name: "Ký số 2" });
    s = flowReducer(s, { type: "addReview" });
    expect(s.map((x) => x.kind)).toEqual(["review", "review", "esign"]);
  });
  test("không xoá/đổi bước 1; không đổi chỗ với Ký số", () => {
    let s: LibStep[] = [r(), r({ key: "s2" }), newEsign([], "Ký số")];
    expect(flowReducer(s, { type: "remove", index: 0 })).toBe(s);
    expect(flowReducer(s, { type: "move", index: 1, dir: 1 })).toBe(s);
    expect(flowReducer(s, { type: "move", index: 1, dir: -1 })).toBe(s);
    s = flowReducer(s, { type: "remove", index: 1 });
    expect(s).toHaveLength(2);
  });
  test("setWhen bỏ qua bước 1", () => {
    const w: FlowWhen = { op: "and", conds: [{ field: "deal", in: ["buy"] }] };
    const s: LibStep[] = [r(), r({ key: "s2" })];
    const out = flowReducer(s, { type: "setWhen", index: 0, when: w });
    expect(out).toBe(s);
    expect(
      (flowReducer(s, { type: "setWhen", index: 1, when: w })[1] as { when: FlowWhen }).when,
    ).toEqual(w);
  });
});

describe("flow-form validate", () => {
  const codes = (steps: LibStep[]) => validateFlow(steps).map((i) => `${i.index}:${i.code}`);
  test("hợp lệ ⇒ không lỗi", () => {
    expect(validateFlow([r(), r({ key: "s2" }), newEsign([], "Ký số")])).toEqual([]);
  });
  test("thiếu mã phòng ban / tên / hạn / nhắc / chuyển cấp trùng", () => {
    expect(codes([r({ department_group_key: null, name: " " })])).toEqual([
      "0:nameEmpty",
      "0:GROUP_REQUIRED",
    ]);
    expect(codes([r({ due_h: 0 })])).toContain("0:DUE_RANGE");
    expect(codes([r({ remind_every_h: 99999 })])).toContain("0:REMIND_RANGE");
    expect(codes([r({ escalate_group_key: "pb-ke-toan" })])).toContain("0:ESCALATE_SAME_GROUP");
  });
  test("người duyệt cụ thể thay cho phòng ban", () => {
    expect(validateFlow([r({ department_group_key: null, approver_user_id: "u1" })])).toEqual([]);
  });
  test("Ký số không cuối, dept_head thiếu mã, khoá trùng, bước 1 có điều kiện", () => {
    const es = newEsign([], "Ký số");
    expect(codes([r(), es, r({ key: "s3" })])).toContain("1:ESIGN_NOT_LAST");
    expect(
      codes([r(), { ...es, company_signer: { mode: "dept_head", department_group_key: null } }]),
    ).toContain("1:SIGNER_GROUP_REQUIRED");
    expect(codes([r(), r()])).toContain("1:KEY_DUP");
    const w: FlowWhen = { op: "and", conds: [{ field: "deal", in: ["buy"] }] };
    expect(codes([r({ when: w })])).toContain("0:FIRST_CONDITIONAL");
    expect(codes([r(), r({ key: "s2", when: { op: "and", conds: [] } })])).toContain("1:whenEmpty");
  });
  test("bước đầu phải là bước duyệt", () => {
    expect(codes([newEsign([], "Ký số")])).toContain("0:FIRST_NOT_REVIEW");
    expect(codes([])).toContain("0:FIRST_NOT_REVIEW");
  });
});

describe("slot_body", () => {
  test("parse chấp nhận {steps} và mảng trần; dạng lạ ⇒ null", () => {
    const steps = [r()];
    expect(parseSlotBody({ steps })).toEqual(steps);
    expect(parseSlotBody(steps)).toEqual(steps);
    expect(parseSlotBody({ steps: [{ kind: "parallel" }] })).toBeNull();
    expect(parseSlotBody(null)).toBeNull();
  });
  test("toSlotBody sao chép sâu", () => {
    const steps = [r()];
    const body = toSlotBody(steps);
    expect(body.steps).toEqual(steps);
    expect(body.steps[0]).not.toBe(steps[0]);
  });
  test("groupKeysOf gom mã phòng ban (không trùng)", () => {
    const es = {
      ...newEsign([], "Ký số"),
      company_signer: { mode: "dept_head" as const, department_group_key: "pb-gd" },
    };
    expect(groupKeysOf([r({ escalate_group_key: "pb-gd" }), es])).toEqual(["pb-gd", "pb-ke-toan"]);
  });
});

describe("validateFlow · điều kiện theo trường của khe", () => {
  const dept = DEFAULT_FIELDS.find((x) => x.key === "creator_department");
  const when = (w: FlowWhen) => validateFlow([r(), r({ key: "s2", when: w })]);
  test("điều kiện phòng ban chưa chọn phòng ⇒ chặn (condValueEmpty) ở bước 2", () => {
    if (!dept) throw new Error("thiếu trường");
    const issues = when(whenAdd(null, dept));
    expect(issues).toEqual([{ index: 1, field: "when", code: "condValueEmpty" }]);
  });
  test("trường ngoài danh mục của khe ⇒ condFieldUnknown", () => {
    const w: FlowWhen = { op: "and", conds: [{ field: "new_partner", is: true }] };
    const only = DEFAULT_FIELDS.filter((x) => x.key !== "new_partner");
    expect(validateFlow([r(), r({ key: "s2", when: w })], only).map((i) => i.code)).toEqual([
      "condFieldUnknown",
    ]);
    expect(when(w)).toEqual([]);
  });
});

// CR-121 D-6b · Thông báo / Chờ tới trong Form (luật kiểm khớp hub `notifyWaitIssues`).
describe("flow-form · Thông báo / Chờ tới (D-6b)", () => {
  const nt = (over: Partial<LibNotifyStep> = {}, steps: LibStep[] = []): LibNotifyStep => ({
    ...newNotify(steps, "Báo duyệt xong"),
    title: "Đã duyệt {ma_hd}",
    ...over,
  });
  const codes = (steps: LibStep[]) => validateFlow(steps).map((i) => `${i.index}:${i.code}`);

  test("thêm Thông báo và Chờ tới chèn trước Ký số, khoá không trùng", () => {
    let s: LibStep[] = [r()];
    s = flowReducer(s, { type: "addEsign", name: "Ký số" });
    s = flowReducer(s, { type: "addNotify", name: "TB" });
    s = flowReducer(s, { type: "addWait", name: "Chờ" });
    expect(s.map((x) => x.kind)).toEqual(["review", "notify", "wait_until", "esign"]);
    expect(new Set(s.map((x) => x.key)).size).toBe(4);
  });
  test("thiếu tiêu đề thông báo báo NOTIFY_TITLE_REQUIRED, mặc định là người gửi duyệt và chuông", () => {
    expect(newNotify([], "x")).toMatchObject({
      to: { creator: true, owner: false, group_key: null },
      channels: ["bell"],
    });
    expect(codes([r(), nt({ title: "  " })])).toEqual(["1:NOTIFY_TITLE_REQUIRED"]);
  });
  test("thiếu người nhận hoặc kênh báo đúng mã, chọn phòng theo mã là đủ", () => {
    const none = { creator: false, owner: false, group_key: null };
    expect(codes([r(), nt({ to: none, channels: [] })])).toEqual([
      "1:NOTIFY_TO_REQUIRED",
      "1:NOTIFY_CHANNEL_REQUIRED",
    ]);
    expect(codes([r(), nt({ to: { ...none, group_key: "pb-giam-doc" } })])).toEqual([]);
  });
  test("Chờ tới lệch ngoài 365 ngày báo WAIT_OFFSET_RANGE, giờ sai báo WAIT_TIME_INVALID", () => {
    const w = (over: Partial<LibWaitStep>): LibStep => ({ ...newWait([r()], "Chờ"), ...over });
    expect(codes([r(), w({ offset_days: 366 })])).toEqual(["1:WAIT_OFFSET_RANGE"]);
    expect(codes([r(), w({ offset_days: -365 })])).toEqual([]);
    expect(codes([r(), w({ offset_days: 1.5 })])).toEqual(["1:WAIT_OFFSET_RANGE"]);
    expect(codes([r(), w({ offset_days: Number.NaN })])).toEqual(["1:WAIT_OFFSET_RANGE"]);
    expect(codes([r(), w({ time: "25:00" })])).toEqual(["1:WAIT_TIME_INVALID"]);
  });
  test("bước duyệt sau Thông báo hoặc Chờ tới không được có điều kiện", () => {
    const when: FlowWhen = { op: "and", conds: [{ field: "deal", in: ["buy"] }] };
    expect(codes([r(), nt(), r({ key: "s3", when })])).toContain("2:AFTER_DIFY_CONDITIONAL");
    expect(codes([r(), newWait([r()], "Chờ"), r({ key: "s3", when })])).toContain(
      "2:AFTER_DIFY_CONDITIONAL",
    );
  });
  test("parseSlotBody nhận Thông báo và Chờ tới, groupKeysOf lấy phòng nhận", () => {
    const steps: LibStep[] = [
      r(),
      nt({ to: { creator: false, owner: true, group_key: "pb-gd" } }),
      newWait([r()], "Chờ"),
    ];
    const back = parseSlotBody(toSlotBody(steps));
    expect(back?.map((x) => x.kind)).toEqual(["review", "notify", "wait_until"]);
    expect(groupKeysOf(steps)).toEqual(["pb-gd", "pb-ke-toan"]);
  });
});
