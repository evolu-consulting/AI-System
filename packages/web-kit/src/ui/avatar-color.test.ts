// CR-187 BR-187-3 · màu avatar theo người: băm ổn định, đủ 10 màu, tương phản ≥ 4,5:1 sáng + tối (đọc từ tokens.css).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AVATAR_COLORS, avatarColorIndex, avatarColorStyle } from "./avatar-color";

const css = readFileSync(join(import.meta.dir, "../styles/tokens.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
function body(head: string): string {
  const s = css.indexOf(head);
  const o = css.indexOf("{", s);
  let d = 0;
  for (let i = o; i < css.length; i++) {
    if (css[i] === "{") d++;
    if (css[i] === "}" && --d === 0) return css.slice(o + 1, i);
  }
  throw new Error(head);
}
const tok = (b: string) =>
  new Map(
    [...b.matchAll(/(--avatar-\d+-(?:bg|fg)):\s*(#[0-9a-f]{6});/gi)].map((m) => [
      m[1] as string,
      m[2] as string,
    ]),
  );
const lum = (h: string) => {
  const c = [1, 3, 5].map((i) => {
    const v = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number);
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe("avatarColorIndex", () => {
  test("ổn định: cùng id ⇒ cùng chỉ số, trong 0..9", () => {
    const id = "0b9c1c1e-4f2a-4a52-9a1e-1f6d6b0d2f10";
    expect(avatarColorIndex(id)).toBe(avatarColorIndex(id));
    expect(avatarColorIndex("")).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 500; i++) {
      const n = avatarColorIndex(`u-${i}`);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(AVATAR_COLORS);
    }
  });
  test("phân bố đủ 10 màu, không màu nào lệch quá nửa", () => {
    const cnt = new Array(AVATAR_COLORS).fill(0) as number[];
    for (let i = 0; i < 2000; i++) {
      const k = avatarColorIndex(crypto.randomUUID());
      cnt[k] = (cnt[k] ?? 0) + 1;
    }
    for (const c of cnt) {
      expect(c).toBeGreaterThan(100);
      expect(c).toBeLessThan(300);
    }
  });
  test("style: không id ⇒ undefined; có id ⇒ trỏ token cùng chỉ số", () => {
    expect(avatarColorStyle(null)).toBeUndefined();
    const n = avatarColorIndex("abc") + 1;
    expect(avatarColorStyle("abc")).toEqual({
      backgroundColor: `var(--avatar-${n}-bg)`,
      color: `var(--avatar-${n}-fg)`,
    });
  });
});

describe("token avatar trong tokens.css", () => {
  for (const [mode, head] of [
    ["sáng", "\n:root {"],
    ["tối", ".dark,"],
  ] as const) {
    describe(`chế độ ${mode}`, () => {
      test("đủ 10 cặp, tương phản ≥ 4,5:1", () => {
        const t = tok(body(head));
        expect(t.size).toBe(AVATAR_COLORS * 2);
        for (let n = 1; n <= AVATAR_COLORS; n++) {
          const r = ratio(t.get(`--avatar-${n}-bg`) as string, t.get(`--avatar-${n}-fg`) as string);
          expect(r).toBeGreaterThanOrEqual(4.5);
        }
      });
    });
  }
});
