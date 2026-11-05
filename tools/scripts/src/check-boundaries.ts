// CR-121 phần B · ADR-0037 · `bun run check:boundaries` (pre-commit + `bun run check`/CI): module hub-api chỉ import
// module khác qua `modules/<m>/public.ts`; production không import `testing/`. Vi phạm cũ nằm trong baseline
// `.dependency-cruiser-known-violations.json` (cùng khuôn depcruise `--ignore-known`) — baseline CHỈ được co lại:
//   (mặc định)  so sánh; có vi phạm MỚI ⇒ exit 1. Vi phạm cũ đã hết ⇒ nhắc chạy `--write`.
//   --write     ghi lại baseline = tập hiện tại; từ chối nếu có vi phạm mới (không bao giờ nới).
//   --init      chỉ dùng một lần để tạo baseline lần đầu (khi file chưa có).
// Luật ở check-boundaries.rules.ts (unit: check-boundaries.test.ts); quét regex ~0,5 s thay vì depcruise ~30 s.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  type Comparison,
  compare,
  findViolations,
  formatTable,
  fromBaseline,
  type KnownViolation,
  toBaseline,
  totalsByRule,
  type Violation,
} from "./check-boundaries.rules";
import { repoRoot } from "./lib/git";

export const BASELINE_FILE = ".dependency-cruiser-known-violations.json";
const SRC_DIR = "apps/hub-api/src";
const CODE = /\.(ts|tsx)$/;

function walk(dir: string, root: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, root, out);
    else if (CODE.test(e.name)) out.push(relative(root, p).split("\\").join("/"));
  }
}

export function scan(root: string): Violation[] {
  const paths: string[] = [];
  walk(join(root, SRC_DIR), root, paths);
  const sources = new Map<string, string>();
  for (const p of paths) sources.set(p, readFileSync(join(root, p), "utf8"));
  return findViolations(sources);
}

function readBaseline(root: string): KnownViolation[] | null {
  const file = join(root, BASELINE_FILE);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as KnownViolation[];
}

/** depcruise `--ignore-known` dùng chung file; giữ nguyên mục của luật khác nếu sau này có. */
function writeBaseline(root: string, vs: Violation[], rest: KnownViolation[]): void {
  const body = JSON.stringify([...rest, ...toBaseline(vs)], null, 2);
  writeFileSync(join(root, BASELINE_FILE), `${body}\n`);
}

type Ctx = {
  root: string;
  current: Violation[];
  cmp: Comparison;
  rest: KnownViolation[];
  baseline: Violation[];
  ms: number;
};

function listAdded(cmp: Comparison, limit: number): void {
  for (const v of cmp.added.slice(0, limit)) console.error(`  ${v.rule}: ${v.from} → ${v.to}`);
  if (cmp.added.length > limit) console.error(`  … và ${cmp.added.length - limit} nữa`);
}

function runWrite(c: Ctx): number {
  if (c.cmp.added.length > 0) {
    console.error(
      `check:boundaries: từ chối --write, có ${c.cmp.added.length} vi phạm MỚI (baseline không được nới)`,
    );
    listAdded(c.cmp, 20);
    return 1;
  }
  writeBaseline(c.root, c.current, c.rest);
  console.log(`check:boundaries: baseline ${c.cmp.baseline} → ${c.cmp.current} (${c.ms} ms)`);
  return 0;
}

function runCheck(c: Ctx): number {
  console.log(formatTable(c.current, c.baseline));
  const t = totalsByRule(c.current);
  console.log(
    `check:boundaries: ${c.cmp.current}/${c.cmp.baseline} vi phạm (sâu ${t["cross-module-deep"]}, phẳng ${t["cross-module-flat"]}, testing ${t["no-prod-import-testing"]}) · ${c.ms} ms`,
  );
  if (c.cmp.fixed.length > 0) {
    console.log(
      `  ${c.cmp.fixed.length} vi phạm cũ đã hết ⇒ chạy \`bun tools/scripts/src/check-boundaries.ts --write\` để co baseline`,
    );
  }
  if (c.cmp.added.length === 0) return 0;
  console.error(
    `check:boundaries: ${c.cmp.added.length} vi phạm MỚI (ADR-0037) — import qua modules/<m>/public.ts:`,
  );
  listAdded(c.cmp, 30);
  return 1;
}

function main(argv: string[]): number {
  const t0 = performance.now();
  const root = repoRoot();
  const current = scan(root);
  const raw = readBaseline(root);
  const init = argv.includes("--init");
  if (init && raw !== null) {
    console.error("check:boundaries: --init chỉ khi chưa có baseline; dùng --write để co lại");
    return 1;
  }
  if (raw === null && !init) {
    console.error(`check:boundaries: thiếu ${BASELINE_FILE} (tạo một lần: --init)`);
    return 1;
  }
  const known = raw ?? [];
  const baseline = fromBaseline(known);
  const cmp = compare(current, baseline);
  const rest = known.filter((k) => fromBaseline([k]).length === 0);
  const ms = Math.round(performance.now() - t0);
  if (init) {
    writeBaseline(root, current, rest);
    console.log(`check:boundaries: đã tạo baseline ${current.length} vi phạm (${ms} ms)`);
    return 0;
  }
  const ctx: Ctx = { root, current, cmp, rest, baseline, ms };
  return argv.includes("--write") ? runWrite(ctx) : runCheck(ctx);
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
