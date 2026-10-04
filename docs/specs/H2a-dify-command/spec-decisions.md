# H2a — Quyết định

## Trước Gate — người dùng trả lời (2026-10-05)
| # | Câu hỏi (spec §9) | Trả lời |
|---|---|---|
| Q1 | `hub_ro` không đọc được `admin.secrets` | **Theo mặc định:** migration phía Hub (`packages/db/migrations-hub/`) cho `hub_ro` SELECT đúng các cột bản mã (ciphertext/iv/…) của secret workflow; Hub giải mã bằng master key chung lúc gọi Dify (HUB-FR-04). Ghi CR-impact để phiên Admin rà khi combine |
| Q3 | Contract chat mới (`GET /commands`, `context`, `CMD_*`) | **Khác mặc định: sửa thẳng contract chat** (`packages/contracts/src/chat`), không tạo subpath `chat-ext`. Giới hạn: chỉ **thêm** (endpoint/schema/mã lỗi mới, trường tuỳ chọn), không đổi/xoá trường cũ; **không** sửa `apps/chat-web` và test khoá C1 (`tests/contract/chat`, `tests/acceptance/C1`). Thay đổi làm đỏ test khoá C1 → hard stop, báo lại |
| Q5 | Runtime lấy app-key Dify cho `workflow.async` | **Theo mặc định:** endpoint nội bộ của Hub, xác thực bằng token riêng của job; key không nằm trong payload job hay env Runtime |
| — | Codex/Gemini (H2d) | **Chưa có subscription** → H2d chỉ làm Gateway API + fallback + `llm`/`python` bằng provider giả; Codex/Gemini để sau |
| Q2, Q4, Q6–Q12 | (mức Thường) | Dùng mặc định trong spec §9 |

## PLAN backend-lead (TS/DB/contract) — 2026-10-05
Chi tiết: `plan.md` §1 (P1–P15), trả lời plan-runtime §9 ở `plan.md` §10.
| # | Quyết định | Lý do ngắn |
|---|---|---|
| P1 | Q1 bằng hàm `hub.workflow_secret` SECURITY DEFINER (EXECUTE `hub_ro`), không GRANT cột `admin.secrets` | GRANT cột làm sai test khoá M2 `db-rls` (`select id … as hub_ro` → 42501) trên DB đã chạy migration Hub |
| P2 | Usage Dify của Hub qua hàm `hub.log_dify_usage` | Test khoá H1 A51: `hub_api` không INSERT `usage_logs` |
| P3 | Q3: `CMD_*` ở hằng riêng `CHAT_COMMAND_ERRORS`, không thêm vào `CHAT_API_ERRORS` | `chat/entities.test.ts:142` assert đúng 6 mã; `tools/mocks/src/chat/http.ts` `Record<ChatErrorCode>` |
| P4 | Token job do Runtime sinh lúc claim, chỉ lưu hash (chỉnh R18; từ chối `job_token` trong payload) | Payload nằm trong DB — token rõ trong payload = token rõ trong DB |

## Đối chiếu plan Hub ↔ Runtime — backend-lead, 2026-10-05
Runtime theo plan TS (`plan.md` §10): token sinh lúc claim (RT1), payload không token/URL, requeue hai câu (R7), reason `credential`/`upstream`, xác nhận R6. Bảng ✓/✗: `plan-runtime.md` §9; chi tiết gọi Dify tách `plan-runtime-dify.md`.
| # | Sửa phía TS / spec | Lý do |
|---|---|---|
| X1 | `plan-db` §2 câu requeue: ngưỡng heartbeat `make_interval(secs => $1)` — Hub `$1 = 60` (cùng hằng H1 phía Hub), Runtime `$1 = AGENT_RT_ORPHAN_S` (cùng `SWEEP_ORPHANS`) | Hai câu chạy nối tiếp; ngưỡng `failed` H1 là tham số — nếu < 60 s, job `workflow.async` bị `failed orphaned` trước khi kịp requeue (vỡ AC-W06) |
| X2 | `plan-errors` §5: câu chỉ dẫn là `content[1].text` (không phải `content[0]`) | Mâu thuẫn `plan.md` §2.3 (`content[0].text` = JSON để Runtime parse, R6) |
| X3 | `plan-db` §3.2: kết quả xác nhận ghi đủ `content[0]` JSON + `content[1]` + `structuredContent` | Cùng X2 |
| X4 | `spec` AC-H01: `chat-ext` → `chat` | Q3 đã chốt sửa thẳng contract chat |
| X5 | Credential 401 → Runtime `NOT_CONFIGURED`/`credential` (trước: coi như mất job) | Theo `plan-errors` §2; tránh job treo `running` khi token lệch; SQL Kết thúc có `worker_id ∧ running` nên vô hại |

## Ghi chú khi combine (readiness lần 1)
| # | Ghi chú |
|---|---|
| C1 | `/internal/*` và `/mcp` (token Bearer bản rõ) **bắt buộc TLS hoặc mạng nội bộ** khi Runtime chạy ở máy khác Hub; cùng máy (WSL2 mirrored, `localhost`) không cần. Chuyển vào `docs/PRODUCTION-NOTES.md` khi combine (không sửa file dùng chung ở H2a) |

## Gate duyệt — 2026-10-05
- Người dùng duyệt Gate H2a (ADR-0010 Accepted; Q1 bằng hàm `hub.workflow_secret` SECURITY DEFINER; Q3 contract chat chỉ thêm).
- **Dify thật:** người dùng chỉ định lấy cấu hình ở `D:\AI\evoluconsulting\auto-pilot`. Dify API `http://149.202.83.5:4203/v1` (kiểm 2026-10-05: `GET /parameters` app translate → 200, 0,54 s). App-key ở `apps/copilot-hub/.env` (`DIFY_KEY_TRANSLATE`, `DIFY_KEY_CHATBOT`, `DIFY_AGENT_API_KEY`, `DIFY_EXTRACT_API_KEY`, `DIFY_KEY_GMAIL`…) và `apps/extension-hub/.env` (`WXT_DIFY_KEY_MISAINVOICECHECK`). **Không chép key vào repo này:** smoke `DIFY_LIVE=1` đọc key lúc chạy qua env `DIFY_LIVE_ENV_FILE` (đường dẫn tới file `.env` của auto-pilot) và seed vào `admin.secrets` (mã hoá) của DB dev/smoke. Smoke M01 không còn "blocked W1" — chạy được sau khi B*/PY xong.
- **Rủi ro (combine/production):** Dify đang mở HTTP thường trên IP công khai — app-key đi không mã hoá. Ghi để xử lý trước production (TLS hoặc mạng nội bộ).

## BUILD — C2 (backend-lead, 2026-10-05)
| # | Quyết định | Lý do |
|---|---|---|
| B-C2-1 | `WorkflowAsyncJob.inputs` ≤ 50 khoá là luật Hub, không ở schema | `z.record` không có `maxProperties` hai phía (cấm `refine`, H1 §2); Hub dựng từ `input_map` ≤ `INPUT_SCHEMA_MAX` |
| B-C2-2 | `HUB_JSON_SCHEMAS` thêm `JobPayloadWorkflowAsync` (→ `$ref` trong `JobPayload`, pydantic `JobPayloadWorkflowAsync`; `agent.cli` giữ `JobPayload1`) và `DifyCredentialResponse` (từ `hub-internal`, cho PY-02) + fixture | Tên model ổn định cho `plan-runtime` §3.1; mẫu hai chiều C2 |
| B-C2-3 | Header `hub.py` sinh thêm `# pyright: reportInvalidTypeForm=false` (`tools/contracts-gen/hub.ts`) | datamodel-codegen sinh `dict[constr(pattern=…), …]` cho khoá regex; hợp lệ lúc chạy |
| B-C2-4 | `apps/hub-api` runner (H1) gõ kiểu `AgentCliJob` thay `JobPayload` | `JobPayload` thành union → `p.agent` lỗi kiểu; B6 mở rộng cho `workflow.async` |

## BUILD — PY-S1 (spike MCP, `spike-mcp.md`) — 2026-10-05
- Token MCP qua file 0600 + `strict_mcp_config=True`: **đạt** (#1, #10) — không token trên `/proc/*/cmdline` ⇒ PY-04 không `blocked`.
- Áp mặc định của biên bản (điều phối): S1 → `plan.md` §6 (`server/discover` chế độ 2026-07-28: `resultType`, `ttlMs`, `cacheScope:"private"`, `id` chuỗi; `initialize` 2025-11-25) + `test-plan.md` A52 (trước QW, test chưa viết); S2 → `plan-runtime` §5 (content str tách tại `
` đầu); S3 → §4.2 `MCP_TOOL_TIMEOUT`; S4 → §4.2 không log `get_mcp_status`; S5 → §4.3 allow = `{}`.
- Biên bản đổi tên `spike-s1.md` → `spike-mcp.md` cho khớp tasks/plan-runtime/test-plan-cases.

## BUILD — B0 (backend-lead, 2026-10-05)
| # | Quyết định | Lý do |
|---|---|---|
| B-B0-1 | Stub ném `Error("not implemented: <hàm>(…)")`, message chỉ chứa độ dài/kiểu tham số (không giá trị) | Test qc đỏ đúng lý do; dùng tham số nên không cần đổi tên `_x` (giữ chữ ký `plan-rules`) |
| B-B0-2 | Kiểu tự đặt tên (không có trong `plan-rules`): `ClassifiedMessage`, `BoundArgs`, `BuildInputsInput/Result`, `UsableCommand`, `SuggestCandidate`, `McpToolsInput`, `ToolArgsResult`, `OrphanJob`, `ConfirmationPrompt`, `WorkflowInputValue` (`catalog.types`) | Gom hình đã chốt trong `plan-rules` thành tên export cho test/service dùng lại |
| B-B0-3 | `DifyEvent` = `delta{text}` · `meta{taskId?, conversationId?}` · `finished{status: string, outputs \| null, usage: unknown}` (`message_end` → `status:"succeeded"`) · `error{message: string \| null}` · `ignore`; `usage` để thô, chuẩn hoá bằng `difyUsage` | `message` để ghi `run_steps.detail.upstream` (đã `maskSecret`, plan §5.2); `status` chuỗi vì Dify có thể thêm trạng thái — luật `failed/stopped` ở B4 |
| B-B0-4 | `RpcRequest{kind:"request", id: RpcId \| null, method, params}` (`id=null` = notification) · `RpcError{kind:"error", id, code: -32700\|-32600\|-32601\|-32602\|-32603, message}`; `JsonSchemaObject{type:"object", properties{type, description, enum?}, required}` | Phân biệt bằng `kind`; `select` → `enum` (R52) |
| B-B0-5 | `lib/secret-crypto.ts` Hub chỉ chép phần **giải mã** (`isMasterKeyB64`, `parseMasterKey`, `secretAad`, `decryptSecret`) — không `encryptSecret`/`selfTestSecretKey`. Vector: khoá thử byte 0x00..0x1f, 2 ca (key_version 1/2, Unicode) sinh bằng `encryptSecret` Admin rand cố định, nhúng trong test | P6; Hub không mã hoá. Tự kiểm khởi động (plan §8) để B4 quyết (vd giải thử một vector cố định) |
| B-B0-6 | `lib/job-token.ts` thêm `JOB_TOKEN_RE`/`isJobToken` (43 ký tự base64url, plan §6 Auth) cạnh `hashJobToken`; băm UTF-8 (= ASCII với token hợp lệ). Vector sha256 tính độc lập bằng `sha256sum` | Kiểm hình token trước khi tra DB (B6/B8) |
| B-B0-7 | Stub `buildWorkflowJobPayload`/`mcpConfigFor`/`orphanAction` thêm cuối `runner/runner.rules.ts` (218 → 250 dòng); `runner` import kiểu `WorkflowJobInput` từ `commands/catalog.types` | `plan-rules` ghi `runner.rules.ts (+)`; chỉ import kiểu, depcruise xanh |

## BUILD — D2 (backend-lead, 2026-10-05)
| # | Quyết định | Lý do |
|---|---|---|
| B-D2-1 | Hàm D2 nằm ở migration **mới** `migrations-hub/0003_h2a_dify_fn.sql` (+ entry `_journal.json`), không nối vào `0002` (điều phối) | `0002` đã commit và đã áp trên DB dev — Drizzle không chạy lại file đã ghi trong `__drizzle_migrations_hub`. Comment đầu `0002` ("hàm D2 ở cuối file") không sửa (file khoá); `plan-db` §1 đọc là "0002 + 0003". Test đếm theo journal (`migrate-hub.int`, H1 A48) tự nhận 4 |
| B-D2-2 | Thêm `GRANT USAGE ON SCHEMA hub TO hub_ro` trong `0003` | `plan-db` §1.3 bỏ sót: không có USAGE thì `SET ROLE hub_ro; select * from hub.workflow_secret(…)` → 42501. Không kèm quyền bảng nào (schema `hub` không có default privileges cho `hub_ro`); M2/M3 chạy trên DB Admin không có migration Hub nên không đổi |
| B-D2-3 | Test D2 = `packages/db/src/hub-h2a.int.test.ts` (D1 là `hub-h2a-schema.int.test.ts`); chạy cục bộ trên DB Hub riêng `ai_system_h2a_d2_hub_test` (`HUB_TEST_DATABASE_URL` trong `.env.test-h2a_d2.local`) | `db:test:create` chép nguyên `HUB_TEST_DATABASE_URL` = `ai_system_h1_test` dùng chung giữa các agent → test Hub các phiên giẫm nhau |

## BUILD — D1b (backend-lead, 2026-10-05)
- B-D1b-1: Migration mới `migrations-hub/0004_h2a_jobs_checks.sql` (+ `_journal.json`) nới `jobs_error_code_check` thêm `NOT_CONFIGURED`, `jobs_error_reason_check` thêm `credential`/`upstream` theo C2 (`HUB_JOB_ERROR_CODES`, `JOB_FAIL_REASONS`; `plan-errors` §2) — D1 sót (qc A89b); DROP+ADD trong `DO $$` chỉ khi định nghĩa cũ thiếu giá trị; các CHECK khác (`runs_error_code_ck` = `CHAT_RUN_ERROR_CODES`, `jobs_status`, `agent_types_runtime`) đã khớp contract; `schema/hub.ts` không có hằng mã lỗi job nên không đổi.

## BUILD — PY-01 (backend-lead, 2026-10-05)
- B-PY01-1 (điều phối): PY-01 thêm hai trường ngoài phạm vi để P28 xanh đủ 85/85: `ClaimedJob.token: str = field(default="", repr=False)` (`db/jobs_sql.py`, chỉ khai báo — sinh token lúc claim vẫn thuộc PY-03) và `Settings.dify_backoff_s` (`config.py`, env `AGENT_RT_DIFY_BACKOFF_S` dạng `"2,8"`, mặc định `(2.0, 8.0)`, mỗi giá trị > 0; chưa ai đọc tới PY-03).
- B-PY01-2: `Confirm` (pydantic, `type:"confirm"`, `choices: tuple[str, str]`) đặt trong `providers/base.py` cạnh `parse_confirmation` nhưng **chưa** vào union `ProviderEvent`/`protocol.py` (PY-05). `parse_confirmation` chỉ xét **khối text đầu** (list) / phần trước dấu xuống dòng đầu (str); JSON hỏng/không phải object → None.
- B-PY01-3: `reduce` đặt `task_id` từ sự kiện đầu có `task_id` (mọi loại, không chỉ `workflow_started` — chat cần cho stop); `node_started`/`agent_thought` đếm bước không xét `app_type`; `workflow_finished` lưu `usage = data` (nguồn `usage_row` workflow). `usage_row` theo `app_type` (bảng `-dify` §3.7), không đoán theo trường như `difyUsage` TS: workflow chỉ đọc `total_tokens`; token rác/âm/bool → 0; `total_price` → `Decimal` qua `str` (không float), NaN/âm → 0.
- B-PY01-4: `retry_delay` giới hạn retry = `min(2, len(backoff))` (tối đa 3 lần gọi kể cả khi env cho nhiều mốc). `mask` che thêm base64url và hex hoa (như `maskSecret` TS). `final_text` (cùng `stream.py`) làm luôn: object/số → JSON gọn (`separators=(",", ":")`, `ensure_ascii=False`) như `JSON.stringify`; cắt 64 000 ký tự để host (PY-03).
- B-PY01-5: import-linter thêm contract forbidden `runtimes.dify` ↛ `providers`, `sandbox`, `runtimes.cli` (`plan-runtime` §3.1).

## WRITE — QW-R (qc) — 2026-10-05
- R36: H2a-R02 ghi "∧ F cấp cho user/group" nhưng luật gốc M3-R11 và code Admin cho `core` hiệu lực **không cần grant**; R02 yêu cầu "đúng luật M3" + parity ⇒ theo Admin. Sửa `test-plan-cases` R36 (điều phối, trước Q2).
- R61: `mcpConfigFor(…, url)` nhận URL `/mcp` đầy đủ, trả nguyên văn (ghi `plan-rules`).

## WRITE — QW-A2 chốt (điều phối + qc, 2026-10-05, trước Q2)
- QA2-1 `difyAgentInput` giữ R48: đếm **mọi** input bắt buộc (mọi kiểu, kể cả `select`); có `query` → `"query"`; đúng một input bắt buộc và kiểu chuỗi → tên đó; còn lại → `null`. Lý do: bỏ qua `select` bắt buộc thì Dify thật lỗi thiếu input. Fixture A40/A44 (`dify-dich` ↔ `dich`, 2 input bắt buộc) sai ⇒ đổi sang `dify-tom` ↔ `tom` (một `source_text` text bắt buộc) trong `_h2a.ts`, `dify-agent.int.test.ts`, `secret.int.test.ts` (A80 bước dify-*); R48 thêm vế `select`/`number` bắt buộc → `null`; `test-plan-cases` R48, A40, A44, §7 sửa theo. `plan-db` §4 ví dụ `dify-dich` chỉ là ví dụ seed — nếu dùng thật phải trỏ workflow một input.
- QA2-2 Chấp nhận diễn giải QW-A2 (`test-plan` §10): A94 workflow không có → bỏ dòng + cảnh báo (đúng `plan-db` §4); A56 usage chỉ tính trên lời gọi Dify thành công; A61 kiểm `confirmed`/`consumed` trong `run_steps.detail`; A67 thêm/xoá cột `admin.workflows.side_effect` trong DB test, dọn ở `finally`; A43/A58 dùng `timeout_s=10` (CHECK `agents_timeout_s_check` 10–3600).
- QA2-3 A32 hết blocked bởi DB: migration `0004` (`8f7c9a9`) đã thêm `NOT_CONFIGURED`/`credential`/`upstream`; chạy lại đỏ đúng lý do (chưa có code). A89b (QW-A1) nay xanh.
- QA2-4 Q2: `tools/hub-dev/src/dify-mock.ts` thêm vào `LOCKED_DIRS` (`tools/scripts/src/test-lock.ts`) — sửa mock = tranh chấp test (`test-plan` §9 Q-T1).

## BUILD — D3 (backend-lead, 2026-10-05)
- `plan-db` §4: ví dụ `dify-dich` sửa thành `dify-tom` ↔ `tom` (một input chuỗi bắt buộc) theo QA2-1; seed mặc định `agents.yaml` dùng `dify-tom`, `dify-tro-ly`.
- Luật seed ở `modules/seed/seed.workflows.ts`: `runtime_options` agent `dify-*` = `strictObject({workflow_key})` kiểm thuần trước DB; đối chiếu `admin.workflows` trong transaction seed (sau khoá `config_meta`), lỗi → rollback toàn bộ (A93 "DB không đổi"); cảnh báo log sau commit như Q8.
- `workflow_flags.side_effect` seed chỉ **bật** (upsert `true`), không tắt cờ của workflow vắng trong yaml (đồng nghĩa "upsert, không xoá"); `workflows.yaml` mặc định để danh sách rỗng + ví dụ comment (không cấp tool cho `assistant` ngầm).
- `agent_workflows.agent` phải có trong seed (như grant/entitlement); agent `dify-*` bị bỏ vì workflow vắng thì các dòng tham chiếu nó ghi 0 hàng (không lỗi).

## BUILD — B2 (backend-lead, 2026-10-05)
| # | Quyết định | Lý do |
|---|---|---|
| B-B2-1 | `/commands` thêm vào `PROTECTED_PREFIXES` của `app.ts` (JWT ở gốc như E5–E15: không JWT → 401 `AUTH_EXPIRED`); route mount trong `app.h2a.ts` `mountH2a(app, config)` khi có `db` + cache cấu hình (không cần Redis) | plan §2.4, §4 (giữ `app.ts` ≤ 250 dòng) |
| B-B2-2 | `CommandService.menu` = `usableCatalogCommands` (B1, đã sắp `name`) → `toMenuItem`; tenant/user lấy từ `ConfigCache` (user chưa có trong cache → đọc DB một lần rồi cache như H1; cache nóng = 0 query). User vắng trong cache → `items: []` (middleware đã chặn trước) | plan §8 (0 query từ cache), R03 kiểm quyền mỗi request trên ảnh hiện hành |
| B-B2-3 | `toMenuItem.required`: arg được `input_map` (nguồn `arg`) map vào **ít nhất một** input `required` ∧ `default=null` ∧ `fallback=null`; arg không map vào input nào → `false`. `description.en` vắng → `null` | plan-rules menu; R40–R42 |

## BUILD — B4 (backend-lead, 2026-10-05)
| # | Quyết định | Lý do |
|---|---|---|
| B-B4-1 | `DifyClient.runStreaming(req, signal, onDelta)` **không ném**, trả `finished{text}` · `failed{code, reason: upstream\|invalid_output, detail, httpStatus}` · `aborted` (kèm `taskId, conversationId, usage, ms`). Đã áp `finalText(acc, outputs, req.outputField)` trong client. `task_id`/`conversation_id` lấy từ **mọi** sự kiện thô (app chat không có `workflow_started`) | Driver sync (B5), MCP (B8), `dify-*` (B7), test-run (B10) chung một bảng lỗi plan-errors §2; abort phân biệt `TIMEOUT`/`CANCELLED` là việc người gọi (theo lý do abort) |
| B-B4-2 | Bẫy HTTP 200: `workflow_finished.data.status ∈ {failed, stopped}` (`DIFY_FAILED_STATUSES`) → `UPSTREAM_ERROR`; trạng thái khác (vd `partial-succeeded`) = xong. Hết luồng không có `workflow_finished`/`message_end` → `UPSTREAM_ERROR`. Sau sự kiện kết thúc client huỷ phần còn lại của luồng. Huỷ đúng lúc đã nhận kết thúc → giữ kết quả | plan-errors §2; B-B0-3 để luật status cho B4 |
| B-B4-3 | Tự kiểm master key lúc khởi động: `loadMasterKey` = `parseMasterKey` + mã hoá một giá trị cố định đúng định dạng Admin (AES-256-GCM, iv 12, tag nối sau, AAD `admin.secrets:<nil-uuid>:<v>`) rồi giải lại bằng `decryptSecret` Hub → sai ⇒ `fatal secret_master_key`. Sau đó `probeMasterKey` giải thử secret của một workflow thật (`hub_ro`): lệch khoá ⇒ chỉ `warn secret_master_key_mismatch` (không fatal: một secret hỏng không được làm sập Hub). Không dùng "vector cố định" vì vector mã bằng khoá test không giải được bằng khoá thật | plan §8 "tự kiểm, sai → fatal"; B-B0-5 để B4 quyết |
| B-B4-4 | `SECRET_MASTER_KEY` ở env hub-api **tuỳ chọn** (refine `isMasterKeyB64`; sai định dạng ⇒ env lỗi = fatal). Vắng ⇒ `warn secret_master_key_missing`, mọi lời gọi Dify `NOT_CONFIGURED` (`CredentialError master_key_missing`) | Không làm hỏng khởi động H1/dev chưa có biến; `.env.example` gốc đã có `SECRET_MASTER_KEY` (chung Admin) |
| B-B4-5 | `CredentialService.apiKey(workflowId)` mở transaction riêng `SET LOCAL ROLE hub_ro` + `select … from hub.workflow_secret($1)` (không chạy trong transaction `user`/`system` của người gọi để không đổi role giữa chừng). Lỗi ⇒ `CredentialError{code:"NOT_CONFIGURED", reason:"credential", failure}`; log `warn <failure> {workflow_id}` (`secret_decrypt_failed` / `secret_missing` / `master_key_missing`), không bản mã/giá trị. Base URL + `app_type` lấy từ catalog (B1), không từ hàm này | plan-db §2 Secret; P1 hẹp nhất; R17 không cache bản rõ |
| B-B4-6 | `logDifyUsage(exec, row)` nhận `Tx` đang mở hoặc `db.db`; `recordDifyUsage(db, row)` ghi ngoài transaction. Token/latency ép int ≥ 0 (≤ 2³¹−1), `cost_usd` truyền chuỗi `numeric` (NaN/âm → 0) | P2; tránh float driver |
| B-B4-7 | Stop: `POST <stop url>` body `{user}`, Bearer key, `AbortSignal.timeout(2 s)`; không `taskId` ⇒ bỏ qua. Lỗi HTTP run: đọc ≤ 8 KiB thân rồi `maskSecret(…, apiKey)` ≤ 300 vào `detail`; SSE `event:error` `message` cũng che | plan §5.2; A23/A24/A26 |
| B-B4-8 | `AppDeps.secretMasterKey` (đúng tên seam qc) — server truyền `env.SECRET_MASTER_KEY`; người dùng (B5/B6/B10) gọi `loadMasterKey(deps.secretMasterKey)`. `app.ts`/`server.ts`/`env.ts` chỉ thêm đúng các dòng này | File dùng chung, sửa tối thiểu |
| B-B4-9 | Test cạnh code: `dify.client.test.ts` (mock MK trong tiến trình: SSE, bảng lỗi, stop, che key) + `credential.int.test.ts` (DB test + role `hub_api`: `workflow_secret` dưới `hub_ro`, hỏng/`key_version`, tự kiểm/probe, `log_dify_usage`, chuỗi credential → client → MK proxy → usage) | Ca khoá A20–A26, A80–A83 cần route (B3/B5/B6) |
