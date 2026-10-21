// sso-switch · luật URL chuyển phiên: next an toàn, mã chỉ ở fragment, chống vòng dội.
import { describe, expect, it } from "bun:test";
import {
  handOffUrl,
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

describe("handOffUrl", () => {
  const grant = async () => ({ code: "c1", target_url: "https://so.x" });
  it("có phiên ⇒ đích là target_url của server (không phải fallback)", async () => {
    const url = await handOffUrl({
      authed: true,
      grant,
      fallbackBase: "https://env.x",
      next: "/a",
    });
    expect(url).toBe("https://so.x/sso#code=c1&next=%2Fa");
  });
  it("không phiên hoặc xin mã lỗi ⇒ form đăng nhập ở fallback; không fallback ⇒ null", async () => {
    const bad = async () => {
      throw new Error("403");
    };
    expect(
      await handOffUrl({ authed: false, grant, fallbackBase: "https://env.x", next: "/" }),
    ).toBe("https://env.x/login?sso=none&next=%2F");
    expect(
      await handOffUrl({ authed: true, grant: bad, fallbackBase: "https://env.x", next: "/" }),
    ).toBe("https://env.x/login?sso=none&next=%2F");
    expect(
      await handOffUrl({ authed: true, grant: bad, fallbackBase: undefined, next: "/" }),
    ).toBeNull();
  });
});
