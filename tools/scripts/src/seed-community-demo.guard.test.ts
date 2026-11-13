// com-c12 · review TB-3: seed cộng đồng từ chối production / DB host lạ trừ khi `--i-know-prod`; `--out` bắt buộc.
import { describe, expect, it } from "bun:test";
import { isLocalDbHost, isStagingStack, seedDbHost, seedGuard } from "./seed-community-demo.guard";
import { flowSeedGuard } from "./seed-flow-showcase.build";

const LOCAL = "postgres://ai:pw@localhost:5432/ai_system";
const PROD = "postgres://ai:pw@db.prod.example.com:5432/ai_system";

describe("seed-community-demo · chặn môi trường (TB-3)", () => {
  it("allowlist host: localhost/loopback/*.localhost/*.test/dịch vụ compose", () => {
    for (const h of ["localhost", "127.0.0.1", "[::1]", "pg.localhost", "db.ci.test", "postgres"])
      expect(isLocalDbHost(`postgres://u:p@${h}:5432/x`)).toBe(true);
    for (const h of ["db.prod.example.com", "10.0.0.5", "evolu.vn"])
      expect(isLocalDbHost(`postgres://u:p@${h}:5432/x`)).toBe(false);
    expect(isLocalDbHost("không phải url")).toBe(false);
  });

  it("thiếu --out ⇒ từ chối (kể cả --i-know-prod)", () => {
    expect(
      seedGuard({ appEnv: "development", urls: [LOCAL], iKnowProd: true, out: undefined }),
    ).toMatch(/--out/);
  });

  it("APP_ENV=production hoặc host lạ ⇒ từ chối; --i-know-prod ⇒ cho chạy; local dev ⇒ cho chạy", () => {
    const g = (appEnv: string | undefined, urls: string[], iKnowProd = false) =>
      seedGuard({ appEnv, urls, iKnowProd, out: "/tmp/pw.json" });
    expect(g("production", [LOCAL])).toMatch(/production/);
    expect(g("development", [LOCAL, PROD])).toMatch(/host/);
    expect(g("production", [PROD], true)).toBeNull();
    expect(g("development", [LOCAL])).toBeNull();
    expect(g(undefined, [LOCAL])).toBeNull();
  });
});

describe("seedDbHost · chặn môi trường cho demo:* (staging stg-test)", () => {
  const STG = {
    S2_STACK: "stg-test",
    S2_PUBLIC_ADMIN_URL: "https://ai-test-admin.evoluconsulting.com",
    APP_ENV: "development",
  };
  const PG = "postgres://s2_owner:pw@pg:5432/ai_system";
  it("stack staging stg-test ⇒ cho host compose `pg`; vẫn từ chối host lạ", () => {
    expect(seedDbHost(STG)(PG)).toBe(true);
    expect(seedDbHost(STG)(PROD)).toBe(false);
    expect(seedDbHost(STG)(LOCAL)).toBe(true);
  });
  it("prod / thiếu dấu hiệu staging / APP_ENV=production ⇒ từ chối `pg`", () => {
    expect(seedDbHost({})(PG)).toBe(false);
    expect(seedDbHost({ ...STG, APP_ENV: "production" })(PG)).toBe(false);
    expect(seedDbHost({ ...STG, S2_STACK: "sohoptac2" })(PG)).toBe(false);
    expect(
      seedDbHost({ ...STG, S2_PUBLIC_ADMIN_URL: "https://admin.evoluconsulting.com" })(PG),
    ).toBe(false);
    expect(seedDbHost({ ...STG, S2_PUBLIC_ADMIN_URL: "http://ai-test-admin.x.com" })(PG)).toBe(
      false,
    );
    expect(isStagingStack({})).toBe(false);
  });
  it("kết hợp flowSeedGuard: staging được, prod bị từ chối", () => {
    const g = (e: Record<string, string | undefined>) =>
      flowSeedGuard({ appEnv: e.APP_ENV, urls: [PG], iKnowProd: false, isLocal: seedDbHost(e) });
    expect(g(STG)).toBeNull();
    expect(g({ ...STG, APP_ENV: "production" })).toMatch(/production/);
    expect(g({ APP_ENV: "production" })).toMatch(/production/);
    expect(g({})).toMatch(/host/);
  });
});
