// CR-125 c7 · `bun run check:shared-limits` (trong `bun run check` + cổng sau rebase của slice:merge): giới hạn nghiệp vụ một nguồn (audit #13).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { limitIssues, textIssues } from "./check-shared-limits.rules";
import { git, repoRoot } from "./lib/git";
import { readLocaleEntries } from "./lib/locale-files";

function main(): number {
  const root = repoRoot();
  const ls = git(["-c", "core.quotePath=false", "ls-files", "--", "apps"], root);
  if (!ls.ok) throw new Error("check:shared-limits: không đọc được git index");
  const files = new Map<string, string>();
  for (const f of ls.out.split("\n").map((l) => l.trim())) {
    if (!/\.tsx?$/.test(f)) continue;
    try {
      files.set(f, readFileSync(join(root, f), "utf8"));
    } catch {
      // file đã xoá khỏi cây làm việc nhưng còn trong index
    }
  }
  const locale = readLocaleEntries(root).map((e) => ({ file: e.file, key: e.key, value: e.value }));
  const bad = [...limitIssues(files), ...textIssues(locale)];
  if (bad.length === 0) {
    console.log("check:shared-limits OK");
    return 0;
  }
  console.error(
    `check:shared-limits: ${bad.length} vi phạm — dùng hằng của @ai/contracts / {{min}}{{max}}:`,
  );
  for (const i of bad) console.error(`  ${i.file}${i.line ? `:${i.line}` : ""}  ${i.msg}`);
  return 1;
}

if (import.meta.main) process.exit(main());
