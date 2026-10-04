// ADM-NFR-06 · `bun run trace`: yêu cầu → spec → code → test (spec M0 T-TRACE-1…4, Luật 5).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, repoRoot } from "./lib/git";

export type Priority = "MUST" | "SHOULD" | "COULD" | "WON'T" | "—";
export type Req = { id: string; priority: Priority };
export type SpecRef = { path: string; status: string; requirements: string[] };
export type Status = "chưa spec" | "có spec" | "có code" | "có test";
export type TraceRow = Req & { specs: SpecRef[]; code: string[]; tests: string[]; status: Status };
type TextFile = { path: string; text: string };

const ID = "(?:ADM|HUB|WRK)-(?:FR|NFR|BR)-\\d{2,3}";
const idRe = () => new RegExp(`\\b${ID}\\b`, "g");
const CATALOG_ROW = new RegExp(`^\\| (${ID}) \\|`);
const PRIORITY = /\*\*(MUST|SHOULD|COULD|WON'T)\*\*\s*\|?\s*$/;
// Tên test/describe bắt đầu bằng mã; lookbehind để `submit(` không bị tính là `it(`.
const TEST_NAME = new RegExp(`(?<![\\w$.])(?:it|test|describe)\\(\\s*["'\`](${ID})\\b`, "g");
const GATED = new Set(["approved", "in-progress", "done"]);
const TABLE_HEAD =
  "| FR | Ưu tiên | Spec | Code | Test | Trạng thái |\n|---|---|---|---|---|---|\n";
const DEFAULT_PRELUDE =
  "# TRACE — yêu cầu → spec → code → test\n\nSinh tự động bằng `bun run trace`. Không sửa tay.\n\n";

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/;
const SKIP = /(^|\/)(__fixtures__|__pycache__|node_modules|dist|\.venv)\//;
// Python: t\u00EAn h\u00E0m test ch\u1EE9a m\u00E3 d\u1EA1ng snake_case (test_wrk_fr_05_\u2026); docstring \u0111\u1EA7u module n\u00EAu m\u00E3.
const PY_TEST_NAME =
  /^\s*(?:async\s+)?def\s+test_((?:adm|hub|wrk)_(?:fr|nfr|br)_\d{2,3})(?![0-9])/gim;
const PY_HEAD_DOC = /^(?:\s*#[^\n]*\n)*\s*[rRuU]?("""|''')([\s\S]*?)\1/;
const isPy = (p: string) => p.endsWith(".py");
export const isTestFile = (p: string) =>
  /^(tests|e2e|apps\/agent-runtime\/tests)\//.test(p) ||
  /\.(test|spec)\.tsx?$/.test(p) ||
  /(^|\/)test_[^/]*\.py$|_test\.py$|(^|\/)conftest\.py$/.test(p);
export const isCodeFile = (p: string) =>
  /^(apps|packages|tools)\//.test(p) && CODE_EXT.test(p) && !isTestFile(p);

const uniq = (xs: string[]) => [...new Set(xs)];

/** Danh mục từ bảng `docs/design/**\/ba-*.md`: dòng `| <mã> |`, ưu tiên `**…**` cuối dòng. */
export function parseCatalog(mdFiles: TextFile[]): Req[] {
  const seen = new Map<string, Req>();
  for (const f of mdFiles) {
    for (const line of f.text.split(/\r?\n/)) {
      const id = CATALOG_ROW.exec(line)?.[1];
      if (!id || seen.has(id)) continue;
      const p = PRIORITY.exec(line.trimEnd())?.[1] as Priority | undefined;
      seen.set(id, { id, priority: p ?? "—" });
    }
  }
  return [...seen.values()];
}

/** Frontmatter `requirements: [...]`, `status:` của `docs/specs/<ID>/spec.md` (bỏ `_template`). */
export function parseSpecs(files: TextFile[]): SpecRef[] {
  const out: SpecRef[] = [];
  for (const f of files) {
    if (/\/_template\//.test(f.path)) continue;
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(f.text)?.[1];
    if (!fm) continue;
    const reqs = /^requirements:\s*\[([^\]]*)\]/m.exec(fm)?.[1] ?? "";
    const status = /^status:\s*([\w-]+)/m.exec(fm)?.[1] ?? "draft";
    const requirements = reqs.match(idRe()) ?? [];
    if (requirements.length) out.push({ path: f.path, status, requirements });
  }
  return out;
}

/** Python: m\u00E3 trong path \u222A docstring \u0111\u1EA7u module \u222A t\u00EAn h\u00E0m test_<m\u00E3 snake_case>. */
function pyTestRefs(path: string, text: string): string[] {
  const doc = PY_HEAD_DOC.exec(text)?.[2] ?? "";
  const inNames = [...text.matchAll(PY_TEST_NAME)].map((m) =>
    (m[1] ?? "").toUpperCase().replace(/_/g, "-"),
  );
  return uniq([...(path.match(idRe()) ?? []), ...(doc.match(idRe()) ?? []), ...inNames]);
}

/** M\u00E3 m\u1ED9t file test "ph\u1EE7": mã trong path ∪ mã ở đầu tên it/test/describe (T-TRACE-2). */
export function testRefs(path: string, text: string): string[] {
  if (isPy(path)) return pyTestRefs(path, text);
  const inPath = path.match(idRe()) ?? [];
  const inNames = [...text.matchAll(TEST_NAME)].map((m) => m[1] ?? "");
  return uniq([...inPath, ...inNames]).filter(Boolean);
}

export function scanRefs(files: TextFile[], kind: "code" | "test"): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of files) {
    if (SKIP.test(f.path)) continue;
    const ids = kind === "test" ? testRefs(f.path, f.text) : uniq(f.text.match(idRe()) ?? []);
    for (const id of ids) out.set(id, [...(out.get(id) ?? []), f.path]);
  }
  return out;
}

export function buildTrace(input: {
  catalog: Req[];
  specs: SpecRef[];
  code: Map<string, string[]>;
  tests: Map<string, string[]>;
}): TraceRow[] {
  return input.catalog.map((r) => {
    const specs = input.specs.filter((s) => s.requirements.includes(r.id));
    const code = input.code.get(r.id) ?? [];
    const tests = input.tests.get(r.id) ?? [];
    const status: Status =
      specs.length === 0
        ? "chưa spec"
        : tests.length
          ? "có test"
          : code.length
            ? "có code"
            : "có spec";
    return { ...r, specs, code, tests, status };
  });
}

/** Phần trước dòng `| FR |` đầu tiên, giữ nguyên từng byte; không có dòng đó → 3 dòng đầu. */
export function splitPrelude(md: string): string {
  const lines = md.split(/(?<=\n)/);
  const at = lines.findIndex((l) => l.startsWith("| FR |"));
  return (at === -1 ? lines.slice(0, 3) : lines.slice(0, at)).join("");
}

const files = (n: number) => (n ? `${n} file` : "");

export function renderTraceMd(prelude: string, rows: TraceRow[]): string {
  const body = rows
    .map((r) => {
      const specs = r.specs.map((s) => s.path).join("<br>");
      return `| ${r.id} | ${r.priority} | ${specs} | ${files(r.code.length)} | ${files(r.tests.length)} | ${r.status} |\n`;
    })
    .join("");
  return prelude + TABLE_HEAD + body;
}

/** MUST thuộc spec approved / in-progress / done mà chưa có test. */
export function checkGaps(rows: TraceRow[]): TraceRow[] {
  return rows.filter(
    (r) =>
      r.priority === "MUST" && r.tests.length === 0 && r.specs.some((s) => GATED.has(s.status)),
  );
}

function collect(root: string): TraceRow[] {
  const read = (path: string): TextFile => ({ path, text: readFileSync(join(root, path), "utf8") });
  const all = listFiles(root).filter((p) => !SKIP.test(p) && existsSync(join(root, p)));
  return buildTrace({
    catalog: parseCatalog(all.filter((p) => /^docs\/design\/.*\/ba-[^/]*\.md$/.test(p)).map(read)),
    specs: parseSpecs(all.filter((p) => /^docs\/specs\/[^/]+\/spec\.md$/.test(p)).map(read)),
    code: scanRefs(all.filter(isCodeFile).map(read), "code"),
    tests: scanRefs(all.filter((p) => isTestFile(p) && CODE_EXT.test(p)).map(read), "test"),
  });
}

function printOne(row: TraceRow): void {
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `  ${x}`).join("\n") : "  (không)");
  console.log(`${row.id} · ưu tiên: ${row.priority} · trạng thái: ${row.status}`);
  console.log(`spec:\n${list(row.specs.map((s) => `${s.path} (${s.status})`))}`);
  console.log(`code:\n${list(row.code)}`);
  console.log(`test:\n${list(row.tests)}`);
}

function main(argv: string[]): number {
  const root = repoRoot();
  const rows = collect(root);
  if (argv.includes("--check")) {
    const gaps = checkGaps(rows);
    for (const g of gaps)
      console.error(`MUST chưa có test: ${g.id} (${g.specs.map((s) => s.path).join(", ")})`);
    if (gaps.length) return 1;
    console.log(`trace --check OK (${rows.length} mã)`);
    return 0;
  }
  const id = argv.find((a) => !a.startsWith("--"));
  if (id) {
    const row = rows.find((r) => r.id === id);
    if (!row) {
      console.error(`Không tìm thấy ${id}`);
      return 1;
    }
    printOne(row);
    return 0;
  }
  const tracePath = join(root, "docs/TRACE.md");
  const prelude = existsSync(tracePath)
    ? splitPrelude(readFileSync(tracePath, "utf8"))
    : DEFAULT_PRELUDE;
  writeFileSync(tracePath, renderTraceMd(prelude, rows));
  console.log(`trace: đã ghi docs/TRACE.md (${rows.length} mã)`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
