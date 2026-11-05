// CR-121 T-1 · cache thời lượng của cổng đợt: `tools/scripts/wave-timings.json` (commit được; verify:wave tự cập nhật sau mỗi lượt).
//   bun tools/scripts/src/wave-timings.ts ingest [--since=<yyyymmdd-hhmmss>] [--from=<thư mục evotest>]   gom từ `.data/evotest/*`
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./lib/git";
import { emptyTimings, type WaveTimings } from "./wave-plan.rules";
import { e2eFromReport, intFromJunit, mergeTimings, type PwReport } from "./wave-timings.rules";

const FILE = "tools/scripts/wave-timings.json";

export function loadWaveTimings(root: string): WaveTimings {
  try {
    const j = JSON.parse(readFileSync(join(root, FILE), "utf8")) as Partial<WaveTimings>;
    return { ...emptyTimings(), ...j };
  } catch {
    return emptyTimings();
  }
}

const sorted = (o: Record<string, number>) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

export function saveWaveTimings(root: string, t: WaveTimings): void {
  const out = { int: sorted(t.int), e2e: sorted(t.e2e), boot: sorted(t.boot) };
  writeFileSync(join(root, FILE), `${JSON.stringify(out, null, 1)}\n`);
}

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Gom số đo từ các thư mục kết quả evotest có tên ≥ `since` (`yyyymmdd-hhmmss`). Trả cache mới + số thư mục dùng. */
export function ingest(
  evoDir: string,
  since: string,
  old: WaveTimings,
): { timings: WaveTimings; dirs: number } {
  const names = existsSync(evoDir)
    ? readdirSync(evoDir).filter(
        (d) => /^\d{8}-\d{6}-\d+-(int|e2e)$/.test(d) && d.slice(0, 15) >= since,
      )
    : [];
  const int: Record<string, number> = {};
  const jobs: Record<string, { files: Record<string, number>; boot: number }> = {};
  for (const d of names) {
    Object.assign(int, intDir(join(evoDir, d, "int")));
    Object.assign(jobs, e2eDir(join(evoDir, d, "e2e", "e2e")));
  }
  return { timings: mergeTimings(old, { int, jobs }), dirs: names.length };
}

/** Giây mỗi file int của một lượt: số đo header→header (`int-timings.json`, > 0) thắng ước lượng từ JUnit. */
function intDir(dir: string): Record<string, number> {
  if (!existsSync(dir)) return {};
  const real = readJson<Record<string, number>>(join(dir, "int-timings.json")) ?? {};
  const est: Record<string, number> = {};
  for (const f of readdirSync(dir).filter((x) => /^int-junit-.*\.xml$/.test(x)))
    Object.assign(est, intFromJunit(readFileSync(join(dir, f), "utf8")));
  const out: Record<string, number> = {};
  for (const f of new Set([...Object.keys(est), ...Object.keys(real)]))
    out[f] = (real[f] ?? 0) > 0 ? (real[f] as number) : (est[f] ?? 0);
  return out;
}

function e2eDir(dir: string): Record<string, ReturnType<typeof e2eFromReport>> {
  if (!existsSync(dir)) return {};
  const out: Record<string, ReturnType<typeof e2eFromReport>> = {};
  for (const job of readdirSync(dir)) {
    const rep = readJson<PwReport>(join(dir, job, "report.json"));
    if (rep) out[job] = e2eFromReport(rep);
  }
  return out;
}

if (import.meta.main) {
  const root = repoRoot();
  const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  if (process.argv[2] !== "ingest") {
    console.error(
      "Dùng: bun tools/scripts/src/wave-timings.ts ingest [--since=yyyymmdd-hhmmss] [--from=<thư mục evotest>]",
    );
    process.exit(2);
  }
  const r = ingest(
    arg("from") ?? join(root, ".data/evotest"),
    arg("since") ?? "00000000-000000",
    loadWaveTimings(root),
  );
  saveWaveTimings(root, r.timings);
  console.log(
    `wave-timings: ${r.dirs} thư mục → ${Object.keys(r.timings.int).length} file int, ${Object.keys(r.timings.e2e).length} khoá e2e, ${Object.keys(r.timings.boot).length} boot`,
  );
}
