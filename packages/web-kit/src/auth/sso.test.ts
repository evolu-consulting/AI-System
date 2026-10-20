// sso-switch · luật URL chuyển phiên: next an toàn, mã chỉ ở fragment, chống vòng dội.
import { describe, expect, it } from "bun:test";
import {
  parseSsoFragment,
  safeNext,
  shouldTrySso,
  ssoFallbackUrl,
  ssoLandingUrl,
  ssoStartUrl,
} from "./sso";

describe("sso url rules", () => {
  it("safeNext chặn URL tuyệt đối / protocol-relative", () => {
    expect(safeNext("/contracts?x=1")).toBe("/contracts?x=1");
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "", null, undefined])
      expect(safeNext(bad, "/overview")).toBe("/overview");
  });

  it("start/landing/fallback dựng đúng, mã nằm trong fragment", () => {
    expect(ssoStartUrl("http://h:18433/", "contracts", "/overview")).toBe(
      "http://h:18433/sso?app=contracts&next=%2Foverview",
    );
    const landing = ssoLandingUrl("http://h:18431", "abc", "//evil");
    expect(landing).toBe("http://h:18431/sso#code=abc&next=%2F");
    expect(new URL(landing).search).toBe("");
    expect(ssoFallbackUrl("http://h:18431", "/x")).toBe("http://h:18431/login?sso=none&next=%2Fx");
    expect(parseSsoFragment("#code=abc&next=%2Fcontracts")).toEqual({
      code: "abc",
      next: "/contracts",
    });
    expect(parseSsoFragment("").code).toBeNull();
  });

  it("chỉ thử SSO một lần mỗi phút", () => {
    expect(shouldTrySso(null, 1000)).toBe(true);
    expect(shouldTrySso(1000, 30_000)).toBe(false);
    expect(shouldTrySso(1000, 62_000)).toBe(true);
  });
});
