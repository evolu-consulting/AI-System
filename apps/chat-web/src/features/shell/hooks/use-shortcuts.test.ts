// CHAT-AC-18, CHAT-AC-21 · phím tắt.
import { describe, expect, test } from "bun:test";
import { shortcutOf } from "./use-shortcuts";

const k = (key: string, o: Partial<Parameters<typeof shortcutOf>[0]> = {}) =>
  shortcutOf({ key, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, ...o });

describe("shortcutOf", () => {
  test("Ctrl+Shift+O → new (cả chữ hoa do Shift)", () => {
    expect(k("O", { shiftKey: true })).toBe("new");
    expect(k("o", { shiftKey: true })).toBe("new");
  });
  test("Ctrl+K / Cmd+K → search", () => {
    expect(k("k")).toBe("search");
    expect(k("k", { ctrlKey: false, metaKey: true })).toBe("search");
  });
  test("không Ctrl, Ctrl+O không Shift, Ctrl+Shift+K, Alt → null", () => {
    expect(k("k", { ctrlKey: false })).toBeNull();
    expect(k("o")).toBeNull();
    expect(k("k", { shiftKey: true })).toBeNull();
    expect(k("k", { altKey: true })).toBeNull();
  });
});
