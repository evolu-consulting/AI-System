# cr167-drop-requests — CR-167 (tạm bỏ mục menu «Yêu cầu» và quy trình phiếu «Đề nghị mua hàng / thanh toán»)

## Plan
Người dùng sẽ định nghĩa lại sau. Ẩn mục «Yêu cầu» khỏi menu Sổ Hợp Tác (desktop + mobile «Thêm»); GIỮ route `/contracts/requests` và code trang để bật lại. Script `tenant:flows` không còn tạo quy trình phiếu cho evolu / nitigroup (preschool vốn không có); quy trình Demo không đổi.

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Gỡ `REQUESTS_NAV` khỏi manifest contracts (giữ hằng số + chú thích CR-167) | `apps/workspace-web/src/modules/contracts/manifest.ts`, `features/shell/lib/nav.ts` | [x] |
| 2 | Unit nav 8+2 ⇒ 7+2; e2e N1 bỏ «Yêu cầu»; cr125 vào thẳng URL | `apps/workspace-web/src/shell/nav.test.ts`, `e2e/N1/shell.n1.ts`, `e2e/journey-approval/cr125-purchase-full.spec.ts` | [x] |
| 3 | Script bỏ quy trình phiếu + code chết (`buyFlow`, `phieu`, `paid`, `byPerson`, `NEVER_TRIGGER`, `ensureOrder`) | `tools/scripts/src/tenant-flows.data.ts`, `.core.ts`, `tenant-flows.ts`, `tenant-flows.int.test.ts` | [x] |

## Quyết định trong lúc làm
- Trang `/contracts/requests` và API giữ nguyên; chỉ menu ẩn (vào bằng URL vẫn được).
- Quy trình phiếu đã lưu trên staging/test không bị script xoá (chỉ không tạo mới); tắt ở bản test làm riêng.

## Việc còn lại
- Chạy `tenant:flows` / tắt flow phiếu NitiGroup trên bản test (cần người dùng đồng ý).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/cai-dat-va-quyen.md

#### Yêu cầu: Menu Sổ Hợp Tác không có mục «Yêu cầu» (CR-167)
Mục «Yêu cầu» không hiện ở menu trái và thanh «Thêm» trên mobile; trang `/contracts/requests` vẫn mở được bằng địa chỉ. Bộ quy trình của công ty chỉ gồm «Duyệt hợp đồng gửi đi» và «Nhận hợp đồng từ đối tác».
- Kịch bản: thành viên có gói Sổ Hợp Tác thấy 7 mục, không có «Yêu cầu» [test: apps/workspace-web/src/shell/nav.test.ts » thành viên/chủ sở hữu có cả hai gói: Sổ Hợp Tác trước, Community sau, đủ 7 + 2 mục (CR-142 Sơ đồ tổ chức, CR-167 gỡ Yêu cầu)]
- Kịch bản: menu desktop đúng thứ tự nhãn và đường dẫn, không «Yêu cầu» [test: e2e/N1/shell.n1.ts » PK-FR-10 · nav-v2 · menu chính 7 mục (CR-132 thêm Tin nhắn, CR-142 Sơ đồ tổ chức, CR-167 gỡ Yêu cầu) đúng nhãn, thứ tự và đường dẫn: Tổng quan /contracts · Hợp đồng /contracts/list · Đối tác /contracts/partners · Sản phẩm & Giá /contracts/products]
- Kịch bản: script không tạo quy trình phiếu cho công ty nào [test: tools/scripts/src/tenant-flows.int.test.ts » lần 1: đủ số quy trình, đang Bật + đã áp dụng, không có phiếu «Đề nghị mua hàng / thanh toán» (CR-167)]
