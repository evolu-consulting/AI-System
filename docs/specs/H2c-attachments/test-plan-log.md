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
