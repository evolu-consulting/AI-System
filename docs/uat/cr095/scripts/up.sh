#!/usr/bin/env bash
# Chay TRONG container uatapp: dung .env.local, migrate, hub:dev (admin-api+hub-api, fake-cli), seed, build + preview 3 web.
set -uo pipefail
cd /app; mkdir -p "$HOME" /out
git init -q . && git add -A >/dev/null 2>&1 || true
bun -e "const f='package.json',p=JSON.parse(await Bun.file(f).text());delete p.scripts.postinstall;await Bun.write(f,JSON.stringify(p,null,2))"
bun install --frozen-lockfile >/out/install.log 2>&1 || { echo "bun install loi"; tail -n 30 /out/install.log; exit 2; }
sed -e 's#@localhost:5432#@uatpg:5432#g' -e 's#redis://localhost:6379#redis://uatredis:6379#g' .env.example > .env.local
sed -i -e 's#^HUB_NOTIFY_MODE=.*#HUB_NOTIFY_MODE=fake#' -e 's#^SEED_ADMIN_EMAIL=.*#SEED_ADMIN_EMAIL=admin@evolu.local#' .env.local
bun run keys:dev >/out/keys.log 2>&1 || { echo keys loi; exit 2; }
echo "HUB_DEV_CONTRACT_FIXTURE=1" >> .env.local
export HUB_DEV_CONTRACT_FIXTURE=1 HUB_DEV_RUNTIME=none
bun --env-file=.env.local packages/db/src/migrate.ts >/out/migrate.log 2>&1 || { echo migrate loi; tail -20 /out/migrate.log; exit 2; }
bun --env-file=.env.local packages/db/src/seed.ts >>/out/migrate.log 2>&1
bun --env-file=.env.local tools/hub-dev/src/dev.ts >/out/hubdev.log 2>&1 &
for i in $(seq 1 120); do grep -q "sẵn sàng" /out/hubdev.log 2>/dev/null && break; sleep 2; done
grep -q "sẵn sàng" /out/hubdev.log || { echo "hub-dev khong san sang"; tail -30 /out/hubdev.log; exit 2; }
echo "hub-dev OK"
bun --env-file=.env.local /seed.ts >/out/seed.log 2>&1; echo "seed exit $?"
for a in admin-web chat-web contracts-web; do
  bun --env-file=.env.local run --filter @ai/$a build >/out/build-$a.log 2>&1 || { echo "build $a loi"; tail -20 /out/build-$a.log; }
done
export ADMIN_API_URL=http://localhost:3001 HUB_URL=http://localhost:4000 AUTH_URL=http://localhost:3001
(cd apps/admin-web && bun run preview --host 0.0.0.0 --port 3000 >/out/web-admin.log 2>&1 &)
(cd apps/chat-web && bun run preview --host 0.0.0.0 --port 3100 >/out/web-chat.log 2>&1 &)
(cd apps/contracts-web && bun run preview --host 0.0.0.0 --port 3300 >/out/web-contracts.log 2>&1 &)
sleep 3
echo "UAT STACK READY"
wait