# Plan · H2a · Câu chữ lỗi, nhãn, MCP (phụ lục `plan.md`)

Câu **nguyên văn** (kể cả dấu chấm). Không tham số động, không tên workflow/node/key/URL. Câu `run.failed` vẫn là bảng H1 `plan-errors.md` (`runErrorText`, 7 mã) — H2a không thêm mã run.

## 1. HTTP (`lib/errors.ts` `ERROR_MESSAGES`, tiếng Anh, client dịch theo `code`)
| Mã | HTTP | `message` | `details` |
|---|---|---|---|
| `CMD_NOT_FOUND` | 404 | Command not found | `{suggestions: string[]}` (luôn có, có thể `[]`) |
| `CMD_MISSING_ARG` | 422 | Missing or invalid command argument | `{missing: string[], invalid: string[]}` (luôn đủ hai khoá) |
| `UNAUTHORIZED` (`/internal/*`) | 401 | Unauthorized | — |
| `NOT_CONFIGURED` (credential, test-run trước khi gọi) | 409 | Not configured | — |
`/mcp` 401: body rỗng, header `WWW-Authenticate: Bearer`.

## 2. Ánh xạ lỗi Dify (R11) — `mapDifyHttpError` / `interpretDifyEvent`, dùng chung TS và Python (RT3)
| Tình huống | Mã | `reason` (job) |
|---|---|---|
| Secret không có / giải mã lỗi / credential 401·409 | `NOT_CONFIGURED` | `credential` |
| HTTP 401, 403, 404 | `NOT_CONFIGURED` | `upstream` |
| HTTP 400 (mọi `code`, gồm `invalid_param`), 413, 415, 422 | `UPSTREAM_ERROR` | `upstream` |
| HTTP 429, 5xx, lỗi mạng, stream đứt trước kết thúc | `UPSTREAM_ERROR` | `upstream` |
| SSE `event: error` · `workflow_finished.data.status ∈ {failed, stopped}` (HTTP 200) | `UPSTREAM_ERROR` | `upstream` |
| Không chunk và `outputs[field]` rỗng/không phải chuỗi | `UPSTREAM_ERROR` | `invalid_output` |
| Hết `timeout_s` | `TIMEOUT` | `timeout` |
| Huỷ | `CANCELLED` | `cancelled` |
HTTP khác chưa liệt kê: 4xx → `UPSTREAM_ERROR`. `outputs[field]` không phải chuỗi → `JSON.stringify` nếu object/số; `null`/`""` → rỗng.

## 3. Nhãn step (`runs.locale`)
| Bước | vi | en |
|---|---|---|
| `workflow` (command sync/async) | Đang chạy lệnh | Running command |
| `tool` (MCP) | Đang dùng công cụ | Using a tool |
| delegate tới agent `dify-*` | như H1 "Đang xử lý…" | "Working on it…" |

## 4. MCP — kết quả lỗi `tools/call` (đọc bởi model; tiếng Anh, không theo locale)
| Trường hợp | `content[0].text` |
|---|---|
| Tham số sai | Invalid arguments for this tool. |
| `NOT_CONFIGURED` | This tool is not configured. |
| `UPSTREAM_ERROR` | The tool's service returned an error. |
| `TIMEOUT` | The tool took too long to respond. |
| Tool không có (JSON-RPC `-32602`) | `error.message` = "Unknown tool" |

## 5. Xác nhận `side_effect` (R21; locale = `runs.locale` của run của job)
| Trường | vi | en |
|---|---|---|
| `structuredContent.question` | Thao tác này sẽ thay đổi dữ liệu ở hệ thống bên ngoài. Bạn có muốn tiếp tục? | This action will change data in an external system. Do you want to continue? |
| `structuredContent.choices` | `["Đồng ý", "Huỷ"]` | `["Agree", "Cancel"]` |
| `content[0].text` | CONFIRMATION_REQUIRED: Công cụ này cần người dùng xác nhận trước. Dừng lại và trả need_input với đúng question và choices trong structuredContent; không gọi lại công cụ trong lượt này. | CONFIRMATION_REQUIRED: This tool needs user confirmation first. Stop and return need_input with exactly the question and choices in structuredContent; do not call the tool again this turn. |
`isAgreeReply` nhận "Đồng ý" và "Agree" ở cả hai locale.
