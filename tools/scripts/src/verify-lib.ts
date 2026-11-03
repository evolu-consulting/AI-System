// I/O dùng chung của verify:* — ssh CHỈ ĐỌC tới máy chủ prod (script qua stdin `bash -s`, không in khoá/đường dẫn khoá) và git.
import { existsSync } from "node:fs";

const SERVER = "evoc@149.202.83.5";
const KEY = "F:\\workspace\\id_evoc_key";
export const PROD_DIR = "~/workspace/sohoptac2";

/** Chạy script bash (chỉ lệnh đọc) trên máy chủ; trả stdout hoặc ném lỗi KHÔNG chứa đường dẫn khoá. */
export function sshRead(script: string, timeoutMs = 45_000): string {
  if (!existsSync(KEY)) throw new Error("không thấy khoá ssh evotest/prod trên máy này");
  const p = Bun.spawnSync(
    ["ssh", "-i", KEY, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", SERVER, "bash -s"],
    {
      stdin: new TextEncoder().encode(script.replaceAll("\r\n", "\n")),
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutMs,
    },
  );
  if (p.exitCode !== 0) throw new Error(`ssh lỗi (mã ${p.exitCode ?? "timeout"})`);
  return p.stdout.toString();
}

export function git(root: string, args: string[]): { ok: boolean; code: number; out: string } {
  const p = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  return { ok: p.exitCode === 0, code: p.exitCode ?? -1, out: p.stdout.toString() };
}

/** Đọc `--k=v` / `--k v`. */
export function opt(argv: readonly string[], k: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`--${k}=`));
  if (eq) return eq.slice(k.length + 3);
  const i = argv.indexOf(`--${k}`);
  const next = i >= 0 ? argv[i + 1] : undefined;
  return next !== undefined && !next.startsWith("--") ? next : undefined;
}
