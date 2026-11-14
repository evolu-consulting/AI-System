import { describe, expect, it } from "bun:test";
import { PartnerContractsQuerySchema as S } from "./partner-roles";

describe("CR-151d mục 12 · PartnerContractsQuerySchema", () => {
  it("trần 200: limit 201 lỗi, limit 200 đạt, offset âm lỗi", () => {
    expect(S.safeParse({ party: "tax:0105100099", limit: "201" }).success).toBe(false);
    expect(S.safeParse({ party: "tax:0105100099", limit: "200", offset: "50" }).success).toBe(true);
    expect(S.safeParse({ party: "tax:0105100099", offset: "-1" }).success).toBe(false);
  });
});
