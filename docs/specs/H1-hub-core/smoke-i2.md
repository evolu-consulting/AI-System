# H1 · Smoke I2 chạy thật — HUB-H1-AC-02 (M1) · 2026-10-04

Phụ lục của `test-plan-cases.md` §2.1. Người chạy: backend-lead (phiên điều phối). Cách dựng: `docs/guides/hub-dev.md` mục "Runtime trong WSL với `claude-sub`".

**Môi trường:** Windows: compose Postgres/Redis, `HUB_DEV_RUNTIME=none HUB_SEED_PROFILE=claude-sub-1 bun run hub:dev` (migrate → admin-api `:3001` → fixture → seed → hub-api `:4000`). WSL Ubuntu (interop tắt), user `worker`: `uv run --frozen python -m agent_runtime`, `APP_ENV=development`, `AGENT_RT_PROVIDERS=claude-sub`, role `agent_runtime`, Redis `localhost`, work/log `/home/worker/smoke-i2/{work,logs}`, CLI đóng gói SDK 0.2.163 (2.1.286), model `claude-opus-5-5`. **DB: dev `ai_system`** (không tạo DB riêng; không xoá gì — chỉ thêm hội thoại smoke, `hub:seed` đổi profile agent sang `claude-sub-1`, thêm `lan` vào group `beta-testers` của `acme`). Client: script Bun gọi HTTP/SSE trực tiếp (user fixture `acme/lan`).

## Kết quả 7 bước

| # | Bước | Kết quả | Số đo |
|---|---|---|---|
| 1 | Đăng nhập admin-api, tạo hội thoại | ✅ 200 / 201 | login 77 ms |
| 2 | Orchestrator tự trả lời ("Xin chào…") | ✅ `run.started → step.started/finished → delta → run.finished`, `content` không rỗng | 13,9 s; 1 job |
| 3 | Delegate tới `assistant` (thơ 4 câu) | ✅ 2 step ("Đang phân tích yêu cầu…", "Đang xử lý…"), `run.finished` | 19,9 s; 2 job (~10 s/job) |
| 4 | Contract SSE: không key `agent`/`provider`/`model`/`usage`, mọi khung có `id` | ✅ ở cả 9 lượt (deep-key check) | — |
| 5 | Nối lại `GET /runs/:id/events` + `Last-Event-ID` | ✅ 200, trả đúng phần đuôi sau id (so khớp từng id) | 2 lần (run orch 11 sự kiện, run delegate 10) |
| 6 | Huỷ run đang chạy (job `assistant`, CLI đang sống) | ✅ (sau sửa F1) E15 200 → `run.failed CANCELLED`, stream đóng 41 ms; `ps` không còn `claude` (kể cả zombie) sau 215 ms; job `cancelled`, `finished_at − cancel_requested_at` = 0,06 s | lần 1 (trước sửa): CLI chết nhưng còn `[claude] <defunct>` (ppid = Runtime) > 30 s |
| 7 | Tin 2 cùng flow resume session | ✅ job `assistant` thứ 2 (cwd khác) dùng lại session `cli_sessions` (1 dòng/hội thoại); transcript `~/.claude/projects/<cwd job 1>/<session>.jsonl` chứa cả 2 lượt user; cache_read 2.431 → 3.092 | 21,8 s; Orchestrator `use_session=false` (đúng thiết kế) |
| + | `usage_logs` | ✅ 13 dòng `claude-sub`, `model=claude-opus-5-5` (S9 đúng, không ra haiku), `billing=subscription`, `cost_usd=0`, token > 0 | — |
| + | `provider_state` | ✅ không có dòng (= `ok` theo LEFT JOIN, `consecutive_errors` 0); `is_error` không tính lỗi Provider (đúng `outcome.py`) | — |
| + | S1: `@/home/worker/.claude/.credentials.json` (2 lần: hỏi thẳng, và "giao cho Trợ lý dùng Read") | ✅ không lộ (`accessToken/refreshToken/sk-ant-/claudeAiOauth` không xuất hiện trong SSE); Orchestrator kết thúc `is_error`, 0 token output (nhiều khả năng API từ chối) → `run.failed UPSTREAM_ERROR`; không tới được agent. Mức agent đã xác minh ở `spike-py02.md` (`prod-at-file`) | 10,3–11,4 s |

**Lượt gọi Claude: 15 job CLI** (13 có `usage_logs`, 2 job `assistant` bị huỷ không ghi usage). Token (13 dòng): input 23.779 · output 8.971 · cache read 13.709 · cache write 10.038. Một lượt Orchestrator ≈ 1,1–1,4K input, ~10 s.

## Lỗi / phát hiện

| # | Mức | File | Mô tả | Trạng thái |
|---|---|---|---|---|
| F1 | Thường (AC-W03 "không còn process"; zombie không chạy nhưng vẫn hiện `ps`) | `apps/agent-runtime/src/agent_runtime/sandbox/process.py` `kill_group` | Huỷ job thật: CLI `claude` thành zombie **sau** lần `reap()` duy nhất (cháu về subreaper Runtime) → `<defunct>` tồn tại tới lần huỷ kế | ✅ sửa: `_reap_settle` thu lại mỗi 100 ms tới khi không còn pid của job là con Runtime (≤ 1,5 s). Đo lại: hết trong 215 ms |
| F2 | Thấp | `runtimes/cli/runner.py` | `session_resumed` chỉ đi qua stream Redis (bị xoá sau run), Hub không lưu → không kiểm được sau run | ✅ thêm `resumed` vào log `job.finished` |
| F3 | Thường | `tools/hub-dev/src/fixture.ts` (+ `apps/hub-api/seed/access.yaml`) | Grant `assistant` chỉ cho group `beta-testers`; fixture user `lan/hoa` không thuộc group → `<agents>[]`, Orchestrator tự trả lời "không có agent Trợ lý" | Chưa sửa (đổi dữ liệu fixture có thể ảnh hưởng bộ contract chat) — smoke thêm `lan` vào group qua admin-api. Đề xuất: fixture thêm `lan` vào `beta-testers` |
| F4 | Thấp (UX) | `runtimes/cli/outcome.py` `PROVIDER_ERROR` / Hub map lỗi | Result `subtype=success, is_error=true`, 0 token output (từ chối) → `UPSTREAM_ERROR` "Dịch vụ AI trả lỗi… Thử lại" — gợi ý thử lại sai | Ghi cho task sau (cần xác minh chữ result; mã lỗi mới = đổi contract) |
| F5 | Thấp | Runtime finish (huỷ) | Job huỷ giữa chừng không ghi `usage_logs` dù đã tốn token | Ghi cho task sau (đối chiếu BA quota) |
| F6 | Thấp (hiệu năng) | Hub runner (Orchestrator `answer`) | Orchestrator tự trả lời dài → `delta` chỉ tới khi job xong (bài 1.500 từ: 72 s chờ) | Ghi nhận; thiết kế H1 (structured output) |
| F7 | Tài liệu | `test-plan-cases.md` §2.1 | `HUB_LIVE=1` không được code nào đọc; `systemctl start ai-worker` thay bằng chạy tay trong WSL | Ghi ở runbook |
