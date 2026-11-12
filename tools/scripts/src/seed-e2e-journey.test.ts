import { describe, expect, it } from "bun:test";
import { JOURNEY_SPEC, journeyGuard } from "./seed-e2e-journey";

const PW = "Journey-pass-2026!";

describe("seed-e2e-journey · luật thuần", () => {
  it("spec hợp lệ: khoá e2e- (CR-127: seed không có quy trình/luật)", () => {
    expect(journeyGuard({ spec: JOURNEY_SPEC, pw: PW })).toBeNull();
  });

  it("từ chối tenant không bắt đầu e2e- (NiTi/Demo) và mật khẩu ngắn", () => {
    expect(journeyGuard({ spec: { ...JOURNEY_SPEC, tenantKey: "nitigroup" }, pw: PW })).toContain(
      "không bắt đầu",
    );
    expect(journeyGuard({ spec: { ...JOURNEY_SPEC, tenantKey: "demo" }, pw: PW })).not.toBeNull();
    expect(journeyGuard({ spec: JOURNEY_SPEC, pw: "x" })).toContain("E2E_JOURNEY_PW");
    expect(journeyGuard({ spec: JOURNEY_SPEC, pw: undefined })).toContain("E2E_JOURNEY_PW");
  });
});
