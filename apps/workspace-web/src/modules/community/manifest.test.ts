// CR-118 · COM-FR-31 (MODIFIED) · manifest Community: route dưới /community/*, nhà máy cây route không khởi tạo router.
import { describe, expect, it } from "bun:test";
import { mapLegacyHash } from "./domain/legacy-hash";
import { COMMUNITY_BASE, parsePath, routeToPath } from "./domain/route";
import {
  communityManifest,
  communityRoutes,
  createCommunityRoutes,
  isLegacySettingsLink,
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
    expect(communityManifest.basePath).toBe(`/${communityManifest.key}`); // CR-119 p2: basePath = /${key}
  });
});

describe("createCommunityRoutes", () => {
  it("một route khung /community (component lười) + route con tương đối, gắn vào route cha của host", () => {
    const parent = { id: "root" };
    const made: { path: string; parent: unknown; comp: unknown }[] = [];
    let lazyCalls = 0;
    const attached: { parent: string; kids: string[] }[] = [];
    const out = createCommunityRoutes<{ id: string }, string, string>({
      parent,
      lazy: () => {
        lazyCalls++;
        return "LAZY";
      },
      createRoute: (o) => {
        made.push({ path: o.path, parent: o.getParentRoute(), comp: o.component });
        return o.path;
      },
      addChildren: (p, kids) => {
        attached.push({ parent: p, kids });
        return p;
      },
    });
    expect(out).toBe("/community");
    expect(made[0]).toEqual({ path: "/community", parent, comp: "LAZY" });
    expect(made.slice(1).map((m) => m.path)).toEqual([
      "/",
      "/profile",
      "/profile/$orgId",
      "/profile/$orgId/$section",
      "/me",
      "/me/$section",
      "/review",
      "/join",
      "/reports",
    ]);
    expect(made.slice(1).every((m) => m.parent === "/community" && m.comp === undefined)).toBe(
      true,
    );
    expect(attached).toEqual([
      {
        parent: "/community",
        kids: [
          "/",
          "/profile",
          "/profile/$orgId",
          "/profile/$orgId/$section",
          "/me",
          "/me/$section",
          "/review",
          "/join",
          "/reports",
        ],
      },
    ]);
    expect(lazyCalls).toBe(1); // bộ tải chỉ được gọi khi vào route ⇒ module tắt không nạp chunk
  });
});

describe("CR-130 · link cũ ?settings=1", () => {
  it("nhận ?settings=1 (số hoặc chuỗi); còn lại không", () => {
    expect(isLegacySettingsLink({ settings: 1 })).toBe(true);
    expect(isLegacySettingsLink({ settings: "1" })).toBe(true);
    expect(isLegacySettingsLink({ settings: 0 })).toBe(false);
    expect(isLegacySettingsLink({})).toBe(false);
    expect(isLegacySettingsLink(undefined)).toBe(false);
  });
});
