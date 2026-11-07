import { describe, expect, test } from "bun:test";
import type { CompanyFlowRow } from "@ai/contracts/hub-admin";
import {
  actionsOf,
  errorKey,
  groupByApp,
  isReplacedOriginal,
  menuOf,
  reorderIds,
  splitRows,
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
    // CR-123 FR-10: bản công ty không có Xuất bản/Bật riêng — chỉ Tắt khi đang bật; chưa áp dụng ⇒ phải mở trình sửa
    const own = (o: object) => actionsOf(row("a", "x", 0, { kind: "company", ...o }));
    expect(own({}).toggle).toBe(true);
    expect(own({ enabled: false, off_reason: "not_published" }).toggle).toBe(false);
    expect("publish" in own({})).toBe(false);
    expect(actionsOf(row("a", "x", 0, { kind: "assigned", enabled: false })).toggle).toBe(true);
    expect(errorKey("FLOW_GROUP_MISSING")).toBe("groupMissing");
    const src = { flow_key: "k1", version: 1, name: "Gốc" };
    expect(actionsOf(row("a", "x", 0, { source: src })).revert).toBe(true);
    expect(actionsOf(row("a", "x", 0, { source: src, enabled: false })).revert).toBe(false);
  });
  test("CR-125 · x7 · một dòng cho mỗi quy trình đang dùng: bản gốc đã bị thay vào mục Mẫu thư viện", () => {
    const src = { flow_key: "k1", version: 1, name: "Gốc" };
    const orig = row("o", "x", 0, { kind: "assigned", enabled: false, off_reason: "replaced" });
    const copy = row("c", "x", 1, { kind: "company", source: src });
    const other = row("a", "y", 0, { kind: "assigned" });
    const { main, templates } = splitRows([orig, copy, other]);
    expect(main.map((r) => r.id)).toEqual(["c", "a"]);
    expect(templates.map((r) => r.id)).toEqual(["o"]);
    // bản gốc Tắt vì lý do khác (tắt tay / quay về) vẫn là dòng chính — còn việc để làm
    expect(
      isReplacedOriginal(
        row("t", "x", 0, { kind: "assigned", enabled: false, off_reason: "turned_off" }),
      ),
    ).toBe(false);
  });
  test("menu …: Quay về bản gốc + Tắt cho bản công ty đang dùng, Bật cho flow được gán đang tắt, bản công ty chưa áp dụng không có gì", () => {
    const src = { flow_key: "k1", version: 1, name: "Gốc" };
    expect(menuOf(row("c", "x", 0, { kind: "company", source: src }))).toEqual({
      revert: true,
      toggle: "off",
    });
    expect(
      menuOf(row("a", "x", 0, { kind: "assigned", enabled: false, off_reason: "turned_off" })),
    ).toEqual({
      revert: false,
      toggle: "on",
    });
    expect(
      menuOf(row("n", "x", 0, { kind: "company", enabled: false, off_reason: "not_published" })),
    ).toEqual({ revert: false, toggle: null });
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
