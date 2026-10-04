# Runbook · Hub dev + `done:h1` (H1, task I1)

| Việc | Lệnh | Ghi chú |
|---|---|---|
| Hạ tầng | `docker compose up -d --wait` | Postgres, Redis, Mailpit |
| Env | `.env.local` có khối Hub (`HUB_*`, `HUB_TEST_DATABASE_URL`, `AGENT_RT_TEST_DATABASE_URL`) | chép từ `.env.example` nếu thiếu |
| Dev Hub | `bun run hub:dev` | migrate DB `ai_system` → admin-api `:3001` (dùng lại nếu đang chạy) → user fixture `lan/hoa/an/khoa` (mật khẩu `dev-password-1`, `khoa` bị khoá) qua platform_admin → `hub:seed` → hub-api `:4000` → agent-runtime `fake-cli` (Windows: container `ai-hub-dev-runtime`; Linux/WSL2: `uv` thẳng). Ctrl+C dừng phần script đã bật. In ra `CHAT_CONTRACT_USERS` |
| Xong mốc H1 | `bun run done:h1` | chạy đúng `test-plan H1 §7.1`; bước contract chat tự bật `hub:dev` nếu `:4000`/`:3001` chưa chạy. `--from=N` chạy lại từ bước N (không tính là xong đủ) |

- Python chạy qua `apps/agent-runtime/scripts/run.ts`; URL DB test nằm trong chuỗi lệnh (host `postgres:5432` trong container). Python và TS dùng chung `ai_system_h1_test` → không chạy song song `done:h1` với `test:int` khác.
- Bước "chỉ báo cáo" (`tsc -p tsconfig.tests.json`, `bun run depcruise --all`) không làm đỏ kết quả; đỏ do code Chat/Admin dở → ghi "combine".
- admin-api không lên được hoặc đăng nhập platform_admin lỗi (`SEED_ADMIN_PASSWORD`) → `hub:dev` ghi chú và bỏ fixture, không chặn.
