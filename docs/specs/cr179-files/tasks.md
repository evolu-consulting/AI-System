---
id: cr179-files
lát: cr179-files
cr: CR-179
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Khung ảnh/xem trước/chip tải lên có kích thước cố định ngay lần render đầu; tải xong chỉ đổi nội dung bên trong.

## Làm
- [x] Hằng kích thước một chỗ: `ATTACH_SIZE` + `loadPhase` + `thumbFrame` (`packages/web-kit/src/attach-layout.ts`).
- [x] Ảnh: khung 4:3 / ô lưới cố định, nền mờ + vòng xoay, fade khi `onLoad`, ô lỗi cùng cỡ + «Tải về» (`ui/attach-frame.tsx`, `AttachGallery.tsx`).
- [x] Thẻ tệp cao cố định, tên 1 dòng; chip tải lên cao/rộng cố định, thanh tiến trình trong chip (`AttachDraft.tsx`).
- [x] Xem trước: hộp nền đen cỡ theo khung nhìn + «Đang tải…» (`ViewerStage`; `AttachViewer.tsx`; Tin nhắn `FilePreview.tsx`).
- [x] e2e (chưa chạy): `e2e/cr179/khung-tep-co-dinh.spec.ts`.

## Không làm / Chạm
Không đổi tooltip tên dài (lát 2). Không chạm Community / shell. Chạm: web-kit attach*, messages-web FilePreview + attach-view (nhãn `loading`).

## Test tối thiểu
`bun test packages/web-kit` (attach-layout) · tsc web-kit, messages-web, workspace-web · `check:ui-kit`.

## Quyết định trong lúc làm
- Thumb: gốc là `div` giữ khung, nút mở ảnh phủ bên trong; nút «Tải về» khi lỗi là nút anh em (không lồng nút trong nút).
- `AttachLabels.loading` tuỳ chọn (không có ⇒ «…») để app khác không phải đổi.
- e2e viết file mới vì j18 đã khoá.
- Chiều cao chip: 56 (thường) / 44 (gọn); thẻ tệp 56.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tin-nhan.md
#### Yêu cầu: Tệp và ảnh hiển thị trong khung cố định
Ảnh, thẻ tệp, chip tải lên và hộp xem trước có kích thước cố định ngay từ đầu; trong lúc tải hiện nền tối + vòng xoay, tải xong ảnh hiện dần mà khung không đổi cỡ; ảnh lỗi hiện ô lỗi cùng cỡ kèm «Tải về». Hộp xem trước nền đen, giữa hộp ghi «Đang tải…» tới khi tệp sẵn sàng.
- Kịch bản: khi tệp chưa tải xong hoặc ảnh lỗi thì trạng thái hiển thị là «đang tải» hoặc «lỗi», chỉ «sẵn sàng» khi có URL và ảnh đã onLoad [test: packages/web-kit/src/attach-layout.test.ts » loadPhase: chưa URL/chưa onLoad ⇒ loading; xong ⇒ ready; lỗi ⇒ error]
- Kịch bản: khi chỉ có một ảnh thì khung có tỉ lệ và rộng tối đa cố định [test: packages/web-kit/src/attach-layout.test.ts » thumbFrame: ảnh đơn có tỉ lệ + rộng tối đa cố định; ô lưới không áp riêng]
- Kịch bản: khi người nhận mở «Xem trước» PDF thì hộp xem giữ nguyên kích thước trước và sau khi tải xong [test: e2e/cr179/khung-tep-co-dinh.spec.ts » xem trước tệp: hộp nền đen giữ nguyên kích thước trước và sau khi tải xong]

## Việc còn lại
Chạy e2e `e2e/cr179/khung-tep-co-dinh.spec.ts` cuối đợt; soát UI bằng mắt (ảnh lỗi, chip tải lên).
