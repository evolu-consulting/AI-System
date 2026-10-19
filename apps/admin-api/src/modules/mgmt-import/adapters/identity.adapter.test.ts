// I1 · khoá tenant khi hai org mgmt-app cùng tên (slug trùng ⇒ N5 DUPLICATE_KEY): org sau nhận khoá tất định, khác nhau.
import { describe, expect, test } from "bun:test";
import { withUniqueKeys } from "./identity.adapter";

describe("withUniqueKeys", () => {
  test("org đầu theo id giữ slug; org sau cùng tên ⇒ <slug>-<8 hex>, tất định; khác tên không đổi", () => {
    const file = {
      format: "mgmt-app-users/v1" as const,
      source: "s",
      orgs: [
        { id: "b-org", name: "Công ty An Nam" },
        { id: "a-org", name: "Công ty An Nam" },
        { id: "c-org", name: "Bờ Bê" },
      ],
      users: [],
    };
    const out = withUniqueKeys(file);
    const byId = Object.fromEntries(out.orgs.map((o) => [o.id, o.tenant_key]));
    expect(byId["a-org"]).toBeUndefined();
    expect(byId["c-org"]).toBeUndefined();
    expect(byId["b-org"]).toMatch(/^[a-z0-9-]{2,23}-[0-9a-f]{8}$/);
    expect(withUniqueKeys(file).orgs.find((o) => o.id === "b-org")?.tenant_key).toBe(byId["b-org"]);
  });
});
