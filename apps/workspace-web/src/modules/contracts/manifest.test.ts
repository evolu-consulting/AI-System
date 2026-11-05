// CR-118 · khung module: manifest contracts trỏ đúng tới nav hiện có, trang chủ là mục đầu.
// CR-119 phần 2: basePath = `/${key}` cho MỌI module; mọi mục menu nằm dưới basePath.
import { describe, expect, test } from "bun:test";
import { contractsManifest } from "./manifest";

describe("contractsManifest", () => {
  test("khoá module, gói yêu cầu và trang chủ khớp mục menu đầu", () => {
    expect(contractsManifest.key).toBe("contracts");
    expect(contractsManifest.requires).toEqual({ pack: "contracts", action: "read" });
    expect(String(contractsManifest.nav[0]?.to)).toBe(contractsManifest.home);
  });
  test("basePath = /${key}; home và mọi mục menu nằm dưới basePath", () => {
    expect(contractsManifest.basePath).toBe("/contracts");
    for (const n of contractsManifest.nav) {
      const to = String(n.to);
      expect(
        to === contractsManifest.basePath || to.startsWith(`${contractsManifest.basePath}/`),
      ).toBe(true);
    }
    expect(contractsManifest.home).toBe(contractsManifest.basePath);
  });
});
