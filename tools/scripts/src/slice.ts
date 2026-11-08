// `bun run slice:new|slice:merge|slice:rm <tên>` — mỗi lát một worktree + nhánh riêng (CLAUDE.md Luật 0b).
//   slice:new <tên> [--force]  kiểm tài nguyên (res:check: từ chối khi đĩa < 15 GB / RAM < 2 GB, `--force` bỏ qua),
//                     tạo worktree `<gốc>/../evolu-wt/<tên>` + nhánh `slice/<tên>` từ platform/gd0, bun install,
//                     chép .env*.local, kiểm hook.
//   slice:merge <tên> [--no-test] [--no-openspec]  openspec:check <tên> (Delta, ADR-0032), rebase lên platform/gd0,
//                     check:boundaries (vi phạm mới ⇒ dừng), test:affected, rồi ff (hoặc merge) vào platform/gd0
//                     ở checkout chính (checkout chính phải đang ở platform/gd0).
//   slice:pool [--size N]  giữ N (mặc định 3) worktree ấm ở `evolu-wt/_pool/<n>` (detached, đã bun install; đĩa < 30 GB ⇒ không dựng);
//                     `slice:new` lấy một cái (worktree move + checkout -b) rồi bổ sung nền không chặn; hết ⇒ dựng bình thường.
//   slice:rm <tên> [--force]       gỡ worktree + xoá nhánh (nhánh chưa merge cần --force).
// Không bao giờ push. Hook: tools/hooks qua core.hooksPath (xem setup-hooks.ts).
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pruneLanes, resolveLane } from "./e2e-lane";
import { collectLocal } from "./res-check";
import { hardLimits } from "./res-check.rules";
import { ensureMergeDriver } from "./setup-merge-driver";
import { cmdPool, spawnRefill, takeFromPool } from "./slice.pool";
import { postRebaseGates, rebaseResolvingLock, relockAfterRebase } from "./slice-rebase";
import { isNotWorktreeError } from "./slice-rm.rules";

const BASE = "platform/gd0";
const POOL_SCRIPT = "tools/scripts/src/slice.ts";

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

/** Khuôn tasks.md của lát (docs/WORKFLOW.md "Mẫu tasks.md"; Delta kiểu OpenSpec, ADR-0032). */
const TASKS_TEMPLATE = (name: string) => `---
id: ${name}
lát: ${name}
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)

## Làm

## Không làm / Chạm

## Test tối thiểu

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Xoá khối mẫu dưới đây rồi điền thật (kiểm bằng \`bun run openspec:check\`). Lát không đổi hành vi: thay bằng
một dòng \`Không thay đổi hành vi (lý do: …)\`.
\`\`\`
### MODIFIED sht/chung-tu.md
#### Yêu cầu: <tên>
<mô tả hành vi mới>
- Kịch bản: khi … thì … [test: <path test> » <tiêu đề test>]  (hoặc [test: thủ công — <lý do>])
(### ADDED <file mới>; ### REMOVED <file> + dòng "Lý do: …")
\`\`\`

## Việc còn lại
`;

function writeTasksTemplate(dir: string, name: string): void {
  const f = join(dir, "docs", "specs", name, "tasks.md");
  if (existsSync(f)) return;
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, TASKS_TEMPLATE(name));
  console.log(`slice: tạo khuôn ${f} (điền Delta trước khi slice:merge)`);
}

/** Cổng tài nguyên (docs/WORKFLOW.md "Kiểm tra tài nguyên…"): đĩa < 15 GB hoặc RAM < 2 GB ⇒ từ chối, trừ `--force`. */
function resourceGate(force: boolean): void {
  let l: ReturnType<typeof collectLocal>;
  try {
    l = collectLocal();
  } catch (e) {
    console.warn(`slice: bỏ qua kiểm tài nguyên (${(e as Error).message})`);
    return;
  }
  if (!l) {
    console.warn("slice: không đo được tài nguyên, bỏ qua kiểm");
    return;
  }
  const hard = hardLimits(l);
  if (hard.length === 0) return;
  const msg = `tài nguyên máy không đủ để tạo worktree mới (${hard.join("; ")}). Dọn worktree đã merge (bun run slice:rm <tên>), xem bun run res:check.`;
  if (!force) fail(`${msg} Bỏ qua bằng --force.`);
  console.warn(`slice: CẢNH BÁO --force: ${msg}`);
}

function cmdNew(name: string | undefined, force: boolean): void {
  const { main, dir, branch } = paths(name);
  if (existsSync(dir)) fail(`đã có ${dir}`);
  resourceGate(force);
  const t0 = Date.now();
  const pooled = takeFromPool(main, dir, branch);
  if (!pooled) {
    const r = git(main, "worktree", "add", "-b", branch, dir, BASE);
    if (!r.ok) fail(r.out);
  }
  copyEnv(main, dir);
  if (!run(dir, ["bun", "install"], true).ok) fail("bun install lỗi");
  verifyHooks(dir);
  ensureMergeDriver(dir);
  writeTasksTemplate(dir, name as string);
  console.log(
    `slice: làn e2e ${resolveLane(dir)} (cổng/DB/Redis riêng, xem docs/WORKFLOW.md "e2e theo làn")`,
  );
  console.log(
    `slice: sẵn sàng ${dir} (nhánh ${branch}, ${((Date.now() - t0) / 1000).toFixed(0)} s${pooled ? ", từ hồ bơi" : ""})`,
  );
  if (pooled)
    spawnRefill(
      main,
      // script của checkout chính bền hơn worktree của lát (có thể bị gỡ), nhưng chỉ khi đã có tính năng hồ bơi
      existsSync(join(main, "tools/scripts/src/slice.pool.ts"))
        ? join(main, POOL_SCRIPT)
        : import.meta.path,
    );
}

/** Rebase lên BASE; conflict code thật ⇒ đã `rebase --abort` + báo file/commit upstream rồi thoát khác 0. */
function rebaseOrFail(dir: string): ReturnType<typeof rebaseResolvingLock> {
  const rb = rebaseResolvingLock(
    (...a) => git(dir, ...a),
    BASE,
    () => run(dir, ["bun", "tools/scripts/src/check-boundaries.ts", "--write"]).ok,
  );
  if (rb.baselineResolved > 0)
    console.log(
      `slice: tự giải ${rb.baselineResolved} conflict baseline ranh giới, sinh lại bằng check-boundaries --write`,
    );
  if (!rb.ok) fail(rb.conflict ?? `rebase lỗi (xem ${dir}, rồi chạy lại):\n${rb.out}`);
  return rb;
}
function cmdMerge(name: string | undefined, noTest: boolean, noOpenspec: boolean): void {
  const { main, dir, branch } = paths(name);
  if (!existsSync(dir)) fail(`chưa có worktree ${dir}`);
  if (git(dir, "status", "--porcelain").out) fail("worktree còn thay đổi chưa commit");
  if (noOpenspec)
    console.warn("slice: CẢNH BÁO --no-openspec: bỏ qua kiểm Delta (chỉ dùng khi khẩn cấp)");
  else if (!run(dir, ["bun", "tools/scripts/src/openspec.ts", "check", name as string], true).ok)
    fail("openspec:check đỏ — sửa Delta trong tasks.md (hoặc --no-openspec khi khẩn cấp)");
  ensureMergeDriver(dir); // locale JSON gộp theo key (git config không nằm trong git)
  const rb = rebaseOrFail(dir);
  if (rb.lockResolved > 0) {
    console.log(
      `slice: tự giải ${rb.lockResolved} conflict tests/.lock, sinh lại bằng test:lock:write`,
    );
    const rl = relockAfterRebase(
      (...a) => git(dir, ...a),
      () => run(dir, ["bun", "tools/scripts/src/test-lock.ts", "write"], true).ok,
    );
    if (rl.error) fail(`relock sau rebase lỗi: ${rl.error}`);
  }
  // Rebase không chạy hook pre-commit ⇒ kiểm ranh giới module sau rebase; vi phạm MỚI ⇒ dừng, in file.
  const gate = postRebaseGates((cmd) => run(dir, cmd));
  if (!gate.ok)
    fail(
      `${gate.gate} đỏ SAU rebase lên ${BASE} (vi phạm MỚI) — sửa trong ${dir}, commit, chạy lại slice:merge:\n${gate.out}`,
    );
  if (
    !noTest &&
    !run(dir, ["bun", "tools/scripts/src/test-affected.ts", `--base=${BASE}`, "--run=all"], true).ok
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
    if (!r.ok && !isNotWorktreeError(r.out))
      fail(`${r.out}\n(thêm --force nếu chắc chắn bỏ thay đổi)`);
  }
  rmSync(dir, { recursive: true, force: true }); // git để lại node_modules (đường dẫn dài/liên kết)
  git(main, "worktree", "prune");
  pruneLanes(); // nhả làn e2e của worktree vừa gỡ
  const b = git(main, "branch", force ? "-D" : "-d", branch);
  console.log(
    b.ok
      ? `slice: đã xoá ${dir} và ${branch}`
      : `slice: đã xoá worktree; giữ nhánh ${branch} (chưa merge? dùng --force)`,
  );
}

const [cmd, name, ...flags] = process.argv.slice(2);
if (cmd === "pool") cmdPool(mainRoot(), [name ?? "", ...flags]);
else if (cmd === "new") cmdNew(name, flags.includes("--force"));
else if (cmd === "merge")
  cmdMerge(name, flags.includes("--no-test"), flags.includes("--no-openspec"));
else if (cmd === "rm") cmdRm(name, flags.includes("--force"));
else fail("dùng: slice new|merge|rm <tên>");
