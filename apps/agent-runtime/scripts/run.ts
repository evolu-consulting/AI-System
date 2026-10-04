// WRK-NFR-06 · chạy lệnh `uv` của apps/agent-runtime: Linux gọi thẳng, Windows qua container Linux.
// Dùng: bun scripts/run.ts <lệnh shell chạy trong apps/agent-runtime, vd "uv run pytest">
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const IMAGE = "ghcr.io/astral-sh/uv:python3.12-bookworm-slim";
export const NETWORK = "ai-system_default"; // compose.yaml: name ai-system + mạng default
const APP_REL = "apps/agent-runtime";

/** Đối số `docker run` (Windows/macOS): venv và cache uv nằm ngoài thư mục mount. */
export function dockerArgs(repoRoot: string, command: string, tty = false): string[] {
  return [
    "run",
    "--rm",
    ...(tty ? ["-t"] : []),
    "--network",
    NETWORK,
    "-v",
    `${repoRoot}:/work`,
    "-v",
    "ai-system-uv-cache:/root/.cache",
    "-v",
    "ai-system-agent-venv:/opt/venv",
    "-w",
    `/work/${APP_REL}`,
    "-e",
    "UV_PROJECT_ENVIRONMENT=/opt/venv",
    "-e",
    "UV_LINK_MODE=copy",
    "-e",
    "PYTHONDONTWRITEBYTECODE=1",
    "--entrypoint",
    "sh",
    IMAGE,
    "-c",
    command,
  ];
}

export function run(command: string): number {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const root = resolve(appDir, "../..");
  const argv =
    process.platform === "linux"
      ? ["sh", "-c", command]
      : ["docker", ...dockerArgs(root.split("\\").join("/"), command)];
  const p = Bun.spawnSync(argv, {
    cwd: appDir,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
  });
  return p.exitCode ?? 1;
}

if (import.meta.main) process.exit(run(process.argv.slice(2).join(" ")));
