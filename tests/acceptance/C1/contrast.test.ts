// CHAT-AC-35, CR-027 · tương phản WCAG 2.x của token Sáng/Tối trong globals.css (plan-frontend-theme §6 T3) [U-11].
// Đọc `:root` (Sáng) và `.dark` (Tối); mỗi cặp phải đạt ngưỡng 4.5 (chữ) hoặc 3 (viền/ring).
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHAT_WEB, CHAT_WEB_ENABLED } from "./_gate";

const CSS = join(CHAT_WEB, "src/styles/globals.css");

/** Lấy thân khối `selector { ... }` ở mức ngoài cùng (đếm ngoặc). */
function block(css: string, selector: string): string {
  const at = css.search(new RegExp(`(^|\\n)\\s*${selector.replace(".", "\\.")}\\s*\\{`));
  if (at === -1) return "";
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  return "";
}

function vars(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) {
    out[m[1] ?? ""] = (m[2] ?? "").toLowerCase();
  }
  return out;
}

function lum(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** [chữ/viền, nền, ngưỡng]; "#fff" là trắng cố định. */
const TEXT: Array<[string, string]> = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["muted-foreground", "card"],
  ["muted-foreground", "background"],
  ["muted-foreground", "muted"],
  ["subtle-foreground", "background"],
  ["subtle-foreground", "card"],
  ["foreground", "row-divider"],
  ["primary-foreground", "primary"],
  ["primary", "card"],
  ["primary-strong", "card"],
  ["accent-foreground", "accent"],
  ["muted-foreground", "accent"],
  ["on-ink", "ink-strong"],
  ["muted-strong-foreground", "muted"],
  ["secondary-foreground", "card"],
  ["success", "success-bg"],
  ["warning", "warning-bg"],
  ["danger", "danger-bg"],
  ["#ffffff", "destructive"],
  ["code-fg", "code-bg"],
  ["code-keyword", "code-bg"],
  ["code-string", "code-bg"],
  ["code-number", "code-bg"],
  ["code-title", "code-bg"],
  ["code-comment", "code-bg"],
];
const NON_TEXT: Array<[string, string]> = [
  ["primary", "background"],
  ["primary", "card"],
  ["error-border", "card"],
  ["warning-solid", "muted"],
];

describe.skipIf(!CHAT_WEB_ENABLED)("contrast", () => {
  it("CHAT-AC-35 · globals.css tồn tại và có đủ khối :root và .dark [U-11]", () => {
    expect(existsSync(CSS)).toBe(true);
    const css = readFileSync(CSS, "utf8");
    expect(Object.keys(vars(block(css, ":root"))).length).toBeGreaterThan(20);
    expect(Object.keys(vars(block(css, ".dark"))).length).toBeGreaterThan(20);
  });

  for (const [name, selector] of [
    ["Sáng", ":root"],
    ["Tối", ".dark"],
  ] as const) {
    const load = (): Record<string, string> => {
      expect(existsSync(CSS)).toBe(true);
      return vars(block(readFileSync(CSS, "utf8"), selector));
    };
    const pick = (v: Record<string, string>, k: string): string =>
      v[k] ?? (k.startsWith("#") ? k : "");

    it(`CHAT-AC-35 · ${name}: chữ đạt tối thiểu 4.5:1 ở mọi cặp bảng §2 [U-11]`, () => {
      const v = load();
      const bad = TEXT.filter(([fg, bg]) => {
        const a = pick(v, fg);
        const b = pick(v, bg);
        return a === "" || b === "" || ratio(a, b) < 4.5;
      }).map(([fg, bg]) => `${fg}/${bg}`);
      expect(bad).toEqual([]);
    });

    it(`CHAT-AC-35 · ${name}: ring, viền flow mở, error-border đạt tối thiểu 3:1 [U-11]`, () => {
      const v = load();
      const pairs = name === "Tối" ? [...NON_TEXT, ["input", "card"]] : NON_TEXT;
      const bad = pairs
        .filter(([fg, bg]) => {
          const a = pick(v, fg ?? "");
          const b = pick(v, bg ?? "");
          return a === "" || b === "" || ratio(a, b) < 3;
        })
        .map(([fg, bg]) => `${fg}/${bg}`);
      expect(bad).toEqual([]);
    });
  }
});
