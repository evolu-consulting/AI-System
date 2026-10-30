import { describe, expect, test } from "bun:test";
import { previewPath, toCurrentFlow } from "./current-flow";

describe("current-flow · toCurrentFlow", () => {
  test("hình mới: tên + v + bước (tên phòng ban dạng chuỗi hoặc đối tượng)", () => {
    const f = toCurrentFlow({
      name: "Quy trình HĐ mặc định",
      rel_version: 4,
      is_default: true,
      steps: [
        "Kinh doanh",
        { key: "pháp-chế", name: "Duyệt pháp chế", department_name: "Pháp chế" },
      ],
    });
    expect(f?.name).toBe("Quy trình HĐ mặc định");
    expect(f?.version).toBe(4);
    expect(f?.isDefault).toBe(true);
    expect(f?.steps.map((s) => s.department)).toEqual(["Kinh doanh", "Pháp chế"]);
  });
  test("sai hình (thiếu tên / bản cũ có version) ⇒ null", () => {
    expect(toCurrentFlow({ version: 3, is_default: false, steps: [] })).toBeNull();
    expect(toCurrentFlow({ name: "A", rel_version: 1, steps: [1] })).toBeNull();
    expect(toCurrentFlow(null)).toBeNull();
  });
});

describe("current-flow · previewPath", () => {
  const flow = toCurrentFlow({
    name: "A",
    rel_version: 1,
    is_default: false,
    steps: [
      { name: "Soạn", department_name: "KD" },
      {
        name: "Giám đốc",
        when: { op: "and", conds: [{ field: "total_value", op: "ge", value: 100 }] },
      },
      { name: "Bán", when: { op: "or", conds: [{ field: "deal", in: ["sell"] }] } },
    ],
  });
  test("bước đầu luôn chạy; điều kiện theo giá trị/loại", () => {
    const s = flow?.steps ?? [];
    expect(previewPath(s, { deal: "buy", value: 50 })).toEqual([true, false, false]);
    expect(previewPath(s, { deal: "sell", value: 100 })).toEqual([true, true, true]);
  });
  test("giá trị trống ⇒ điều kiện giá trị coi là đúng", () => {
    expect(previewPath(flow?.steps ?? [], { deal: "buy", value: null })).toEqual([
      true,
      true,
      false,
    ]);
  });
});
