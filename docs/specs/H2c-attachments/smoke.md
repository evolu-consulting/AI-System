# H2c · Smoke I2: file đính kèm với `claude-sub` thật (`HUB_LIVE=1`), chạy 2026-10-05

AC-17 (`spec-ac.md`), `test-plan-py.md` §4 SM1–SM3, M01. Người chạy: backend-lead. Không chặn `done:h2c`.

**Phần Dify thật của AC-17 / SM2 / M01: bỏ qua theo yêu cầu người dùng 2026-10-05** (không chạm flow Dify có sẵn; kiểm khi người dùng tích hợp 3 app). Không gọi `GET /parameters`, `/files/upload` hay workflow Dify thật, không đọc `DIFY_LIVE_ENV_FILE`. Đường Hub → Dify `/files/upload` đã được phủ bằng mock (MK-U) ở int B7/B8 và stack S05.

**Môi trường**
- Windows: compose Postgres/Redis. DB **riêng** `ai_system_h2c_smoke_test` (`prepareDb` của `tests/acceptance/H1/_fixtures.ts` = migrate Admin + Hub 0001–0007), Redis DB 12. Dữ liệu: fixture H1 (`insertFixture`, `insertHubConfig`) + agent H2b (`insertH2bAgents`); đổi `assistant` và `writer` sang profile `claude-sub-1`, `writer.runtime_options = {allowed_tools: [Read, Grep, Write]}` (PL9); Orchestrator giữ `fake-1` (các ca đều là run direct `@agent`). Script tạm ở scratchpad (không commit). JWT ký bằng cặp khoá tạm (user `lan`/acme) → `SMOKE_TOKEN`.
- hub-api: `apps/hub-api/src/server.ts` cổng `:4100`, `APP_ENV=development`, `LOG_LEVEL=debug`, `HUB_MAX_CONCURRENT_RUNS=2`, `HUB_ATTACH_DRIVER=local`, `HUB_ATTACH_DIR=<scratchpad tuyệt đối>`, `HUB_INTERNAL_TOKEN` ngẫu nhiên mỗi lần, `HUB_PUBLIC_INTERNAL_URL=http://172.26.0.1:4100` (WSL NAT, `hub-dev.md`).
- agent-runtime: WSL Ubuntu, user `worker`, venv `~/.venvs/agent-runtime`, `uv run --frozen`, `AGENT_RT_PROVIDERS=claude-sub,fake-cli`, `AGENT_RT_HUB_URL=http://172.26.0.1:4100`, work/log ở `~/smoke-h2c`. `claude-agent-sdk` 0.2.163 (CLI bundled), creds `/home/worker/.claude` (subscription đã đăng nhập, `claude.rate_limit status=allowed`).
- Client: `tests/smoke/h2c-live.test.ts` (mới, I2) — `HUB_LIVE=1 HUB_URL=http://localhost:4100 SMOKE_TOKEN=… bun --env-file=.env.local --config=bunfig.stack.toml test --timeout 300000 tests/smoke/h2c-live.test.ts -t "· SMn ·"`, mỗi ca chạy riêng. File mẫu sinh lúc chạy bằng `tests/smoke/_h2c-samples.ts`: PDF 930 B, 2 trang Helvetica ("Page one says: the blue heron sleeps at noon." / "Page two says: seven green lanterns guard the old bridge."), PNG xám 1 998 B chữ bitmap 5×7 phóng 16× "ZEBRA 47" (đã mở xem cả hai trước khi chạy).

## Kết quả

Thời điểm tính từ lúc gửi E12. Token = `hub.usage_logs` (input gồm cache).

| # | Kịch bản | Kết quả | Số đo |
|---|---|---|---|
| SM1 | `@assistant` + `hai-trang.pdf` — "chép nguyên văn câu ở trang 2" | ✅ `run.finished`; câu trả lời = **"Page two says: seven green lanterns guard the old bridge."** (không lẫn trang 1). Runtime `job.attachments_fetched count=1 bytes=930` (R16, sha/size khớp); CLI `Read` 2 lần → `StructuredOutput`; 0 `deny` hook | 16,6 s; 2 delta; token 13 210 / 328 |
| SM2 | `@assistant` + `chu-lon.png` — "trả lời đúng dòng chữ trong ảnh" | ✅ `run.finished`; câu trả lời = **"ZEBRA 47"**. `attachments_fetched count=1 bytes=1998`; `Read` 1 lần → `StructuredOutput`. **Phần Dify thật: bỏ qua** (yêu cầu người dùng) | 11,0 s; 1 delta; token 6 603 / 179 |
| SM3 | `@writer` (allowed_tools ∋ `Write`) — "dùng Write ghi tóm tắt vào out/report.md" | ✅ `run.finished`; job `allowed_tools = [Read, Grep, Write]`, CLI `Write` → `StructuredOutput`, hook **không chặn** (PL9, 0 `deny`); Runtime `job.outputs sent=1 skipped=0` (57 ms) trước `job.result`; Hub hàng `origin=output`, `report.md`, `text/markdown`, 464 B, đã gắn tin assistant (R26); E11 tin assistant `attachments=[report.md]`; `GET /attachments/:id/content` 200, 354 ký tự (markdown tiếng Việt) | 13,1 s; 4 delta; token 7 217 / 464 |

Hub: 3 `attachment_uploaded` (2 upload + 1 output qua `/internal/jobs/:id/outputs`), 2 `attachment-served` (Runtime tải file). Cả 3 job `succeeded`, `resumed=false`.

**Không lộ token/key:** JWT smoke 0 lần trong log hub-api; không chuỗi `Bearer …` nào trong log hub-api; log hub-api 0 dòng `warn`/`error`; `runtime.log` 0 `warning`/`error`; log job chỉ khung sự kiện (không nội dung). `HUB_INTERNAL_TOKEN` sinh ngẫu nhiên trong tiến trình, không ghi ra file. Không có key Dify nào được đọc.

**Ngân sách:** **3 job `claude-sub`** (≤ 6), mỗi job 2–3 lượt model; không chạy lại ca nào.

## Lỗi / phát hiện

| # | Mức | Nơi | Mô tả | Trạng thái |
|---|---|---|---|---|
| F1 | Thấp (test) | `tests/smoke/h2c-live.test.ts` | Bản đầu in `bytes=` cho độ dài `text.length` (ký tự UTF-16; DB ghi 464 byte) | **Đã sửa**: in `chars=` |
| F2 | Thông tin | CLI | SM1: CLI gọi `Read` PDF 2 lần (lần 2 sau ~2,8 s) trước khi trả — không ảnh hưởng kết quả | Ghi nhận |

Không phát hiện lỗi code Hub/Runtime. Không đổi `src/**`.

**Sửa/thêm trong I2:** `tests/smoke/h2c-live.test.ts` (SM1–SM3, gate `HUB_LIVE`, vắng cờ 3 skip; `test:smoke:live` không cờ → exit 0, K12), `tests/smoke/_h2c-samples.ts` (sinh PDF/PNG), `docs/guides/hub-dev.md` (mục smoke H2c + `UPLOAD_FILE_SIZE_LIMIT` K4). Kiểm: `biome check` 2 file, `tsc -p tsconfig.tests.json` 0 lỗi ở `tests/smoke`, `check:size` OK.

**Dọn dẹp:** dừng hub-api (`:4100`) và Runtime WSL (0 tiến trình `agent_runtime`/`_bundled/claude`), xoá `~/smoke-h2c`, `DROP DATABASE ai_system_h2c_smoke_test`, `FLUSHDB` Redis 12, xoá thư mục `HUB_ATTACH_DIR` tạm, file JWT/khoá công khai tạm và log hub-api tạm. Không đụng DB dev `ai_system`, Admin, `apps/chat-web`, Dify.
