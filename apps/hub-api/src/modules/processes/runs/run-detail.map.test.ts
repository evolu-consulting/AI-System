// CR-121 · R-4 · unit: nguồn gắn lượt (`pack_key`/`pack_record_id` → `source`).
import { describe, expect, it } from "bun:test";
import { sourceOf } from "./run-detail.map";

const ID = "0f1e2d3c-4b5a-4968-8777-665544332211";

describe("sourceOf", () => {
  it("gói hợp đồng ⇒ kind contract + nhãn HĐ + app_key", () => {
    expect(sourceOf("contracts", ID)).toEqual({
      kind: "contract",
      id: ID,
      label: "HĐ 0f1e2d3c",
      app_key: "contracts",
    });
  });
  it("có nhãn thật từ gói ⇒ dùng nhãn đó", () => {
    expect(sourceOf("contracts", ID, "HĐ 01/2026 · Thuê kho")?.label).toBe("HĐ 01/2026 · Thuê kho");
  });
  it("gói khác ⇒ kind = khoá gói", () => {
    expect(sourceOf("pkdemo", ID)?.kind).toBe("pkdemo");
  });
  it("không gắn gói ⇒ null", () => {
    expect(sourceOf(null, null)).toBeNull();
    expect(sourceOf("contracts", null)).toBeNull();
  });
});
