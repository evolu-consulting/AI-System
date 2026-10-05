# Plan · H2c-attachments (BE TS + contract + DB)

Python: `plan-runtime.md`. SQL nguyên văn: `plan-db.md`. Chữ ký hàm thuần: `plan-rules.md`. Mã lỗi/câu chữ/log: `plan-errors.md`. Luật: spec §2 (R01–R30). Chính xác hoá spec: `spec-decisions.md` PL1–PL8. Nền: H2b `plan.md` (ghi `H2b §x`), H2a `plan.md` (`H2a §x`).

## 1. Quyết định
| # | Quyết định | Lý do |
|---|---|---|
| P1 | Q1 = A, Q2 = A, Q3 = A (người dùng 2026-10-05) | spec-decisions "Trả lời người dùng" |
| P2 | Contract chat **chỉ thêm**: file mới `chat/attachments.ts`; hằng **riêng** `CHAT_ATTACHMENT_ERRORS`; `attachment_ids?` và `attachments?` là khoá **vắng** khi không file | `entities.test.ts:142` `CHAT_API_ERRORS` đúng 6 mã; H2b `contracts-h2b:86` `CHAT_RUN_ERROR_CODES` 7 mã; `SendMessageRequest` test `toEqual({content:"hi"})`; `FORBIDDEN_KEYS` (`tests/contract/chat/_client.ts:234`: `agent/provider/model/usage`) không trùng `id/filename/mime/size/available`; `tools/mocks` `Record<ChatErrorCode>` không đổi |
| P3 | Contract hub: `AgentCliJob.attachments?`, `JobResultEvent.outputs?` (vắng = không có; Hub/Runtime **không** ghi mảng rỗng); `WorkflowInputValue` + `DifyFileInput`; `JOB_FAIL_REASONS` + `attachment` (cuối); `HUB_JSON_SCHEMAS` + `JobOutputResponse` | Fixture cũ còn hợp lệ (H1 R14, H2a R73, H2b R44); pydantic sinh khớp (luật H1 §2: không `refine/transform/default`) |
| P4 | Upload thân thô + `X-Filename`; bộ đếm byte trong `AttachmentStorage.stage` (PL3), không `hono/body-limit`; `Bun.serve({maxRequestBodySize: 32 MiB})` chặn ngoài (mặc định Bun 128 MiB) | T1, T2; không giữ file trong RAM |
| P5 | Storage hai pha (PL1): `stage → Staged{commit, discard}`; `commit` sau DB commit (R05); `blob()` cho Dify | R05; FormData cần `Blob` (local: `Bun.file`, đọc lười) |
| P6 | Hạn mức: **kiểm sớm** theo `Content-Length` (không khoá, trước khi đọc thân) → 409 sớm; **kiểm chốt** dưới `pg_advisory_xact_lock(hashtext('hub.attach.tenant'), hashtext(tenant_id))` trong transaction INSERT | R06 + AC-14 (song song đúng 2/3); tránh ghi 20 MiB rồi mới 409 |
| P7 | E12: kiểm R09 ở `runs.routes` **sau body, trước router** (R10) → `checkSendable` (đọc, scope `user`); gắn R11 trong `createRunTx` **sau** `insertMessage`, **trước** `decideConfirmations`; cùng transaction tính `A` (R14) → `runs.attachment_ids` | R10, R11; một transaction (rollback = không message/run) |
| P8 | Thứ tự khoá thêm `attachments` sau `messages`: `[advisory user (E12)] → [K_CLAIM] → conversations → flows → runs → run_steps → messages → attachments → tool_confirmations → jobs → usage_logs → cli_sessions → provider_state`. Upload/output: `[advisory tenant attach] → attachments` (không bảng khác). Sweeper: chỉ `attachments` (+ đọc `conversations` không khoá) | K6; không chu trình: E12 không lấy khoá tenant; finish (`SseWriter.finish`) `flows → runs → messages → attachments → jobs` cùng chiều |
| P9 | `RunContext.files: RunFile[]` (= `A`, chốt ở `createRunTx`) → driver: Orchestrator khối `<attachments>` (R15); job agent `payload.attachments` + khối file; command: file đầu của tin hiện tại (R20, T9) | Driver không đọc lại DB; `A` bất biến theo run |
| P10 | Prompt do Hub dựng (PL4): khối file nối vào `prompt` chỉ khi `A ≠ ∅`; câu `out/` nối vào `system_prompt` mọi job **agent** `agent.cli` (không Orchestrator, không Dify agent); vượt `SYSTEM_PROMPT_MAX` → bỏ câu + `warn` | Test khoá so `payload.prompt` nguyên văn (H1 A16, H2b `direct.int:305`); chỉ `orchestrator.int:134` kiểm `system_prompt` (Orchestrator, `startsWith`) |
| P11 | `PromptInput.attachments?` (Orchestrator) và `BuildJobPayloadInput.attachments?` tuỳ chọn — vắng ⇒ kết quả như cũ | Test khoá H1 `orchestrator.int`, H2a `rules/runner.test` |
| P12 | MCP: `mcpToolsFor(i)` + `hasFiles?: boolean`; **vắng ⇒ hành vi H2a nguyên văn** (bỏ workflow có `file` bắt buộc, input `file` không vào schema); có ⇒ R23 (`false`: bỏ **mọi** workflow có input `file`; `true`: giữ, `file` → `{type:"string"}` + mô tả). `toolInputSchema(inputs, withFiles = false)`. Hub luôn truyền `hasFiles` | Test khoá H2a `rules/mcp.test.ts:81` |
| P13 | `buildInputs` + `attachment?: {id} \| null` (vắng ≡ null) → kết quả thêm `files: {input, attachmentId}[]` (input `file` **không** vào `inputs`; driver điền sau khi upload). Lệch map (R20) → `invalid` **bất kể có giá trị** | Test khoá H2a `command-input.test.ts:103` (map `attachment` bắt buộc, không file → `missing`) giữ xanh; PL8 |
| P14 | Dify upload ở Hub: `dify/dify-upload.ts` (`DifyClient` 280 dòng — không nhồi); sync: `command-driver` trước lời gọi; async: `command-async-driver` trước enqueue; MCP: `mcp.service` qua `attachments/attachment-dify.ts` | R21, R22, R23, T7 |
| P15 | Gắn output (R26) trong `SseWriter.finish` khi `status=finished`, sau `insertMessage` (cùng transaction), `DISTINCT ON (job_id, safe_name)` (PL6) | Một chỗ ghi tin assistant |
| P16 | Endpoint nội bộ mới ở `internal/attachments.routes.ts`, dùng lại `bearerJobToken` (`credential.service`) + `jobByTokenHash` (`credential.repo`); mọi sai → 401 một thân (`UNAUTHORIZED_BODY`) | R17, T18; như H2a-R17 |
| P17 | CORS: `allowHeaders` + `X-Filename`; `exposeHeaders` + `Content-Disposition`; `/attachments` vào `PROTECTED_PREFIXES` (401 trước 404) | Chat extension khác origin |
| P18 | TD #52 (B0): tách `runner/job/job-agent-runner.ts` (380 dòng) → `runner/job/job-follow.ts` (`EventQueue`, `#follow`/`#poll`/`#finishStep` thành lớp `JobFollower`), **không đổi hành vi** | B6 thêm `attachments`/prompt vào cùng file (trần 400) |
| P19 | Module mới `apps/hub-api/src/modules/attachments/` (README); route mỏng, service, repo, rules thuần, storage | CONVENTIONS §2 |
| P20 | **Không ADR**: không thư viện mới. TS: `node:fs/promises` (`open 'wx' 0o600`, `fsync`, `rename`, `realpath`), `node:crypto` sha256, `TextDecoder({fatal:true})`, `FormData` + `Bun.file`. Python: `httpx2` (ADR-0010) stream, `os.open(O_EXCL\|O_NOFOLLOW)`, `hashlib` | WORKFLOW "Đề xuất công nghệ" |
| P21 | Output mỗi job ≤ 5 kiểm cả ở Hub (thứ 6 → 409 `ATTACHMENT_QUOTA_EXCEEDED`) | Runtime không bao giờ gửi > 5 (R25); phòng thủ |
| P22 | `GET /attachments/:id(/content)`: file có `conversation_id` mà hội thoại `deleted_at` → 404 ngay (kể cả trước khi sweeper chạy) | R13 |
| P23 | Windows (dev Hub): bỏ kiểm quyền 0700 khi `process.platform === "win32"`; `rename` đích không tồn tại (uuid); xoá lỗi `EBUSY`/`EPERM` → lượt sweeper sau | Hub dev chạy Windows; Runtime chỉ Linux |

## 2. Contract
### 2.1 `@ai/contracts/chat` — chỉ thêm (P2)
| Thay đổi | Định nghĩa |
|---|---|
| `src/common.ts` (+, gốc dùng chung chat/hub) | `ATTACH_MAX_BYTES = 20_971_520` · `ATTACH_ALLOWED = {pdf:"application/pdf", png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", gif:"image/gif", webp:"image/webp", docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation", txt:"text/plain", md:"text/markdown", csv:"text/csv", xml:"application/xml", json:"application/json"} as const` · `ATTACH_MIMES` (giá trị duy nhất, theo thứ tự) · `AttachMimeSchema = z.enum(ATTACH_MIMES)` |
| `chat/attachments.ts` (mới, export ở `chat/index.ts`) | re-export `ATTACH_MAX_BYTES`, `ATTACH_ALLOWED` · `ATTACH_PER_MESSAGE_MAX = 10` · `ATTACH_FILENAME_MAX = 200` · `ATTACH_FILENAME_HEADER_MAX_BYTES = 1024` · `FILENAME_HEADER = "X-Filename"` · `AttachmentSchema = strictObject{id: Uuid, filename: string 1–200, mime: AttachMime, size: int 1–ATTACH_MAX_BYTES, created_at: IsoDateTime}` · `AttachmentDetailSchema = strictObject{...AttachmentSchema.shape, available: boolean}` · `AttachmentRefSchema = strictObject{id, filename, mime, size, available}` |
| `errors.ts` + | `CHAT_ATTACHMENT_ERRORS = {ATTACHMENT_NOT_FOUND: 404, ATTACHMENT_QUOTA_EXCEEDED: 409, ATTACHMENT_TOO_LARGE: 413, ATTACHMENT_TYPE_NOT_ALLOWED: 415} as const` · `ChatAttachmentErrorCode` · `CHAT_ATTACHMENT_ERROR_CODES` · `AttachmentNotFoundDetailsSchema = strictObject{ids: Uuid[] 1–10}` |
| `entities.ts` + | `SendMessageRequestSchema` + `attachment_ids: z.array(UuidSchema).min(1).max(10).refine(uniq, "duplicate").optional()` (refine trên **mảng**, object giữ `strictObject`) · `MessageSchema` + `attachments: z.array(AttachmentRefSchema).min(1).max(10).optional()` (user lẫn assistant) |
| Không đổi | `CHAT_API_ERRORS`, `CHAT_RUN_ERROR_CODES`, `CHAT_EVENT_NAMES`, `RunStartedData`, `Run*` — không sự kiện SSE mới |

**CR-impact Chat (I3):** chip tải lên + `X-Filename`, lỗi 413/415/409/404 `ATTACHMENT_*`, `attachments` trong tin (kể cả assistant — file `out/`; tin assistant chỉ có file sau khi tải lại lịch sử, không qua SSE), tải về `/content`.

### 2.2 `@ai/contracts/hub` (không `refine/transform/default`)
| Tên | Định nghĩa |
|---|---|
| `JOB_ATTACHMENTS_MAX = 10` · `JOB_OUTPUTS_MAX = 5` · `JOB_FILE_NAME_MAX = 120` | hằng |
| `JobAttachmentSchema` | `strictObject{id: HubUuid, name: string 1–120 regex /^[^./\\\x00-\x1f\x7f-][^/\\\x00-\x1f\x7f]*$/ (không lookahead — pydantic-core regex Rust), mime: AttachMime, size: int 1–ATTACH_MAX_BYTES, sha256: /^[0-9a-f]{64}$/}` (≤ 120 **byte** kiểm ở `plan-rules` `safeName`) |
| `AgentCliJobSchema` | + `attachments: z.array(JobAttachmentSchema).max(10).optional()` |
| `DifyFileInputSchema` | `strictObject{type: enum["image","document"], transfer_method: literal("local_file"), upload_file_id: string 1–100}` → `WorkflowInputValueSchema` thêm vào union (job `workflow.async`) |
| `JOB_FAIL_REASONS` | + `"attachment"` (cuối; 15 phần tử) — `src/hub/delta.test.ts` (unit, không khoá) sửa `toHaveLength(15)`, `at(-1)` |
| `JobResultEventSchema` | + `outputs: z.array(HubUuidSchema).min(1).max(5).optional()` |
| `HUB_JSON_SCHEMAS` | + `JobOutputResponse` (từ `hub-internal`) |
| Fixture | valid: `JobPayload.agent-files.json` (2 file), `JobPayload.workflow-file.json` (input object file), `RunEvent.result-outputs.json`, `JobOutputResponse.basic.json`, `JobOutputResponse.other.json` · invalid: `JobPayload.files-11.json`, `JobPayload.file-bad-sha.json`, `JobPayload.file-name-slash.json`, `JobPayload.file-name-dot.json`, `RunEvent.outputs-6.json`, `RunEvent.outputs-empty.json`, `JobOutputResponse.no-id.json`, `JobOutputResponse.extra.json`. Fixture cũ không sửa |
| Sinh | `bun run contracts:gen` → `hub.schema.json` + `contracts/hub.py`; `contracts:check` xanh; `test_contracts_hub.py` (khoá, `KEYS` 8 key cũ) xanh |

### 2.3 `@ai/contracts/hub-internal`
`attachments.ts` (mới): `JobOutputResponseSchema = strictObject{id: Uuid}` · `CONTENT_SHA256_HEADER = "X-Content-SHA256"`. `HUB_INTERNAL_ERRORS` + `NOT_FOUND: 404`, `ATTACHMENT_QUOTA_EXCEEDED: 409`, `ATTACHMENT_TOO_LARGE: 413`, `ATTACHMENT_TYPE_NOT_ALLOWED: 415` (kiểu `satisfies` thêm 404/413/415); `hub-internal.test.ts` (unit, không khoá) sửa `toEqual`. Không test khoá nào so `HUB_INTERNAL_ERRORS` (đã grep).

### 2.4 Endpoint
| Method · Path | Auth | Request | Response | Lỗi (thứ tự) |
|---|---|---|---|---|
| POST `/attachments` | JWT mọi role | byte; `X-Filename` (pct UTF-8); `Content-Length` tuỳ | 201 `Attachment` | 401 → 400 header → 415 đuôi → 413/400 `Content-Length` → 409 sớm → (đọc thân) 413 · 415 chữ ký · 400 rỗng → 409 chốt |
| GET `/attachments/:id` | JWT chủ | — | `AttachmentDetail` | 401 · 404 `NOT_FOUND` (uuid sai, khác chủ, hội thoại đã xoá) |
| GET `/attachments/:id/content` | JWT chủ | — | byte + header R13 | 401 · 404 (+ `available=false`) |
| POST `/conversations/:id/messages` | JWT chủ | `SendMessageRequest` + `attachment_ids?` | SSE C1 | như H2b + 404 `ATTACHMENT_NOT_FOUND{ids}` (R10 thứ 4) |
| GET `/internal/jobs/:job_id/attachments/:attachment_id` | token job | — | 200 `application/octet-stream`, `Content-Length`, `X-Content-SHA256`, `Cache-Control: no-store` | 401 một thân · 404 `NOT_FOUND` (đã xoá nội dung) |
| POST `/internal/jobs/:job_id/outputs` | token job | byte + `X-Filename` | 201 `JobOutputResponse` | 401 · 400 · 415 · 413 · 409 |

## 3. Dữ liệu (`migrations-hub/0007_h2c_attachments.sql`, SQL: `plan-db.md` §1)
| Đối tượng | Thay đổi |
|---|---|
| `hub.attachments` (mới) | cột spec §4 + `position smallint` (thứ tự trong tin, R12) ; CHECK `origin`, `size`, `sha256`, `position`, `(message_id IS NULL) = (bound_at IS NULL)`, `origin='output' ⇒ job_id NOT NULL`; FK `message_id → messages ON DELETE SET NULL`; index `attachments_message_idx`, `attachments_tenant_live_idx (tenant_id) INCLUDE (size) WHERE purged_at IS NULL`, `attachments_unbound_idx`, `attachments_job_idx`, `attachments_conv_live_idx` |
| RLS / GRANT | RLS như `messages` (0001); `GRANT SELECT, INSERT, UPDATE, DELETE … TO hub_rw`; `agent_runtime` **không** GRANT (Runtime qua HTTP) |
| `hub.runs` | + `attachment_ids uuid[] NOT NULL DEFAULT '{}'` + CHECK `cardinality ≤ 10` |
| `hub.jobs` | `jobs_error_reason_check` + `attachment` |
| `hub.conversations` | index `conversations_deleted_idx (id) WHERE deleted_at IS NOT NULL` (R28) |
| `schema/hub.ts` | bảng `attachments`, cột `runs.attachmentIds`; `ATTACHMENT_ORIGIN_VALUES` |

## 4. hub-api — module
| Module / file | Việc |
|---|---|
| `attachments/` (mới) | `attachment.rules.ts` (tên, đuôi, header, disposition — `plan-rules`) · `sniff.rules.ts` (`FileInspector`) · `run-files.rules.ts` (`pickRunFiles`, `jobFileNames`, prompt khối file) · `storage.ts` (interface + lỗi) · `storage.local.ts` (driver) · `attachments.repo.ts` · `attachments.service.ts` (`upload`, `ingestOutput`, `get`, `content`, `checkSendable`) · `attachments.routes.ts` · `attachment-dify.ts` (`uploadToDify(file, wf, user)` dùng `dify/dify-upload.ts`) · `sweeper.ts` (`startAttachmentSweeper`) · README |
| `internal/` | `attachments.routes.ts` (R17, R25 phía Hub) + `attachments.service.ts` (token → job → kiểm) |
| `runs/` | `runs.routes.ts`: `checkSendable` (P7) → truyền `files` cho `prepareCommand` và `runs.start` · `create-run.ts`: `bindAttachments` + `runFiles` + `setRunFiles` · `runs.service.ts`: `RunContext.files` · `sse/sse-writer.ts`: `bindOutputs` (P15) · `run-errors.ts`: `runErrorTextFor` + reason Hub `file_rejected` |
| `commands/` | `command-input.rules.ts` (P13) · `commands.service.ts` `prepare(u, req)` + `req.attachments` · `driver/command-driver.ts`, `driver/command-async-driver.ts`: điền `files` → `DifyFileInput` |
| `dify/dify-upload.ts` (mới) | `uploadDifyFile(req, signal) → {ok, id} \| {ok:false, code, reason}` (R22) |
| `mcp/` | `mcp.rules.ts` (P12, `fileArg`), `mcp.service.ts` `tools/list`/`tools/call` đọc `payload.attachments` |
| `orchestrator/` | `orchestrator.prompt.ts` khối `<attachments>` (P11); `orchestrator.service.ts` truyền `ctx.files` |
| `runner/` | `runner.rules.ts` `buildJobPayload` + `attachments?` · `job/job-agent-runner.ts` (sau B0): `AgentTask.files?`, prompt/system_prompt (P10), `agentToolKeys(ids, catalog, hasFiles)` · `job/job-follow.ts` (B0) |
| `mention/direct-driver.ts`, `orchestrator.service.ts` | truyền `ctx.files` vào `AgentTask.files` (delegate, direct) |
| `conversations/` | `conversations.repo.ts` `messageAttachments(tx, messageIds)`; `toMessage(m, run, responder?, refs?)` (P2: vắng khi `refs` rỗng) — E10, E11, preview |
| `lib/errors.ts` | `HubErrorCode` + `ChatAttachmentErrorCode`; `ERROR_MESSAGES` (`plan-errors` §1) |
| `config/{env,env-deps}.ts` | env §7 → `AppDeps.attachments?: {storage, tenantMaxBytes, sweepS}`; **vắng ⇒ không mount `/attachments`** (test khung H1/H2a/H2b dựng app không truyền) |
| `app.h2c.ts` (mới) | `mountH2c(app, deps)`: `/attachments`, `/internal/jobs/:id/{attachments,outputs}`, sweeper; `app.ts` (213 dòng) chỉ gọi + P17 |
| `server.ts` | `maxRequestBodySize` (P4); `createLocalStorage(env)` lỗi ⇒ thoát ≠ 0 (R04, AC-15) |

## 5. Luồng
### 5.1 Upload (R01–R07) — `AttachmentService.upload(u, {filenameRaw, contentLength, body})`
1. `parseFilenameHeader(raw)` → `null` ⇒ 400. `displayName` → `extOf` ∉ `ATTACH_ALLOWED` ⇒ 415 (trước khi đọc thân).
2. `contentLength`: `> ATTACH_MAX_BYTES` ⇒ 413; `0` ⇒ 400; vắng (chunked) ⇒ tiếp. Có `contentLength` ⇒ `quotaUsed(tenant) + contentLength > max` ⇒ 409 sớm (P6).
3. `id = randomUUID()`, `key = tenant/id` → `storage.stage(key, body, {maxBytes: ATTACH_MAX_BYTES, inspect: new FileInspector(ext)})`: vượt ⇒ `StorageTooLarge` 413; inspector từ chối ⇒ `StorageRejected` 415; 0 byte ⇒ 400; client đứt ⇒ ném (500 log `warn attachment-upload-aborted`). Mọi lỗi ⇒ `discard()`.
4. Transaction `user`: advisory tenant → `quotaUsed` + `size` > max ⇒ 409 → INSERT (`origin='upload'`, `safe_name = safeName(filename)`) → commit → `staged.commit()`; `commit` lỗi ⇒ DELETE hàng (system) + `discard` + 500.
5. Log `attachment_uploaded` → 201.

### 5.2 E12 (R08–R11, R14)
1. `parseJson` (400: `attachment_ids` > 10 / trùng / không uuid) → `files = ids ? await attachments.checkSendable(u, ids) : []` (`plan-db` §2.1; thiếu ⇒ 404 `ATTACHMENT_NOT_FOUND{ids: theo thứ tự gửi}`) → `routeMessage` …
2. `command` → `prepareCommand(u, {name, rest, ctx, attachments: files})` (R20 lỗi = `CMD_MISSING_ARG`, trước run).
3. `RunService.start(u, conv, req, plan, files)` → `createRunTx`: … `insertMessage(user)` → `bindAttachments` (`plan-db` §2.2; số hàng ≠ ⇒ ném `ATTACHMENT_NOT_FOUND{ids: id không gắn được}`) → `runFiles` (`plan-db` §2.3) → `pickRunFiles` (command: chỉ tin hiện tại) → `setRunFiles` → `decideConfirmations`. Trả `files: RunFile[]` → `RunContext.files`.
4. Không `attachment_ids` ⇒ không câu SQL nào thêm ngoài `runFiles` khi flow có sẵn (flow mới ⇒ bỏ qua: `A = ∅`).

### 5.3 Job agent CLI (R15, R18, R24)
- `RunFile = {id, name: safe_name, mime, size, sha256, messageId}`. `jobFileNames(files)` khử trùng `-2`, `-3` (trước đuôi, giữ ≤ 120 byte).
- Orchestrator: `PromptInput.attachments = files.map({name, mime, size})` → khối `<attachments>` ngay **trước** `<message>` (sau `<steps_left>`; `fake` tìm `<message>` sau `</steps_left>` — vẫn đúng); vắng khi `A = ∅`. Không `payload.attachments`.
- Agent (`direct`, delegate): `payload.attachments = jobAttachments(files)` khi `A ≠ ∅`; `prompt = prompt + "\n\n" + agentFilesBlock(names)`; `system_prompt = withOutHint(system_prompt)` (P10). MCP `agentToolKeys(..., hasFiles = A ≠ ∅)`.
- Resume (H1-R23): job mới luôn mang `A` của run mới — không cần nhánh riêng.

### 5.4 Endpoint nội bộ tải file (R17) — `InternalAttachmentService.download(auth, jobId, attId)`
`bearerJobToken` → `jobByTokenHash` (running) → `id === jobId` ∧ `type === 'agent.cli'` ∧ `AgentCliJobSchema.safeParse(payload)` ∧ `attId ∈ payload.attachments[].id` → `jobAttachment(tx, attId, job.tenant_id)` (`plan-db` §2.5; system scope, lọc `tenant_id`) → không hàng ⇒ 401; `purged_at` ⇒ 404 → `storage.open(key)` (mất file ⇒ 404 + `error attachment-content-missing`) → stream. Không log token.

### 5.5 Output (R25, R26)
`POST /internal/jobs/:job_id/outputs`: như 5.4 (job `running`, `agent.cli`, `payload.agent.role='agent'`) → `countOutputs(job) ≥ 5` ⇒ 409 (P21) → luồng 5.1 với `origin='output'`, `user_id = jobs.user_id`, `job_id`, `conversation_id`/`flow_id` = payload (chưa `message_id`) → 201 `{id}`. Finish run `finished` (P15): `bindOutputs(tx, {runId, messageId, conversationId, flowId})` (`plan-db` §2.4). Run `failed`/`cancelled`: không gắn (R27 dọn sau 24 h).

### 5.6 Dify (R20–R23)
- `buildInputs` (P13) → `files: [{input, attachmentId}]` (≤ 1 — T9: chỉ file đầu, mọi input `file` map `attachment` nhận **cùng** file).
- Sync (`command-driver`): sau `run.started`, trước `runStreaming`: mỗi `files[k]` → `uploadDifyFile` (credential workflow H2a-R08, `user = difyUser`) → `inputs[input] = {type: difyFileType(mime), transfer_method: "local_file", upload_file_id}`; lỗi ⇒ `finish failed` mã R22 (`file_rejected` ⇒ hint). Trace step `workflow` `detail.upload = {mime, size, ms}`.
- Async (`command-async-driver`): như sync **trước** `jobs.run` (INSERT job); payload `inputs` chứa object (P3).
- MCP `tools/call`: `validateToolArgs` cho input `file` nhận chuỗi → `fileArg(value, payload.attachments)` (khớp `name` trước, rồi `id`) → không thuộc ⇒ `isError` "This file is not attached to this message." (0 lời gọi Dify) → xác nhận `side_effect` (H2a-R21, R22 — không đổi) → upload → gọi workflow. Upload lỗi ⇒ `isError` `TOOL_ERROR_TEXT` (`NOT_CONFIGURED`/`UPSTREAM_ERROR`) hoặc `FILE_REJECTED` (`plan-errors` §3).

### 5.7 Xem lại (R12, R13)
`GET /attachments/:id` / `/content` (scope `user`, RLS + `plan-db` §2.6). `/content` header: `Content-Type: mime` · `Content-Length: size` · `Content-Disposition: contentDisposition(filename)` · `X-Content-Type-Options: nosniff` · `Content-Security-Policy: default-src 'none'; sandbox` · `Cache-Control: private, no-store`. `Range` bỏ qua (200 toàn bộ). E10/E11/preview: `messageAttachments` một câu cho cả trang (`message_id = ANY`).

### 5.8 Sweeper (R27–R29, PL2) — `startAttachmentSweeper` (`lib/loop.ts`, `everyMs = HUB_ATTACH_SWEEP_S·1000`, `now` tiêm được)
Mỗi lượt, trong `pg_try_advisory_xact_lock(hashtext('hub.attach.sweep'))` (không được ⇒ bỏ lượt): (a) R27 claim ≤ 500 (`plan-db` §4.1) → `storage.remove` → DELETE hàng; (b) R28 claim ≤ 500 (§4.2) → `remove`; (c) quét mồ côi: `storage.list({after: cursor, limit: 500})` (xoay vòng theo key, con trỏ trong bộ nhớ) — `.part` hoặc file > 1 h (`mtime`) mà `liveKeys` (§4.3) không có ⇒ `remove`. Log `info attachment-sweep {expired, purged, orphans, ms}` khi > 0.

## 6. Hàm thuần — chữ ký chốt: `plan-rules.md`

## 7. Hiệu năng · env
| Chỉ tiêu (spec §6) | Cách đạt |
|---|---|
| Upload 20 MiB ≤ 1,5 s p95; RSS ≤ 8 MiB/upload | stream `ReadableStream` → `FileHandle.write` từng chunk, sha256 tăng dần, inspector chỉ giữ ≤ 16 byte đầu + trạng thái UTF-8; không `arrayBuffer()` |
| R09 + R11 (10 id) ≤ 5 ms | PK `id = ANY`; `runFiles` dùng `attachments_message_idx` + `messages_flow_idx` |
| Hạn mức | `attachments_tenant_live_idx … INCLUDE (size)` ⇒ index-only `SUM` |
| Sweeper lô 500 ≤ 2 s | index partial `unbound`/`conv_live`/`conversations_deleted_idx`; `SKIP LOCKED` |

Env mới (hub-api, `config/env.ts`, `.env.example`): `HUB_ATTACH_DRIVER` (`local`; khác ⇒ thoát) · `HUB_ATTACH_DIR` (tuyệt đối; dev `.data/attachments`, `.gitignore` + `.data/`) · `HUB_ATTACH_TENANT_MAX_BYTES` (mặc định 5 368 709 120; số nguyên ≥ `ATTACH_MAX_BYTES`) · `HUB_ATTACH_SWEEP_S` (mặc định 600; 10–86 400). Runtime: `plan-runtime` §7.

## 8. Ràng buộc gửi Runtime: `plan-runtime.md` §9 (đã đối chiếu).
