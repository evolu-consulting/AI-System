// CR-120 · bộ lọc thư viện (thuần).
import { describe, expect, test } from "bun:test";
import {
  activeCount,
  applyLibFilter,
  appOptions,
  groupByApp,
  libFilterSearch,
  parseLibFilter,
  parseSearchQ,
  searchLibrary,
  slotOptions,
} from "./library-filter";

const T1 = "11111111-1111-4111-8111-111111111111";
const row = (id: string, slot: string, o: Record<string, unknown> = {}) => ({
  id,
  slot,
  slot_label: `Nhãn ${slot}`,
  published_version: 1 as number | null,
  tenant_count: 0,
  is_default: false,
  ...o,
});
const rows = [
  row("a", "contracts.approval", { is_default: true }),
  row("b", "contracts.approval", { published_version: null }),
  row("c", "community.review", { tenant_count: 1 }),
];

describe("library-filter", () => {
  test("parse bỏ giá trị lạ, round-trip qua URL", () => {
    expect(parseLibFilter({ app: "contracts", status: "x", usedBy: "zzz", slot: "A b" })).toEqual({
      app: "contracts",
    });
    const f = parseLibFilter({ app: "contracts", status: "draft", usedBy: T1 });
    expect(parseLibFilter(libFilterSearch(f))).toEqual(f);
    expect(activeCount(f)).toBe(3);
  });

  test("lọc app / trạng thái / mặc định / chưa gán / theo tenant đã gán", () => {
    const ids = (f: object, m?: Map<string, Set<string>>) =>
      applyLibFilter(rows, f, m).map((r) => r.id);
    expect(ids({})).toEqual(["a", "b", "c"]);
    expect(ids({ app: "contracts" })).toEqual(["a", "b"]);
    expect(ids({ status: "draft" })).toEqual(["b"]);
    expect(ids({ usedBy: "default" })).toEqual(["a"]);
    expect(ids({ usedBy: "none" })).toEqual(["b"]);
    expect(ids({ usedBy: T1 })).toEqual([]); // chưa tải gán ⇒ chưa khớp
    expect(ids({ usedBy: T1 }, new Map([["c", new Set([T1])]]))).toEqual(["c"]);
    expect(ids({ slot: "community.review", status: "published" })).toEqual(["c"]);
  });

  test("tuỳ chọn app/khe theo nhãn + gom nhóm theo app giữ thứ tự", () => {
    expect(appOptions(rows)).toEqual(["contracts", "community"]);
    expect(slotOptions(rows, "community")).toEqual([
      { slot: "community.review", label: "Nhãn community.review" },
    ]);
    const mixed = [rows[0], rows[2], rows[1]].filter((x) => x !== undefined);
    expect(groupByApp(mixed).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("CR-121 c15 · ?tenant= không còn là bộ lọc (đã đổi thành usedBy)", () => {
  test("parseLibFilter bỏ tenant, nhận usedBy", () => {
    const T = "11111111-1111-4111-8111-111111111111";
    expect(parseLibFilter({ tenant: T })).toEqual({});
    expect(parseLibFilter({ usedBy: T })).toEqual({ usedBy: T });
    expect(libFilterSearch({ usedBy: "none" })).toEqual({ usedBy: "none" });
  });
});

describe("CR-121 c15 · ô tìm", () => {
  const rows = [
    {
      name: "Duyệt 2 cấp: Kế toán → Giám đốc",
      slot_label: "Duyệt hợp đồng",
      steps: [{ name: "Kế toán" }, { name: "Giám đốc" }],
    },
    { name: "Nhận hợp đồng", slot_label: "Nhận hợp đồng", steps: [{ name: "Pháp chế" }] },
    { name: "Không bước", slot_label: null },
  ];
  const names = (q: string | undefined) => searchLibrary(rows, q).map((r) => r.name);
  test("rỗng/khoảng trắng ⇒ giữ nguyên", () => {
    expect(names(undefined)).toHaveLength(3);
    expect(names("   ")).toHaveLength(3);
  });
  test("khớp tên quy trình, tên bước, tên việc; bỏ dấu + không phân biệt hoa thường", () => {
    expect(names("nhan")).toEqual(["Nhận hợp đồng"]);
    expect(names("PHAP che")).toEqual(["Nhận hợp đồng"]); // tên bước
    expect(names("ke toan")).toEqual(["Duyệt 2 cấp: Kế toán → Giám đốc"]);
    expect(names("duyet hop")).toEqual(["Duyệt 2 cấp: Kế toán → Giám đốc"]); // tên việc
    expect(names("zzz")).toEqual([]);
  });
  test("parseSearchQ cắt khoảng trắng, 100 ký tự, rỗng ⇒ undefined", () => {
    expect(parseSearchQ("  a ")).toBe("a");
    expect(parseSearchQ("x".repeat(150))).toHaveLength(100);
    expect(parseSearchQ("  ")).toBeUndefined();
    expect(parseSearchQ(5)).toBeUndefined();
  });
});
