// ADM-NFR-06 · helper git dùng chung cho CLI trong tools/scripts (T-CLI-1, T-SIZE-4).

function git(args: string[], cwd: string): { ok: boolean; out: string } {
  const p = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, out: p.stdout.toString() };
}

const lines = (out: string): string[] =>
  out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

/** Gốc repo theo `cwd` (không theo vị trí file script). Không ở trong repo git → ném lỗi. */
export function repoRoot(cwd: string = process.cwd()): string {
  const r = git(["rev-parse", "--show-toplevel"], cwd);
  if (!r.ok) throw new Error(`Không phải repo git: ${cwd}`);
  return r.out.trim();
}

/**
 * Đổi path người dùng đưa (tương đối `cwd` hoặc tuyệt đối) thành path posix tương đối gốc repo.
 * Dùng `--show-prefix` của git thay `path.relative`: trên Windows `cwd` có thể là tên ngắn 8.3
 * (`MSIVN~1`) trong khi `--show-toplevel` trả tên dài.
 */
export function toRepoPath(cwd: string, root: string, p: string): string {
  const posix = p.replace(/\\/g, "/");
  const rootPosix = root.replace(/\\/g, "/");
  if (/^([A-Za-z]:)?\//.test(posix)) {
    return posix.toLowerCase().startsWith(`${rootPosix.toLowerCase()}/`)
      ? posix.slice(rootPosix.length + 1)
      : posix;
  }
  const prefix = git(["rev-parse", "--show-prefix"], cwd).out.trim();
  return `${prefix}${posix.replace(/^\.\//, "")}`;
}

/** Ref có trỏ tới commit không (nhánh `main` chưa có commit → false). */
export function hasRef(ref: string, cwd: string): boolean {
  return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd).ok;
}

/** File tracked + untracked không bị ignore, path posix tương đối gốc repo; lọc theo pathspec nếu có. */
export function listFiles(cwd: string, pathspecs: string[] = []): string[] {
  const args = ["ls-files", "-co", "--exclude-standard", "--full-name"];
  const r = git(pathspecs.length ? [...args, "--", ...pathspecs] : args, cwd);
  return [...new Set(lines(r.out))].sort();
}

/**
 * Tập file đổi theo T-SIZE-4: `main...HEAD` ∪ `HEAD` (staged + worktree) ∪ untracked.
 * Không có `main` hoặc chưa có commit → mọi file tracked + untracked.
 */
export function changedFiles(cwd: string): string[] {
  if (!hasRef("main", cwd) || !hasRef("HEAD", cwd)) return listFiles(cwd);
  const diff = (range: string) =>
    lines(git(["diff", "--name-only", "--diff-filter=ACMR", range], cwd).out);
  const untracked = lines(
    git(["ls-files", "--others", "--exclude-standard", "--full-name"], cwd).out,
  );
  return [...new Set([...diff("main...HEAD"), ...diff("HEAD"), ...untracked])].sort();
}

/** Lọc bỏ path bị .gitignore. */
export function notIgnored(cwd: string, paths: string[]): string[] {
  if (paths.length === 0) return [];
  const p = Bun.spawnSync(["git", "check-ignore", "--stdin"], {
    cwd,
    stdin: new TextEncoder().encode(paths.join("\n")),
    stdout: "pipe",
    stderr: "pipe",
  });
  const ignored = new Set(lines(p.stdout.toString()));
  return paths.filter((f) => !ignored.has(f));
}
