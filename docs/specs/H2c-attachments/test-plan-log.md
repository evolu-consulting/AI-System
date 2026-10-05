# Test plan · H2c-attachments — nhật ký §10 (qc)

Tách từ [`test-plan.md`](test-plan.md) §10 ngay từ TEST-PLAN (trần 25 600 B mỗi file). Ghi theo khuôn H2b [`test-plan-log.md`](../H2b-routing/test-plan-log.md).

## 10. Đỏ đúng lý do · nhật ký
Chưa chạy (TEST-PLAN). Sau mỗi nhóm WRITE (QW-R, QW-A1, QW-A2 + MK-U, QW-PU, QW-P): bảng `File · ID · đỏ đúng lý do / tổng · lý do đỏ · xanh trước code (lý do)` + "Lệch plan / cần backend-lead"; DB riêng `ai_system_h2c_<nhóm>_{,hub_}test` (ghi đã drop). Q2/Q-PU/Q3: số dòng `UNLOCKED`/`CHANGED` trước ghi (Q2: đúng 1 `CHANGED tools/hub-dev/src/dify-mock.ts` + hồi quy MK-U xanh), tổng file lock, `git diff tests/.lock` chỉ thêm/đổi đúng các dòng đó. Tranh chấp: bảng TC như H2b (`#`, test, phán quyết, sửa, kết quả; kiểm cả file 3 lần liên tiếp trên DB riêng). I1: bảng 18 bước `done:h2c` (test-plan §7.1).

### Bài học áp dụng từ H2b (kiểm trước khi báo "đỏ đúng lý do")
| # | Bài học | Áp vào H2c |
|---|---|---|
| B1 | TC-3: id cố định trùng giữa ca/lần chạy, key Redis cũ | `crypto.randomUUID()`/`uuid4()` mọi id chèn SQL; id cố định ⇒ `DEL run:<id> sse:<id>` |
| B2 | I1 H2a: DB Hub/Runtime chung DB TS ⇒ `DuplicateTableError` | DB `…_hub_test` riêng (`HUB_TEST_DATABASE_URL`, `AGENT_RT_TEST_DATABASE_URL`) |
| B3 | `run.ts` Windows → container không thấy env shell | Env DB đặt **trong chuỗi lệnh** truyền cho `run.ts`; chỉ export 4 biến DB, không `source` file có PEM |
| B4 | TC-5/TC-7 (H2a stack): `AGENT_RT_ORPHAN_S=5` với heartbeat mặc định ⇒ job bị coi mồ côi | Đặt `AGENT_RT_HEARTBEAT_S=1` khi hạ orphan |
| B5 | TC-4: Hub chạy host, chỉ container dùng `host.docker.internal` | Catalog `base_url` `localhost`; Runtime `AGENT_RT_HUB_URL`/MK qua `host.docker.internal` + `--add-host …:host-gateway` |
| B6 | TC-3/TC-6: đọc ngay sau đổi cấu hình, điều kiện chờ thoả sớm | Chờ cache Hub ≤ 5 s bằng điều kiện phản ánh **thay đổi cuối**; ca tự dọn ở `finally` |
| B7 | TC-4/TC-7: helper tự chèn dữ liệu sau `counts()`, đếm trước khi run của ca ghi xong | Tạo hội thoại trước `counts()`; `settleRuns` trước khi đếm |
| B8 | Lọc test sai: `bun run test:int <path>` chạy cả repo | `bun --env-file=… --config=bunfig.int.toml test --timeout 30000 ./tests/acceptance/H2c/<file>`; stack/hubdev `--config=bunfig.stack.toml` |
| B9 | AC-08 H2c: ca không dựng được qua int (F15, L4) | Gọi thẳng `fetch_attachments`; không ép int vào nhánh không tới được |

### QW-R · hàm thuần `tests/acceptance/H2c/rules/` (2026-10-05)
`bun test ./tests/acceptance/H2c/rules` → **66 ca / 10 file: 50 đỏ, 16 xanh** (342 `expect`). Không DB/Redis/đĩa. typecheck (`tsc -p tsconfig.tests.json`: 0 lỗi ở `rules/`), biome, `check:size`, `check:fn`, `trace --check` xanh. Helper `rules/_rules.ts` (byte mẫu, `uid` dải `a2c0…`, `payloadInput`, `ch()` code point, `lookup` hàm stub thiếu). Chưa khoá (Q2).

| File | ID | Đỏ đúng lý do / tổng | Lý do đỏ | Xanh trước code (lý do) |
|---|---|---|---|---|
| `attachment-name.test.ts` | R01–R10 | 14/14 | stub `not implemented` (`parseFilenameHeader`, `displayName`, `splitExt`, `extOf`, `safeName`, `contentDisposition`, `difyFileType`) | — |
| `sniff.test.ts` | R11–R16 | 7/7 | stub `isExecutableHead`/`headOk`/`FileInspector.push`/`extOf` | — |
| `run-files.test.ts` | R17–R24 | 10/10 | stub `pickRunFiles`, `jobFileNames`, `jobAttachments`, `*FilesBlock`, `withOutHint`; R21 `orchestratorPrompt` + R24 `buildJobPayload`: `expect` (khối `<attachments>`/khoá `attachments` chưa có — B4/B6) | — |
| `attach-limits.test.ts` | R25–R30 | 6/6 | stub `overQuota`, `parseAttachEnv`, `storageKey`/`keyUnder`, `orphanCandidate`; R27 `expect(msg).not.toMatch(/^not implemented/)` (chặn stub ném "lọt" ca ném) | — |
| `command-input-h2c.test.ts` | R31–R34 | 5/8 | `expect`: `buildInputs` chưa dựng `files`, chưa `invalid` khi lệch map (B7) | R31 hồi quy H2a (vắng/`null`); R32 vắng file → `missing`, tuỳ chọn → ok; R34 `file` không map → `missing` (hành vi H2a đã đúng) |
| `mcp-h2c.test.ts` | R35–R38 | 3/6 | R35 `hasFiles` false/true + R36 `withFiles`: `expect` (tham số chưa dùng — B8); R37 stub `fileArg` | R35 `hasFiles` vắng (H2a); R36 `withFiles` vắng (H2a); R38 `TOOL_FILE_TEXT` (hằng có từ B0) |
| `dify-upload.test.ts` | R39–R40 | 2/2 | **module `dify/dify-upload.ts` chưa có** → nạp động, ném `not implemented: dify/dify-upload.ts (stub thiếu)` | — |
| `run-errors-h2c.test.ts` | R41 | 1/2 | `expect`: hint `file_rejected` chưa có | R41 vế hồi quy (7 mã × 2 locale, `refused` H2b) |
| `messages-h2c.test.ts` | R42–R43 | 2/3 | R42 `expect` (`toMessage` bỏ qua tham số `refs`); R43 `toAttachmentRef` **chưa có** → `lookup` ném `not implemented` | R42 `refs` vắng/`[]` → y hệt H2b |
| `contracts-h2c.test.ts` | R44–R49 | 0/8 | — | cả 8: contract C2 (`b3658f0`) đã có hằng/schema/fixture — xanh đúng (P2 chỉ thêm) |

**Lệch plan / cần backend-lead** (stub B0 `3f54974` thiếu so với plan-rules; test viết theo plan-rules, biên dịch được, đỏ nêu rõ "stub thiếu"):
1. `apps/hub-api/src/modules/dify/dify-upload.ts` (`mapDifyUploadError`, `difyUploadId`, plan-rules §5) **không tồn tại** — test nạp động `import(MODULE)`; khi thêm file đúng đường dẫn/tên export, test chạy thẳng.
2. `conversations.rules.ts`: thiếu `toAttachmentRef` và tham số thứ 4 `refs?: readonly AttachmentRef[]` của `toMessage` — test gọi qua `lookup`/kiểu hàm rộng hơn (gán được).
3. `orchestrator.prompt.ts` `PromptInput.attachments?` và `runner.rules.ts` `PayloadInput.attachments?` chưa khai báo — test truyền qua `as PromptInput`/`as PayloadInput`.
4. `mcp.rules.ts` `toolInputSchema(inputs, withFiles)`: plan-rules dùng `i.description ?? i.name` nhưng `WorkflowInput.description` bắt buộc (contract M2) — R36 dựng input thiếu mô tả bằng ép kiểu; nếu catalog luôn có mô tả, nhánh `?? i.name` chỉ là phòng thủ.

### QW-A1 · int hub-api `tests/acceptance/H2c/*.int.test.ts` (2026-10-05, sau QW-R `e9fe12d`, D1 `3b5bd02`, B0 `3f54974`)
`bun --env-file=<chỉ *DATABASE_URL> --config=bunfig.int.toml test --timeout 30000 ./tests/acceptance/H2c/<file>` (tuần tự; DB riêng `ai_system_h2c_qwa1_test` + `ai_system_h2c_qwa1_hub_test`, **đã drop**); perf `PERF=1 … --config=bunfig.perf.toml`. **84 ca / 11 file + helper `_h2c.ts` — 76 đỏ đúng lý do, 8 xanh.** `tsc -p tsconfig.tests.json` 0 lỗi ở `H2c/*.ts` · biome sạch · `check:size`/`check:fn` OK · `trace --check` OK. Mọi đỏ là `expect` (hoặc stub `not implemented`), không TypeError/fixture/mạng.

| File | ID | Đỏ / tổng | Lý do đỏ | Xanh trước code (lý do) |
|---|---|---|---|---|
| `upload` | A01–A19 | 19/19 | `POST /attachments` 404 (chưa mount); A05 vế 401 (`/attachments` chưa ở `PROTECTED_PREFIXES` → 404) | — |
| `quota` | A20–A24 | 5/5 | upload 404 thay 201/409 | — |
| `storage` | A25–A29 | 8/8 | A25 (4 cấu hình; Linux thêm `chmod 0500`) server **không thoát** sau 10 s; A26 thư mục không được tạo; A27–A29 stub `not implemented: createLocalStorage` | — |
| `content` | A30–A37 | 8/8 | `GET /attachments/:id(/content)` 404 (đối chứng chủ 200 đỏ), A32 404 thay 401, A37 upload 404 thay 415 | — |
| `send` | A40–A52 | 11/13 | id lạ/khác chủ/hết hạn → 200 thay 404 AF; id hợp lệ không gắn (`message_id` NULL); R10: `CMD_NOT_FOUND`/`NOT_FOUND` flow/409/429 trước 404 AF; E10/E11 không `attachments` | A40 (400 do `SendMessageRequestSchema` C1), A48 (không file → không khoá, C1) |
| `bind-race` | A53–A55 | 3/3 | 2 × 200 thay 200 + 404; id không gắn; A55 `storageError` (`createLocalStorage` stub) | — |
| `run-files` | A56–A62 | 7/7 | `runs.attachment_ids` = `{}`; A62 `/hoadon` + file → 422 `CMD_MISSING_ARG` (B4/B7) | — |
| `sweeper` | A120–A129 | 9/9 | `expectStorage`: `not implemented: createLocalStorage` (sau đó `sweepOnce` stub); dữ liệu SQL/đĩa dựng xanh trước đó | — |
| `db` | A130–A134 | 0/5 | — | cả 5 (D1) |
| `compat` | A140–A142 | 3/4 | A141 401→404 (`PROTECTED_PREFIXES`), ids không kiểm/gắn khi vắng deps (PL14); A142 preview/E11 không `attachments` | A140 (tin không file = H2b) |
| `perf.perf` | PF1–PF3 | 3/3 | upload 404; ids không gắn; `storageError` | — |

Xanh khác §8: A40, A48 (C1 có sẵn — đúng); A141, A142, A05 đỏ vì gộp vế mới (401 `/attachments`, PL14, preview có file) — vế hồi quy trong cùng ca xanh.

**Helper `_h2c.ts` (QW-A2 dùng lại):** `setupH2c({catalogBaseUrl?})` (= `setupH2b` + catalog H2c: `hoadon-file`, `anh-tuy-chon`, `/hoadon`, `/hoadon-async`, `/sai-map`, `/file-arg`, `/hoadon-tuy` thuộc feature `translate`; agent `hoadon` ↔ `hoadon-file` + `create-trello-card`, `allowed_tools [Read, Grep, Write]`) · `startHubH2c(k, {tenantMaxBytes?, attachments?: false, extra?})` → `HubC{dir, storage, storageError, port}` (thư mục tạm riêng, `stop()` xoá) · `expectStorage` · `upload(hub, token, bytes, name, {rawName?, chunked?, headers?})` (`keepalive: false`) · `uploadOk` · `rawUpload(port, headers, {bytes} | {total, chunk, everyMs, prefix?, abortAfter?, onChunk?})` · `rawGet` · `sendWith(hub, token, conv, content, ids?, flowId?)` · `expectAttachNotFound` · `codeOf` · `diskFiles`/`parts`/`KEY_RE`/`pathOf`/`writeStored` · `sample.{pdf,png,jpg,docx,csv,txt,md}(n)` · `sha256` · `insertAttachmentRow(sql, {who, origin, jobId, content+dir, size, createdAgoMs, purged, bind})` · `attRow` · `countsH2c` · `ageAttachment` · `userMessages`. Có sẵn ở H2a/H2b: `claimWithToken`, `jobInRun`, `startDify`, `captureLogs`, `settleRuns`, `ScriptRuntime3`.

**Lệch plan / cần backend-lead:**
1. `AppDeps.attachments` chưa có ở B0 ⇒ helper truyền qua `extra` (ép kiểu); B1 thêm khoá đúng tên `attachments: {storage, tenantMaxBytes, sweepS, sweep}` thì test chạy thẳng. `createLocalStorage` stub ⇒ hub dựng **không** deps file, ca đọc `storageError`.
2. Bun giữ kết nối keep-alive khi server trả lỗi trước khi đọc hết thân ⇒ byte thân còn lại bị đọc như request kế (`GET /health` → 400). Test dùng kết nối mới (`keepalive: false`, `rawGet`). Đề nghị Hub trả 413/415/409 sớm kèm `Connection: close` (hoặc đọc bỏ phần dư) — không ép trong test.
3. A24: hàng `origin='output'` chèn SQL (không qua `/outputs` của QW-A2) — ca chỉ kiểm hạn mức tính cả output.
4. A27: không ép log `attachment-path-escape` ở mức driver (`createLocalStorage` không nhận logger; plan-errors ghi log ở service) — chỉ ép `StorageKeyError` + không file ngoài gốc; symlink thư mục tenant: junction trên Windows, `dir` trên Linux (Q-T5).
5. A41: vế "tin không ids → không câu SQL `attachments` thêm" không quan sát được hộp đen ⇒ bỏ; thay bằng gắn đúng 1 và 10 id.
6. A128: "đúng một `skipped`" không tất định khi hai lượt không chồng nhau ⇒ test giữ khoá `pg_advisory_xact_lock(hashtext('hub.attach.sweep'))` (plan-db §4 nguyên văn) ⇒ `{0,0,0,skipped:true}`; song song: tổng `expired` = số hàng, lượt `skipped` không làm gì, ≥ 1 lượt chạy.
7. Đối chứng thêm (chống xanh giả do `notFound` JSON của app): A31/A33/A35 GET chủ 200 trước; A46/A52 gửi lại khi rảnh → gắn.
8. A16 dùng 4 MiB (kiểm giữa stream ở 2 MiB) thay 20 MiB; A07 vế "413 trước 409" dùng hub phụ `tenantMaxBytes: 1`; A15 cũng trên hub phụ đó (chunked → 409 chốt).
9. A129 Windows: file chỉ đọc (`chmod 0444` → `unlink` EPERM) thay `chmod` thư mục; A125 `now` = giờ thật (mtime đặt bằng `utimes`).
10. `/sai-map` map `note` (text) ← `attachment` (workflow `hoadon-file` không có `q`) — vẫn là "input text ← attachment ⇒ invalid" (R20).

### QW-A2 + MK-U · int Dify/MCP/nội bộ `tests/acceptance/H2c/*.int.test.ts` (2026-10-05, sau QW-A1 `dc05dda`)
Cùng lệnh QW-A1, DB riêng `ai_system_h2c_qwa2_test` + `ai_system_h2c_qwa2_hub_test` (**đã drop**). **48 ca / 5 file + helper `_h2c2.ts` — 45 đỏ đúng lý do, 3 xanh.** Mọi đỏ là `expect` (0 TypeError/fixture/mạng; fixture SQL, file trên đĩa, job SQL, chuỗi `ScriptRuntime` chạy xanh trước `expect` đỏ — A79 chạy thử bỏ vế file: hết chuỗi `run.finished`). `tsc -p tsconfig.tests.json` 0 lỗi · biome sạch · `check:size`/`check:fn` OK · `trace --check` OK.

| File | ID | Đỏ / tổng | Lý do đỏ | Xanh trước code (lý do) |
|---|---|---|---|---|
| `agent-job` | A70–A79 | 8/10 | `attachment_ids` chưa gắn/chốt (B4) ⇒ prompt Orchestrator không `<attachments>`, payload agent không `attachments`/khối file (B6); A74 `system_prompt` không `OUT_HINT` (vế `allowed_tools [Read, Grep, Write]` đã xanh — C2 + catalog); A78 `mcp.tools` thiếu `hoadon-file` (`hasFiles` — B8) | A71, A76 (vắng file ⇒ y hệt H2b) |
| `internal-download` | A80–A89 | 10/10 | `GET /internal/jobs/:job/attachments/:att` 404 `NOT_FOUND` (chưa mount) thay 200/401/404 đúng thân; đối chứng 200 đỏ trước | — |
| `outputs` | A90–A99 | 9/10 | `POST /internal/jobs/:job/outputs` 404; A96–A99 output không gắn vào tin trả lời (R26 — `SseWriter.finish`) | A95 (contract C2 đã có `job.result.outputs`; Hub chấp nhận) |
| `command-file` | A100–A109 | 11/11 | `attachment_ids` bị bỏ qua ⇒ `/hoadon*` + file → 422 `CMD_MISSING_ARG{missing:[file]}` thay 200/upload; A106 `/sai-map` `invalid` rỗng, `/file-arg` chạy (P13 chưa có); A107 file không gắn vào tin `/dich` | — |
| `mcp-file` | A110–A116 | 7/7 | `tools/list` job có file thiếu `hoadon-file` (H2a bỏ workflow `file` bắt buộc); A114 job không file vẫn có `anh-tuy-chon` (K10 chưa đổi); `tools/call hoadon-file` → `Unknown tool`; A115 `anh-tuy-chon {img}` → invalid thay xác nhận (vế `create-trello-card` xác nhận đã xanh) | — |

**MK-U** (`tools/hub-dev/src/dify-mock.ts`, khoá — `CHANGED` ở Q2): `POST /v1/files/upload` xử lý **trước** `record()` bằng `req.formData()`; ghi `MockCall{path, auth, body:{user, file:{name, type, size, sha256}}}`; 201 `{id:"upl-<n>", name, size, extension, mime_type, created_by:"mock", created_at}` (`n` đếm riêng, `reset()` về 0); chỉ thị theo **tiền tố tên file**: `upload-413*` → 413 `file_too_large`, `upload-415*` → 415 `unsupported_file_type`, `upload-400-too-large*` → 400 `{code:"file_too_large"}`, `upload-500*` → 500, `upload-noid*` → 201 không `id`, `upload-slow-<ms>*` → chờ; key `mk-401/404/400` → như workflow (ghi lại trước); thiếu phần `file`/không multipart → 400 `no_file_uploaded`. JSON cũ không đổi. `dify-mock.test.ts` (không khoá) +4 ca upload: `bun test tools/hub-dev` **11 pass**. Hồi quy sau sửa mock (DB `qwa2`): H2a int dùng MK `async` 13 · `command-run` 10 · `commands` 12 · `confirm` 11 · `db` 7 · `dify-agent` 7 · `dify-errors` 7 · `mcp` 9 · `secret` 8 · `test-run` 6 = **90 pass / 0 fail**; `bun run test:h2a:stack` **3 pass / 0 fail**. `dify_mock.py` không sửa.

**Helper `_h2c2.ts`** (`_h2c.ts` 572 dòng gần trần): `storedFile` (hàng `upload` chưa gắn + nội dung đĩa) · `fileJob` (`insertSqlJob` + file gắn tin user + `payload.attachments` + `runs.attachment_ids`) · `attachToJob` · `internalGet`/`postOutput` (`keepalive: false`) · `reclaim` (token + `started_at` mới) · `agentWithOutputs` (`job.result.outputs`) · `requeue` · `outputRow` (`created_at = started_at + 1 s`) · `endSqlRuns` · `uploadsOf`/`difyUser`/`setWorkflowKey` · câu chữ `OUT_HINT`, `orchBlock`/`agentBlock` (dựng lại từ plan-rules, không gọi stub), `FILE_REJECTED_HINT`, `TOOL_FILE`, `UNAUTHORIZED`.

**Lệch plan / cần backend-lead:**
1. A79 (L5) / A97: H2b-R19 — delegate đầu `done` + stream ⇒ trả thẳng ⇒ bước giữa dùng `partial` (A79: `hoadon` → `partial "sai"`) để Orchestrator đi tiếp; `max_steps` fixture H1 = 5 < số bước ⇒ đặt 10 trong `beforeAll` (trước khi dựng hub).
2. A74 vế "sát `SYSTEM_PROMPT_MAX`" dùng agent `writer` (H2b; `system_prompt` 19 990 ký tự + `allowed_tools [Read, Grep, Write]` đặt trước khi dựng hub) thay `hoadon` — tránh đổi cấu hình giữa file (TC-6).
3. A115 "workflow có file + side_effect" = `anh-tuy-chon` (`workflow_flags` + gắn agent `hoadon`, chỉ DB của `mcp-file`); `hoadon-file` không `side_effect`.
4. A96–A99: output chèn SQL (`outputRow`) + `job.result.outputs` XADD tay — tách R26 khỏi endpoint `/outputs` (A90–A94). Nếu `bindOutputs` chỉ dựa `outputs` của sự kiện hay chỉ dựa `job_id`/`started_at`, test vẫn đúng (cả hai được cấp). A99 thêm đối chứng run `finished` → gắn.
5. A77 resume: file tin 1 gắn bằng SQL (tách khỏi R11); A81 "token job khác cùng run" bằng `jobInRun` (H2a).
6. A116 `{file: 123}`: plan-errors §3 (NOT_ATTACHED "không phải chuỗi") vs validate schema H2a (`Invalid arguments…`) — test nhận một trong hai câu; thiếu `file` bắt buộc → `Invalid arguments…` nguyên văn.
7. A103 `upload-slow-65000`: `/hoadon` `timeout_s = 30` < hạn upload 60 s ⇒ assert `TIMEOUT` hoặc `UPSTREAM_ERROR` trong ≤ 70 s (ca riêng, timeout 100 s).
8. A100/A108 `upload_file_id = "upl-1"` (sau `dify.mock.reset()`, MK đếm theo instance); đếm MK theo tên file của ca (TC-2).
9. A85/A88 không ép mức log khác `error attachment-content-missing`; A88 kiểm vắng token/`authorization` trong mọi dòng log của các ca 401/404.

### Q2 · khoá test TS (2026-10-05, sau QW-A2 `e73ee31`)
Trước ghi: hồi quy MK-U xanh (`bun test tools/hub-dev` 11 pass; H2a int dùng MK 90 pass; `test:h2a:stack` 3 pass — mục QW-A2). `test:lock:verify` → đúng **29 `UNLOCKED`** `tests/acceptance/H2c/**` (`_h2c.ts`, `_h2c2.ts`, 16 `*.int.test.ts`/perf, `rules/` 11; chưa có `stack/`, `hubdev/`) + đúng **1 `CHANGED tools/hub-dev/src/dify-mock.ts`**, không dòng khác. `test:lock:write` → **342 file**; `verify` OK. `git diff tests/.lock`: +29 dòng H2c, đổi đúng 1 dòng `dify-mock.ts`. `dify-mock.test.ts` không khoá.

### QW-PU · unit Python thuần `apps/agent-runtime/tests/acceptance/test_files_rules.py` (2026-10-05, sau Q2 `6b88da9`, PY-00 `bca7ca0`)
`bun apps/agent-runtime/scripts/run.ts "uv run pytest tests/acceptance/test_files_rules.py"` → **92 ca (đã tham số hoá) / 1 file: 90 đỏ, 2 xanh**; 90/90 đỏ ở `NotImplementedError` của stub PY-00 (đếm `--tb=line`), không lỗi collect (import `importlib` trong thân test). Không DB/Redis/mạng (P25 dùng `httpx2.MockTransport` + `tmp_path`). Cả bộ `pytest` (unit): 717 pass, chỉ 90 ca này đỏ. ruff check/format, pyright (0 lỗi), `check:size` xanh.

| File | ID | Đỏ đúng lý do / tổng | Lý do đỏ | Xanh trước code (lý do) |
|---|---|---|---|---|
| `test_files_rules.py` | P01 `valid_job_file_name` | 32/32 | stub `NotImplementedError` | — |
| | P02 `classify_fetch` | 11/11 | stub | — |
| | P03 `backoff` + hằng | 4/5 | stub `backoff` | `FETCH_BACKOFF_S`, `FETCH_TIMEOUT_S` (hằng có từ PY-00) |
| | P04 hằng ↔ contract | 0/1 | — | hằng PY-00 + `JobAttachment` schema (`maxLength` 120, `maximum` 20 971 520); contract không sinh `JOB_FILE_NAME_MAX`/`JOB_OUTPUTS_MAX` ⇒ nhánh `hasattr` bỏ qua |
| | P05 `pick_outputs` | 5/5 | stub | — |
| | P06 `filename_header` | 17/17 | stub | — |
| | P07 `classify_output` | 12/12 | stub | — |
| | P08 `wants_outputs` | 6/6 | stub | — |
| | P25 (vế gọi thẳng, F15/L4/B9) `fetch_attachments` | 3/3 | stub `fetch_attachments` | — |

P25 ở unit: `name="../x"` (dựng `JobAttachment.model_construct`, contract cấm) → `FetchFailed(bad_name)`, 0 GET, `dest` rỗng, không file ngoài; `a.pdf` hợp lệ rồi `../x` → 1 GET, `dest` rỗng sau `FetchFailed`; symlink đặt sẵn `a.pdf → victim` → `exists`, `victim` nguyên, 0 GET.

**Lệch plan / cần backend-lead**:
1. P25 vế "`dest/sub` symlink ra ngoài → `path`" **không dựng được**: `valid_job_file_name` cấm `/`, `\` nên `target.parent == dest` luôn ⇒ nhánh `path` (§3.2 bước 1) không tới được qua `fetch_attachments`; không viết ca (giống B9 — không ép nhánh không tới). `path` còn đường thật từ `prepare_job_dirs` (lỗi OS, §3.1) — để int QW-P.
2. P05: test không ép thứ tự phần tử trong danh sách `skipped` (plan chỉ nói thứ tự **luật** loại) — so `Counter`; `over_limit` một mục mỗi file.
3. P25 symlink đặt sẵn: không ép `dest` rỗng sau `exists` (plan §3.2 chỉ xoá "file đã ghi"; symlink đặt sẵn không do Runtime ghi).

### Q-PU · khoá `test_files_rules.py` (2026-10-05)
`test:lock:verify` trước ghi → đúng **1 `UNLOCKED apps/agent-runtime/tests/acceptance/test_files_rules.py`**, không dòng khác. `test:lock:write` → **343 file**; `verify` OK. `git diff tests/.lock`: +1 dòng đúng file đó.

### Tranh chấp (qc, 2026-10-05, sau B5 `77ab61d`/B10 `cc539ef`/B3 `50b37cb`; sd "BUILD — B5/B10" B5-5)
| # | Test | Phán quyết | Sửa | Kết quả |
|---|---|---|---|---|
| TC-1 | `internal-download.int.test.ts` A81 | **Test sai**: `jobInRun(..., {tools: []})` ⇒ `mcp.tools` vi phạm `min(1)` (`McpConfigSchema`), helper H2a `expect(JobPayloadSchema…)` đỏ trước khi gọi Hub | `tools: [WF_KEY.dich]` (job anh em cùng run, chỉ cần token hợp lệ) | xanh |
| TC-2 | cùng file A83 | **Test sai**: `update hub.attachments set tenant_id` vi phạm `attachments_key_ck` (D1, `storage_key = tenant_id/id`) ⇒ lỗi SQL trước khi gọi Hub | Lệch tenant dựng qua `update hub.jobs set tenant_id = beta` (file giữ tenant acme, id vẫn trong payload; không FK/trigger trên `jobs.tenant_id`) — đúng ý ca `attachments.tenant_id ≠ jobs.tenant_id` | xanh |
| TC-3 | `sweeper.int.test.ts` A129 | **Test sai (phụ thuộc nền tảng)**: file chỉ đọc (Windows) không chặn được xoá với Bun 1.3.14 ⇒ đỏ dù code đúng | Giả lỗi bằng storage bọc ngoài: `remove(a.key)` ném lỗi, mọi phương thức khác uỷ quyền `expectStorage(hub)`; thêm kiểm hàng + file còn sau lượt lỗi; lượt sau (storage thật) dọn. Bỏ `chmod`/`join`/`WIN` | xanh |

Kiểm trên DB riêng `ai_system_h2c_tc_{,hub_}test` (chỉ `*DATABASE_URL`), mỗi file **3 lần liên tiếp**: `internal-download` 10/10 ×3; `sweeper` 8/9 ×3 — đỏ còn lại **A124** (E10 `available` / E12 `attachment_ids` — chờ **B4**, sd B10-5). Một lượt giữa chừng A125 đỏ khi B3 đang dở (sau commit `50b37cb` xanh), một lượt lỗi môi trường (`ALTER ROLE … tuple concurrently updated` / DB hub bị agent khác drop) — không do test. Đã drop cả hai DB. `tests/.lock`: chỉ đổi 2 dòng hash (`hashFile`), không `test:lock:write`; `verify` chỉ còn `UNLOCKED` của file người khác (`H2c/stack/*`), không `CHANGED`.

### Tranh chấp (qc, 2026-10-05, sau B7 `ada2446`/B9 `77919d7`; sd B7-8, B9-7)
| # | Test | Phán quyết | Sửa | Kết quả |
|---|---|---|---|---|
| TC-4 | `command-file.int.test.ts` A103 `upload-slow-65000*` (B7-8) | **Mock sai (khác server thật)**: `wait` của MK upload không nghe `req.signal` ⇒ Hub huỷ upload lúc 30 s (`TIMEOUT` đúng) nhưng handler MK vẫn ngủ đủ 65 s ⇒ `dify.close()` (`server.stop(true)`) ở `afterAll` quá hạn hook 30 s. Code Hub đúng; nâng timeout `afterAll` chỉ che lỗi mock và làm chậm bộ | `tools/hub-dev/src/dify-mock.ts`: `wait(ms, signal?)` dậy sớm khi `abort`; nhánh `upload-slow-*` truyền `req.signal`, client đã bỏ ⇒ trả 499 `client_closed` (không ai đọc, không tăng `uploads`). Luồng SSE `mk-slow-*` không đổi | xanh, không còn "hook timed out" |
| TC-5 | `outputs.int.test.ts` A90 (B9-7) | **Test sai**: `attRow` (`select *`) — cột `size bigint` ⇒ postgres.js trả chuỗi (`"32"`), `toMatchObject({size: body.length})` đỏ chỉ vì kiểu; mọi trường khác + 201 + file trên đĩa đúng | `size: String(body.length)` | xanh |

Kiểm trên DB riêng `ai_system_h2c_tc2_{,hub_}test` (chỉ `*DATABASE_URL`, `--timeout 30000`): `command-file` 11/11, 0 fail, 0 "timed out" ×3 liên tiếp (~36 s/lượt; một lượt lẻ trước đó `0 pass 1 fail` ở hook đầu file — không tái hiện trong 4 lượt sau, coi lỗi môi trường khi agent khác chạy song song); `outputs` 10/10 ×3. Hồi quy MK: `dify-mock.test.ts` 11/11; H2a int (11 file) 96 pass 0 fail; `bun run test:h2a:stack` 3 pass 0 fail. `tsc -p tsconfig.tests.json` 0 lỗi, biome sạch. Đã drop cả hai DB. `tests/.lock`: chỉ đổi 2 dòng hash (`hashFile`: `dify-mock.ts`, `outputs.int.test.ts`), không `test:lock:write`; `test:lock:verify` OK. Code sản phẩm không đổi.

### QW-P · Python int + mock Hub file + stack + hubdev (2026-10-05, sau PY-02 `7b43db2`; Hub B2/B3/B5/B10 vào giữa chừng)
Python: `bun apps/agent-runtime/scripts/run.ts "export HUB_TEST_DATABASE_URL='…@postgres:5432/ai_system_h2c_qwp_hub_test' AGENT_RT_TEST_DATABASE_URL='…'; uv run pytest -m int tests/acceptance/<file>"` (env trong chuỗi lệnh, host `@postgres`). Stack: `HUB_MAX_CONCURRENT_RUNS=2 HUB_ATTACH_DRIVER=local bun --env-file=.env.test-h2c_qwp.local --config=bunfig.stack.toml test --timeout 120000 ./tests/acceptance/H2c/stack` (tuần tự). DB `ai_system_h2c_qwp_{,hub_}test` (**đã drop**). **47 ca P (25 đỏ, 22 xanh) + 9 ca S (7 đỏ, 2 xanh) + H01 (viết, chưa chạy)**. Mọi đỏ là `assert`/`expect` (0 lỗi collect/fixture/mạng); DB/Redis/mock/Runtime boot xanh. ruff check/format, pyright 0 lỗi; `tsc -p tsconfig.tests.json` 0 lỗi ở `H2c/{stack,hubdev}`; biome, `check:size`, `check:fn`, `trace --check` xanh.

| File | ID | Đỏ / tổng | Lý do đỏ | Xanh trước code (lý do) |
|---|---|---|---|---|
| `_hub_files.py` (mock, L6) | — | — | — | GET/POST nội bộ, chỉ thị `sha-wrong/short/long/5xx-once/5xx-always/401/404/slow=`, `*.exe/quota-/deny-/flaky-/hold-<ms>-`; Bearer so `token_hash` ∧ `running` qua DB |
| `attachments_int_test.py` | P20–P24, P26–P32 | 4/19 | P20, P26 (5xx-once), P28, P32 perf: text `echo:` thay `<tên>:<sha>` (`#fake:files` — PY-04); mọi vế tải/quyền/GET trước đó xanh | P21–P23 (3), P24, P26 5xx-always, P27 (2), P29 (2), P30, P31 (3), P32 vắng/`[]` (2) — PY-02 |
| `outputs_int_test.py` | P38, P40–P51 | 21/28 | P40–P46: 0 POST `/outputs` (`send_outputs` chưa nối `_close` — PY-03; `#fake:out*` — PY-04), P41 chờ POST quá 30 s; P46 empty/too_large: thiếu log `job.output_skipped`; P49 thiếu `job.outputs_skipped`; P50 log: 0 POST; P51 ×8: text `echo:` thay `written`/`denied:*` (`#fake:write` — PY-04) | P38 (F12, Runtime gửi nguyên `inputs`), P47 ×2 (PY-02 `out/` chỉ agent, 0700), P48 ×3 (0 POST — vế phủ định), P50 không file (PY-02 `encode_event`) |
| `stack/files` | S01, S02, S07 | 3/3 | S01/S02: content `echo:` (PY-04); S07: job tin 2 không có `attachments` (B4/B6) | — |
| `stack/out` | S03 ×3, S04 | 2/4 | S03: tin assistant không `attachments` (B9 `bindOutputs` + PY-03/04) | S03 `out-link` (không khoá — vế phủ định), S04 (0 hàng output — vế phủ định) |
| `stack/async-file` | S05 | 1/1 | 422 `CMD_MISSING_ARG` (B4/B7 bỏ qua `attachment_ids`) | — |
| `stack/orchestrated` | S06 | 1/1 | prompt Orchestrator không `<attachments>` (B4/B6) | — |
| `hubdev/attach` | H01 | — | chưa chạy: cần hub-dev (bước 12 `done:h2c`, `needsDev`) | — |

P32 perf (L10, báo cáo): 10 × 2 MiB tải 131 ms.

**Lệch plan / cần backend-lead:**
1. P42 dùng `Báo-cáo.md` (pct `B%C3%A1o-c%C3%A1o.md`): chỉ thị `#fake:*` tách theo `\S+` ⇒ tên có khoảng trắng không truyền được.
2. P25 không lặp ở int (đã ở unit `test_files_rules.py`, L4/B9). P21–P23: file **thứ hai** lỗi để kiểm "xoá cả file đã tải".
3. P51 symlink `out/l.md`: `prepare_job_dirs` làm mới `out/` khi claim ⇒ không đặt sẵn được; test tạo symlink trong lúc `#fake:sleep=3` — giả định PY-04 xử lý `#fake:write` sau `sleep` (như `_body` hiện hành).
4. P31 shutdown: kỳ vọng `failed INTERNAL_ERROR orphaned` (cha ghi như H1 §1.5) — JobRun `stopped_no_write` không ghi `attachment`.
5. P49: kỳ vọng đúng 1 log `job.outputs_skipped{reason:"no_hub_url", level:"warning"}`; P50 log: chỉ ép `job.outputs.sent == 1` và không dòng log nào chứa tên file.
6. S05 (TC-4 + upload): `hoadon-file` vừa Hub (host) upload vừa Runtime (container) chạy ⇒ `base_url` = IPv4 không-loopback của host (`hostIp()`, container tới được — thử trên Docker Desktop; hosts Windows `host.docker.internal` = IP cũ).
7. S02 run 3 `#fake:read=attachments/a.pdf` dựa R14 (file của flow vào job sau); S06 tìm job Orchestrator theo `payload.agent.role`.
8. Môi trường: `ALTER ROLE … tuple concurrently updated` khi agent khác migrate cùng lúc ⇒ chạy lại (không do test).

### Q3 · khoá lần 2 (2026-10-05, sau QW-P `ac39836`, trước PY-03)
`test:lock:verify` trước ghi → đúng **9 `UNLOCKED`** (`apps/agent-runtime/tests/acceptance/{_hub_files.py, attachments_int_test.py, outputs_int_test.py}`, `tests/acceptance/H2c/stack/{_stack.ts, files, out, async-file, orchestrated}.stack.test.ts`, `H2c/hubdev/attach.hubdev.test.ts`), không `CHANGED`/`MISSING` (sửa `apps/hub-api` của B2/B3/B5/B10 không thuộc file khoá). `test:lock:write` → **352 file**; `verify` OK. `git diff tests/.lock`: +9 dòng, 0 dòng xoá/đổi.

### I1 · 2026-10-05 (sau B0–B10, PY-00…04, C1–C2, D1, MK; HEAD `48faf8a`)
`bun run done:h2c` — DB riêng: `TEST_DATABASE_URL` = `ai_system_h2c_i1_test` (`db:test:create h2c_i1`), `HUB_TEST_DATABASE_URL`/`AGENT_RT_TEST_DATABASE_URL` = `ai_system_h2c_i1_hub_test` (tạo tay); chỉ export `*DATABASE_URL`; Redis mặc định; compose chạy; không chạy song song (~2,4 GB RAM trống, không thiếu RAM). Lượt 1 đầy đủ: 1–2 xanh, **3 đỏ** (1 ca Admin chập chờn) ⇒ dừng. Áp quyết định nới perf (spec-decisions "Quyết định người dùng — nới perf") rồi lượt 2 `--from=4`: 4–11 xanh, **12 đỏ (c)**. Bước 13–16 chạy tay sau lượt 2 (runner dừng ở đỏ): xanh. DB test đã drop.

| # | Bước | Kết quả |
|---|---|---|
| 1 | typecheck (turbo, 6 gói) | xanh |
| 2 | unit (… + `H2c/rules`) | xanh — 612 pass, 13 skip, 0 fail |
| 3 | int `H1/ H2a/ H2b/ H2c/ M ADM-NFR-06` | lượt 1 **đỏ (a) chập chờn, không thuộc H2c**: 2106/2107 (21,9 phút) — `M4/quota-alerts.int.test.ts:150` M4-AC18 chờ `attempts=1` nhận 2 (đã gặp ở `done:h1` lượt 1, H1 test-plan-cases §10; dispatcher thử lại trước khi `poll` đọc). Chạy riêng file 3 lần: 11/11 ×3 xanh. `command-file.int` xanh (không đỏ lẻ) |
| 4 | `contracts:check` | xanh (21 pytest + 25 bun) |
| 5 | agent-runtime: ruff, format, pyright, lint-imports, pytest, pytest -m int | xanh — 856 unit + 181 int |
| 6 | `test:h1:stack` | xanh — 4/4 |
| 7 | `test:h2a:stack` | xanh — 3/3 |
| 8 | `test:h2b:stack` | xanh — 14/14 |
| 9 | `test:h2c:stack` (S01–S07) | xanh — 9/9 (S05 `async-file` xanh) |
| 10 | `test:contract:chat` (Hub thật) | xanh — 41 pass, 21 skip; không cần dọn hội thoại `lan` (CHAT-AC-19 xanh) |
| 11 | H01 `H2b/hubdev` | xanh — 2/2 |
| 12 | H01 `H2c/hubdev` | **đỏ (c) code sai — `tools/hub-dev/src/dev.ts` (MK)**: SSE `[run.started, step.started, step.finished, run.failed]`, log Hub `job-failed code=INTERNAL_ERROR reason=attachment "attachment fetch failed: no_hub_url"`. `runtimeEnv()` của hub-dev không đặt `AGENT_RT_HUB_URL` (và container hub-dev không `--add-host host.docker.internal:host-gateway` như harness stack H2a/H2c) ⇒ Runtime không tải được file đính kèm (`runtimes/cli/files/fetch.py` ⇒ `no_hub_url`). Test đúng (AC-01: gửi tin có file qua hub-dev ⇒ `run.finished`). Không sửa (không phải file qc) |
| 13 | `test:lock:verify` | xanh (352 file) — chạy tay |
| 14 | `trace --check` | xanh (190 mã) — chạy tay |
| 15 | `check:size --all` | xanh (1663 file) — chạy tay |
| 16 | depcruise | xanh (292 module) — chạy tay |
| 17 | `tsc -p tsconfig.tests.json` (báo cáo) | xanh cả 2 lượt |
| 18 | `test:perf H2a H2b H2c` (báo cáo) | lượt 1 (ngân sách cũ) 587/594: **PF1** RSS 9,82 MiB/upload > 8 MiB (p95 thời gian đạt); **PF2** +14,3 ms p95 > 5 ms; PF3 xanh; H2b/H2c `hubdev` "Unable to connect" (hub-dev không chạy vì lượt dừng ở 3); Admin ADM-FR-53 5,51 ms > 5, ADM-NFR-03 users +24,6 ms > 20. Lượt 2 (ngân sách mới PF1 ≤ 16 MiB, PF2 ≤ 40 ms) 590/594: **PF1–PF3 xanh**; đỏ: H2c H01 (= bước 12), Admin ADM-FR-53 6,18 ms > 5, ADM-NFR-03 members 387 ms > 200, grants 112 ms > 100 (Admin, nhiễu máy bận, không thuộc H2c) |

**S05 IP:** `tests/acceptance/H2c/stack/_stack.ts` `hostIp()` lấy động qua `os.networkInterfaces()` (IPv4 đầu tiên `!internal`, vắng ⇒ `host.docker.internal`), không ghi cứng `192.168.2.18` ⇒ không sửa. Ghi chú: máy này IPv4 đầu tiên là `vEthernet (WSL)` 172.26.0.1 (không phải Wi-Fi 192.168.2.18) — Hub (host) và Runtime (container) đều tới được, S05 xanh. Nếu máy khác chọn phải adapter không tới được thì cân nhắc ưu tiên adapter có gateway.

**Lỗi code:** 1 — hub-dev thiếu `AGENT_RT_HUB_URL` cho Runtime (bước 12). Đề xuất (backend-lead, MK): `runtimeEnv(inContainer)` thêm `AGENT_RT_HUB_URL` = `http://host.docker.internal:<cổng hub-dev>` (container, kèm `--add-host host.docker.internal:host-gateway`) / `http://localhost:<cổng>` (tiến trình), rồi chạy lại `bun run done:h2c --from=12`. **I1 chưa tick.**

**Sửa (backend-lead, I1 lượt 3 · 2026-10-05):** `tools/hub-dev/src/dev.ts` (MK) — `AGENT_RT_HUB_URL` + `HUB_PUBLIC_INTERNAL_URL` = `http://host.docker.internal:4000` khi Runtime trong container (kèm `--add-host host.docker.internal:host-gateway`), `http://localhost:4000` khi tiến trình thường (sd "I1 — sửa MK (hub-dev)"). `HUB_PUBLIC_INTERNAL_URL` có cùng lỗi (MCP `payload.mcp.url` = `localhost` với container) ⇒ sửa đồng bộ. Test khoá không đổi.

`bun run done:h2c --from=12` — DB riêng `TEST_DATABASE_URL` = `ai_system_h2c_i1b_test` (`db:test:create h2c_i1b`), `HUB_TEST_DATABASE_URL`/`AGENT_RT_TEST_DATABASE_URL` = `ai_system_h2c_i1b_hub_test` (tạo tay); chỉ export `*DATABASE_URL`. Runner: `done:h2c XANH (từ bước 12)`. DB test đã drop.

| # | Bước | Kết quả |
|---|---|---|
| 12 | H01 `H2c/hubdev` | **xanh** — 1/1 (log Hub `attachment-served` → `GET /internal/jobs/:id/attachments/:id` 200) |
| 13 | `test:lock:verify` | xanh (352 file) |
| 14 | `trace --check` | xanh (190 mã) |
| 15 | `check:size --all` | xanh (1663 file) |
| 16 | depcruise | xanh (292 module) |
| 17 | `tsc -p tsconfig.tests.json` (báo cáo) | xanh |
| 18 | `test:perf H2a H2b H2c` (báo cáo) | 592/594 — PF1–PF3 xanh, H01 H2b/H2c xanh. Đỏ: (1) Admin ADM-FR-53 6,13 ms > 5 (máy bận, TD #56, không thuộc H2c); (2) `H2c/command-file.int.test.ts:285` A108 `ups[0].at <= jobs.created_at` sai **chập chờn khi máy bận** (so đồng hồ tiến trình MK trên host với `now()` của Postgres trong container) — chạy riêng file 3 lần trên cùng DB: 11/11 ×3 xanh; bước 3 lượt 1 cũng xanh. Đề xuất qc xem có cần dung sai đồng hồ. ADM-NFR-03 lần này xanh |

Bước 1–11: theo lượt 1–2 ở trên (bước 3 đỏ chập chờn Admin M4-AC18, không thuộc H2c, chạy riêng 3/3 xanh — không chạy lại). **I1 tick.**
