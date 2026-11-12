// Luật thuần của release:log — dòng nhật ký bản phát hành trong docs/RELEASES.md.

export const RELEASES_HEADER = [
  "# Nhật ký phát hành",
  "",
  "Mỗi dòng do `bun run release:log --env <staging|prod> --ref <sha>` ghi (deploy/stg-test/push.ps1 gọi cho staging).",
  "",
  "| Ngày | Môi trường | Commit | Migration cuối (admin · hub · packs) | CR từ bản trước | Người |",
  "|---|---|---|---|---|---|",
  "",
].join("\n");

export type Row = {
  date: string;
  env: string;
  sha: string;
  migrations: string;
  crs: string[];
  by: string;
};

/** Số migration lớn nhất theo thư mục từ danh sách đường dẫn (git ls-tree). */
export function lastMigrations(paths: readonly string[]): string {
  const best = new Map<string, number>();
  for (const p of paths) {
    const m =
      /^packages\/db\/(migrations|migrations-hub|migrations-pack-([^/]+))\/(\d+)_[^/]*\.sql$/.exec(
        p,
      );
    if (!m) continue;
    const key =
      m[1] === "migrations" ? "admin" : m[1] === "migrations-hub" ? "hub" : `pack-${m[2]}`;
    best.set(key, Math.max(best.get(key) ?? -1, Number(m[3])));
  }
  const n = (k: string) => (best.has(k) ? String(best.get(k)).padStart(4, "0") : "-");
  const packs = [...best.keys()]
    .filter((k) => k.startsWith("pack-"))
    .sort()
    .map((k) => `${k.slice(5)}:${n(k)}`);
  return `admin ${n("admin")} · hub ${n("hub")} · ${packs.length ? packs.join(" ") : "-"}`;
}

/** CR-xxx duy nhất, giữ thứ tự xuất hiện, trong các tiêu đề commit. */
export function extractCrIds(subjects: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const s of subjects) for (const m of s.matchAll(/\bCR-\d+\b/g)) seen.add(m[0]);
  return [...seen];
}

export function formatRow(r: Row): string {
  const cell = (s: string) => s.replaceAll("|", "/");
  return `| ${r.date} | ${r.env} | ${r.sha} | ${cell(r.migrations)} | ${r.crs.join(", ") || "-"} | ${cell(r.by)} |`;
}

/** Commit của dòng cuối cùng thuộc `env`, hoặc null. */
export function lastShaForEnv(md: string, env: string): string | null {
  let sha: string | null = null;
  for (const l of md.split("\n")) {
    const c = l.split("|").map((x) => x.trim());
    if (c.length >= 4 && c[2] === env && /^[0-9a-f]{7,40}$/.test(c[3] ?? "")) sha = c[3] ?? null;
  }
  return sha;
}

export function appendRow(md: string, row: string): string {
  const base = md.trim() === "" ? RELEASES_HEADER : md;
  return `${base.endsWith("\n") ? base : `${base}\n`}${row}\n`;
}
