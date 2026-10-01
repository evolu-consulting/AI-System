import { describe, expect, test } from "bun:test";
import { testDbName, testEnvFile, withDatabase } from "./test-db";

describe("ADM-NFR-06 · DB test riêng mỗi agent (TECH-DEBT #17)", () => {
  test.each(["be", "qc", "fe_2", "a".repeat(24)])("tag %s → ai_system_<tag>_test", (tag) => {
    expect(testDbName(tag)).toBe(`ai_system_${tag}_test`);
  });

  test.each(["", "BE", "a-b", "a b", "x;drop", "a".repeat(25), "../x"])(
    "tag sai %j → ném",
    (tag) => {
      expect(() => testDbName(tag)).toThrow();
    },
  );

  test("withDatabase giữ user, mật khẩu, host, cổng; chỉ đổi tên DB", () => {
    expect(
      withDatabase(
        "postgres://ai:p%40ss@localhost:5432/ai_system_test?sslmode=disable",
        "ai_system_be_test",
      ),
    ).toBe("postgres://ai:p%40ss@localhost:5432/ai_system_be_test?sslmode=disable");
  });

  test("testEnvFile chỉ đổi hai biến TEST_*, giữ nguyên các dòng khác (kể cả PEM nhiều dòng)", () => {
    const env = [
      "DATABASE_URL=postgres://ai:x@h:5432/ai_system",
      'JWT_PRIVATE_KEY="-----BEGIN-----\\nabc\\n-----END-----"',
      "TEST_DATABASE_URL=postgres://ai:x@h:5432/ai_system_test",
      "TEST_ADMIN_API_DATABASE_URL=postgres://admin_api:y@h:5432/ai_system_test",
      "",
    ].join("\n");
    expect(testEnvFile(env, "ai_system_be_test").split("\n")).toEqual([
      "DATABASE_URL=postgres://ai:x@h:5432/ai_system",
      'JWT_PRIVATE_KEY="-----BEGIN-----\\nabc\\n-----END-----"',
      "TEST_DATABASE_URL=postgres://ai:x@h:5432/ai_system_be_test",
      "TEST_ADMIN_API_DATABASE_URL=postgres://admin_api:y@h:5432/ai_system_be_test",
      "",
    ]);
  });

  test("testEnvFile thiếu biến → ném", () => {
    expect(() => testEnvFile("TEST_DATABASE_URL=postgres://a@h/x_test", "y_test")).toThrow();
  });
});
