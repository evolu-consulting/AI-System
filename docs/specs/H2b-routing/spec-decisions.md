# H2b — Quyết định

## Trước SPEC — người dùng đã chốt (không hỏi lại)
| # | Quyết định | Áp vào |
|---|---|---|
| U1 | Orchestrator route **mọi** tin (kể cả trong flow, kể cả trả lời `ask` của run `direct`) | R08, R12 |
| U2 | User biết agent thì tag `@agent` để gọi thẳng, bỏ qua Orchestrator | R06 |
| U3 | Orchestrator theo tenant = bản mặc định + bản riêng per tenant | R13–R15 |
| U4 | Quyền command và quyền agent độc lập (HUB-BR-19) | R02, R11 (AU không xét feature) |
| U5 | Mặc định review business #2–#8 (CR-034) đã đồng ý: `max_concurrent_runs` = 2, xác nhận `side_effect` | R16, R12 |
| U6 | Contract `chat`: sửa thẳng `packages/contracts/src/chat`, **chỉ thêm**; không sửa `apps/chat-web`, `tests/contract/chat`, `tests/acceptance/C1`; thay đổi làm đỏ chúng → nêu, không làm | §3 |
| U7 | Codex/Gemini → H2d; không ghi ý tưởng "Agent Builder" | §1 |

## Trả lời người dùng (2026-10-05)
| # | Trả lời | Áp vào |
|---|---|---|
| Q1 | **B** — Hub gửi trường **tuỳ chọn** `responder: {key, name}` trong `run.started` và trong tin trả lời (E11, preview E10), **chỉ** với run gọi thẳng (`kind=direct`); contract chat **chỉ thêm** (không đổi/xoá trường, không sự kiện SSE mới, khoá `agent` vẫn cấm). `name` = tên agent theo `locale` của run, chốt lúc tạo run (`runs.responder_key`/`responder_name`) | spec R10, §3, §4; plan P1–P2 |

## Câu hỏi cho người dùng (đã trả lời — giữ để truy vết)
Chỉ một câu cần người dùng chọn. Không trả lời → dùng mặc định.

### Q1 · Tên agent khi user tự tag `@agent` lấy từ đâu? (mức Cao — chạm contract chat)
BA (CR-033): user tự tag thì câu trả lời hiện **tên hiển thị của agent**; Orchestrator tự chọn thì vẫn "Consultant". ROADMAP H2b ghi contract chat "chỉ thêm `GET /agents` + mã lỗi" — chưa tính trường nào mang tên agent. Contract C1 hiện cấm khoá `agent` ở SSE/E10/E11/E14 (test khoá `FORBIDDEN_KEYS`).

| Lựa chọn | Nội dung | Hệ quả |
|---|---|---|
| **B (đề xuất)** | Hub gửi trường **tuỳ chọn** `responder: {key, name}` trong `run.started` và message assistant (E11, preview E10), **chỉ** với run `direct`. Khoá tên `responder` (không phải `agent`) | Nguồn chân lý ở Hub (đã xử lý `@@`, nhiều tag, tag sai, đổi quyền, đổi tên — tên chốt lúc tạo run). Vẫn "chỉ thêm"; test khoá C1 không đỏ (trường vắng ở tin không tag; `FORBIDDEN_KEYS` so đúng khoá `agent`). Vượt câu chữ "chỉ `GET /agents` + mã lỗi" của ROADMAP → ROADMAP sửa theo. Chat hiển thị khi combine |
| A | Không thêm trường: Chat tự suy ra từ tin user (`@key` đầu tin) + `GET /agents` | Contract đúng phạm vi ROADMAP. Chat phải lặp luật Router (R01–R04: `@@`, nhiều tag → "Consultant", tag trùng); lịch sử hiện tên **hiện tại** (agent bị thu hồi khỏi menu → chỉ còn key); tin đã bị Hub từ chối không có run nên không lệch |
| C | Thêm trường `responder` cho **mọi** run có pass-through (cả khi Orchestrator chọn) | Trái BA (Orchestrator chọn vẫn "Consultant", CR-022/CR-033) → cần CR sửa BA; không đề xuất |

**Mặc định đề xuất: B.**

## Mặc định tự chọn (mức Thường — ghi lại, không hỏi)
| # | Câu hỏi | Mặc định đã chọn | Lý do |
|---|---|---|---|
| T1 | Nhiều tag, một tag sai | Cả tin `AGENT_NOT_FOUND` (tag sai đầu tiên) | Nhất quán BR-18 "sai tag không rơi xuống Orchestrator"; không âm thầm bỏ tag |
| T2 | Tag rỗng nội dung (`@hoadon`) | 422 `CMD_MISSING_ARG` `missing:["content"]` | BA HUB-FR-91 ghi đúng mã này; dùng lại schema `details` H2a |
| T3 | `partial` ở run `direct` (không có Orchestrator) | `text` + câu tĩnh "Phần chưa làm được: …" | BR-04 không giấu phần thiếu; không gọi Orchestrator (U2) |
| T4 | Trả lời xác nhận khi có tag | So "Đồng ý" trên nội dung sau tag; chỉ tag đơn đúng agent đang chờ mới `confirmed` | Tránh "@trello Đồng ý" bị `declined` vì so cả chuỗi; tag agent khác không được mượn xác nhận |
| T5 | Agent là Orchestrator của tenant khác có vào menu/tag/delegate? | Không, ở mọi phạm vi | Đơn giản, đúng "agent Orchestrator không nằm trong danh sách delegate"; tránh agent điều phối chạy CLI không tool như agent thường |
| T6 | Xoá bản Orchestrator riêng khi seed là nguồn duy nhất (H1-R16 không xoá) | `{tenant_key, remove: true}` tường minh | Giữ luật "không xoá thứ không có trong yaml" (H4 Studio sẽ ghi cùng bảng) |
| T7 | Bản riêng mất hiệu lực lúc chạy (agent bị tắt sau seed) | Dùng mặc định + log cảnh báo | Không chặn user; BR-08 chỉ bắt buộc bản mặc định |
| T8 | Nguồn `max_concurrent_runs` | env `HUB_MAX_CONCURRENT_RUNS` (mặc định 2), toàn hệ thống | BA "cấu hình Hub"; theo tenant/user để H3/H4 nếu cần |
| T9 | Run nào tính vào giới hạn | Mọi `kind` đang `running` (cả lệnh async) | BA "số run running"; lệnh async dài vẫn chiếm tài nguyên |
| T10 | `Retry-After` | 5 giây cố định | Run ngắn nhất ~ vài giây; client chỉ cần gợi ý |
| T11 | Thứ tự lỗi E12 | Router (`CMD_*`/`AGENT_NOT_FOUND`) → `FLOW_BUSY` → `TOO_MANY_RUNS` | Lỗi sửa được bằng gõ lại báo trước; không mở transaction cho tin sai. BA §5 đặt 429 trước Router — lệch chữ, ghi CR-037 |
| T12 | Cách stream khi kết quả có cấu trúc | Runtime chỉ phát khi `decision`/`status` đứng trước `text`; Hub lọc theo vai job; lệch/JSON hỏng sau khi phát → giữ chữ đã phát | Bất biến C1 "content = nối delta" không cho rút lại chữ đã gửi; lùi về H1 khi không chắc |
| T13 | Độ dài `delta` khi stream | Hub vẫn cắt ≤ 40 ký tự | Giữ test khoá H1 A15, H2a A17/A31 |
| T14 | F4 mã lỗi | Không thêm mã `run.failed` mới (đổi enum C1); phân loại vào mã có sẵn + `hint` riêng, reason nội bộ `refused` | Không chạm `CHAT_RUN_ERROR_CODES` |
| T15 | F5 khi chưa có usage | Không ghi dòng | WRK-FR-17 + "không bịa"; tránh dòng 0 token đếm sai lượt ở báo cáo M4 |
| T16 | F7 | `HUB_LIVE=1` thành cờ bộ smoke tự động (skip khi vắng) | Cần smoke stream thật cho R20 (K1); không chặn `done:h2b` |
| T17 | Agent `dify-*` có stream khi gọi thẳng/pass-through? | Có (R24) | Kết quả luôn `done` nên an toàn; code đọc SSE Dify đã có (H2a) |
| T18 | Nợ H2a đưa vào H2b | #44 (tách thư mục con module chạm tới), #47 (`fake-cli` delegate lại) | #47 làm sai test R12; #44 vì module `runner`/`commands` sẽ thêm file. #43, #45, #46, #49–#51 để sau |

## CR
- **CR-037** (đề xuất, chờ Gate H2b): sửa chữ BA cho khớp spec — thuật ngữ Run có 3 loại; thứ tự kiểm 429 sau Router (T11); agent là Orchestrator ở mọi phạm vi không delegate/tag được (T5); WRK-FR-03 chi tiết `delta` chỉ cho job có thể là câu trả lời cuối, Hub cắt ≤ 40 (T12, T13); HUB-FR-62 xoá bản tenant qua seed `remove` (T6). Áp vào design sau Gate (docs-architect).
- CR-impact Chat/Admin của H2b (menu `@`, `AGENT_NOT_FOUND`, `TOO_MANY_RUNS` + `Retry-After`, `responder` nếu Q1=B, `delta` đến khi step còn mở) ghi ở I3 như CR-036.

## Gate duyệt — 2026-10-05
- Người dùng duyệt Gate H2b ("Oke"): CR-037 (sửa chữ BA), Q1 = B, contract chat chỉ thêm, F4 giữ mã H1 + `refused`, `maxConcurrentRuns` vắng = không giới hạn (server luôn điền từ env, mặc định 2).

## BUILD — C1/C2
| # | Task | Quyết định tự chọn | Lý do |
|---|---|---|---|
| BC1 | C1 | `AGENT_KEY_PATTERN` chép vào `src/common.ts` (cùng tên, cùng regex với `hub/common`); chat dùng `ChatAgentKeySchema` (tên riêng, ở `chat/agents.ts`) | plan §2.1 cấm import `../hub`; tên riêng tránh trùng `AgentKeySchema` của hub khi một file import cả hai subpath |
| BC2 | C1 | `ResponderSchema` + `RESPONDER_NAME_MAX` đặt ở `entities.ts` (theo plan), `entities` import key từ `./agents` — `agents.ts` chỉ phụ thuộc `../common` (không vòng) | Đúng bảng plan §2.1 |
| BC3 | C1 | Thêm hằng `AGENT_SUGGESTIONS_MAX = 3`, `AGENT_MENU_NAME_MAX`, `AGENT_MENU_DESC_MIN/MAX` (plan chỉ ghi số) | Không rải số ma thuật; BE/FE dùng chung |
| BC4 | C1 | Test mới ở `chat/agents.test.ts` (không sửa `entities.test.ts`) | Giữ `entities.test.ts:142` nguyên văn |
| BC5 | C2 | Fixture `JobPayload.stream-string.json` dùng `"stream": "always"` (không `"true"`) | pydantic chế độ lax ép `"true"` → `True` ⇒ mẫu invalid lọt (`test_contracts_hub.py` đỏ); chuỗi không ép được giữ đúng ý "stream là chuỗi" |
| BC6 | C2 | **Phát hiện:** zod 4.6.5 `z.string().max()` đếm **code point** (đo: 4 000 emoji hợp lệ, 4 001 bị từ chối), pydantic `max_length` cũng đếm code point — plan §2.2/`rt` §9 H3 ghi "zod đếm UTF-16" là sai. Không đổi schema: Runtime cắt theo UTF-16 (`split_utf16`) luôn ≤ 4 000 code point ⇒ vẫn hợp lệ ở cả hai phía (an toàn, chỉ bảo thủ hơn). Sửa chú thích `JOB_DELTA_TEXT_MAX`; test `hub/delta.test.ts` khoá đúng hành vi đo được | Không chặn; PY-01/QW-PU giữ `split_utf16` được. Áp tương tự cho mọi "cắt UTF-16" phía Hub (responder, delta 40) — chỉ bảo thủ hơn |
| BC7 | C2 | `apps/hub-api` typecheck xanh không cần sửa (union `RunEvent` mới không làm đỏ — chưa có `switch` vét cạn theo `type`); pyright Runtime 0 lỗi với `RunEvent5` sinh | Ghi lại theo yêu cầu (H2a C2 từng phải sửa) |

## BUILD — MK/F3
- **MK-1** `done:h2b` (`tools/scripts/src/done-h2b.ts`) dựng từ `h2aSteps()` (16 bước test-plan §7.1): unit/int/perf nối thêm `H2b`, chèn `test:h2b:stack` sau `test:h2a:stack`, H01 sau contract chat. Cơ chế chạy tách thành `runDone(name, steps, argv)` trong `done-h2a.ts` (không đổi hành vi `done:h2a`). Python dùng lại `pythonCommand` (env DB `export` trong chuỗi lệnh `scripts/run.ts`, bài học H2a); typecheck `--filter=@ai/scripts`.
- **MK-2** (lệch chữ test-plan §7.1 bước 10): Bun áp `pathIgnorePatterns` **cả khi truyền đường dẫn tường minh** (thử tay) ⇒ `bun --env-file=.env.local test tests/acceptance/H2b/hubdev` với `bunfig.toml` (đã bỏ `H2b/hubdev/**`, L6) sẽ không chạy file nào. Thêm `bunfig.stack.toml` (chỉ bỏ `e2e`, `node_modules`, `__fixtures__`); bước H01 và `test:h2b:stack` chạy `--config=bunfig.stack.toml`, timeout 120 s.
- **MK-3** `test:h2b:stack` = `HUB_MAX_CONCURRENT_RUNS=2 bun … tests/acceptance/H2b/stack` (tường minh, L6). `tools/hub-dev` `hubApiEnv()`: hub-api dev nhận `HUB_MAX_CONCURRENT_RUNS` từ env, vắng ⇒ **20** (plan §2.1, K4b) — đặt sẵn để contract 41 ca không chạm 429 khi B5 cài giới hạn. hub-api `:4000` chạy sẵn thì dùng lại, không áp được giá trị này.
- **MK-4** `test:smoke:live` = `tools/scripts/src/smoke-live.ts`: vắng `HUB_LIVE` (hoặc `0`) → in "bỏ qua", exit 0 kể cả khi `tests/smoke` chưa có file; có cờ → `bun --config=bunfig.stack.toml test --timeout 300000 tests/smoke`. `tests/smoke/**` thêm vào ignore của `bunfig.toml` + `bunfig.int.toml` để `bun test`/`test:int` không vô tình gọi CLI thật.
- **F3-1** `tools/hub-dev/src/fixture.ts`: `BETA_TESTERS = { acme: ["lan"] }` → sau khi tạo user, `ensureContractFixture` tra group `beta-testers` của tenant (`GET /admin/groups?q=`) và `POST /admin/groups/:id/members {usernames}` (idempotent: đã có → `already`; `not_found` ⇒ ném lỗi). `hoa` giữ ngoài (R26). Chạy lại fixture hai lần: OK, DB `acme|lan`.
- **F3-2** Chạy `bun run test:contract:chat` với Hub thật (`hub:dev`, Runtime container `fake-cli`) trong **worktree sạch tại HEAD `50b5ad7`** (+ fixture mới) — vì cây làm việc đang có D1/C2 dở (`0006_h2b_routing.sql`, `schema/hub.ts`), `hub:dev` sẽ `db:migrate` bản dở vào DB dev. Kết quả: **41 pass, 0 fail** (62 ca, phần còn lại skip như H2a). Không sửa test khoá C1.
- **F3-3** Chưa thể đỏ do 429: giới hạn `TOO_MANY_RUNS` (B5) chưa cài. `hub:dev` đã đặt sẵn `HUB_MAX_CONCURRENT_RUNS=20` (MK-3). **Chạy lại ở I1** (bước 9 `done:h2b`) sau B5 để xác nhận K4b.

## Spike PY-S2 → plan (2026-10-05, biên bản `spike-stream.md` `e8e218e`)
`claude-sub` stream được (#1, #2 ✓) ⇒ không lùi K10. Áp đề xuất §4 của biên bản vào docs trước QW-PU (test Python chưa viết):
| # | Mức | Quyết định | Áp vào |
|---|---|---|---|
| S1 | Cao | F5 lấy usage từ `StreamEvent`: `message_start.message.usage` (nhớ `message.id`) rồi `message_delta.usage` cùng id (bản sau thay bản trước — luật `UsageAcc.add`). **Không** dùng `AssistantMessage.usage` (ảnh chụp lúc `message_start`, output gần 0). Huỷ giữa chừng = **cận dưới** (message đang dở chỉ có output ảnh chụp) | `rt` §2 #6, §5, H11; spec R28; tasks PY-01/PY-02; py P08 (chuỗi spike), P27, SM3 |
| S2 | Cao | `include_partial_messages=True` cho **mọi** job `claude-sub`; scanner/`Delta` chỉ khi `payload.stream is True ∧ retry_prompt is None`. Không chọn phương án lùi (F5 qua `AssistantMessage` + TECH-DEBT) | `rt` §1, §3.4; tasks PY-02 |
| S3 | Thường | Chọn khối theo `content_block_start` (`text` cho Orchestrator, `tool_use` `StructuredOutput` cho agent), bỏ theo index khối: `thinking`, `input_json_delta` của `Read`/MCP; `SystemMessage` `status`/`thinking_tokens`/lạ bỏ qua | `rt` §3.4; tasks PY-02 |
| S4 | Thấp | Mốc "khối xong" = `content_block_stop` (`AssistantMessage` tới trước) | `rt` §3.4 |
| S5 | Thấp | Smoke I2/AC-12 với `claude-sub` thật: chỉ "≥ 1 `job.delta` trước `job.result`", không ngưỡng độ trễ (agent có thể im ~8 s do thinking). Ngưỡng thời gian giữ cho `fake-cli` (S01, A101, spec §6) | tasks I2; py §4 SM1–SM3; cases M02 |
| BC6 | — | Áp chữ: zod 4/pydantic đếm **code point**. Runtime vẫn cắt theo UTF-16 (`split_utf16`, `responderOf`) — luôn hợp lệ, chặt hơn cần thiết; test **không** assert zod đếm UTF-16 | `rt` §3.3, §9 H3 (✓); plan §2.2 `JOB_DELTA_TEXT_MAX`; `rules` `responderOf`; cases R43 (4 000/4 001 emoji); py P05 |
Không đổi `FORMAT_BLOCK` (#4 ✓), `AGENT_RESULT_SCHEMA` (#3 ✓), `DeltaBuffer` mặc định 100 ms/200 ký tự (chunk SDK ≈ 9–12 ký tự, ≈ 20/s). spec giữ ≤ 25 600 B (R28 rút gọn chữ).

## BUILD — D1 (backend-lead, 2026-10-05)
- **D1-1** `0006_h2b_routing.sql` theo đúng `plan-db` §1 (không lệch SQL): `runs` + 4 cột NULL, `runs_kind_check` (+`direct`, tên giữ), `runs_direct_ck`, `runs_responder_ck`, `runs_orch_tenant_ck`, `runs_user_running_idx`; `orchestrator_settings.tenant_id` + sequence `smallint START 2` làm DEFAULT `id`, bỏ `orchestrator_settings_id_check`, thêm `orchestrator_settings_scope_ck` + `orchestrator_settings_tenant_uq`; `jobs_error_reason_check` = tập `0004` + `refused` (đối chiếu `JOB_FAIL_REASONS` sau C2 `5e7dbf5`: bằng nhau). Journal `idx 6`, `when` = `0005` + 1 ngày.
- **D1-2** `schema/hub.ts`: `RUN_KIND_VALUES` + `"direct"`; `runs.agentId/orchestratorTenantId/responderKey/responderName`; `orchestratorSettings.tenantId` và `id` có `.default(sql\`nextval('hub.orchestrator_settings_id_seq')\`)` (insert drizzle không bắt buộc `id` — B2 dùng được; chỗ cũ truyền `id: 1` vẫn hợp lệ). `tsc` `packages/db` + `apps/hub-api` xanh không sửa gì thêm.
- **D1-3** Test `hub-h2b.int.test.ts` (11 ca, `plan-db` §5): kiểm cả **tên ràng buộc** (`23514:runs_direct_ck` …) qua `constraint_name` của postgres.js, không chỉ mã. Idempotent kiểm hai cách: `runHubMigrations` lần 2 = `{0,0}` và chạy lại từng câu của `0006` hai lần trên DB đã áp → ảnh chụp `pg_constraint`/`pg_indexes` không đổi. `EXPLAIN countRunning` chạy với `enable_seqscan = off` (bảng test vài dòng, planner chọn seqscan) — chỉ xác nhận index dùng được cho câu đó.

## BUILD — B0 (backend-lead, 2026-10-05)
- **B0-1** TD #44 theo đúng bảng plan §4 bằng `git mv` (giữ lịch sử): `runner/job/{job-agent-runner, runner.repo, runner.test, runner.int.test}`, `runner/workflow/{workflow-job-runner(.test), workflow-job.repo}`, `dify/agent/{dify-agent-runner(.int.test), dify-agent.repo, dify-agent.rules(.test)}`, `commands/driver/{command-driver, command-async-driver, command-run.repo}`. Chỉ sửa đường dẫn import (22 file, script tự tính lại từ vị trí cũ), không đổi thân hàm. Giữ tại chỗ mọi file test khoá import (`grep tests/**`: `runner.rules`, `dify.rules`, `commands/{catalog.types, *.rules}` — không file nào bị chuyển nằm trong danh sách). README `runner/dify/commands` ghi thư mục con. `docs/CODEMAP.md` còn đường dẫn cũ → I3 (docs-architect). TD #44 đóng ở I3 cùng CODEMAP.
- **B0-2** Stub chữ ký `plan-rules` (thân `throw new Error("not implemented: <tên>")`, tham số tiền tố `_`, không ghi giá trị tham số): `mention/{mention-parse,mention}.rules.ts`, `stream/delta.rules.ts`, `agents/agent-menu.rules.ts`, `runs/run-limit.rules.ts`, `orchestratorIds` (agent-access), `pickOrchestrator` (config.rules), `runErrorTextFor` (run-errors), `planOrchestratorTenants` (seed.rules). Module `mention/`, `stream/` có README.
- **B0-3** Kiểu thêm để qc viết QW-R biên dịch được, **không đổi hành vi**: `VisibleAgentsInput.excludeIds?/onlyKeys?`, `AccessSnapshot.orchestratorTenants?`, `accessInput(s, who, _opts?)` — B0 bỏ qua (B1 áp dụng; R15–R19 đỏ đúng lý do ở assert, R19 hồi quy xanh). `ConfigSnapshot.orchestratorTenants` (bắt buộc như plan-rules): `config.repo` điền `new Map()` (cột `tenant_id` là của D1; B1 đọc hàng), `config.test` helper thêm trường. `SeedOrchestratorTenantSchema`/`SeedOrchestratorTenant` (union upsert | `remove: true`, trường tuỳ chọn không `default`) ở `seed.schema.ts` nhưng **chưa** gắn vào `SeedFileSchema` (B2) — yaml có `orchestrator_tenants` vẫn bị strict từ chối như H1.
- **B0-4** Kiểm: `typecheck` (+ `tsconfig.tests`) · `biome ci apps/hub-api/src` · `bun test apps/hub-api` 129 pass · `depcruise --all` 0 vi phạm · `check:size` OK · `check:fn`: 1 vi phạm duy nhất ở `packages/db/src/hub-h2b.int.test.ts` (file D1 đang làm, không thuộc B0); file B0 sạch. H1/H2a acceptance: xem B0-5.
- **B0-5** H1/H2a acceptance trên DB riêng (`ai_system_h2b_b0_test` + `ai_system_h2b_b0_hub_test`, chỉ export `*DATABASE_URL`), chạy tuần tự trên cây làm việc chính (có migration 0006 dở của D1 — không gây đỏ): H1 143/146, H2a 162/163; các ca đỏ đều ở `beforeAll` `ALTER ROLE admin_api …` → `XX000 tuple concurrently updated` (role cấp cluster, agent khác migrate cùng lúc), không liên quan B0. Chạy lại riêng từng file đỏ: H1 `cancel` 5/5, `lease` 4/4, `runs` 9/9; H2a `async` 13/13 ⇒ toàn bộ xanh. Int đã chuyển chỗ: `runner/job/runner.int` + `dify/agent/dify-agent-runner.int` 11/11. Lưu ý: `bun run test:int <dir>` chạy **mọi** `.int.test` (bộ lọc `.int.test` trong script OR với đường dẫn) — dùng `bun --env-file=.env.local --config=bunfig.int.toml test --timeout 30000 tests/acceptance/H1 …`.

## WRITE — QW-R chốt (điều phối, 2026-10-05)
- `agentMenu` nhận `ConfigSnapshot` (cần `name` của agent); B3 đổi chữ ký stub.
- `planOrchestratorTenants`: bỏ bước "không `profile`" (`SeedAgent.profile` bắt buộc).
- `pickOrchestrator`: bản tenant hợp lệ dùng được kể cả khi mặc định thiếu; `null` chỉ khi không có bản tenant hợp lệ và mặc định thiếu.
