# KnowledgeHub as a local dev container - stands in for the BTP dev app (kh-sso), removed 2026-10-10
# because the org ran out of memory. Same code and model as deploy/btp/push.ps1 stages, but the local
# backends (Chroma, SQLite, Kuzu) on a volume instead of HANA.
#
#   docker build -f deploy/docker/Dockerfile -t kh-dev:local .
#   docker run -d --name kh-dev -p 9100:8000 -v kh-dev-data:/data \
#     -e KH_AUTH_ISSUER=https://kh-keycloak.cfapps.br10.hana.ondemand.com/realms/knowledge-hub kh-dev:local
#
# With KH_AUTH_ISSUER set it accepts the same realm tokens as prod (audience kh-api), so a kh-helper
# token works against it unchanged.
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt /tmp/requirements.txt
# The same rewrite push.ps1 does: CPU-only torch, no system tray (CRs first: the file is CRLF on Windows).
RUN sed -E -e 's/\r$//' -e '/^\s*pystray/d' -e 's/^\s*torch==([^ #+]+).*/torch==\1+cpu/' /tmp/requirements.txt > /tmp/req.txt \
 && pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r /tmp/req.txt

COPY main.py preflight.py VERSION ./
COPY app ./app
COPY seeds ./seeds
COPY models/bge-small-en-v1.5 ./models/bge-small-en-v1.5

ENV PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 KH_PRELOAD_VISION=false \
    CHROMA_PATH=/data/chroma KH_HOOKS_DB=/data/hooks.db KH_PROJECTS_PATH=/data/projects \
    KH_KUZU_PROJECTS_PATH=/data/kuzu
VOLUME /data
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
