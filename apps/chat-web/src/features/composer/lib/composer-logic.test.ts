// CHAT-AC-05, CHAT-AC-10 · luật thuần của composer.
import { describe, expect, test } from "bun:test";
import { canSend, clampHeight, draftKey, keyAction } from "./composer-logic";

describe("keyAction", () => {
  test("Enter gửi, Shift+Enter xuống dòng", () => {
    expect(keyAction({ key: "Enter", shiftKey: false }, false)).toBe("send");
    expect(keyAction({ key: "Enter", shiftKey: true }, false)).toBe("none");
  });
  test("Enter khi đang gõ IME bị bỏ qua", () => {
    expect(keyAction({ key: "Enter", shiftKey: false, isComposing: true }, false)).toBe("none");
  });
  test("Esc dừng chỉ khi đang chạy", () => {
    expect(keyAction({ key: "Escape", shiftKey: false }, true)).toBe("stop");
    expect(keyAction({ key: "Escape", shiftKey: false }, false)).toBe("none");
  });
});

describe("canSend", () => {
  test("rỗng / chỉ khoảng trắng / khoá / đang gửi đều không gửi được", () => {
    expect(canSend("  \n", false, false)).toBe(false);
    expect(canSend("xin chào", true, false)).toBe(false);
    expect(canSend("xin chào", false, true)).toBe(false);
    expect(canSend("xin chào", false, false)).toBe(true);
  });
});

describe("clampHeight / draftKey", () => {
  test("tối đa 8 dòng", () => {
    expect(clampHeight(48, 24, 8)).toBe(48);
    expect(clampHeight(500, 24, 8)).toBe(192);
  });
  test("khoá nháp theo hội thoại + flow", () => {
    expect(draftKey(null, null)).toBe("chat:draft:new:main");
    expect(draftKey("c1", "f1")).toBe("chat:draft:c1:f1");
  });
});
