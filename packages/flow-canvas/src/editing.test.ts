// CR-123 · p25 · phím tắt sửa canvas: một bảng phím → lệnh.
import { describe, expect, test } from "bun:test";
import { commandOfKey, type KeyEv } from "./editing";

const k = (key: string, o: Partial<KeyEv> = {}): KeyEv => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...o,
});

describe("commandOfKey", () => {
  test("Delete / Backspace ⇒ xoá; có Shift hoặc Alt thì không", () => {
    expect(commandOfKey(k("Delete"))).toBe("delete");
    expect(commandOfKey(k("Backspace"))).toBe("delete");
    expect(commandOfKey(k("Delete", { shiftKey: true }))).toBeNull();
    expect(commandOfKey(k("Delete", { altKey: true }))).toBeNull();
  });
  test("Ctrl+Z hoàn tác, Ctrl+Y và Ctrl+Shift+Z làm lại (cả Cmd)", () => {
    expect(commandOfKey(k("z", { ctrlKey: true }))).toBe("undo");
    expect(commandOfKey(k("Z", { metaKey: true }))).toBe("undo");
    expect(commandOfKey(k("y", { ctrlKey: true }))).toBe("redo");
    expect(commandOfKey(k("Z", { ctrlKey: true, shiftKey: true }))).toBe("redo");
  });
  test("Ctrl+C / Ctrl+V; phím thường và tổ hợp khác bỏ qua", () => {
    expect(commandOfKey(k("c", { ctrlKey: true }))).toBe("copy");
    expect(commandOfKey(k("v", { ctrlKey: true }))).toBe("paste");
    expect(commandOfKey(k("c", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(commandOfKey(k("c"))).toBeNull();
    expect(commandOfKey(k("a", { ctrlKey: true }))).toBeNull();
  });
});
