// CR-120/121 C-7 · nav theo vai + khe + số đếm: `GET /pack/nav` → capsOf/badgesOf + buildShellNav lọc mục có `cap`.
import { describe, expect, it } from "bun:test";
import type { PackNavResponse } from "@ai/contracts/packs";
import { communityManifest } from "~/modules/community/manifest";
import { contractsManifest } from "~/modules/contracts/manifest";
import { buildShellNav } from "./nav";
import { badgesOf, badgeText, capsOf } from "./use-flow-caps";

const nav = (...items: [string, number][]): PackNavResponse => ({
  items: items.map(([cap, count]) => ({ cap, count })),
});
const labelsOf = (
  m: typeof communityManifest | typeof contractsManifest,
  caps: ReadonlySet<string>,
) =>
  buildShellNav(
    [m],
    () => true,
    (c) => caps.has(c),
  )[0]?.items.map((i) => i.labelKey);

describe("capsOf + nav Community", () => {
  const labels = (n: PackNavResponse | null) => labelsOf(communityManifest, capsOf(n));
  it("chưa tải / lỗi / thành viên thường ⇒ chỉ Bảng tin + Bài của tôi", () => {
    expect(labels(null)).toEqual(["contracts.nav.feed", "contracts.nav.myPosts"]);
    expect(labels(nav())).toEqual(["contracts.nav.feed", "contracts.nav.myPosts"]);
  });
  it("người duyệt ⇒ đủ 3 mục; khe duyệt bài tắt ⇒ mất hàng chờ nhưng còn yêu cầu + báo cáo", () => {
    const all = nav(["community.review", 1], ["community.join", 0], ["community.reports", 0]);
    expect(labels(all)).toContain("contracts.nav.review");
    const off = nav(["community.join", 0], ["community.reports", 0]);
    expect(labels(off)).not.toContain("contracts.nav.review");
    expect(labels(off)).toContain("contracts.nav.reports");
  });
  it("đối tác ⇒ chỉ thấy Yêu cầu tham gia", () => {
    const l = labels(nav(["community.join", 0]));
    expect(l).toContain("contracts.nav.join");
    expect(l).not.toContain("contracts.nav.reports");
  });
});

describe("C-7 · cap Sổ Hợp Tác + badge", () => {
  const sht = (n: PackNavResponse | null) => labelsOf(contractsManifest, capsOf(n));
  it("không có vai duyệt ⇒ không có mục Chờ tôi duyệt; có ⇒ đứng sau Hợp đồng (không cần Community)", () => {
    expect(sht(nav())).not.toContain("contracts.nav.approvals");
    expect(sht(nav(["contracts.review", 0]))?.indexOf("contracts.nav.approvals")).toBe(2);
  });
  it("map cap → số: đúng số từng cap; cap vắng không có số", () => {
    const b = badgesOf(
      nav(
        ["community.review", 3],
        ["community.join", 120],
        ["community.reports", 0],
        ["contracts.review", 7],
      ),
    );
    expect(b.get("community.review")).toBe(3);
    expect(b.get("community.join")).toBe(120);
    expect(b.get("community.reports")).toBe(0);
    expect(b.get("contracts.review")).toBe(7);
    expect(badgesOf(nav(["community.join", 2])).has("community.review")).toBe(false);
    expect(badgesOf(null).size).toBe(0);
  });
  it("chữ badge: 0 ⇒ ẩn, 1..99 ⇒ số, trên 99 ⇒ 99+", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(-2)).toBeNull();
    expect(badgeText(1)).toBe("1");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
    expect(badgeText(Number.NaN)).toBeNull();
  });
});
