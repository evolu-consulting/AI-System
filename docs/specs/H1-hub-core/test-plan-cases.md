# Test plan · H1-hub-core · phụ lục ca bổ sung (qc)

Phụ lục của [`test-plan.md`](test-plan.md) (quy ước, loại, vị trí, dữ liệu: §1–§2 ở đó). Ca thêm theo **readiness lần 1** và sửa theo **lần 2** (2026-10-04, người dùng chấp nhận toàn bộ mặc định). Cột `#` = mục readiness.

## 1. Ca mới

| ID | # | Mã | File | Given/When → Then |
|---|---|---|---|---|
| R15a | 5 | HUB-FR-42 · H1-R12 | `rules/runs.test.ts` | `parseLastEventId("7", undefined)` → 7; `(undefined, "5")` → 5; `(undefined, undefined)` → 0 |
| R15b | 5 | H1-R12 | `rules/runs.test.ts` | header ưu tiên: `("7", "3")` → 7; header sai định dạng không rơi về query: `("abc", "3")` → 0 |
| R15c | 5 | H1-R12 | `rules/runs.test.ts` | sai định dạng → 0: `""`, `"abc"`, `"1.5"`, `"1e3"`, `" 4"`, `"4-0"`, `"0x10"` |
| R15d | 5 · 34 | H1-R12 | `rules/runs.test.ts` | âm `"-1"` → 0; `"0"` → 0; rất lớn `"9007199254740993"`, `"99999999999999999999"` → 0 (vượt `Number.MAX_SAFE_INTEGER`); `"9007199254740991"` → 9007199254740991 (16 chữ số, `Number.MAX_SAFE_INTEGER`, đúng plan §6.4) |
| A37b | 1 · 37 | §3.5 · E8 · E9 | `concurrency.int.test.ts` | Runtime kịch bản (test đóng vai Runtime) **giữ job, không trả kết quả suốt ca** (run không tự kết thúc trước E9). 50 vòng: E12 (gửi tin) ∥ E8 (đổi tên) ∥ E9 (xoá) cùng hội thoại (mã theo C1 plan §2.4): `pg_stat_database.deadlocks` không tăng; mỗi vòng hoặc E12 201 rồi xoá huỷ run (`run.failed CANCELLED`), hoặc E12 404 không tạo `messages`/`runs`; không còn dòng mồ côi `flows`/`runs` của hội thoại đã xoá |
| A54 | 3 · 36 | §5.2, §5.7 · H1-R12 | `lease.int.test.ts` | Instance A giữ run (`owner`=A); test lùi `runs.lease_until` về quá khứ bằng SQL ngay trước lượt quét → sweeper của B chiếm run ∥ A nhận `job.result` cuối (`succeeded`, Runtime kịch bản gửi) → đúng **một** sự kiện kết thúc trong `sse:<id>` (đếm `run.finished`+`run.failed` = 1), `runs.status` khớp; bên thua không XADD (UPDATE `WHERE status='running' AND owner=$me` 0 dòng). Tách khỏi A38 (A38: huỷ ∥ sweeper ∥ kết thúc, không lùi lease); không gộp |
| A55 | 3 | HUB-FR-43 · AC-H06 · H1-R14 | `cancel.int.test.ts` | run chủ A, E15 gửi tới B (không phải chủ) ∥ A đang XADD `delta` → SSE ở A và B đều kết thúc bằng đúng 1 `run.failed` `CANCELLED`, `seq` liên tục không trùng (B gặp lỗi id → `XREVRANGE` + thử lại ≤ 3); E15 lần 2 ở A → 200, không sự kiện mới |
| A56a | 4 | HUB-BR-04 · AC-10 | `orchestrator.int.test.ts` | Runtime kịch bản `job.failed` `message` = `"claude-sub-1 assistant /home/worker/work/<job>/x stacktrace"` × {TIMEOUT, UPSTREAM_ERROR, INTERNAL_ERROR, ALL_PROVIDERS_EXHAUSTED} → `run.failed` (SSE + E11) không chứa `claude-sub`, `assistant`, `/home/`, `work/`, `stacktrace`; bản gốc có trong `run_steps.detail` |
| A56b | 4 · 35 | HUB-BR-04 · C1-R04 | `orchestrator.int.test.ts` | cùng `code` ở `locale=vi` và `en` → `message`/`hint` đúng nguyên văn bảng lỗi vi/en (plan §6.4 hoặc `plan-errors.md` — trỏ, không chép; `modules/runs/run-errors.ts`); 2 run cùng `code` khác nội dung gốc → giống nhau; vi ≠ en; `message` không rỗng; `hint` **luôn là string**, `""` khi bảng không có hint (không `null`/thiếu trường) |
| A57 | 19 | HUB-FR-03 | `orchestrator.int.test.ts` | `HUB_CONFIG_POLL_S=1`, đổi `agents.enabled` bằng SQL **không** NOTIFY → run mới ≤ 3 s thấy thay đổi (A25 phủ nhánh NOTIFY) |
| P45a | 12 | WRK-FR-03 · Q-T8 | `test_session_int_test.py` | Orchestrator `fake-cli`, prompt có `<agents>`, `<history>` với chuỗi mồi `SECRET-AGENTS-1`, `SECRET-HIST-1`, `<message>xin chào</message>` → `result.text` = `"echo: xin chào"` + câu cố định; không chứa chuỗi mồi, `<agents>`, `<history>` |
| P45b | 12 | K-R1 · H1-R09 | `orchestrator.int.test.ts` (A) + `fake-cli` (P) | phần cố định ≥ 120 ký tự ⇒ `content` ≥ 120 ký tự ⇒ ≥ 3 `delta` (≤ 40/phần); E11 `content` không chứa `<agents>`/history |

**Dùng env/chỉ thị đã chốt (#19, giao PY-09/B3/PY-13):** P19 gọi tool qua `#fake:tool=<name>` (hook thật, không còn nhánh unit backend) · A57 dùng `HUB_CONFIG_POLL_S` (mặc định 60) · P43 đặt `AGENT_RT_CLEANUP_S=1` (mặc định 3600), log/`work` lùi `mtime` rồi chờ điều kiện.

## 2. Ca `blocked (chờ W0)`

Chờ task W0 (người dùng: WSL2 + đăng nhập `claude` dưới `worker`, đồng ý dùng quota). Ngày 2026-10-04 người dùng trả lời **"chưa"** → dời sang I2 cuối H1. Không viết ca tự động thay thế bằng CLI thật; mọi test tự động dùng `fake-cli` hoặc SDK giả (monkeypatch `ClaudeSDKClient`).

| Ca | Mã | Trạng thái | Thay thế tạm |
|---|---|---|---|
| Spike PY-02 ([CX] SDK, `disallowed_tools`, token cache) | WRK-FR-10 | blocked (chờ W0) | PY-08 + P* dùng SDK giả |
| M1 smoke 7 bước (§2.1) | HUB-H1-AC-02 | blocked (chờ W0), chạy ở I2 | S1–S4 với `fake-cli` |

### 2.1 Smoke thủ công (người dùng, WSL2) — HUB-H1-AC-02 (M1)
1. `claude` đăng nhập dưới `worker` (có `~/.claude/.credentials.json`). 2. `pg_isready -h localhost`, `redis-cli ping`. 3. `HUB_SEED_PROFILE=claude-sub-1 bun run hub:seed`, `systemctl start ai-worker`, hub-api `HUB_LIVE=1`. 4. `curl -N` POST "Xin chào" → `run.started…run.finished`, `content` không rỗng, không key `agent`/`provider`. 5. `usage_logs` có dòng `claude-sub`, token > 0. 6. Huỷ run dài → ≤ 5 s, `ps -eo pgid,cmd` hết CLI. 7. Bảo agent đọc `../../.claude/.credentials.json` → bị từ chối. Ghi kết quả vào spec §9.

## 3. Tranh chấp tiềm năng — contract chat với Hub thật (cho phiên Chat; Hub không sửa test khoá)

| Ca K | Có thể lệch vì | Gợi ý |
|---|---|---|
| K-A1…A7 (`/auth/*` ở admin-api) | thuộc tính cookie `ai_rt`, refresh extension (`X-Client`), `ACCOUNT_LOCKED` cho `khoa`, chính sách mật khẩu `dev-password-1`, khoá tài khoản sau nhiều lần sai (K-A2 sai mật khẩu `lan`) | user fixture qua `tools/`, mật khẩu hợp lệ trong `CHAT_CONTRACT_USERS`; lệch thật → "Tranh chấp test" C1 |
| K-A6 `/health` | phải là `HealthResponseSchema` chat | A3 |
| K-I1…I4 | `#scn:slow` là text thường → run xong nhanh; I4 chỉ đòi `≠ cancelled` | nên xanh |
| K-R1, R2 | cần ≥ 5 sự kiện | echo ≥ 120 ký tự ⇒ ≥ 3 `delta` (P45b) |
| K-S2 | key cấm xanh nhưng `content` có thể lộ agent | P45a, A56a |
| `describe.if(isMock/inProcess)` | tự bỏ ở Hub thật | — |

## 4. Không phủ (đủ) ở H1
HUB-FR-31 fallback nhiều bước → H2 (Q-T6) · HUB-FR-02 command/workflow/feature/quota → H2/H3 · HUB-FR-60/61 CRUD Studio → H4 (H1 qua seed) · AC-H08 `/runs/:id/trace` → H3 · AC-H09 "cấp ≤ 5 s qua API" → H3 · AC-H13, AC-W02, AC-W07 dự phòng sang API → H2/H3 (H1 kết thúc `ALL_PROVIDERS_EXHAUSTED`) · AC-W09 `billable_usd`/`price_book`, HUB-FR-83 `overage` → H3 · HUB-NFR-03 bộ đếm quota Redis → H3 · WRK-FR-03 `delta` từ Runtime (P6: Hub cắt) · WRK-FR-10 SDK thật chỉ thủ công · AC-W06 (`workflow.async` đưa lại queue) không thuộc H1 — thay bằng HUB-H1-AC-04.
