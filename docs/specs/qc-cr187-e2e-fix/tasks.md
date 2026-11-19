---
id: qc-cr187-e2e-fix
lát: qc-cr187-e2e-fix
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Phân loại đỏ e2e cuối đợt CR-187..192 (logs `.data/evotest/20261120-011204-8032-e2e`, `…011206-6052-e2e`); sửa phần test sai so với spec mới. Không sửa code, không chạy e2e.

## Làm — lý do sửa từng file (test sai so với spec mới)
- `community-web/_composer.ts`: thêm `settled()`, `openComposer` đợi hiệu ứng mở hộp xong (đo khung lúc đang phóng to ⇒ 43,57px/381px). Không sleep.
- `community-web/cr191-composer-audience.cm.ts`: như trên cho ca «toàn màn» (388px).
- `community-web/cr147-feed.cm.ts`: «Huỷ» giữ 2 chip chỉ khi tên còn trong thân bài (BR-191-8, chip = người còn trong thân) ⇒ gõ thêm « @» thay vì ghi đè thân.
- `community-web/cr186-composer.cm.ts`: «Tất cả» = 4 người công ty mình + 2 người công ty kết nối (CR-191) ⇒ 6.
- `community-web/cr187-ui.cm.ts`: icon Sửa/Xoá bình luận cỡ 28px đo trên bình luận của chính mình (mock không có icon trên bình luận cũ).
- `community-web/cr191-feed-ui.cm.ts`: mock có 36 bài (8 + 2×14), trang 2 còn 16 < 20 ⇒ hết bài.
- `community-web/feed.cm.ts`: đóng hộp «Viết bài…» (hộp thoại, che trang) trước khi chạm bài bên dưới.
- `community-web/shell.cm.ts`: «Kiểm tra tệp» bỏ khỏi thanh bên (BR-188-6) ⇒ 7 link; bỏ ý «nút soạn nhanh» (CR-191 bỏ).
- `community-web/sidebar-one.cm.ts`: «Yêu cầu tham gia» ẩn với người duyệt (CR-191) ⇒ ca «99+» chuyển sang «Duyệt bài».
- `contracts-web/cr187-password.cw.ts`: lỗi giả đúng hình thật `{error:{code,message}}`.
- `contracts-web/cr188-verify.cw.ts`, `cr181/journey-dot2.spec.ts`: câu (c) BR-188-6 bắt đầu «Tệp không khớp …».
- `cr169/tin-nhan-cong-ty.spec.ts`: tên công ty nằm ở đầu nhóm (CR-190), không lặp ở dòng.
- `cr189-admin-org-ui.spec.ts`: bỏ `waitForTimeout(300)` (N5): chờ một khung hình + khẳng định không có lệnh ghi.

## Không làm / Chạm
`e2e/**`, `tests/.lock`. Không sửa code. Không chạy e2e (điều phối).

## Test tối thiểu
`bun run test:lock:write`; `bun run test:lock:verify`; `bun run openspec:check qc-cr187-e2e-fix`.

## Quyết định trong lúc làm
- Ca ảnh/chữ baseline (A) và lỗi code (C) KHÔNG sửa — xem báo cáo qc.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa e2e theo spec)
