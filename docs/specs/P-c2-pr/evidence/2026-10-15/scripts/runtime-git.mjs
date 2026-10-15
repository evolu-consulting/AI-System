// Dựng lại container Runtime của hub:dev (cấu hình chép từ `docker inspect` lúc UAT) + GIT_CONFIG_* (fixture C6 insteadOf):
// https://github.com/pc2-uat/app.git -> bare repo /tmp/pc2-origin/app.git trong container. Sau đó chạy origin.sh.
import { execFileSync as x } from "node:child_process";
const N = "ai-hub-dev-runtime";
const env = { ...process.env, MSYS_NO_PATHCONV: "1" };
const E = {
  AGENT_RT_HUB_URL: "http://host.docker.internal:4000", AGENT_RT_WORK_DIR: "/tmp/hub-dev-work", RUNTIME_SANDBOX_HOST_WORKDIR: "/tmp/hub-dev-work",
  APP_ENV: "development", AGENT_RT_DATABASE_URL: "postgres://agent_runtime:agent_runtime_dev_pw@postgres:5432/ai_system", RUNTIME_ENV: "development",
  HUB_SOURCE_LOCAL_ROOTS: "/work", RUNTIME_SANDBOX_IMAGE: "ai-autofix-sandbox:0.1.0", AGENT_RT_PROVIDERS: "fake-cli", RUNTIME_SANDBOX: "docker",
  REDIS_URL: "redis://redis:6379", AGENT_RT_WORKER_ID: "hub-dev", AGENT_RT_LOG_DIR: "/tmp/hub-dev-logs", RUNTIME_SOURCE_CACHE_DIR: "/tmp/hub-dev-srccache",
  HOME: "/tmp/hub-dev-home", PYTHONPATH: (process.env.UAT_SHIM ? "/uat-shim" : ""), GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "url.file:///tmp/pc2-origin/app.git.insteadOf", GIT_CONFIG_VALUE_0: "https://github.com/pc2-uat/app.git",
};
const args = ["run", "-d", "--name", N, "--network", "ai-system_default", "--add-host", "host.docker.internal:host-gateway",
  "-v", "/var/run/docker.sock:/var/run/docker.sock", "-v", "/tmp/hub-dev-work:/tmp/hub-dev-work", "-v", "D:/AI/ai-system:/work",
  "-v", "D:/AI/ai-system/docs/specs/P-c2-pr/evidence/2026-10-15/scripts/shim:/uat-shim:ro", "-v", "ai-system-uv-cache:/root/.cache", "-v", "ai-system-agent-venv:/opt/venv",
  ...Object.entries(E).flatMap(([k, v]) => ["-e", `${k}=${v}`]), "--entrypoint", "sh", "ai-system-uv-git:2",
  "-c", "mkdir -p /tmp/hub-dev-home /tmp/hub-dev-work /tmp/hub-dev-logs /tmp/hub-dev-srccache; (uv sync --frozen 2>/dev/null || uv sync) >/dev/null 2>&1; exec /opt/venv/bin/python -m agent_runtime"];
try { x("docker", ["rm", "-f", N], { env }); } catch {}
console.log(x("docker", args, { encoding: "utf8", env }));
