// CR-121 D-3: logic thuần của trình dựng điều kiện (thêm/sửa/xoá/nhóm lồng một cấp, câu mô tả, mã lỗi).
import { describe, expect, test } from "bun:test";
import type { FlowWhen } from "@ai/contracts";
import {
  condIssueCodes,
  DEFAULT_FIELDS,
  newCond,
  whenAdd,
  whenGroup,
  whenPatch,
  whenRemove,
  whenSetOp,
} from "./flow-when";

const F = (key: string) => {
  const f = DEFAULT_FIELDS.find((x) => x.key === key);
  if (!f) throw new Error(key);
  return f;
};

describe("flow-when · dựng điều kiện", () => {
  test("điều kiện mới theo kiểu trường", () => {
    expect(newCond(F("total_value"))).toEqual({ field: "total_value", op: "ge", value: 0 });
    expect(newCond(F("deal"))).toEqual({ field: "deal", in: ["buy"] });
    expect(newCond(F("creator_department"))).toEqual({ field: "creator_department", in: [] });
    expect(newCond(F("new_partner"))).toEqual({ field: "new_partner", is: true });
  });

  test("Giá trị ≥ 500tr và Loại = Mua (ghép và)", () => {
    let w = whenAdd(null, F("total_value"));
    w = whenPatch(w, [0], { field: "total_value", op: "ge", value: 500_000_000 });
    w = whenAdd(w, F("deal"));
    expect(w).toEqual({
      op: "and",
      conds: [
        { field: "total_value", op: "ge", value: 500_000_000 },
        { field: "deal", in: ["buy"] },
      ],
    });
    expect(condIssueCodes(w, DEFAULT_FIELDS)).toEqual([]);
  });

  test("nhóm: (phòng KD và ≥ 500tr) hoặc đối tác mới", () => {
    let w = whenAdd(null, F("creator_department"));
    w = whenPatch(w, [0], { field: "creator_department", in: ["pb-kd"] });
    w = whenGroup(w, 0); // cấp ngoài "và" ⇒ nhóm "hoặc"
    w = whenSetOp(w, "and", 0);
    w = whenAdd(w, F("total_value"), 0);
    w = whenPatch(w, [0, 1], { field: "total_value", op: "ge", value: 500_000_000 });
    w = whenSetOp(w, "or");
    w = whenAdd(w, F("new_partner"));
    const want: FlowWhen = {
      op: "or",
      conds: [
        {
          op: "and",
          conds: [
            { field: "creator_department", in: ["pb-kd"] },
            { field: "total_value", op: "ge", value: 500_000_000 },
          ],
        },
        { field: "new_partner", is: true },
      ],
    };
    expect(w).toEqual(want);
    expect(JSON.parse(JSON.stringify(w))).toEqual(want); // lưu rồi mở lại: y nguyên
  });

  test("xoá: nhóm hết phần tử bị bỏ, hết cả ⇒ null (Luôn chạy)", () => {
    const w: FlowWhen = {
      op: "or",
      conds: [
        { op: "and", conds: [{ field: "new_partner", is: true }] },
        { field: "deal", in: ["sell"] },
      ],
    };
    const a = whenRemove(w, [0, 0]);
    expect(a).toEqual({ op: "or", conds: [{ field: "deal", in: ["sell"] }] });
    expect(a && whenRemove(a, [0])).toBeNull();
  });

  test("mã lỗi: thiếu giá trị / số sai / trường lạ / rỗng", () => {
    const dept = whenAdd(null, F("creator_department"));
    expect(condIssueCodes(dept, DEFAULT_FIELDS)).toEqual(["condValueEmpty"]);
    const bad = whenPatch(whenAdd(null, F("total_value")), [0], {
      field: "total_value",
      op: "ge",
      value: -1,
    });
    expect(condIssueCodes(bad, DEFAULT_FIELDS)).toEqual(["amountInvalid"]);
    expect(condIssueCodes(dept, [])).toEqual(["condFieldUnknown"]);
    expect(condIssueCodes({ op: "and", conds: [] }, DEFAULT_FIELDS)).toEqual(["whenEmpty"]);
  });
});
