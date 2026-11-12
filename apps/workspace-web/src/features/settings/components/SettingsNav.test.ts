// CR-130 · nhóm menu Cài đặt chung: Sổ Hợp Tác (5 mục) + Bảng tin (1 mục), theo cờ gói; tắt cờ community ⇒ không có ngăn Bảng tin.
import { describe, expect, test } from "bun:test";
import { buildNavGroups } from "./SettingsNav";

const s = (k: string) => k;
const dot = () => null;
const ids = (c: boolean, f: boolean) =>
  buildNavGroups({ hasContracts: c, hasFeed: f, s, dot }).map((g) => [
    g.id,
    g.label,
    g.items.length,
  ]);

describe("buildNavGroups", () => {
  test("cả hai gói ⇒ hai nhóm có tiêu đề", () => {
    expect(ids(true, true)).toEqual([
      ["contracts", "group.contracts", 5],
      ["feed", "group.feed", 1],
    ]);
  });
  test("cờ community tắt ⇒ không có nhóm Bảng tin", () => {
    expect(ids(true, false)).toEqual([["contracts", undefined, 5]]);
  });
  test("CR-138 Q6 · không phải chủ sở hữu ⇒ nhóm Sổ Hợp Tác chỉ còn «Quy trình duyệt» (chỉ xem)", () => {
    const g = buildNavGroups({ hasContracts: true, hasFeed: true, owner: false, s, dot });
    expect(g.map((x) => [x.id, x.items.map((i) => i.id)])).toEqual([
      ["contracts", ["flow"]],
      ["feed", ["feed"]],
    ]);
  });
  test("chỉ Cộng đồng ⇒ một nhóm, không tiêu đề", () => {
    expect(ids(false, true)).toEqual([["feed", undefined, 1]]);
  });
});
