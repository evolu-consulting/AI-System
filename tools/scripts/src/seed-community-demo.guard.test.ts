// com-c12 · review TB-3: seed cộng đồng từ chối production / DB host lạ trừ khi `--i-know-prod`; `--out` bắt buộc.
import { describe, expect, it } from "bun:test";
import { isLocalDbHost, seedGuard } from "./seed-community-demo.guard";

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
