// CHAT-AC-20
import { describe, expect, test } from "bun:test";
import { conversationIdOf, conversationPath, initialsOf } from "./conversation-path";

describe("conversation-path", () => {
  test("đường dẫn ↔ id", () => {
    expect(conversationPath("a-1")).toBe("/c/a-1");
    expect(conversationIdOf("/c/a-1")).toBe("a-1");
    expect(conversationIdOf("/c/a-1/")).toBe("a-1");
  });
  test("/c/new và đường khác → null", () => {
    expect(conversationIdOf("/c/new")).toBeNull();
    expect(conversationIdOf("/")).toBeNull();
    expect(conversationIdOf("/c/a/b")).toBeNull();
  });
  test("chữ tắt", () => {
    expect(initialsOf("Thu Hà")).toBe("TH");
    expect(initialsOf("Nguyễn Văn An")).toBe("NA");
    expect(initialsOf("admin")).toBe("A");
    expect(initialsOf("  ")).toBe("?");
  });
});
