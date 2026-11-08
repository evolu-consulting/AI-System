---
id: cr123-u11-canvas-view
lát: cr123-u11-canvas-view
cr: CR-123
làn: nhanh
migration: không
phụ thuộc: u8 (đã gộp)
---
## Plan (ngắn)
Người dùng báo canvas sửa flow của công ty: (1) mỗi lần thêm node là cả canvas fit lại; (2) mép phải bị cắt; (3) lỗi Ký số tràn mép node; (4) Duyệt mới thả ra chỉ ghi "Duyệt"; (5) flow demo phải đọc được ở 1440×900 / 1280×800.

## Làm
1. Không fit lại sau mỗi lần thêm: giữ zoom/pan của người dùng, node mới được cuộn vào khung bằng 1 lần pan mượt (300 ms, giữ zoom). Chỉ fit khi mở lần đầu, đổi `fitKey` (Sắp xếp) và nút "Vừa khung" (nay đi cùng một đường fit, không còn fit riêng của xyflow).
2. Zoom mở đầu đọc được: tối thiểu 0.75; flow dài hơn khung ⇒ KHÔNG thu nhỏ thêm mà hiện trọn số cột nguyên (cột kế tiếp bắt đầu đúng mép phải khung, không lộ mẩu node bị cắt), phần còn lại kéo ngang (`snapColumnsZoom`).
3. Lỗi "tính năng chưa bật" trên node là nhãn ngắn "Chưa bật Ký số" (câu đầy đủ + cách sửa ở tooltip); lỗi khác tối đa 2 dòng. Tên tính năng lấy tên bước khi loại là công cụ chung (trước đó hiện "Chưa bật Công cụ"); bỏ dòng loại "Công cụ" dưới tên bước.
4. Duyệt thả mới có tên mặc định "Bước duyệt mới" (bảng/kênh: "Bước <loại> mới") + dòng nhắc "Bấm vào bước để đặt tên".

## Không làm / Chạm
- Không engine / hub-api / migration; không CR-124; không tooling depcruise.
- Chạm: `packages/flow-canvas` (`columns-fit.ts`, `FlowCanvas.tsx`), admin-web processes (`FlowNodeBody`, `NodeMenuContent`, `flow-ctx`), i18n process vi/en.

## Test tối thiểu
Unit `packages/flow-canvas/src/columns-fit.test.ts`; admin-web processes + flow-canvas + i18n 520 pass; tsc admin-web + flow-canvas sạch; e2e `cr123-arrow-drag.spec.ts` xanh trên evotest (28 s). Ảnh: `docs/specs/CR-123/shots/u11/` (công ty evolu, julian.bui, UI vi, 1440 và 1280).

## Quyết định trong lúc làm
- Mở flow demo "Duyệt 2 cấp" (8 bước): ở 1440×900 canvas rộng 1100 px hiện 4 cột trọn ở zoom 0.85, ở 1280×800 hiện 3 cột ở zoom 0.96; chữ đọc được không cần phóng to, 4–5 cột còn lại kéo ngang (nút ">" ở mép phải). Không nhét cả 8 bước vừa khung: 8 cột × 320 px ở zoom ≥ 0.75 rộng 1900 px.
- e2e u8 chọn node Duyệt mới theo chữ "Duyệt" ⇒ đổi sang tên mặc định "Bước duyệt mới" (và kiểm thêm tên + nhắc đặt tên sau khi thả).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/flow-web.md
#### Yêu cầu: Canvas sửa flow giữ khung nhìn và đọc được (nguồn: CR-123 u11)
Thêm node không làm canvas fit lại: giữ zoom/pan của người dùng và cuộn mượt tới node mới. Mở lần đầu và nút "Vừa khung" hiện trọn số cột nguyên ở zoom không dưới 0.75 (flow dài kéo ngang, không thu nhỏ). Node báo lỗi "chưa bật" bằng nhãn ngắn, câu đầy đủ ở tooltip. Bước Duyệt mới thả ra có tên "Bước duyệt mới" và nhắc đặt tên.
- Kịch bản: khi khung rộng 1100 px thì hiện 4 cột trọn ở zoom không dưới 0.75 và cột kế tiếp không lộ mẩu node [test: thủ công — file test columns-fit.test.ts không còn trong repo]
- Kịch bản: khi thả Duyệt thì node có tên "Bước duyệt mới" kèm nhắc đặt tên và flow vẫn lưu được sau khi nối [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U8 · thả Duyệt đứng riêng, kéo mũi tên 'Ký xong' tới nó, kéo từ nó tới Kết thúc · Đã duyệt, Lưu và áp dụng thành công]

## Việc còn lại
- Flow rất dài (8+ cột) vẫn phải kéo ngang; nếu cần thấy cả flow một màn hình: bố cục gập hai hàng (lát riêng).
