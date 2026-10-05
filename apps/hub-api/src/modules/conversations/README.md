# modules/conversations — E5–E11 (HUB-FR-40, HUB-FR-45, HUB-BR-14)

Hội thoại, flow, tin nhắn theo contract chat C1 (`@ai/contracts/chat`, C1 plan §2.4). Mount ở `/conversations` (app.ts, sau `requireAuth`).

| File | Vai trò |
|---|---|
| `conversations.routes.ts` | E5 list · E6 tạo · E7 đọc · E8 đổi tên · E9 xoá mềm · E10 flows · E11 messages |
| `conversations.service.ts` | mọi câu trong `withHubScope({kind:"user"})` (RLS); không thấy → 404 `NOT_FOUND` |
| `conversations.repo.ts` | `hub.conversations` (lọc `tenant_id`+`user_id` tường minh, `deleted_at IS NULL`); H2c `messageAttachments(tx, o, messageIds)` (một câu cho cả trang E10/E11) |
| `flows.repo.ts` | `hub.flows`, `messages`, `runs`, `run_steps` cho E10/E11 |
| `conversations.rules.ts` | thuần: cursor keyset, mẫu `q` (`foldVi`), map DB → `Conversation`/`Message`/`RunSummary`; H2c `toMessage(..., refs?)` (`attachments` vắng khi rỗng), `toAttachmentRef` (`available` = `purged_at` null) |

Luật:
- Thứ tự kiểm: 401 (middleware) → `:id` không phải uuid 404 → sở hữu 404 → body/query 400 (route gọi `svc.get` trước khi parse).
- `tenant_id`/`user_id`: body → 400 (schema strict); query → bỏ qua (`lib/http.withoutScopeKeys`).
- Cursor = base64url(`[thời điểm UTC µs, id]`); E5 `updated_at,id` giảm · E10 `created_at,id` tăng · E11 trang = tin mới nhất, `items` tăng, `next_cursor` = cũ hơn.
- `title_norm = foldVi(title)`; `q` → `title_norm LIKE %foldVi(q)%` (thoát `% _ \`).
- Ghi `created_at/updated_at` cắt về ms (JSON trả ms → thứ tự client thấy khớp DB).
- E9 chỉ xoá mềm; huỷ run đang chạy của E9 thuộc B9 (plan §5.7, khoá `conversations` trước).
- `Message.run`: run `running` → null; step chỉ hiện `ok`/`failed`, nhãn tĩnh theo `runs.locale` (plan §6.1), `step_id = s<seq>`.

Phụ thuộc: `@ai/db/hub-scope`, `@ai/db/schema/hub`, `lib/{http,errors,auth.middleware}`.
