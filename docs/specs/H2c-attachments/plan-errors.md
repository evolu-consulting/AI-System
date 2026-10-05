# Plan · H2c · Mã lỗi, HTTP, câu chữ, log (phụ lục `plan.md`)

Câu **nguyên văn** (kể cả dấu chấm). Không tên file, không nội dung file, không token trong câu lỗi/log (HUB-NFR-04). Không thêm mã `run.failed` (T16) — dùng `INTERNAL_ERROR`, `UPSTREAM_ERROR`, `NOT_CONFIGURED` có sẵn.

## 1. HTTP (`lib/errors.ts`, `ERROR_MESSAGES` tiếng Anh, client dịch theo `code`)
| Mã | HTTP | `message` | `details` | Khi nào |
|---|---|---|---|---|
| `AUTH_EXPIRED` | 401 | Session expired | — | JWT `/attachments*` (trước mọi thứ) |
| `VALIDATION_ERROR` | 400 | Invalid request | `{field: "X-Filename"}` / `{field: "body"}` / issues zod (E12) | `X-Filename` vắng/sai (`parseFilenameHeader`=null) · `Content-Length: 0` hoặc thân 0 byte · E12 `attachment_ids` sai (> 10, trùng, không uuid, mảng rỗng) |
| `ATTACHMENT_TYPE_NOT_ALLOWED` | 415 | File type not allowed | — | đuôi ∉ Q1 (trước khi đọc thân) · `FileInspector` false (xoá `.part`) |
| `ATTACHMENT_TOO_LARGE` | 413 | File too large | `{max_bytes: 20971520}` | `Content-Length` > max (trước khi đọc thân) · đếm byte vượt (huỷ đọc, xoá `.part`) |
| `ATTACHMENT_QUOTA_EXCEEDED` | 409 | Storage quota exceeded | — | R06 (sớm theo `Content-Length` hoặc chốt dưới khoá) · output thứ 6 của job (P21) |
| `NOT_FOUND` | 404 | Not found | — | `GET /attachments/:id(/content)`: uuid sai, khác chủ, hội thoại đã xoá, `/content` khi `available=false` |
| `ATTACHMENT_NOT_FOUND` | 404 | Attachment not found | `{ids: string[]}` (1–10, thứ tự gửi) | E12 R09 (sau body, trước router) · R11 gắn thiếu hàng (song song) |
| `INTERNAL_ERROR` | 500 | Internal error | — | `StorageKeyError` (realpath ngoài gốc — log `error attachment-path-escape`), `commit` lỗi, file mất khi `/content` |

Thứ tự E12 (R10): `AUTH_EXPIRED` → `NOT_FOUND` (hội thoại) → `VALIDATION_ERROR` → **`ATTACHMENT_NOT_FOUND`** → `CMD_*`/`AGENT_NOT_FOUND`/`CMD_MISSING_ARG` → `NOT_FOUND` (flow) → `FLOW_BUSY` → `TOO_MANY_RUNS`.

**Nội bộ** (`/internal/jobs/:job_id/…`, thân `toErrorBody`, `Cache-Control: no-store`): mọi sai token/job/loại job/id ngoài payload/lệch tenant → 401 `UNAUTHORIZED` "Unauthorized" + `WWW-Authenticate: Bearer` (một thân, như H2a) · nội dung đã xoá/mất → 404 `NOT_FOUND` "Not found" · output: 400/413/415/409 như bảng trên (cùng `message`).

## 2. Câu chữ theo `runs.locale`
| Chỗ | vi | en |
|---|---|---|
| Hint `UPSTREAM_ERROR` + reason Hub `file_rejected` (R22; `runErrorTextFor`; `message` giữ câu `UPSTREAM_ERROR` H1) | `Dify không nhận file này (loại hoặc kích thước).` | `Dify rejected this file (type or size).` |
| `run.failed INTERNAL_ERROR` do job `reason=attachment` (R16, T17) | câu `INTERNAL_ERROR` H1 (tĩnh, không hint mới) | như vi |

## 3. MCP (`TOOL_FILE_TEXT`, chỉ tiếng Anh — PL5)
| Khi | `isError` | Text |
|---|---|---|
| `tools/call` giá trị input `file` không thuộc `payload.attachments` / không phải chuỗi | true | `This file is not attached to this message.` (0 lời gọi Dify) |
| Dify upload `file_rejected` | true | `Dify rejected this file (type or size).` |
| Dify upload `NOT_CONFIGURED` / lỗi khác | true | `TOOL_ERROR_TEXT.NOT_CONFIGURED` / `.UPSTREAM_ERROR` (H2a) |

## 4. Dify upload (R22) → kết cục
| Dify `/files/upload` | Lệnh sync/async (`run.failed`) | Step `workflow` `detail` |
|---|---|---|
| 201 `{id}` | tiếp lời gọi workflow | `upload: {mime, size, ms}` |
| 401 / 403 / 404 | `NOT_CONFIGURED` | `upload: {mime, size, ms, status}` |
| 413 · 415 · 400 `code ∈ {file_too_large, unsupported_file_type}` | `UPSTREAM_ERROR` + hint §2 | như trên + `reason: "file_rejected"` |
| 5xx / mạng / hết 60 s / thân không có `id` | như H2a-R11 (`UPSTREAM_ERROR`/`TIMEOUT`) | `reason: "upstream"` |
Thân lỗi Dify chỉ log qua `maskSecret` (H2a), ≤ 300 ký tự; không log tên file.

## 5. Log (`logger`, JSON một dòng)
| Sự kiện | Mức | Trường |
|---|---|---|
| `attachment_uploaded` | info | `attachment_id, tenant_id, user_id, size, mime, origin` (`origin=output` thêm `job_id`) |
| `attachment-rejected` | info | `tenant_id, user_id, code` (413/415/409/400), `origin` |
| `attachment-upload-aborted` | warn | `tenant_id, user_id, bytes` (client đứt giữa chừng) |
| `attachment-path-escape` | error | `key` (chỉ uuid) |
| `attachment-content-missing` | error | `attachment_id` (hàng còn, file mất) |
| `attachment-served` | info | `attachment_id, job_id` (endpoint nội bộ; không token) |
| `attachment-sweep` | info | `expired, purged, orphans, ms` (khi > 0) · lỗi xoá: `warn attachment-remove-failed {attachment_id}` |
| `attachment-out-hint-dropped` | warn | `run_id, agent_id` (P10, `system_prompt` chạm trần) |
| `dify-upload` | info | `run_id, workflow_id, mime, size, ms, status` |
Không ghi `usage_logs` (T20).
