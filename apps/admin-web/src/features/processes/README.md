# admin-web · features/processes (P-a, CR-056)

Quy trình trong Evolu Control: danh sách + editor + trang lượt chạy (ADM-FR-65/66, task F5 · PF4).

- **Bước 0 (đã có):** dò cờ (`api.ts` `probeEngine`, `engine.ts` `useProcessEngine`/`useEngineRoute`), `components/ProcessRouteGate`, 3 trang stub (`pages/*`), 4 route lười ở `routes/_authed/processes/*`, nav "Quy trình" (`shell/lib/nav.ts`, chỉ khi engine `on`), `ConflictEntity` += `process_def`.
- **PF4 làm:** thân 3 trang, `api.ts` (`useProcessDefs`…), `components/**`, `hooks/**`, `components/usage/**`, chuỗi `locales/process/admin.*` (+ `usage.*` dùng chung với chat). Giữ `ProcessRouteGate` bọc mọi trang.
- Cờ off ⇒ nav ẩn, route ⇒ `NotFoundState`, không nạp chuỗi `process.*`.
- `routes/_authed/processes/$processId_.runs.$runId.tsx` dùng hậu tố `_` để KHÔNG lồng vào `$processId` (editor không có `<Outlet/>`).
