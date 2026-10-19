# Image runner của project evotest. Mã nguồn KHÔNG nằm trong image (gắn ./app); chỉ có Bun đúng bản repo + git.
# target runner = unit/int; target e2e = thêm trình duyệt Playwright (bản khớp @playwright/test trong bun.lock).
FROM oven/bun:1.3.14 AS runner
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

FROM mcr.microsoft.com/playwright:v1.63.0-noble AS e2e
COPY --from=oven/bun:1.3.14 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx; apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
