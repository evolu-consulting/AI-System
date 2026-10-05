# Test plan · H2b-routing — nhật ký §10 (qc)

Tách từ [`test-plan.md`](test-plan.md) §10 ở I3 (test-plan vượt trần 30 KB, `WORKFLOW` "Trần kích thước"). Nội dung giữ nguyên; tham chiếu "test-plan §10" trong commit/tài liệu cũ trỏ vào file này.

## 10. Đỏ đúng lý do · nhật ký
QW-R, QW-A1, QW-A2, QW-PU, QW-P xong, Q2 + Q-PU + Q3 khoá (dưới). Sau mỗi nhóm: bảng `File · ID · đỏ đúng lý do / tổng · lý do đỏ · xanh trước code (lý do)` + "Lệch plan / cần backend-lead"; Q2/Q-PU/Q3: số dòng `UNLOCKED` trước ghi, tổng file lock; tranh chấp: bảng TC như H2a (`#`, test, phán quyết, sửa, kết quả); I1: bảng 16 bước §7.1.

### QW-R · 2026-10-05 (sau B0 `5ef4b90`, C1, C2, D1 `adba6a3`)
`bun test tests/acceptance/H2b/rules`: **46 test / 10 file** (+ helper `_access.ts`) — **38 đỏ đúng lý do, 8 xanh**. `tsc -p tsconfig.tests.json` 0 lỗi · biome sạch · `check:size` OK · `trace --check` OK (HUB-FR-91/92/94 có test).

| File | ID | Đỏ / tổng | Lý do đỏ | Xanh trước code (lý do) |
|---|---|---|---|---|
| `mention-parse.test.ts` | R01–R08 | 8/8 | stub `not implemented: routeMessage` | — |
| `mention.test.ts` | R10–R14 | 4/5 | stub `suggestAgents`/`firstUnknownTag`/`directText`/`responderOf` | R14 (`classifyMessage("@a x")` = text — hồi quy H2a, giữ) |
| `agent-access-h2b.test.ts` | R15–R19 | 5/6 | R15–R17 `expect`: `visibleAgents` bỏ qua `excludeIds`/`onlyKeys` (B0 chỉ kiểu); R18 stub `orchestratorIds`; R19b `expect`: `accessInput` không điền `excludeIds`, bỏ qua `opts.onlyKeys` | R19a hồi quy H1 (input không trường mới) |
| `agent-menu.test.ts` | R20–R21 | 3/3 | stub `toAgentMenuItem`/`agentMenu` | — |
| `orchestrator-pick.test.ts` | R22–R24 | 2/3 | stub `pickOrchestrator` | R24 (`orchestratorProblem` không đổi) |
| `delta.test.ts` | R25–R29 | 5/5 | stub `streamAccept`/`nextSeqOk`/`reconcileStream` | — |
| `run-errors-h2b.test.ts` | R30 | 2/2 | stub `runErrorTextFor` | — |
| `seed-tenants.test.ts` | R31–R35 | 7/7 | stub `planOrchestratorTenants` | — |
| `run-limit.test.ts` | R36 | 2/2 | stub `overLimit`/`parseMaxConcurrentRuns` | — |
| `contracts-h2b.test.ts` | R40–R44 | 0/5 | — | R40–R44 (contract C1/C2 đã có) |

Không ca xanh bất thường (8 xanh đúng danh sách §8). Không đỏ do import/cú pháp/kiểu.

**Lệch plan / cần backend-lead:**
- `agentMenu(s: AccessSnapshot, …)`: `AccessSnapshot.agents` không có `name` ⇒ không tra được `AgentConfig` nếu giữ đúng kiểu. Test truyền `ConfigSnapshot` (gán được vào `AccessSnapshot`). B3: đổi tham số sang `ConfigSnapshot` (hoặc `AccessSnapshot & {agents: AgentConfig[]}`) — test không phải sửa.
- `planOrchestratorTenants`: thứ tự lỗi plan có "không `profile`" nhưng input không có danh sách profile và `SeedAgent.profile` bắt buộc ⇒ R33 không phủ vế này (chỉ phủ: trùng → agent lạ; tắt thắng runtime sai). Vị trí lỗi: test chỉ ép `path` chứa `orchestrator_tenants` + chỉ số, `value` = `tenant_key` trùng / key agent lạ; vế tắt/runtime không ép `value`.
- `pickOrchestrator` khi mặc định thiếu: test chỉ ép `null` khi **không** có bản tenant hợp lệ cho tenant hỏi (plan không chốt bản tenant hợp lệ + mặc định thiếu).

### QW-A1 · 2026-10-05 (sau QW-R `3c8335d`, D1 `adba6a3`)
`bun --config=bunfig.int.toml test --timeout 30000 ./tests/acceptance/H2b/<file>` (DB riêng `ai_system_h2b_qwa1_{,hub_}test`, chạy tuần tự): **83 test / 10 file** + helper `_h2b.ts` — **71 đỏ đúng lý do, 12 xanh**. `tsc -p tsconfig.tests.json` 0 lỗi · biome sạch · `check:size`/`check:fn` OK.

| File | ID | Đỏ / tổng | Lý do đỏ | Xanh trước code (lý do) |
|---|---|---|---|---|
| `mention` | A01–A07 | 11/12 | tin `@…` đi Orchestrator (200 SSE thay 404/422); `@@abc` → `<message>` `@@abc`; flow lạ → `NOT_FOUND`, flow bận → 409 trước tag | A06 (`x @assistant` = chữ, hành vi H2a) |
| `direct` | A20–A31 | 14/14 | job đầu là Orchestrator; `run.started` không `responder` | — |
| `scope` | A40–A44 | 5/5 | `<agents>` đủ AU; delegate `writer` chạy job; `@orchestrator` → 200 | — |
| `agents-menu` | A50–A56 | 7/7 | `GET /agents` 404 (A51: 404 thay 401) | — |
| `orchestrator-tenant` | A60–A67 | 6/8 | bản tenant bị bỏ qua (luôn `orchestrator`); A66 menu 404 | A61 (beta = mặc định), A65 (Hub lên dù bản tenant hỏng) |
| `seed-tenant` | A70–A76 | 10/11 | `SeedValidationError … Unrecognized key "orchestrator_tenants"` (A73 ép lỗi không phải "unrecognized"); A76 menu 404 | A75 (yaml không khoá → hàng tenant giữ) |
| `run-limit` | A80–A88 | 11/12 | không 429 (200; A81 10 × 200); A87 env sai server không thoát, `=1` không chặn | A82 (409, đúng §8) |
| `confirm-tag` | A90–A96 | 7/9 | `@trello …` → run `orchestrated`; "Đồng ý" so trên cả tin → `declined`; `@nope` → 200 | A91 (không tag = H2a), A93 vế `@trello @helper` (`declined` tình cờ) |
| `db` | A140–A143 | 0/4 | — | cả 4 (D1) |
| `compat` | A150 | 0/1 | — | A150 (hành vi H2a) |

Không đỏ do import/cú pháp/kiểu/fixture; xanh bất thường ngoài §8: A06, A61, A65, A75, A91, A93 (2 tag) — đều là ca phủ định/hồi quy, kết quả đúng với code hiện tại.

**Helper `_h2b.ts` (QW-A2 dùng lại):** `setupH2b({catalogBaseUrl?})` (fixture H1 + Hub H1 [+ catalog/agent H2a] + `writer`/`llmbot`/`orch-acme`/`orch-alt`, `assistant` = Trợ lý/Assistant, kết thúc `runLive` của `lan`) · `startHubH2b(k, extra)` (`maxConcurrentRuns: 2`, `jobMaxWaitS: 30`, qua `startHubH2a` — không sửa helper khoá) · `settleRuns` (`afterEach`: huỷ E15 run của hub, sót → SQL) · `tenantOrch`/`dropTenantOrch` · `runsRunning` · `expectAgentNotFound`/`expectMissingContent`/`routingError` · `menuKeys` · `messageOf`/`jobsOf` · `captureLogs` · `ScriptRuntime3` (`delta`, `skipSeq`, `rawDecide`).

**Lệch plan / cần backend-lead:**
- A71 "seed lại y hệt → version không tăng" trái test khoá H1 A42 (mỗi lần seed `hub_config_version` +1): test chỉ ép hàng tenant giữ `version`/`updated_at`, không ép `hub_config_version`.
- A56: `pg_terminate_backend` phiên `hub_api` làm postgres.js trong tiến trình test ném `TypeError socket.write` (sập server) ⇒ đổi sang giữ khoá `ACCESS EXCLUSIVE` bảng cấu hình/nhóm/`conversations` (đối chứng `GET /conversations` bị chặn, `/agents` phải 200 ≤ 1,5 s).
- A60/A63 "dừng sau 3 bước": Orchestrator giả luôn delegate `hoadon` (∉ AU; `writer` ∈ AU `lan`), ép `<steps_left>` đầu = 3 (an: 5) + `run_steps` ≤ 3. A67 chỉ vế `direct` (vế `command` + tenant chặn bởi `runs_orch_tenant_ck`, A140).
- A73 vế "không profile" không dựng được qua yaml (`profile` bắt buộc) — như QW-R. A91, A93–A96 dựng `pending` bằng run SQL (Q-T8 H2a); A90, A92 đi trọn `@trello`. A04 thêm `@assistant @helpr x` → `[helper]` (chứng minh xét tag thứ 2).

### QW-A2 · 2026-10-05 (sau QW-A1 `53fcb4d`, C2 `5e7dbf5`)
`bun --config=bunfig.int.toml test --timeout 30000 ./tests/acceptance/H2b/<file>` (DB riêng `ai_system_h2b_qwa2_{,hub_}test`, tuần tự); perf `PERF=1 … --config=bunfig.perf.toml`: **39 test / 4 file** + helper `_stream.ts` — **30 đỏ đúng lý do, 9 xanh**; smoke `tests/smoke/h2b-live.test.ts` 3 ca (vắng `HUB_LIVE` → 3 skip; không khoá, Q-T6). `tsc -p tsconfig.tests.json` 0 lỗi · biome sạch · `check:size`/`check:fn` OK · `trace --check` OK.

| File | ID | Đỏ / tổng | Lý do đỏ | Xanh trước code (lý do) |
|---|---|---|---|---|
| `delta` | A100–A117 | 20/25 | `payload.stream` vắng (A100); `@assistant` → job Orchestrator (A100 direct, A102 direct, A103, A109, A113 `need_input`); không SSE `delta` trước kết quả job (A101, A104, A107, A108, A110 ×2, A111, A112, A113 F=S, A114, A116, A117); A115 trung vị = ∞ (delta không tới) | A100 `/dich-async` (job `workflow.async` không khoá `stream`), A102 Orchestrator `kind=done`, A105, A106, A113 Orchestrator `ask` — phủ định/hồi quy H1 |
| `dify-stream` | A120–A123 | 3/4 | `@dify-tro-ly` → không `responder` (đi Orchestrator) (A120, A123); A121 `delta` chỉ tới sau `step.finished` của step delegate (Dify chưa stream) | A122 (delegate thứ 2 không stream — phủ định) |
| `refused` | A130–A132 | 4/7 | A130 `@assistant` → job Orchestrator; A131 `hint` = câu H1 thay câu `refused` (vi/en) | A132 ×3 (`null`/`upstream`/`NOT_CONFIGURED credential` giữ câu H1) |
| `perf.perf` | PF1–PF3 | 3/3 | PF1 `GET /agents` 404; PF2 run `@assistant` là `orchestrated`; PF3 p95 = ∞ | — |

Không đỏ do import/cú pháp/kiểu/fixture (`PostgresError`/`TypeError` = 0).

**Lệch plan / cần backend-lead:**
- A114 (cases chưa chốt kịch bản): `job.delta{answer}` của job delegate (đã có kết quả `partial`) XADD **sau khi** job Orchestrator vòng 2 được tạo, **trước** `job.started` của nó ⇒ `DeltaSink` phải lọc theo `job_id` (subscription đọc `run:<id>` từ đầu).
- A101 "delta đầu trước `run.finished` ≥ 200 ms" và A120/A121 "trước khi MK gửi chunk cuối" đo bằng đồng hồ test (poll 5 ms): A120/A121 ép delta đầu sớm hơn kết thúc ≥ 600 ms (`mk-slow-300`, 5 chunk ⇒ ~1,5 s). "Delta khi step còn mở" = `delta` đầu đứng trước `step.finished` của step đó trong SSE.
- A110 vế `timed_out`: `job.failed{status: timed_out, code: TIMEOUT, reason: timeout}` → `run.failed TIMEOUT` (mã H1). A112: `seq` hở tạo bằng `skipSeq` (bỏ seq 3); `job.result` sau đó mang seq 5 — Hub vẫn phải nhận kết quả.
- A100 `/dich-async` cần catalog `extras` (file `delta` gọi `insertCatalog(…, {extras: true})` sau `setupH2b()`).
- PF2 đo thời gian tới header SSE E12, so p95 (`@assistant` − tin thường), 30 mẫu mỗi loại, dọn run giữa mẫu (limit 2).
- SM (không khoá): env `HUB_URL`, `AUTH_URL` (→ `ADMIN_API_URL` → `HUB_URL`), `SMOKE_USER` (JSON; vắng → `lan`/acme mật khẩu dev), `DATABASE_URL` (owner, SM3 đọc `usage_logs`). SM2 kiểm `delta` đầu đứng trước `step.finished` **cuối** (không chỉ "trước `run.finished`" — luôn đúng ở H1). I2 chỉnh khi chạy thật.
- Không thuộc QW-A2: H01 (`hubdev/`, F3) ở QW-P theo `tasks`; F5 phía Hub không có ca A (usage huỷ/timeout kiểm ở P27/P28, SM3).

### Q2 · 2026-10-05
`bun run test:lock:verify` trước ghi: **27 dòng `UNLOCKED`, đều `tests/acceptance/H2b/**`** (helper `_h2b.ts`, `_stream.ts`, `rules/_access.ts`; 10 file `rules/`; 14 file int/perf), 0 `MISMATCH`/file khác ⇒ `bun run test:lock:write` → verify xanh; `git diff tests/.lock` chỉ thêm 27 dòng H2b. Chưa có `stack/`, `hubdev/` (QW-P → Q3). `tests/smoke/**` không khoá (Q-T6).

### QW-PU · 2026-10-05 (sau Q2, C2, spike PY-S2)
`bun run --cwd apps/agent-runtime` qua `scripts/run.ts` · `pytest tests/acceptance/test_stream_rules.py`: **97 test (27 hàm) / 1 file** — **97 đỏ đúng lý do, 0 xanh**. ruff check/format · pyright strict 0 lỗi · `check:size` OK (599/600). Tự kiểm: bản tham chiếu tạm theo §3.2–§5 (không commit) → P01–P08 87/87 xanh (ca không mâu thuẫn plan).

| File | ID | Đỏ / tổng | Lý do đỏ | Xanh trước code |
|---|---|---|---|---|
| `test_stream_rules.py` | P01–P04 (+ bảng `off` chung P01/P02) | 41/41 | `ModuleNotFoundError providers.stream_scan` | — |
| | P05–P06 | 17/17 | `ModuleNotFoundError runtimes.cli.delta` | — |
| | P07 | 23/23 | `ModuleNotFoundError runtimes.cli.refusal` (22) / `providers.patterns` (1) | — |
| | P08 | 6/6 | `ModuleNotFoundError providers.claude.usage_acc` | — |
| | P09 | 10/10 | `Settings` thiếu `delta_flush_ms`/`delta_flush_chars` (`AssertionError` 9, `AttributeError` 1) — xanh ở PY-03 (L8) | — |

**Lệch plan / cần backend-lead:**
- P08 nguồn theo spike S1: `message_start` (out 8) → `message_delta` cùng id (out 702, kèm `output_tokens_details`/`iterations` — phải bỏ qua) → tổng 702, không 710; `cache_creation_input_tokens` → `UsageEv.cache_write`; khoá vắng = 0; `ev.model` = `model` truyền vào. Không có ca `AssistantMessage.usage` (PY-02 unit).
- P01/P02 ép `state="off"` cho JSON hỏng trước khi stream (thiếu `:`, khoá không ngoặc kép) và `status` lạ (`weird`); `state="seeking"` lúc mới tạo; `kind=None` khi `off`.
- P03 surrogate lẻ: high + chữ thường / high + `\u00e1` / low trơ / high cuối chuỗi → `U+FFFD` (high cuối chuỗi: phát khi đóng chuỗi).
- P06 `wait_s()` khi đã tới hạn ≤ 0 (cho phép 0 hoặc âm); không ép `due()` khi bộ đệm rỗng. "Ký tự" của `flush_chars` chỉ kiểm bằng ASCII.
- P07 thêm ca biên 300: mẫu kết thúc đúng ký tự 300 → khớp; vắt qua 300 → không; `patterns.RATE_RE`/`AUTH_RE` cùng `pattern` với `mapping`.
- P05 không assert zod/pydantic đếm UTF-16 (BC6, H3).

### Q-PU · 2026-10-05
`bun run test:lock:verify` trước ghi: **đúng 1 dòng** `UNLOCKED apps/agent-runtime/tests/acceptance/test_stream_rules.py`, 0 `MISMATCH`/file khác ⇒ `bun run test:lock:write` → verify xanh (304 file); `git diff tests/.lock` chỉ thêm 1 dòng.

### QW-P · 2026-10-05 (sau PY-01 `646d445`, PY-02 `90594d5`; chưa PY-03/PY-04, B5–B11)
P: `bun apps/agent-runtime/scripts/run.ts "<env DB @postgres> uv run pytest -m int …"` (DB riêng `ai_system_h2b_qwp_{,hub_}test`, đã drop) · S: `HUB_MAX_CONCURRENT_RUNS=2 bun --env-file=.env.test-h2b_qwp.local --config=bunfig.stack.toml test --timeout 120000 tests/acceptance/H2b/stack/<file>` (từng file, tuần tự) · H: `hub:dev` (`HUB_DEV_RUNTIME=none`) + `HUB_URL`/`AUTH_URL` `--config=bunfig.stack.toml`. **9 file** (helper `_stream.py`, `stack/_stack.ts`; 3 file P, 3 file S, 1 file H) — **P 21 test: 14 đỏ, 7 xanh · S 14 test: 13 đỏ, 1 xanh · H 2 xanh**. ruff check/format · pyright strict 0 lỗi · `tsc -p tsconfig.tests.json` 0 lỗi · biome sạch · `check:size` OK · `trace --check` OK. DB/Redis/MK/Runtime (host + container) khởi động xanh; payload `stream:true` được Runtime nhận (job `succeeded`).

| File | ID | Đỏ / tổng | Lý do đỏ | Xanh trước code (lý do) |
|---|---|---|---|---|
| `stream_int_test.py` | P20–P25 | 7/13 | `#fake:stream*`/`answer-len`/`stream-badjson` chưa có (PY-04) + cha chưa XADD (PY-03): sự kiện chỉ `['job.started','job.result']` (P20, P22 done/partial, P23 ×2, P24, P25) | P21 ×2 (`stream` vắng/false — hồi quy H1), P22 ×3 phủ định (`need_input`, `delegate`, `text-first`), P25 đối chứng `#fake:badjson=1` (H1 AC-10, log `job.output_retry` có ⇒ cách đọc log P25 đúng) |
| `refusal_int_test.py` | P26 | 4/4 | `#fake:is-error` chưa có (L2, PY-04): job `succeeded` thay `failed` (rate/auth/refused/có output) | — |
| `usage_h2b_int_test.py` | P27–P28 | 3/4 | `#fake:turns` chưa có (PY-04): `usage_logs` (100, 50) thay (200, 100) (huỷ, timeout); (10, 5) thay (30, 15) | P27 huỷ trước usage → 0 dòng (hành vi H1) |
| `stack/stream.stack.test.ts` | S01–S04, S06, S07 | 9/10 | `delta` chỉ tới sau `step.finished` (S01, S03; S01 thời gian 30 ms < 200); `@assistant`/`@dify-tro-ly` đi Orchestrator — `responder` vắng, không job `assistant` (S02 ×2, S07; B6); `detail.stream` vắng (S04 diverge/badjson; B9 + PY-04); `#fake:stream=50` không kéo dài ⇒ run xong trước khi huỷ (`run.finished` thay `run.failed`) | S06 (`text-first` — phủ định) |
| `stack/confirm-tag.stack.test.ts` | S05 | 3/3 | `@trello …` → run `orchestrated`, Orchestrator giả trả `denied:tool_not_allowed` ⇒ không `ask` (B6/B8 + PY-04) | — |
| `stack/refused.stack.test.ts` | S08 | 1/1 | `#fake:is-error` chưa có: `run.finished` thay `run.failed` (PY-04 + PY-03 F4 + B11) | — |
| `hubdev/fixture.hubdev.test.ts` | H01 | 0/2 | — | H01 ×2 (F3 + B3 đã xong: `lan` thấy `assistant`, `hoa` `items=[]`) |

Không đỏ do import/cú pháp/kiểu/fixture/boot.

**Lệch plan / cần backend-lead:**
- `_stream.py` (test-plan-py §2) chèn job qua `add_job` (khoá) với `notify=False` trong transaction ngoài, vá `payload.stream`, rồi NOTIFY — không sửa `_rt.py`. `stream=None` ⇒ payload không khoá `stream`.
- P27 timeout: contract `timeout_s ≥ 10` ⇒ dùng `timeout_s=10` + `#fake:sleep=30` (plan ghi "timeout_s nhỏ"). Huỷ P27 chờ `job.progress` đầu (sleep phát sau 1 s, mọi lượt usage đã phát trước) thay "chờ ~200 ms".
- P26 "log có chữ đã che ≤ 300": kiểm chữ result có trong log Runtime (stdout + `AGENT_RT_LOG_DIR`), không ép tên trường; không lộ ở `jobs.error_message`, mọi XADD `run:<id>`.
- S: H1 Hub vẫn phát `delta` (cắt content) **sau** kết quả job ⇒ "có delta" không phân biệt; mọi ca ép vị trí delta so với `step.finished` (S01–S03), thời gian (S01, S07) hoặc `detail.stream` (S04). S04 huỷ: `#fake:stream=50 #fake:answer-len=2000` (≈ 2,5 s stream). S07 dùng MK trong tiến trình (`setAppKey troLy mk-slow-300`), content = `MOCK_TEXT` như A120.
- S05 vế 1 ép thêm MK `inputs.title = "A"` và đúng 1 job `trello` ở run 2; vế 3 (`@helper Đồng ý`) chỉ ép MK không đổi + run kết thúc (không ép `run.finished`/`failed`).
- H01 xanh trước code (F3, B3 đã có) — cần `hub:dev` chạy (bước `needsDev` của `done:h2b`).

### Q3 · 2026-10-05
`bun run test:lock:verify` trước ghi: **đúng 9 dòng `UNLOCKED`, đều file QW-P** (`apps/agent-runtime/tests/acceptance/{_stream,stream_int_test,refusal_int_test,usage_h2b_int_test}.py`, `tests/acceptance/H2b/stack/{_stack,stream.stack.test,confirm-tag.stack.test,refused.stack.test}.ts`, `tests/acceptance/H2b/hubdev/fixture.hubdev.test.ts`), 0 `MISMATCH`/file khác (thay đổi `apps/hub-api` của B4 không thuộc file khoá) ⇒ `bun run test:lock:write` → verify xanh (313 file); `git diff tests/.lock` chỉ thêm 9 dòng.

### Tranh chấp
- **TC-1 · 2026-10-05 · B1-4 (a) · `orchestrator-pick.test.ts` R23** — **test sai.** Ca chờ `pickOrchestrator(snapshot({orchestrator:null}), BETA)` = `null`, nhưng `snapshot()` có bản BETA hợp lệ (`orch-beta` bật) ⇒ theo "WRITE — QW-R chốt" (bản tenant hợp lệ dùng được kể cả khi mặc định thiếu) phải trả `{config: orch-beta, tenantId: BETA, invalid:false}`; code B1 đúng chốt. Sửa: giữ biểu thức cũ, chờ bản BETA; thêm vế `null` trên ảnh chỉ có bản ACME (mặc định thiếu) hỏi BETA. Giữ id R23.
- **TC-2 · 2026-10-05 · B1-4 (b) · `agent-access-h2b.test.ts` R19 (accessInput)** — **test sai.** Ảnh chỉ có bản ACME (chính ca assert `excludeIds = {orch, orch-acme}`) nên `orch-beta` không phải Orchestrator, có entitlement + grant ⇒ AU giữ (khớp R15 dùng `H1_LAN` ∋ `orch-beta`). Sửa kỳ vọng: `["assistant","helper","orch-beta","writer"]`. Giữ id R19.
- Kiểm: `bun test tests/acceptance/H2b/rules` — R15–R19, R22–R24 xanh (31 đỏ còn lại là stub B2+); biome sạch; `tests/.lock` chỉ đổi 2 dòng hash (tính bằng `hashFile`), `test:lock:verify` xanh (304 file). Không sửa code sản phẩm.
- **TC-3 · 2026-10-05 · B4-6 (a) · `agents-menu.int.test.ts` A54** — **test sai** (phụ thuộc thứ tự ca). A54 đọc `GET /agents` ngay đầu ca (`toEqual(LAN_AU)` không chờ) trong khi `finally` của A53 vừa khôi phục grant/entitlement qua `hubConfigChange`; cache Hub nạp lại qua NOTIFY bất đồng bộ (spec §6 cho ≤ 5 s) ⇒ đọc thấy `["assistant"]`. Xác minh: bản khoá cũ chạy cả file đỏ đúng A54 (`Expected -2`), chạy riêng xanh. Sửa: ca tự dọn trạng thái — `finally` A53 (và tương tự A54 sau `dropTenantOrch`, vì A56 kỳ vọng đúng `LAN_AU`) chờ `menuWithin("lan", = LAN_AU)` trước khi kết thúc; giữ nguyên assert tiền điều kiện của A54 và id ca. Code sản phẩm đúng spec.
- Kiểm: `agents-menu.int` cả file 7/7 xanh 3 lần liên tiếp (DB riêng `ai_system_h2b_a54_*`, đã drop); `tests/.lock` chỉ đổi 1 dòng hash (`hashFile`); `test:lock:verify` không `MISMATCH` (chỉ `UNLOCKED` file chưa khoá của luồng khác). Không sửa code sản phẩm.
- **TC-4 · 2026-10-05 · B5-5 (a) · `run-limit.int.test.ts` A80** — **test sai.** `post("lan", "Tin thứ ba A80", …)` không truyền `conv` ⇒ helper `post` tự `insertConv` **sau** `before = counts(sql)` ⇒ `conversations` +1 do chính test (flows/messages/runs/jobs không đổi — Hub đúng 0 ghi). Sửa: `conv = newConv("lan")` trước `counts`, truyền `{ conv }` (như A86). Giữ id A80.
- **TC-5 · 2026-10-05 · B5-5 (b) · `run-limit.int.test.ts` A84** — **test sai.** Vế test-run dùng app-key `dich` = `mk-slow-2000` của `beforeAll` (mock: 5 khối × 2 000 ms ≈ 10 s) với `timeout_s: 10` ⇒ Hub trả ~10 s, trùng `AbortSignal.timeout(10_000)` của `call` ⇒ `TimeoutError` ở `await testRun` (assert 429/200 trước đó xanh). Sửa: `setAppKey(sql, "dich", "mk-slow-800")` trước test-run (~4 s: vẫn đang chạy khi 2 POST, xong trước hạn 10 s; mẫu H2a A75), khôi phục `mk-slow-2000` sau `await testRun`. Giữ nguyên `timeout_s`, mọi assert và id A84.
- Kiểm: `run-limit.int` (DB riêng `ai_system_h2b_a80_*`, đã drop) 11/12 — A80, A84 xanh; A83 vẫn đỏ đúng lý do (`kind` = `orchestrated` thay vì `direct`, cần B6). `tests/.lock` chỉ đổi 1 dòng hash (`hashFile`), `test:lock:verify` xanh (313 file). Không sửa code sản phẩm.
- **TC-6 · 2026-10-05 · B7-5 (B6-5) · `orchestrator-tenant.int.test.ts` A66** — **test sai** (điều kiện chờ không phản ánh thay đổi cuối). Ca ghi grant/entitlement (`hubConfigChange`, v+1) rồi `tenantOrch` (v+2) liền nhau; `waitFor(menuKeys, !includes("orch-acme"))` thoả **ngay** cả khi cache Hub chưa nạp gì (chưa có grant ⇒ orch-acme cũng không trong menu). Nếu POST rơi vào lúc cache ở v+1 (có grant, chưa có bản tenant) thì `@orch-acme x` hợp lệ ⇒ 200 thay vì 404. Xác minh: bản khoá cũ chạy cả file đỏ A66 2/4 lần (`toEqual`), chạy riêng xanh. Cache nạp lại **cả snapshot** theo `hub_config_version` (`config.service.ts` `reloadHub`) ⇒ thấy bản tenant ⇒ snapshot có cả grant. Sửa: sau `tenantOrch` chờ `orchWithin("lan", "orch-acme")` (thăm dò thấy Orchestrator của `lan` = `orch-acme`) rồi mới kiểm menu và 404; giữ mọi assert và id A66. Code sản phẩm đúng spec.
- Kiểm: `orchestrator-tenant.int` cả file 8/8 xanh 3 lần liên tiếp (DB riêng `ai_system_h2b_a66_*`, đã drop); `tests/.lock` cập nhật đúng 1 dòng hash file này.
- **TC-7 · 2026-10-05 · B4-6 (b) (B11-3) · `mention.int.test.ts` A07** — **test sai** (đếm khi run của chính ca chưa ghi xong). `call` huỷ body SSE ngay khi nhận header 200; Hub tạo job Orchestrator của run **bất đồng bộ sau** khi trả header (driver ghi `hub.jobs` + NOTIFY), nên `rejected("@nope x", {flow: busyFlow})` ngay sau `first` (và `rejected("@assistant")` sau `second`) có thể đếm `before` trước khi job đó vào ⇒ `jobs` +1 (conversations/flows/messages/runs không đổi; 404/422 đúng, request bị từ chối không ghi gì). Không phải run của ca trước (`settleRuns` đã huỷ). Xác minh: bản khoá cũ chạy cả file đỏ 2/9 lần, luôn tại dòng 198 (`rejected` sau `first`), `jobs` lệch đúng 1. Sửa: helper `jobQueued(res)` — `waitFor(jobsOf(run x-run-id) ≠ [])` ≤ 5 s sau `first` và `second`, trước khi `rejected` đếm; giữ mọi assert và id A07. Code sản phẩm đúng spec (R18: lỗi trước khi tạo run).
- Kiểm: `mention.int` cả file 12/12 xanh 6 lần liên tiếp (DB riêng `ai_system_h2b_i1_*`); `tests/.lock` chỉ đổi 1 dòng hash (`hashFile`), `test:lock:verify` xanh (313 file).
- **TC-8 · 2026-10-05 · REVIEW 1 RV1-P2 · `test_stream_rules.py` P07 (+ `refusal_int_test.py` P26)** — **test sai theo Gate.** Gate H2b duyệt "F4 giữ mã H1 + `refused`": `refused` là loại **thêm** cho lời từ chối, không thay mã H1 của mọi lỗi `is_error` 0 output. P07 ép `("403 Forbidden",0)`, `(None,0)`, `("",0)`, `("Error 4290",0)` = `refused` ⇒ 500/`overloaded_error`/"Prompt is too long"/"No conversation found"/chữ rỗng đều thành "diễn đạt lại" (sai hướng, che lỗi provider; AC-08 nói "mẫu … từ chối", chữ R27 "còn lại ∧ 0 output" quá rộng). Tín hiệu đã xác minh: Anthropic `stop_reason` ∈ {`end_turn`, `max_tokens`, `stop_sequence`, `tool_use`, `pause_turn`, `compaction`, `refusal`, `model_context_window_exceeded`} (danh sách trong `claude.exe`; CLI xử `stop_reason==="refusal"`), đi qua stream `message_delta.delta.stop_reason`; SDK `claude_agent_sdk` 0.2.163 có `ResultMessage.stop_reason`, `AssistantMessage.stop_reason` (`str | None`). Sửa: P07 thêm cột `stop_reason` — `classify_is_error(text, output_tokens, stop_reason=None)` (2 tham số cũ vẫn gọi được; ca `stop_reason=None` gọi cả hai dạng); `refused` chỉ khi `stop_reason == "refusal"` ∧ output 0; rate/auth trước, bất kể tín hiệu; không tín hiệu ∧ không khớp ⇒ `None`; output > 0 ⇒ `None` kể cả có tín hiệu; ca dựng theo nhóm chữ (rate 6, auth 5, khác 8 — thêm "Prompt is too long") × 5 cặp (output, `stop_reason`) = 95 ca (file khoá ≤ 600 dòng). P26: docstring + ca mới `#fake:is-error=error` (0 output, không tín hiệu) ⇒ `UPSTREAM_ERROR` reason `null`; ca `refused` giữ (fake phát kèm `stop_reason="refusal"`). A130–A132 (Hub XADD tay `reason:refused`), S08 (`#fake:is-error=refused`) không đổi.
- Kiểm: P07 đỏ đúng lý do 95/96 trước code (`TypeError` tham số `stop_reason`; 1 ca còn lại là `test_p07_patterns_module_single_source`); ruff/format/pyright sạch; `tests/.lock` chỉ đổi 2 dòng hash (`hashFile`), `test:lock:verify` xanh (313 file).

### I1 · 2026-10-05 (sau B0–B11, PY-01…04, C1–C2, D1, MK, F3; TC-7 `15c20d5`)
`bun run done:h2b` — DB riêng: `TEST_DATABASE_URL` = `ai_system_h2b_i1_test` (`db:test:create h2b_i1`), `HUB_TEST_DATABASE_URL`/`AGENT_RT_TEST_DATABASE_URL` = `ai_system_h2b_i1_hub_test` (tạo tay); chỉ export `*DATABASE_URL`; Redis mặc định; compose chạy. Lần 1 bước 1–8 xanh, dừng ở 9; sau dọn dữ liệu dev chạy lại `--from=9` → 9–16 xanh. DB test đã drop.

| # | Bước | Kết quả |
|---|---|---|
| 1 | typecheck (turbo, 6 gói) | xanh |
| 2 | unit (`packages/*`, `tools/hub-dev`, access, C1, `H1/H2a/H2b rules`) | xanh — 537 pass, 13 skip, 0 fail |
| 3 | int `H1/ H2a/ H2b/ M ADM-NFR-06` | xanh — 1912 pass, 0 fail (20,5 phút; `mention.int` A07 xanh) |
| 4 | `contracts:check` | xanh (pytest 19 + 25 bun) |
| 5 | agent-runtime: ruff, format, pyright, lint-imports, pytest, pytest -m int | xanh — 627 unit + 133 int (P20–P28) |
| 6 | `test:h1:stack` | xanh — 4/4 |
| 7 | `test:h2a:stack` | xanh — 3/3 |
| 8 | `test:h2b:stack` (S01–S08, limit 2 tường minh) | xanh — 14/14 |
| 9 | `test:contract:chat` (hub-dev, Hub thật) | lần 1 **đỏ (a) hạ tầng/dữ liệu**: CHAT-AC-19 (`conversations.contract.test.ts:149`, limit=1 đi cursor ≠ danh sách `limit=200`) — DB dev `ai_system` tích 229 hội thoại của `lan` do 9 lần chạy contract trước (bộ contract không xoá hội thoại tự tạo) ⇒ `limit=200` cắt, phân trang thấy 201. Không do code H2b. Dọn: soft-delete 228 hội thoại tên mẫu contract (`… #n`) của `lan` trong DB dev. Lần 2 **xanh — 41 pass, 21 skip (mock-only)**; **0 phản hồi 429** (Q-T1/K4b: hub-dev limit 20) |
| 10 | H01 `H2b/hubdev` | xanh — 2/2 |
| 11 | `test:lock:verify` | xanh (313 file) |
| 12 | `trace --check` | xanh |
| 13 | `check:size --all` | xanh |
| 14 | depcruise | xanh |
| 15 | `tsc -p tsconfig.tests.json` (báo cáo) | xanh |
| 16 | `test:perf H2a H2b` (báo cáo) | lần 1: 385/386 — đỏ ADM-FR-53 (M3, `config-write.int.test.ts:315`, trung vị 5,61 ms > 5 ms, nhiễu máy bận, không thuộc H2b); lần 2 386/386. PF1–PF3 xanh cả 2 lần |

K11: `bun run test:smoke:live` vắng `HUB_LIVE` → "bỏ qua", exit 0 ✓. Lỗi code: không. Ghi chú cho chủ bộ contract: CHAT-AC-19 phụ thuộc tổng hội thoại của `lan` ≤ 200 — chạy lặp trên DB dev sẽ đỏ lại sau ~8 lần (đề xuất bộ contract xoá hội thoại tự tạo hoặc so sánh trong cửa sổ hội thoại của chính ca).
