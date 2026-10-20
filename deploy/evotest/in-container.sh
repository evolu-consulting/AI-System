#!/usr/bin/env bash
# Chạy TRONG container runner: dựng .env.local trỏ pg/redis của project evotest, cài deps, migrate + seed, chạy test:all --only=$EVO_STEP.
# Log đầy đủ -> /out (tar về máy dev). Thoát bằng mã của test.
set -uo pipefail
cd /app
mkdir -p "$HOME" /out
git init -q . && git add -A >/dev/null 2>&1 || true   # keys:dev cần gốc repo git
# postinstall = `lefthook install` (git hook dev) - bỏ trong bản sao tạm.
bun -e "const f='package.json',p=JSON.parse(await Bun.file(f).text());delete p.scripts.postinstall;await Bun.write(f,JSON.stringify(p,null,2))"
t0=$(date +%s)
bun install --frozen-lockfile >/out/setup.log 2>&1 || { echo "bun install lỗi"; tail -n 40 /out/setup.log; exit 2; }

sed -e 's#@localhost:5432#@pg:5432#g' -e 's#redis://localhost:6379#redis://redis:6379#g' .env.example > .env.local
sed -i -e 's#^SEED_ADMIN_EMAIL=.*#SEED_ADMIN_EMAIL=admin@evolu.local#' -e 's#^HUB_PROCESS_ENGINE=.*#HUB_PROCESS_ENGINE=on#' .env.local
echo "HUB_TEST_REDIS_URL=redis://redis:6379/15" >> .env.local
bun run keys:dev >>/out/setup.log 2>&1 && bun run db:setup >>/out/setup.log 2>&1 || { echo "setup lỗi"; tail -n 40 /out/setup.log; exit 2; }
echo "[evotest] bun $(bun --version) · nproc $(nproc) · setup $(( $(date +%s) - t0 )) s · bước: $EVO_STEP"

# --no-python: Python/agent-runtime ngoài phạm vi runner này.
# EVO_FILTER (chỉ int): tiền tố/đường dẫn file, chạy thẳng test:int:par (bỏ qua test:all) để chạy lại vài file.
if [ "$EVO_STEP" = perf ]; then PERF=1 bun --env-file=.env.local --config=bunfig.perf.toml test --timeout 120000 ${EVO_FILTER:-tests/acceptance/HD4/perf/}   # đo hiệu năng, mặc định HD4
elif [ "$EVO_STEP" = int ] && { [ -n "$EVO_FILTER" ] || [ -n "$EVO_WORKERS" ]; }; then bun run test:int:par ${EVO_WORKERS:+--workers=$EVO_WORKERS} $EVO_FILTER
# EVO_FILTER (e2e): việc/cấu hình test:e2e:par, ngăn bằng dấu phẩy (vd "root,N1") - chạy lại vài việc e2e.
elif [ "$EVO_STEP" = e2e ] && [ -n "$EVO_FILTER" ]; then bun tools/scripts/src/test-e2e-par.ts --no-frozen --only="$EVO_FILTER"; else
  # F1 (CR-095): cổng hằng ngày bỏ suite module đóng băng; EVO_ALL=1 (run-tests.ps1 -All) chạy hết (kiểm tra hằng tháng).
  FZ=--no-frozen; [ -n "${EVO_ALL:-}" ] && FZ=
  bun run test:all --no-python $FZ --only="$EVO_STEP"
fi
rc=$?
mkdir -p /out/logs
[ -d .data ] && cp -r .data/. /out/logs/ 2>/dev/null
exit $rc
