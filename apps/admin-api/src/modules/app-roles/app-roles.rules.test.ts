// CR-112 · ADM-BR-15 · luật thuần biên dịch vai: mức ⇒ tập mã gói, phạm vi diff chỉ mã gói trên Group của vai, trần ⇒ effective.
import { describe, expect, test } from "bun:test";
import {
  ceilingOf,
  compilePlan,
  desiredFeatureKeys,
  isEffective,
  roleGroupKey,
  roleKeyFits,
} from "./app-roles.rules";

describe("CR-112 · app-roles.rules", () => {
  test("mức cộng dồn read ⊂ write ⊂ admin, đúng mã của vai mặc định", () => {
    expect(desiredFeatureKeys("my_pack", "read")).toEqual(["my-pack-read"]);
    expect(desiredFeatureKeys("contracts", "write")).toEqual(["contracts-read", "contracts-write"]);
    expect(desiredFeatureKeys("contracts", "admin")).toEqual([
      "contracts-read",
      "contracts-write",
      "contracts-admin",
    ]);
  });

  test("compilePlan: scope = 3 mã gói mỗi Group vai; want = mã theo mức", () => {
    const p = compilePlan([
      { group_id: "g1", pack: "pk", level: "read" },
      { group_id: "g2", pack: "pk", level: "admin" },
    ]);
    expect(p.scope).toHaveLength(6);
    expect(p.scope.every((s) => s.f.startsWith("pk-"))).toBe(true);
    expect(p.want).toEqual([
      { g: "g1", f: "pk-read" },
      { g: "g2", f: "pk-read" },
      { g: "g2", f: "pk-write" },
      { g: "g2", f: "pk-admin" },
    ]);
    expect(p.drop).toEqual([
      { g: "g1", f: "pk-write" },
      { g: "g1", f: "pk-admin" },
    ]);
  });

  test("trần = mức entitlement cao nhất; vai vượt trần không hiệu lực; app tắt ⇒ null", () => {
    expect(ceilingOf("pk", ["pk-read", "pk-write", "other-admin"])).toBe("write");
    expect(ceilingOf("pk", [])).toBeNull();
    expect(isEffective("admin", "write")).toBe(false);
    expect(isEffective("write", "write")).toBe(true);
    expect(isEffective("read", null)).toBe(false);
  });

  test("khoá Group của vai ≤ 32 ký tự", () => {
    expect(roleGroupKey("my_pack", "ke-toan")).toBe("my-pack-ke-toan");
    expect(roleKeyFits("contracts", "ke-toan")).toBe(true);
    expect(roleKeyFits("abcdefghijklmnopqrstu", "abcdefghijklmnopqrst")).toBe(false);
  });
});
