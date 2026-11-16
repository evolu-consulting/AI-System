---
id: cr177-w4-fixes
lát: cr177-w4-fixes
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Hai lỗi giao diện nhỏ của workspace-web: (1) nút trợ lý nổi che nội dung; (2) emoji làm icon.

## Làm
- Shell: vùng nội dung chính có đệm đáy `--fab-safe` (desktop 5.5rem, điện thoại 9rem, cộng safe-area). Nút nổi dùng Tooltip của kit.
- Emoji icon -> `ICONS` (web-kit): khoá (danh sách HĐ, khối phiên bản), 📄 -> contract, ✏ -> edit, ⚠ (ProductPicker, DetailSections), ✓ (SignSessionCard).
- Giữ nguyên ký tự chữ ✕ ★ ⚑ ● ‹ › (không phải emoji; thuộc lát nút/ô khác).

## Không làm / Chạm
Không đổi ô chọn/ô nhập, câu chữ, vị trí hay hành vi nút nổi.

## Test tối thiểu
unit versions.test.ts, shell-parity.test.tsx; e2e cr177-w4-fab-safe.cw.ts (chưa chạy).

## Quyết định trong lúc làm
- Nhãn «Đã khoá» dùng khoá i18n có sẵn `contracts.lock.badge`.
- Tooltip nút nổi chuyển từ span CSS sang Tooltip kit; test parity kiểm aria-label.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED web/nut-noi.md
#### Yêu cầu: Nút trợ lý nổi không che nội dung
Vùng nội dung chính chừa đệm đáy bằng chiều cao nút nổi + lề (biến `--fab-safe`, cộng safe-area trên điện thoại) ở mọi trang.
- Kịch bản: khi cuộn tới cuối danh sách HĐ ở 1280x720 và 390x844 thì phân trang không bị nút nổi đè [test: e2e/contracts-web/cr177-w4-fab-safe.cw.ts » CR177-W4 · danh sách HĐ]
#### Yêu cầu: Biểu tượng giao diện dùng bộ icon chung, không emoji
Khoá/phiên bản/cảnh báo dùng `ICONS`; icon khoá có nhãn «Đã khoá» cho trình đọc màn hình.
- Kịch bản: khi dòng phiên bản là hiện hành thì icon là khái niệm «locked» [test: apps/workspace-web/src/features/contract-versions/lib/versions.test.ts » mỗi loại trỏ khái niệm icon của bộ chung]

## Việc còn lại
