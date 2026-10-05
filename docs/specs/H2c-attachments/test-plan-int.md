# Test plan · H2c-attachments · phụ lục int hub-api (A) (qc)

Phụ lục của [`test-plan.md`](test-plan.md) §5. Chung: `startHubH2c` (`_h2c.ts`, `HUB_ATTACH_DIR` = `mkdtemp` của file, `tenantMaxBytes` 5 GiB trừ khi ghi, vòng sweeper tắt — L1), `maxConcurrentRuns: 2`; `counts()` = số `messages/runs/jobs/attachments`; "0 ghi" = `counts()` không đổi + `diskFiles(dir)` không đổi (không `.part`); "404 AF" = 404 `{code:"ATTACHMENT_NOT_FOUND", details:{ids}}`. Byte mẫu: `pdf(n)` = `%PDF-1.4\n` + đệm `n`; `png`, `jpg`, `docx` theo chữ ký; MiB = 1 048 576.

## 2.1 `upload.int.test.ts` (A01–A19) · HUB-FR-44 · R01–R03, R05, R07 · AC-01–AC-04
| ID | Given/When → Then |
|---|---|
| A01 | AC-01: `lan` POST `pdf(1 MiB)` `X-Filename: hoadon.pdf` → 201 `Attachment` (parse `AttachmentSchema` strict, `mime:"application/pdf"`, `size` đúng); đĩa đúng 1 file `<dir>/<acme>/<id>` (không `.part`), sha256 file = sha256 thân = cột `sha256`; hàng `origin='upload'`, `user_id=lan`, `message_id/bound_at NULL` |
| A02 | AC-02: đúng `20 971 520` B → 201; `+1` (có `Content-Length`) → 413 `{code:"ATTACHMENT_TOO_LARGE", details:{max_bytes:20971520}}` **trước khi đọc thân** (server trả trước khi client gửi xong — client gửi chậm 1 MiB/50 ms, 413 nhận khi đã gửi < 2 MiB), 0 hàng, 0 `.part` |
| A03 | `Content-Length: 0` → 400 `{field:"body"}`; chunked rỗng → 400; 0 hàng/file |
| A04 | L3 (a): chunked không `Content-Length`, 20 MiB + 1 → 413 (bộ đếm `stage`), 0 hàng, 0 `.part`; chunked 1 MiB → 201 |
| A05 | L3 (b): socket thô `Content-Length: 1024`, thân 20 MiB + 1 → không hàng nào `size` > 1 024, không `.part`, kết nối kế `GET /health` 200; không JWT → 401 `AUTH_EXPIRED` trước mọi kiểm (kể cả thiếu `X-Filename`) |
| A06 | Thiếu `X-Filename` / `""` / `%ZZ` / ký tự thô `Hoá.pdf` / 1 025 byte giải mã → 400 `{field:"X-Filename"}`; 0 ghi |
| A07 | Thứ tự `plan` §2.4: header sai + `.exe` → 400 (header trước); `.exe` + `Content-Length` 21 MiB → 415 (đuôi trước 413); `Content-Length` 21 MiB + hạn mức đầy → 413 (trước 409) |
| A08 | Client đứt giữa chừng (huỷ `AbortController` sau 2 MiB) → không hàng, `.part` bị xoá (chờ ≤ 2 s), log `warn attachment-upload-aborted{tenant_id, user_id, bytes}`; Hub phục vụ request kế |
| A09 | AC-04 (Hub): tải với `X-Filename` pct của từng tên bảng R07 → `filename` trả = `displayName`, cột `safe_name` = `safeName` (so hàm R); đĩa chỉ `<uuid>/<uuid>` (regex) — không tên user nào trên ổ |
| A10 | Tên 300 ký tự `.txt` → `filename` 200 code point kết thúc `.txt`; `‮gnp.exe.txt` (U+202E) → 201 `mime:"text/plain"`, `filename:"gnp.exe.txt"` |
| A11 | AC-03 415: `.exe`; `MZ` đuôi `.pdf`; `.pdf` chứa PNG; `.html`; `.svg`; `.txt` có `00` (byte 5 MiB — giữa thân); `#!` đuôi `.md` → 415 `ATTACHMENT_TYPE_NOT_ALLOWED`, 0 hàng, 0 `.part`; log `info attachment-rejected{code:415}` |
| A12 | AC-03 201: `.docx` (`PK\x03\x04`), `.csv` BOM, `.JPG` (`FF D8 FF E0`) → 201, `mime` theo bảng `ATTACH_ALLOWED` (`image/jpeg`) |
| A13 | `Content-Type: application/x-msdownload` của client với `.pdf` hợp lệ → 201 `mime:"application/pdf"` (server gán, bỏ header client) |
| A14 | `.txt` UTF-8 cắt dở cuối file (`E1 BA`) → 415; `.json` UTF-8 hợp lệ → 201 `application/json` |
| A15 | R05: lỗi trong transaction **sau** khi stream xong (409 chốt — dựng như A22) → không hàng, `.part` xoá, không file cuối; sau mọi lỗi 4xx của file này `diskFiles` không đổi (file không hàng do crash: sweeper A125) |
| A16 | R05 thứ tự: trong lúc upload 20 MiB đang stream, `SELECT` hàng theo tenant → chưa có hàng (INSERT sau stream); sau 201 file cuối tồn tại **và** hàng có |
| A17 | Hai upload song song của cùng user → 2 id khác nhau, 2 file, không lẫn nội dung (sha256 từng file) |
| A18 | R07 log `attachment_uploaded{attachment_id, tenant_id, user_id, size, mime, origin:"upload"}`; **không** chứa tên file (`hoadon`), không chứa byte thân; không dòng `usage_logs` mới |
| A19 | Mọi role (`lan` user, `tadmin`) → 201; CORS preflight `X-Filename` được phép, `Access-Control-Expose-Headers` ∋ `Content-Disposition` (P17) |

## 2.2 `quota.int.test.ts` (A20–A24) · R06 · HUB-H2c-AC-14
| ID | Given/When → Then |
|---|---|
| A20 | AC-14 (L2): `tenantMaxBytes = 1 MiB`, 3 upload 400 KiB **song song** (có `Content-Length`) → đúng 2 × 201, 1 × 409 `ATTACHMENT_QUOTA_EXCEEDED`; 2 hàng, 2 file, 0 `.part`; 5 vòng (Q-T2) |
| A21 | Kiểm sớm: dùng 900 KiB, upload `Content-Length` 200 KiB → 409 **trước khi đọc thân** (gửi chậm như A02), 0 `.part` |
| A22 | Chốt dưới khoá: chunked (không `Content-Length`) 200 KiB khi dùng 900 KiB → stream xong rồi 409, `.part` xoá |
| A23 | Hạn mức theo **tenant**: `beta` không bị ảnh hưởng bởi dung lượng `acme`; file `purged_at` không tính (đặt `purged_at` SQL → upload lại được) |
| A24 | Dung lượng tính cả `origin='output'` (hàng output qua `/outputs`, A92) |

## 2.3 `storage.int.test.ts` (A25–A29) · R04 · HUB-H2c-AC-15
| ID | Given/When → Then |
|---|---|
| A25 | Spawn `apps/hub-api/src/server.ts` (như `startHubProcH2a`, env tối thiểu + DB): `HUB_ATTACH_DRIVER=s3` / vắng · `HUB_ATTACH_DIR=rel/x` · thư mục không ghi được (file thường ở vị trí dir; Linux: `chmod 0500`) → tiến trình thoát ≠ 0 trong ≤ 10 s, không cổng mở; stderr không chứa giá trị env |
| A26 | `HUB_ATTACH_DIR` chưa tồn tại → Hub lên, thư mục được tạo (0700 khi không `win32`) |
| A27 | Driver (`createLocalStorage({dir})`, L8): `stage("../x", …)`, `stage("t/../id")`, key hoa → `StorageKeyError`, không file ngoài gốc; thư mục tenant là symlink ra ngoài gốc → `StorageKeyError` + log `error attachment-path-escape{key}` (Q-T5) |
| A28 | `stage` → `discard` → không còn `.part`; `stage` → `commit` → file, `.part` mất; `stage` vượt `maxBytes` → `StorageTooLarge`, không `.part`; `inspect` false → `StorageRejected`; `.part` mở `wx` (đã có `.part` cùng key → lỗi, không ghi đè) |
| A29 | `open` key không có → null; `remove` key không có → ok; `list({after:null, limit:2})` sắp theo key, `partial` đúng, phân trang bằng `after`; `blob(key, mime)` → `Blob` đúng `size`/`type` |

## 2.4 `content.int.test.ts` (A30–A37) · R13 · HUB-FR-75 · AC-01, AC-05
| ID | Given/When → Then |
|---|---|
| A30 | AC-01: `GET /attachments/:id` chủ → `AttachmentDetail` (`available:true`, strict); `/content` → byte đúng (sha256), header **đủ**: `Content-Type: application/pdf`, `Content-Length`, `Content-Disposition` = `contentDisposition(filename)`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, no-store` |
| A31 | AC-05: `beta` user GET/`content` file `acme` → 404 `NOT_FOUND`; cùng tenant khác user (`hoa`) → 404; uuid không tồn tại → 404; `:id` không phải uuid → 404; thân 404 **giống hệt** nhau giữa 4 ca |
| A32 | Không JWT → 401 trước 404 (`PROTECTED_PREFIXES`) |
| A33 | P22: file gắn vào hội thoại rồi xoá hội thoại (`DELETE /conversations/:id`) → GET và `/content` 404 **ngay** (trước sweeper) |
| A34 | `purged_at` đặt (SQL) → GET `available:false`; `/content` 404 |
| A35 | Hàng còn, file trên đĩa bị xoá tay → `/content` 404 (hoặc 500) + log `error attachment-content-missing{attachment_id}`; không lộ đường dẫn |
| A36 | `Range: bytes=0-9` → 200 toàn bộ, không `Content-Range` |
| A37 | `.html`, `.svg` không tải lên được (415) ⇒ không có đường phục vụ HTML/SVG; `.txt` chứa `<script>` → `/content` `text/plain` + `nosniff` + `attachment` + CSP sandbox |

## 2.5 `send.int.test.ts` (A40–A52) · R08–R12 · AC-05, AC-06
| ID | Given/When → Then |
|---|---|
| A40 | R08: `attachment_ids` 11 / trùng / `[]` / `"x"` không uuid → 400 `VALIDATION_ERROR`; có ids mà thiếu `content` → 400; 0 ghi |
| A41 | 1 và 10 id hợp lệ → 200 SSE; tin không ids → không câu SQL `attachments` thêm (flow mới) |
| A42 | AC-05 (HUB-FR-75): id `acme` gửi bởi `beta` / id của `hoa` gửi bởi `lan` / không tồn tại / đã gắn / hết hạn (`created_at` lùi 24 h + 1 s) / `purged_at` → **mỗi ca** 404 AF `details.ids=[id]`, thân giống nhau trừ `ids`; 0 run/message/job |
| A43 | Lẫn: `[ok1, bad1, ok2, bad2]` → `ids=[bad1, bad2]` (thứ tự gửi); 0 ghi; `ok1` vẫn gắn được sau đó |
| A44 | AC-06: 2 id `[b, a]` (b tải sau) → hàng `message_id` = tin user, `bound_at`, `conversation_id`, `flow_id` đúng, `position` b=0, a=1 |
| A45 | Dùng lại id đã gắn ở tin mới → 404 AF |
| A46 | Rollback: ids hợp lệ nhưng router trả `CMD_NOT_FOUND`/`FLOW_BUSY`/`TOO_MANY_RUNS` → file **vẫn chưa gắn** (gửi lại thành công) |
| A47 | R12: E11/E10/lịch sử: tin user có `attachments` = `[b, a]` đúng thứ tự, `AttachmentRef` strict, `available:true`; tin assistant không output → **không khoá** `attachments` |
| A48 | Tin không file → `"attachments" in msg` false ở E10/E11/preview (C1 không đổi) |
| A49 | `available:false` hiện trong E10 khi hàng gắn có `purged_at` (L9, A124) |
| A50 | R10 thứ tự: hội thoại người khác + id sai → 404 `NOT_FOUND` (hội thoại); body sai + id sai → 400; id sai + `/khong-co` → 404 AF (trước `CMD_NOT_FOUND`); id sai + `@nope x` → 404 AF (trước `AGENT_NOT_FOUND`); id sai + `/hoadon` thiếu arg → 404 AF |
| A51 | id sai + flow lạ → 404 AF; id sai + flow đang chạy → 404 AF (trước `FLOW_BUSY`); id sai khi đã 2 run chạy → 404 AF (trước `TOO_MANY_RUNS`) |
| A52 | id hợp lệ + `FLOW_BUSY` → 409; + 2 run đang chạy → 429; file chưa gắn trong cả hai |

## 2.6 `bind-race.int.test.ts` (A53–A55) · R11 · AC-06 concurrency
| ID | Given/When → Then |
|---|---|
| A53 | AC-06: 2 POST song song (2 hội thoại khác nhau của `lan`) cùng id → đúng 1 × 200, 1 × 404 AF; file gắn đúng 1 message; tin/run của POST thua không tồn tại; 5 vòng (Q-T2) |
| A54 | 10 POST song song, mỗi POST 3 id lấy từ tập 5 id chồng lấn → mỗi id gắn ≤ 1 message; `pg_stat_database.deadlocks` không tăng |
| A55 | Sweeper chạy đồng thời gắn (`sweepOnce` với `now` = +24 h + 1 s khi file sắp hết hạn) → hoặc gửi 404 AF, hoặc file gắn và **không** bị xoá (PL2: claim `purged_at` trước) — không bao giờ tin trỏ file mất nội dung |

## 2.7 `run-files.int.test.ts` (A56–A62) · R14
| ID | Given/When → Then |
|---|---|
| A56 | Tin 1 (2 file) → tin 2 cùng flow không file → `runs.attachment_ids` run 2 = file tin 1 theo `position` |
| A57 | Tin 1 (a), tin 2 (b, c) → run 2 `A = [b, c, a]` (tin hiện tại trước) |
| A58 | 3 tin × 4 file (hàng SQL giả cỡ nhỏ) → run sau `A` 10 phần tử, mới nhất trước |
| A59 | Tổng > 100 MiB (hàng giả `size` 20 MiB × 6) → 5 đầu, dừng không nhảy cóc |
| A60 | File `purged_at` bị loại khỏi `A`; flow khác của cùng hội thoại không lẫn |
| A61 | Chốt lúc tạo run: sau khi run tạo, đặt `purged_at` cho file → `runs.attachment_ids` không đổi (job agent vẫn mang `A` — 404 khi tải, xem A85) |
| A62 | Run `command` (`/hoadon`) ở flow có file cũ → `A` = chỉ file tin hiện tại; flow mới không ids → `attachment_ids = '{}'` |

## 2.8 `agent-job.int.test.ts` (A70–A79) · R15, R24 · AC-07 (vế Hub) · AC-H03
| ID | Given/When → Then |
|---|---|
| A70 | Orchestrator job (`ScriptRuntime` đọc payload): prompt có `orchestratorFilesBlock(A)` ngay trước `<message>`; payload **không** `attachments` |
| A71 | Không file → prompt Orchestrator **===** H2b (so với run tương tự không file, khác id) |
| A72 | `@assistant x` + 2 file → payload `attachments` = `jobAttachments(A)` (id, name, mime, size, sha256 = cột), parse `AgentCliJobSchema`; `prompt` = prompt H2b + `"\n\n" + agentFilesBlock` |
| A73 | Trùng tên (`a.pdf`, `A.pdf`) → `name` `a.pdf`, `A-2.pdf` |
| A74 | `system_prompt` job agent kết thúc `OUT_HINT` (cả khi không file); Orchestrator **không** có `OUT_HINT`; system prompt agent sát `SYSTEM_PROMPT_MAX` → không `OUT_HINT`, log `warn attachment-out-hint-dropped{run_id, agent_id}` |
| A75 | Delegate (`ScriptRuntime` Orchestrator → `delegate assistant`) → job agent mang `A` + khối file như A72 |
| A76 | Không file → payload agent không khoá `attachments`, `prompt` **===** H2b |
| A77 | Resume (H1-R23): tin 2 cùng flow → job mới mang `A` của run 2 (file tin 1) |
| A78 | Job agent có file → `allowed_tools`/MCP theo `agentToolKeys(…, hasFiles=true)` (đối chiếu A110) |
| A79 | AC-H03 (L5): `lan` tải `hoadon.pdf`, gửi "kiểm tra hoá đơn đính kèm rồi tạo thẻ Trello nếu sai" + id; `ScriptRuntime`: Orchestrator (thấy `- hoadon.pdf (application/pdf, …)` trong `<attachments>`) → `delegate hoadon` (job có `attachments`) → `done "sai"` → `delegate trello` (job cũng có `A`) → `done` → `answer` ⇒ trace step `delegate(hoadon)`, `delegate(trello)`, `answer`; SSE `step.started` cho từng bước; tin user `attachments=[hoadon.pdf]` |

## 2.9 `internal-download.int.test.ts` (A80–A89) · R17 · AC-07 (401) · WRK-BR-06
| ID | Given/When → Then |
|---|---|
| A80 | Job agent `running` có token (claim `_h2a2.ts`) → `GET /internal/jobs/:job/attachments/:att` 200 `application/octet-stream`, `Content-Length`, `X-Content-SHA256` = cột, `Cache-Control: no-store`, byte đúng; log `info attachment-served{attachment_id, job_id}` không token |
| A81 | 401 `UNAUTHORIZED` + `WWW-Authenticate: Bearer`, **thân giống hệt nhau**: không header · token sai · token job khác (cùng run) · `:job` khác job của token · id ngoài `payload.attachments` (file cùng user khác tin) |
| A82 | Job đã xong (`succeeded`) / `queued` / `cancelled` → 401; job `workflow.async` có token → 401 |
| A83 | Lệch tenant: sửa SQL `attachments.tenant_id` ≠ `jobs.tenant_id` (id vẫn trong payload) → 401 |
| A84 | Không JWT/CORS: `Origin` lạ → không `Access-Control-Allow-Origin`; JWT user thay token → 401 |
| A85 | Nội dung đã xoá (`purged_at`) → 404 `NOT_FOUND`; file mất trên đĩa → 404 + `error attachment-content-missing` |
| A86 | Hai lần GET cùng file → cùng byte (đọc lại được, không tiêu thụ) |
| A87 | Requeue (H2b): claim lại job → token mới; token cũ → 401, token mới 200 (F2) |
| A88 | Log ca A81–A85: không chứa token, không `Authorization` |
| A89 | `:att` không phải uuid → 401 (không lộ dạng) |

## 2.10 `outputs.int.test.ts` (A90–A99) · R25 (Hub), R26 · AC-12 (vế Hub) · WRK-FR-18
| ID | Given/When → Then |
|---|---|
| A90 | Job agent `running` + token: `POST /internal/jobs/:job/outputs` `X-Filename: report.md` thân chữ → 201 `{id}` (`JobOutputResponseSchema`); hàng `origin='output'`, `job_id`, `user_id` = user run, `conversation_id`/`flow_id` = payload, `message_id NULL`; file `<dir>/<tenant>/<id>` |
| A91 | Sai: `.exe` → 415; `.pdf` thân chữ → 415; 20 MiB + 1 → 413; thiếu `X-Filename` → 400; thân rỗng → 400 (thân `toErrorBody`, `no-store`); 0 hàng/`.part` |
| A92 | P21: 5 output → 201 × 5; thứ 6 → 409 `ATTACHMENT_QUOTA_EXCEEDED`; hạn mức tenant đầy → 409 |
| A93 | Token sai / job Orchestrator (`role≠agent`) / job đã xong / `workflow.async` → 401 một thân |
| A94 | Log `attachment_uploaded{origin:"output", job_id}`; không tên file |
| A95 | `job.result` (XADD tay) có `outputs:[ids]` → Hub chấp nhận (contract); thiếu `outputs` → như H2b |
| A96 | R26: run `finished` (2 output từ job agent) → tin assistant E10 `attachments` = 2 ref sắp `safe_name`, `available:true`; `/content` (JWT chủ) đúng byte |
| A97 | 3 job agent trong run (delegate × 3) × 4 output → gắn 10 đầu theo (thứ tự job, tên); 2 còn chưa gắn |
| A98 | PL6: cùng job (requeue) đẩy `report.md` 2 lần → chỉ bản **mới nhất** gắn; bản cũ chưa gắn (hết hạn R27) |
| A99 | Run `cancelled` / `failed` sau khi job đẩy output → output không gắn (`message_id NULL`); sweeper +24 h xoá (A120) |

## 2.11 `command-file.int.test.ts` (A100–A109) · R20–R22 · AC-09, AC-10 (vế Hub) · HUB-FR-12 · ADM-FR-21
| ID | Given/When → Then |
|---|---|
| A100 | AC-09: `/hoadon ghi chú` + `hoadon.pdf` → MK ghi `POST /v1/files/upload` (multipart: `user = "<tenant>:<user>"`, file name = `safe_name`, `type` = `application/pdf`, size/sha256 đúng, Bearer = key workflow) **trước** `/v1/workflows/run`; `inputs.file = {type:"document", transfer_method:"local_file", upload_file_id:"upl-…"}`, `inputs.note`; run `finished`; step `workflow` `detail.upload = {mime, size, ms}` |
| A101 | Ảnh `.png` → `type:"image"` |
| A102 | MK `upload-415*` → `run.failed UPSTREAM_ERROR` + hint R22 (vi/en theo `runs.locale`); `upload-413*`, `upload-400-too-large*` cũng thế; `detail.upload.reason = "file_rejected"`; 0 lời gọi workflow |
| A103 | Key `mk-401` → `NOT_CONFIGURED`; `upload-500*` / `upload-noid*` → như H2a-R11 (`UPSTREAM_ERROR`, không hint file); `upload-slow-65000*` → `TIMEOUT`/`UPSTREAM_ERROR` theo H2a sau ≤ 60 s (ca dài, `--timeout`) |
| A104 | Tải mỗi lần gọi (T8): `/hoadon` hai tin, mỗi tin một file → 2 upload |
| A105 | Nhiều file → chỉ file **đầu** (T9) đi Dify; các file khác vẫn gắn vào tin |
| A106 | AC-09/K10: `/hoadon` không file → 422 `CMD_MISSING_ARG{missing:["file"]}`; `/sai-map x` (+/− file) → 422 `invalid`; `/file-arg x` → 422 `invalid`; 0 ghi, 0 upload |
| A107 | `/hoadon-tuy` không file → chạy, `inputs` không `file`; command không map `attachment` (`/dich en x` + file) → file gắn vào tin, 0 upload |
| A108 | AC-10 (vế Hub): `/hoadon-async` + file → 1 upload (Hub) **trước** INSERT job (`at` MK < `jobs.created_at`); payload `workflow.async` `inputs.file` = object file (parse `WorkflowInputValue`) |
| A109 | Async upload 415 → `run.failed` như A102, **không** job nào |

## 2.12 `mcp-file.int.test.ts` (A110–A116) · R23 · AC-11 · HUB-FR-50
| ID | Given/When → Then |
|---|---|
| A110 | AC-11: job `hoadon` có file (token MCP) → `tools/list` có `hoadon-file`, `inputSchema.properties.file = {type:"string", description:"Hoá đơn PDF (file name in attachments/)"}` |
| A111 | `tools/call hoadon-file {file:"hoadon.pdf"}` → 1 upload + 1 lời gọi workflow (`inputs.file` object); bằng `id` cũng được |
| A112 | Tên ngoài job (`khac.pdf`, file cùng user tin khác) → `isError` `"This file is not attached to this message."`, 0 lời gọi Dify |
| A113 | Upload 415 → `isError` `"Dify rejected this file (type or size)."`; `mk-401` → `TOOL_ERROR_TEXT.NOT_CONFIGURED` |
| A114 | AC-11/K10: job **không** file → `tools/list` không có `hoadon-file` **và** không có `anh-tuy-chon` (input `file` tuỳ chọn) |
| A115 | `side_effect` (`create-trello-card`) vẫn đòi xác nhận như H2a-R21 khi job có file; workflow có `file` + `side_effect` → xác nhận **trước** upload (0 upload khi `ask`) |
| A116 | Job có file, `tools/call` thiếu `file` bắt buộc → lỗi validate như H2a (0 upload) |

## 2.13 `sweeper.int.test.ts` (A120–A129) · R27–R29 · PL2 · HUB-H2c-AC-13
| ID | Given/When → Then (`sweepOnce({now})`, L1) |
|---|---|
| A120 | AC-13: chưa gắn, `now` = `created_at` + 24 h + 1 s → file và hàng mất; + 24 h − 1 s → còn |
| A121 | Output chưa gắn (run huỷ) cũng xoá như A120 |
| A122 | AC-13: hội thoại xoá → sau 1 lượt: nội dung mất, `purged_at = now`, hàng còn |
| A123 | Sau A122: `/content` 404, GET 404 (P22, L9) |
| A124 | Hàng gắn `purged_at` (SQL) trong hội thoại còn → E10 `available:false`, không vào `A` run sau |
| A125 | Mồ côi: `.part` mtime −1 h −1 s → xoá; −59 min → giữ; file không hàng −2 h → xoá; file có hàng sống −2 h → giữ; file của hàng `purged_at` → xoá |
| A126 | PL2: hàng `purged_at` chưa gắn mà file đã mất (crash giả) → lượt sau DELETE hàng, không lỗi |
| A127 | Lô 500: 501 hàng hết hạn → lượt 1 xoá 500, lượt 2 xoá 1; log `info attachment-sweep{expired, purged, orphans, ms}` chỉ khi > 0 |
| A128 | Khoá toàn cục: hai `sweepOnce` song song → tổng xoá = số hàng, không lỗi, một lượt bỏ (0) |
| A129 | `remove` lỗi (file bị khoá/không quyền — Linux `chmod` thư mục) → `warn attachment-remove-failed`, lượt sau dọn |

## 2.14 `db.int.test.ts` (A130–A134) · spec §4 · `plan-db` §1
| ID | Ca |
|---|---|
| A130 | Bảng `hub.attachments` đủ cột spec §4 + `position`; `runs.attachment_ids` mặc định `'{}'`; `jobs.error_reason='attachment'` được nhận |
| A131 | RLS scope `user`: `lan` không thấy/UPDATE hàng `hoa`/`beta` (0 hàng); `system` thấy hết; `agent_runtime` SELECT → 42501 |
| A132 | Xoá message → `attachments.message_id NULL`, hàng còn |
| A133 | CHECK: `size` 0 → 23514; `(message_id IS NULL) ≠ (bound_at IS NULL)` → 23514 |
| A134 | Index `attachments_tenant_live_idx`, `attachments_unbound_idx`, `conversations_deleted_idx` tồn tại (`pg_indexes`) |

## 2.15 `compat.int.test.ts` (A140–A142) · R30 · AC-16
| ID | Ca |
|---|---|
| A140 | Tin không `attachment_ids`: SSE, `run.started`, E10/E11 cùng tập khoá H2b; payload job như H2b (A71, A76) |
| A141 | App dựng **không** `attachments` deps (khung H1/H2a/H2b) → `POST /attachments` có JWT → 404, không JWT → 401; E12 không ids như H2b |
| A142 | Preview/danh sách hội thoại: tin cuối có file → `attachments` theo `toMessage`; không file → không khoá (C1 không đổi); test khung H1/H2a/H2b xanh nguyên văn (K03–K05) |

## 2.16 `perf.perf.int.test.ts` (PF1–PF3) · spec §6 (không chặn)
| ID | Ca |
|---|---|
| PF1 | `POST /attachments` 20 MiB × 10 → p95 ≤ 1,5 s; RSS tăng ≤ 8 MiB/upload (`process.memoryUsage().rss` cùng tiến trình) |
| PF2 | E12 với 10 id (R09 + R11) − E12 không id: p95 thêm ≤ 5 ms (100 lần) |
| PF3 | `sweepOnce` lô 500 (hàng hết hạn + file 1 KB) ≤ 2 s |
