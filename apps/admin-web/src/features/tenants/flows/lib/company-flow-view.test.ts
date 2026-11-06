import { describe, expect, test } from "bun:test";
import type { CompanyFlowRow } from "@ai/contracts/hub-admin";
import { actionsOf, errorKey, groupByApp, reorderIds, statusKey } from "./company-flow-view";

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
    expect(actionsOf(row("a", "x", 0, { kind: "assigned" })).clone).toBe(true);
    expect(actionsOf(row("a", "x", 0, { kind: "assigned" })).publish).toBe(false);
    const src = { flow_key: "k1", version: 1, name: "Gốc" };
    expect(actionsOf(row("a", "x", 0, { source: src })).revert).toBe(true);
    expect(actionsOf(row("a", "x", 0, { source: src, enabled: false })).revert).toBe(false);
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
    expect(errorKey("FLOW_PAIR_ACTIVE")).toBe("pairActive");
    expect(errorKey("FLOW_NOT_PUBLISHED")).toBe("notPublished");
    expect(errorKey("X")).toBe("generic");
  });
});
