import { describe, expect, test } from "bun:test";
import {
  checkGrantFeatures,
  comparePairs,
  matrixRowState,
  pairId,
  planBatch,
} from "./grants.rules";

const p = (featureId: string, groupId: string) => ({ featureId, groupId });

describe("ADM-FR-35 · grants.rules", () => {
  test("comparePairs: feature rồi group; pairId", () => {
    expect([p("b", "a"), p("a", "z"), p("a", "b")].sort(comparePairs)).toEqual([
      p("a", "b"),
      p("a", "z"),
      p("b", "a"),
    ]);
    expect(pairId(p("f", "g"))).toBe("f:g");
  });

  test("checkGrantFeatures: core trước, NOT_ENTITLED chỉ cho add, sắp + bỏ trùng", () => {
    const core = { id: "c", key: "core", entitled: false };
    const a = { id: "b-2", key: "a", entitled: false };
    const b = { id: "a-1", key: "b", entitled: false };
    expect(checkGrantFeatures([a, core], new Set())).toEqual({ code: "CORE_FEATURE_PROTECTED" });
    expect(checkGrantFeatures([a, b, a], new Set(["a-1", "b-2"]))).toEqual({
      code: "NOT_ENTITLED",
      details: { feature_ids: ["a-1", "b-2"] },
    });
    expect(checkGrantFeatures([a], new Set())).toBeNull();
  });

  test("planBatch sắp + đếm; matrixRowState", () => {
    const r = planBatch(
      new Set(["f2:g1"]),
      [p("f9", "g"), p("f1", "g"), p("f2", "g1")],
      [p("f2", "g1")],
    );
    expect(r).toEqual({
      insert: [p("f1", "g"), p("f9", "g")],
      delete: [p("f2", "g1")],
      unchanged: 1,
    });
    expect(matrixRowState({ key: "x", entitled: false, revoked: true, grantCount: 1 })).toBe(
      "revoked",
    );
    expect(matrixRowState({ key: "x", entitled: false, revoked: true, grantCount: 0 })).toBe(
      "none",
    );
  });
});
