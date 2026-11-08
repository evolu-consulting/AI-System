// CR-125 c4 · `bun run check:date-input` (trong `bun run check` + cổng sau rebase của slice:merge): không còn ô ngày gốc của trình duyệt.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nativeDateIssues } from "./check-date-input.rules";
import { git, repoRoot } from "./lib/git";

function main(): number {
  const root = repoRoot();
  const ls = git(["-c", "core.quotePath=false", "ls-files", "--", "apps", "packages"], root);
  if (!ls.ok) throw new Error("check:date-input: không đọc được git index");
  const files = new Map<string, string>();
  for (const f of ls.out.split("\n").map((l) => l.trim())) {
    if (!f.endsWith(".tsx")) continue;
    try {
      files.set(f, readFileSync(join(root, f), "utf8"));
    } catch {
      // file đã xoá khỏi cây làm việc nhưng còn trong index
    }
  }
  const issues = nativeDateIssues(files);
  if (issues.length === 0) {
    console.log("check:date-input OK");
    return 0;
  }
  console.error(
    `check:date-input: ${issues.length} ô ngày gốc — dùng DateInput từ "@ai/web-kit/ui/DateInput" (dd/mm/yyyy):`,
  );
  for (const i of issues) console.error(`  ${i.file}:${i.line}  ${i.text}`);
  return 1;
}

if (import.meta.main) process.exit(main());
