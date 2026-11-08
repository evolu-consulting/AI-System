import { describe, expect, it } from "bun:test";
import { ownerAlsoGroups, withOwnerOverride } from "./owner-override";

const OWN = "own";
const review = (after: Record<string, unknown>) => ({
  key: "s",
  after: { kind: "review", ...after },
});

describe("cr125-fix-owner-override · luật chung Toàn quyền duyệt thay", () => {
  it("ownerAlsoGroups: bỏ trùng, trừ Group gắn task; có người duyệt cụ thể ⇒ giữ", () => {
    expect(ownerAlsoGroups([OWN, OWN, "kt"], "kt")).toEqual([OWN]);
    expect(ownerAlsoGroups([OWN], OWN, true)).toEqual([OWN]);
  });
  it("withOwnerOverride chỉ gắn stage review, gộp also sẵn có, không owner thì giữ nguyên", () => {
    const st = [
      review({ group_id: "kt", also_group_ids: ["x"] }),
      { key: "a", after: { kind: "auto" } },
    ];
    const out = withOwnerOverride(st, [OWN]) as { after: { also_group_ids?: string[] } }[];
    expect(out[0]?.after.also_group_ids).toEqual(["x", OWN]);
    expect(out[1]?.after.also_group_ids).toBeUndefined();
    expect(withOwnerOverride(st, [])).toEqual(st);
    const own = withOwnerOverride([review({ group_id: OWN })], [OWN]) as { after: object }[];
    expect(own[0]?.after).not.toHaveProperty("also_group_ids");
  });
});
