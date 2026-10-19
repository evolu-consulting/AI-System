// `postinstall` của repo: trỏ hook git vào `tools/hooks` (file có trong git) thay vì `lefthook install`.
// Nguyên nhân cũ: `lefthook install` ghi `.git/hooks/pre-commit` (dùng chung mọi worktree) với đường dẫn
// tuyệt đối tới lefthook.exe của checkout vừa chạy `bun install` => cài trong worktree làm hook của
// checkout chính trỏ vào worktree (hỏng khi xoá worktree). `core.hooksPath` tương đối + hook tự tìm
// lefthook trong worktree hiện tại thì cài ở đâu cũng không ảnh hưởng chỗ khác. Idempotent.

const HOOKS_PATH = "tools/hooks";

function git(args: string[]): { ok: boolean; out: string } {
  const p = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, out: p.stdout.toString().trim() };
}

if (git(["rev-parse", "--git-dir"]).ok) {
  if (git(["config", "--get", "core.hooksPath"]).out !== HOOKS_PATH) {
    git(["config", "core.hooksPath", HOOKS_PATH]);
    console.log(`setup-hooks: core.hooksPath=${HOOKS_PATH}`);
  }
}
