---
id: cr122-u2e-node-panel
lát: cr122-u2e-node-panel
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: cr122-u2d-ui-polish
---
## Plan (ngắn)
Panel node của flow chỉ hiện phần nghiệp vụ; chi tiết kỹ thuật vào mục thu gọn "Nâng cao"; sửa header đè chữ, ô Value Nếu, báo "còn bước bên phải", ô cầu nối có chân nối lên cạnh.

## Làm
- `StageForm` → `FlowForm` khi có ngữ cảnh flow: Tên + phần nghiệp vụ (Duyệt/Nếu/Chờ/Ghi giá trị…) ở trên; `AdvancedBox` (`<details>` đóng mặc định) chứa Mã giai đoạn, Người thực hiện, Hướng dẫn, "Chạy ở bước", "Nếu bị trượt"; node module (có `stage.node`) thêm form tool/đầu ra/giới hạn chung vào Nâng cao. `StageGeneral` có `part` = name | tech | all. Gửi email/Thông báo: sửa Tiêu đề + Nội dung (`notifyRaw`); Ký số: một câu giải thích (nhà cung cấp/người ký lấy từ cài đặt ứng dụng).
- `LibraryToolbar` nền đặc + bóng (hết chữ mờ lọt qua header). `StageIf`: ô Value rộng bằng lưới. `ProcessCanvas`: bóng mờ + mũi tên mép phải khi flow dài. `BridgeNode`: chân nối đứt lên cạnh vàng.

## Không làm / Chạm
- Ký số chưa có ô nhà cung cấp/người ký/hạn riêng trên node: cấu hình đó nằm ở gói contracts (E3), chưa có API sửa theo node.
- Hover trực tiếp lên cạnh vàng chưa làm (ô cầu nối luôn hiện ngay dưới mũi tên, có chân nối).

## Test tối thiểu
`bun test apps/admin-web/src/features/processes` xanh; ảnh `docs/specs/CR-122/shots/u2e-*.png`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sắp xếp lại giao diện trình sửa node — chi tiết kỹ thuật vào mục Nâng cao, sửa nền header; không đổi dữ liệu hay luật).

## Việc còn lại
Xem "Không làm / Chạm".
