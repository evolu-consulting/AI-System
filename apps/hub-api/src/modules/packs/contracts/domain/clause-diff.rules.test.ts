// CR-127 K5 · BR-36/36a: tách điều khoản, đổi theo điều khoản, "yêu cầu lần trước" khớp điều khoản (thuần).
import { describe, expect, it } from "bun:test";
import { changesSinceLast, diffClauses, mentionsRef, splitClauses } from "./clause-diff.rules";

const V1 =
  "HỢP ĐỒNG\nBên A và bên B.\nĐiều 1. Giá\nGiá 100.\nĐiều 2. Giao hàng\nGiao 30 ngày.\nĐiều 10. Phạt\nPhạt 1%.";
const V2 =
  "HỢP ĐỒNG\nBên A và bên B.\nĐiều 1. Giá\nGiá 120.\nĐiều 2. Giao hàng\nGiao  30 ngày.\nĐiều 10. Phạt\nPhạt 1%.\nĐiều 11. Mới\nNội dung mới.";

describe("splitClauses", () => {
  it("mở đầu + từng điều; rỗng ⇒ không có", () => {
    expect([...splitClauses(V1).keys()]).toEqual(["Mở đầu", "Điều 1", "Điều 2", "Điều 10"]);
    expect(splitClauses(null).size).toBe(0);
    expect(splitClauses("Điều 3. A\nx\nĐiều 3. B\ny").get("Điều 3")).toContain("y");
  });
});

describe("diffClauses", () => {
  it("chỉ điều đổi mới changed; khoảng trắng thừa không tính; điều mới có before null", () => {
    const d = diffClauses(V1, V2);
    expect(d.filter((c) => c.changed).map((c) => c.ref)).toEqual(["Điều 1", "Điều 11"]);
    expect(d.find((c) => c.ref === "Điều 11")).toMatchObject({ before: null });
    expect(d.find((c) => c.ref === "Điều 2")).toMatchObject({
      changed: false,
      before: null,
      after: null,
    });
  });
  it("điều bị bỏ ⇒ changed, after null", () => {
    const d = diffClauses(V2, V1);
    expect(d.find((c) => c.ref === "Điều 11")).toMatchObject({ changed: true, after: null });
  });
});

describe("mentionsRef / changesSinceLast", () => {
  it("khớp không dấu, không nhầm Điều 1 với Điều 10", () => {
    expect(mentionsRef("Sửa lại điều 10 và DIEU 2", "Điều 10")).toBe(true);
    expect(mentionsRef("Sửa điều 10", "Điều 1")).toBe(false);
    expect(mentionsRef("Điều 5", "Mở đầu")).toBe(false);
    expect(mentionsRef(null, "Điều 1")).toBe(false);
  });
  it("điều đổi hoặc được nhắc; cờ requested đúng", () => {
    const r = changesSinceLast(V1, V2, "Xem lại điều 1 và điều 10");
    expect(r.map((c) => [c.ref, c.changed, c.requested])).toEqual([
      ["Điều 1", true, true],
      ["Điều 10", false, true],
      ["Điều 11", true, false],
    ]);
  });
  it("không đổi, không yêu cầu ⇒ rỗng", () => {
    expect(changesSinceLast(V1, V1, null)).toEqual([]);
  });
});
