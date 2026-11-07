// CR-125 · audit "Lưu và áp dụng" quy trình: before/after phải cho thấy ĐỔI GÌ (danh sách bước), không chỉ số bước.
import { describe, expect, it } from "bun:test";
import { auditSnapshot } from "./defs.map";

const row = (stages: unknown[]) =>
  ({
    key: "k",
    name: "Duyệt HĐ",
    enabled: true,
    version: 3,
    stages,
    source_template_id: null,
    trigger: { event: "contract.submitted" },
  }) as never;

describe("CR-125 · auditSnapshot(def) liệt kê bước", () => {
  it("thêm một bước ⇒ steps before/after khác nhau", () => {
    const a = auditSnapshot(row([{ key: "s0", name: "Duyệt", node: { kind: "approve" } }]));
    const b = auditSnapshot(
      row([
        { key: "s0", name: "Duyệt", node: { kind: "approve" } },
        { key: "s1", name: "Ký số", node: { kind: "esign" } },
      ]),
    );
    expect(a.steps).toEqual([{ key: "s0", name: "Duyệt", node: "approve" }]);
    expect((b.steps as unknown[]).length).toBe(2);
    expect(b.stage_count).toBe(2);
    expect(a.steps).not.toEqual(b.steps);
  });
});
