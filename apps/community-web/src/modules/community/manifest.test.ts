// CR-118 · COM-FR-31 (MODIFIED) · manifest Community: route dưới /community/*, nhà máy cây route không khởi tạo router.
import { describe, expect, it } from "bun:test";
import { mapLegacyHash } from "./domain/legacy-hash";
import { COMMUNITY_BASE, parsePath, routeToPath } from "./domain/route";
import {
  communityManifest,
  communityRoutes,
  createCommunityRoutes,
  type PageLoader,
  validateCommunitySearch,
} from "./manifest";

describe("communityRoutes", () => {
  it("id/đường dẫn duy nhất, đều nằm dưới /community", () => {
    expect(new Set(communityRoutes.map((r) => r.id)).size).toBe(communityRoutes.length);
    expect(new Set(communityRoutes.map((r) => r.path)).size).toBe(communityRoutes.length);
    for (const r of communityRoutes)
      expect(r.path === COMMUNITY_BASE || r.path.startsWith(`${COMMUNITY_BASE}/`)).toBe(true);
  });
  it("khớp routeToPath: mỗi dạng Route có đúng một mẫu route (tham số $orgId/$section)", () => {
    const paths = new Set(communityRoutes.map((r) => r.path));
    const samples = [
      { name: "feed" as const },
      { name: "profile" as const },
      { name: "profile" as const, orgId: "o" },
      { name: "profile" as const, orgId: "o", section: "s" },
    ];
    for (const s of samples) {
      const concrete = routeToPath(s)
        .replace("/o/s", "/$orgId/$section")
        .replace(/\/o$/, "/$orgId");
      expect(paths.has(concrete)).toBe(true);
    }
  });
  it("đích mapLegacyHash parse về Bảng tin; manifest khai báo gốc /community", () => {
    expect(parsePath(mapLegacyHash("#/feed") ?? "").route.name).toBe("feed");
    expect(communityManifest.base).toBe("/community");
    expect(communityManifest.key).toBe("community");
  });
});

describe("validateCommunitySearch", () => {
  it("chỉ nhận settings=1", () => {
    expect(validateCommunitySearch({ settings: "1" })).toEqual({ settings: "1" });
    expect(validateCommunitySearch({ settings: "0", x: 1 })).toEqual({});
    expect(validateCommunitySearch({})).toEqual({});
  });
});

describe("createCommunityRoutes", () => {
  it("gọi createRoute một lần mỗi route với route cha của host, một component lười dùng chung", () => {
    const parent = { id: "root" };
    const calls: { path: string; parent: unknown }[] = [];
    let lazyCalls = 0;
    const loaders: PageLoader[] = [];
    const out = createCommunityRoutes({
      parent,
      lazy: (load) => {
        lazyCalls++;
        loaders.push(load);
        return "LAZY";
      },
      createRoute: (o) => {
        calls.push({ path: o.path, parent: o.getParentRoute() });
        expect(o.component).toBe("LAZY");
        return o.path;
      },
    });
    expect(out).toEqual(communityRoutes.map((r) => r.path));
    expect(calls.every((c) => c.parent === parent)).toBe(true);
    expect(lazyCalls).toBe(1);
    expect(typeof loaders[0]).toBe("function"); // không gọi ⇒ không nạp chunk khi module tắt
  });
});
