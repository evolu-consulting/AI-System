import { describe, expect, test } from "bun:test";
import { whenText } from "./start-when";

// t giả: trả phần cuối của khoá + tham số để kiểm đúng nhánh chọn chữ.
const t = (k: string, o?: Record<string, unknown>) =>
  o ? `${k.split(".").pop()}(${Object.values(o).join("|")})` : (k.split(".").pop() as string);

describe("start-when · chữ nghiệp vụ", () => {
  test("không điều kiện ⇒ «Mọi hợp đồng còn lại»", () => {
    expect(whenText(null, {}, t)).toBe("always");
  });
  test("giá trị theo triệu + phòng theo TÊN, nối bằng và", () => {
    const w = {
      op: "and",
      conds: [
        { fact: "total_value", op: "ge", value: 500_000_000 },
        { fact: "creator_department", op: "in", value: ["mua-hang"] },
      ],
    } as const;
    expect(whenText(w, { "mua-hang": "Mua hàng" }, t)).toBe("value(≥|500)anddept(Mua hàng)");
  });
  test("mã phòng không có tên ⇒ giữ mã (không rỗng)", () => {
    const w = {
      op: "or",
      conds: [{ fact: "submitter_group_ids", op: "in", value: ["x"] }],
    } as const;
    expect(whenText(w, {}, t)).toBe("dept(x)");
  });
});
