// PK-FR-10 · TF2 · plan-frontend §3: token trùng TÊN giữa admin-web và contracts-web phải trùng GIÁ TRỊ (bản sáng và bản tối); lệch ⇒ đỏ.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) =>
  readFileSync(join(import.meta.dir, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

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
    .map(([k, v]) => `${k}: admin ${v} ≠ contracts ${b.get(k)}`);
}

/** Lệch có chủ ý (bản tối), mỗi mục có lý do:
 *  - `--destructive`: admin-web còn là "đề xuất" #f97066 (chữ trắng trên nền này ~2.9:1); contracts-web dùng #b42318 + `--error-border` #f97066.
 *  - bề mặt/chữ/primary/viền/ring: người dùng chốt D-02 (2026-10-19) "contracts-web giống hệt mgmt-app" ⇒ bản tối dùng bộ xám-tím của
 *    `reference/mgmt-app-contracts/web/src/index.css:49-59`, không dùng "Midnight" xanh than của admin-web.
 *  Test bên dưới báo nếu mục nào hết lệch (xoá khỏi danh sách). Token chung còn lại (success, warning, danger, sidebar…) vẫn phải trùng. */
const DARK_DRIFT = [
  "--destructive",
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--muted",
  "--muted-foreground",
  "--primary",
  "--primary-foreground",
  "--border",
  "--input",
  "--ring",
] as const;

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
const admin = read("../../../admin-web/src/styles/globals.css");
const contracts = read("./globals.css");

describe("theme-parity admin-web ↔ contracts-web", () => {
  test("bản sáng (:root): có token chung và không lệch giá trị", () => {
    const a = tokensOf(admin, ":root");
    const c = tokensOf(contracts, ":root");
    const shared = [...a.keys()].filter((k) => c.has(k));
    expect(shared.length).toBeGreaterThan(30);
    expect(mismatches(a, c)).toEqual([]);
  });

  test("bản tối (.dark): không lệch giá trị", () => {
    const a = tokensOf(admin, ".dark");
    const c = tokensOf(contracts, ".dark");
    expect([...a.keys()].filter((k) => c.has(k)).length).toBeGreaterThan(5);
    expect(mismatches(a, c, DARK_DRIFT)).toEqual([]);
    for (const k of DARK_DRIFT) expect(a.get(k)).not.toBe(c.get(k)); // danh sách lệch có chủ ý không được cũ
  });

  test("bản tối cũng chọn được bằng html[data-theme=dark] (theme.ts của mgmt-app)", () => {
    expect(tokensOf(contracts, ':root[data-theme="dark"]').get("--background")).toBe("#0e0f1c");
  });
});

describe("theme-parity contracts-web ↔ mgmt-app + bộ phát hiện", () => {
  test("bản tối giống hệt mgmt-app: token tương ứng trong index.css:49-59 trùng giá trị", () => {
    const mgmt = tokensOf(
      readFileSync(
        join(import.meta.dir, "../../../../reference/mgmt-app-contracts/web/src/index.css"),
        "utf8",
      ).replace(/\/\*[\s\S]*?\*\//g, ""),
      ':root[data-theme="dark"]',
    );
    const c = tokensOf(contracts, ".dark");
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

  test("bộ phát hiện lệch hoạt động", () => {
    const a = tokensOf(":root { --x: #fff; --y: #000; }", ":root");
    const b = tokensOf(":root { --x: #fff; --y: #111; --z: #222; }", ":root");
    expect(mismatches(a, b)).toEqual(["--y: admin #000 ≠ contracts #111"]);
  });
});
