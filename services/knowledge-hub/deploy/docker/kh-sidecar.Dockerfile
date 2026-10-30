# kh-sidecar: kh-worker with the Claude Code CLI inside, as a separate instance next to any KH (Rowan 2026-10-24).
# The model runs on a Claude subscription token (`claude setup-token` -> CLAUDE_CODE_OAUTH_TOKEN), not an API
# key; the worker signs in to KH as a technical user (KH_WORKER_AUTH=person, see worker/kh_worker/person.py).
#
#   docker build -f deploy/docker/kh-sidecar.Dockerfile -t kh-sidecar:local .      # from Slaves/KnowledgeHub
#   docker compose -f deploy/docker/kh-sidecar.compose.yml --env-file <kh-sidecar.env> up -d
#   docker compose -f deploy/docker/kh-sidecar.compose.yml --env-file <kh-sidecar.env> run --rm kh-sidecar \
#       python -m kh_worker once --job distil                                       # one run now
#
# Secrets come from the environment only. The worker is idle until KH_WORKER_ENABLED=1 and writes nothing
# until KH_WORKER_MODE=on. Lease, spend ledger and run log go to /data: mount a volume there.
# Claude Code needs node >= 22 to install (Debian's own is 18). Its postinstall puts the platform's native
# binary at bin/claude.exe (the package's `bin`). Both stages are Debian bookworm, so the binary matches glibc.
FROM node:22-bookworm-slim AS claude
ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" && npm cache clean --force \
 && claude --version

FROM python:3.12-slim-bookworm
COPY --from=claude /usr/local/bin/node /usr/local/bin/node
COPY --from=claude /usr/local/lib/node_modules/@anthropic-ai /usr/local/lib/node_modules/@anthropic-ai
RUN ln -s /usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe /usr/local/bin/claude \
 && apt-get update && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && claude --version

RUN useradd --create-home --uid 10001 worker && mkdir -p /data && chown worker /data
WORKDIR /app
COPY worker/requirements.txt /tmp/requirements.txt
RUN sed -e 's/\r$//' /tmp/requirements.txt > /tmp/req.txt && pip install --no-cache-dir -r /tmp/req.txt
COPY worker/kh_worker ./kh_worker

# DISABLE_AUTOUPDATER: the CLI version is the image's; rebuild to move it. No telemetry from a headless worker.
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    KH_WORKER_ENABLED=0 KH_WORKER_MODE=dry KH_WORKER_AUTH=person KH_WORKER_LLM=claude_cli \
    KH_WORKER_MODEL=claude-opus-5-5 KH_WORKER_JOBS=distil KH_WORKER_DISTIL_AT=02:00 \
    KH_WORKER_TZ=Asia/Ho_Chi_Minh KH_WORKER_STATE_DIR=/data \
    KH_WORKER_CAP_RUN_USD=3 KH_WORKER_CAP_MONTH_USD=60 KH_WORKER_CAP_BACKFILL_USD=80
USER worker
VOLUME ["/data"]
ENTRYPOINT ["tini", "--"]
CMD ["python", "-m", "kh_worker", "run"]
