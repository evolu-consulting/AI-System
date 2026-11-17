---
id: fix-cr181-seed3
lát: fix-cr181-seed3
cr: CR-181
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
HĐ mẫu `…162611180000` chạy nhầm «UAT · HĐ phòng Kinh doanh gửi đối tác». Nguyên nhân: seed ghi `fields` phẳng; bộ chọn đọc `fields.total_value.value` (số) ⇒ null ⇒ điều kiện `total_value le 100 triệu` của quy trình mới sai ⇒ trượt sang quy trình cũ (chỉ cần phòng Kinh doanh). Cùng lỗi làm `partner_role_of` (đọc `fields.buyer_tax_id.value`) trả null ⇒ không có đối tác ⇒ không có Bên B.

## Chứng cứ
- DB bản test: quy trình mới `enabled`, `company_flows.position = 0`, trigger `creator_department in [pb-kinh-doanh] and total_value le 100000000`; lượt chạy dùng def «UAT · HĐ phòng Kinh doanh…» v5; HĐ mẫu: `fields->'total_value' = {"value": null,…}`, `partner_key` null. Liên hệ `tax:0100150002` (thomas.tran) CÓ.
- Code: `contract-flow.repo.ts:35` (`total_value` chỉ nhận `{value: number}`), migration `0024_v2c_partner_roles.sql:37` (`partner_role_of`), `dispatcher.repo.ts:121` (xét theo `cf.position`).

## Làm
- [x] `signSampleFields`: fields theo hình trích xuất `{value, quote, verified, edited}`.
- [x] Đời dữ liệu `SIGN_SAMPLE_REV=17` (id `…-17YYMMDD0000`, tiêu đề «· dd/mm · bản 2»): lần chạy kế tạo HĐ mới; HĐ đời 16 giữ nguyên, không dùng lại.
- [x] Bước `fix_fields` (HĐ Nháp đời hiện tại có fields sai) + tự kiểm cuối seed (fail nếu thiếu số/đối tác).
- [x] Unit test (15 ca).

## Không làm / Chạm
Không sửa/tắt quy trình UAT cũ; không chạy seed trên bản test.

## Quyết định trong lúc làm
- Không thêm «dấu riêng»: điều kiện (phòng Kinh doanh + ≤ 100 triệu) + fields đúng + vị trí 0 là đủ.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa seed dữ liệu mẫu)
