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
