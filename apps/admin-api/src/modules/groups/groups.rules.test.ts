import { describe, expect, test } from "bun:test";
import { changedGroupFields, checkGroupDelete, isBetaGroup, planMemberAdd } from "./groups.rules";

describe("ADM-FR-62 · groups.rules", () => {
  test("beta-testers: nhận diện đúng key, xoá → BETA_GROUP_PROTECTED", () => {
    expect(isBetaGroup({ key: "beta-testers" })).toBe(true);
    expect(checkGroupDelete({ key: "beta-testers" })).toEqual({ code: "BETA_GROUP_PROTECTED" });
    expect(checkGroupDelete({ key: "ke-toan" })).toBeNull();
  });

  test("changedGroupFields so theo giá trị", () => {
    const a = { name: { vi: "A", en: "B" }, description: null };
    expect(changedGroupFields(a, { name: { en: "B", vi: "A" }, description: null })).toEqual([]);
    expect(changedGroupFields(a, { name: { vi: "A" }, description: "x" })).toEqual([
      "name",
      "description",
    ]);
  });

  test("planMemberAdd: phân loại theo thứ tự input, toInsert sắp tăng, sai định dạng → not_found", () => {
    const found = [
      { username: "b", id: "id-2" },
      { username: "cc", id: "id-1" },
      { username: "dd", id: "id-3" },
    ];
    const r = planMemberAdd(["dd", "x y", "cc", "zz"], found, new Set(["id-3"]));
    expect(r).toEqual({
      toInsert: ["id-1"],
      added: ["cc"],
      not_found: ["x y", "zz"],
      already: ["dd"],
    });
    expect(planMemberAdd(["b"], found, new Set()).not_found).toEqual(["b"]);
  });
});
