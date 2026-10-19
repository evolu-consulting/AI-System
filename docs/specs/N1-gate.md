# Gate · N1 (khung gói dùng chung) — CR-094

**Kết quả: DUYỆT — Tự duyệt theo Luật 2b (2026-10-19, phiên chính).** Vào BUILD trên nhánh `platform/gd0` (không push).

## Căn cứ
- spec-readiness **lần 2 READY** (d70810f; 0 Chặn, 0 Cao; Thấp #21 sửa khi build). Lần 1 (a8d097b) 10 Cao đều có mặc định, đã áp ở 5456432.
- Người dùng chốt ở Gate (2026-10-19, 2f98a5c): ADR-0024 Accepted (DOCX: fflate + saxes, worker, chặn zip bomb); Q9 hub-api bỏ qua grant quyền gói cho user lẻ (D-11); Q10 HD4 thêm role `<k>_job` (D-12); font Roboto/Roboto Mono vào ADR-0001 (D-14).
- Quyết định người dùng 2026-10-18: backend gói là module trong hub-api; `contracts-web` app riêng giống mgmt-app; không HTTP nội bộ trên đường nóng (D-01…D-03).

## Điều kiện trước task
| # | Điều kiện | Trạng thái |
|---|---|---|
| G1 | qc commit `ADMIN_PACKS_BASE` = `/admin/tenants` + relock (trước T5b) | Chờ (qc đang làm cùng test HD1) |

## Ràng buộc trong BUILD
- Mọi task T5a…T5g rủi ro cao ⇒ test qc (1cdc17a) có trước; agent code không sửa test khoá (sai ⇒ Tranh chấp test).
- Luật 4c: ngưỡng PK-NFR-01…05 là trần ước — T5d/T5g đo số thật, chưa đạt thì chưa xong; đếm bước nhảy 0 HTTP nội bộ.
- Security review T6 (RLS gói, role NOINHERIT NOBYPASSRLS, FileBox org, zip bomb) — hard stop nếu lỗi cách ly tenant.
- TF3 (tách `packages/web-kit` từ chat-web) rủi ro cao: `e2e/chat` xanh y nguyên.
- Thấp #21: chạy lại e2e N1 sau TF1, ghi TECH-DEBT nếu lỗi môi trường Playwright còn.
