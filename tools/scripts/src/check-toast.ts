// CR-125 G3 · `bun run check:toast` (trong `bun run check` + cổng sau rebase của slice:merge): một toast duy nhất (audit #20).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toastIssues } from "./check-toast.rules";
import { git, repoRoot } from "./lib/git";

function main(): number {
  const root = repoRoot();
  const ls = git(["-c", "core.quotePath=false", "ls-files", "--", "apps", "packages"], root);
  if (!ls.ok) throw new Error("check:toast: không đọc được git index");
  const files = new Map<string, string>();
  for (const f of ls.out.split("\n").map((l) => l.trim())) {
    if (!/\.tsx?$/.test(f)) continue;
    try {
      files.set(f, readFileSync(join(root, f), "utf8"));
    } catch {
      // file đã xoá khỏi cây làm việc nhưng còn trong index
    }
  }
  const bad = toastIssues(files);
  if (bad.length === 0) {
    console.log("check:toast OK");
    return 0;
  }
  console.error(`check:toast: ${bad.length} vi phạm — import toast từ @ai/web-kit/ui/toast:`);
  for (const i of bad) console.error(`  ${i.file}:${i.line}  ${i.msg}`);
  return 1;
}

if (import.meta.main) process.exit(main());
