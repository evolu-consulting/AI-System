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
 *  xuất cục bộ (dựng một lần, đổi thẻ khi đổi nội dung). Chỉ nhánh container (Windows/macOS).
 *  R4 (ADR-0011 #1): thêm docker CLI tĩnh (`/usr/local/bin/docker`, chỉ CLI — engine là Docker Desktop
 *  qua socket mount ở `--sandbox`/hub-dev). */
export const GIT_IMAGE = "ai-system-uv-git:2";
const GIT_DOCKERFILE = `FROM docker:29-cli AS cli
FROM ${IMAGE}
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY --from=cli /usr/local/bin/docker /usr/local/bin/docker
`;

/** Ảnh sandbox job tự-sửa (`bun run sandbox:image`, plan-runtime §5.10). */
export const SANDBOX_IMAGE = "ai-autofix-sandbox:0.1.0";
/** Đường dẫn trong VM Docker Desktop, mount CÙNG đường dẫn vào container Runtime ⇒ đường dẫn Runtime
 *  thấy = đường dẫn engine thấy khi `-v <ws>:/workspace` (ADR-0011 Hệ quả "ánh xạ đường dẫn"). */
export const SANDBOX_TMP = "/tmp/ai-sandbox-work";
export const DOCKER_SOCK = "/var/run/docker.sock";

/** Đối số thêm cho `--sandbox` (chỉ dev, test:pc:sandbox): socket engine + thư mục chung + env test. */
export function sandboxArgs(image = SANDBOX_IMAGE): string[] {
  return [
    "-v",
    `${DOCKER_SOCK}:${DOCKER_SOCK}`,
    "-v",
    `${SANDBOX_TMP}:${SANDBOX_TMP}`,
    "-e",
    "RUNTIME_SANDBOX=docker",
    "-e",
    `RUNTIME_SANDBOX_IMAGE=${image}`,
    "-e",
    `PYTEST_ADDOPTS=--basetemp=${SANDBOX_TMP}/pytest`,
  ];
}

export function ensureGitImage(): string {
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

/** `sandbox=true` (`--sandbox`): container thật cho `test:pc:sandbox` — Linux dùng engine host. */
export function run(command: string, sandbox = false): number {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const root = resolve(appDir, "../..");
  let argv = ["sh", "-c", command];
  let env: Record<string, string | undefined> = { ...process.env, MSYS_NO_PATHCONV: "1" };
  if (process.platform !== "linux") {
    argv = ["docker", ...dockerArgs(root.split("\\").join("/"), command, false, ensureGitImage())];
    if (sandbox) argv.splice(2, 0, ...sandboxArgs(process.env.RUNTIME_SANDBOX_IMAGE));
  } else if (sandbox) {
    env = {
      ...env,
      RUNTIME_SANDBOX: process.env.RUNTIME_SANDBOX || "docker",
      RUNTIME_SANDBOX_IMAGE: process.env.RUNTIME_SANDBOX_IMAGE || SANDBOX_IMAGE,
    };
  }
  const p = Bun.spawnSync(argv, { cwd: appDir, stdout: "inherit", stderr: "inherit", env });
  return p.exitCode ?? 1;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const sandbox = args[0] === "--sandbox";
  process.exit(run((sandbox ? args.slice(1) : args).join(" "), sandbox));
}
