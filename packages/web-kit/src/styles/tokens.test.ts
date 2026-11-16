// CR-177 U1 · test tĩnh cho gói token chung: màu sáng/tối đủ cặp, bí danh trỏ đúng, thang chữ 6 bậc, bo góc 3 mức.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const raw = readFileSync(join(import.meta.dir, "tokens.css"), "utf8");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

/** Phần thân của khối bắt đầu bằng `head` ở cấp ngoài cùng (đếm ngoặc, nên khối @media lồng không lẫn vào). */
function blockBody(head: string): string {
  const start = css.indexOf(head);
  if (start < 0) throw new Error(`không thấy khối ${head}`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(css.indexOf("{", start) + 1, i);
  }
  throw new Error("khối không đóng");
}
const decls = (body: string) =>
  new Map(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [
      m[1] as string,
      (m[2] as string).trim(),
    ]),
  );

const light = decls(blockBody("\n:root {"));
const dark = decls(blockBody(".dark,"));
const theme = decls(blockBody("@theme inline"));
/** Không phải màu, hoặc cùng giá trị cả hai chế độ: không cần khai lại ở khối tối. */
const SAME_BOTH_MODES = [
  "--radius",
  "--duration-fast",
  "--control-md",
  "--control-sm",
  "--grad-to",
  "--brand-blue-hex",
];
const ALIAS = /^var\(--([\w-]+)\)$/;

function aliasProblems(
  mode: string,
  map: Map<string, string>,
  other: Map<string, string>,
): string[] {
  const bad: string[] = [];
  for (const [k, v] of map) {
    const m = ALIAS.exec(v);
    if (!m) continue;
    const target = `--${m[1]}`;
    const tv = map.get(target);
    if (tv === undefined || ALIAS.test(tv)) bad.push(`${mode} ${k} → ${target}`);
    if (other.get(k) !== v) bad.push(`${k}: sáng ≠ tối`);
  }
  return bad;
}

describe("token màu sáng/tối (CR-177)", () => {
  test("mỗi token khai ở :root có mặt ở khối tối", () => {
    const missing = [...light.keys()].filter((k) => !dark.has(k) && !SAME_BOTH_MODES.includes(k));
    expect(missing).toEqual([]);
  });

  test("bí danh trỏ tới token có thật, ở cả sáng và tối, và là cùng một đích", () => {
    const bad = [...aliasProblems("sáng", light, dark), ...aliasProblems("tối", dark, light)];
    expect(bad).toEqual([]);
    const count = (map: Map<string, string>) =>
      [...map.values()].filter((v) => ALIAS.test(v)).length;
    expect(count(light)).toBe(11);
    expect(count(dark)).toBe(11);
  });

  test("tên shadcn là nguồn: không còn giá trị riêng cho các tên đã gộp", () => {
    for (const k of [
      "--rule",
      "--rule-soft",
      "--field",
      "--ink",
      "--ink-2",
      "--dim",
      "--sunk",
      "--soon",
      "--subtle-foreground",
      "--code-fg",
      "--code-comment",
    ]) {
      expect(light.get(k)).toMatch(ALIAS);
      expect(dark.get(k)).toMatch(ALIAS);
    }
  });
});

describe("thang chữ và bo góc (CR-177)", () => {
  test("đúng 6 cỡ chữ xs…2xl với cỡ/dòng đã chốt", () => {
    const sizes = [...theme.keys()].filter((k) => /^--text-(xs|sm|md|lg|xl|2xl)$/.test(k));
    expect(sizes).toEqual([
      "--text-xs",
      "--text-sm",
      "--text-md",
      "--text-lg",
      "--text-xl",
      "--text-2xl",
    ]);
    const want = {
      xs: [12, 16],
      sm: [13, 18],
      md: [14, 20],
      lg: [16, 24],
      xl: [20, 28],
      "2xl": [24, 32],
    } as const;
    for (const [name, [px, lh]] of Object.entries(want)) {
      expect(theme.get(`--text-${name}`)).toBe(`${px}px`);
      expect(theme.get(`--text-${name}--line-height`)).toBe(`${lh}px`);
    }
  });

  test("đúng 3 mức bo góc sm 6 · md 10 · lg 16", () => {
    const radii = [...theme.keys()].filter((k) => k.startsWith("--radius-"));
    expect(radii).toEqual(["--radius-sm", "--radius-md", "--radius-lg"]);
    expect([theme.get("--radius-sm"), theme.get("--radius-md"), theme.get("--radius-lg")]).toEqual([
      "6px",
      "10px",
      "16px",
    ]);
  });
});

describe("token điều khiển, chuyển động, toast (CR-177)", () => {
  test("chiều cao nút 40/32, điện thoại 44/44 (CR-180); chuyển động 150ms, giảm chuyển động = 0", () => {
    expect(light.get("--control-md")).toBe("40px");
    expect(light.get("--control-sm")).toBe("32px");
    expect(light.get("--duration-fast")).toBe("150ms");
    expect(css).toMatch(
      /max-width: 640px\)\s*\{\s*:root\s*\{\s*--control-md: 44px;\s*--control-sm: 44px;/,
    );
    expect(css).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{\s*--duration-fast: 0ms;/,
    );
  });

  test("toast thường 3 giây, toast có Hoàn tác 6 giây", async () => {
    const t = await import("../ui/toast");
    expect(t.TOAST_MS).toBe(3000);
    expect(t.TOAST_UNDO_MS).toBe(6000);
  });
});
