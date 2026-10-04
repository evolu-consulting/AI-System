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
| R16 | 47 | HUB-BR-04 · C1-R04 | `rules/run-errors.test.ts` | `runErrorText(code, locale)` (`plan-errors.md`): đủ 7 mã × {vi, en} = 14 cặp `{message, hint}` khớp **nguyên văn** bảng (kể cả dấu chấm); `CANCELLED` có `hint === ""` ở cả 2 locale; mọi `message` dài 1–500 ký tự (`CHAT_ERROR_TEXT_MAX`); `hint` luôn là string |
| A56a | 4 | HUB-BR-04 · AC-10 | `orchestrator.int.test.ts` | Runtime kịch bản `job.failed` `message` = `"claude-sub-1 assistant /home/worker/work/<job>/x stacktrace"` × {TIMEOUT, UPSTREAM_ERROR, INTERNAL_ERROR, ALL_PROVIDERS_EXHAUSTED} → `run.failed` (SSE + E11) không chứa `claude-sub`, `assistant`, `/home/`, `work/`, `stacktrace`; bản gốc có trong `run_steps.detail`; SSE `run.failed` và `GET /runs/:id` trả cùng `message`/`hint` |
| A56b | 4 · 35 | HUB-BR-04 · C1-R04 | `orchestrator.int.test.ts` | cùng `code` ở `locale=vi` và `en` → `message`/`hint` đúng nguyên văn bảng lỗi vi/en (plan §6.4 hoặc `plan-errors.md` — trỏ, không chép; `modules/runs/run-errors.ts`); 2 run cùng `code` khác nội dung gốc → giống nhau; `message` vi ≠ en (chỉ áp cho `message`, và cho `hint` khi khác `""`; `CANCELLED` hint `""` ở cả hai thì bỏ qua); `message` không rỗng; `hint` **luôn là string**, `""` khi bảng không có hint (không `null`/thiếu trường) |
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

## 5. Ghi chú readiness lần 4 (qc nhận ở QW)
- **#53:** danh sách file nhóm R (test-plan §3 dòng `File:`, §8 hàng QW-R) gồm thêm `rules/run-errors.test.ts` (R16). Cột `Mã` của A47 (test-plan §5) đọc là `H1-R16` (luật seed), không phải ca R16.

## 10. Kết quả viết test (đỏ đúng lý do; test-plan §10 trỏ về đây)

| Nhóm · ngày | File | Ca | Đỏ đúng lý do | Xanh trước code (chấp nhận) | Ghi chú |
|---|---|---|---|---|---|
| QW-R · 2026-10-04 | `rules/orchestrator.test.ts` (R1–R6) | 28 | 28 (`not implemented`) | 0 | |
| | `rules/agent-access.test.ts` (R7) | 8 | 8 (`not implemented`) | 0 | trả `AgentRef` = `{id}`: test so `id` — xem spec-decisions (B0) |
| | `rules/runs.test.ts` (R8–R10, R15a–d) | 14 | 14 (`not implemented`) | 0 | |
| | `rules/jwt.test.ts` (R11–R13) | 11 | 11 (`not implemented`) | 0 | `beforeAll` sinh khoá EdDSA xanh; R13 ký bằng `signAccessToken` Admin |
| | `rules/run-errors.test.ts` (R16) | 9 | 9 (`not implemented`) | 0 | |
| | `contracts-hub.test.ts` (R14) | 4 | 1 (`expect`: chưa có `fixtures/hub`, chờ C2) | 3 (mã ⊂, `toJSONSchema`, `v:2`) — C1 đã có | quy ước tên mẫu: `fixtures/hub/{valid,invalid}/<Tên HUB_JSON_SCHEMAS>[._-]*.json` |
| **QW-R tổng** | 6 file | **74** | **71/71 ca đỏ** (70 `not implemented` + 1 `expect`); 0 đỏ ở import/fixture/`TypeError` | **3** | `tsc -p tsconfig.tests.json` sạch · biome sạch · **chưa khoá** (Q2 sau QW-S) |
| QW-A1 · 2026-10-04 | `auth.int.test.ts` (A1–A3) | 15 | 13 (`expect`: route chưa có → 404 thay vì 401/200) | 2 (A3 `/health` 200, Redis hỏng 503 — B1 xong) | A1: 9 loại token xấu/khoá × E5, E7, E11–E15 + đối chứng 200; A2: `adminChange` (UPDATE + bump `config_meta` + NOTIFY `config_changed`), chờ ≤ 5 s theo điều kiện |
| | `isolation.int.test.ts` (A5–A7) | 10 | 9 (`expect`: đối chứng 200 của `lan` nhận 404; A6 RLS chưa có — D2 — `hub_api` thấy mọi dòng, INSERT chéo tenant được) | 1 (A6 `agent_runtime` denied `hub.conversations`/`admin.users`, EXECUTE `tenant_sub_limit` — D1 GRANT) | A5 so body 404 với uuid lạ cùng người gọi; A6 SQL trực tiếp, transaction luôn rollback |
| **QW-A1 tổng** | 2 file + `_fixtures.ts` dùng chung | **25** | **22/22 ca đỏ** ở `expect`; 0 đỏ ở `beforeAll`/fixture/`PostgresError`/`TypeError` | **3** | chạy `bun --env-file=.env.local --config=bunfig.int.toml test …` (thiếu `--env-file` → ném "chưa đặt" ở import) · fixture #52: `hoa` `en`, còn lại `vi` · `tsc -p tsconfig.tests.json` sạch · biome sạch · **chưa khoá** |
| QW-A2 · 2026-10-04 | `runs.int.test.ts` (A8–A13, A15) | 9 | 9 (`expect`: E12 chưa có → 404 thay vì 200/409) | 0 | A13 `lan` vi + `hoa` en (#52) |
| | `orchestrator.int.test.ts` (A14, A16–A26, A56a/b, A57, P45b(A)) | 18 | 18 (`expect`: E12 404) | 0 | A26 gộp A56a (4 mã); A56b `lan`/`hoa` so `runErrorText` (#52); A25 đổi cấu hình như seed (SQL + `hub_config_version` + NOTIFY `hub_config_changed`); A57 hub thứ 2 `configPollS: 1` |
| | `runner.int.test.ts` (A27–A32) | 9 | 9 (`expect`: E12 404) | 0 | A31 hub thứ 2 `jobMaxWaitS: 2`, slot giả = job `running` chèn SQL; fixture `adminChange`/`insertRunningJob` chạy xanh trước điểm đỏ |
| | `cancel.int.test.ts` (A34–A36, A55) | 5 | 5 (`expect`: E12/E15 404) | 0 | A55 2 instance (B = `qc-hub-b`) |
| | `concurrency.int.test.ts` (A37, A37b, A38) | 3 | 3 (`expect`: E12 404 / E9 404 thay vì 204) | 0 | 50/50/20 vòng, timeout ca 180/180/120 s; đếm `pg_stat_database.deadlocks` |
| | `lease.int.test.ts` (A39–A41, A54) | 4 | 4 (`expect`: E12 404) | 0 | A40 run `hoa` → `runErrorText('INTERNAL_ERROR','en')`; A54 nhánh sweeper thắng kiểm câu en (#51) |
| | `seed.int.test.ts` (A42–A47) | 8 | 8 (A42/A44 `not implemented`; A43×2/A45/A47 ENOENT `apps/hub-api/seed` chưa có — D3; A46×2 `expect`: `server.ts` không thoát trong 10 s) | 0 | A43 thiếu biến thể "6 bước" (định dạng yaml chưa chốt — Cần bổ sung D3); A43/A45 sửa bản sao yaml mặc định theo chuỗi `key: assistant`, `provider_key: fake-cli`, `group:beta-testers` (thiếu chuỗi → đỏ `expect`) |
| | `db.int.test.ts` (A48–A51, #51 migrate) | 5 | 0 | 5 (schema D1: DB sạch ≡ DB stub, Admin `{9,3}`, M4 + INSERT Runtime, quyền role, `runs_error_cols_ck` → 23514) | DB phụ `ai_system_h1stub_test` cho A48; A50 không gọi API usage Admin M4 (chỉ SQL `admin_rw` đọc được) |
| | `log.int.test.ts` (A52) | 1 | 1 (`expect`: E12 404) | 0 | bắt log qua `setSink` |
| **QW-A2 tổng** | 9 file + `_hub.ts`, `_runtime.ts` (Runtime kịch bản) | **62** | **57/57 ca đỏ** ở `expect`/`not implemented`/ENOENT seed; 0 đỏ ở `beforeAll`/fixture/`PostgresError`/`TypeError` | **5** | deps mới tuỳ chọn của `createApp` ghi ở spec-decisions (QW-A2) · `tsc -p tsconfig.tests.json` sạch · biome sạch · **chưa khoá** |
