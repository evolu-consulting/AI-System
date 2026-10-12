// HUB-FR-44 · X2b-2 D3
import { describe, expect, test } from "bun:test";
import { sendKey } from "./send-key";

describe("sendKey", () => {
  test("không tệp ⇒ đúng chữ (khoá cũ)", () => {
    expect(sendKey("a")).toBe("a");
    expect(sendKey("a", [])).toBe("a");
  });
  test("khác tệp ⇒ khác khoá; cùng tệp ⇒ cùng khoá", () => {
    expect(sendKey("a", ["x"])).not.toBe(sendKey("a", ["y"]));
    expect(sendKey("a", ["x", "y"])).toBe(sendKey("a", ["x", "y"]));
    expect(sendKey("a", ["x"])).not.toBe(sendKey("a"));
  });
});
