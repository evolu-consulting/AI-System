# chat-api-gate — chặn API Chat AI theo entitlement `chat-app` của công ty

Làn: **đầy đủ một vòng (quyền)** — Luật 0b. Nguồn: `docs/specs/app-perm/tasks.md` mục "Còn lại" (chặn chỉ ở UI/điều hướng).

## Plan (đã làm)
- [x] Test trước: `apps/hub-api/src/modules/chat-gate/chat-gate.rules.test.ts` (unit) + `chat-gate.int.test.ts` (int) viết
      trước code cổng (unit đỏ ⇒ code ⇒ xanh).
- [x] Luật thuần `chat-gate.rules.ts`: `chatAppAllowed` = cùng luật admin-api `TENANT_APP_FEATURES` — platform_admin luôn
      được; feature `chat-app` chưa tồn tại ⇒ mở; có ⇒ feature không `off` ∧ tenant có entitlement chưa thu hồi (không xét
      grant nhóm/user). `chatRouteKind(method, path)` ⇒ `chat` / `dock` / `open`.
- [x] Middleware `chat-gate.middleware.ts` gắn SAU `requireAuth` trên `CHAT_GATED_PREFIXES` (`app.ts`); bị chặn ⇒ 403
      `CHAT_APP_DISABLED` (contract mới `CHAT_APP_ERRORS` trong `@ai/contracts/chat`).
- [x] Đọc ảnh catalog trong `ConfigCache` (features + entitlement đã nạp sẵn cho lệnh `/` và cổng gói) ⇒ **0 SQL mỗi
      request**; chờ `adminSettled()` như cổng gói ⇒ thu hồi vừa NOTIFY `config_changed` có hiệu lực ngay ở request kế.
- [x] contracts-web dock trợ lý gửi `X-Ai-Surface: contracts` cả ở tạo hội thoại + dừng run (trước chỉ ở gửi tin).

## Route bị chặn (công ty không có `chat-app`)
| Route | Ghi chú |
|---|---|
| `/conversations*` (E5–E12) | liệt kê, tạo, đổi tên, xoá, flow, tin, gửi tin (SSE) |
| `/runs/:id`, `/runs/:id/events`, `/runs/:id/cancel` | xem run, stream, dừng |
| `/commands*` | menu lệnh `/` |
| `/agents*` | menu agent `@` của chat |
| `/attachments*` | tải lên/tải về file chat |
| `/rooms*` | phòng (X2a/X2b, gồm run agent trong phòng) |
| `/directory*` | danh bạ chat |
| `/me/stream` | luồng realtime của chat-web |

**Ngoại lệ dock Sổ Hợp Tác** (chỉ 3 route, chỉ `POST`): `POST /conversations`, `POST /conversations/:id/messages`,
`POST /runs/:id/cancel` được qua khi có header `X-Ai-Surface: contracts` **và** user có quyền `read` gói `contracts`
(entitlement `contracts-read` + nhóm được cấp — cùng luật `packGuard`). Header dock không mở route chat nào khác.

## Route KHÔNG chặn
`/pack/*` (gồm AI đọc/trích HĐ, `/pack/contracts/me`) · `/studio/api/*` · `/agent-grants*` · `/agent-settings*` ·
`/runs/:id/trace` (trace quản trị H3b) · `/notifications*` · `/dlc*` · quy trình (`/processes`, `/process-runs`,
`/review-tasks`, `/process-defs`, `/agent-teams`, `/process-editor`, `/me/review-tasks`, `/me/process-inbox`) ·
`/admin/sources*` · `/source-credentials*` · `/mcp` (tool Dify/agent) · `/internal/*` (worker, token job) · `/health`.
Vòng nền (Orchestrator, runner, engine quy trình, worker) không đi qua HTTP route ⇒ không bị ảnh hưởng.

## Quyết định trong lúc làm
- Dock trợ lý Sổ Hợp Tác dùng API chat chung (`/conversations`, `/runs`) — chặn thẳng sẽ làm hỏng trợ lý của công ty demo
  chỉ có Sổ Hợp Tác. Chọn ngoại lệ hẹp (3 route + header + quyền đọc gói) thay vì tin header một mình (header tự đặt được).
  Hệ quả còn lại: user có quyền đọc gói của công ty bị thu hồi vẫn chat được với trợ lý qua 3 route này (đúng bằng năng lực
  dock đã cấp cho họ); không liệt kê/đọc lại hội thoại, không lệnh/agent menu, không file, không phòng.
- Luật bỏ qua hàng `app_catalog.chat` (Hub không nạp bảng catalog app): chỉ xét feature `chat-app`. Admin gỡ
  `required_feature` của hàng `chat` mà vẫn thu hồi entitlement ⇒ UI mở nhưng API chặn (lệch hiếm, chấp nhận).
- Hằng `chat-app` lặp ở hub-api (`CHAT_APP_FEATURE`) — admin-api và hub-api không import chéo app; ghi chú trỏ nguồn.
- `tenant_admin` của công ty bị thu hồi cũng bị chặn (như UI: chỉ còn Sổ Hợp Tác + Quản trị).

## Test
- Unit: `chat-gate.rules.test.ts` (10 ca: luật entitlement, phân loại route chặn/không chặn/dock, verdict).
- Int: `chat-gate.int.test.ts` (5 ca): tenant bị thu hồi ⇒ 403 trên 11 route chat chính, không ghi gì; tenant còn quyền ⇒
  200/201 như cũ; `/pack/contracts/me` + dock vẫn chạy cho tenant bị thu hồi; header dock không mở cho user ngoài nhóm gói;
  platform_admin không bị chặn.

## Còn lại
- chat-web chưa dịch mã `CHAT_APP_DISABLED` (người dùng đã bị điều hướng khỏi Chat AI ở `_authed`, nên hiếm gặp).
- e2e chưa chạy (chạy cuối đợt).
