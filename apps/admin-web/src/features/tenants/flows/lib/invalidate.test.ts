// CR-121 f8 · làm tươi dữ liệu Quy trình của công ty: đúng khoá (năng lực, luật, thư viện, lượt chạy, vai) và đúng công ty.
import { describe, expect, it } from "bun:test";
import { companyFlowKeys, invalidateCompanyFlows } from "./invalidate";

describe("CR-121 f8 · invalidateCompanyFlows", () => {
  it("gọi invalidate đúng các khoá của công ty (năng lực + luật + thư viện + lượt chạy + vai)", async () => {
    const calls: unknown[] = [];
    await invalidateCompanyFlows(
      { invalidateQueries: async (f) => void calls.push(f?.queryKey) } as never,
      "T1",
    );
    expect(calls).toEqual([
      ["process", "assigned", "caps", "T1"],
      ["process", "routing", "T1"],
      ["process", "company-lib", "T1"],
      ["process", "company-runs", "T1"],
      ["process", "tenant-slots"],
      ["tenants", "app-roles", "T1"],
    ]);
  });
  it("khoá năng lực trùng với hook đọc năng lực (api-routing) và luật trùng RKEYS.routing", async () => {
    const { RKEYS } = await import("../../api-routing");
    const keys = companyFlowKeys("T9");
    expect(keys.some((k) => k.join("/") === ["process", "assigned", "caps", "T9"].join("/"))).toBe(
      true,
    );
    // khoá luật của một việc phải nằm dưới tiền tố đã làm tươi (invalidate theo tiền tố)
    expect(RKEYS.routing("T9", "contracts.approval").slice(0, 3)).toEqual([
      "process",
      "routing",
      "T9",
    ]);
  });
});
