// CR-177 U4 · `bun run check:ui-kit`: mốc «chỉ giảm» cho phần tử trần/ui riêng của app (tools/scripts/ui-kit-baseline.json).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AppCounts,
  type Baseline,
  compare,
  emptyCounts,
  findHits,
  type Hit,
} from "./check-ui-kit.rules";
import { git, repoRoot } from "./lib/git";

const BASELINE = "tools/scripts/ui-kit-baseline.json";
type PerFile = Record<string, Record<string, string[]>>; // app → file → "metric@dòng"

function readHits(root: string, f: string): Hit[] {
  try {
    return findHits(readFileSync(join(root, f), "utf8"));
  } catch {
    return []; // file đã xoá khỏi cây làm việc nhưng còn trong index
  }
}

function scan(root: string): { counts: Baseline; lines: PerFile } {
  const ls = git(["-c", "core.quotePath=false", "ls-files", "--", "apps"], root);
  if (!ls.ok) throw new Error("check:ui-kit: không đọc được git index");
  const counts: Baseline = {};
  const lines: PerFile = {};
  for (const f of ls.out.split("\n").map((l) => l.trim())) {
    const m = /^apps\/([^/]+-web)\/src\/(.*)$/.exec(f);
    if (!m || !/\.tsx?$/.test(f) || /\.test\.tsx?$/.test(f)) continue;
    const app = m[1] as string;
    const c = counts[app] ?? emptyCounts();
    counts[app] = c;
    if ((m[2] as string).startsWith("components/ui/")) c.uiFiles++;
    if (!f.endsWith(".tsx")) continue;
    const hits = readHits(root, f);
    for (const h of hits) {
      c[h.metric]++;
      const perApp = lines[app] ?? {};
      lines[app] = perApp;
      const arr = perApp[f] ?? [];
      perApp[f] = arr;
      arr.push(`${h.metric}@${h.line}`);
    }
  }
  return { counts, lines };
}

function describeOver(
  app: string,
  k: keyof AppCounts,
  cur: AppCounts,
  base: AppCounts | undefined,
  files: Record<string, string[]>,
): string {
  const head = `${app}.${k}: ${cur[k]} > mốc ${base?.[k] ?? 0}`;
  if (k === "uiFiles") return head;
  const where = Object.entries(files)
    .map(([f, ls]) => [f, ls.filter((x) => x.startsWith(`${k}@`))] as const)
    .filter(([, ls]) => ls.length)
    .map(([f, ls]) => `${f}: ${ls.join(" ")}`)
    .join("\n  ");
  return `${head} — chỗ có thể mới (mọi chỗ hiện có của app):\n  ${where}`;
}

function main(): number {
  const root = repoRoot();
  const update = process.argv.includes("--update");
  const { counts, lines } = scan(root);
  let base: Baseline = {};
  try {
    base = JSON.parse(readFileSync(join(root, BASELINE), "utf8")) as Baseline;
  } catch {
    // chưa có mốc: coi như 0 (đỏ), chỉ `--update` mới tạo được
  }
  const first = Object.keys(base).length === 0;
  const bad: string[] = [];
  let lower = false;
  for (const app of Object.keys(counts)) {
    const cur = counts[app] as AppCounts;
    const { over, under } = compare(cur, base[app]);
    if (under.length) lower = true;
    for (const k of over) {
      bad.push(describeOver(app, k, cur, base[app], lines[app] ?? {}));
    }
  }
  if (update) {
    if (bad.length && !first) {
      console.error(`${bad.join("\n")}\ncheck:ui-kit --update: từ chối TĂNG mốc (chỉ được hạ)`);
      return 1;
    }
    writeFileSync(join(root, BASELINE), `${JSON.stringify(counts, null, 2)}\n`);
    console.log(`check:ui-kit: đã ghi mốc ${BASELINE}`);
    return 0;
  }
  if (bad.length) {
    console.error(
      `${bad.join("\n")}\ncheck:ui-kit: vượt mốc — dùng bộ component chung (packages/web-kit/src/ui/kit/RULES.md)`,
    );
    return 1;
  }
  console.log(
    `check:ui-kit OK${lower ? " — số đếm đã thấp hơn mốc: chạy `bun run check:ui-kit --update` để hạ mốc" : ""}`,
  );
  return 0;
}

if (import.meta.main) process.exit(main());
