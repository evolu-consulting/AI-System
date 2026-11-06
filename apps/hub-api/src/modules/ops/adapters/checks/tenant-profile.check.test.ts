// CR-121 c20 · unit: đánh giá check `tenant_profile` (thuần): sạch ⇒ ok; mọi vi phạm ⇒ crit kèm mẫu và cách sửa.
import { describe, expect, it } from "bun:test";
import { evaluateTenantProfile, type TenantProfileRow } from "./tenant-profile.check";

const row = (rule: TenantProfileRow["rule"], n = 1, sample = ["acme"]): TenantProfileRow => ({
  rule,
  n,
  sample,
});

describe("tenant_profile · evaluateTenantProfile", () => {
  it("không vi phạm ⇒ ok, value = 0", () => {
    const r = evaluateTenantProfile([]);
    expect(r.status).toBe("ok");
    expect(r.value).toEqual({ rule1: 0, rule2: 0 });
  });

  it("cột trùng quay lại (quy tắc 1) ⇒ crit", () => {
    const r = evaluateTenantProfile([row(1, 1, ["company_settings.company_name"])]);
    expect(r.status).toBe("crit");
    expect(r.message).toContain("[1] 1");
    expect(r.hint).toContain("0076");
  });

  it("tên rỗng (quy tắc 2) ⇒ crit, nêu mẫu và số còn lại", () => {
    const r = evaluateTenantProfile([row(2, 8, ["a", "b", "c", "d", "e"])]);
    expect(r.status).toBe("crit");
    expect(r.message).toContain("a, b, c, d, e và 3 nữa");
    expect(r.value).toEqual({ rule1: 0, rule2: 8 });
  });
});
