import { describe, expect, test } from "bun:test";
import type { FlowWhen } from "@ai/contracts";
import {
  flowReducer,
  groupKeysOf,
  type LibStep,
  newEsign,
  newReview,
  parseSlotBody,
  toSlotBody,
  validateFlow,
} from "./flow-form";
import { buildWhen, whenParts } from "./flow-when";

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

describe("flow-when", () => {
  test("whenParts ⇄ buildWhen", () => {
    const w = buildWhen("or", ["buy", "sell"], { op: "ge", value: 50_000_000 });
    expect(w).toEqual({
      op: "or",
      conds: [
        { field: "deal", in: ["buy", "sell"] },
        { field: "total_value", op: "ge", value: 50_000_000 },
      ],
    });
    expect(whenParts(w)).toEqual({ deal: ["buy", "sell"], value: { op: "ge", value: 50_000_000 } });
    expect(buildWhen("and", [], null).conds).toEqual([]);
  });
});
