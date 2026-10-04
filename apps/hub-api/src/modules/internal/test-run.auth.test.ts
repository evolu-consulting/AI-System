import { describe, expect, test } from "bun:test";
import { serviceTokenMatches } from "./test-run.auth";

const T = "unit-internal-token-0123456789abcdef0123";

describe("HUB-FR-51 · serviceTokenMatches (H2a-R24)", () => {
  test("HUB-FR-51 · Bearer đúng → true (scheme không phân biệt hoa, khoảng trắng cuối bỏ qua)", () => {
    expect(serviceTokenMatches(T, `Bearer ${T}`)).toBe(true);
    expect(serviceTokenMatches(T, `bearer ${T} `)).toBe(true);
  });

  test("HUB-FR-51 · thiếu header / sai scheme / sai token / tiền tố / token rỗng → false", () => {
    for (const h of [
      undefined,
      "",
      T,
      `Basic ${T}`,
      `Bearer ${T}x`,
      `Bearer ${T.slice(0, -1)}`,
      "Bearer ",
      `Bearer ${T} extra`,
    ])
      expect(serviceTokenMatches(T, h)).toBe(false);
  });
});
