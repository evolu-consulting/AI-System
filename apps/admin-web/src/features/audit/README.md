# audit — Nhật ký (ADM-FR-51, ADM-FR-52)

`/audit` (platform_admin xem mọi tenant; tenant_admin chỉ tenant mình). Danh sách cuộn vô hạn theo ngày, chi tiết trong Sheet (`/audit/$auditId`), khôi phục một phiên bản (BR-08).

| File | Vai trò |
|---|---|
| `api.ts` | nơi duy nhất gọi API: `useAuditList` (infinite), `useAuditEntry` (id được `encodeURIComponent`), `useAuditRestore` (xong → làm mới `AUDIT_KEY` + gốc query của thực thể bị khôi phục) |
| `hooks/use-audit-view.ts`, `use-actor-search.ts`, `use-restore.ts` | bộ lọc trong URL, tìm người thực hiện, luồng khôi phục + xử lý 409 |
| `lib/*` | gom theo ngày, nhãn thực thể/hành động, tìm kiếm, điều kiện khôi phục được |
| `components/*` | timeline, dòng, bộ lọc, diff, hộp thoại khôi phục (trình bày, không fetch) |
| `pages/AuditPage.tsx`, `AuditDetailSheet.tsx` | trang + Sheet chi tiết |
