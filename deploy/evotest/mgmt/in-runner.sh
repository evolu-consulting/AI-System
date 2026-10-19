#!/usr/bin/env bash
# I1 · chạy TRONG container mgmt-runner (project evotest-mgmt): dựng Postgres đích (migrate + seed + bảng G1 từ ảnh chụp), rồi
# importer trên bản sao seed: dry-run → apply → apply lần 2 (chứng minh idempotent). Báo cáo JSON + thời gian ⇒ /out.
set -uo pipefail
cd /app
mkdir -p "$HOME" /out
git init -q . && git add -A >/dev/null 2>&1 || true
bun -e "const f='package.json',p=JSON.parse(await Bun.file(f).text());delete p.scripts.postinstall;await Bun.write(f,JSON.stringify(p,null,2))"
bun install --frozen-lockfile >/out/setup.log 2>&1 || { echo "bun install lỗi"; tail -n 30 /out/setup.log; exit 2; }
sed -e 's#@localhost:5432#@mgmt-pg:5432#g' .env.example > .env.local
sed -i -e 's#^SEED_ADMIN_EMAIL=.*#SEED_ADMIN_EMAIL=admin@evolu.local#' .env.local
{ bun run keys:dev && bun run db:setup; } >>/out/setup.log 2>&1 || { echo "setup lỗi"; tail -n 30 /out/setup.log; exit 2; }
getent hosts mgmt-opensearch mgmt-neo4j | tr "\n" " "; echo
bun -e "for (const u of ['http://mgmt-opensearch:9200', 'http://mgmt-neo4j:7474']) console.log(u, await fetch(u, { headers: { 'accept-encoding': 'identity' }, signal: AbortSignal.timeout(10000) }).then((r) => r.status, (e) => String(e)))"
ACTOR=$(bun --env-file=.env.local deploy/evotest/mgmt/prep.ts) || { echo "prep lỗi"; exit 2; }
echo "[mgmt] Postgres đích sẵn sàng · actor $ACTOR · org tri thức ${MGMT_KNOWLEDGE_ORG:-(không)}"

export MGMT_OPENSEARCH_URL=http://mgmt-opensearch:9200 MGMT_NEO4J_URL=http://mgmt-neo4j:7474 MGMT_NEO4J_USER=neo4j \
  MGMT_NEO4J_PASSWORD="$MGMT_NEO4J_PW"
CLI=(bun --env-file=.env.local apps/admin-api/src/modules/mgmt-import/mgmt-import.cli.ts --source "$MGMT_SOURCE" --actor "$ACTOR"
  --files-dir /mgmtdata/contract_files --sink-dir /out/sink --diff-sample 30)
[ -n "$MGMT_KNOWLEDGE_ORG" ] && CLI+=(--knowledge-org "$MGMT_KNOWLEDGE_ORG")
rc=0
for step in dry apply rerun; do
  args=(); [ "$step" != dry ] && args=(--apply)
  [ "$step" = apply ] && args+=(--state /out/state.json)
  t0=$(date +%s%N)
  "${CLI[@]}" "${args[@]}" --report "/out/$step.json" >/dev/null 2>"/out/$step.err"; r=$?
  echo "[mgmt] $step: exit $r · $(( ($(date +%s%N) - t0) / 1000000 )) ms"
  [ $r -eq 1 ] && { cat "/out/$step.err"; rc=1; }
done
bun deploy/evotest/mgmt/summary.ts /out/dry.json /out/apply.json /out/rerun.json | tee /out/summary.txt
exit $rc
