import { describe, expect, test } from "bun:test";
import { loadEnv } from "./env";

const PRIV = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----";
const PUB = "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----";
const OK = {
  APP_ENV: "development" as const,
  PORT: "3001",
  CORS_ORIGINS: "http://localhost:3000",
  ADMIN_API_DATABASE_URL: "postgres://admin_api:bi_mat@localhost:5432/ai_system",
  JWT_PRIVATE_KEY: PRIV,
  JWT_PUBLIC_KEY: PUB,
  JWT_KID: "dev-1",
};

describe("ADM-NFR-06 · loadEnv", () => {
  test("hợp lệ: PORT thành số, CORS_ORIGINS tách dấu phẩy và bỏ khoảng trắng", () => {
    const env = loadEnv({ ...OK, CORS_ORIGINS: " http://a.test , http://b.test:3000 ," });
    expect(env).toEqual({
      ...OK,
      PORT: 3001,
      CORS_ORIGINS: ["http://a.test", "http://b.test:3000"],
    });
  });

  test("PORT=abc → lỗi nêu PORT, không chứa giá trị", () => {
    expect(() => loadEnv({ ...OK, PORT: "abc" })).toThrow(/PORT/);
    expect(() => loadEnv({ ...OK, PORT: "abc" })).not.toThrow(/abc/);
  });

  test.each([
    ["PORT", { ...OK, PORT: "0" }],
    ["PORT", { ...OK, PORT: "65536" }],
    ["APP_ENV", { ...OK, APP_ENV: "staging" }],
    ["CORS_ORIGINS", { ...OK, CORS_ORIGINS: "khong-phai-url" }],
    ["CORS_ORIGINS", { ...OK, CORS_ORIGINS: " , " }],
    ["ADMIN_API_DATABASE_URL", { ...OK, ADMIN_API_DATABASE_URL: "mysql://a:bi_mat@h/d" }],
    ["JWT_PRIVATE_KEY", { ...OK, JWT_PRIVATE_KEY: PUB }],
    ["JWT_PUBLIC_KEY", { ...OK, JWT_PUBLIC_KEY: "" }],
    ["JWT_KID", { ...OK, JWT_KID: "k".repeat(65) }],
  ])("sai %s → lỗi nêu tên biến, không lộ giá trị", (name, source) => {
    expect(() => loadEnv(source)).toThrow(name);
    expect(() => loadEnv(source)).not.toThrow(/bi_mat|BEGIN/);
  });

  test("thiếu mọi biến → liệt kê đủ tên", () => {
    expect(() => loadEnv({})).toThrow(
      "APP_ENV, PORT, CORS_ORIGINS, ADMIN_API_DATABASE_URL, JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, JWT_KID",
    );
  });
});
