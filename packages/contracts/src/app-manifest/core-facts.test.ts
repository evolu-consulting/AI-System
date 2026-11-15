import { describe, expect, it } from "bun:test";
import { CONTRACTS_MANIFEST } from "./contracts.manifest";
import { isCoreFact, triggerFactsOf } from "./core-facts";

describe("CR-160 · dữ kiện lõi không chọn được ở «Bắt đầu khi»", () => {
  it("danh sách chọn của contract.submitted bỏ starter_is_top, giữ các dữ kiện khác", () => {
    const ev = CONTRACTS_MANIFEST.events?.find((e) => e.key === "contract.submitted");
    expect(ev?.facts.some((f) => f.key === "starter_is_top")).toBe(true); // node Nếu vẫn chọn được
    const keys = triggerFactsOf(ev?.facts ?? []).map((f) => f.key);
    expect(keys).not.toContain("starter_is_top");
    expect(keys).toContain("total_value");
  });
  it("isCoreFact", () => {
    expect(isCoreFact("starter_is_top")).toBe(true);
    expect(isCoreFact("total_value")).toBe(false);
  });
});
