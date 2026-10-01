// ADM-NFR-06 · loadSeedEnv: lỗi chỉ nêu tên biến, không in giá trị (spec M1 §4, M1-R20).
import { describe, expect, test } from "bun:test";
import { loadSeedEnv } from "./seed";

const GOOD = {
  DATABASE_URL: "postgres://ai:bi_mat@localhost:5432/ai_system",
  APP_ENV: "development" as const,
  SEED_ADMIN_USERNAME: "admin",
  SEED_ADMIN_PASSWORD: "Seed-Admin-Pw-01",
};
const msgOf = (src: Record<string, string | undefined>): string => {
  try {
    loadSeedEnv(src);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
};

describe("ADM-NFR-06 · loadSeedEnv", () => {
  test("ADM-NFR-06 · env hợp lệ → trả giá trị", () => {
    expect(loadSeedEnv(GOOD)).toEqual(GOOD);
  });

  test("ADM-NFR-06 · thiếu mọi biến → liệt kê đủ 4 tên", () => {
    expect(msgOf({})).toBe(
      "Env không hợp lệ: DATABASE_URL, APP_ENV, SEED_ADMIN_USERNAME, SEED_ADMIN_PASSWORD",
    );
  });

  test("ADM-NFR-06 · mật khẩu 9/129 ký tự, username hoa → nêu tên, không lộ giá trị", () => {
    for (const [k, v] of [
      ["SEED_ADMIN_PASSWORD", "short-pw1"],
      ["SEED_ADMIN_PASSWORD", "x".repeat(129)],
      ["SEED_ADMIN_USERNAME", "Admin"],
    ] as const) {
      const m = msgOf({ ...GOOD, [k]: v });
      expect(m).toBe(`Env không hợp lệ: ${k}`);
      expect(m).not.toContain("bi_mat");
    }
  });

  test("ADM-NFR-06 · production + mật khẩu rỗng → lỗi", () => {
    expect(msgOf({ ...GOOD, APP_ENV: "production", SEED_ADMIN_PASSWORD: "" })).toContain(
      "SEED_ADMIN_PASSWORD",
    );
  });
});
