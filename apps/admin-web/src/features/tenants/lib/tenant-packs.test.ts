// PK-FR-05 · UAT CR-095 B3: nhãn gói ở tab "Gói" của chi tiết tenant.
import { describe, expect, test } from "bun:test";
import { packLabel } from "../hooks/use-tenant-packs";

const t = (k: string) => `T:${k}`;

describe("packLabel", () => {
  test("khoá đã biết ⇒ nhãn i18n; khoá lạ ⇒ chính khoá", () => {
    expect(packLabel(t, "contracts")).toBe("T:tenants.packs.name.contracts");
    expect(packLabel(t, "knowledge")).toBe("T:tenants.packs.name.knowledge");
    expect(packLabel(t, "pkdemo")).toBe("pkdemo");
  });
});
