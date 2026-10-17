# Runner spike ADR-0017: mã nguồn evolu-platform (git archive do run-spike.ps1 giải nén vào ./app) + Bun đúng bản repo.
FROM oven/bun:1.3.14
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY app/ ./
# postinstall = `lefthook install` (git hook dev) — bỏ trong image.
RUN bun -e "const f='package.json',p=JSON.parse(await Bun.file(f).text());delete p.scripts.postinstall;await Bun.write(f,JSON.stringify(p,null,2))" \
 && bun install --frozen-lockfile
COPY run-spike.sh /run-spike.sh
ENTRYPOINT ["bash", "/run-spike.sh"]
