// WRK-NFR-06 · chạy lệnh `uv` của apps/agent-runtime: Linux gọi thẳng, Windows qua container Linux.
// Dùng: bun scripts/run.ts <lệnh shell chạy trong apps/agent-runtime, vd "uv run pytest">
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const IMAGE = "ghcr.io/astral-sh/uv:python3.12-bookworm-slim";
export const NETWORK = "ai-system_default"; // compose.yaml: name ai-system + mạng default
const APP_REL = "apps/agent-runtime";

/** Đối số `docker run` (Windows/macOS): venv và cache uv nằm ngoài thư mục mount. */
export function dockerArgs(
  repoRoot: string,
  command: string,
  tty = false,
  image = IMAGE,
): string[] {
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
    image,
    "-c",
    command,
  ];
}

/** P-c1 (WRK-FR-29): `autofix/workspace` cần `git` trên host Runtime — ảnh uv không có ⇒ ảnh dẫn
 *  xuất cục bộ (dựng một lần, đổi thẻ khi đổi nội dung). Chỉ nhánh container (Windows/macOS). */
export const GIT_IMAGE = "ai-system-uv-git:1";
const GIT_DOCKERFILE = `FROM ${IMAGE}
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends git && rm -rf /var/lib/apt/lists/*
`;

function ensureGitImage(): string {
  const has = Bun.spawnSync(["docker", "image", "inspect", GIT_IMAGE], {
    stdout: "ignore",
    stderr: "ignore",
  });
  if (has.exitCode === 0) return GIT_IMAGE;
  const built = Bun.spawnSync(["docker", "build", "-q", "-t", GIT_IMAGE, "-"], {
    stdin: new TextEncoder().encode(GIT_DOCKERFILE),
    stdout: "ignore",
    stderr: "inherit",
  });
  return built.exitCode === 0 ? GIT_IMAGE : IMAGE; // dựng lỗi ⇒ ảnh gốc (test git sẽ đỏ rõ ràng)
}

export function run(command: string): number {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const root = resolve(appDir, "../..");
  const argv =
    process.platform === "linux"
      ? ["sh", "-c", command]
      : ["docker", ...dockerArgs(root.split("\\").join("/"), command, false, ensureGitImage())];
  const p = Bun.spawnSync(argv, {
    cwd: appDir,
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
  });
  return p.exitCode ?? 1;
}

if (import.meta.main) process.exit(run(process.argv.slice(2).join(" ")));
