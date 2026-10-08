// X2a RV1 #6 · messagePreview khớp server: gộp khoảng trắng, cắt code point (không vỡ emoji).
import { expect, test } from "bun:test";
import { ROOM_PREVIEW_MAX } from "@ai/contracts/chat";
import { messagePreview } from "./message-preview";

test("gộp khoảng trắng/xuống dòng và trim", () => {
  expect(messagePreview("  a \n\n b\t c ")).toBe("a b c");
});
test("cắt đúng 120 code point, không vỡ emoji", () => {
  const out = messagePreview("😀".repeat(200));
  expect(Array.from(out)).toHaveLength(ROOM_PREVIEW_MAX);
  expect(out).toBe("😀".repeat(ROOM_PREVIEW_MAX));
});
