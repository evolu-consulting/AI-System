// CR-129 L5 · hồ sơ cá nhân: tab, bộ lọc feed, vai.
import { describe, expect, test } from "bun:test";
import { meFeedFixed, meRoleKey, meShowsComposer, resolveMeSection } from "./me-profile";
import { parsePath, routeToPath } from "./route";

describe("me-profile", () => {
  test("section lạ/thiếu ⇒ mine; org giữ nguyên", () => {
    expect(resolveMeSection(undefined)).toBe("mine");
    expect(resolveMeSection("zzz")).toBe("mine");
    expect(resolveMeSection("org")).toBe("org");
  });
  test("bộ lọc feed: tab cá nhân theo userId, tab tổ chức theo công ty", () => {
    expect(meFeedFixed("mine", "u1")).toEqual({ authorUserId: "u1" });
    expect(meFeedFixed("org", "u1")).toEqual({ mine: true });
  });
  test("vai + composer", () => {
    expect(meRoleKey("partner")).toBe("community.me.role.partner");
    expect(meShowsComposer("mine")).toBe(true);
    expect(meShowsComposer("org")).toBe(false);
  });
  test("route /community/me[/section] round-trip", () => {
    expect(routeToPath({ name: "me" })).toBe("/community/me");
    expect(routeToPath({ name: "me", section: "org" })).toBe("/community/me/org");
    expect(parsePath("/community/me/org").route).toEqual({ name: "me", section: "org" });
    expect(parsePath("/community/me").route).toEqual({ name: "me" });
  });
});
