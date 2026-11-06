// CR-121 c19 · unit: đánh giá check `app_roles` (thuần): lỗi (1,3,4,5) ⇒ crit, chỉ quy tắc 2 ⇒ warn, sạch ⇒ ok.
import { describe, expect, it } from "bun:test";
import { type AppRolesRow, evaluateAppRoles } from "./app-roles.check";

const row = (rule: AppRolesRow["rule"], n = 1, sample = ["Demo · u1"]): AppRolesRow => ({
  rule,
  n,
  sample,
});

describe("app_roles · evaluateAppRoles", () => {
  it("không vi phạm ⇒ ok, value đủ 5 quy tắc = 0", () => {
    const r = evaluateAppRoles([]);
    expect(r.status).toBe("ok");
    expect(r.value).toEqual({ rule1: 0, rule2: 0, rule3: 0, rule4: 0, rule5: 0 });
  });

  it("chỉ quy tắc 2 (member vượt trần) ⇒ warn", () => {
    const r = evaluateAppRoles([row(2)]);
    expect(r.status).toBe("warn");
    expect(r.message).toContain("vượt trần");
  });

  it.each([1, 3, 4, 5] as const)("quy tắc %i ⇒ crit kèm mẫu và cách sửa", (rule) => {
    const r = evaluateAppRoles([row(rule, 7, ["A", "B"])]);
    expect(r.status).toBe("crit");
    expect(r.message).toContain(`[${rule}] 7`);
    expect(r.message).toContain("và 5 nữa");
    expect(r.hint).toBeTruthy();
  });

  it("lỗi + cảnh báo ⇒ crit, nêu cả hai", () => {
    const r = evaluateAppRoles([row(2), row(5)]);
    expect(r.status).toBe("crit");
    expect(r.message).toContain("[2]");
    expect(r.message).toContain("[5]");
  });
});
