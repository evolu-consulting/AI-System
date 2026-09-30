// ADM-NFR-06 · M0-AC19 · ngân sách JS/CSS tải ban đầu (gzip) của admin-web (plan-frontend M0 §3, §6).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const JS_BUDGET_BYTES = 150 * 1024;
export const CSS_BUDGET_BYTES = 25 * 1024;

export type BundleReport = { jsKb: string; cssKb: string; errors: string[] };

const TAG_RE = /<(script|link)\b([^>]*)>/gi;
const ATTR_RE = /([\w-]+)\s*=\s*"([^"]*)"/g;

function attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR_RE)) {
    const [, name, value] = m;
    if (name && value !== undefined) out[name.toLowerCase()] = value;
  }
  return out;
}

/** Asset tải ban đầu: mọi `<script src>` và `<link rel="stylesheet" href>` trong index.html. */
export function initialAssets(html: string): { js: string[]; css: string[] } {
  const js: string[] = [];
  const css: string[] = [];
  for (const m of html.matchAll(TAG_RE)) {
    const a = attrs(m[2] ?? "");
    if (m[1]?.toLowerCase() === "script" && a.src) js.push(a.src);
    if (m[1]?.toLowerCase() === "link" && a.rel === "stylesheet" && a.href) css.push(a.href);
  }
  return { js, css };
}

const toKb = (bytes: number): string => (bytes / 1024).toFixed(1);

function gzipTotal(distDir: string, files: string[], missing: string[]): number {
  let total = 0;
  for (const f of files) {
    const rel = f.replace(/^\//, "");
    const abs = join(distDir, rel);
    if (!existsSync(abs)) {
      missing.push(`dist/${rel}`);
      continue;
    }
    total += Bun.gzipSync(readFileSync(abs)).byteLength;
  }
  return total;
}

export function checkBundle(distDir: string): BundleReport {
  const indexPath = join(distDir, "index.html");
  if (!existsSync(indexPath)) {
    return { jsKb: "0.0", cssKb: "0.0", errors: ["check:bundle: thiếu dist/index.html"] };
  }
  const { js, css } = initialAssets(readFileSync(indexPath, "utf8"));
  const missing: string[] = [];
  const jsBytes = gzipTotal(distDir, js, missing);
  const cssBytes = gzipTotal(distDir, css, missing);
  const jsKb = toKb(jsBytes);
  const cssKb = toKb(cssBytes);
  const errors = missing.map((p) => `check:bundle: thiếu ${p}`);
  if (jsBytes > JS_BUDGET_BYTES) errors.push(`check:bundle js ${jsKb} KB > 150 KB`);
  if (cssBytes > CSS_BUDGET_BYTES) errors.push(`check:bundle css ${cssKb} KB > 25 KB`);
  return { jsKb, cssKb, errors };
}

if (import.meta.main) {
  const report = checkBundle(join(import.meta.dir, "..", "dist"));
  if (report.errors.length) {
    for (const e of report.errors) console.error(e);
    process.exit(1);
  }
  console.log(`check:bundle OK · js ${report.jsKb} KB · css ${report.cssKb} KB`);
}
