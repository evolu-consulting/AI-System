---
id: cr186-qc
lát: cr186-qc
cr: CR-186
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
qc sửa e2e khoá bị CR-185 / CR-186 đổi hành vi hợp lệ, thêm e2e CR-185, chạy contracts-web + community-web trên evotest.

## Làm
- [x] Sửa: gapa1-manage, cr184-settings (ca Kết nối ⇒ không còn «Kết nối»), smoke-journey S4/S5 (cảnh báo trong Quy trình duyệt; KHÔNG chạy: đánh môi trường đã deploy), settings.cm, esign-anchor, cr147-feed (3 bình luận).
- [x] Thêm e2e CR-185: tooltip avatar = họ tên; sơ đồ Ký số gộp + cạnh Từ chối · Hết hạn; không còn «Kết nối».

## Không làm / Chạm
- Không sửa code sản phẩm. Không chạy job cr181 (qc khác đang chạy).

## Test tối thiểu
- evotest e2e: contracts-web, community-web.

## Quyết định trong lúc làm
- cr181 `signers-strip` «Đã ký»: giữ (chữ trạng thái nằm cạnh avatar theo tasks cr185-avatar).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: lát chỉ sửa và thêm test e2e).
