// `bun run verify:wave [--json]` — cổng ĐỢT: toàn bộ int + e2e của cổng ta (bỏ module đóng băng + test của rowan) chia đều các slot evotest trống,
// quarantine đỏ đã biết ⇒ chỉ báo đỏ MỚI. Log: `.data/test-affected/server-*.log`. Thoát 0 = không có đỏ mới.
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { loadExternalOwned } from "./external-owned";
import { externalMatcher } from "./external-owned.rules";
import { isFrozenConfig, isFrozenFile } from "./frozen.rules";
import { repoRoot } from "./lib/git";
import { runServer } from "./test-affected.server";
import { findE2eConfigs } from "./test-all.discover";
import { jobSlug } from "./test-e2e-par.rules";
import { newRedLines, render, waveFilters, waveVerdict } from "./verify.rules";

async function intFiles(root: string, skip: (f: string) => boolean): Promise<string[]> {
  const toml = readFileSync(join(root, "bunfig.int.toml"), "utf8");
  const arr = /pathIgnorePatterns\s*=\s*\[([^\]]*)\]/.exec(toml)?.[1] ?? "";
  const ignore = [...arr.matchAll(/"([^"]+)"/g)].map((m) => new Glob(m[1] ?? ""));
  const out: string[] = [];
  for await (const f of new Glob("**/*.int.test.{ts,tsx}").scan(root)) {
    const p = f.replaceAll("\\", "/");
    if (!p.includes("node_modules/") && !ignore.some((g) => g.match(p)) && !skip(p)) out.push(p);
  }
  return out.sort();
}

async function main(): Promise<number> {
  const json = process.argv.includes("--json");
  const root = repoRoot();
  const ext = externalMatcher(loadExternalOwned(root));
  const skip = (f: string) => isFrozenFile(f) || ext(f);
  const configs = (await findE2eConfigs(root))
    .map((c) => c.replaceAll("\\", "/"))
    .filter((c) => !isFrozenConfig(c) && !ext(c));
  const files = await intFiles(root, skip);
  const jobs = [...new Set(configs.map(jobSlug))].sort();
  const dirs = waveFilters(files, await intFiles(root, () => false));
  const logs = join(root, ".data/test-affected");
  try {
    for (const f of readdirSync(logs)) if (/^server-.*\.log$/.test(f)) rmSync(join(logs, f));
  } catch {}
  const plan = { int: dirs, jobs, e2e: configs } as unknown as Parameters<typeof runServer>[1];
  const t0 = performance.now();
  const results = await runServer(root, plan, configs);
  const reds = readdirSync(logs)
    .filter((f) => /^server-.*\.log$/.test(f))
    .flatMap((f) => newRedLines(readFileSync(join(logs, f), "utf8")));
  const v = waveVerdict({
    ints: files.length,
    jobs,
    results,
    newReds: reds,
    seconds: (performance.now() - t0) / 1000,
  });
  console.log(
    render(json, { ok: v.ok, ints: files.length, jobs, results, newReds: reds }, v.lines),
  );
  return v.ok ? 0 : 1;
}

process.exit(await main());
