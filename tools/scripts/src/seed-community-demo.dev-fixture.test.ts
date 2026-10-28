// com-fix-community-login · chặn môi trường cho `--dev-fixture` (thuần): APP_ENV development|test, host chỉ loopback/*.localhost/
// *.test (không nhận tên dịch vụ `postgres`/`db`), cần DEMO_OWNER_PW.
import { describe, expect, it } from "bun:test";
import { devFixtureGuard, isDevFixtureHost } from "./seed-community-demo.dev-fixture";

const LOCAL = "postgres://ai:x@localhost:5432/ai";
const PW = "Demo-owner-pw-2026";
const ok = (o: Partial<Parameters<typeof devFixtureGuard>[0]>) =>
  devFixtureGuard({ appEnv: "development", urls: [LOCAL], ownerPw: PW, ...o });

describe("devFixtureGuard", () => {
  it("development/test + DB local + mật khẩu hợp lệ ⇒ được", () => {
    expect(ok({})).toBeNull();
    expect(ok({ appEnv: "test", urls: ["postgres://u:p@db.test/ai"] })).toBeNull();
  });
  it("từ chối APP_ENV production / staging / vắng", () => {
    for (const appEnv of ["production", "staging", undefined])
      expect(ok({ appEnv })).toMatch(/APP_ENV/);
  });
  it("từ chối host ngoài allowlist (kể cả một trong hai URL), thiếu/ngắn mật khẩu", () => {
    expect(ok({ urls: [LOCAL, "postgres://u:p@db.prod.example/ai"] })).toMatch(/localhost/);
    expect(ok({ ownerPw: undefined })).toMatch(/DEMO_OWNER_PW/);
    expect(ok({ ownerPw: "ngan" })).toMatch(/DEMO_OWNER_PW/);
  });
});

describe("isDevFixtureHost", () => {
  it("chỉ loopback, *.localhost, *.test; không nhận `postgres`/`db` (tên dịch vụ compose) hay URL hỏng", () => {
    for (const h of ["localhost", "127.0.0.1", "[::1]", "pg.localhost", "db.test"])
      expect(isDevFixtureHost(`postgres://u:p@${h}:5432/ai`)).toBe(true);
    for (const h of ["postgres", "db", "10.0.0.5", "evil.test.example.com"])
      expect(isDevFixtureHost(`postgres://u:p@${h}:5432/ai`)).toBe(false);
    expect(isDevFixtureHost("không phải url")).toBe(false);
  });
});
