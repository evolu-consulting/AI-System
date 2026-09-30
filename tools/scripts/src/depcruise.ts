// ADM-NFR-06 · `bun run depcruise`: kiểm luật import trên file đổi (spec M0 T-DEP-8), `--all` quét hết.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { changedFiles, hasRef, repoRoot } from "./lib/git";

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
}): { code: number; out: string } {
  const p = Bun.spawnSync(
    [
      process.execPath,
      opts.bin,
      ...opts.targets,
      "--config",
      opts.config,
      "--output-type",
      opts.outputType,
    ],
    { cwd: opts.cwd, stdout: "pipe", stderr: "pipe" },
  );
  return { code: p.exitCode ?? 1, out: p.stdout.toString() + p.stderr.toString() };
}

function main(argv: string[]): number {
  const root = repoRoot();
  const full = argv.includes("--all") || !hasRef("main", root) || !hasRef("HEAD", root);
  const targets = full
    ? ["apps", "packages", "tools"].filter((d) => existsSync(join(root, d)))
    : pickEntries(changedFiles(root)).filter((f) => existsSync(join(root, f)));
  if (targets.length === 0) {
    console.log("depcruise: không có file đổi");
    return 0;
  }
  const bin = depcruiseBin(root);
  const config = join(root, ".dependency-cruiser.cjs");
  let code = 0;
  for (let i = 0; i < targets.length; i += BATCH) {
    const r = runDepcruise({
      cwd: root,
      targets: targets.slice(i, i + BATCH),
      config,
      outputType: "err",
      bin,
    });
    const text = r.out.trim();
    if (r.code === 0) console.log(text);
    else console.error(text);
    code = Math.max(code, r.code === 0 ? 0 : 1);
  }
  return code;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
