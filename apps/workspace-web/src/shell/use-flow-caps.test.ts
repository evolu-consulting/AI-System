// CR-120 · nav Community theo vai + khe: capsOf + buildShellNav lọc mục có `cap`.
import { describe, expect, it } from "bun:test";
import { communityManifest } from "~/modules/community/manifest";
import { contractsManifest } from "~/modules/contracts/manifest";
import { buildShellNav } from "./nav";
import { badgesOf, badgeText, capsOf } from "./use-flow-caps";

const off = {
  moderationQueue: false,
  moderationOn: false,
  joinSubmit: false,
  joinReview: false,
  reports: false,
  counts: { review: 0, join: 0, reports: 0 },
  contracts: { review: false, count: 0 },
};
const labels = (caps: ReadonlySet<string>) =>
  buildShellNav(
    [communityManifest],
    () => true,
    (c) => caps.has(c),
  )[0]?.items.map((i) => i.labelKey);

describe("capsOf + nav", () => {
  it("chưa tải / lỗi ⇒ không có mục luồng", () => {
    expect(labels(capsOf(null))).toEqual(["contracts.nav.feed", "contracts.nav.myPosts"]);
  });
  it("thành viên thường, khe tắt ⇒ chỉ Bảng tin + Bài của tôi", () => {
    expect(labels(capsOf(off))).toEqual(["contracts.nav.feed", "contracts.nav.myPosts"]);
  });
  it("người duyệt + khe bật ⇒ đủ 3 mục; khe tắt ⇒ mất hàng chờ duyệt nhưng còn yêu cầu + báo cáo", () => {
    const on = {
      ...off,
      moderationQueue: true,
      moderationOn: true,
      joinReview: true,
      reports: true,
    };
    expect(labels(capsOf(on))).toContain("contracts.nav.review");
    expect(labels(capsOf({ ...on, moderationQueue: false }))).not.toContain("contracts.nav.review");
    expect(labels(capsOf({ ...on, moderationQueue: false }))).toContain("contracts.nav.reports");
  });
  it("đối tác ⇒ chỉ thấy Yêu cầu tham gia", () => {
    const l = labels(capsOf({ ...off, joinSubmit: true }));
    expect(l).toContain("contracts.nav.join");
    expect(l).not.toContain("contracts.nav.reports");
  });
});

describe("C-7 · cap Sổ Hợp Tác + badge", () => {
  const sht = (caps: ReadonlySet<string>) =>
    buildShellNav(
      [contractsManifest],
      () => true,
      (c) => caps.has(c),
    )[0]?.items.map((i) => i.labelKey);
  it("không có vai duyệt ⇒ không có mục Chờ tôi duyệt; có ⇒ đứng sau Hợp đồng", () => {
    expect(sht(capsOf(off))).not.toContain("contracts.nav.approvals");
    const l = sht(capsOf({ ...off, contracts: { review: true, count: 0 } }));
    expect(l?.indexOf("contracts.nav.approvals")).toBe(2);
  });
  it("map cap → số: chỉ cap người xem thấy; cap ẩn không có số", () => {
    const n = {
      ...off,
      moderationQueue: true,
      joinReview: true,
      reports: true,
      counts: { review: 3, join: 120, reports: 0 },
      contracts: { review: true, count: 7 },
    };
    const b = badgesOf(n);
    expect(b.get("community.review")).toBe(3);
    expect(b.get("community.join")).toBe(120);
    expect(b.get("community.reports")).toBe(0);
    expect(b.get("contracts.review")).toBe(7);
    // số lớn nhưng cap ẩn (đối tác không duyệt bài) ⇒ không lộ số
    expect(
      badgesOf({ ...off, counts: { review: 9, join: 0, reports: 0 } }).has("community.review"),
    ).toBe(false);
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
