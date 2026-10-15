# Hub UAT: hub-api + shim sweep (BUG2). Chạy từ gốc repo, sau khi dừng hub-api của hub:dev.
cd /d/AI/ai-system && mkdir -p .data/uat-attach
APP_ENV=development HUB_PORT=4000 HUB_PUBLIC_INTERNAL_URL=http://host.docker.internal:4000 HUB_MAX_CONCURRENT_RUNS=20 HUB_ATTACH_DRIVER=local HUB_ATTACH_DIR=D:/AI/ai-system/.data/uat-attach HUB_GITHUB_API_URL=http://127.0.0.1:4041 HUB_GITHUB_WEB_HOST=github.com HUB_PROCESS_ENGINE=on HUB_CORS_ORIGINS=http://localhost:3100,http://localhost:3000 \
  exec bun --env-file=.env.local ./docs/specs/P-c2-pr/evidence/2026-10-15/scripts/uat-server.ts
