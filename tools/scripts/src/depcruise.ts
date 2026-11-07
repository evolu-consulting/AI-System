// ADM-NFR-06 · `bun run depcruise`: kiểm luật import trên file đổi (spec M0 T-DEP-8), `--all` quét hết.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { onlyStaleWarning } from "./baseline.rules";
import { changedFiles, hasRef, repoRoot } from "./lib/git";
import { failNote } from "./slice-rm.rules";

const ENTRY_EXT = /\.(ts|tsx|js|mjs|cjs)$/;
const ENTRY_ROOT = /^(apps|packages|tools)\//;
const SKIP = /(^|\/)(__fixtures__|node_modules|dist)\//;
const BATCH = 200; // giới hạn độ dài dòng lệnh Windows

/** Điểm vào cho depcruise: file code dưới apps/ packages/ tools/, bỏ fixture/node_modules/dist. */
export function pickEntries(files: string[]): string[] {
  return files.filter((f) => ENTRY_EXT.test(f) && ENTRY_ROOT.test(f) && !SKIP.test(f));
}

/** Đường dẫn tuyệt đối tới bin `depcruise` của bản cài ở gốc repo. */
export function depcruiseBin(root: string): string {
  let pkgJson: string;
  try {
    pkgJson = Bun.resolveSync("dependency-cruiser/package.json", root);
  } catch {
    pkgJson = join(root, "node_modules/dependency-cruiser/package.json");
  }
  const pkg = JSON.parse(readFileSync(pkgJson, "utf8")) as { bin: Record<string, string> };
  const bin = pkg.bin.depcruise;
  if (!bin) throw new Error("dependency-cruiser không có bin depcruise");
  return join(dirname(pkgJson), bin);
}

/** Chạy depcruise; trả exit code (0 = sạch). */
export function runDepcruise(opts: {
  cwd: string;
  targets: string[];
  config: string;
  outputType: "err" | "json";
  bin: string;
  /** CR-121 ADR-0037: file baseline vi phạm cũ (`--ignore-known`); vi phạm trong đó không làm đỏ. */
  knownViolations?: string;
  /** Cờ thêm cho depcruise (vd `--affected`, `--cache`). */
  extra?: string[];
  /** Quá số mili giây này thì dừng depcruise (code = -1, timedOut = true). */
  timeoutMs?: number;
}): { code: number; out: string; timedOut: boolean } {
  const p = Bun.spawnSync(
    [
      process.execPath,
      opts.bin,
      ...opts.targets,
      "--config",
      opts.config,
      "--output-type",
      opts.outputType,
      ...(opts.knownViolations ? ["--ignore-known", opts.knownViolations] : []),
      ...(opts.extra ?? []),
    ],
    {
      cwd: opts.cwd,
      stdout: "pipe",
      stderr: "pipe",
      ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
    },
  );
  const timedOut = p.exitedDueToTimeout === true;
  return {
    code: timedOut ? -1 : (p.exitCode ?? 1),
    out: p.stdout.toString() + p.stderr.toString(),
    timedOut,
  };
}

type CruiseViolation = { rule: { name: string; severity: string }; from: string; to: string };
type CruiseJson = { summary: { violations: CruiseViolation[]; totalCruised: number } };

/** Tóm tắt kết quả json: số mới (error) / cảnh báo / đã biết (baseline) + vài vi phạm đầu — không in cả đồ thị. */
export function summarizeCruise(json: CruiseJson, show = 10): { errors: number; text: string } {
  const v = json.summary.violations;
  const errors = v.filter((x) => x.rule.severity === "error");
  const warns = v.filter((x) => x.rule.severity === "warn").length;
  const known = v.filter((x) => x.rule.severity === "ignore").length;
  const head = errors
    .slice(0, show)
    .map((x) => `  ${x.rule.name}: ${x.from} -> ${x.to}`)
    .join("\n");
  const more =
    errors.length > show ? `\n  … +${errors.length - show} vi phạm nữa (bun run depcruise)` : "";
  const text = `depcruise:affected: ${json.summary.totalCruised} module quét · ${errors.length} MỚI · ${warns} cảnh báo · ${known} đã biết (baseline)${errors.length ? `\n${head}${more}` : ""}`;
  return { errors: errors.length, text };
}

/** Gốc so sánh cho `--affected`: điểm tách khỏi `platform/gd0` (fallback `main`); không có ⇒ undefined (quét hết). */
function affectedBase(root: string): string | undefined {
  for (const ref of ["platform/gd0", "main"]) {
    if (!hasRef(ref, root)) continue;
    const p = Bun.spawnSync(["git", "merge-base", ref, "HEAD"], { cwd: root, stdout: "pipe" });
    const sha = p.stdout.toString().trim();
    if (p.exitCode === 0 && sha) return sha;
  }
  return undefined;
}

/** `--affected`: depcruise chỉ báo file đổi so với gốc + file phụ thuộc chúng; cache nội dung ⇒ lần ấm vài giây. */
function mainAffected(root: string, budgetSec?: number): number {
  const base = affectedBase(root);
  if (!base) {
    console.log("depcruise:affected: không có platform/gd0|main — quét đầy đủ");
    return main(["--all"]);
  }
  const known = join(root, ".dependency-cruiser-known-violations.json");
  const r = runDepcruise({
    cwd: root,
    targets: ["apps", "packages", "tools"].filter((d) => existsSync(join(root, d))),
    config: join(root, ".dependency-cruiser.cjs"),
    outputType: "json",
    bin: depcruiseBin(root),
    knownViolations: existsSync(known) ? known : undefined,
    extra: ["--affected", base, ...CACHE_ARGS(root)],
    timeoutMs: budgetSec ? budgetSec * 1000 : undefined,
  });
  if (r.timedOut) {
    console.warn(budgetNote(budgetSec ?? 0));
    return 0;
  }
  let json: CruiseJson;
  try {
    json = JSON.parse(r.out) as CruiseJson;
  } catch {
    console.error(r.out.slice(0, 2000));
    return 1;
  }
  const s = summarizeCruise(json);
  (s.errors ? console.error : console.log)(s.text);
  return s.errors ? 1 : 0;
}

/** Lời nhắn khi hook pre-commit bỏ qua vì quá ngân sách thời gian (cổng đầy đủ ở slice:merge). */
export const budgetNote = (sec: number): string =>
  `depcruise:affected: quá ${sec} s — bỏ qua ở pre-commit; slice:merge sẽ kiểm đầy đủ (hoặc chạy bun run depcruise:affected)`;

/** Cache dùng chung mọi worktree (đặt ở thư mục git chung; chiến lược `content` nên an toàn khi dùng chung). */
export function sharedCacheDir(root: string): string {
  const p = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: root,
    stdout: "pipe",
  });
  const common = p.stdout.toString().trim();
  return p.exitCode === 0 && common
    ? join(common, "depcruise-cache")
    : join(root, "node_modules/.cache/dependency-cruiser");
}

const CACHE_ARGS = (root: string): string[] => [
  "--cache",
  sharedCacheDir(root),
  "--cache-strategy",
  "content",
];

/** `--budget=<giây>` ⇒ số giây (> 0) hoặc undefined. */
export function parseBudget(argv: string[]): number | undefined {
  const b = argv.find((a) => a.startsWith("--budget="));
  return b ? Number(b.slice("--budget=".length)) || undefined : undefined;
}

function main(argv: string[]): number {
  const root = repoRoot();
  if (argv.includes("--affected")) return mainAffected(root, parseBudget(argv));
  const full = argv.includes("--all") || !hasRef("main", root) || !hasRef("HEAD", root);
  const targets = full
    ? ["apps", "packages", "tools"].filter((d) => existsSync(join(root, d)))
    : pickEntries(changedFiles(root)).filter((f) => existsSync(join(root, f)));
  if (targets.length === 0) {
    console.log("depcruise: không có file đổi");
    return 0;
  }
  return runBatches(root, targets, full);
}

function runBatches(root: string, targets: string[], full: boolean): number {
  const bin = depcruiseBin(root);
  const config = join(root, ".dependency-cruiser.cjs");
  const known = join(root, ".dependency-cruiser-known-violations.json");
  const knownViolations = existsSync(known) ? known : undefined;
  let code = 0;
  for (let i = 0; i < targets.length; i += BATCH) {
    const r = runDepcruise({
      cwd: root,
      targets: targets.slice(i, i + BATCH),
      config,
      outputType: "err",
      bin,
      knownViolations,
      extra: full ? CACHE_ARGS(root) : undefined,
    });
    const text = r.out.trim();
    const ok = r.code === 0 || onlyStaleWarning(text); // chỉ cảnh báo "stale known violations" ⇒ xanh
    if (ok) console.log(text);
    else console.error(`${text}\n${failNote(text) ?? ""}`.trimEnd());
    code = Math.max(code, ok ? 0 : 1);
  }
  return code;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
