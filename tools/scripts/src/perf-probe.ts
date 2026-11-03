// CR-116 probe · CLI đo hiệu năng: baseline một lần → probe ở điểm nóng → so mọi thay đổi với baseline đã lưu.
//   bun run perf:probe    --scenario <tên|all> [--size small|large] [--runs 3] [--json] [--shared] [--dirty] [--log <console.log>]
//   bun run perf:baseline --scenario <tên|all> …   ghi perf/baseline/<kịch bản>.json (CHỈ từ lượt -Exclusive; không thì từ chối)
//   bun run perf:compare  --scenario <tên|all> [--base <file|commit>] …   bảng ≤ 15 dòng; exit 1 nếu có REGRESSION (> 10%)
// Chạy qua `deploy/evotest/run-tests.ps1 -Step perf|py -Exclusive -Probe "runs=N,size=S"` rồi gom dòng `e=probe.*` ở console.log.
// `--log` bỏ qua bước chạy, dùng log có sẵn (cạnh nó có exclusive.txt). Luật thuần: `perf-probe.rules.ts`.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  aggregateScenario,
  type Baseline,
  compare,
  MIN_RUNS,
  parseProbeLog,
  planRuns,
  renderTable,
  SCENARIOS,
} from "./perf-probe.rules";

const ROOT = join(import.meta.dir, "..", "..", "..");
const BASE_DIR = join(ROOT, "perf", "baseline");

type Args = {
  cmd: string;
  scenario: string;
  size: "small" | "large";
  runs: number;
  json: boolean;
  shared: boolean;
  dirty: boolean;
  base?: string;
  log?: string;
};

const VALUE_FLAGS = ["--scenario", "--size", "--runs", "--base", "--log"];
const BOOL_FLAGS = ["--json", "--shared", "--dirty"];

export function parseArgs(argv: string[]): Args {
  const vals = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 1; i < argv.length; i++) {
    const k = argv[i] as string;
    if (VALUE_FLAGS.includes(k)) vals.set(k, argv[++i] ?? "");
    else if (BOOL_FLAGS.includes(k)) bools.add(k);
    else throw new Error(`đối số lạ: ${k}`);
  }
  const a: Args = {
    cmd: argv[0] ?? "run",
    scenario: vals.get("--scenario") ?? "",
    size: vals.get("--size") === "large" ? "large" : "small",
    runs: Number(vals.get("--runs") ?? MIN_RUNS),
    json: bools.has("--json"),
    shared: bools.has("--shared"),
    dirty: bools.has("--dirty"),
    base: vals.get("--base"),
    log: vals.get("--log"),
  };
  if (!["run", "baseline", "compare"].includes(a.cmd)) throw new Error(`lệnh lạ: ${a.cmd}`);
  if (!a.scenario) throw new Error(`thiếu --scenario <${Object.keys(SCENARIOS).join("|")}|all>`);
  if (!Number.isInteger(a.runs) || a.runs < 1) throw new Error("--runs phải là số nguyên ≥ 1");
  return a;
}

const sh = (cmd: string[]) =>
  Bun.spawnSync(cmd, { cwd: ROOT, stdout: "pipe", stderr: "pipe" }).stdout.toString().trim();

function newestLogDir(step: string, since: number): string | null {
  const root = join(ROOT, ".data", "evotest");
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root)
    .filter((d) => d.endsWith(`-${step}`))
    .map((d) => join(root, d))
    .filter((d) => statSync(d).mtimeMs >= since - 5_000)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return dirs[0] ?? null;
}

/** Chạy một nhóm trên evotest; trả đường dẫn console.log. */
function runEvotest(g: { step: "perf" | "py"; filter: string }, a: Args): string {
  const probe = `runs=${a.runs},size=${a.size}`;
  const cmd = [
    "powershell",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "deploy/evotest/run-tests.ps1",
    "-Step",
    g.step,
    "-Filter",
    g.filter,
    "-Probe",
    probe,
    ...(a.shared ? [] : ["-Exclusive"]),
    ...(a.dirty ? ["-Dirty"] : []),
  ];
  console.error(`perf-probe: ${cmd.slice(5).join(" ")}`);
  const t0 = Date.now();
  const r = Bun.spawnSync(cmd, { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  const dir = newestLogDir(g.step, t0);
  if (!dir) throw new Error(`không thấy log evotest (exit ${r.exitCode})`);
  return join(dir, "console.log");
}

function readLog(path: string): { text: string; exclusive: boolean; config: string } {
  const text = readFileSync(path, "utf8");
  const ex = join(dirname(path), "exclusive.txt");
  const exTxt = existsSync(ex) ? readFileSync(ex, "utf8") : "";
  const cfg = exTxt
    .split(/\r?\n/)
    .filter((l) => l.includes("exclusive-config"))
    .map((l) => l.replace(/^.*exclusive-config\s*/, "").slice(0, 60));
  return {
    text,
    exclusive: /exclusive-start/.test(exTxt) || /exclusive-start/.test(text),
    config: cfg.join(" | ") || "?",
  };
}

function toBaseline(scn: string, log: ReturnType<typeof readLog>, a: Args): Baseline {
  const agg = aggregateScenario(parseProbeLog(log.text), scn);
  const dirty = a.dirty || sh(["git", "status", "--porcelain", "--untracked-files=no"]) !== "";
  return {
    scenario: scn,
    commit:
      sh(["git", "rev-parse", "--short", "HEAD"]) +
      (a.dirty ? "+dirty" : dirty ? "(wt-dirty)" : ""),
    date: new Date().toISOString(),
    env: { pg: agg.pg, cpus: log.config, exclusive: log.exclusive },
    size: agg.size,
    runs: agg.runs,
    scn: agg.scn,
    probes: agg.probes,
  };
}

function loadBase(scn: string, base: string | undefined): Baseline {
  const file = join(BASE_DIR, `${scn}.json`);
  if (base && existsSync(base)) return JSON.parse(readFileSync(base, "utf8")) as Baseline;
  if (base) return JSON.parse(sh(["git", "show", `${base}:perf/baseline/${scn}.json`])) as Baseline;
  if (!existsSync(file))
    throw new Error(`chưa có baseline ${file} — chạy: bun run perf:baseline --scenario ${scn}`);
  return JSON.parse(readFileSync(file, "utf8")) as Baseline;
}

function summary(b: Baseline): string {
  const w = Math.max(10, ...Object.keys(b.probes).map((k) => k.length));
  const rows = Object.entries(b.probes).map(
    ([k, s]) =>
      `${k.padEnd(w)}  p50 ${s.p50}  p95 ${s.p95}  mean ${s.mean}  sql ${s.sql} rt ${s.rt} cpu ${s.cpu}  spread ${s.spread}%  n=${s.n}`,
  );
  return [
    `${b.scenario}  ${b.commit}  runs ${b.runs}  size ${b.size}  exclusive ${b.env.exclusive}  scn ms ${b.scn.ms} cpu ${b.scn.cpu} rss ${b.scn.rss}KiB conns ${b.scn.conns}`,
    ...rows,
  ].join("\n");
}

export async function main(argv: string[]): Promise<number> {
  const a = parseArgs(argv);
  const names = a.scenario === "all" ? Object.keys(SCENARIOS) : a.scenario.split(",");
  const logs = new Map<string, LogInfo>();
  for (const g of planRuns(names)) {
    const log = readLog(a.log ?? runEvotest(g, a));
    for (const s of g.scns) logs.set(s, log);
  }
  let code = 0;
  for (const scn of names) code = Math.max(code, handle(scn, logs.get(scn) as LogInfo, a));
  return code;
}

type LogInfo = ReturnType<typeof readLog>;

function doBaseline(scn: string, now: Baseline): number {
  if (!now.env.exclusive) {
    console.error(`${scn}: TỪ CHỐI ghi baseline — lượt không -Exclusive (số đo không so được)`);
    return 2;
  }
  if (now.runs < MIN_RUNS) {
    console.error(`${scn}: TỪ CHỐI — cần ≥ ${MIN_RUNS} lượt (có ${now.runs})`);
    return 2;
  }
  mkdirSync(BASE_DIR, { recursive: true });
  writeFileSync(join(BASE_DIR, `${scn}.json`), `${JSON.stringify(now, null, 2)}\n`);
  console.log(summary(now));
  return 0;
}

function doCompare(scn: string, now: Baseline, a: Args): number {
  const base = loadBase(scn, a.base);
  if (!now.env.exclusive)
    console.error(`${scn}: CẢNH BÁO lượt không -Exclusive — không so được với baseline exclusive`);
  const c = compare(base, now);
  console.log(a.json ? JSON.stringify(c, null, 2) : renderTable(scn, base, now, c));
  if (c.error) return 2;
  return c.regressed ? 1 : 0;
}

function doRun(scn: string, now: Baseline, a: Args): number {
  mkdirSync(join(ROOT, ".data", "perf-probe"), { recursive: true });
  writeFileSync(join(ROOT, ".data", "perf-probe", `${scn}.now.json`), JSON.stringify(now, null, 2));
  console.log(a.json ? JSON.stringify(now, null, 2) : summary(now));
  return 0;
}

function handle(scn: string, log: LogInfo, a: Args): number {
  const now = toBaseline(scn, log, a);
  if (now.runs === 0) {
    console.error(`${scn}: không có mẫu probe trong log (PERF_PROBE tắt hoặc kịch bản đỏ)`);
    return 2;
  }
  if (a.cmd === "baseline") return doBaseline(scn, now);
  return a.cmd === "compare" ? doCompare(scn, now, a) : doRun(scn, now, a);
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (c) => process.exit(c),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(2);
    },
  );
}
