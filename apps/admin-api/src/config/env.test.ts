import { describe, expect, test } from "bun:test";
import { loadEnv } from "./env";

const OK = { APP_ENV: "development", PORT: "3001", CORS_ORIGINS: "http://localhost:3000" };

describe("ADM-NFR-06 · loadEnv", () => {
  test("hợp lệ: PORT thành số, CORS_ORIGINS tách dấu phẩy và bỏ khoảng trắng", () => {
    const env = loadEnv({ ...OK, CORS_ORIGINS: " http://a.test , http://b.test:3000 ," });
    expect(env).toEqual({
      APP_ENV: "development",
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
  ])("sai %s → lỗi nêu tên biến", (name, source) => {
    expect(() => loadEnv(source)).toThrow(name);
  });

  test("thiếu cả ba biến → liệt kê đủ tên", () => {
    expect(() => loadEnv({})).toThrow("APP_ENV, PORT, CORS_ORIGINS");
  });
});
