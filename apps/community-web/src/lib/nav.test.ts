// CR-110 · COM-FR-28/29/31/43 · mô hình nav (nhóm Sổ Hợp Tác chỉ khi có quyền), route hash, trạng thái xổ/gập.
import { describe, expect, it } from "bun:test";
import {
  buildNav,
  contractsHref,
  hasContractsGroup,
  isActive,
  type NavInput,
  SHT_PATHS,
} from "./nav";
import { hashOf, isOwnProfile, parseHash, parseLocation } from "./route";
import { parseCollapsed, toggleCollapsed } from "./sidebar-state";

const base: NavInput = {
  ownOrgId: "niti",
  caps: { contracts: true },
  contractsUrl: "https://sht.example/",
};
const ids = (v: NavInput) => buildNav(v).map((g) => g.id);

describe("buildNav — nhóm Sổ Hợp Tác theo caps (I1/I3)", () => {
  it("chủ quản có quyền contracts: Community + Sổ Hợp Tác (4 mục, link ngoài)", () => {
    const groups = buildNav(base);
    expect(groups.map((g) => g.id)).toEqual(["community", "sht"]);
    const sht = groups[1];
    expect(sht?.items.map((i) => i.id)).toEqual(["overview", "contracts", "partners", "products"]);
    expect(sht?.items.map((i) => i.target)).toEqual(
      Object.values(SHT_PATHS).map((path) => ({ kind: "contracts", path })),
    );
  });

  it("caps.contracts=false (đối tác / chủ quản thiếu quyền): không có nhóm SHT, không mục contracts nào", () => {
    const v = { ...base, caps: { contracts: false }, contractsUrl: null };
    expect(ids(v)).toEqual(["community"]);
    expect(JSON.stringify(buildNav(v))).not.toContain("sht");
    expect(JSON.stringify(buildNav(v))).not.toContain('"contracts"');
  });

  it("thiếu contractsUrl ⇒ không nhóm SHT dù caps true; có url nhưng caps false ⇒ cũng không", () => {
    expect(hasContractsGroup({ caps: { contracts: true }, contractsUrl: null })).toBe(false);
    expect(hasContractsGroup({ caps: { contracts: false }, contractsUrl: "/" })).toBe(false);
    expect(ids({ ...base, caps: { contracts: false } })).toEqual(["community"]);
  });

  it("Community = Bảng tin + Bài đăng của tôi (hồ sơ của mình); không Cài đặt trong sidebar", () => {
    const c = buildNav(base)[0];
    expect(c?.items.map((i) => i.id)).toEqual(["feed", "myPosts"]);
    expect(c?.items[1]?.target).toEqual({
      kind: "route",
      route: { name: "profile", orgId: "niti" },
    });
  });
});

describe("contractsHref / isActive", () => {
  it("ghép gốc + đường dẫn, bỏ `/` thừa", () => {
    expect(contractsHref("https://sht.example/", "/overview")).toBe("https://sht.example/overview");
    expect(contractsHref("/", "/partners")).toBe("/partners");
  });
  it("Bảng tin sáng ở feed; Bài đăng của tôi sáng ở hồ sơ mình (không ở hồ sơ đối tác); link ngoài không bao giờ sáng", () => {
    const [feed, mine] = buildNav(base)[0]?.items ?? [];
    const sht = buildNav(base)[1]?.items[0];
    if (!feed || !mine || !sht) throw new Error("thiếu mục");
    expect(isActive(feed, { name: "feed" }, "niti")).toBe(true);
    expect(isActive(feed, { name: "profile" }, "niti")).toBe(false);
    expect(isActive(mine, { name: "profile" }, "niti")).toBe(true);
    expect(isActive(mine, { name: "profile", orgId: "niti" }, "niti")).toBe(true);
    expect(isActive(mine, { name: "profile", orgId: "abc" }, "niti")).toBe(false);
    expect(isActive(sht, { name: "feed" }, "niti")).toBe(false);
  });
});

describe("route hash", () => {
  it("#/settings = Bảng tin + hộp thoại (không còn route settings)", () => {
    expect(parseLocation("#/settings")).toEqual({ route: { name: "feed" }, settings: true });
    expect(parseLocation("#/feed").settings).toBe(false);
  });
  it("profile[/orgId][/section]; section chỉ đi kèm orgId; round-trip", () => {
    expect(parseHash("#/profile")).toEqual({ name: "profile" });
    expect(parseHash("#/profile/abc")).toEqual({ name: "profile", orgId: "abc" });
    expect(parseHash("#/profile/abc/files")).toEqual({
      name: "profile",
      orgId: "abc",
      section: "files",
    });
    expect(hashOf({ name: "profile", orgId: "abc", section: "files" })).toBe("#/profile/abc/files");
    expect(hashOf({ name: "profile" })).toBe("#/profile");
    expect(parseHash("")).toEqual({ name: "feed" });
    expect(parseHash("#/gì-đó-lạ")).toEqual({ name: "feed" });
  });
  it("isOwnProfile", () => {
    expect(isOwnProfile({ name: "profile" }, "x")).toBe(true);
    expect(isOwnProfile({ name: "profile", orgId: "x" }, "x")).toBe(true);
    expect(isOwnProfile({ name: "profile", orgId: "y" }, "x")).toBe(false);
    expect(isOwnProfile({ name: "feed" }, "x")).toBe(false);
  });
});

describe("trạng thái xổ/gập", () => {
  it("parse chịu lỗi (rỗng, JSON hỏng, sai kiểu) ⇒ không nhóm nào gập", () => {
    expect(parseCollapsed(null)).toEqual([]);
    expect(parseCollapsed("{")).toEqual([]);
    expect(parseCollapsed('{"a":1}')).toEqual([]);
    expect(parseCollapsed('["sht",3]')).toEqual(["sht"]);
  });
  it("toggle thêm/bớt id", () => {
    expect(toggleCollapsed([], "sht")).toEqual(["sht"]);
    expect(toggleCollapsed(["sht", "community"], "sht")).toEqual(["community"]);
  });
});
