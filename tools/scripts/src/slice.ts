// `bun run slice:new|slice:merge|slice:rm <tên>` — mỗi lát một worktree + nhánh riêng (CLAUDE.md Luật 0b).
//   slice:new <tên>   tạo worktree `<gốc>/../evolu-wt/<tên>` + nhánh `slice/<tên>` từ platform/gd0, bun install,
//                     chép .env*.local, kiểm hook.
//   slice:merge <tên> [--no-test]  rebase lên platform/gd0, test:affected, rồi ff (hoặc merge) vào platform/gd0
//                     ở checkout chính (checkout chính phải đang ở platform/gd0).
//   slice:rm <tên> [--force]       gỡ worktree + xoá nhánh (nhánh chưa merge cần --force).
// Không bao giờ push. Hook: tools/hooks qua core.hooksPath (xem setup-hooks.ts).
import { copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const BASE = "platform/gd0";

function run(cwd: string, cmd: string[], inherit = false): { ok: boolean; out: string } {
  const p = Bun.spawnSync(cmd, {
    cwd,
    stdout: inherit ? "inherit" : "pipe",
    stderr: inherit ? "inherit" : "pipe",
  });
  return { ok: p.exitCode === 0, out: inherit ? "" : `${p.stdout}${p.stderr}`.trim() };
}

const git = (cwd: string, ...a: string[]) => run(cwd, ["git", ...a]);

function fail(msg: string): never {
  console.error(`slice: ${msg}`);
  process.exit(1);
}

/** Checkout chính = thư mục chứa `.git` chung (đúng cả khi chạy từ một worktree). */
function mainRoot(): string {
  const r = git(process.cwd(), "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (!r.ok) fail("không ở trong repo git");
  return dirname(resolve(r.out));
}

function paths(name: string | undefined) {
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name))
    fail("tên lát: chữ thường/số/gạch ngang, vd m1-report");
  const main = mainRoot();
  return { main, dir: resolve(main, "..", "evolu-wt", name), branch: `slice/${name}` };
}

function copyEnv(main: string, dir: string): void {
  for (const f of readdirSync(main)) {
    if (f === ".env.local" || /^\.env\..+\.local$/.test(f))
      copyFileSync(join(main, f), join(dir, f));
  }
}

function verifyHooks(dir: string): void {
  const hp = git(dir, "config", "--get", "core.hooksPath").out;
  if (hp !== "tools/hooks" || !existsSync(join(dir, "tools/hooks/pre-commit")))
    fail("hook chưa đúng (core.hooksPath)");
  const r = git(dir, "hook", "run", "--ignore-missing", "pre-commit");
  if (!r.ok) fail(`pre-commit chạy lỗi trong worktree:\n${r.out}`);
  console.log("slice: hook pre-commit OK");
}

function cmdNew(name: string | undefined): void {
  const { main, dir, branch } = paths(name);
  if (existsSync(dir)) fail(`đã có ${dir}`);
  const r = git(main, "worktree", "add", "-b", branch, dir, BASE);
  if (!r.ok) fail(r.out);
  copyEnv(main, dir);
  if (!run(dir, ["bun", "install"], true).ok) fail("bun install lỗi");
  verifyHooks(dir);
  console.log(`slice: sẵn sàng ${dir} (nhánh ${branch})`);
}

function cmdMerge(name: string | undefined, noTest: boolean): void {
  const { main, dir, branch } = paths(name);
  if (!existsSync(dir)) fail(`chưa có worktree ${dir}`);
  if (git(dir, "status", "--porcelain").out) fail("worktree còn thay đổi chưa commit");
  const rb = git(dir, "rebase", BASE);
  if (!rb.ok) fail(`rebase lỗi (gỡ conflict trong ${dir}, rồi chạy lại):\n${rb.out}`);
  if (
    !noTest &&
    !run(dir, ["bun", "tools/scripts/src/test-affected.ts", `--base=${BASE}`], true).ok
  )
    fail("test:affected đỏ — chưa merge");
  const cur = git(main, "rev-parse", "--abbrev-ref", "HEAD").out;
  if (cur !== BASE) fail(`checkout chính đang ở ${cur}, cần ${BASE}`);
  let m = git(main, "merge", "--ff-only", branch);
  if (!m.ok) m = git(main, "merge", "--no-edit", branch);
  if (!m.ok) fail(`merge lỗi:\n${m.out}`);
  console.log(`slice: đã merge ${branch} vào ${BASE}\n${m.out}`);
}

function cmdRm(name: string | undefined, force: boolean): void {
  const { main, dir, branch } = paths(name);
  if (existsSync(dir)) {
    const r = git(main, "worktree", "remove", ...(force ? ["--force"] : []), dir);
    if (!r.ok) fail(`${r.out}\n(thêm --force nếu chắc chắn bỏ thay đổi)`);
  }
  rmSync(dir, { recursive: true, force: true }); // git để lại node_modules (đường dẫn dài/liên kết)
  git(main, "worktree", "prune");
  const b = git(main, "branch", force ? "-D" : "-d", branch);
  console.log(
    b.ok
      ? `slice: đã xoá ${dir} và ${branch}`
      : `slice: đã xoá worktree; giữ nhánh ${branch} (chưa merge? dùng --force)`,
  );
}

const [cmd, name, ...flags] = process.argv.slice(2);
if (cmd === "new") cmdNew(name);
else if (cmd === "merge") cmdMerge(name, flags.includes("--no-test"));
else if (cmd === "rm") cmdRm(name, flags.includes("--force"));
else fail("dùng: slice new|merge|rm <tên>");
