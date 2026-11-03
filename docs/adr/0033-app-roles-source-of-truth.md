# ADR-0033 · Vai theo app là nguồn quyền ở tầng admin

Trạng thái: **Accepted** (người dùng chốt 2026-11-03, CR-112, "làm theo recommend"). Liên quan: ADR-0031, `docs/specs/cr112-admin-config/README.md`.

## Bối cảnh
Quyền gói nghiệp vụ nằm trong Group vai (`<pack>-owner/-editor/-viewer`) + `feature_grants` (PK-FR-05). Người vận hành không có chỗ khai báo "vai" riêng; Group và grant có thể bị sửa tay lệch chuẩn. Cần vai tuỳ biến và màn phân quyền theo ngôn ngữ vai/mức mà không đổi điểm chặn quyền ở backend (Hub đọc thẳng bảng admin).

## Quyết định
- Thêm bảng mỏng `admin.app_roles` (tenant, pack, key, tên, mức, `group_id` 1–1, `is_default`, `version`, RLS theo tenant). Migration admin `0030_app_roles`.
- Vai là nguồn; lưu vai biên dịch một chiều xuống Group + feature-grant (thêm thiếu, gỡ thừa), tăng `config_version`, NOTIFY `config_changed`, ghi audit. Backend kiểm quyền không đổi; `caps.contracts` vẫn tính từ quyền gói.
- Chỉ gói nghiệp vụ (contracts, community, knowledge). Đối tác không vào vai (giữ 2 mức tĩnh).
- Trần công ty = mức entitlement CR-111; vai vượt trần "không hiệu lực" (ADM-BR-12).
- Dữ liệu cũ chuẩn hoá bằng backfill CLI có dry-run + xác nhận + audit từng dòng (ADM-BR-17).

## Hệ quả
- Một chỗ khai báo vai; sửa tay grant của Group vai bị ghi đè khi biên dịch lại.
- Thêm một migration và một đường ghi phải nhớ phát NOTIFY (test bắt buộc).
- Group không phải vai có grant gói (vd `pb-ke-toan`) giữ nguyên, hiện là "quyền ngoài vai".
- Backfill đổi quyền hiệu lực của khách: không chạy prod khi chưa được người dùng xác nhận.

## Phương án đã loại
- Chỉ UI (suy vai từ Group): không có chỗ lưu vai tuỳ biến/mức, lệch chuẩn không phát hiện được.
- Vai thay hẳn Group trong backend: đổi điểm chặn quyền + Hub, rủi ro cao, đụng engine đóng băng.
- Bảng vai đầy đủ kèm grant riêng (hai nguồn quyền): dễ lệch với `feature_grants`.
