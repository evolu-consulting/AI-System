import { describe, expect, test } from "bun:test";
import type { CompanyFlowRow } from "@ai/contracts/hub-admin";
import {
  actionsOf,
  errorKey,
  groupByApp,
  menuOf,
  reorderIds,
  statusKey,
} from "./company-flow-view";

const row = (id: string, app: string, position: number, o: Partial<CompanyFlowRow> = {}) =>
  ({
    id,
    flow_id: id,
    flow_key: `k-${id}`,
    name: id,
    app,
    kind: "company",
    trigger_event: "contract.submitted",
    has_condition: false,
    enabled: true,
    position,
    replaced_by: null,
    off_reason: null,
    source: null,
    rel_version: 1,
    library_newer: null,
    warnings: [],
    def_version: 1,
    deletable: false,
    ...o,
  }) as CompanyFlowRow;

describe("company-flow-view", () => {
  test("nhóm theo app, sắp theo position", () => {
    const g = groupByApp([
      row("a", "contracts", 2),
      row("b", "community", 0),
      row("c", "contracts", 1),
    ]);
    expect(g.map((x) => x.app)).toEqual(["contracts", "community"]);
    expect(g[0]?.items.map((i) => i.id)).toEqual(["c", "a"]);
  });
  test("trạng thái luôn kèm lý do khi tắt", () => {
    expect(statusKey(row("a", "x", 0))).toBe("on");
    expect(statusKey(row("a", "x", 0, { enabled: false, off_reason: "replaced" }))).toBe(
      "off.replaced",
    );
  });
  test("hành động theo loại dòng", () => {
    // CR-123 FR-10: bản công ty không có Xuất bản/Bật riêng — chỉ Tắt khi đang bật; chưa áp dụng ⇒ phải mở trình sửa
    const own = (o: object) => actionsOf(row("a", "x", 0, o));
    expect(own({}).toggle).toBe(true);
    expect(own({ enabled: false, off_reason: "not_published" }).toggle).toBe(false);
    expect("publish" in own({})).toBe(false);
    expect(errorKey("FLOW_GROUP_MISSING")).toBe("groupMissing");
  });
});

describe("company-flow-view", () => {
  test("menu …: Tắt cho quy trình đang dùng, quy trình chưa áp dụng không có gì", () => {
    expect(menuOf(row("c", "x", 0))).toEqual({ toggle: "off" });
    expect(menuOf(row("n", "x", 0, { enabled: false, off_reason: "not_published" }))).toEqual({
      toggle: null,
    });
  });
  test("kéo đổi thứ tự chỉ trong cùng app, giữ nguyên app khác", () => {
    const rows = [row("a", "x", 0), row("b", "x", 1), row("c", "x", 2), row("d", "y", 0)];
    expect(reorderIds(rows, "c", "a")).toEqual(["c", "a", "b", "d"]);
    expect(reorderIds(rows, "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(reorderIds(rows, "a", "d")).toBeNull();
    expect(reorderIds(rows, "a", "a")).toBeNull();
  });
  test("lỗi 409 ra câu nghiệp vụ", () => {
    expect(errorKey("FLOW_REQUIRED_LAST")).toBe("requiredLast");
    expect(errorKey("FLOW_NOT_PUBLISHED")).toBe("notPublished");
    expect(errorKey("X")).toBe("generic");
  });
});
