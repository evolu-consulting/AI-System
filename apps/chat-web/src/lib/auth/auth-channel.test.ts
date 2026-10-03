import { describe, expect, test } from "bun:test";
import { AUTH_CHANNEL_NAME, parseAuthMessage } from "./auth-channel";

describe("CHAT-AC-03 · parseAuthMessage", () => {
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

describe("CHAT-AC-03 · tên kênh riêng của chat", () => {
  test("kênh BroadcastChannel là ai-chat-auth", () => {
    expect(AUTH_CHANNEL_NAME).toBe("ai-chat-auth");
  });
});

describe("review C1 #5 · token kèm sub", () => {
  test("giữ sub hợp lệ, bỏ sub rỗng/sai kiểu", () => {
    expect(parseAuthMessage({ type: "token", accessToken: "a", at: 1, sub: "u1" })).toEqual({
      type: "token",
      accessToken: "a",
      at: 1,
      sub: "u1",
    });
    expect(parseAuthMessage({ type: "token", accessToken: "a", at: 1, sub: 3 })).toEqual({
      type: "token",
      accessToken: "a",
      at: 1,
    });
  });
});
