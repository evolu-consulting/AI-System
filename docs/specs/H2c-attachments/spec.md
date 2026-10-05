---
id: H2c-attachments
title: Đính kèm file (`POST /attachments`, gắn vào message, file cho agent CLI qua endpoint nội bộ, Dify `/files/upload`, `out/`)
milestone: H2c
status: approved               # draft → ready → approved → in-progress → done
requirements:
  [HUB-FR-44, HUB-FR-75, HUB-FR-12, HUB-FR-50,
   WRK-FR-11, WRK-FR-18, WRK-BR-06, WRK-BR-07,
   ADM-FR-21, AC-H03]
design:
  - docs/design/agent-hub/ba-agent-hub.md (§4, §5, §6 FR-44/75, §9.1, §11 AC-H03, câu hỏi mở 2)
  - docs/design/worker/ba-worker.md (§5 WRK-FR-11, 18; §6 WRK-BR-06, 07; §7 payload) · docs/design/architecture.md (§9)
  - docs/specs/H2a-dify-command/spec.md (H2a-R06, R09, R11, R14, R15, R17, R19–R22) · docs/specs/H2b-routing/spec.md (R06, R18, R30)
  - CR-039 (đề xuất, sửa chữ BA theo spec này)
owner: backend-lead (TS + Python)
---

# H2c · Đính kèm file

Mốc con thứ ba của H2. Quyết định: [spec-decisions.md](spec-decisions.md).

## 1. Phạm vi
| # | Làm | Mã |
|---|---|---|
| 1 | `POST /attachments` (thân thô, stream, ≤ 20 MiB), kiểm loại file, đặt tên an toàn, hạn mức tenant | HUB-FR-44, 75 |
| 2 | Interface `AttachmentStorage`, driver `local` trên ổ đĩa Hub, tách thư mục theo tenant (người dùng chốt U1) | HUB-FR-44, câu hỏi mở 2 BA-H |
| 3 | `attachment_ids` trong `SendMessageRequest`, gắn nguyên tử vào message; `attachments` trong `Message`; `GET /attachments/:id` + `/content` | HUB-FR-44, 75 |
| 4 | Job `agent.cli` mang danh sách file; Runtime tải qua `GET /internal/jobs/:job_id/attachments/:id` (token job, U2) vào `work/<job_id>/attachments/`; prompt liệt kê đường dẫn | WRK-FR-11, BR-06, 07 |
| 5 | Input map `attachment` (command sync/async) + input `file` của tool MCP → Hub gọi Dify `/files/upload` | HUB-FR-12, 50, ADM-FR-21 |
| 6 | `out/` → đính kèm vào tin trả lời (theo Q3) | WRK-FR-18 |
| 7 | Vòng đời: file chưa gắn hết hạn 24 h; xoá nội dung theo Q2; sweeper trong Hub | HUB-FR-44 |
| 8 | AC-H03 vế đính kèm; `fake-cli` `#fake:files`, `#fake:out` | AC-H03 |
| 9 | Dọn trước TD #52 (`job-agent-runner.ts` 380 dòng, R15 chạm) | TD #52 |

**Không làm (H2c):** quét virus/nội dung (ghi PRODUCTION-NOTES ở I3); driver S3/MinIO (interface sẵn, làm sau); hạn mức dung lượng cấu hình **theo từng tenant** và tính phí lưu trữ (H3); file cho agent `dify-workflow`/`dify-agent` chạy trong Hub (T11); trích chữ/OCR/chuyển định dạng; file cho runtime `llm`/`python` (H2d — dùng lại R15–R17); `routing_tests.has_attachment` (H4); sửa `apps/chat-web`, Admin, test khoá C1 (CR-impact ở I3); TD #43, #45, #54, #57, #58 (giữ TECH-DEBT).

## 2. Nghiệp vụ
**MiB** = 1 048 576 B; `MAX_FILE` = 20 MiB = 20 971 520 B.

### 2.1 Tải lên và lưu
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H2c-R01 | `POST /attachments` (JWT, mọi role). Thân = **byte của file** (không multipart, T1); header bắt buộc `X-Filename` (tên gốc, percent-encode UTF-8, ≤ 1 024 byte sau giải mã). `Content-Length` > `MAX_FILE` → 413 `ATTACHMENT_TOO_LARGE` **trước khi đọc thân**; thân stream thẳng ra file tạm, đếm byte, vượt `MAX_FILE` → huỷ, xoá file tạm, 413. Thân rỗng / thiếu `X-Filename` / giải mã lỗi → 400 `VALIDATION_ERROR`. Không giữ cả file trong RAM | HUB-FR-44 |
| H2c-R02 | Tên hiển thị `filename`: giải mã → NFC → lấy phần sau `/` hoặc `\` cuối → bỏ ký tự điều khiển (C0, C1, U+200B–U+200F, U+202A–U+202E, U+2066–U+2069) → trim khoảng trắng và `.` hai đầu → rỗng thì `file` → ≤ 200 đơn vị UTF-16 (cắt phần thân, giữ đuôi, không tách cặp surrogate — khớp zod `max(200)`, PL12). Tên trong work `safe_name`: từ `filename`, ký tự ngoài `[\p{L}\p{N} ._-]` → `_`, gộp `_` liên tiếp, không bắt đầu bằng `.`/`-` (thêm `_`), thân trùng tên thiết bị Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`, không phân biệt hoa) → thêm `_`, ≤ 120 byte UTF-8 (giữ đuôi). Không tên nào của user dùng làm đường dẫn trên ổ Hub | WRK-BR-07 |
| H2c-R03 | Loại file (Q1): đuôi của `filename` (không phân biệt hoa) phải thuộc danh sách cho phép; `mime` do **server** gán theo đuôi (bỏ `Content-Type` của client). Kiểm nội dung: `pdf` bắt đầu `%PDF-`; `png`/`jpg`/`jpeg`/`gif`/`webp` đúng chữ ký; `docx`/`xlsx`/`pptx` bắt đầu `PK\x03\x04`; nhóm chữ (`txt`, `md`, `csv`, `xml`, `json`) là UTF-8 hợp lệ (cho phép BOM), không byte NUL. Mọi file bắt đầu `MZ`, `\x7fELF`, `#!` → từ chối. Sai bất kỳ → 415 `ATTACHMENT_TYPE_NOT_ALLOWED`, xoá file tạm | Q1 |
| H2c-R04 | `AttachmentStorage` = `put(key, stream, maxBytes) → {size, sha256}` · `open(key) → stream` · `remove(key)` · `list(prefix)` (sweeper). Env `HUB_ATTACH_DRIVER` ∈ {`local`} (khác → hub-api không lên). Driver `local`: gốc `HUB_ATTACH_DIR` (tuyệt đối; khởi động tạo nếu thiếu, quyền 0700, thử ghi; lỗi → không lên). Key = `<tenant_id>/<attachment_id>` (chỉ uuid). Ghi `<key>.part` (`O_CREAT\|O_EXCL`, 0600) → fsync → rename. Mọi đường dẫn sau `realpath` phải dưới gốc, không → lỗi 500 + log | U1 |
| H2c-R05 | Thứ tự: stream ra `.part` + sha256 + kiểm R03 → transaction: khoá advisory theo tenant → kiểm hạn mức R06 → INSERT `attachments` (`origin='upload'`) → commit → rename. Lỗi sau khi ghi → xoá file. File không có hàng (crash giữa chừng) do sweeper R29 dọn | — |
| H2c-R06 | Hạn mức tenant: tổng `size` file chưa xoá nội dung của tenant + file mới > `HUB_ATTACH_TENANT_MAX_BYTES` (mặc định 5 GiB) → 409 `ATTACHMENT_QUOTA_EXCEEDED`. Cấu hình riêng từng tenant → H3 | T14 |
| H2c-R07 | 201 `Attachment{id, filename, mime, size, created_at}`. Log `attachment_uploaded{attachment_id, tenant_id, user_id, size, mime}` (không tên file, không nội dung). Không ghi `usage_logs` | HUB-NFR-04 |

### 2.2 Gắn vào tin nhắn, quyền, xem lại
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H2c-R08 | `SendMessageRequest.attachment_ids?`: 1–10 uuid, không trùng (sai → 400). `content` vẫn bắt buộc (T5) | HUB-FR-44 |
| H2c-R09 | Mỗi id phải: cùng `tenant_id` **và** `user_id` của JWT, `message_id IS NULL`, chưa hết hạn chưa gắn (R27), nội dung còn. Sai một id → 404 `ATTACHMENT_NOT_FOUND`, `details.ids` = các id sai theo thứ tự gửi; tenant khác, user khác, không tồn tại, đã gắn, đã hết hạn — **cùng một mã** (không lộ tồn tại). JSON, trước khi tạo run: không lưu gì | HUB-FR-75 |
| H2c-R10 | Thứ tự kiểm E12 (sửa H2b-R18): auth (401) → hội thoại (404) → body (400) → **đính kèm R09 (404)** → router `CMD_*`/`AGENT_NOT_FOUND`/`CMD_MISSING_ARG` → flow lạ (404) → `FLOW_BUSY` (409) → `TOO_MANY_RUNS` (429) → tạo run | H2b-R18 |
| H2c-R11 | Gắn trong **cùng transaction** tạo run, sau INSERT message user: `UPDATE attachments SET message_id, conversation_id, flow_id, bound_at WHERE id = ANY(ids) AND message_id IS NULL AND purged_at IS NULL` (theo user scope). Số hàng ≠ số id (hai tin gửi song song cùng file) → rollback, 404 `ATTACHMENT_NOT_FOUND`. Thứ tự khoá: sau mọi khoá của H2b (khoá user → flow → runs) | H2b-R17 |
| H2c-R12 | `Message.attachments?: AttachmentRef[]` (`{id, filename, mime, size, available}`; `available=false` khi đã xoá nội dung) — **chỉ có** khi tin có ≥ 1 file (tin user: file gửi kèm; tin assistant: file `out/`, R25), theo thứ tự `attachment_ids` / thứ tự R25. Không có file → vắng trường (C1 không đổi) | HUB-FR-44 |
| H2c-R13 | `GET /attachments/:id` → `Attachment` + `available`; `GET /attachments/:id/content` → byte. Chỉ chủ (tenant + user, RLS); hội thoại của file đã xoá, tenant/user khác, không tồn tại → 404 `NOT_FOUND`; `available=false` → `/content` 404. Header `/content`: `Content-Type` = `mime` server, `Content-Length`, `Content-Disposition: attachment; filename="<ASCII thay thế>"; filename*=UTF-8''<pct>`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, no-store`. Không hỗ trợ `Range` | HUB-FR-75 |
| H2c-R14 | **Tập file của run** (`A`): file của các tin (user và assistant) trong **flow** của run, tin mới nhất trước (tin hiện tại đầu tiên, trong tin theo thứ tự R12), chỉ `available`, cắt ở 10 file và tổng ≤ 100 MiB. Chốt lúc tạo run (`runs.attachment_ids`) — xoá/hết hạn sau đó không đổi `A` (R17 xử lý file mất). Run `command`: `A` = chỉ file của tin hiện tại | T3, T13 |

### 2.3 File cho agent CLI
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H2c-R15 | Job Orchestrator: không nhận file; prompt có khối `<attachments>` mỗi dòng `- <safe_name> (<mime>, <size> KB)` cho `A` (vắng khi `A` rỗng) để định tuyến. Job agent (`direct`, delegate): payload `attachments: [{id, name, mime, size, sha256}]` = `A` (`name` = `safe_name`, Hub khử trùng trong job bằng hậu tố `-2`, `-3`… trước đuôi); prompt thêm khối tĩnh (tiếng Anh) liệt kê `attachments/<name>` + mime + size và câu "đọc bằng đường dẫn tương đối" | WRK-FR-11 |
| H2c-R16 | Runtime trước khi chạy CLI, mỗi file: `GET {AGENT_RT_HUB_URL}/internal/jobs/<job_id>/attachments/<id>` Bearer token job → ghi `work/<job_id>/attachments/<name>`: thư mục 0700; `name` khớp lại luật R02 (sai → từ chối); `realpath` của đích dưới `work/<job_id>/attachments/`; mở `O_CREAT\|O_EXCL\|O_NOFOLLOW` 0600; đếm byte ≤ `size`, sha256 khớp; xong chmod 0400. Hạn 60 s/file (trong `timeout_s`), lỗi mạng/5xx thử lại 2 lần (1 s, 3 s). Thiếu `AGENT_RT_HUB_URL`, 401/404, sai size/sha256 → xoá file đã ghi, job `failed` `INTERNAL_ERROR` reason mới `attachment`, `run.failed INTERNAL_ERROR` (câu tĩnh) | WRK-FR-11, BR-06 |
| H2c-R17 | Hub `GET /internal/jobs/:job_id/attachments/:attachment_id` (không JWT/CORS, như H2a-R17): token job → job `running` ∧ `id` khớp ∧ `type='agent.cli'` ∧ `attachment_id` ∈ `payload.attachments` ∧ `attachments.tenant_id = jobs.tenant_id` → 200 stream `application/octet-stream`, `Content-Length`, `X-Content-SHA256`, `Cache-Control: no-store`. Mọi sai → 401 `UNAUTHORIZED` một thân. Đúng nhưng nội dung đã xoá → 404 `NOT_FOUND`. Không log token/thân | U2, WRK-BR-06 |
| H2c-R18 | Sandbox H1 giữ nguyên (H1-R21, WRK-BR-07) + một luật mới cho `Write` (R24): hook `realpath` chỉ cho trong `work/<job_id>/`; file của job khác (kể cả cùng flow) bị chặn. Resume session (H1-R23): job mới tải lại `A` vào thư mục job mới; đường dẫn cũ trong phiên bị hook chặn, prompt mới liệt kê đường dẫn mới | H1-R21, R23 |
| H2c-R19 | `fake-cli`: `#fake:files` → kết quả `done` text = các dòng `<name>:<sha256>` của `attachments/` (sắp tên); `#fake:read=<path>` (đã có) dùng để kiểm chặn đường dẫn; `#fake:out=<tên>[,<tên>…]` → ghi file chữ ngắn vào `out/` (R25) | test |

### 2.4 Dify: command và tool
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H2c-R20 | Input map `attachment` (sửa H2a-R06): giá trị = file **đầu tiên** của tin hiện tại (T9). Input `type=file` → Hub tải file lên Dify (R22) rồi gửi `{type, transfer_method:"local_file", upload_file_id}`. Input `file` map nguồn khác `attachment`, hoặc input không phải `file` map `attachment` → `CMD_MISSING_ARG` `details.invalid` (tên theo H2a-R06). `required` mà tin không có file → `details.missing` (như H2a). File gửi kèm mà command không map `attachment` → vẫn gắn vào tin, không gửi Dify | HUB-FR-12, ADM-FR-21 |
| H2c-R21 | Kiểm R20 (thiếu/sai) là lỗi router → JSON trước khi tạo run (H2a-R07). Tải lên Dify chạy **sau** khi tạo run: sync — trước lời gọi workflow; async — Hub tải lên rồi mới enqueue job, `payload.inputs` mang object file (Runtime gửi nguyên). Runtime **không** gọi Dify `/files/upload` (T7) | H2a-R09 |
| H2c-R22 | Dify upload: `POST {base_url}/files/upload` multipart (`file` stream từ Storage, tên = `safe_name`, `Content-Type` = `mime`; `user` = H2a-R15), key = credential của workflow (H2a-R08). `type`: `image/*` → `image`, còn lại → `document`. Hạn 60 s. Lỗi: 401/403/404 → `NOT_CONFIGURED`; 413 / `file_too_large` / 415 / `unsupported_file_type` → `UPSTREAM_ERROR` hint tĩnh "Dify không nhận file này (loại hoặc kích thước)." / "Dify rejected this file (type or size)."; khác → như H2a-R11. Tải mỗi lần gọi (không cache `upload_file_id`, T8). Ghi trace step (`detail.upload`: mime, size, ms); không usage | H2a-R11 |
| H2c-R23 | Tool MCP: input `file` → thuộc tính `{type:"string", description: "<mô tả> (file name in attachments/)"}`. Workflow có input `file` (bắt buộc hay không) chỉ vào `tools/list` khi job có ≥ 1 file (bỏ loại trừ H2a "input file bắt buộc"). `tools/call`: giá trị = `name` (hoặc `id`) của một file trong `payload.attachments` của job → R22 rồi gọi workflow; không thuộc → `isError` câu tĩnh "File không thuộc tin nhắn này." / "This file is not attached to this message.", 0 lời gọi Dify. Xác nhận `side_effect` không đổi (H2a-R21/R22) | HUB-FR-50, H2a-R19–R22 |

### 2.5 `out/` (Q3)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H2c-R24 | Runtime tạo `work/<job_id>/out/` (0700) trước khi chạy CLI (chỉ job agent). Agent ghi file bằng tool CLI `Write` — **bật theo agent** qua `runtime_options.allowed_tools` (`ALLOWED_TOOLS` + `Write`; mặc định vẫn Read, Grep); hook chỉ cho `Write` vào file **trực tiếp** trong `work/<job_id>/out/` (`realpath` thư mục cha = `out/`), nơi khác → deny `path_not_allowed`. Hub nối câu "file muốn trả cho user thì ghi vào `out/`" vào `system_prompt` job agent **chỉ khi** job có `Write` (PL4, PL9). Không job Orchestrator | WRK-FR-18, WRK-BR-07 |
| H2c-R25 | Job kết thúc `done`/`partial`: Runtime liệt kê file thường **trực tiếp** trong `out/` (không đệ quy, bỏ symlink, `realpath` dưới `out/`), sắp tên, ≤ 5 file, mỗi file ≤ `MAX_FILE`; còn lại bỏ + log. Mỗi file: `POST /internal/jobs/:job_id/outputs` (token job, thân thô, `X-Filename`) **trước** khi phát `job.result`. Hub áp R02, R03, R06 → `origin='output'`, `job_id`, `user_id` = user của run, chưa gắn → 201 `{id}`; R03/R06 sai → 415/409, Runtime bỏ file + log, **không** làm hỏng job. `job.result.outputs: [id]` | WRK-FR-18 |
| H2c-R26 | Run `finished` có tin assistant → gắn mọi output của các job **trong run** (lần claim cuối của mỗi job — PL10) vào tin đó (thứ tự job rồi tên, ≤ 10), cùng transaction ghi tin. Run `failed`/`cancelled` → output không gắn, hết hạn theo R27 | WRK-FR-18 |

### 2.6 Vòng đời
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H2c-R27 | File chưa gắn (`message_id IS NULL`) quá 24 h từ `created_at` → xoá nội dung **và** hàng. Không có endpoint xoá cho user (T4) | T4 |
| H2c-R28 | File đã gắn (Q2 = A): sống theo hội thoại. Hội thoại bị xoá (`deleted_at`) → nội dung bị xoá ≤ 1 chu kỳ sweeper; hàng giữ với `purged_at` (`available=false`) | Q2 |
| H2c-R29 | Sweeper trong hub-api (`lib/loop.ts`), mỗi `HUB_ATTACH_SWEEP_S` (mặc định 600 s), mỗi lượt **một transaction** giữ khoá advisory toàn cục (Hub khác bỏ lượt), lô 500: R27, R28, file `.part`/file không có hàng cũ > 1 h. Đánh dấu `purged_at` → xoá nội dung → xoá hàng (R27) (PL2, PL11; lỗi → lượt sau làm lại). Đồng hồ tiêm được (`sweepOnce`) | — |
| H2c-R30 | Tương thích: không `attachment_ids` → response/SSE như H2b; `test:contract:chat` 41 ca xanh không sửa; test khoá H1/H2a/H2b xanh nguyên văn | H2b-R30 |

## 3. Contract (backend-lead)
- **`@ai/contracts/chat` — sửa thẳng, chỉ thêm** (U3): `chat/attachments.ts`: `AttachmentSchema{id, filename ≤ 200, mime, size 1…MAX_FILE, created_at}`, `AttachmentRefSchema{id, filename, mime, size, available}`, hằng `ATTACH_MAX_BYTES`, `ATTACH_PER_MESSAGE_MAX = 10`, `ATTACH_ALLOWED` (đuôi → mime, Q1), `FILENAME_HEADER = "X-Filename"`; `SendMessageRequestSchema` + `attachment_ids?`; `MessageSchema` + `attachments?` (≥ 1 phần tử khi có); hằng **riêng** `CHAT_ATTACHMENT_ERRORS {ATTACHMENT_NOT_FOUND: 404, ATTACHMENT_QUOTA_EXCEEDED: 409, ATTACHMENT_TOO_LARGE: 413, ATTACHMENT_TYPE_NOT_ALLOWED: 415}` + `AttachmentNotFoundDetails{ids ≤ 10}` — **không** thêm vào `CHAT_API_ERRORS`/`CHAT_RUN_ERROR_CODES`. Không sự kiện SSE mới.
- **`@ai/contracts/hub`:** `AgentCliJob` + `attachments?: JobAttachment[] ≤ 10` (`{id, name, mime, size, sha256 /^[0-9a-f]{64}$/}`) · `WorkflowInputValue` + `DifyFileInput{type: image|document, transfer_method:"local_file", upload_file_id}` · `JOB_FAIL_REASONS` + `attachment` · `job.result` + `outputs?: uuid[] ≤ 5` · `ALLOWED_TOOLS` + `Write` (cuối; R24, PL9) · `contracts:gen/check`.
- **`@ai/contracts/hub-internal`:** `JobOutputResponse{id}`; `HUB_INTERNAL_ERRORS` + `NOT_FOUND: 404`, `ATTACHMENT_*` (413, 415, 409).

| Method | Path | Auth | Request → Response | Lỗi |
|---|---|---|---|---|
| POST | `/attachments` | JWT | byte + `X-Filename` → 201 `Attachment` | 400 · 401 · 409 `ATTACHMENT_QUOTA_EXCEEDED` · 413 · 415 |
| GET | `/attachments/:id` | JWT chủ | → `Attachment & {available}` | 401 · 404 `NOT_FOUND` |
| GET | `/attachments/:id/content` | JWT chủ | → byte (R13) | 401 · 404 |
| POST | `/conversations/:id/messages` | JWT chủ | `SendMessageRequest` + `attachment_ids?` → SSE C1 | như H2b + 404 `ATTACHMENT_NOT_FOUND` (R10) |
| GET | `/internal/jobs/:job_id/attachments/:attachment_id` | token job | → byte (R17) | 401 · 404 |
| POST | `/internal/jobs/:job_id/outputs` | token job | byte + `X-Filename` → 201 `{id}` | 400 · 401 · 409 · 413 · 415 |

## 4. Dữ liệu (backend-lead)
Migration `migrations-hub/0007_h2c_attachments.sql` (SQL ở plan-db):
- Bảng `hub.attachments`: `id`, `tenant_id`, `user_id`, `origin` (`upload`\|`output`), `job_id NULL`, `conversation_id NULL`, `flow_id NULL`, `message_id NULL` (FK `messages` ON DELETE SET NULL), `filename`, `safe_name`, `mime`, `size bigint` CHECK 1…20 971 520, `sha256 text`, `storage_key`, `created_at`, `bound_at NULL`, `purged_at NULL`. Index: `(message_id)`, `(tenant_id) WHERE purged_at IS NULL` (R06), `(created_at) WHERE message_id IS NULL` (R27). RLS như `messages` (scope `user`: tenant + user; `system`).
- `runs.attachment_ids uuid[] NOT NULL DEFAULT '{}'` (R14).
- `jobs` CHECK `error_reason` + `attachment`.
- BA §4 `messages.attachments (jsonb)` → thay bằng quan hệ `attachments.message_id` (CR-039).

## 5. UI
Không có UI Hub. Chip, tải lên, lỗi, file trả lời: Chat khi combine (CR-impact I3).

## 6. Hiệu năng
| Chỉ tiêu | Ngưỡng | Đo bằng |
|---|---|---|
| `POST /attachments` 20 MiB (localhost) | ≤ 1,5 s p95; RSS tăng ≤ 8 MiB/upload | int |
| Kiểm R09 + gắn R11 (10 id) thêm vào E12 | ≤ 5 ms p95 | `test:perf` |
| Runtime tải `A` 10 × 2 MiB | ≤ 2 s | Python int (chỉ báo cáo — L10) |
| Sweeper lô 500 | ≤ 2 s | int |

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| Ổ đĩa Hub | Thư mục tạm mỗi test (`HUB_ATTACH_DIR`) |
| Dify `/files/upload` | Mock Hub H2a (`tools/hub-dev/src/dify-mock.ts`) thêm `/files/upload` (ghi lại multipart, trả `id`; chỉ thị trả 413/415) |
| Claude CLI đọc PDF/ảnh | `fake-cli` R19; thật chỉ smoke `HUB_LIVE=1` (AC-17) |

Env mới (Hub): `HUB_ATTACH_DRIVER=local` · `HUB_ATTACH_DIR` (dev `.data/attachments`, gitignore) · `HUB_ATTACH_TENANT_MAX_BYTES=5368709120` · `HUB_ATTACH_SWEEP_S=600`. Runtime: `AGENT_RT_HUB_URL` (đã có) — cần khi job có file.

## 8. Tiêu chí nghiệm thu (qc)
Bảng AC-H03 + HUB-H2c-AC-01…17: [`spec-ac.md`](spec-ac.md). Lệnh xong mốc: `done:h2c`.

## 9. Câu hỏi mở
Đã chốt 2026-10-05 (người dùng): **Q1 = A**, **Q2 = A**, **Q3 = A** — [spec-decisions](spec-decisions.md) "Trả lời người dùng".

## 10. Rủi ro
| # | Rủi ro | Giảm thiểu |
|---|---|---|
| K1 | Driver `local` buộc mọi instance Hub dùng chung thư mục → chạy nhiều Hub cần ổ chia sẻ hoặc S3 | Interface R04; v1 một Hub; PRODUCTION-NOTES (I3) |
| K2 | File độc (macro Office, PDF có JS) tới agent/Dify; không quét | Allowlist + chữ ký (R03); tải về `attachment` + `nosniff` + CSP sandbox; agent không Bash; quét virus → PRODUCTION-NOTES |
| K3 | Prompt injection qua nội dung file | Như mọi đầu vào user: side_effect cần xác nhận (H2a-R21), sandbox R18 |
| K4 | Dify từ chối file (giới hạn mặc định Dify ~15 MB tài liệu / 10 MB ảnh, loại file theo app) | Hint riêng R22; hub-dev.md ghi `UPLOAD_FILE_SIZE_LIMIT` |
| K5 | Đầy ổ Hub | Hạn mức R06 + sweeper R27–R29; cảnh báo dung lượng → H3/ops |
| K6 | Thêm khoá vào transaction tạo run (R11) → deadlock | UPDATE theo id sau mọi khoá H2b; int concurrency AC-06 + `lock-order` |
| K7 | `work/<job_id>/` không được dọn sau job (hiện trạng H1) → file đính kèm nằm lại trên máy Runtime | TECH-DEBT ở PLAN; container mỗi job (WRK-NFR-02) |
| K8–K16 | Rủi ro kỹ thuật thêm (Bun thân request, TD #52, đổi hành vi H2a, symlink, deadlock, `work/` không dọn, `out/` không qua SSE, tool `Write`, Office không đọc được bằng CLI) | `tasks.md` "Rủi ro thêm" |

## 11. Tranh chấp test
- (không)
