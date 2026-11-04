// CR-118 · COM-FR-31 · route Community dưới /community/*: routeToPath/parsePath round-trip, settings qua query.
import { describe, expect, it } from "bun:test";
import { parsePath, routeToHref, routeToPath } from "./route";

describe("routeToPath", () => {
  it("feed = gốc module; hồ sơ [/orgId[/section]] (section chỉ đi kèm orgId)", () => {
    expect(routeToPath({ name: "feed" })).toBe("/community");
    expect(routeToPath({ name: "profile" })).toBe("/community/profile");
    expect(routeToPath({ name: "profile", orgId: "abc" })).toBe("/community/profile/abc");
    expect(routeToPath({ name: "profile", orgId: "abc", section: "files" })).toBe(
      "/community/profile/abc/files",
    );
    expect(routeToPath({ name: "profile", section: "files" })).toBe("/community/profile");
  });
  it("mã hoá ký tự đặc biệt; routeToHref thêm ?settings=1", () => {
    expect(routeToPath({ name: "profile", orgId: "a b" })).toBe("/community/profile/a%20b");
    expect(routeToHref({ name: "feed" }, true)).toBe("/community?settings=1");
    expect(routeToHref({ name: "feed" })).toBe("/community");
  });
});

describe("parsePath", () => {
  it("round-trip với routeToPath", () => {
    for (const r of [
      { name: "feed" as const },
      { name: "profile" as const },
      { name: "profile" as const, orgId: "a b" },
      { name: "profile" as const, orgId: "abc", section: "files" },
    ]) {
      expect(parsePath(routeToPath(r)).route).toEqual(r);
    }
  });
  it("?settings=1 ⇒ settings; thiếu ⇒ false; `/` cuối và đường lạ về Bảng tin", () => {
    expect(parsePath("/community", "?settings=1")).toEqual({
      route: { name: "feed" },
      settings: true,
    });
    expect(parsePath("/community/", "").settings).toBe(false);
    expect(parsePath("/community/feed").route).toEqual({ name: "feed" });
    expect(parsePath("/community/zzz/1").route).toEqual({ name: "feed" });
  });
  it("section lạ giữ nguyên (lát hồ sơ diễn giải)", () => {
    expect(parsePath("/community/profile/host/zzz").route).toEqual({
      name: "profile",
      orgId: "host",
      section: "zzz",
    });
  });
});
