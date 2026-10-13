#!/usr/bin/env bash
# Dựng lại container Runtime dev (giống tools/hub-dev/src/dev.ts) + bật nguồn (RUNTIME_SOURCE_CACHE_DIR, HUB_SOURCE_LOCAL_ROOTS)
# mà `hub:dev` hiện KHÔNG đặt (xem REPORT, lỗi Major #1). Dùng: runtime.sh <docker|off|badimage>
export MSYS_NO_PATHCONV=1
MODE=${1:-docker}
NET=ai-system_default
docker rm -f ai-hub-dev-runtime >/dev/null 2>&1
SB=(-e RUNTIME_SANDBOX=docker -e RUNTIME_SANDBOX_HOST_WORKDIR=/tmp/hub-dev-work -e RUNTIME_SANDBOX_IMAGE=ai-autofix-sandbox:0.1.0)
[ "$MODE" = off ] && SB=(-e RUNTIME_SANDBOX=off)
[ "$MODE" = badimage ] && SB=(-e RUNTIME_SANDBOX=docker -e RUNTIME_SANDBOX_HOST_WORKDIR=/tmp/hub-dev-work -e RUNTIME_SANDBOX_IMAGE=ai-autofix-sandbox:khong-co)
docker run -d --name ai-hub-dev-runtime --network $NET --add-host host.docker.internal:host-gateway \
  -v ai-system-uv-cache:/root/.cache -v ai-system-agent-venv:/opt/venv \
  -v /run/host-services/docker.proxy.sock:/var/run/docker.sock -v /tmp/hub-dev-work:/tmp/hub-dev-work \
  -v /run/desktop/mnt/host/d/AI/ai-system:/work -w /work/apps/agent-runtime \
  -e UV_PROJECT_ENVIRONMENT=/opt/venv -e APP_ENV=development -e AGENT_RT_HUB_URL=http://host.docker.internal:4000 \
  -e AGENT_RT_WORK_DIR=/tmp/hub-dev-work -e PYTHONDONTWRITEBYTECODE=1 \
  -e AGENT_RT_DATABASE_URL=postgres://agent_runtime:agent_runtime_dev_pw@postgres:5432/ai_system -e REDIS_URL=redis://redis:6379 \
  -e HOME=/tmp/hub-dev-home -e UV_LINK_MODE=copy -e AGENT_RT_WORKER_ID=hub-dev -e AGENT_RT_PROVIDERS=fake-cli -e AGENT_RT_LOG_DIR=/tmp/hub-dev-logs \
  -e RUNTIME_SOURCE_CACHE_DIR=/tmp/hub-dev-work/src-cache -e HUB_SOURCE_LOCAL_ROOTS=/work/.data -e RUNTIME_ENV=development \
  "${SB[@]}" \
  ai-system-uv-git:2 sh -c 'mkdir -p /tmp/hub-dev-home /tmp/hub-dev-work /tmp/hub-dev-logs; (uv sync --frozen 2>/dev/null || uv sync) >/dev/null 2>&1; exec /opt/venv/bin/python -m agent_runtime' >/dev/null
timeout 120 bash -c 'until docker logs ai-hub-dev-runtime 2>&1 | grep -q runtime.ready; do sleep 2; done'
docker logs ai-hub-dev-runtime 2>&1 | grep -o '"event": "\(sandbox[a-z._]*\|runtime.ready\|resolve.enabled\)"' | tr '\n' ' '; echo
