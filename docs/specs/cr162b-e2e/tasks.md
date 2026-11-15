# cr162b-e2e — sửa e2e contracts-web sau CR-162

Nền: `docs/specs/cr162-manual-ui/`. Chỉ sửa test + chụp lại baseline scenes (UI đổi đúng ý CR-162).
## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa selector/mock e2e theo UI CR-162 và chụp lại baseline scenes)

## Quyết định trong lúc làm
- Ca «menu một mục»: mock thêm `can.delete=true` để menu «Thao tác ▾» hiện với đúng một mục (trước đó menu không hiện nên ca timeout).
- Ca «Xem hợp đồng gốc» và «Thử lại»: nút trùng nhãn/testid ở đầu trang và khung quản lý ⇒ giới hạn selector vào `page-head` / `failed-actions` (không đổi sản phẩm).
