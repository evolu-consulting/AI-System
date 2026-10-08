// CR-051 · chốt an toàn của `db:reset:dev`.
import { describe, expect, test } from "bun:test";
import { resetTarget } from "./dev-reset";

const URL = "postgres://u:p@localhost:5432/ai_system";
const env = (o: Record<string, string | undefined> = {}) => ({
  APP_ENV: "development",
  DATABASE_URL: URL,
  ...o,
});

describe("db:reset:dev · resetTarget", () => {
  test("development + --yes ⇒ tên DB", () => {
    expect(resetTarget(env(), ["--yes"])).toBe("ai_system");
  });
  test("thiếu --yes / không phải development / DB test / postgres ⇒ từ chối", () => {
    expect(() => resetTarget(env(), [])).toThrow("--yes");
    expect(() => resetTarget(env({ APP_ENV: "production" }), ["--yes"])).toThrow("development");
    expect(() => resetTarget(env({ APP_ENV: "test" }), ["--yes"])).toThrow("development");
    const t = env({ DATABASE_URL: "postgres://u:p@localhost:5432/ai_system_test_x" });
    expect(() => resetTarget(t, ["--yes"])).toThrow("không hợp lệ");
    const pg = env({ DATABASE_URL: "postgres://u:p@localhost:5432/postgres" });
    expect(() => resetTarget(pg, ["--yes"])).toThrow("không hợp lệ");
    expect(() => resetTarget(env({ DATABASE_URL: undefined }), ["--yes"])).toThrow("DATABASE_URL");
  });
});
