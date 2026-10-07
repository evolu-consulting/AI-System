# directory — HUB-FR-102

Danh bạ người dùng cùng tenant cho chat-web (mở DM, chọn người vào nhóm). Spec: `docs/specs/X2a-rooms` (R22, AC10).

- Điểm vào: `GET /directory?q=&limit=` (`directory.routes.ts`, mount ở `app.x2a.ts`, JWT ở gốc `/directory`).
- `directory.service.ts` → `directory.repo.ts` (`admin.users`, cột `hub_ro`; lọc tenant + active + không khoá + khác mình).
- `directory.rules.ts`: `likePattern` (thoát `\ % _`, bọc `%…%`).
- Trả đúng 4 trường `{id, display_name, username, active}` — không email/role/tenant.
- Phụ thuộc: `@ai/contracts/chat` (`DirectoryQuerySchema`, `DirectoryResponse`), `@ai/db/hub-scope`.
