// Rebase của `slice:merge` có tự giải conflict `tests/.lock` (file sinh ra — mỗi lát relock nên hay đụng nhau).
// Conflict chỉ ở tests/.lock ⇒ lấy bản upstream, `rebase --continue`; sau rebase xong, gọi `relock` (sinh lại
// từ cây thật) và commit nếu lock đổi. Conflict ở file khác ⇒ dừng như cũ (người gỡ tay).

export const LOCK_FILE = "tests/.lock";
const MAX_STEPS = 200;

export type GitResult = { ok: boolean; out: string };
export type GitFn = (...args: string[]) => GitResult;

export const parseLines = (out: string): string[] =>
  out
    .split("\n")
    .map((l) => l.trim().replace(/\\/g, "/"))
    .filter((l) => l.length > 0);

/** Có conflict và mọi file conflict đều là tests/.lock ⇒ tự giải được. */
export function onlyLockConflicts(unmerged: string[]): boolean {
  return unmerged.length > 0 && unmerged.every((f) => f === LOCK_FILE);
}

export type RebaseOutcome = { ok: boolean; out: string; lockResolved: number };

export function rebaseResolvingLock(git: GitFn, base: string): RebaseOutcome {
  let r = git("rebase", base);
  let lockResolved = 0;
  for (let i = 0; !r.ok && i < MAX_STEPS; i++) {
    const unmerged = parseLines(git("diff", "--name-only", "--diff-filter=U").out);
    if (!onlyLockConflicts(unmerged)) return { ok: false, out: r.out, lockResolved };
    // Khi rebase, "ours" = nhánh đích (upstream); bản lát sẽ được sinh lại sau rebase.
    git("checkout", "--ours", "--", LOCK_FILE);
    git("add", LOCK_FILE);
    lockResolved++;
    r = git("-c", "core.editor=true", "rebase", "--continue");
    // Commit chỉ đổi lock → rỗng sau khi giải: bỏ qua nó.
    if (!r.ok && parseLines(git("diff", "--name-only", "--diff-filter=U").out).length === 0) {
      const s = git("status", "--porcelain").out;
      if (!s.trim()) r = git("-c", "core.editor=true", "rebase", "--skip");
    }
  }
  return { ok: r.ok, out: r.out, lockResolved };
}

/** Cổng sau rebase (hook pre-commit KHÔNG chạy khi rebase ⇒ lỗi ranh giới module lọt, ví dụ D-4). */
export const POST_REBASE_GATES: readonly { name: string; cmd: string[] }[] = [
  { name: "check:boundaries", cmd: ["bun", "tools/scripts/src/check-boundaries.ts"] },
  { name: "check:modules", cmd: ["bun", "tools/scripts/src/check-modules.ts"] },
];

export type GateResult = { ok: true } | { ok: false; gate: string; out: string };

/** Chạy cổng sau rebase; gặp cổng đỏ (vi phạm MỚI) ⇒ dừng ngay, trả tên cổng + đuôi log (≤ 40 dòng, có tên file vi phạm). */
export function postRebaseGates(
  run: (cmd: string[]) => GitResult,
  gates: readonly { name: string; cmd: string[] }[] = POST_REBASE_GATES,
): GateResult {
  for (const g of gates) {
    const r = run(g.cmd);
    if (!r.ok) return { ok: false, gate: g.name, out: r.out.split("\n").slice(-40).join("\n") };
  }
  return { ok: true };
}

/** Sau rebase có tự giải lock: sinh lại lock; có đổi so với HEAD thì commit riêng. Trả lỗi nếu có. */
export function relockAfterRebase(
  git: GitFn,
  relock: () => boolean,
  message = "chore(tests): relock sau rebase (slice:merge tự giải conflict tests/.lock)",
): { committed: boolean; error?: string } {
  if (!relock()) return { committed: false, error: "test:lock:write lỗi" };
  if (!git("status", "--porcelain", "--", LOCK_FILE).out.trim()) return { committed: false };
  git("add", LOCK_FILE);
  const c = git("commit", "-m", message);
  return c.ok ? { committed: true } : { committed: false, error: c.out };
}
