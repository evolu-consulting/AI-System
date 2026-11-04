// CR-118 · ngân sách riêng của chunk Community (lazy): JS ≤ 60 KB gz, CSS ≤ 15 KB gz; chunk khác giữ 50 KB.
import { describe, expect, it } from "bun:test";
import { CHUNK_BUDGET_BYTES, COMMUNITY_CHUNK_BUDGET_BYTES, chunkBudget } from "./check-bundle";

describe("chunkBudget community", () => {
  it("community.* = 60 KB; chunk thường = 50 KB", () => {
    expect(chunkBudget("cm.b956431293.js")).toBe(COMMUNITY_CHUNK_BUDGET_BYTES);
    expect(COMMUNITY_CHUNK_BUDGET_BYTES).toBe(60 * 1024);
    expect(chunkBudget("abc.js")).toBe(CHUNK_BUDGET_BYTES);
  });
});
