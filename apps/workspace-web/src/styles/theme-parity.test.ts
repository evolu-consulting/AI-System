// PK-FR-10 · TF2 · CR-125 G4: token màu của 4 app (admin, workspace, chat, studio) đến từ MỘT gói
// packages/web-kit/src/styles/tokens.css; app chỉ import, không chép/ghi đè token (trừ ngoại lệ ghi rõ lý do bên dưới).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const read = (rel: string) => strip(readFileSync(join(import.meta.dir, rel), "utf8"));

/** Token `--tên: giá trị` của khối có selector đúng bằng `selector` (selector danh sách "a, b" tính theo từng phần). */
export function tokensOf(css: string, selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = ((m[1] ?? "").split(/[;}]/).pop() ?? "").split(",").map((s) => s.trim());
    if (!sels.includes(selector)) continue;
    for (const d of (m[2] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      out.set(d[1] as string, (d[2] as string).trim().toLowerCase());
    }
  }
  return out;
}

/** Tên trùng mà giá trị khác. */
export function mismatches(
  a: Map<string, string>,
  b: Map<string, string>,
  allowed: readonly string[] = [],
): string[] {
  return [...a]
    .filter(([k, v]) => b.has(k) && b.get(k) !== v && !allowed.includes(k))
    .map(([k, v]) => `${k}: a ${v} ≠ b ${b.get(k)}`);
}

const APPS = ["admin-web", "workspace-web", "chat-web", "studio-web"] as const;
/** Ghi đè có chủ đích của từng app (tên token). Hiện không có: mọi app dùng đúng bộ token chung. */
const APP_OVERRIDES: Record<(typeof APPS)[number], readonly string[]> = {
  "admin-web": [],
  "workspace-web": [],
  "chat-web": [],
  "studio-web": [],
};
const TOKENS_IMPORT = "packages/web-kit/src/styles/tokens.css";

const tokensCss = read("../../../../packages/web-kit/src/styles/tokens.css");
const appCss = (app: string) => read(`../../../${app}/src/styles/globals.css`);
const rawAppCss = (app: string) =>
  readFileSync(join(import.meta.dir, `../../../${app}/src/styles/globals.css`), "utf8");

/** Mọi khối `:root` / `.dark` / `:root[data-theme="dark"]` của css. */
const SELECTORS = [":root", ".dark", ':root[data-theme="dark"]'] as const;

describe("gói token chung (CR-125 G4)", () => {
  test("màu chính = Indigo #4f46e5 (người dùng chốt 2026-11-08), sáng và vòng focus/sidebar cùng màu", () => {
    const light = tokensOf(tokensCss, ":root");
    expect(light.get("--primary")).toBe("#4f46e5");
    expect(light.get("--ring")).toBe("#4f46e5");
    expect(light.get("--sidebar-primary")).toBe("#4f46e5");
    expect(light.get("--sidebar-ring")).toBe("#4f46e5");
    expect(light.size).toBeGreaterThan(80);
  });

  test("có đủ bản tối cho mọi token thương hiệu/bề mặt/viền", () => {
    const dark = tokensOf(tokensCss, ".dark");
    for (const k of [
      "--background",
      "--foreground",
      "--card",
      "--primary",
      "--ring",
      "--accent",
      "--border",
      "--input",
      "--sidebar",
    ]) {
      expect(dark.has(k)).toBe(true);
    }
    expect(tokensOf(tokensCss, ':root[data-theme="dark"]').get("--background")).toBe("#0e0f1c");
  });

  test("không còn sót màu tím cũ của admin-web (#6e56f0) trong gói", () => {
    expect(tokensCss.toLowerCase()).not.toContain("#6e56f0");
  });
});

describe("4 app dùng chung gói token", () => {
  for (const app of APPS) {
    test(`${app}: import gói và không chép token (trừ ghi đè có chủ đích)`, () => {
      expect(rawAppCss(app)).toContain(`@import "../../../../${TOKENS_IMPORT}"`);
      const own = new Set<string>();
      for (const sel of SELECTORS) for (const k of tokensOf(appCss(app), sel).keys()) own.add(k);
      expect([...own].filter((k) => !APP_OVERRIDES[app].includes(k))).toEqual([]);
    });

    test(`${app}: không khai màu chính riêng, @theme không đè --color-*`, () => {
      const css = appCss(app);
      expect(css).not.toMatch(/--primary\s*:/);
      expect(css).not.toMatch(/--color-[\w-]+\s*:/);
    });
  }

  test("bộ phát hiện lệch hoạt động", () => {
    const a = tokensOf(":root { --x: #fff; --y: #000; }", ":root");
    const b = tokensOf(":root { --x: #fff; --y: #111; --z: #222; }", ":root");
    expect(mismatches(a, b)).toEqual(["--y: a #000 ≠ b #111"]);
  });
});

/** Token tối lấy nguyên từ mgmt-app (index.css:49-58) — kiểm trực tiếp với tệp tham chiếu. */
const MGMT_DARK_MAP: Record<string, string> = {
  "--background": "--color-ground",
  "--card": "--color-panel",
  "--primary": "--color-act",
  "--border": "--color-rule",
  "--input": "--color-field",
  "--foreground": "--color-ink",
  "--muted-foreground": "--color-dim",
  "--accent": "--color-act-soft",
  "--success": "--color-ok",
  "--success-bg": "--color-ok-bg",
  "--danger": "--color-late",
  "--danger-bg": "--color-late-bg",
  "--warning-bg": "--color-soon-bg",
  "--primary-strong": "--color-act-hover",
  "--primary-foreground": "--color-on-act",
  "--ink-strong": "--color-pill",
};

describe("gói token ↔ mgmt-app", () => {
  test("bản tối giống hệt mgmt-app: token tương ứng trong index.css:49-59 trùng giá trị", () => {
    const mgmt = tokensOf(
      readFileSync(
        join(import.meta.dir, "../../../../reference/mgmt-app-contracts/web/src/index.css"),
        "utf8",
      ).replace(/\/\*[\s\S]*?\*\//g, ""),
      ':root[data-theme="dark"]',
    );
    const c = tokensOf(tokensCss, ".dark");
    expect(mgmt.size).toBeGreaterThan(25);
    for (const [ours, theirs] of Object.entries(MGMT_DARK_MAP)) {
      expect({ [ours]: c.get(ours) }).toEqual({ [ours]: mgmt.get(theirs) });
    }
    for (const k of [
      "--sunk",
      "--bubble",
      "--rule",
      "--rule-soft",
      "--field",
      "--ink",
      "--ink-2",
      "--dim",
      "--act-line",
      "--soon",
      "--soon-line",
      "--late-line",
      "--idle-bg",
      "--new-bg",
      "--scroll",
      "--scroll-hover",
    ]) {
      expect({ [k]: c.get(k) }).toEqual({ [k]: mgmt.get(`--color-${k.slice(2)}`) });
    }
  });
});
