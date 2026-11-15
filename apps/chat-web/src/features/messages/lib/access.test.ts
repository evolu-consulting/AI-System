// CR-169 · ẩn mục Tin nhắn khi không có quyền Sổ Hợp Tác.
import { describe, expect, test } from "bun:test";
import { canUseMessages } from "./access";

describe("CR-169 · canUseMessages", () => {
  test("có app contracts ⇒ hiện", () => {
    expect(canUseMessages([{ key: "chat" }, { key: "contracts" }])).toBe(true);
  });
  test("không có contracts / chưa tải / rỗng ⇒ ẩn", () => {
    expect(canUseMessages([{ key: "chat" }])).toBe(false);
    expect(canUseMessages(undefined)).toBe(false);
    expect(canUseMessages([])).toBe(false);
  });
});
