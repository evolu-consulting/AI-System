import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "../../..");
export const scriptPath = (name: string): string => join(ROOT, "tools/scripts/src", name);

export type Run = { code: number; out: string };

export function run(cmd: string[], cwd: string, env: Record<string, string> = {}): Run {
  const p = Bun.spawnSync(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() };
}

/** Repo git tạm (nhánh main, chưa commit). Trả về đường dẫn tuyệt đối. */
export function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "qc-m0-"));
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: dir });
  writeFiles(dir, files);
  return dir;
}

export function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
}

export function removeRepo(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** n dòng `export const <prefix><i> = 1;`, mỗi dòng kết thúc bằng \n. */
export function codeLines(n: number, prefix = "x"): string {
  return Array.from({ length: n }, (_, i) => `export const ${prefix}${i} = 1;\n`).join("");
}

/** Chờ điều kiện (không sleep cố định); hết hạn thì ném lỗi. */
export async function waitFor(
  cond: () => Promise<boolean>,
  what: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await Bun.sleep(50);
  }
  throw new Error(`Hết ${timeoutMs} ms chờ: ${what}`);
}
