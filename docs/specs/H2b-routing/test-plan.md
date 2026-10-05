# Test plan · H2b-routing (qc)

Chế độ **TEST-PLAN** · 2026-10-05. Chưa có file test, chưa khoá; viết + "đỏ đúng lý do" sau Gate (§8), rồi Q2 → Q-PU → Q3. Bảng ca: hàm thuần (R), int hub-api (A), hồi quy khoá (K), thủ công (M), không phủ → [`test-plan-cases.md`](test-plan-cases.md); Python (P), stack (S), smoke → [`test-plan-py.md`](test-plan-py.md).
"Đúng" = spec §2 (H2b-R01…R30), §8 (AC + HUB-H2b-AC-01…13); chữ ký `plan-rules.md`; câu chữ/trace `plan-errors.md`; SQL `plan-db.md` §2–4; luồng `plan.md` §5; Runtime `plan-runtime.md` §3–6. BA chỉ ở AC được trỏ (`ba-agent-hub` §11).

## 1. Quy ước
Như H2a §1 (tên test, hộp đen, chờ không `sleep`, cấm `skip/only/todo`), thêm:

| Mục | Quy ước H2b |
|---|---|
| Tên test | TS `"<mã BA> · <ID> · mô tả [H2b-Rxx]"` — **mã BA đứng đầu** (`trace --check`: HUB-FR-91/92/94 đang thiếu test); Python `test_<mã_snake>_…` + docstring mã |
| Loại | **R** unit TS · **A** int hub-api (DB/Redis thật, `ScriptRuntime` XADD tay, MK) · **P** Python (unit thuần + int Runtime thật `fake-cli`) · **S** stack (Hub thật + Runtime container + MK) · **H** hub-dev (`tools/hub-dev` thật, fixture R26) · **K** khoá có sẵn · **M** thủ công · **SM** smoke `HUB_LIVE=1` |
| Vị trí | R `tests/acceptance/H2b/rules/*.test.ts` · A `tests/acceptance/H2b/*.int.test.ts` · S `tests/acceptance/H2b/stack/*.stack.test.ts` · H `tests/acceptance/H2b/hubdev/*.hubdev.test.ts` · P `apps/agent-runtime/tests/acceptance/{test_stream_rules.py,*_int_test.py}` · perf `tests/acceptance/H2b/perf.perf.int.test.ts` · SM `tests/smoke/h2b-live.test.ts` |
| Dữ liệu | Fixture H1 (`T`, `USERS`, `AG`, `insertHubConfig`) + H2a (`_h2a.ts` catalog/agent `trello`, `dify-*`) + `_h2b.ts` mới (§2.1): agent `writer` (grant `lan`), `llmbot` (runtime `llm`, grant `lan`), `orch-acme`, `orch-alt` (agentic-cli, profile `fake-1`), tên vi/en khác nhau cho `assistant` |
| Id (bài học TC-3) | Run/flow/job do test chèn SQL dùng `crypto.randomUUID()`/`uuid4()`; ca bắt buộc id cố định → `DEL run:<id> sse:<id>` trước khi dùng. Run do Hub tạo: id ngẫu nhiên sẵn |
| Đếm MK (TC-2) | Đếm lời gọi theo input/kịch bản của ca, không đếm tổng sau `reset()` |
| Log | `setSink` (`apps/hub-api/src/lib/logger`) bắt `warn`/`info` theo tên `plan-errors` §3; Runtime: dòng JSON `event=` |
| Seam deps | `startHubH2b` (`_h2b.ts`, mẫu `startHubH2a`; không sửa helper khoá) truyền `maxConcurrentRuns: 2` (L1; vắng = không giới hạn) |

## 2. Hạ tầng và giả lập
| Mục | Đề xuất | Ai |
|---|---|---|
| DB TS (bài học I1 H2a) | `TEST_DATABASE_URL`/`TEST_ADMIN_API_DATABASE_URL` = `ai_system_h2b_<nhóm>_test`; DB Hub/Runtime **riêng** `ai_system_h2b_<nhóm>_hub_test` (`HUB_TEST_DATABASE_URL`, `AGENT_RT_TEST_DATABASE_URL`) — chung DB → `DuplicateTableError` ở `ensure_schema` | qc |
| Env | File `.env.test-h2b_<nhóm>.local`; khi chạy chỉ **export 4 biến DB** (không `source` cả file: PEM nhiều dòng hỏng). `scripts/run.ts` (Windows → container) **truyền env DB ngay trong chuỗi lệnh** (`AGENT_RT_TEST_DATABASE_URL=… HUB_TEST_DATABASE_URL=… uv run pytest -m int …`) | qc |
| Redis | `redis://localhost:6379/15` dùng chung → id ngẫu nhiên / xoá key (TC-3) | qc |
| Runtime kịch bản (A) | `_h2b.ts` bọc `ScriptRuntime` (không sửa `_runtime.ts` khoá): `delta(job, kind, text)` qua `emit` (cần C2: `job.delta` trong `RunEventSchema`), `skipSeq(job, n)` (hở `seq`, P11), `rawDecide(job, text)` (JSON hỏng) | qc |
| MK TS | `tools/hub-dev/src/dify-mock.ts` (khoá) — đủ: `mk-ok`, `mk-slow-<ms>` (5 chunk), `mk-agent`; side_effect qua catalog H2a (`create-trello-card`). **Không cần kịch bản mới** | — |
| Mock Python | `tests/support/{dify_mock,mcp_mock}.py` (khoá) — H2b P không dùng (Dify trong Hub; `fake-cli` không MCP ở P) | — |
| `fake-cli` | Chỉ thị `plan-runtime` §6 (`#fake:stream[=n]`, `stream-order`, `stream-diverge`, `stream-badjson`, `answer-len`, `turns`) + có sẵn (`partial`, `need_input`, `delegate`, `tool`, `args`, `usage`, `sleep`) + **`#fake:is-error=<rate\|auth\|refused>`** (Lệch L2) | backend-lead PY-04 |
| Stack (S) | Mẫu `H2a/stack/_stack.ts`: hub-api **trên host**, catalog `base_url` = `http://localhost:<MK>/v1`; chỉ container Runtime dùng `host.docker.internal` (`--add-host …:host-gateway`) (TC-4). Runtime `AGENT_RT_PROVIDERS=fake-cli`; nếu đặt `AGENT_RT_ORPHAN_S=5` thì **`AGENT_RT_HEARTBEAT_S=1`** (TC-5/7). Hub `HUB_MAX_CONCURRENT_RUNS=2` **tường minh** (không thừa hưởng 20 của hub-dev, L6) | qc / MK |
| Hub-dev (H) | `startHubDev`/`ensureContractFixture` như bước contract của `done:h2a` (`needsDev`) | MK |
| Lock | `tests/acceptance/H2b/**`, `apps/agent-runtime/tests/acceptance/*` mới; mock không đổi. `tests/smoke/**` **không** khoá (Q-T6) | qc |

### 2.1 Fixture `_h2b.ts` (SQL owner, sau `insertHubConfig` + `insertH2aAgents`/`insertCatalog` khi cần)
| Mục | Giá trị |
|---|---|
| `writer` | agentic-cli, profile `fake-1`, entitlement acme, grant `lan` (AU `lan` = assistant, helper, writer) |
| `llmbot` | runtime `llm`, entitlement acme, grant `lan` |
| `orch-acme`, `orch-alt` | agentic-cli, profile `fake-1`, không grant |
| Tên | `assistant` = `{vi:"Trợ lý", en:"Assistant"}` (A20–A22) |
| Helper | `startHubH2b(k, extra)` (L1) · `tenantOrch(sql, tenant, agent, opts)` + config change; `ScriptRuntime3` (`delta`, `skipSeq`, `rawDecide`); `runsRunning(user)`; `endRunsSql(user)` |
| uuid | `crypto.randomUUID()` cho dữ liệu chèn trong ca; id agent cố định dải `a2b0…` |

## 3. Ma trận mã → test
| Mã | Test | Loại |
|---|---|---|
| HUB-FR-91 · HUB-BR-18 · AC-H17/H18/H19 · HUB-H2b-AC-01 | R01–R14, A01–A07, A20–A31, A40–A44 | R, A |
| HUB-FR-92 · HUB-FR-77 · HUB-H2b-AC-02 | R15–R21, A50–A56, H01, PF1 | R, A, H |
| HUB-FR-94 · AC-H21 · HUB-H2b-AC-03 | R36, A07, A80–A88, PF2 | R, A |
| HUB-FR-62 · HUB-BR-08 · AC-H16 (vế runtime) · HUB-H2b-AC-10 | R18, R22–R24, R31–R35, A60–A67, A70–A76 | R, A |
| HUB-BR-03 (Orchestrator ở mọi phạm vi) | R15, R18, R21, A43, A54, A66 | R, A |
| HUB-BR-06 (chốt lúc tạo run) | A22, A28, A63 | A |
| HUB-FR-95 · HUB-BR-20 · AC-H22 (vế `@`) | A90–A96, S05 | A, S |
| WRK-FR-03 (delta) · HUB-H2b-AC-04/05/06/07/11 | R25–R29, A100–A117, A120–A123, P01–P06, P20–P25, S01–S04, S06, PF3 | R, A, P, S |
| WRK-FR-15 (F4) · HUB-H2b-AC-08 | R30, P07, P26, A130–A132, S08 | R, P, A, S |
| WRK-FR-17 (F5) · AC-W09 · HUB-H2b-AC-09 | P08, P27, P28 | P |
| HUB-H2b-AC-12 · R29 (F7) | SM1–SM3, M02, K11 | SM, M, K |
| HUB-H2b-AC-13 · R26 (F3) · R30 | A150, H01, K01–K10 | A, H, K |
| Contract chat/hub (spec §3) | R40–R44 | R |
| DB `0006` (spec §4) | A140–A143 | A |
| TD #44 (B0, không đổi hành vi) · TD #47 | K04, K05, K09 · S05 (vế 1 delegate) | K, S |

**Luật → ca** (mỗi luật ≥ 1 ca):

| Luật | Ca | Luật | Ca | Luật | Ca |
|---|---|---|---|---|---|
| R01 | R01–R08, A02, A05, A06 | R11 | R20, R21, A50–A56 | R21 | P05, P06, P23–P25 |
| R02 | R11, A01, A04, A55 | R12 | A90–A96, S05 | R22 | R25, A101–A106 |
| R03 | R10, A01 | R13 | R31–R35, A70–A76 | R23 | R27, A107–A112, S04 |
| R04 | R04, R05, A03 | R14 | R22–R24, A60–A64 | R24 | A120–A123 |
| R05 | A01, A03, A04 | R15 | R15, R18, R21, A43, A54, A65, A66 | R25 | P20–P22, S01–S04, S06 |
| R06 | A20, A26–A30 | R16 | R36, A83, A84, A87 | R26 | H01, K03 |
| R07 | R12, A23–A25 | R17 | A80, A81, A86 | R27 | R30, P07, P26, A130–A132, S08 |
| R08 | A24 | R18 | A07, A82 | R28 | P08, P27, P28 |
| R09 | R16, R17, A40–A44 | R19 | R25, A100 | R29 | SM1–SM3, K11, M02 |
| R10 | R13, A20–A22 | R20 | P01–P04, P20, P22, S06 | R30 | A150, K01–K10 |

**Không phủ ở H2b:**

| Mã / vế | Lý do · mốc |
|---|---|
| AC-H16 vế `tenant_admin` bị từ chối, API/Studio sửa Orchestrator | H4 |
| Bộ câu kiểm thử định tuyến | H4 |
| Menu `@`, hiển thị `responder`/lỗi mới/`delta` khi step mở trên Chat | combine (CR-impact I3), e2e Chat |
| `claude-sub` stream thật | SM/M02, không chặn |
| `/agent-grants`, quota | H3 |

## 4. R · Hàm thuần TS (chữ ký `plan-rules.md`) — bảng ca: cases §1
| ID | File (`rules/`) | Hàm | Số ca |
|---|---|---|---|
| R01–R08 | `mention-parse.test.ts` | `routeMessage`, `parseMention` (HUB-H2b-AC-01) | 8 (bảng ~40 dòng) |
| R10–R14 | `mention.test.ts` | `suggestAgents`, `firstUnknownTag`, `directText`, `responderOf` | 5 |
| R15–R19 | `agent-access-h2b.test.ts` | `visibleAgents` (`excludeIds`, `onlyKeys`), `canDelegate`, `orchestratorIds`, `accessInput` | 5 |
| R20–R21 | `agent-menu.test.ts` | `toAgentMenuItem`, `agentMenu` | 2 |
| R22–R24 | `orchestrator-pick.test.ts` | `pickOrchestrator`, `orchestratorProblem` (không đổi) | 3 |
| R25–R29 | `delta.test.ts` | `streamAccept`, `nextSeqOk`, `reconcileStream` | 5 |
| R30 | `run-errors-h2b.test.ts` | `runErrorTextFor` | 1 |
| R31–R35 | `seed-tenants.test.ts` | `planOrchestratorTenants` | 5 |
| R36 | `run-limit.test.ts` | `overLimit`, `parseMaxConcurrentRuns` | 1 |
| R40–R44 | `contracts-h2b.test.ts` | chat chỉ thêm; hub `JobDeltaEvent`, `stream`, `refused`; fixture | 5 |

## 5. A · hub-api int — bảng ca: cases §2
| File (`H2b/`) | ID | Mã đầu tên |
|---|---|---|
| `mention.int.test.ts` | A01–A07 | HUB-FR-91 / HUB-BR-18 / HUB-FR-94 (A07) |
| `direct.int.test.ts` | A20–A31 | HUB-FR-91 |
| `scope.int.test.ts` | A40–A44 | HUB-FR-91 / HUB-BR-03 |
| `agents-menu.int.test.ts` | A50–A56 | HUB-FR-92 / HUB-FR-77 |
| `orchestrator-tenant.int.test.ts` | A60–A67 | HUB-FR-62 / HUB-BR-08 / HUB-BR-06 |
| `seed-tenant.int.test.ts` | A70–A76 | HUB-FR-62 |
| `run-limit.int.test.ts` | A80–A88 | HUB-FR-94 |
| `confirm-tag.int.test.ts` | A90–A96 | HUB-BR-20 / HUB-FR-95 |
| `delta.int.test.ts` | A100–A117 | WRK-FR-03 |
| `dify-stream.int.test.ts` | A120–A123 | WRK-FR-03 / HUB-FR-91 |
| `refused.int.test.ts` | A130–A132 | WRK-FR-15 |
| `db.int.test.ts` | A140–A143 | HUB-FR-91 / HUB-FR-62 / WRK-FR-15 |
| `compat.int.test.ts` | A150 | HUB-FR-91 |
| `perf.perf.int.test.ts` | PF1–PF3 | HUB-FR-92 / HUB-FR-94 / WRK-FR-03 (không chặn) |

## 6. P · S · H · SM · K · M
P01–P09 (unit, `test_stream_rules.py`), P20–P28 (int), S01–S08, SM1–SM3: [`test-plan-py.md`](test-plan-py.md). H01, K01–K11, M01–M03: cases §3–§4.

## 7. Lệnh
### 7.1 `bun run done:h2b` (`tools/scripts/src/done-h2b.ts`, mẫu `done-h2a.ts`; tuần tự, DB không song song) — **mọi bước `done:h2a`** + phần H2b (**in đậm**)
| # | Bước | Chặn |
|---|---|---|
| 1 | `bunx turbo run typecheck --filter=@ai/hub-api --filter=@ai/contracts --filter=@ai/db --filter=@ai/scripts --filter=@ai/chat-web --filter=@ai/mocks` (TC-6: `@ai/scripts`, không `@ai/hub-dev`) | ✓ |
| 2 | `bun test packages/contracts packages/db tools/hub-dev apps/admin-api/src/modules/access tests/acceptance/C1 tests/acceptance/H1/rules tests/acceptance/H2a/rules` **`tests/acceptance/H2b/rules`** | ✓ |
| 3 | `bun --env-file=.env.local --config=bunfig.int.toml test --timeout 30000 tests/acceptance/H1/ tests/acceptance/H2a/ ` **`tests/acceptance/H2b/`** `tests/acceptance/M tests/acceptance/ADM-NFR-06` (`bunfig.int.toml` bỏ qua `H2b/stack/**`, `H2b/hubdev/**`) | ✓ |
| 4 | `bun run contracts:check` | ✓ |
| 5 | `bun apps/agent-runtime/scripts/run.ts "<env DB> uv sync --frozen && uv run ruff check . && uv run ruff format --check . && uv run pyright && uv run lint-imports && uv run pytest && uv run pytest -m int"` (gồm `test_stream_rules.py`, P20–P28) | ✓ |
| 6–8 | `bun run test:h1:stack` · `bun run test:h2a:stack` · **`bun run test:h2b:stack`** (S01–S08) | ✓ |
| 9 | `HUB_URL=… AUTH_URL=… CHAT_CONTRACT_USERS='<json>' bun run test:contract:chat` (hub-dev, `needsDev`; 41 pass — HUB-H2b-AC-13) | ✓ |
| 10 | **`bun --env-file=.env.local test tests/acceptance/H2b/hubdev`** (H01, `needsDev`, cùng HUB_URL/AUTH_URL) | ✓ |
| 11–14 | `bun run test:lock:verify` · `bun run trace --check` · `bun run check:size --all` · `bunx depcruise apps/hub-api packages/contracts/src/hub packages/contracts/src/hub-internal packages/db tools/hub-dev` | ✓ |
| 15 | `tsc -p tsconfig.tests.json` | báo cáo |
| 16 | `bun run test:perf tests/acceptance/H2a` **`tests/acceptance/H2b`** | báo cáo |

Không thuộc `done:h2b`: `HUB_LIVE=1 bun run test:smoke:live` (I2, AC-12); vắng cờ → exit 0 (K11, qc kiểm một lần ở I1).

### 7.2 Thủ công: spike PY-S2 (M01), smoke `HUB_LIVE` (M02), `docs/guides/hub-dev.md` (M03) — cases §4.

## 8. Nhóm WRITE · đợt khoá (sau Gate)
| Nhóm | Khi | File | Ca (≈) | Phải đỏ đúng lý do vì |
|---|---|---|---|---|
| QW-R | sau B0 (stub), C1, C2 | 10 file `rules/` | 40 ID / ~95 dòng bảng | stub `throw not implemented`. **Xanh trước code chấp nhận**: R40–R44 (contract C1/C2 đã có), R19 (hồi quy H1), R24 (`orchestratorProblem` không đổi) |
| QW-A1 | sau QW-R, D1 | `mention`, `direct`, `scope`, `agents-menu`, `orchestrator-tenant`, `seed-tenant`, `run-limit`, `confirm-tag`, `db`, `compat` | ~62 | `@` đi Orchestrator như text (200 SSE thay vì 404/422/direct), `GET /agents` 404, không 429, seed từ chối `orchestrator_tenants`. Xanh trước code: A140–A143 (D1), A150 (hành vi H2a), A82 vế 409 |
| QW-A2 | sau QW-A1, C2 | `delta`, `dify-stream`, `refused`, perf | ~30 | Hub bỏ `job.delta` (không SSE `delta` trước `job.result`), `payload.stream` vắng, hint `refused` = câu H1 |
| **Q2** | sau QW-A2 | khoá `tests/acceptance/H2b/**` (trừ `stack/`, `hubdev/`) | — | verify: chỉ `UNLOCKED` file mới |
| QW-PU | sau Q2, C2, **trước PY-01** | `test_stream_rules.py` | P01–P09 (~70 dòng) | `ModuleNotFoundError` (`providers.stream_scan`, `runtimes.cli.{delta,refusal}`, `providers.claude.usage_acc`) — import trong thân test (`importlib`) |
| **Q-PU** | sau QW-PU | `test:lock:verify` đúng **1** dòng `UNLOCKED` → `test:lock:write` | — | — |
| QW-P | sau PY-02 | `stream_int_test.py`, `refusal_int_test.py`, `usage_h2b_int_test.py`; `stack/*` (S01–S08), `hubdev/` (H01) | P20–P28 ~25 · S 8 · H 1 | P: chưa có `job.delta`/phân loại F4/usage cộng dồn (chờ hết hạn, `expect`); S: SSE thiếu `delta`/`ask`; H: `lan` không thấy `assistant` (F3 chưa) hoặc `GET /agents` 404. Fixture/DB/MK/Runtime boot phải xanh |
| **Q3** | sau QW-P, **trước PY-03** | khoá P int + `stack/` + `hubdev/` | — | verify: chỉ `UNLOCKED` file QW-P |
| SM | QW-A2 | `tests/smoke/h2b-live.test.ts` | 3 | không khoá; vắng `HUB_LIVE` → skip |

Tổng mới ≈ **210** ca (R ~95 dòng bảng / 40 ID, A ~92, P ~35, S 8, H 1, perf 3) + K + M 3 + SM 3. Model: QW-R/A1/A2/PU/P = Opus (`cao`), Q2/Q-PU/Q3/I1 = Sonnet.

## 9. Rủi ro test · câu hỏi (mặc định dùng nếu không trả lời)
| # | Rủi ro / câu hỏi | Mặc định |
|---|---|---|
| Q-T1 | `test:contract:chat` 41 ca gặp 429 với limit 2 | Phân tích: ca Hub thật đều chờ sự kiện kết thúc, tuần tự trong file; ca huỷ/`#scn:` chỉ mock (`describe.if(isMock)`); K-R6 đóng body nhưng run vẫn xong nhanh (`fake-cli`) ⇒ nguy cơ thấp. F3 chạy **với 2 trước**, ghi kết quả; đỏ do 429 → hub-dev đặt 20 (plan §2.1), không sửa test; stack/int H2b vẫn 2 tường minh |
| Q-T2 | R import `*.rules.ts` chưa có | B0 stub chữ ký (như H2a Q-T2) |
| Q-T3 | AC-03 không tất định (song song) | 5 vòng × 10 POST, uuid mới mỗi vòng, dọn run bằng SQL owner giữa vòng; kiểm đúng 2/8 mỗi vòng + `pgDeadlocks` không tăng |
| Q-T4 | Ngưỡng thời gian trên Windows (≤ 5 s menu, ≤ 150 ms delta, ≥ 200 ms delta sớm) | Poll 100 ms; ≤ 150 ms đo trung vị 10 chunk (A115); ≥ 200 ms dùng `n=10` (L3); perf không chặn |
| Q-T5 | PY-S2 ✗ (#1/#2) | Không đổi test chặn (chỉ `fake-cli`/Dify); SM1/SM2 ghi ✗ theo `spike-stream.md` |
| Q-T6 | Smoke có khoá? | Không khoá (`tests/smoke` ∉ `LOCKED_DIRS`; chạy tay, I2 chỉnh theo spike) |
| Q-T7 | `UsageAcc.add` với `message_id=None` | Mỗi lần gọi `None` = message mới (cộng) — P08 ghi giả định; plan khác → sửa ca trước Q-PU |
| Q-T8 | `parseMention` với token `@@b` sau tag (`"@a @@b x"`) | Không kiểm (plan không chốt); ngoài phạm vi AC-01 |
| Q-T9 | `""` cho `HUB_MAX_CONCURRENT_RUNS` | Không kiểm (plan chỉ chốt "vắng → 2") |
| Q-T10 | Mục `orchestrator_tenants` có tenant lạ **và** agent lạ | Lỗi seed (kiểm agent mọi mục trước khi xét tenant) — R35 |
| R-WIN | P/S không chạy trên Windows | P qua `scripts/run.ts` (container), S ở WSL2/Docker như H2a |

### Lệch plan (readiness xử)
| # | Lệch | Đề xuất |
|---|---|---|
| L1 | `AppDeps` chưa có trường giới hạn run (H2a: `createApp` không đọc env — seam deps) | Thêm `maxConcurrentRuns?: number` (= `HUB_MAX_CONCURRENT_RUNS`, vắng → env → 2) vào `AppDeps` (B5) |
| L2 | `plan-runtime` §6 không có chỉ thị tạo `Final.is_error` 0 token với chữ result tuỳ ý — P26/S08 (AC-08) không dựng được | PY-04 thêm `#fake:is-error=<rate\|auth\|refused>`: `Final{is_error:true, text:<mẫu cố định: "You've hit your usage limit" / "Not logged in · Please run /login" / "I can't help with that.">}`, output token 0; kèm `#fake:usage=a,b` (b>0) → output > 0 |
| L3 | Spec §6 "delta đầu trước `run.finished` ≥ 200 ms" với `#fake:stream=5`: 5 đoạn × 50 ms = 200 ms tổng, gom 100 ms ⇒ khoảng ~100 ms, không đạt | AC-04 giữ `=5` cho các vế khác; vế thời gian dùng `#fake:stream=10` (S01) / 5 chunk cách 100 ms (A101) |
| L4 | `tasks` QW-A2 ghi "stack delta" trước Q2, nhưng stack cần PY-03/04 | Ngữ nghĩa Hub (lọc `kind`, `seq`, `reconcileStream`, pass-through) ở **A** (XADD tay, QW-A2, Q2); end-to-end ở **S** (QW-P, Q3) |
| L5 | AC-02 "`hoa` → `items=[]`" chỉ đúng ở fixture hub-dev; fixture int H1 cấp agent cho `hoa` | A52 dùng `tadmin` (0 grant); vế `hoa` ở H01 (hub-dev) |
| L6 | R26 kiểm trên hub-dev cần bước `needsDev` + thư mục mới; hub-dev có thể đặt 20 làm stack H2b thừa hưởng | MK: `done-h2b.ts` bước 10, `bunfig.int.toml`/`bunfig.toml` bỏ `tests/acceptance/H2b/{stack,hubdev}/**`; stack H2b đặt `HUB_MAX_CONCURRENT_RUNS=2` |
| L7 | `PROTECTED_PREFIXES` (`app.ts`) chưa có `/agents` ⇒ không JWT có thể 404 thay vì 401 | B3 thêm `/agents` (A51 kỳ vọng 401 `AUTH_EXPIRED`) |
| L8 | P09 (env `AGENT_RT_DELTA_*`, `config.py`) thuộc PY-03, không thuộc PY-01 (như H2a QW-PU) | PY-01 xong = P01–P08 xanh; P09 xanh ở PY-03 |

Readiness lần 1: L1 áp **có sửa** (vắng ⇒ không giới hạn; `envAppDeps` điền; helper `startHubH2b`); L2 áp + usage `out:0`, không `RateLimit` (`plan-runtime` §6); L3–L8 áp nguyên (spec §6, tasks QW/MK/B3/PY-01).

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
