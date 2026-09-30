import { describe, expect, test } from "bun:test";
import { loadDbEnv } from "./env";

const URL_OK = "postgres://ai:ai_dev_pw@localhost:5432/ai_system";

describe("ADM-NFR-06 · loadDbEnv", () => {
  test("nhận postgres:// và postgresql://", () => {
    expect(loadDbEnv({ DATABASE_URL: URL_OK, APP_ENV: "test" })).toEqual({
      DATABASE_URL: URL_OK,
      APP_ENV: "test",
    });
    expect(loadDbEnv({ DATABASE_URL: "postgresql://a@h/d", APP_ENV: "production" }).APP_ENV).toBe(
      "production",
    );
  });

  test("url sai giao thức → lỗi nêu DATABASE_URL, không in giá trị (mật khẩu)", () => {
    const bad = "mysql://ai:bi_mat@localhost/x";
    expect(() => loadDbEnv({ DATABASE_URL: bad, APP_ENV: "test" })).toThrow("DATABASE_URL");
    expect(() => loadDbEnv({ DATABASE_URL: bad, APP_ENV: "test" })).not.toThrow(/bi_mat/);
  });

  test("thiếu biến → liệt kê tên", () => {
    expect(() => loadDbEnv({})).toThrow("DATABASE_URL, APP_ENV");
    expect(() => loadDbEnv({ DATABASE_URL: URL_OK, APP_ENV: "staging" })).toThrow("APP_ENV");
  });
});
