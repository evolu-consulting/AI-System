// `bun run verify:slice [--base <ref>] [--e2e <việc>[,<việc>]] [-Dirty] [--json]` — cổng LÁT trọn gói: `test:affected --run local` (check + typecheck + unit tại máy) chạy SONG SONG với
// `--run server` (int + e2e dính diff trên evotest, quarantine đỏ đã biết). Log đầy đủ ở `.data/verify/slice-*.log`; in tóm tắt ≤ 10 dòng (`--json` cho máy).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./lib/git";
import { type LegResult, legSummary, render, sliceVerdict } from "./verify.rules";
import { opt } from "./verify-lib";

async function leg(
  root: string,
  mode: "local" | "server",
  base?: string,
  extra: string[] = [],
): Promise<LegResult> {
  const log = join(root, ".data/verify", `slice-${mode}.log`);
  const t0 = performance.now();
  const p = Bun.spawn(
    [
      "bun",
      "tools/scripts/src/test-affected.ts",
      "--run",
      mode,
      ...(base ? ["--base", base] : []),
      ...extra,
    ],
    { cwd: root, stdout: Bun.file(log), stderr: Bun.file(log) },
  );
  const code = await p.exited;
  const text = await Bun.file(log).text();
  return {
    mode,
    code,
    seconds: Math.round((performance.now() - t0) / 100) / 10,
    ...legSummary(text),
  };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const root = repoRoot();
  mkdirSync(join(root, ".data/verify"), { recursive: true });
  const base = opt(argv, "base");
  // tool-evotest-fast: `--e2e <việc>[,<việc>]` thêm việc e2e vào chân server (chạy song song với int); `-Dirty` ép gửi cả thay đổi chưa commit.
  const e2e = opt(argv, "e2e");
  const extra = [
    ...(e2e ? [`--e2e-jobs=${e2e}`] : []),
    ...(argv.some((a) => /^--?dirty$/i.test(a)) ? ["--dirty"] : []),
  ];
  const legs = await Promise.all([leg(root, "local", base), leg(root, "server", base, extra)]);
  const v = sliceVerdict(legs);
  console.log(render(argv.includes("--json"), { ok: v.ok, legs }, v.lines));
  return v.ok ? 0 : 1;
}

process.exit(await main());
