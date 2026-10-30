// dlc-dify · git của workspace DLC: một repo mỗi project (`<dir>/<key>/repo`, nhánh `main`), mỗi việc một worktree
// (`<dir>/<key>/wt/<branch>`) tách từ `main`; merge vào `main` TUẦN TỰ (khoá theo project). Gọi `git` của máy chủ.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type GitResult = { code: number; out: string };

export async function git(cwd: string, args: string[]): Promise<GitResult> {
  // Không đổi CRLF theo cấu hình git của máy chủ: repo được git trong container Linux đọc cùng lúc.
  const p = Bun.spawn(["git", "-c", "core.autocrlf=false", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const [out, err] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  const code = await p.exited;
  return { code, out: (out + err).trim() };
}

const must = async (cwd: string, args: string[]) => {
  const r = await git(cwd, args);
  if (r.code !== 0) throw new Error(`git ${args[0]}: ${r.out.slice(0, 500)}`);
  return r.out;
};

export const repoDir = (root: string, key: string) => join(root, key, "repo");
export const worktreeDir = (root: string, key: string, branch: string) =>
  branch === "main" ? repoDir(root, key) : join(root, key, "wt", branch);

const ID = [
  "-c",
  "user.name=DLC",
  "-c",
  "user.email=dlc@ai-system.local",
  "-c",
  "core.autocrlf=false",
];

/** Repo mới (nhánh `main`, commit đầu có README) — đã có ⇒ giữ nguyên. */
export async function initRepo(root: string, key: string, title: string): Promise<boolean> {
  const dir = repoDir(root, key);
  if (existsSync(join(dir, ".git"))) return false;
  mkdirSync(dir, { recursive: true });
  await must(dir, ["init", "-b", "main"]);
  await Bun.write(
    join(dir, "README.md"),
    `# ${title}\n\nRepository managed by the AI-System DLC workspace.\n`,
  );
  await Bun.write(
    join(dir, ".gitignore"),
    "node_modules/\n.venv/\n__pycache__/\ndist/\ncoverage/\n",
  );
  await must(dir, ["add", "-A"]);
  await must(dir, [...ID, "commit", "-m", "chore: init repository"]);
  return true;
}

/** Worktree cho nhánh việc (tạo từ `main` nếu chưa có). `main` ⇒ repo chính. */
export async function ensureWorktree(root: string, key: string, branch: string): Promise<string> {
  const dir = worktreeDir(root, key, branch);
  if (branch === "main" || existsSync(dir)) return dir;
  const repo = repoDir(root, key);
  const has = (await git(repo, ["rev-parse", "--verify", "--quiet", branch])).code === 0;
  await must(
    repo,
    has ? ["worktree", "add", dir, branch] : ["worktree", "add", "-b", branch, dir, "main"],
  );
  return dir;
}

export async function commitAll(
  dir: string,
  message: string,
): Promise<{ committed: boolean; sha: string }> {
  await must(dir, ["add", "-A"]);
  const st = await git(dir, ["status", "--porcelain"]);
  let committed = false;
  if (st.out.trim() !== "") {
    await must(dir, [...ID, "commit", "-m", message.slice(0, 500)]);
    committed = true;
  }
  const sha = (await must(dir, ["rev-parse", "--short", "HEAD"])).trim();
  return { committed, sha };
}

const locks = new Map<string, Promise<unknown>>();
/** Một thao tác merge mỗi project tại một thời điểm. */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const mine = new Promise<void>((r) => {
    release = r;
  });
  locks.set(
    key,
    prev.then(() => mine),
  );
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Merge nhánh việc vào `main` (commit phần dở của nhánh trước). Xung đột ⇒ huỷ merge, trả danh sách file. */
export async function mergeToMain(
  root: string,
  key: string,
  branch: string,
): Promise<{
  ok: boolean;
  sha: string;
  conflicts: string[];
  message: string;
  noChanges?: boolean;
}> {
  return withLock(key, async () => {
    const wt = worktreeDir(root, key, branch);
    if (existsSync(wt)) await commitAll(wt, `wip: ${branch}`);
    const repo = repoDir(root, key);
    // Nhánh không có commit nào mới so với `main` ⇒ bước dev chưa làm gì (hoặc bị cắt giữa chừng): không coi là xong.
    const ahead = (await git(repo, ["rev-list", "--count", `main..${branch}`])).out.trim();
    if (ahead === "0")
      return {
        ok: false,
        sha: "",
        conflicts: [],
        noChanges: true,
        message: `NO CHANGES: branch ${branch} has no commits ahead of main — the task was not implemented (write the files on the branch, then answer done).`,
      };
    const r = await git(repo, [...ID, "merge", "--no-ff", "-m", `merge: ${branch}`, branch]);
    if (r.code !== 0) {
      const files = (await git(repo, ["diff", "--name-only", "--diff-filter=U"])).out
        .split("\n")
        .filter(Boolean);
      await git(repo, ["merge", "--abort"]);
      return { ok: false, sha: "", conflicts: files, message: r.out.slice(0, 2000) };
    }
    const sha = (await must(repo, ["rev-parse", "--short", "HEAD"])).trim();
    return { ok: true, sha, conflicts: [], message: r.out.slice(0, 500) };
  });
}

/** SHA đầy đủ của `main`. */
export async function mainSha(root: string, key: string): Promise<string> {
  return (await must(repoDir(root, key), ["rev-parse", "main"])).trim();
}

/** Bỏ merge bị cổng test từ chối: đưa `main` về commit trước merge (nhánh việc giữ nguyên để dev làm lại). */
export async function resetMain(root: string, key: string, sha: string): Promise<void> {
  await withLock(key, () => must(repoDir(root, key), ["reset", "--hard", sha]));
}

export async function log(dir: string, n = 20): Promise<string> {
  return (await git(dir, ["log", "--oneline", `-${n}`])).out;
}
