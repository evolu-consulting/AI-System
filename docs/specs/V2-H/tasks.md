---
id: V2-H
title: Khách đang dùng + gia hạn (SP-03), Cài đặt số ngày nhắc, CKS chỉ đọc
lane: đầy đủ (RLS `service_customers` + bảng mới `business_settings`, chuyển ý CKS) — UI làn nhanh
ba: docs/platform/ba-v2/so-hop-tac-ba-v2.pdf §3.3 SP-03, §5.8, §5.9 · intake V2-H (SP-03, 5.8c/d, 5.9c, C6, Q4)
---
# V2-H — tasks

## Plan
| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | Migration `0029_v2h_service_customers.sql` (journal `when` 1795600000000): `business_settings` (số ngày nhắc mặc định 60, cờ ghi CKS), `cks_writable()`, `service_customers` đọc theo M1 + hàm đồng bộ SECURITY DEFINER dưới role `contracts_sc` | đầy đủ | ✔ |
| 2 | Luật thuần `domain/service-customers.rules.ts` (Hết hạn / Sắp hết hạn / Còn hạn, đếm, thứ tự, tiêu đề việc) + unit | đầy đủ | ✔ |
| 3 | API: `GET /products/:id/customers`, `POST /products/:id/customers/:customerId/remind`, `GET`/`PUT /business-settings` | đầy đủ | ✔ |
| 4 | CKS (HD9) chỉ đọc: route ghi ⇒ 410 `CKS_READ_ONLY` theo cờ tenant (nhớ 60 s), đọc giữ, dữ liệu không đụng | đầy đủ | ✔ |
| 5 | Web: tab "Khách đang dùng" (slot V2-J1) (mockup `custPanel`); "Nhắc trước khi hết hạn" điền sẵn từ Cài đặt (form nhập tay + bước xác nhận AI) | nhanh | ✔ |
| 6 | Test: unit (luật + cache cờ + form + tab), int `V2-H/api` (đường chính 4 endpoint + CKS 410), `V2-H/rls` (business_settings chéo tenant + service_customers M1/gia hạn); e2e `v2h-customers.cw.ts` viết, chưa chạy | — | ✔ |

## Quyết định trong lúc làm
- H1 **Xem lại V2-D D11 — đọc theo M1.** `service_customers` (tên khách, hạn, HĐ) sinh từ HĐ ⇒ đọc như `contract_items`: dòng thấy khi thấy HĐ hiện tại của dòng (`sees_all()` hoặc EXISTS trên `contracts` đã lọc M1). Ghi chỉ qua trigger lưu HĐ: `v2d_sync_service_customers` chuyển SECURITY DEFINER, chủ là role `contracts_sc` (NOLOGIN/NOINHERIT/NOBYPASSRLS, policy `true` chỉ cho role này trên 4 bảng nó đọc/ghi) ⇒ gia hạn bởi người không thấy HĐ cũ vẫn cập nhật dòng cũ. Cách ly tenant: tham số tenant phải trùng `app.tenant_id` của tx (vắng ⇒ chỉ phiên superuser/BYPASSRLS — migration/seed/test), mọi câu lọc `tenant_id`, dữ liệu ghi tính lại từ HĐ thật. `contracts_rw` mất INSERT/UPDATE/DELETE trực tiếp. Test V2-D `rls` (u2 thấy 0) sửa theo quyết định này.
- H2 Cài đặt: bảng `business_settings` một hàng/tenant (tên theo intake C5, V2-J1/V2-L thêm cột). Vắng hàng ⇒ 60. `PUT` cần quyền `admin` (Q3: chỉ quản lý chỉnh Cài đặt). Số ngày nhắc của HĐ (`fields.notice_days`, 0…3650) thắng mặc định.
- H3 Phân loại: hạn < hôm nay ⇒ Hết hạn; còn ≤ số ngày nhắc ⇒ Sắp hết hạn; còn lại (kể cả HĐ không có ngày kết thúc) ⇒ Còn hạn. "Hôm nay" theo múi tenant. Một câu SQL lấy ≤ 2001 dòng (gần hạn trước), phân loại/đếm ở use case; > 2000 ⇒ `truncated`.
- H4 "Nhắc gia hạn" = hàng `contracts.followups` (W1) của chính người bấm, `subject_kind = 'renewal'`, chủ thể = id dòng khách, hạn = lúc bấm, tiêu đề "Liên hệ {khách} mời gia hạn {SP}". Hiện ở Cần xử lý (`/my-work`, việc hẹn nhắc chung), Đã xong qua `POST /my-work/followups/:id/done` có sẵn. Bấm lại khi việc còn mở ⇒ giữ một việc (unique mở mỗi người + chủ thể). Quyền `read` (việc của riêng mình, như hẹn nhắc W1). Nút chỉ hiện cho khách Hết / Sắp hết hạn (mockup).
- H5 CKS chỉ đọc (Q4): cờ `business_settings.cks_writable` (null = mặc định: tenant v2 `nitigroup`/`demo` chỉ đọc, tenant cũ còn ghi — cùng tập `approval_default()` của V2-A) để không phá các bộ test/e2e đang seed CKS qua POST (HD7, HD8, HD9, M1-b2, M2-chat, e2e contracts-web). Kiểm sau guard quyền (người xem vẫn 403, 0 SQL), cờ nhớ 60 s mỗi tenant ⇒ request nóng không thêm câu SQL (giữ HD9-AC09). Không migration dữ liệu CKS. Màn CKS đã rời menu (nav-v2); nút ghi còn lại trên route cũ nhận 410.
- H6 Web: tab gắn vào chỗ gắn của V2-J1 (`features/products/lib/slots.ts`, `key: "users"`, nhóm `service`) trong chi tiết SP `/products?sp=…&ht=users` (rebase lên V2-J1; bỏ route `/products/$id` tạm của lát). Cột "Uy tín" của mockup bỏ tới khi có điểm v2 (V2-E/I). Lọc ở máy khách (một lần tải, số đếm cho mọi nút).
- H7 "Nhắc trước khi hết hạn": form nhập tay để trống tới khi đọc xong Cài đặt rồi điền sẵn (người đã gõ thì giữ; lỗi đọc ⇒ 60); bước xác nhận sau AI đọc điền khi HĐ không ghi. Ảnh chụp e2e V2-F cũ có ô = 30 sẽ đổi ⇒ chụp lại ở cuối đợt.
- H8 Không đụng `tests/.lock`: khoá ở nhánh hiện thiếu cả V2-A…V2-G; ghi lock một lần cuối đợt (qc).

## Số đo
- Danh sách khách = 1 câu SQL nghiệp vụ (+ câu đặt phạm vi tx), không theo số dòng; index mới `(tenant_id, product_id, expires_on)`.
- Nhắc gia hạn = 2 câu (đọc dòng thấy được + upsert việc).

## Kiểm (lát)
- Unit local: `service-customers.rules`, `cks-read-only`, `products/lib/customers`, `notice-default` — xanh.
- Typecheck hub-api + contracts-web + tests (file của lát) — sạch. Build contracts-web (sinh `routeTree.gen.ts`) — OK.
- Int evotest: `V2-H/*`, `V2-D/rls`, `V2-D/service`, `HD9/sqlcount` — xem báo cáo lát.

## Việc còn lại (lát sau)
- V2-K: nguồn "Khách sắp hết hạn" tự động trong Cần xử lý (5.8d/5.9: khách còn trong số ngày nhắc ⇒ việc, bấm mở tab Khách đang dùng) — đọc `service_customers` + `business_settings` như H3.
- V2-L: ô "Ngày báo sắp hết hạn" trong Cài đặt dùng `GET/PUT /business-settings`.
- V2-I/E: cột Uy tín của khách trong tab.
- V2-O: gỡ hẳn route ghi CKS + test HD9 ghi (cờ H5 thành toàn cục); V2-M: gỡ dòng khách khi xoá HĐ (hàm đồng bộ chạy dưới `contracts_sc`).
- Cuối đợt: chạy e2e `v2h-customers.cw.ts`, chụp lại baseline form V2-F (ô nhắc 60), ghi `tests/.lock`.
