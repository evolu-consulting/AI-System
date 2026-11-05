import { describe, expect, it } from "bun:test";
import { JOURNEY_RULES, JOURNEY_SPEC, journeyGuard } from "./seed-e2e-journey";

const PW = "Journey-pass-2026!";

describe("seed-e2e-journey · luật thuần", () => {
  it("spec hợp lệ: khoá e2e-, mọi luật trỏ quy trình + phòng có thật, không có luật sẵn trong spec", () => {
    expect(journeyGuard({ spec: JOURNEY_SPEC, pw: PW })).toBeNull();
    const procs = new Set(JOURNEY_SPEC.processes.map((p) => p.key));
    const depts = new Set([JOURNEY_SPEC.root, ...JOURNEY_SPEC.departments].map((d) => d.key));
    for (const r of JOURNEY_RULES) {
      expect(procs.has(r.process)).toBe(true);
      expect(depts.has(r.dept)).toBe(true);
    }
  });

  it("từ chối tenant không bắt đầu e2e- (NiTi/Demo), quy trình lạ và mật khẩu ngắn", () => {
    expect(journeyGuard({ spec: { ...JOURNEY_SPEC, tenantKey: "nitigroup" }, pw: PW })).toContain(
      "không bắt đầu",
    );
    expect(journeyGuard({ spec: { ...JOURNEY_SPEC, tenantKey: "demo" }, pw: PW })).not.toBeNull();
    const badProc = {
      ...JOURNEY_SPEC,
      processes: [
        {
          ...(JOURNEY_SPEC.processes[0] as (typeof JOURNEY_SPEC.processes)[number]),
          key: "niti-mua-kd",
        },
      ],
    };
    expect(journeyGuard({ spec: badProc, pw: PW })).toContain("niti-mua-kd");
    expect(journeyGuard({ spec: JOURNEY_SPEC, pw: "x" })).toContain("E2E_JOURNEY_PW");
    expect(journeyGuard({ spec: JOURNEY_SPEC, pw: undefined })).toContain("E2E_JOURNEY_PW");
  });
});
