import { describe, expect, test } from "bun:test";
import {
  canDeleteLibrary,
  cloneSuggestion,
  describeWhen,
  type ListRow,
  moneyWords,
  slugKey,
  sortLibraryRows,
  statusOf,
  tenantsSummary,
} from "./library-list";

const row = (o: Partial<ListRow> = {}): ListRow =>
  ({
    id: "i",
    key: "k",
    name: "A",
    enabled: true,
    is_template: true,
    stage_count: 2,
    version: 1,
    updated_at: "2026-10-31T00:00:00Z",
    active_runs: 0,
    slot: "contracts.approval",
    ...o,
  }) as ListRow;

describe("statusOf", () => {
  test("Nháp / Đã xuất bản vN / Có thay đổi chưa xuất bản", () => {
    expect(statusOf(row())).toEqual({ kind: "draft" });
    expect(statusOf(row({ published_version: 4 }))).toEqual({ kind: "published", version: 4 });
    expect(statusOf(row({ published_version: 4, has_unpublished_changes: true }))).toEqual({
      kind: "changed",
      version: 4,
    });
  });
});

describe("tenantsSummary", () => {
  test("mặc định / đã gán (tên rút gọn, phần còn lại) / chưa gán", () => {
    expect(tenantsSummary(row({ is_default: true }))).toEqual({
      kind: "default",
      names: [],
      extra: 0,
    });
    expect(tenantsSummary(row({ tenant_count: 5 }), ["A", "B", "C", "D", "E"])).toEqual({
      kind: "assigned",
      names: ["A", "B", "C"],
      extra: 2,
    });
    expect(tenantsSummary(row({ tenant_count: 2 }), ["A", "B"])).toEqual({
      kind: "assigned",
      names: ["A", "B"],
      extra: 0,
    });
    expect(tenantsSummary(row({ tenant_count: 0 }))).toEqual({ kind: "none" });
  });
});

describe("sortLibraryRows / canDeleteLibrary", () => {
  test("mặc định ghim đầu, còn lại mới cập nhật trước", () => {
    const rows = [
      row({ id: "old", updated_at: "2026-10-01T00:00:00Z" }),
      row({ id: "def", is_default: true, updated_at: "2026-09-01T00:00:00Z" }),
      row({ id: "new", updated_at: "2026-10-30T00:00:00Z" }),
    ];
    expect(sortLibraryRows(rows).map((r) => r.id)).toEqual(["def", "new", "old"]);
  });
  test("xoá được khi không mặc định và không gán (kể cả đã xuất bản)", () => {
    expect(canDeleteLibrary(row())).toBe(true);
    expect(canDeleteLibrary(row({ published_version: 1 }))).toBe(true);
    expect(canDeleteLibrary(row({ is_default: true }))).toBe(false);
    expect(canDeleteLibrary(row({ tenant_count: 1 }))).toBe(false);
  });
});

describe("slugKey / cloneSuggestion", () => {
  test("bỏ dấu, ≤ 32, hậu tố khi trùng, rỗng ⇒ quy-trinh", () => {
    expect(slugKey("HĐ Công ty X")).toBe("hd-cong-ty-x");
    expect(slugKey("Quy trình HĐ mặc định – bản mới")).toBe("quy-trinh-hd-mac-dinh-ban-moi");
    expect(slugKey("HĐ Công ty X", 3)).toBe("hd-cong-ty-x-3");
    expect(slugKey("x".repeat(60)).length).toBe(32);
    expect(slugKey("y".repeat(60), 12).length).toBeLessThanOrEqual(32);
    expect(slugKey("???")).toBe("quy-trinh");
    expect(/^[a-z0-9-]{2,32}$/.test(slugKey("Đặng Thị Bé – 2026!!"))).toBe(true);
  });
  test("tên gợi ý không chồng hậu tố", () => {
    expect(cloneSuggestion("Quy trình A")).toBe("Quy trình A – bản mới");
    expect(cloneSuggestion("Quy trình A – bản mới")).toBe("Quy trình A – bản mới");
    expect(cloneSuggestion("Quy trình A (bản sao)")).toBe("Quy trình A – bản mới");
  });
});

describe("describeWhen", () => {
  test("điều kiện bằng lời", () => {
    expect(moneyWords(500_000_000)).toBe("500 tr");
    expect(moneyWords(2_500_000_000)).toBe("2,5 tỷ");
    expect(describeWhen(null)).toBeNull();
    expect(
      describeWhen({ op: "and", conds: [{ field: "total_value", op: "gt", value: 500_000_000 }] }),
    ).toBe("Chỉ khi giá trị > 500 tr");
    expect(
      describeWhen({
        op: "and",
        conds: [
          { field: "deal", in: ["buy", "sell"] },
          { field: "total_value", op: "ge", value: 50_000_000 },
        ],
      }),
    ).toBe("Chỉ khi loại Mua hoặc Bán và giá trị ≥ 50 tr");
  });
});
