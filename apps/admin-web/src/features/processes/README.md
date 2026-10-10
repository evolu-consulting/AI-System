# admin-web · features/processes (P-a, CR-056)

Quy trình trong Evolu Control: danh sách + editor + trang lượt chạy (ADM-FR-65/66, task F5 · PF4).

- **Bước 0 (đã có):** dò cờ (`api.ts` `probeEngine`, `engine.ts` `useProcessEngine`/`useEngineRoute`), `components/ProcessRouteGate`, 3 trang stub (`pages/*`), 4 route lười ở `routes/_authed/processes/*`, nav "Quy trình" (`shell/lib/nav.ts`, chỉ khi engine `on`), `ConflictEntity` += `process_def`.
- **PF4 làm:** thân 3 trang, `api.ts` (`useProcessDefs`…), `components/**`, `hooks/**`, `components/usage/**`, chuỗi `locales/process/admin.*` (+ `usage.*` dùng chung với chat). Giữ `ProcessRouteGate` bọc mọi trang.
- Cờ off ⇒ nav ẩn, route ⇒ `NotFoundState`, không nạp chuỗi `process.*`.
- `routes/_authed/processes/$processId_.runs.$runId.tsx` dùng hậu tố `_` để KHÔNG lồng vào `$processId` (editor không có `<Outlet/>`).

## Cấu trúc (hoàn thành P-a)
| Thư mục | Nội dung |
|---|---|
| `pages/` | `ProcessesPage` (danh sách + mẫu), `ProcessEditorPage` (editor tối thiểu), `ProcessRunPage` (lượt chạy + token) |
| `components/` | `ProcessesTable`, `RunDialog`, `editor/`, `run/`, `usage/` (tab Token, nhân đôi với chat-web — TECH-DEBT) |
| `hooks/`, `lib/` | state/logic (`use-def-save`, `use-run-data`…), `def-form`, `usage-view`, `errors` |
| `api.ts`, `engine.ts` | gọi Hub duy nhất ở `api.ts`; cờ `HUB_PROCESS_ENGINE` dò bằng `probeEngine` (off ⇒ nav ẩn, route "Không tìm thấy") |
