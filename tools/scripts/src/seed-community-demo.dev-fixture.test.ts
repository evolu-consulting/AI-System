// com-fix-community-login · chặn môi trường cho `--dev-fixture` (thuần): chỉ DB local, không production, cần DEMO_OWNER_PW.
import { describe, expect, it } from "bun:test";
import { devFixtureGuard } from "./seed-community-demo.dev-fixture";

const LOCAL = "postgres://ai:x@localhost:5432/ai";
const PW = "Demo-owner-pw-2026";

describe("devFixtureGuard", () => {
  it("DB local + mật khẩu hợp lệ ⇒ được", () => {
    expect(devFixtureGuard({ appEnv: "development", urls: [LOCAL], ownerPw: PW })).toBeNull();
  });
  it("từ chối: production, DB host ngoài localhost/test (kể cả một trong hai URL), thiếu/ngắn mật khẩu", () => {
    expect(devFixtureGuard({ appEnv: "production", urls: [LOCAL], ownerPw: PW })).toMatch(
      /production/,
    );
    expect(
      devFixtureGuard({
        appEnv: "development",
        urls: [LOCAL, "postgres://u:p@db.prod.example/ai"],
        ownerPw: PW,
      }),
    ).toMatch(/localhost/);
    expect(devFixtureGuard({ appEnv: "development", urls: [LOCAL], ownerPw: undefined })).toMatch(
      /DEMO_OWNER_PW/,
    );
    expect(devFixtureGuard({ appEnv: "development", urls: [LOCAL], ownerPw: "ngan" })).toMatch(
      /DEMO_OWNER_PW/,
    );
  });
});
