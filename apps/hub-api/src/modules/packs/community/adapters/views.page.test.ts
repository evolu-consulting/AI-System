import { describe, expect, it } from "bun:test";
import type { Access } from "./community-access";
import { pageOrgIds } from "./views";

const orgs = ["Alpha", "Beta", "Alps", "Gamma"].map((name, i) => ({
  id: `o${i}`,
  name,
  active: true,
}));
const host = { org: null, dir: { orgs } } as unknown as Access;
const partner = { org: "o1", dir: { orgs } } as unknown as Access;

describe("pageOrgIds (#269)", () => {
  it("không limit ⇒ undefined (danh sách cũ)", () => {
    expect(pageOrgIds(host, { offset: 0 })).toBeUndefined();
  });
  it("trang 2 + q không phân biệt hoa thường", () => {
    expect(pageOrgIds(host, { limit: 2, offset: 2 })).toEqual(["o2", "o3"]);
    expect(pageOrgIds(host, { limit: 5, offset: 0, q: "AL" })).toEqual(["o0", "o2"]);
  });
  it("đối tác chỉ thấy công ty mình", () => {
    expect(pageOrgIds(partner, { limit: 5, offset: 0 })).toEqual(["o1"]);
    expect(pageOrgIds(partner, { limit: 5, offset: 0, q: "alpha" })).toEqual([]);
  });
});
