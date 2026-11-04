// CR-118 · khung module: manifest contracts trỏ đúng tới nav hiện có, trang chủ là mục đầu.
import { describe, expect, test } from "bun:test";
import { contractsManifest } from "./manifest";

describe("contractsManifest", () => {
  test("khoá module, gói yêu cầu và trang chủ khớp mục menu đầu", () => {
    expect(contractsManifest.key).toBe("contracts");
    expect(contractsManifest.requires).toEqual({ pack: "contracts", action: "read" });
    expect(String(contractsManifest.nav[0]?.to)).toBe(contractsManifest.home);
  });
});
