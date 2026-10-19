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
  SECRET_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
};

describe("ADM-NFR-06 · loadEnv", () => {
  test("hợp lệ: PORT thành số, CORS_ORIGINS tách dấu phẩy và bỏ khoảng trắng", () => {
    const env = loadEnv({ ...OK, CORS_ORIGINS: " http://a.test , http://b.test:3000 ," });
    expect(env).toEqual({
      ...OK,
      PORT: 3001,
      CORS_ORIGINS: ["http://a.test", "http://b.test:3000"],
      ADMIN_WEB_URL: "http://localhost:3000",
      ADMIN_FROZEN_MODULES: "off", // F1 (CR-095): mặc định off
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
    ["ADMIN_WEB_URL", { ...OK, ADMIN_WEB_URL: "ftp://web.test" }],
    ["JWT_KID", { ...OK, JWT_KID: "k".repeat(65) }],
    ["SECRET_MASTER_KEY", { ...OK, SECRET_MASTER_KEY: "bi_mat_ngan" }],
    ["SECRET_MASTER_KEY", { ...OK, SECRET_MASTER_KEY: Buffer.alloc(31).toString("base64") }],
  ])("sai %s → lỗi nêu tên biến, không lộ giá trị", (name, source) => {
    expect(() => loadEnv(source)).toThrow(name);
    expect(() => loadEnv(source)).not.toThrow(/bi_mat|BEGIN/);
  });

  test("thiếu mọi biến → liệt kê đủ tên", () => {
    expect(() => loadEnv({})).toThrow(
      "APP_ENV, PORT, CORS_ORIGINS, ADMIN_API_DATABASE_URL, JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, JWT_KID, SECRET_MASTER_KEY",
    );
  });
});

describe("N5B-FR-04 · LEGACY_HASH_SUNSET", () => {
  test("N5B-FR-04 · YYYY-MM-DD ⇒ 00:00 UTC; vắng ⇒ undefined; sai ⇒ lỗi nêu tên biến", () => {
    expect(
      loadEnv({ ...OK, LEGACY_HASH_SUNSET: "2027-04-19" }).LEGACY_HASH_SUNSET?.toISOString(),
    ).toBe("2027-04-19T00:00:00.000Z");
    expect(loadEnv(OK).LEGACY_HASH_SUNSET).toBeUndefined();
    for (const bad of ["2027-13-01", "19/04/2027", "2027-04-19T10:00:00Z"])
      expect(() => loadEnv({ ...OK, LEGACY_HASH_SUNSET: bad })).toThrow(/LEGACY_HASH_SUNSET/);
  });
});

describe("TECH-DEBT #193 · chuỗi rỗng = vắng", () => {
  test("biến tuỳ chọn để trống ⇒ nhận mặc định/undefined", () => {
    const env = loadEnv({
      ...OK,
      ADMIN_WEB_URL: "",
      HUB_INTERNAL_TOKEN: "",
      ADMIN_HUB_URL: "  ",
      SMTP_URL: "",
      MAIL_FROM: "",
    });
    expect(env.ADMIN_WEB_URL).toBe("http://localhost:3000");
    expect(env.HUB_INTERNAL_TOKEN).toBeUndefined();
    expect(env.ADMIN_HUB_URL).toBeUndefined();
    expect(env.SMTP_URL).toBeUndefined();
  });

  test("biến bắt buộc để trống ⇒ lỗi nêu đúng tên biến", () => {
    expect(() => loadEnv({ ...OK, JWT_KID: "" })).toThrow(/JWT_KID/);
    expect(() => loadEnv({ ...OK, PORT: "   " })).toThrow(/PORT/);
  });
});
