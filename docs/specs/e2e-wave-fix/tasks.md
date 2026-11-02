---
id: e2e-wave-fix
lát: e2e-wave-fix
cr: CR-105, CR-106, CR-107
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Ba e2e đỏ do đợt này: sửa test theo hành vi mới (CR-105/106) và hai lỗi bố cục thật của community-web (commit d209d045).

## Làm
- `e2e/contracts-web/esign-flow.cw.ts`: CR-106 canvas là mặc định, bấm công tắc "Danh sách" rồi mới đếm `flow-diagram` (chỉ sửa test).
- `e2e/P-a/pf4/process-library.pa.ts`: CR-105 khe "Dùng cho" chuyển thành dòng phụ dưới tên + huy hiệu "Mặc định" (chỉ sửa test).
- `e2e/community-web/feed.cm.ts`: nút loại bài "Cần bán" dùng `exact: true` (ô gợi ý composer thu gọn cũng chứa chữ "cần bán" ⇒ strict mode) — nhầm selector, sửa test.
- Sửa SẢN PHẨM (nhỏ, CSS/JSX, không logic thuần ⇒ không unit; e2e feed.cm.ts phủ):
  - `apps/community-web/src/styles/feed.css`: composer MỞ không còn dính (`.stickytop:has(.feedcomposer:not(.collapsed))`); mở rộng ~680px dính ⇒ chiếm gần hết màn 900px, che bài + nút Bình luận.
  - `apps/community-web/src/ui/Settings.tsx`: bọc nội dung trong `.wscenter` như Hồ sơ; màn ≥ 1224px thanh bên cố định (fixed) đè lên thẻ cài đặt (không bấm được swatch màu).

## Không làm / Chạm
Không redesign. Không đổi engine/API. Job `community-web-stack` cần stack thật (không có webServer) nên đỏ ở máy không dựng stack; không thuộc lát.

## Test tối thiểu
e2e `--only=contracts-web`, `--only=P-a`, `--only=community-web` (feed.cm.ts 5/5).

## Quyết định trong lúc làm
Lỗi `getByRole('button',{name:'Cần bán'})` 2 phần tử là do test (substring), không do sản phẩm. Hai lỗi còn lại của feed.cm.ts (Bình luận p1 bị `.stickytop` che; swatch "Cam" bị `.wsside` che) là lỗi bố cục thật.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Bảng tin — composer và cài đặt trên màn rộng
Khối composer + tab chỉ dính (sticky) khi composer thu gọn; composer mở rộng cuộn cùng trang. Màn Cài đặt canh giữa nội dung trong vùng chính, không bị thanh bên cố định (≥ 1224px) che.
- Kịch bản: khi mở composer rồi bấm Bình luận ở bài p1 thì nút bấm được [test: e2e/community-web/feed.cm.ts » chủ quản: luồng theo từng công ty + audience preview + nút Lưu báo giá bật và mở form (C7b)]
- Kịch bản: khi mở Cài đặt › Giao diện ở 1440 px thì chọn được màu "Cam" [test: e2e/community-web/feed.cm.ts » thông báo, hồ sơ, cài đặt màu chủ đạo]

## Việc còn lại
Không.