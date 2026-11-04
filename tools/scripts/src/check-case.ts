// `bun run check:case`: chặn commit khi tracked + staged có hai đường dẫn chỉ khác chữ hoa/thường (lefthook pre-commit).

import { caseCollisions, formatCollisions } from "./check-case.rules";
import { git, repoRoot } from "./lib/git";

/** Tracked (index) ∪ staged thêm/sửa/đổi tên; đường dẫn posix tương đối gốc repo. */
export function collectPaths(root: string): string[] {
  const tracked = git(["-c", "core.quotePath=false", "ls-files"], root);
  const staged = git(
    ["-c", "core.quotePath=false", "diff", "--cached", "--name-only", "--diff-filter=ACR"],
    root,
  );
  if (!tracked.ok || !staged.ok) throw new Error("check:case: không đọc được git index");
  const all = `${tracked.out}\n${staged.out}`.split("\n").map((l) => l.trim());
  return [...new Set(all.filter((l) => l.length > 0))];
}

function main(): number {
  const root = repoRoot();
  const collisions = caseCollisions(collectPaths(root));
  if (collisions.length) {
    console.error(formatCollisions(collisions));
    return 1;
  }
  console.log("check:case OK");
  return 0;
}

if (import.meta.main) process.exit(main());
