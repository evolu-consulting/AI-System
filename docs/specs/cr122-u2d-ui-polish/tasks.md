---
id: cr122-u2d-ui-polish
lát: cr122-u2d-ui-polish
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: cr122-u2c-canvas-shot
---
## Plan (ngắn)
Làm gọn UI trình sửa flow theo soát ảnh u2c: canvas vừa khung + chữ đọc được, nút "Thêm bước" gom nhóm, node nói ngôn ngữ nghiệp vụ, kiểm nối + gợi ý cầu nối dùng ngay trên canvas, panel gọn, node Kết thúc có hình riêng.

## Làm
- Canvas: `columns-fit` neo trái + trên (lề 16), `fitMin` 0.8 cho flow, chiều cao canvas flow `min(62vh,460px)`.
- `NodePalette` = một nút "+ Thêm bước" (menu nhóm Cơ bản · Lõi · từng app). Bỏ cặp chế độ thứ hai ở `LibraryToolbar` (còn một "Sơ đồ / Danh sách bước"); header một dòng "Nháp · N công ty".
- Node flow: `FlowNodeBody` (tên bước · loại node theo bảng node · MỘT dòng tóm tắt `lib/node-summary.ts` · lỗi nói rõ) + Kết thúc hình viên thuốc xanh; `IfNode` không còn "Giai đoạn n:".
- Gợi ý cầu nối trên canvas: `BridgeNode` (ô "Thiếu <trường> · Gợi ý cầu nối", xem trước node Ghi giá trị mờ + giải thích AI + Nhận/Bỏ, lý do khi thất bại), `hooks/use-bridge.ts`; khối trên đầu chỉ còn "N chỗ nối thiếu dữ liệu" (bấm ⇒ nhảy tới cạnh đầu).
- Panel: Ghi giá trị ẩn tên tệp/mẫu; Nếu bỏ đoạn giải thích dài + nhãn trường không kèm kiểu; "Gộp tới" chỉ khi bước nằm sau một Nếu; cụm Lên/Xuống/đổi bước gom vào menu "⋯" (chỉ còn Xoá); "Kiểu ghi" mặc định "Giữ nguyên".

## Không làm / Chạm
- Node Kết thúc chưa có cột riêng (nằm ở bước cuối theo bố cục), chỉ khác hình.
- Ảnh gợi ý cầu nối "có đề xuất" dùng phản hồi GIẢ LẬP (Playwright route) vì AI thật trả lý do không gợi ý được (run_inputs trống) — ảnh `u2d-bridge-canvas-that.png` là lần gọi thật.
- Cạnh vàng chỉ hiện nhãn "⚠" (câu đầy đủ ở ô cạnh); hover cạnh chưa làm.

## Test tối thiểu
`bun test apps/admin-web/src/features/processes apps/admin-web/src/features/tenants` xanh (mới `node-summary.test.ts`). Ảnh: `docs/specs/CR-122/shots/u2d-*.png`.

## Quyết định trong lúc làm
- Ô cầu nối là node canvas riêng (không popover trên cạnh) để kéo/zoom theo canvas.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED platform/canvas-flow-nghiep-vu.md
#### Yêu cầu: Node flow nói ngôn ngữ nghiệp vụ, gợi ý cầu nối ngay trên canvas (FLOW2-FR-26)
Node trên canvas hiện tên bước, loại node và một dòng tóm tắt (không tên kỹ thuật); cạnh thiếu dữ liệu có ô gợi ý cầu nối ngay tại cạnh với xem trước và Nhận/Bỏ.
- Kịch bản: khi Ghi giá trị có nguồn dữ kiện thì node hiện `trường ← nhãn dữ kiện` [test: apps/admin-web/src/features/processes/lib/node-summary.test.ts » Ghi giá trị: một dòng `trường ← nguồn` kèm số dòng còn lại]
- Kịch bản: khi node là Nếu thì node hiện điều kiện đầu theo dữ kiện [test: apps/admin-web/src/features/processes/lib/node-summary.test.ts » Nếu: điều kiện đầu theo dữ kiện]

## Việc còn lại
Xem "Không làm / Chạm".
