# sohoptac2: một image Bun cho admin-api + hub-api + lệnh migrate/seed (target app), một image nginx phục vụ 4 bản build web
# (target web) và một image Python cho agent-runtime (target runtime). Mã nguồn = ./app (git archive do deploy.ps1 giải nén).
FROM oven/bun:1.3.14 AS app
WORKDIR /app
COPY app/ ./
# postinstall của repo = cài git hook dev (cần git) — bỏ trong image, repo không đổi.
RUN bun -e "const f='package.json',p=JSON.parse(await Bun.file(f).text());delete p.scripts.postinstall;await Bun.write(f,JSON.stringify(p,null,2))" \
 && bun install --frozen-lockfile

# PUBLIC_* nhúng LÚC BUILD (đổi URL/tên miền ⇒ build lại). Module đóng băng giữ mặc định off.
ARG PUBLIC_HUB_URL
ARG PUBLIC_STUDIO_URL
ARG PUBLIC_CHAT_APP_URL
ARG PUBLIC_ADMIN_WEB_URL
ARG PUBLIC_CHAT_WEB_URL
ARG PUBLIC_AUTH_URL=
ENV PUBLIC_HUB_URL=$PUBLIC_HUB_URL PUBLIC_STUDIO_URL=$PUBLIC_STUDIO_URL PUBLIC_CHAT_APP_URL=$PUBLIC_CHAT_APP_URL \
    PUBLIC_ADMIN_WEB_URL=$PUBLIC_ADMIN_WEB_URL PUBLIC_CHAT_WEB_URL=$PUBLIC_CHAT_WEB_URL PUBLIC_AUTH_URL=$PUBLIC_AUTH_URL
# Build từng web riêng (turbo strict env có thể bỏ mất PUBLIC_*).
RUN bun run --cwd apps/contracts-web build && bun run --cwd apps/chat-web build \
 && bun run --cwd apps/admin-web build && bun run --cwd apps/studio-web build \
 && chmod -R a+rX /app

FROM nginx:stable-alpine AS web
COPY --from=app /app/apps/contracts-web/dist /srv/contracts
COPY --from=app /app/apps/admin-web/dist /srv/admin
COPY --from=app /app/apps/chat-web/dist /srv/chat
COPY nginx.conf /etc/nginx/conf.d/default.conf

FROM python:3.12-slim AS runtime
RUN pip install --no-cache-dir uv==0.9.5
WORKDIR /rt
COPY app/apps/agent-runtime/ ./
RUN uv sync --frozen --no-dev && chmod -R a+rX /rt
ENV PYTHONUNBUFFERED=1
CMD ["/rt/.venv/bin/python", "-m", "agent_runtime"]
