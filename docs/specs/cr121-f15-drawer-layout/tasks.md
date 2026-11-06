---
id: cr121-f15-drawer-layout
lát: cr121-f15-drawer-layout
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c
---
## Plan (ngắn)
UAT lượt 2: ngăn việc/ngăn Gán của tab Quy trình — "Luật định tuyến" xuống 3 dòng, "Còn lại (mặc định)" xuống dòng, ngăn dài và nút "Xong" sát mép dưới ở 900px, nhiều chữ lặp.

## Làm
- `RulesSection`: tiêu đề `whitespace-nowrap`, câu giải thích thành ⓘ (tooltip), nút "Sửa luật" nowrap; hàng luật dùng lưới 4 cột (số · điều kiện · → · quy trình), mỗi ô `truncate` ⇒ không xuống dòng; nhãn "Còn lại (mặc định)" thành "Còn lại".
- `DetailDrawer` (dùng chung): thêm `footer` dính đáy (`sticky bottom-0`, nội dung cuộn phía trên, ghim đáy cả khi nội dung ngắn); `FlowDrawer` đặt nút "Xong" (đóng ngăn) ở đó.
- Bớt chữ trong ngăn việc: bỏ tiêu đề lặp "Các bước của quy trình… (chỉ xem)" (`FlowRowsView showTitle=false`), "Đây là quy trình mẫu của Thư viện… bản sao sẽ…" thành "Quy trình mẫu của Thư viện, chỉ xem.", câu "Chưa hiển thị được các bước của khe này…" (lộ "khe") thành "Chưa xem được các bước của quy trình này.", ô chọn quy trình "Chọn quy trình" (không còn bị cắt, `w-full max-w-72`).
- Sửa lỗi: `FlowDrawer` đặt `key` của `DrawerSteps` bị mất (`":"` cố định) ⇒ trả lại `${slot}:${defId}` để ngăn dựng lại khi đổi việc.

## Đã soát (ảnh trước/sau ở 1440×900 và 1280×800: `…\scratchpad\uat-cr121c\f15\shots\{truoc,sau}-{1440,1280}-ngan-{viec,cuoi}.png`)
- Tiêu đề "Luật định tuyến" cao 60px (3 dòng) ⇒ 20px (1 dòng); hàng "Còn lại" cao 50px (2 dòng) ⇒ 30px (1 dòng), đo bằng DOM ở cả hai cỡ.
- Ở 1280×800 phần cuối ngăn: nút "Xong" dính đáy, không sát mép/không tràn; nội dung cuộn riêng. Ngăn ngắn hơn (bỏ ~5 dòng chữ), không còn câu lặp/kỹ thuật.
- Căn mép: tiêu đề khối, nút, hàng luật thẳng mép trái 20px của ngăn; viên "Đang dùng", "Bỏ gán" cùng hàng.

## Không làm / Chạm
Không sửa e2e.

## Test tối thiểu
- unit: bộ unit admin-web + i18n hiện có (858 pass); thay đổi giao diện kiểm bằng ảnh.

## Ca e2e cần đổi (qc, không chạy)
- Ca bấm nút đóng ngăn bằng chữ "Xong" của tiêu đề luật (nay "Xong" là nút đóng ở đáy ngăn `flows-drawer-done`; nút bật/tắt sửa luật vẫn `flows-edit-rules-<việc>` và đổi nhãn "Xong"/"Sửa luật"), ca đọc "Còn lại (mặc định)", câu "Đây là quy trình mẫu của Thư viện…", placeholder "Chọn quy trình đã xuất bản để gán thêm", câu "Chưa hiển thị được các bước của khe này".

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/ngan-viec-bo-cuc.md
#### Yêu cầu: Ngăn việc gọn, có thanh hành động dính đáy
Ngăn chi tiết việc không xuống dòng ở tiêu đề luật và hàng "Còn lại"; nút "Xong" luôn ở đáy ngăn, nội dung cuộn phía trên; ít chữ, không lặp.
- Kịch bản: giao diện (soát ảnh UAT f15 ở 1440×900 và 1280×800) [test: thủ công — soát ảnh UAT f15 ngăn việc trước/sau]

## Việc còn lại
- e2e (qc) theo danh sách trên.
