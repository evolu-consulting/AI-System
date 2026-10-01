import { describe, expect, test } from "bun:test";
import { parseAuthMessage } from "./auth-channel";

describe("ADM-FR-01 · parseAuthMessage", () => {
  test("nhận token và logout hợp lệ", () => {
    expect(parseAuthMessage({ type: "token", accessToken: "abc", at: 1 })).toEqual({
      type: "token",
      accessToken: "abc",
      at: 1,
    });
    expect(parseAuthMessage({ type: "logout", junk: 1 })).toEqual({ type: "logout" });
  });

  test("bỏ qua dữ liệu sai hình", () => {
    for (const bad of [
      null,
      "x",
      3,
      {},
      { type: "token" },
      { type: "token", accessToken: "", at: 1 },
    ]) {
      expect(parseAuthMessage(bad)).toBeNull();
    }
  });
});
