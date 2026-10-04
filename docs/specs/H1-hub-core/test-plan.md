# Test plan · H1-hub-core (qc)

Chế độ **TEST-PLAN** · 2026-10-04 · sửa theo readiness lần 1+2 (người dùng chấp nhận mọi mặc định, câu 1 = "chưa"). Chưa có file test; viết + "đỏ đúng lý do" sau Gate (§8), rồi khoá. Ca bổ sung (R15, A37b, A54–A57, P45), ca `blocked (chờ W0)`, tranh chấp K: [`test-plan-cases.md`](test-plan-cases.md).
"Đúng" = spec §2 (H1-R01…R26), §8 (AC phần H1, HUB-H1-AC-01…12); chữ ký `plan.md` §6.4; SQL `plan-db.md` §5.4–5.5; `fake-cli` `plan-runtime.md` §7. BA chỉ ở mục AC được trỏ.

## 1. Quy ước

| Mục | Quy ước |
|---|---|
| Tên test | TS `"<mã> · mô tả [ID]"`; Python `test_<mã_snake>_<mô_tả>` + docstring mã gốc |
| Loại | **R** unit TS hàm thuần · **A** int TS hub-api (HTTP + DB/Redis thật, Runtime kịch bản §2) · **P** Python unit/int (Runtime thật + `fake-cli`) · **S** stack WSL2 · **K** contract chat (khoá, chỉ đọc) · **M** thủ công |
| Vị trí | R, A: `tests/acceptance/H1/{rules/*.test.ts, *.int.test.ts}` · S: `tests/acceptance/H1/stack/*.stack.test.ts` · P: `apps/agent-runtime/tests/acceptance/` (Q-T1) · perf: `tests/acceptance/H1/perf.perf.int.test.ts` |
| Hộp đen | A: HTTP + DB/Redis; P: chỉ `hub.jobs`, NOTIFY, `run:<id>`, `/proc`, file log |
| Dữ liệu | SQL owner trong fixture: `acme` (`lan`,`hoa` member, `tadmin`), `beta` (`an`), `padmin`; JWT tự ký khoá test; uuid cố định; bẫy postgres.js CONVENTIONS §2 |
| Chờ | Không `sleep` cố định: `expect.poll`/đọc stream tới sự kiện; Python `wait_until(cond, timeout)` 50 ms. Ngưỡng `≤` rộng |
| Cấm | `skip`/`only`/`todo`, `pytest.mark.skip`, `importorskip`. Import module chưa có đặt **trong thân test** (Python) để đỏ ở ca, không ở collection |

## 2. Hạ tầng và giả lập

| Mục | Đề xuất | Ai |
|---|---|---|
| DB test | DB riêng `ai_system_h1_test` (đuôi `_test` cho `resetTestDb`; TECH-DEBT #17), env `HUB_TEST_DATABASE_URL` (TS) + `runHubMigrations`; **không** migrate Hub trên `TEST_DATABASE_URL` (R-DB2). Python: cùng DB qua `AGENT_RT_TEST_DATABASE_URL`, role `agent_runtime`. Mỗi file tự migrate ở `beforeAll` (idempotent) | backend-lead env, qc fixture |
| Redis test | `redis://localhost:6379/15`; key theo `run_id` mới mỗi ca; không `FLUSHDB` | qc |
| Runtime kịch bản (A) | `tests/acceptance/H1/_runtime.ts`: đợi `INSERT hub.jobs`, parse `JobPayloadSchema`, ghi `jobs` + XADD `RunEvent` theo kịch bản ca; assert được **payload** (prompt, `<agents>`, history) | qc |
| `fake-cli` (P, S, K) | `plan-runtime §7` + `badjson` (`plan §8 R4`), `#fake:tool=<name>`, `APP_ENV=test`; Orchestrator chỉ echo khối `<message>`/`prompt`: `"echo: "+msg` + câu cố định ≥ 120 ký tự (≥ 3 `delta`) | backend-lead PY-09 |
| Runtime trong P | subprocess `python -m agent_runtime` (WSL2), env tường minh: `AGENT_RT_PROVIDERS=fake-cli`, `WORKER_ID=qc-<n>`, `WORK_DIR`/`LOG_DIR` tmp ổ Linux, `ORPHAN_S=5`, `CLEANUP_S=1`, `HOME`=tmp có `.claude/.credentials.json` mồi (CLI con dùng `HOME` cha, Q-T4) | qc |
| Stack (S, K) | `tools/hub-dev` (I1): hub-api :4000 + agent-runtime + admin-api, profile `fake-1` | backend-lead I1 |
| CLI thật | chỉ spike PY-02 + M1: **blocked (chờ W0)** → I2 cuối H1. Mọi test tự động: `fake-cli` hoặc SDK giả (monkeypatch `ClaudeSDKClient`) | người dùng |
| Lock | `LOCKED_DIRS` + `apps/agent-runtime/tests/acceptance`, bỏ `__pycache__`, `.pytest_cache` | backend-lead PY-01 |
| Tách chạy | `tests/acceptance/H1/stack/**` vào `pathIgnorePatterns` (`bunfig.toml`, `bunfig.int.toml`); script `test:h1:stack` | backend-lead B1 |

## 3. Ma trận mã → test

File: R `rules/{jwt,orchestrator,agent-access,runs}.test.ts`, `contracts-hub.test.ts` · A1–3 `auth` · A5–7 `isolation` · A8–13 `runs` · A14–28 `orchestrator` · A29–32 `runner` · A34–36 `cancel` · A37–38 `concurrency` · A39–41 `lease` · A42–47 `seed` · A48–51 `db` · A52 `log` (`*.int.test.ts`) · P1 `test_wrk_br_07_paths.py` · P2–7 `claim` · P8–12 `cancel` · P13–16 `crash` · P17–19 `sandbox` · P20–25 `session` · P26–28 `result` · P29–32 `ratelimit` · P33–35 `usage` · P37 `manifest` · P38–39 `events` · P40–43 `startup_log` (`*_int_test.py`) · P44 `test_contract_fixtures.py`.

| Mã | Test |
|---|---|
| HUB-FR-01, 74 · HUB-H1-AC-09 | R11–R13, A1 |
| HUB-FR-88 · H1-R04 · HUB-NFR-03 | A2 (mọi A chạy không admin-api) |
| HUB-FR-02, 03 | A2, A25, A57 (phần tenant/user/group/hub) |
| HUB-FR-40 · H1-R03 | A5–A7, K |
| HUB-FR-41 · H1-R09, R10 | A8, A11, A13, A15, P45b, K |
| HUB-FR-42 · HUB-NFR-02 · HUB-H1-AC-03 · H1-R12 | R8, R15, A11, A12, A39, A54, K |
| HUB-FR-43 · AC-H06 · H1-R14 | A34–A36, A55, P8, S1 |
| HUB-FR-45 · H1-R11 | A9, A10, A24 |
| HUB-FR-75 · HUB-BR-02, 14 · AC-H07, H08 | A5–A7, K |
| HUB-FR-20, 25 · H1-R05 | A14, A15, A28 |
| HUB-FR-21 · H1-R07 | R3, R4, A22, A23 |
| HUB-FR-27, 29 · H1-R08 | R5, A16, A17, P28 |
| HUB-FR-28 · AC-H15 · AC-H14 | A18, A19, S2 |
| HUB-FR-77 · HUB-BR-03 · AC-H09 · H1-R06 | R7, A14, A21, A25, A27 |
| HUB-BR-04 · HUB-BR-06 · H1-R15 | A20, A26, A30, A56, R16 · A25 |
| HUB-FR-60, 61, 62 · HUB-BR-08 · H1-R16, R17 · HUB-H1-AC-11 | A42–A47 |
| HUB-FR-89, 32 · H1-R18 | A29–A32 |
| HUB-FR-86 · AC-H13 · AC-W07, W08 · HUB-H1-AC-07 | A31, P2–P4 |
| HUB-FR-33, 83 · WRK-FR-17 · AC-W09 · H1-R25 | P33–P35, A50 |
| HUB-FR-90 · WRK-FR-25 | P37 |
| HUB-NFR-01 | A53 (perf) |
| HUB-NFR-04 · WRK-NFR-04 · H1-R26 | A52, P42, P43 |
| WRK-FR-01, 20, 24 · WRK-BR-05 · WRK-NFR-01 · H1-R19 | P2–P7 |
| WRK-FR-02, 23 · WRK-BR-04 · WRK-NFR-03 · H1-R20 · HUB-H1-AC-04 | P12–P16, A41, S3 |
| HUB-H1-AC-05 · H1-R13 | A40 |
| WRK-FR-03 | P38, P39, P45a |
| WRK-FR-04, 05 · WRK-NFR-06 · AC-W03, W10 · H1-R22 | P8–P11 |
| WRK-FR-11, 12 · WRK-BR-02, 07 · WRK-NFR-02 · AC-W05, W11 · H1-R21 | P1, P17–P19 |
| WRK-FR-14 · WRK-BR-03, 06 · AC-W04 · H1-R23 | P20–P25 |
| WRK-FR-15 · AC-W02 · H1-R24 | P29–P32 |
| WRK-FR-10 · HUB-H1-AC-02 | M1 + spike PY-02 — **blocked (chờ W0)**, I2 |
| HUB-H1-AC-01 · CHAT-AC-31, 32, 33 | K (~40 ca "mọi Hub") |
| HUB-H1-AC-06 | R14, P44, `contracts:check` |
| HUB-H1-AC-08 | A48–A51 |
| HUB-H1-AC-10 · HUB-H1-AC-12 | A20–A22, A56, P26 · A24 |
| spec §7 (`fake-cli` chỉ dev/test) | A44, P40, P41 |

**Không phủ (đủ) ở H1:** [`test-plan-cases.md`](test-plan-cases.md) §4.

## 4. R · Hàm thuần TS (chữ ký `plan.md` §6.4)

| ID | Hàm | Ca biên (dữ liệu → kỳ vọng) |
|---|---|---|
| R1 | `parseDecision` hợp lệ | 3 loại decision đúng schema → `ok`; có ```` ```json ```` fence; khoảng trắng/xuống dòng đầu-cuối; chữ trước `{` và sau `}` → `ok`; mảng `[{…answer…}]` → `ok` (luật `{` đầu→`}` cuối, Q-T5) |
| R2 | `parseDecision` hỏng | `""`, `"xin chào"`, `"{"`, JSON cắt cụt, `{a}{b}` → `not_json`; `decision:"foo"`; `delegate` thiếu `task`; thừa trường (strict); `agent:"Bad_Key"`; `task` 8001 ký tự; `choices` 7 mục; `answer.text` rỗng → `schema` |
| R3 | `budgetExceeded` | `steps=4,max=5,tokens<budget` → false; `steps=5` → true; `tokens=budget` → true; `steps=0,tokens=0` → false |
| R4 | `budgetOutcome` | `null` (vi/en) → `{fail, BUDGET_EXCEEDED}`; `"abc"` vi → `finish`, text bắt đầu `"abc"` + câu báo vi; en → câu báo en; text ≠ `"abc"` |
| R5 | `canPassThrough` | `done`+1+`!hadPartial` → true; `delegates=2` → false; `hadPartial` → false; `partial`/`need_input` → false; `delegates=0` → false |
| R6 | `chunkText` | nối == text; phần 1–40; đúng 40 → 1 phần; từ 95 ký tự → cắt cứng; dấu NFC/NFD, emoji không cắt đôi (Q-T5); xuống dòng kép, nhiều cách giữ; `max=5`; `""` → `[]` |
| R7 | `visibleAgents` | loại: agent tắt, entitlement thu hồi/tenant khác, chưa grant (`hoadon`), grant user khác/group không thuộc, Orchestrator dù có grant; grant user+group → 1 mục; sắp `key`; chỉ `key`+mô tả |
| R8 | `eventsExpired` | hết hạn khi `now − finishedAt > retention` (như mock C1 `runs.ts`): `running` → false; xong `now-599 s` → false; **đúng** `now-600 s` → false; `now-600 s-1 ms`, `now-601 s` → true |
| R9 | `leaseExpired` | `null` → false (sweeper SQL `<`); `now-1 ms` → true; `== now` → false |
| R10 | `queueTimeoutReason` | `limit null` → `provider_busy`; `0<1` → `provider_busy`; `1≥1` → `tenant_slots`; `3≥2` → `tenant_slots` |
| R11 | `verifyAccessToken` hợp lệ | token EdDSA đúng `iss/aud/sub/tid/role` → claims; `role` ∈ 3 giá trị |
| R12 | `verifyAccessToken` sai → `null` | khoá khác; `alg:none`; HS256 ký bằng PEM công khai (nhầm thuật toán); hết hạn; `aud`/`iss` sai; `sub` không uuid; thiếu/sai `tid`; `role:"root"`; token rác/3 phần rỗng |
| R13 | Test vector | token do `signAccessToken` (Admin) sinh với cặp khoá test verify được ở Hub (đọc API Admin, không sửa) |
| R14 | contract hub | `HUB_JOB_ERROR_CODES ⊂ CHAT_RUN_ERROR_CODES`; `toJSONSchema` throw-mode không ném; fixtures valid/invalid; `v:2` bị từ chối |

## 5. A · hub-api int (`tests/acceptance/H1/`, Runtime kịch bản)

| ID | Mã | Given/When → Then |
|---|---|---|
| A1 | AC-09 | token xấu (R12, tenant/user khoá) × E5, E7, E11–E15 → 401 `AUTH_EXPIRED`; E12 không thêm `messages`/`runs` |
| A2 | FR-88, R04 | token còn hạn; `tenants.active=false` + `config_changed` → ≤ 5 s 401; mở lại → 200; `users.active=false`/`locked_by_tenant` như vậy |
| A3 | AC-31 | `/health` không token → 200 `HealthResponseSchema` chat; Redis hỏng → 503 |
| A5 | AC-H07/H08 | tài nguyên `lan` (hội thoại, flow, run xong/đang chạy) × {`hoa`, `an`, `tadmin`, `padmin`} × E7–E15 → 404 body giống uuid lạ; sau đó dữ liệu `lan` nguyên, run không bị huỷ |
| A6 | Q7 | `hub_api` không `app.scope` → 0 dòng 5 bảng; scope `lan` → chỉ của `lan`; INSERT tenant khác → lỗi RLS; `agent_runtime` SELECT `hub.conversations`/`admin.users` → denied, EXECUTE `tenant_sub_limit` được |
| A7 | R03 | `tenant_id`/`user_id` trong body → 400 (strict); trong query → bỏ qua |
| A8 | R10 | `run.started` (id 1, `quota {ok,0}`) tới **trước** khi Runtime trả job Orchestrator; header `X-Run-Id/Flow-Id/Message-Id` khớp |
| A9 | R11 | POST vào flow đang chạy → 409 `FLOW_BUSY`; 2 POST song song → đúng một thành công |
| A10 | FR-45 | không `flow_id` → flow mới; `flow_id` hội thoại khác → 404 |
| A11 | R12 | id SSE `1..n`; `sse:<id>` id `<seq>-0`; xong: TTL ∈ (590, 600], `run:<id>` bị xoá |
| A12 | R12 | `Last-Event-ID: 3` → 4…n; `finished_at` lùi 601 s + mất key → 410 |
| A13 | C1-R04 | nhãn step tĩnh theo `locale` (vi/en), không key agent/provider |
| A14 | FR-20, AC-H09 | payload Orchestrator: `output=text`, `use_session=false`, `allowed_tools=[]`, `max_turns=3`; `<agents>` = R7 (không `orchestrator`, không `hoadon`); khối §6.3 cuối `system_prompt` |
| A15 | R09 | `answer` 130 ký tự → ≥ 4 `delta` ≤ 40; nối = `content` = tin E11 |
| A16 | FR-29 | `delegate`→`done` → stream thẳng, không job Orchestrator thứ 2; `flows.agent_id` = agent |
| A17 | FR-27 | `partial` → job Orchestrator kế có `<steps>` chứa `missing`; `answer` cuối |
| A18 | AC-H15 | `need_input` → `ask` không key `agent`/`provider` (mọi frame); run `finished`; E11 có `ask`; `pending_ask=true`; tin kế: `waiting_for` = agent → `delegate` → job `use_session=true` |
| A19 | AC-H14 | flow gắn `assistant`, tin 2 → `delegate helper` → `flows.agent_id=helper`, `run_steps` ghi |
| A20 | AC-10 | JSON hỏng 1 lần → thử lại cùng step, prompt có câu nhắc §6.3; hỏng 2 → `UPSTREAM_ERROR`, vẫn có tin assistant |
| A21 | AC-10 | `delegate` ngoài danh sách → step `skipped` `not_allowed`, không job, tính `max_steps` |
| A22 | AC-10 | agent luôn `partial` → hết `max_steps` → `finished` + câu báo; luôn `delegate` không phép → `BUDGET_EXCEEDED` |
| A23 | FR-21 | `usage` vượt `token_budget` → dừng theo R07 |
| A24 | AC-12 | prompt chỉ tin flow 1, ≤ `history_n`, không gồm tin hiện tại, mỗi tin ≤ 4000 |
| A25 | BR-06, AC-H09 | seed tắt `assistant` giữa run → run đang chạy giữ snapshot, run mới ≤ 5 s không thấy; grant `hoadon` qua seed → ≤ 5 s có |
| A26 | BR-04 | `job.failed` TIMEOUT/INTERNAL/UPSTREAM → `run.failed` cùng mã, `message` không rỗng, không lộ agent (chi tiết A56: không chuyển `message` gốc) |
| A27 | BR-03 | payload agent `allowed_tools ⊂ {Read,Grep,Glob}` |
| A28 | R05 | tin bắt đầu `/` → vẫn có job Orchestrator |
| A29 | FR-89 | `INSERT jobs` + `job_enqueued` cùng transaction (thấy NOTIFY ⇒ thấy dòng) |
| A30 | R18 | `cooldown` chưa hết/`logged_out`/`error` → `ALL_PROVIDERS_EXHAUSTED` ngay, không job; cooldown qua → có job |
| A31 | AC-H13 | `HUB_JOB_MAX_WAIT_S=2`, `acme` limit 1 đang chạy 1 → `failed tenant_slots` + `ALL_PROVIDERS_EXHAUSTED` trong [2, 6] s; provider đầy → `provider_busy` |
| A32 | P7 | DB `succeeded`+`result`, không XADD → Hub dựng từ DB ≤ 5 s |
| A34 | AC-H06 | huỷ: `queued→cancelled`; `running` có `cancel_requested_at` + `job_cancel`; SSE `CANCELLED`; lần 2 → 200, không sự kiện mới |
| A35 | E9 | xoá hội thoại có run chạy → run `cancelled`, rồi 404 |
| A36 | UC-04 | huỷ run đã xong → 200 `finished` |
| A37 | §3.5 | 50 vòng E12 ∥ kết thúc ∥ huỷ cùng flow: `deadlocks` không tăng; 1 kết thúc/run; ≤ 1 `running`/flow · + E8 ∥ E9 ∥ E12: A37b |
| A38 | §3.5 | huỷ ∥ sweeper ∥ kết thúc cùng run → đúng 1 kết thúc, DB khớp |
| A39 | AC-03 | 2 instance: POST ở A, ngắt sau `delta` 3, E13 ở B `Last-Event-ID: 3` → 4…n không lặp/mất |
| A40 | AC-05 | A dừng không dọn, `lease_until` lùi → B ≤ 20 s đóng `INTERNAL_ERROR`, huỷ job, `seq`=cuối+1; A bị fencing |
| A41 | AC-04 | `heartbeat_at=now-61 s` → Hub ≤ 20 s `orphaned`, `INTERNAL_ERROR`; POST cùng flow không `FLOW_BUSY` |
| A42 | AC-11 | seed 2 lần → không trùng, version +2, 2 NOTIFY |
| A43 | AC-11 | yaml sai (key `Bad`, 6 bước, provider lạ) → không ghi gì |
| A44 | §7 | seed `APP_ENV=production` → không `fake-cli` |
| A45 | Q8 | grant user lạ → bỏ + cảnh báo |
| A46 | BR-08 | thiếu/tắt Orchestrator → hub-api không khởi động |
| A47 | R16 | yaml không chuỗi dạng secret (`sk-`, `BEGIN`, `password:`) |
| A48 | AC-08 | DB sạch và DB stub: `db:migrate` thành công, schema `hub` giống nhau (cột, CHECK, index, policy); lần 2 = 0 |
| A49 | P1 | `runMigrations` vẫn `{main:9, dev:3}`; Admin `ADM-NFR-06`, `M1–M4` int xanh nguyên văn |
| A50 | M4 | INSERT kiểu Admin M4 vẫn chạy; cột mới nullable; `usage_logs_job_uq`; dòng SQL Runtime hiện ở API usage Admin M4 |
| A51 | §3.4 | `admin_rw` chỉ SELECT 3 bảng stub; `hub_api` không UPDATE `usage_logs`; quyền `agent_runtime` đúng |
| A52 | NFR-04 | log có `run_id, tenant_id, user_id`; không chuỗi mồi nội dung tin, không JWT |
| A53 | NFR-01 | perf: `run.started` ≤ 500 ms, overhead ≤ 200 ms p95, E5/E10/E11 < 300 ms p95 |

## 6. P · Python (`apps/agent-runtime/tests/acceptance/`) · S · M

| ID | Mã | Given/When → Then |
|---|---|---|
| P1 | AC-W05 | unit `is_path_allowed`: `../x`, `a/../../x`, `/etc/passwd`, symlink → `$HOME/.claude`, symlink → job khác, `/mnt/c/…`, `""`, `\0`, symlink vòng, tiền tố giả `work/<job>-x/` → deny; `work/<job>/a.txt`, `.`, file chưa tồn tại → allow |
| P2 | AC-07 | 20 kết nối chạy SQL claim nguyên văn ∥ 3 Runtime; 2 tenant, `max_concurrency=2`, `acme` limit 1, 50 job: mẫu 50 ms provider ≤ 2, `acme` ≤ 1; mọi `attempts=1` |
| P3 | AC-W07 | `acme` đang 1 → job `acme` 2 `queued`; job `beta` nhận slot |
| P4 | AC-W08 | `beta` null + 2 slot → 2 `running` cùng lúc |
| P5 | BR-05 | cùng `(conversation, agent)` → tuần tự; khác agent → song song |
| P6 | NFR-01 | `job.started` ≤ 2 s sau INSERT (có NOTIFY; không NOTIFY) |
| P7 | R14 | `queued` có `cancel_requested_at` → không claim |
| P8 | AC-W03 | `sleep=60` → huỷ → ≤ 5 s `cancelled`, `/proc` không pid `pgrp=pgid`, 1 `job.failed CANCELLED`; job chờ slot được claim |
| P9 | AC-W10 | `spawn-child` → huỷ → `sleep 300` hết ≤ 5 s |
| P10 | FR-05 | chỉ cờ DB, không NOTIFY → dừng ≤ 15 s |
| P11 | FR-04 | `timeout_s=10`, `sleep=60` → `timed_out` ≤ 15 s, group hết |
| P12 | §1.5 | SIGTERM Runtime → job `orphaned` `INTERNAL_ERROR`, exit ≤ 10 s |
| P13 | AC-04 | `kill -9` khi chạy → khởi động lại: job `orphaned`, pgid bị giết, XADD; job `queued` còn và chạy |
| P14 | FR-23 | `kill -9`, Runtime khác `ORPHAN_S=5` → `orphaned` ≤ 15 s, 1 sự kiện |
| P15 | BR-04 | `crash` → `failed crash`, `attempts=1` |
| P16 | §3.3 | 3 `crash` liên tiếp → `provider_state=error`, job `queued` → `provider_unavailable`; thành công xen giữa → đếm về 0 |
| P17 | AC-W11 | `read=` `~/.claude/.credentials.json`, `$HOME/.codex/x`, `/mnt/c/…`, `../<job khác>`, symlink → `denied`; canary không ở `result`, Redis, log, stdout |
| P18 | BR-02 | `#fake:env` khoá ∩ {`AGENT_RT_*`, `REDIS_URL`, `DATABASE_URL*`, `ANTHROPIC_API_KEY`, `JWT_*`, `HUB_*`} = ∅; `cwd`=`work/<job_id>` |
| P19 | FR-12 | `#fake:tool=` tool ngoài `allowed_tools`, `Bash`, `Agent` → `tool_not_allowed` (Q-T3) |
| P20 | AC-W04 | `remember=xanh` → `recall` = "xanh", `session_resumed=true` |
| P21 | R23 | `lost-session` → thành công từ `history`, `session_resumed=false` |
| P22 | BR-06 | session cùng khoá, `tenant_id` khác → không resume, không ghi đè |
| P23 | BR-03 | `provider_key` khác → không resume |
| P24 | R23 | `use_session=false` → không đụng `cli_sessions` |
| P25 | §2.3 | huỷ/timeout → không ghi `cli_sessions` |
| P26 | AC-10 | `badjson=1` → `succeeded`; `=2` → `UPSTREAM_ERROR invalid_output` |
| P27 | §4 | `output=text` → `kind:text` nguyên văn |
| P28 | FR-27 | `partial`/`need_input` hợp `AgentResult` |
| P29 | AC-W02 | `ratelimit=<ts>` → `cooldown_until=ts`; job `failed quota`; `queued` cùng provider fail ngay |
| P30 | FR-15 | không giờ → `now+30 phút` ±1 |
| P31 | R18 | cooldown chưa hết → không claim; hết → claim |
| P32 | §2.4 | khởi động lại: `error`/`logged_out` → `ok`, `cooldown` giữ |
| P33 | AC-W09 | `usage=100,50` → 1 dòng đủ khoá, `fake-cli`, `model=fake`, `subscription`, `cost_usd=0`, `billable_usd`/`feature_id` null, `overage=false`, `job_id` |
| P34 | R25 | job Orchestrator cũng có dòng |
| P35 | R25 | huỷ có usage → có dòng; kết thúc lặp → 1 dòng |
| P37 | FR-25 | `agent_types` `agentic-cli` `available`; lần 2 không trùng; key lạ cùng worker → `available=false` |
| P38 | FR-03 | `started` → `progress` → đúng 1 kết thúc; hợp `hub.schema.json`; `seq` từ 1; TTL ~86 400; DB đã kết thúc trước sự kiện |
| P39 | R8 | `progress.message` không đường dẫn/prompt |
| P40 | §7 | production + `fake-cli` liệt kê → exit 2; không liệt kê → không đăng ký |
| P41 | §1.4 | `WORK_DIR` dưới `/mnt/` hoặc tương đối → exit 2 |
| P42 | NFR-04 | stdout JSON có `job_id, run_id, tenant_id`, không chuỗi mồi; file log 0600 |
| P43 | FR-23 | `AGENT_RT_CLEANUP_S=1`: log > 7 ngày, `work/<job>` > 24 h bị xoá (Q-T7) |
| P44 | AC-06 | fixtures `valid/invalid`: pydantic cùng kết luận zod; `model_dump_json()` → zod parse |
| S1 | AC-H06 | stack: `#fake:delegate=assistant #fake:sleep=60` → huỷ → ≤ 5 s `CANCELLED`, job `cancelled` |
| S2 | AC-H14/15 | stack: `need_input` → trả lời → delegate lại, `session_resumed=true` |
| S3 | AC-04 | stack: `kill -9` Runtime → ≤ 90 s `INTERNAL_ERROR`; flow gửi tiếp được |
| S4 | AC-01 | stack: "Xin chào" → `usage_logs` ≥ 1 dòng |
| M1 | AC-02 | §7.2 |

## 7. Lệnh

### 7.1 Xong mốc H1 — **chuẩn duy nhất** (spec §8, plan-runtime §10 trỏ về đây) · script `bun run done:h1` gọi tuần tự
Lọc theo package Hub: `@ai/hub-api`, `packages/{contracts,db}`, `apps/agent-runtime`, `tests/acceptance/H1`.
```
bunx turbo run typecheck --filter=@ai/hub-api --filter=@ai/contracts --filter=@ai/db
bun test packages/contracts packages/db tests/acceptance/H1/rules tests/acceptance/H1/contracts-hub.test.ts
bun --env-file=.env.local --config=bunfig.int.toml test --timeout 30000 tests/acceptance/H1/ tests/acceptance/M tests/acceptance/ADM-NFR-06   # H1 *.int (DB h1) + Admin khoá
bun run contracts:check
(cd apps/agent-runtime && uv run ruff check . && uv run ruff format --check . && uv run pyright \
  && uv run lint-imports && uv run pytest && uv run pytest -m int)   # WSL2
bun run test:h1:stack                               # cần tools/hub-dev chạy
HUB_URL=http://localhost:4000 AUTH_URL=http://localhost:3001 CHAT_CONTRACT_USERS='<json>' bun run test:contract:chat
bun run test:lock:verify && bun run trace --check && bun run check:size --all && bunx depcruise apps/hub-api packages/contracts/src/hub packages/db tools/hub-dev
```
Chạy riêng, **chỉ báo cáo**: `tsc -p tsconfig.tests.json`, `bun run depcruise --all`.
`trace --check`, `check:size` quét `.py` chỉ sau PY-01. `test:perf` không thuộc Lệnh xong. Đỏ ngoài bộ lọc (depcruise, `bun test` toàn repo) **do code dở của Chat** = phụ thuộc combine, không chặn H1; ghi tên file đỏ vào bàn giao.

### 7.2 Smoke thủ công — HUB-H1-AC-02 · **blocked (chờ W0)**, I2 cuối H1: [`test-plan-cases.md`](test-plan-cases.md) §2.1

## 8. Ước lượng và nhóm WRITE (sau Gate)

| Nhóm | File | Số ca (≈) | Phải đỏ đúng lý do vì |
|---|---|---|---|
| QW-R | `rules/{orchestrator,agent-access,runs,jwt}.test.ts`, `contracts-hub.test.ts` | 54 | module/hàm chưa có (import tĩnh sau khi backend-lead tạo stub chữ ký, Q-T2) |
| QW-A1 (cao) | `auth`, `isolation` | A1–A7 | route 404/`expect`; fixture DB/Redis phải xanh |
| QW-A2 (cao) | 9 file `*.int.test.ts` còn lại | A8–A52, A37b, A54–A57, P45b(A) | như QW-A1 |
| QW-P | 11 file Python | 52 (unit 12, int 40) | `ModuleNotFoundError` trong thân test / timeout chờ trạng thái; fixture (DB, Redis, spawn) phải xanh |
| QW-S | 3 file `.stack.test.ts` | 4 | kết nối tới stack/expect |
| K | có sẵn | ~40 "mọi Hub" | chỉ chạy ở I2 |
| perf | 1 | 4 | không chặn |

Tổng mới ≈ **181** ca (TS 129, Python 52; +13 theo readiness 1) + 40 K + M1/spike blocked; theo mã: Hub FR/BR ~85, WRK ~55, HUB-H1-AC ~28.
**Chú ý đỏ đúng lý do:** ca kỳ vọng 404 (A5, K-C8) có đối chứng 200 của chủ và so body `NOT_FOUND` JSON (404 mặc định của Hono không đạt) · dựng dữ liệu bằng SQL, không qua route chưa có · P2 chạy SQL nguyên văn trên schema D1 nên có thể **xanh** trước code Runtime (chấp nhận, ghi §10) · A48–A51 (và A3 nếu B1 xong trước) **xanh trước khoá** (chấp nhận, ghi §10).

## 9. Rủi ro test · câu hỏi — **đã chốt** (người dùng chấp nhận mặc định 2026-10-04)

| # | Rủi ro / câu hỏi | Đã chốt |
|---|---|---|
| Q-T1 | Test Python của qc ở đâu để bị khoá | `apps/agent-runtime/tests/acceptance/` + `LOCKED_DIRS`; pytest `testpaths=["src","tests"]` |
| Q-T2 | R import tĩnh `*.rules.ts` chưa có → typecheck đỏ | backend-lead tạo stub chữ ký `plan §6.4` (thân `throw`) đầu B1/B4/B8; qc viết R sau |
| Q-T3 | `fake-cli` thiếu chỉ thị gọi tool tuỳ ý (P19) | `#fake:tool=<name>` qua hook thật (PY-09) |
| Q-T4 | Không được đụng `~/.claude` thật | `HOME` con = `HOME` cha (`Settings.home`), `forbidden_roots` tính từ đó; test đặt `HOME`=tmp (P17) |
| Q-T5 | Biên: `eventsExpired` đúng 600 s; `chunkText` đếm gì; `parseDecision` với mảng | hết hạn khi `now − finishedAt > retention` (R8, mock C1); đếm code point, không cắt surrogate; mảng → `ok` |
| Q-T6 | Profile > 1 bước ở H1 | chỉ bước 0, không fallback; không test HUB-FR-31 |
| Q-T7 | Poll 60 s (HUB-FR-03), cleanup mỗi giờ không test nhanh | env `HUB_CONFIG_POLL_S` (60, B3), `AGENT_RT_CLEANUP_S` (3600, PY-13); A57, P43 |
| Q-T8 | Orchestrator giả không chỉ thị echo **cả prompt** (lộ `<agents>`, history vào `content`) | echo chỉ `<message>`/`prompt`: `"echo: "+msg` + câu cố định ≥ 120 ký tự (P45); `delegate` truyền `task` = tin bỏ `#fake:delegate` (để `#fake:sleep` tới agent, S1) |
| Q-T9 | AC-W06 không trong `requirements` | thay bằng HUB-H1-AC-04 (orphaned → failed, không đưa lại queue) |
| R-DB2 | `test:int` một tiến trình: migrate Hub trên DB chung → test khoá Admin "đúng 3 bảng `hub.*`" đỏ | DB `h1` riêng; A49 kiểm |
| R-WIN | `bun test` trên Windows không chạy P/S | P qua `wsl.exe` (RQ5); S ở I2 |

**Tranh chấp tiềm năng contract chat (K):** [`test-plan-cases.md`](test-plan-cases.md) §3.

## 10. Đỏ đúng lý do
Bảng: [cases §10](test-plan-cases.md)
