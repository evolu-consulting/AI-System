// CR-120 · nav Community theo vai + khe: capsOf + buildShellNav lọc mục có `cap`.
import { describe, expect, it } from "bun:test";
import { communityManifest } from "~/modules/community/manifest";
import { buildShellNav } from "./nav";
import { capsOf } from "./use-flow-caps";

const off = {
  moderationQueue: false,
  moderationOn: false,
  joinSubmit: false,
  joinReview: false,
  reports: false,
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
