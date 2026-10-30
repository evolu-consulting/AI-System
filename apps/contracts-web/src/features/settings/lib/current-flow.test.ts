import { describe, expect, test } from "bun:test";
import { previewPath, toCurrentFlow } from "./current-flow";

const DEF = "11111111-1111-4111-8111-111111111111";
const raw = (steps: unknown[], extra: Record<string, unknown> = {}) => ({
  def_id: DEF,
  name: "Quy trình HĐ mặc định",
  rel_version: 4,
  is_default: true,
  steps,
  ...extra,
});
const GD = {
  name: "Giám đốc",
  department_name: "Ban giám đốc",
  kind: "review",
  when: { op: "and", conds: [{ field: "total_value", op: "ge", value: 100 }] },
};

describe("current-flow · toCurrentFlow", () => {
  test("hình GET mới: def_id + tên + v + bước (tên phòng ban)", () => {
    const f = toCurrentFlow(
      raw([
        { name: "Soạn", department_name: "Kinh doanh", kind: "review" },
        { name: "Dify", department_name: null, kind: "dify" },
      ]),
    );
    expect(f?.defId).toBe(DEF);
    expect(f?.name).toBe("Quy trình HĐ mặc định");
    expect(f?.version).toBe(4);
    expect(f?.isDefault).toBe(true);
    expect(f?.steps.map((s) => [s.department, s.kind])).toEqual([
      ["Kinh doanh", "review"],
      [null, "dify"],
    ]);
  });
  test("sai hình (bản cũ có version / bước dạng chuỗi / thiếu def_id) ⇒ null", () => {
    expect(toCurrentFlow({ version: 3, is_default: false, steps: [] })).toBeNull();
    expect(toCurrentFlow(raw(["Kinh doanh"]))).toBeNull();
    expect(toCurrentFlow({ ...raw([GD]), def_id: undefined })).toBeNull();
    expect(toCurrentFlow(null)).toBeNull();
  });
});

describe("current-flow · previewPath", () => {
  const flow = toCurrentFlow(
    raw([
      { name: "Soạn", department_name: "KD", kind: "review" },
      GD,
      {
        name: "Bán",
        department_name: "KD",
        kind: "review",
        when: { op: "or", conds: [{ field: "deal", in: ["sell"] }] },
      },
    ]),
  );
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
