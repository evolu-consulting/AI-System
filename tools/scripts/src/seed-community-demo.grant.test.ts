// com-prod-seed · cờ --grant-owner/--grant-editor (thuần) + guard prod trong container tool (--i-know-prod).
import { describe, expect, it } from "bun:test";
import { grantArgs } from "./seed-community-demo";
import { checkGrantTargets, parseUserList } from "./seed-community-demo.grant";
import { seedGuard } from "./seed-community-demo.guard";

describe("seed-community-demo · grant flags", () => {
  it("parseUserList: cắt, bỏ rỗng/trùng; thiếu giá trị ⇒ lỗi", () => {
    expect(parseUserList("--grant-owner", " a, b,,a ")).toEqual(["a", "b"]);
    expect(() => parseUserList("--grant-owner", undefined)).toThrow();
    expect(() => parseUserList("--grant-owner", "--apply")).toThrow();
    expect(() => parseUserList("--grant-owner", " , ")).toThrow();
  });

  it("grantArgs: vắng cờ ⇒ {}; có cờ ⇒ danh sách", () => {
    expect(grantArgs(["--apply"])).toEqual({});
    expect(grantArgs(["--grant-owner", "a,b", "--grant-editor", "c"])).toEqual({
      grantOwner: ["a", "b"],
      grantEditor: ["c"],
    });
  });

  it("checkGrantTargets: từ chối user ngoài và user không có", () => {
    const f = [
      { username: "an", kind: "internal" },
      { username: "doitac", kind: "external" },
    ];
    expect(checkGrantTargets(f, ["an", "doitac"])).toMatch(/doitac/);
    expect(checkGrantTargets([f[0] as (typeof f)[0]], ["an", "ghost"])).toMatch(/ghost/);
    expect(checkGrantTargets([f[0] as (typeof f)[0]], ["an"])).toBeNull();
  });

  it("guard: DB prod (host pg) chỉ chạy với --i-know-prod, vẫn cần --out", () => {
    const urls = ["postgres://s2_owner:x@pg:5432/ai_system"];
    const g = (iKnowProd: boolean, out?: string) =>
      seedGuard({ appEnv: "production", urls, iKnowProd, out });
    expect(g(false, "/tmp/o.json")).toMatch(/production/);
    expect(g(true, "/tmp/o.json")).toBeNull();
    expect(g(true)).toMatch(/--out/);
  });
});
