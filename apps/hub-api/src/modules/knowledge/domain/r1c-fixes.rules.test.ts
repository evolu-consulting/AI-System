// R1 · review CR-095 đợt C: F-05 `fitContent` (văn bản chuyển đổi > trần kho ⇒ cắt ở ranh giới + cờ truncated) và F-08
// `aliasTries` (cặp bí danh tra bằng Map, ≤ 1 cặp mỗi thực thể, trần số lần thử).
import { describe, expect, it } from "bun:test";
import { aliasPairKey, aliasTries, type Entity } from "./extract.rules";
import { fitContent } from "./ingest.rules";
import { LIMITS } from "./knowledge.rules";

describe("F-05 · fitContent", () => {
  it("trong trần ⇒ giữ nguyên", () => {
    expect(fitContent("abc", 10)).toEqual({ md: "abc", truncated: false });
  });
  it("> 500k ký tự (PDF 1 M) ⇒ ≤ contentMax, cắt ở dòng trống gần nhất", () => {
    const para = `${"x".repeat(999)}\n\n`;
    const md = para.repeat(1000); // 1.001.000 ký tự
    const r = fitContent(md, LIMITS.contentMax);
    expect(r.truncated).toBe(true);
    expect(r.md.length).toBeLessThanOrEqual(LIMITS.contentMax);
    expect(r.md.length).toBeGreaterThan(LIMITS.contentMax - 1001);
    expect(r.md.endsWith("x")).toBe(true);
  });
  it("không có dòng trong nửa sau ⇒ cắt cứng, không tách cặp surrogate", () => {
    const r = fitContent(`${"a".repeat(9)}😀b`, 10);
    expect(r).toEqual({ md: "a".repeat(9), truncated: true });
  });
});

describe("F-08 · aliasTries", () => {
  const p = (name: string): Entity => ({ name, type: "Person" });
  it("cùng loại + cùng dạng so, khác key; trùng key chỉ một lần; khác loại bỏ", () => {
    const t = aliasTries(
      [p("Nguyen An"), p("Nguyen An"), { name: "Nguyen An", type: "Team" }, p("Lan")],
      [{ key: "Person:an nguyen", name: "An Nguyen", type: "Person" }],
    );
    expect(t).toEqual([
      {
        a: "Person:nguyen an",
        b: "Person:an nguyen",
        type: "Person",
        aName: "Nguyen An",
        bName: "An Nguyen",
      },
    ]);
    expect(aliasPairKey(t[0]?.a ?? "", t[0]?.b ?? "")).toBe(
      "Person:nguyen an\u0000Person:an nguyen",
    );
  });
  it("trần số lần thử", () => {
    const ents = Array.from({ length: 100 }, (_, i) => p(`Ten ${i} Ho`));
    const cands = ents.map((e) => ({ key: `Person:x${e.name}`, name: e.name, type: "Person" }));
    expect(aliasTries(ents, cands, 7)).toHaveLength(7);
    expect(aliasTries(ents, cands)).toHaveLength(30);
  });
});
