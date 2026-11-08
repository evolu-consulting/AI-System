# Tên công ty — một nguồn (CR-121 C-20)

Nguồn: lát cr121-c20-company-name (gộp 2026-11-09, đợt cr125-wave).

## Tên công ty chỉ có một nguồn là hồ sơ công ty ở Admin
Tên công ty hiển thị trong ứng dụng (thanh trên, logo chữ cái đầu, brand của Sổ Hợp Tác và Community) luôn lấy từ tên công ty ở Admin (Công ty › Hồ sơ). Cài đặt công ty của Sổ Hợp Tác không còn lưu tên riêng; chỉ giữ tên ứng dụng, logo, màu, giao diện, tên pháp nhân và mã số thuế. Lưu cài đặt có kèm tên thì tên bị bỏ qua, phản hồi vẫn là tên ở Admin.
- Nâng cấp dữ liệu (migration 0076): công ty có tên trống ở Admin mà Sổ Hợp Tác có thì chép sang Admin; hai bên lệch thì giữ tên Admin; cột tên cũ bị gỡ; chạy lại không đổi gì. Trước khi deploy chạy thử trên bản sao prod và đọc NOTICE (số tenant lệch tên).
- Đổi tên ở Admin ⇒ nhận diện của phiên đổi theo (mã phiên bản/ETag brand đổi, `config.changed` chỉ tới phiên công ty đó); công ty khác không ảnh hưởng. `tenant_name()` chỉ trả tên tenant của phiên.
- Ops-watch báo đỏ (crit, nêu key) khi có công ty tên rỗng hoặc cột tên cũ quay lại.