# feedback-original — Góp ý về app (nền tảng) + «Xem hợp đồng gốc»

Làn: **đầy đủ một phần** (bảng mới có RLS: migration 0017) — còn lại làn nhanh. Nhánh `slice/feedback-original`, chưa merge.

## Quyết định
- Bảng `admin.feedback` + `admin.feedback_files` (migration 0017, `when` 1793577600000). RLS `admin_rw`: platform thấy hết; tenant chỉ tenant mình và chỉ góp ý của mình trừ khi admin đặt `app.fb_all=1` (tenant_admin); tệp theo góp ý cha.
- Tệp đính kèm lưu bytea (≤ 3 tệp × 2 MB, ảnh/PDF/văn bản, kiểm chữ ký byte) vì admin-api không có FileBox; không email.
- API: user `/auth/feedback` (mọi web đã proxy `/auth`), admin `/admin/feedback` (tenant_admin + platform_admin).
- Khung dùng chung `@ai/web-kit/ui/FeedbackPanel` (+ `FeedbackFab` cho Chat AI/Admin/Studio, nút nổi, không đụng thanh trên); contracts-web dùng khoang góp ý có sẵn. `transport` vì admin/studio có client HTTP riêng.
- Phiên bản app: `PUBLIC_APP_VERSION` (Dockerfile/compose/deploy.ps1 đặt = commit; mặc định `dev`).
- admin-web: trang `/feedback` (lọc tenant/app/loại/trạng thái, đổi trạng thái, trả lời).
- «Xem hợp đồng gốc»: nút đã có khi HĐ có tệp (`c.file`), nay mở hộp thoại xem PDF/ảnh + tải xuống + tệp của các phụ lục (đọc chi tiết từng phụ lục khi mở); server vẫn chặn bằng RLS của `file-link` (404). Nhãn đổi «Xem file gốc» → «Xem hợp đồng gốc» (baseline e2e text cập nhật).
- Seed demo: `seed-demo-v2.ts` nạp PDF mẫu cho HĐ c1 khi có `SEED_FILEBOX_URL` + `SEED_FILEBOX_TOKEN` (không có ⇒ bỏ qua).
- Test khoá RLS (M1/M2/M3 db-rls, catalog-rls, migrate) đổi 17 → 19 bảng RLS (+2 bảng feedback).

## Việc còn lại (server, không làm trong lát)
1. Deploy; migration 0017 tự chạy. 2. Seed demo có tệp: chạy seed-demo-v2 với `SEED_FILEBOX_*`. 3. e2e deployed `10-feedback-original`.