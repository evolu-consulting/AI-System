# H3a · Smoke I2: probe provider subscription với `claude-sub` thật (`HUB_LIVE=1`), chạy 2026-10-06

AC-12 (`spec-ac.md`), `test-plan-py.md` §4 SM1–SM4, M01. Người chạy: backend-lead. Không chặn `done:h3a`.

**Ràng buộc (người dùng):** chỉ `claude-sub` thật; **không chạm Dify**; không `claude logout/login`; không sửa/xoá/chép file credential thật; không in/log nội dung `auth status` hay token; không cố tạo hết quota thật.

**Môi trường**
- Windows: compose Postgres/Redis. DB **riêng** `ai_system_h3a_smoke_test` (test tự `CREATE`, migrate Admin + Hub 0000–0008, chỉ hàng `hub.providers` `claude-sub`), Redis DB 12 (FLUSHDB trước/sau). Không Hub, không job, không agent.
- agent-runtime: WSL Ubuntu, user `worker`, venv `~/.venvs/agent-runtime` (python chạy trực tiếp, `VIRTUAL_ENV` đặt như `uv run`), `claude-agent-sdk` 0.2.163 (CLI bundled), `APP_ENV=development`, `LOG_LEVEL=debug`, `AGENT_RT_PROVIDERS=claude-sub`, `AGENT_RT_PROBE_S=1200`, `AGENT_RT_PROBE_LOGGED_OUT_S=5`. `HOME=~/smoke-h3a/home` có symlink `.claude` → `/home/worker/.claude`, `.claude.json` → `/home/worker/.claude.json` (PL10); "thư mục rỗng" = `~/smoke-h3a/empty/claude-dir` + đường `claude.json` không tồn tại.
- Lệnh: `HUB_LIVE=1 bun --env-file=.env.local --config=bunfig.stack.toml test --timeout 300000 tests/smoke/h3a-live.test.ts` (cả file; test tự dựng + dọn mọi thứ). Tổng 46,7 s.

## Kết quả

Mốc thời gian `t` tính từ lúc spawn Runtime. Token = `probe.result` (`input_tokens` gồm cache, `output_tokens`).

| # | Kịch bản | Kết quả | Số đo |
|---|---|---|---|
| SM1 | Khởi động Runtime (DB chưa có hàng `provider_state`) | ✅ `runtime.ready` t=2,1 s; lượt `startup` (a)+(b) ⇒ `probe.result{outcome:ok, step:turn}` t=15,5 s; `provider_state.status=ok`, `last_probe_at` ≠ NULL; `claude.rate_limit{source:probe, status:allowed_warning, rate_limit_type:seven_day, utilization:0.52}` ⇒ `provider.quota_warning` (1 lần), `status` giữ `ok` (R03) | lượt 13 260 ms; token 393 / 76 |
| SM2 | Symlink → thư mục rỗng, lùi `last_probe_at`/`last_ok_at` 2 h (I2a) | ✅ `probe.result{outcome:logged_out, step:auth, 0 token}` ⇒ `provider.logged_out{source:probe}` + `provider.broken{status:logged_out, queued:0}`; `status=logged_out`. Chỉ (a), 0 lượt model | 9,7 s từ lúc đổi; (a) 5 137 ms |
| SM3 | Chờ thêm 6 s (vòng `logged_out` chỉ (a)) rồi trả symlink | ✅ (a) `loggedIn:true` ⇒ PL11 chạy (b) ⇒ `provider.recovered{from:logged_out}`, `status=ok`; **cùng pid** Runtime, `runtime.ready` đúng 1 lần (không khởi động lại) | 12,4 s từ lúc trả; lượt 13 313 ms; token 393 / 64 |
| SM4 | Quét toàn bộ log Runtime (11 dòng) | ✅ không email, `organization`, `orgId`, `accessToken`, `refreshToken`, "Reply"; dòng `probe.*`/`provider.*`/`claude.*` không có `@`. warn: `provider.quota_warning`, `provider.logged_out`, `provider.broken` (đúng kỳ vọng); 0 `error`, 0 `probe.failed` | — |

**Số đo tầng (ghi `spec-decisions` "Spike S1"):** (a) `auth status` ≈ 5,1 s; (b) lượt haiku ≈ 13,3 − 5,1 ≈ **8,2 s**; `RateLimitEvent` đến ~0,2 s trước `ResultMessage`.

**Rate-limit nhận được (ghi "Spike S2"):** `status=allowed_warning`, `rate_limit_type=seven_day`, `utilization=0.52`, `resets_at` int (~3,5 ngày sau); khoá `raw`: `status, resetsAt, rateLimitType, utilization, isUsingOverage, unifiedWindows`. `rejected` thật: **chưa gặp** (không cố tạo).

**Ngân sách:** **2 lượt haiku thật** (SM1, SM3 — đúng mục tiêu, không chạy lại ca nào). Chi phí: probe không log `total_cost_usd`; quy đổi theo tỷ lệ giá đo ở Spike S1 #8 ≈ 0,0007–0,0008 USD/lượt (≈ 0,0015 USD tổng, trừ vào hạn mức gói). (a) miễn phí.

## Lỗi / phát hiện

| # | Mức | Nơi | Mô tả | Trạng thái |
|---|---|---|---|---|
| F1 | Thông tin | provider thật | Tài khoản đang `allowed_warning` cửa sổ `seven_day` (0,52) ngay khi probe haiku ⇒ R03 chạy thật: `provider.quota_warning` 1 lần cho 2 lượt cùng `resets_at`, `status` vẫn `ok` | Ghi nhận (S2) |
| F2 | Thông tin | probe (b) | Token vào 393 (gồm cache) — thấp hơn nhiều Spike S1 #8 (4 211); chưa tra nguyên nhân (khác `probe_options`?) — chỉ ảnh hưởng ước tính chi phí theo hướng rẻ hơn | Ghi nhận |
| F3 | Thông tin | probe log | `probe.result` không có tách thời gian (a)/(b) và không có `total_cost_usd` — số (b) suy ra từ hiệu với lượt chỉ (a) | Ghi nhận (không cần đổi) |

Không phát hiện lỗi code Runtime. Không đổi `src/**`.

**Sửa/thêm trong I2:** `tests/smoke/h3a-live.test.ts` (SM1–SM4, gate `HUB_LIVE`, vắng cờ → skip; tự dựng/dọn DB, Redis DB 12, `HOME` tạm, Runtime WSL; `afterAll` luôn trả symlink rồi dừng Runtime; sau lần chạy tách thân ca thành hàm `sm1`–`sm4` cho `describe` ≤ 50 dòng — chỉ dời mã, không chạy lại để giữ 2 lượt model; vắng cờ 4 skip, `tsc`/`biome` sạch), `docs/guides/hub-dev.md` (mục "Provider subscription"), `spec-decisions.md` (S1 số đo, S2, I2a).

**Dọn dẹp (đã kiểm sau chạy):** Runtime dừng (0 tiến trình `agent_runtime`/`_bundled/claude`), `~/smoke-h3a` đã xoá (chỉ symlink — đích thật không bị đụng: `~/.claude` vẫn là thư mục, `~/.claude.json` vẫn là file thường `-rw-------`), `DROP DATABASE ai_system_h3a_smoke_test` (0 hàng `pg_database`), Redis DB 12 `dbsize=0`. Không đụng DB dev `ai_system`, Admin, `apps/chat-web`, Dify.
