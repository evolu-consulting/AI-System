// ADM-FR-40 · Q5 · rankQuotaTenants (plan-contract §2.3).
import { describe, expect, it } from "bun:test";
import { rankQuotaTenants } from "./overview.rules";

const t = (key: string, pct: number | null, level: "none" | "warn" | "over") => ({
  tenant_id: key,
  tenant_key: key,
  tenant_name: key,
  pct,
  level,
});

describe("rankQuotaTenants", () => {
  it("bỏ level none / pct null, pct giảm rồi key, cắt limit", () => {
    const out = rankQuotaTenants(
      [
        t("b", 90, "warn"),
        t("a", 90, "warn"),
        t("c", 120, "over"),
        t("d", 50, "none"),
        t("e", null, "none"),
      ],
      2,
    );
    expect(out.map((x) => [x.tenant_key, x.pct])).toEqual([
      ["c", 120],
      ["a", 90],
    ]);
  });
});
