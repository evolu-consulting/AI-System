# kh-worker: KH's distil and daily-summary worker (design docs/roadmap-e-to-5-design.md 3.2).
# The same image runs the scheduler (default CMD) or one job:
#
#   docker build -f deploy/docker/worker.Dockerfile -t kh-worker:local .
#   docker run -d --name kh-worker \
#     -e KH_URL=http://host.docker.internal:9102 -e KH_WORKER_ENABLED=1 -e KH_WORKER_MODE=dry \
#     -e KH_WORKER_CLIENT_ID=... -e KH_WORKER_CLIENT_SECRET=... -e ANTHROPIC_API_KEY=... \
#     -e KH_WORKER_PROJECTS=projA,projB -e KH_WORKER_CAP_RUN_USD=1 -e KH_WORKER_CAP_MONTH_USD=5 kh-worker:local
#   docker run --rm --env-file worker.env kh-worker:local python -m kh_worker once --job distil
#
# Secrets come from the environment only, never from this file. Mode defaults to dry and the worker is idle
# until KH_WORKER_ENABLED=1. The claude_cli adapter needs Claude Code, which this image does not ship.
FROM python:3.12-slim

RUN useradd --create-home --uid 10001 worker
WORKDIR /app
COPY worker/requirements.txt /tmp/requirements.txt
RUN sed -e 's/\r$//' /tmp/requirements.txt > /tmp/req.txt && pip install --no-cache-dir -r /tmp/req.txt
COPY worker/kh_worker ./kh_worker

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    KH_WORKER_ENABLED=0 KH_WORKER_MODE=dry KH_WORKER_LLM=anthropic KH_WORKER_MODEL=claude-opus-5-5 \
    KH_WORKER_CAP_RUN_USD=3 KH_WORKER_CAP_MONTH_USD=60 KH_WORKER_CAP_BACKFILL_USD=80
USER worker
CMD ["python", "-m", "kh_worker", "run"]
