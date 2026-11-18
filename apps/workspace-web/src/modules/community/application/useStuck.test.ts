// CR-186 · ô đăng bài thu một dòng chỉ khi VỪA hẹp VỪA đã dính.
import { describe, expect, it } from "bun:test";
import { composerCompact } from "./useStuck";

describe("composerCompact", () => {
  it("chỉ thu khi hẹp và đã cuộn qua", () => {
    expect(composerCompact(true, true)).toBe(true);
    expect(composerCompact(true, false)).toBe(false);
    expect(composerCompact(false, true)).toBe(false);
    expect(composerCompact(false, false)).toBe(false);
  });
});
