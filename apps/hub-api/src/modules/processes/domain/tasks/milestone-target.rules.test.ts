// CR-127 · E10a · luật thuần đích giao việc «Xác nhận mốc» theo cấu hình node.
import { describe, expect, it } from "bun:test";
import { milestoneTarget, wantsHead } from "./milestone-target.rules";

const base = {
  owner: "o",
  approver: null,
  cfgGroup: null,
  ownerGroup: "go",
  head: null,
  wantsHead: false,
};

describe("CR-127 E10a · milestoneTarget", () => {
  it("mặc định ⇒ phòng của người phụ trách; không phòng ⇒ đích danh người phụ trách", () => {
    expect(milestoneTarget(base)).toEqual({ groupId: "go", userIds: [] });
    expect(milestoneTarget({ ...base, ownerGroup: null })).toEqual({
      groupId: null,
      userIds: ["o"],
    });
  });
  it("phòng cấu hình thắng phòng người phụ trách", () => {
    expect(milestoneTarget({ ...base, cfgGroup: "gc" })).toEqual({ groupId: "gc", userIds: [] });
  });
  it("người cụ thể thắng mọi phòng", () => {
    expect(
      milestoneTarget({ ...base, cfgGroup: "gc", approver: "x", wantsHead: true, head: "h" }),
    ).toEqual({ groupId: null, userIds: ["x"] });
  });
  it("Cần trưởng phòng ⇒ trưởng phòng; phòng không có trưởng ⇒ cả phòng", () => {
    expect(milestoneTarget({ ...base, wantsHead: true, head: "h" })).toEqual({
      groupId: null,
      userIds: ["h"],
    });
    expect(milestoneTarget({ ...base, wantsHead: true })).toEqual({ groupId: "go", userIds: [] });
  });
  it("wantsHead đọc need='head' hoặc head_only của khối review", () => {
    expect(wantsHead({ kind: "review", need: "head" })).toBe(true);
    expect(wantsHead({ kind: "review", head_only: true })).toBe(true);
    expect(wantsHead({ kind: "review", need: "one" })).toBe(false);
    expect(wantsHead({ kind: "auto", need: "head" })).toBe(false);
    expect(wantsHead(null)).toBe(false);
  });
});
