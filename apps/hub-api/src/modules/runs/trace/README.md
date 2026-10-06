# modules/runs/trace — trace run theo role (HUB-FR-52, HUB-FR-87)

`GET /runs/:id/trace` (H3b), mount dưới `/runs` cạnh `GET /runs/:id` (route chat không đổi). Mọi role đã đăng nhập gọi được; quyền quyết trong service.

| File | Vai trò |
|---|---|
| `trace.routes.ts` | parse `:id` (không uuid ⇒ 404) → service. Không logic |
| `trace.service.ts` | (A) chủ run: scope `user`, không audit · (B) `platform_admin`: scope `system`, audit `view_trace` ngay sau khi thấy run; audit lỗi ⇒ rollback ⇒ 500 (fail-closed) |
| `trace.rules.ts` | `traceAccess` (own/platform/not_found), `redactTraceDetail` (che khoá/giá trị nhạy cảm, sâu > 6, > 16 KiB) |
| `trace.repo.ts` | SQL: run, steps, jobs, usage, messages — mọi câu lọc `tenant_id` của run |
| `trace.map.ts` | hàng DB → `RunTrace` (`@ai/contracts/hub-admin`) |

Bẫy: `tenant_admin` xem run người khác ⇒ 404 như người ngoài (Q-U2, chỉ xem chi phí ở Admin); `view_trace` chỉ ghi khi người xem không phải chủ run (Q-U4); `usage_logs_run_idx` (migration 0009) phục vụ `traceUsage`.

Phụ thuộc: `lib/{hub-audit,db,http,errors}`, `@ai/db/hub-scope`.
