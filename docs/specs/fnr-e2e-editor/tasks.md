---
id: fnr-e2e-editor
lát: fnr-e2e-editor
cr: CR-103
làn: nhanh
migration: không
phụ thuộc: fnr-canvas (chỉ ca C/D khi kéo thả canvas đổi)
---
## Plan (ngắn)
Thêm e2e editor quy trình cho node registry CR-103 vào cấu hình `e2e/fnr-showcase/playwright.fnr.config.ts`: file `editor.fnr.ts`.
Mỗi ca tự tạo def riêng qua `POST /process-defs` (key ngẫu nhiên), không phụ thuộc thứ tự.

## Làm
- A: bản sao flow mẫu → đổi "Hoàn tất" Ghi giá trị → agent → Lưu 200 → tải lại còn → chạy 50tr: nhánh else, stage chạy bằng agent, run `done`.
- B: stage có trường được If bước sau dùng ⇒ loại không sinh trường (Chờ tới ngày / Nếu / Áp bản sửa) bị khoá kèm `field_ref`; agent / Gọi tool chọn được (đổi khác họ cho phép).
- C: kéo node sang cột bước khác ⇒ Lưu ⇒ tải lại còn.
- D: dồn giai đoạn vào bước của If ⇒ lỗi IF_INVALID hiện ở editor, def không đổi.
- E: If trỏ tới bước có Hành động thật ⇒ Lưu bị chặn (lỗi ngay trong khối "Nếu", không gửi PUT).

## Không làm / Chạm
Không sửa code sản phẩm. Chỉ `e2e/fnr-showcase/editor.fnr.ts`, `tests/.lock`.

## Test tối thiểu
Chạy riêng: `PA_E2E_ENV=.env.test-fnred.local PA_REDIS_DB=11 bun tools/scripts/src/run-playwright.ts e2e/fnr-showcase/playwright.fnr.config.ts editor.fnr`
(đặt thêm `FNR_E2E_PORT_BASE` khác 4700 nếu cổng bận, `LOGIN_IP_MAX_ATTEMPTS=100000` để khỏi 429 đăng nhập).

## Quyết định trong lúc làm
- Đổi Ghi giá trị → agent giữ trường `ket_qua` bắt buộc; Runtime giả không sinh trường có cấu trúc ⇒ run vào "Cần quyết" (`template_invalid`). Ca A xoá trường đó trong editor trước khi lưu.
- Ca D dùng ô "Chạy ở bước" để chuyển giai đoạn (kéo thả canvas đang được fnr-canvas đổi); ca C dùng kéo chuột như E-PB2-04.
- Ca E: lỗi chặn ở client (d2-validate) nên không có PUT; kiểm thông báo `IF_INVALID` trong khối "Nếu".
- Token Hub không dùng lại giữa ca (hết hạn nhanh).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: thêm e2e editor CR-103)

## Việc còn lại
- Sau khi fnr-canvas merge: rebase, chạy lại C/D (kéo thả) và chỉnh nếu canvas đổi.
