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
# sso-switch: chat-web (app switcher) cần URL contracts-web; contracts-web/admin-web dội về AI System (chat-web) để SSO.
ARG PUBLIC_CONTRACTS_WEB_URL
ARG PUBLIC_SSO_URL
ARG PUBLIC_APP_VERSION=dev
ENV PUBLIC_APP_VERSION=$PUBLIC_APP_VERSION
ENV PUBLIC_HUB_URL=$PUBLIC_HUB_URL PUBLIC_STUDIO_URL=$PUBLIC_STUDIO_URL PUBLIC_CHAT_APP_URL=$PUBLIC_CHAT_APP_URL \
    PUBLIC_ADMIN_WEB_URL=$PUBLIC_ADMIN_WEB_URL PUBLIC_CHAT_WEB_URL=$PUBLIC_CHAT_WEB_URL PUBLIC_AUTH_URL=$PUBLIC_AUTH_URL \
    PUBLIC_CONTRACTS_WEB_URL=$PUBLIC_CONTRACTS_WEB_URL PUBLIC_SSO_URL=$PUBLIC_SSO_URL
# Build từng web riêng (turbo strict env có thể bỏ mất PUBLIC_*).
RUN bun run --cwd apps/contracts-web build && bun run --cwd apps/chat-web build \
 && bun run --cwd apps/admin-web build && bun run --cwd apps/studio-web build \
 && chmod -R a+rX /app

FROM nginx:stable-alpine AS web
COPY --from=app /app/apps/contracts-web/dist /srv/contracts
COPY --from=app /app/apps/admin-web/dist /srv/admin
COPY --from=app /app/apps/chat-web/dist /srv/chat
COPY nginx.conf /etc/nginx/conf.d/default.conf

FROM python:3.12-slim AS filebox
# FileBox riêng: bản sao app của FileBox dùng chung (deploy/prod-sohoptac2/filebox/app.py + fb_core.py + fb_upload.py) + phụ thuộc ghim theo venv của nó.
RUN pip install --no-cache-dir boto3==1.43.110 zstandard==0.25.0 fastapi==0.143.0 uvicorn==0.54.0 pydantic==2.14.0
WORKDIR /srv/filebox
COPY app/deploy/prod-sohoptac2/filebox/app.py app/deploy/prod-sohoptac2/filebox/fb_core.py app/deploy/prod-sohoptac2/filebox/fb_upload.py app/deploy/prod-sohoptac2/filebox/web.html ./
RUN mkdir /data && chmod 1777 /data && chmod -R a+rX /srv/filebox
ENV PYTHONUNBUFFERED=1
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9100", "--workers", "2", "--no-access-log"]

FROM python:3.12-slim AS runtime
RUN pip install --no-cache-dir uv==0.9.5
WORKDIR /rt
COPY app/apps/agent-runtime/ ./
RUN uv sync --frozen --no-dev && chmod -R a+rX /rt
ENV PYTHONUNBUFFERED=1
CMD ["/rt/.venv/bin/python", "-m", "agent_runtime"]
