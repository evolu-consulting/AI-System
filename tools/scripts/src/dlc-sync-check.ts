// dlc-handoff · `bun run dlc:check [ref]`: xem nhánh DLC của Rowan còn gì chưa vào HEAD. Chỉ đọc (git), không fetch/push.
import { git, repoRoot } from "./lib/git";

export type Area = "dlc" | "seam" | "other";

/** Đường dẫn DLC sở hữu hoàn toàn (Rowan sửa tự do). */
export const DLC_OWNED: RegExp[] = [
  /^apps\/dlc-workspace\//,
  /^apps\/hub-api\/src\/modules\/packs\/dlc\//,
  /^apps\/hub-api\/src\/modules\/dlc-calls\//,
  /^apps\/hub-api\/src\/app\.dlc\.ts$/,
  /^tools\/dlc-dify\//,
  /^packages\/db\/migrations-pack-dlc\//,
  /^apps\/admin-web\/src\/features\/processes\/(lib\/dlc-slot|components\/library\/DlcStageForm)/,
];

/** Chỗ chung: Rowan chạm vào code của ta, phải báo trước. */
export const SEAMS: RegExp[] = [
  /^packages\/db\/migrations-hub\//,
  /^packages\/db\/src\/migrate-packs\.ts$/,
  /^packages\/i18n\/locales\//,
  /^apps\/admin-web\/src\/features\/processes\//,
  /^apps\/hub-api\/src\/app(\.[a-z0-9]+)?\.ts$/,
  /^apps\/hub-api\/src\/modules\/packs\//,
  /^apps\/hub-api\/src\/config\//,
  /^\.env\.example$/,
];

/** Dải số migration hub dành riêng cho DLC (0070 đã dùng). Phía ta không dùng. */
export const DLC_HUB_RANGE: [number, number] = [70, 80];

export function classify(path: string): Area {
  if (DLC_OWNED.some((r) => r.test(path))) return "dlc";
  if (SEAMS.some((r) => r.test(path))) return "seam";
  return "other";
}

export function groupFiles(paths: string[]): Record<Area, string[]> {
  const out: Record<Area, string[]> = { dlc: [], seam: [], other: [] };
  for (const p of paths) out[classify(p)].push(p);
  return out;
}

const migNum = (f: string): number | null => {
  const m = /^(\d{4})_/.exec(f);
  return m ? Number(m[1]) : null;
};

/**
 * Migration hub của nhánh DLC lệch với HEAD: trùng số khác tên (collision) hoặc số
 * nằm ngoài dải DLC mà HEAD chưa có (outOfRange). `ours`/`theirs` = tên file trong migrations-hub.
 */
export function migrationIssues(
  ours: string[],
  theirs: string[],
  range: [number, number] = DLC_HUB_RANGE,
): { collisions: string[]; outOfRange: string[] } {
  const mine = new Set(ours);
  const byNum = new Map<number, string[]>();
  for (const f of ours) {
    const n = migNum(f);
    if (n !== null) byNum.set(n, [...(byNum.get(n) ?? []), f]);
  }
  const collisions: string[] = [];
  const outOfRange: string[] = [];
  for (const f of theirs) {
    if (mine.has(f)) continue;
    const n = migNum(f);
    if (n === null) continue;
    const clash = byNum.get(n);
    if (clash) collisions.push(`${f} (HEAD đã có ${clash.join(", ")})`);
    else if (n < range[0] || n > range[1]) outOfRange.push(f);
  }
  return { collisions, outOfRange };
}

function main(): void {
  const ref = process.argv[2] ?? "github/platform/gd0_dlc";
  const root = repoRoot();
  const run = (a: string[]) => {
    const r = git(a, root);
    if (!r.ok)
      throw new Error(`git ${a.join(" ")} lỗi (ref có tồn tại không? chạy git fetch trước)`);
    return r.out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  };
  const base = run(["merge-base", "HEAD", ref])[0] ?? "";
  const commits = run(["log", "--oneline", `HEAD..${ref}`]);
  const files = run(["diff", "--name-only", base, ref]);
  const g = groupFiles(files);
  const mig = (r: string) =>
    run(["ls-tree", "--name-only", r, "packages/db/migrations-hub/"])
      .map((p) => p.split("/").pop() ?? p)
      .filter((f) => f.endsWith(".sql"));
  const iss = migrationIssues(mig("HEAD"), mig(ref));

  console.log(`ref=${ref} base=${base.slice(0, 8)} · ${commits.length} commit chưa vào HEAD`);
  for (const c of commits) console.log(`  ${c}`);
  console.log(`\nDLC sở hữu (${g.dlc.length} file): không cần báo`);
  console.log(`Chỗ chung (${g.seam.length} file): cần ta xem`);
  for (const f of g.seam) console.log(`  ${f}`);
  console.log(`Khác (${g.other.length} file): ngoài dự kiến`);
  for (const f of g.other) console.log(`  ${f}`);
  console.log("\nMigration hub:");
  if (iss.collisions.length + iss.outOfRange.length === 0) console.log("  OK, không va số");
  for (const c of iss.collisions) console.log(`  VA SỐ: ${c}`);
  for (const f of iss.outOfRange) console.log(`  NGOÀI DẢI ${DLC_HUB_RANGE.join("–")}: ${f}`);
  if (iss.collisions.length) process.exitCode = 1;
}

if (import.meta.main) main();
