// CR-119 phần 2 · một bảng URL cũ → mới (SHT dưới `/contracts`) + chuẩn `basePath` của app.
import { describe, expect, test } from "bun:test";
import { appKeyOf, basePathOf, isUnderApp, pathOf } from "./app-path";
import { canonicalHref, LEGACY_EXACT, legacyTarget } from "./legacy-routes";

describe("cr120-handson-fixes · route gốc của app không bị coi là id HĐ cũ", () => {
  test.each(["login", "sso", "privacy", "terms"])("/contracts/%s giữ nguyên", (p) => {
    expect(legacyTarget(`/contracts/${p}?sso=none&next=%2Fcontracts`)).toBeNull();
  });
});

describe("legacyTarget · tuyến SHT cũ ở gốc → /contracts/…", () => {
  test.each([
    ["/overview", "/contracts"],
    ["/overview?period=month", "/contracts?period=month"],
    ["/contracts?status=active&q=abc#x", "/contracts/list?status=active&q=abc#x"],
    [
      "/contracts/0b7e4f1a-1111-4222-8333-444455556666",
      "/contracts/c/0b7e4f1a-1111-4222-8333-444455556666",
    ],
    ["/contracts/abc?tab=log", "/contracts/c/abc?tab=log"],
    ["/contracts/abc/approval#step", "/contracts/c/abc/approval#step"],
    ["/contracts/new?type=deal&frame=f1", "/contracts/c/new?type=deal&frame=f1"],
    ["/partners", "/contracts/partners"],
    ["/partners?party=mst%3A0101&tab=review", "/contracts/partners?party=mst%3A0101&tab=review"],
    ["/products?sp=p1&ht=users", "/contracts/products?sp=p1&ht=users"],
    ["/notifications#prefs", "/contracts/notifications#prefs"],
    ["/settings/members", "/contracts/settings/members"],
    ["/settings?sec=biz", "/contracts/settings?sec=biz"],
    ["/feedback", "/contracts/feedback"],
    ["/overview/", "/contracts"],
  ])("%s → %s", (from, to) => {
    expect(legacyTarget(from)).toBe(to);
  });

  test("tuyến đã gộp từ trước (chuyển hướng cũ) vào đúng chỗ, bỏ query như redirect cũ", () => {
    expect(legacyTarget("/my-work")).toBe("/contracts");
    for (const p of ["/prices", "/sourcing", "/cks", "/cks/123", "/cks/123?x=1"])
      expect(legacyTarget(p)).toBe("/contracts/products");
    expect(legacyTarget("/settings/scoring")).toBe("/contracts/partners");
    expect(legacyTarget("/transactions")).toBe("/contracts/list?type=deal");
    expect(legacyTarget("/transactions/new")).toBe("/contracts/c/new?type=deal");
    expect(legacyTarget("/transactions/abc")).toBe("/contracts/c/abc");
  });

  test("URL chuẩn mới / ngoài SHT ⇒ null (không dội vòng)", () => {
    for (const p of [
      "/contracts",
      "/contracts/",
      "/contracts/list?type=deal",
      "/contracts/c/abc",
      "/contracts/c/new?type=deal",
      "/contracts/partners?party=x",
      "/contracts/products",
      "/contracts/settings/members",
      "/contracts/notifications#prefs",
      "/contracts/approvals", // CR-121 C-7: trang "Chờ tôi duyệt", không phải id HĐ cũ
      "/contracts/partner-inbox", // CR-124: hộp «Hợp đồng đối tác gửi», không phải id HĐ cũ
      "/community",
      "/community/profile/o1/info",
      "/login?next=%2Foverview",
      "/sso",
      "/",
    ])
      expect(legacyTarget(p)).toBeNull();
  });

  test("áp hai lần không đổi thêm (idempotent) và canonicalHref giữ href mới", () => {
    for (const from of [
      ...Object.keys(LEGACY_EXACT),
      "/contracts?a=1",
      "/contracts/abc",
      "/cks/9",
    ]) {
      const once = canonicalHref(from);
      expect(canonicalHref(once)).toBe(once);
    }
    expect(canonicalHref("/contracts/c/abc")).toBe("/contracts/c/abc");
  });
});

describe("app-path · basePath = /<appKey>", () => {
  test("basePathOf, appKeyOf, isUnderApp", () => {
    expect(basePathOf("contracts")).toBe("/contracts");
    expect(appKeyOf("/contracts/c/1?x=1")).toBe("contracts");
    expect(appKeyOf("/community")).toBe("community");
    expect(appKeyOf("/future-app/x")).toBe("future-app");
    for (const p of ["/", "/login", "/sso?app=chat", "/privacy", "/terms"])
      expect(appKeyOf(p)).toBeNull();
    expect(isUnderApp("/contracts", "contracts")).toBe(true);
    expect(isUnderApp("/contracts/list", "contracts")).toBe(true);
    expect(isUnderApp("/contractsx", "contracts")).toBe(false);
    expect(pathOf("/a/b/?q=1#h")).toBe("/a/b");
  });
});
