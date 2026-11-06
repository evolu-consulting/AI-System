// `bun run verify:wave [--json] [--plan] [--slots=N]` — cổng ĐỢT: toàn bộ int + e2e của cổng ta (bỏ module đóng băng + test của rowan) chia các slot
// evotest trống THEO THỜI LƯỢNG ĐÃ ĐO (CR-121 T-1: wave-plan.rules.ts + tools/scripts/wave-timings.json), quarantine đỏ đã biết ⇒ chỉ báo đỏ MỚI.
// `--plan`: chỉ in kế hoạch + số giây dự kiến, không chạy. Log: `.data/test-affected/server-*.log`. Thoát 0 = không có đỏ mới.
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { loadExternalOwned } from "./external-owned";
import { externalMatcher } from "./external-owned.rules";
import { isFrozenConfig, isFrozenFile } from "./frozen.rules";
import { repoRoot } from "./lib/git";
import { freeSlots, runBins } from "./test-affected.server";
import { findE2eConfigs } from "./test-all.discover";
import { jobSlug, norm, type SpecInfo } from "./test-e2e-par.rules";
import { newRedLines, render, waveVerdict } from "./verify.rules";
import { planWave, renderPlan } from "./wave-plan.rules";
import { ingest, loadWaveTimings, saveWaveTimings } from "./wave-timings";

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

/** Spec gốc: ghim mảnh 0 nếu nhúng cổng 3000; "clock" nếu chờ bước TOTP (cùng luật test-e2e-par.ts). */
async function rootSpecs(root: string): Promise<SpecInfo[]> {
  const out: SpecInfo[] = [];
  for await (const f of new Glob("e2e/*.spec.ts").scan(root)) {
    const file = norm(f);
    const text = readFileSync(join(root, file), "utf8");
    out.push({
      file,
      cost: text.length / 1000,
      pin0: text.includes("localhost:3000"),
      clock: text.includes("waitNextStep"),
    });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** `yyyymmdd-hhmmss` giờ máy (cùng khuôn tên thư mục `.data/evotest/<stamp>-<pid>-<step>` của run-tests.ps1). */
function stamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main(): Promise<number> {
  const json = process.argv.includes("--json");
  const planOnly = process.argv.includes("--plan");
  const root = repoRoot();
  const ext = externalMatcher(loadExternalOwned(root));
  const skip = (f: string) => isFrozenFile(f) || ext(f);
  const configs = (await findE2eConfigs(root))
    .map((c) => c.replaceAll("\\", "/"))
    .filter((c) => !isFrozenConfig(c) && !ext(c));
  const files = await intFiles(root, skip);
  const jobs = [...new Set(configs.map(jobSlug))].sort();
  const forced = Number(process.argv.find((a) => a.startsWith("--slots="))?.slice(8));
  const free = forced > 0 ? forced : (freeSlots(root) ?? 1);
  const timings = loadWaveTimings(root);
  const plan = planWave({
    intFiles: files,
    allIntFiles: await intFiles(root, () => false),
    jobs: configs
      .filter((c) => c !== "playwright.config.ts")
      .map((c) => ({ job: jobSlug(c), config: c })),
    rootSpecs: configs.includes("playwright.config.ts") ? await rootSpecs(root) : null,
    timings,
    slots: Math.max(1, free),
  });
  console.log(`verify:wave: ${free} slot trống · ${renderPlan(plan).join("\n")}`);
  if (planOnly) return 0;
  const logs = join(root, ".data/test-affected");
  try {
    for (const f of readdirSync(logs)) if (/^server-.*\.log$/.test(f)) rmSync(join(logs, f));
  } catch {}
  const t0 = performance.now();
  const startedAt = stamp(new Date(Date.now() - 5000));
  const results = await runBins(root, plan.bins, { wave: true });
  try {
    const r = ingest(join(root, ".data/evotest"), startedAt, timings);
    saveWaveTimings(root, r.timings);
  } catch {}
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
    render(
      json,
      {
        ok: v.ok,
        ints: files.length,
        jobs,
        plan: { estimate: plan.wall, pieces: plan.pieces },
        results,
        newReds: reds,
      },
      v.lines,
    ),
  );
  return v.ok ? 0 : 1;
}

process.exit(await main());
