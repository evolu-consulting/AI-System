// Ghi cấu hình git cho merge driver `i18njson` (git config không nằm trong git nên phải ghi mỗi máy).
// Gọi từ postinstall (setup-hooks.ts) và từ slice:new/slice:merge. Idempotent; `git config` ghi vào
// .git/config chung nên mọi worktree dùng được. Driver chạy ở gốc worktree đang gộp ⇒ đường dẫn tương đối.

export const DRIVER_NAME = "i18njson";
export const DRIVER_CMD = "bun tools/scripts/src/json-merge-driver.ts %O %A %B %P";

type GitFn = (args: string[]) => { ok: boolean; out: string };

function defaultGit(cwd?: string): GitFn {
  return (args) => {
    const p = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    return { ok: p.exitCode === 0, out: p.stdout.toString().trim() };
  };
}

/** Trả true nếu đã ghi/sửa cấu hình, false nếu đã đúng sẵn (hoặc không ở trong repo git). */
export function ensureMergeDriver(
  cwd?: string,
  git: GitFn = defaultGit(cwd),
  cmd = DRIVER_CMD,
): boolean {
  if (!git(["rev-parse", "--git-dir"]).ok) return false;
  const key = `merge.${DRIVER_NAME}.driver`;
  if (git(["config", "--get", key]).out === cmd) return false;
  git(["config", `merge.${DRIVER_NAME}.name`, "Gộp JSON locale i18n theo key"]);
  git(["config", key, cmd]);
  return true;
}

if (import.meta.main && ensureMergeDriver())
  console.log(`setup-merge-driver: merge.${DRIVER_NAME}.driver đã ghi`);
