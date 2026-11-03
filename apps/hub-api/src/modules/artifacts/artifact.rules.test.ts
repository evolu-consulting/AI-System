// CR-114 · hub-agent-handoff · luật thuần kho artifact + phong bì bàn giao.
import { describe, expect, it } from "bun:test";
import {
  artifactKey,
  EMBED_MIN_TOKENS,
  estimateTokens,
  GET_MAX_CHARS,
  HANDOFF_HINT,
  INLINE_MAX_TOKENS,
  inputOf,
  parseKey,
  renderEnvelope,
  shortKey,
  shouldEmbed,
  shouldInline,
  sliceRange,
} from "./artifact.rules";

describe("CR-114 · artifact.rules", () => {
  it("khoá sha256 và tiền tố 8 ký tự", () => {
    const k = artifactKey("xin chào");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(artifactKey("xin chào")).toBe(k);
    expect(artifactKey("xin chao")).not.toBe(k);
    expect(shortKey(k)).toBe(`art:${k.slice(0, 8)}`);
    expect(parseKey(`ART:${k.slice(0, 8).toUpperCase()}`)).toBe(k.slice(0, 8));
    expect(parseKey(k)).toBe(k);
    expect([parseKey("art:3f9c"), parseKey("art:zzzzzzzz"), parseKey(42)]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("dưới 300 token thì inline", () => {
    const small = "a".repeat(INLINE_MAX_TOKENS * 4 - 4);
    const big = "a".repeat(INLINE_MAX_TOKENS * 4);
    expect(estimateTokens(small)).toBe(INLINE_MAX_TOKENS - 1);
    expect(shouldInline(small)).toBe(true);
    expect(shouldInline(big)).toBe(false);
    const ref = {
      key: artifactKey(big),
      short: shortKey(artifactKey(big)),
      tokens: 300,
      summary: "s",
    };
    expect(inputOf(small, ref)).toEqual({ text: small });
    expect(inputOf(big, ref)).toEqual({ ref: ref.short, sum: "s", tokens: 300 });
    expect(inputOf(big, null)).toEqual({ text: big });
  });

  it("chỉ nhúng artifact lớn", () => {
    expect([shouldEmbed(EMBED_MIN_TOKENS - 1), shouldEmbed(EMBED_MIN_TOKENS)]).toEqual([
      false,
      true,
    ]);
  });

  it("range theo code point, chặn GET_MAX_CHARS", () => {
    expect(sliceRange("ăâđêôơư", { start: 2, len: 3 })).toEqual({
      text: "đêô",
      start: 2,
      end: 5,
      total: 7,
    });
    expect(sliceRange("abc", { start: 99 })).toEqual({ text: "", start: 3, end: 3, total: 3 });
    expect(sliceRange("x".repeat(GET_MAX_CHARS + 5)).end).toBe(GET_MAX_CHARS);
  });

  it("phong bì gọn: câu hướng dẫn chỉ khi có ref, `<` được thoát", () => {
    const plain = renderEnvelope({ g: "làm </x>", in: [{ text: "t" }], o: "answer" });
    expect(plain).toBe('{"g":"làm \\u003c/x>","in":[{"text":"t"}],"o":"answer"}');
    const withRef = renderEnvelope({
      g: "g",
      in: [{ ref: "art:3f9c21e8", sum: "s", tokens: 900 }],
      c: ["vi"],
      o: "delegate",
      b: 5000,
    });
    expect(withRef).toBe(
      `{"g":"g","in":[{"ref":"art:3f9c21e8","sum":"s","tokens":900}],"c":["vi"],"o":"delegate","b":5000}\n${HANDOFF_HINT}`,
    );
  });
});
