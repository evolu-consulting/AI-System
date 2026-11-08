---
id: qc-wave-e2e
lát: qc-wave-e2e
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa 18 ca đỏ mới của wave e2e bc85f3a89 (root-1, contracts-web, N1, fnr-showcase-fnr): test lỗi thời do thay đổi UI có chủ đích; baseline Linux chụp lại trên evotest (`-Capture cw`).

## Làm
- N1 shell + contracts-web overview: thanh dưới «Chờ tôi». esign: dự phòng tải lại = visibilitychange (hidden→visible, bubbles).
- scenes nav-v2: chụp lại 8 baseline Linux (shell-mobile, overview-*, s05-review-*).
- fnr: minimap bật bằng nút; từ chối nối ngược = «sẽ tạo vòng lặp»; nhãn Đúng/Sai ở cổng `port-yes/no`; kéo node tự do (bước không đổi), thả vào chỗ trống, so khoảng cách theo đơn vị chiều cao node.
- root-1 app-config F3: xanh khi chạy lại riêng (chập chờn trong wave).

## Lỗi sản phẩm
- esign.cw.ts » editor: Gửi ký … Đã ký số — sau sự kiện đổi cửa sổ (visibilitychange) thẻ ký số KHÔNG tải lại: use-esign.ts dùng refetchOnWindowFocus nhưng query-client.ts có staleTime 30 s mặc định ⇒ dữ liệu còn resh nên không refetch; dự phòng x6 vô hiệu (đặt staleTime: 0 cho esignKey). Nghi lát CR-125 x6.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr124-cr125)
Không thay đổi hành vi (lý do: cập nhật test theo UI đã đổi)

## Việc còn lại