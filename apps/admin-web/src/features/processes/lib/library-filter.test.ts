// CR-120 · bộ lọc thư viện (thuần).
import { describe, expect, test } from "bun:test";
import {
  activeCount,
  applyLibFilter,
  appOptions,
  groupByApp,
  libFilterSearch,
  parseLibFilter,
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
    expect(parseLibFilter({ app: "contracts", status: "x", tenant: "zzz", slot: "A b" })).toEqual({
      app: "contracts",
    });
    const f = parseLibFilter({ app: "contracts", status: "draft", tenant: T1 });
    expect(parseLibFilter(libFilterSearch(f))).toEqual(f);
    expect(activeCount(f)).toBe(3);
  });

  test("lọc app / trạng thái / mặc định / chưa gán / theo tenant đã gán", () => {
    const ids = (f: object, m?: Map<string, Set<string>>) =>
      applyLibFilter(rows, f, m).map((r) => r.id);
    expect(ids({})).toEqual(["a", "b", "c"]);
    expect(ids({ app: "contracts" })).toEqual(["a", "b"]);
    expect(ids({ status: "draft" })).toEqual(["b"]);
    expect(ids({ tenant: "default" })).toEqual(["a"]);
    expect(ids({ tenant: "none" })).toEqual(["b"]);
    expect(ids({ tenant: T1 })).toEqual([]); // chưa tải gán ⇒ chưa khớp
    expect(ids({ tenant: T1 }, new Map([["c", new Set([T1])]]))).toEqual(["c"]);
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
