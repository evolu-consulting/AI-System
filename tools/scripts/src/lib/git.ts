// ADM-NFR-06 · helper git dùng chung cho CLI trong tools/scripts (T-CLI-1).

function git(args: string[], cwd: string): { ok: boolean; out: string } {
  const p = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, out: p.stdout.toString() };
}

/** Gốc repo theo `cwd` (không theo vị trí file script). Không ở trong repo git → ném lỗi. */
export function repoRoot(cwd: string = process.cwd()): string {
  const r = git(["rev-parse", "--show-toplevel"], cwd);
  if (!r.ok) throw new Error(`Không phải repo git: ${cwd}`);
  return r.out.trim();
}
