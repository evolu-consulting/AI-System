---
id: cr177-w3a-buttons
lát: cr177-w3a-buttons
cr: CR-177
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
W3a: workspace-web nửa A (hợp đồng, sản phẩm, sổ) chuyển `<button>` trần, `Btn` cũ và `title=` tooltip sang bộ component chung (Button, Tooltip, icons.ts).

## Làm
- [x] `.btn*` / `Btn` ⇒ kit `Button` (primary|outline|quiet|danger|link; md|sm|icon); `loading` ⇒ `busy`.
- [x] Nút chỉ icon ⇒ `size="icon"` + `aria-label` + Tooltip (menu «…» ký số, xoá dòng/lọc/tìm, bỏ qua việc, thùng rác ở danh sách, mắt xem mật khẩu).
- [x] Nút khoá có lý do ⇒ `disabledReason` (thùng rác HĐ nhiều phiên bản, nút chính ở HeadActions, «Lưu» ghi nhận bên đối tác).
- [x] `title=` trên chữ bị cắt / chỉ báo ⇒ Tooltip (tên tệp, tên HĐ, đối tác, delta, cột biểu đồ, hạn trả).
- [x] e2e `v2m-delete.cw.ts`, `15-user-bugs.deployed.ts`: kiểm `aria-disabled` + tooltip thay `title`; `LoginForm.test.tsx` theo thứ tự thuộc tính mới.
- [x] Hạ mốc `check:ui-kit` (button 314 ⇒ 175 toàn app, title 32 ⇒ 16).

## Không làm / Chạm
Không sửa kit, không đụng `features/messages` và phần của W3b. Chỉ `apps/workspace-web/src/features/*` trong phạm vi, 2 file e2e, file mốc.

## Test tối thiểu
`bun test apps/workspace-web` (1043 xanh) · `tsc --noEmit -p apps/workspace-web` sạch · `check:ui-kit` hạ mốc. e2e chưa chạy (chạy cuối đợt).

## Quyết định trong lúc làm
- `disabled` giữ nguyên cho nút bận (không dùng `busy` ở chỗ đổi nhãn «Đang…»); `busy` chỉ thay `loading` cũ của `Btn`.
- Nút khoá lý do dùng `aria-disabled` (kit): Playwright `toBeDisabled` vẫn nhận.
- Tooltip chỉ hiện khi có nội dung (`open={x ? undefined : false}`).

## Màn đã đổi (cho bước soát UI)
Danh sách HĐ (+ dòng con, thùng rác, thẻ điện thoại, tải lên, mời đối tác) · Chi tiết HĐ (đầu trang, ký số, hộp hỏi duyệt, kỳ, tệp gốc, lịch sử, tái trích xuất) · Form HĐ (dòng hàng, khung) · Mốc/Phạt · Tệp HĐ · Phiên bản · Duyệt (hồ sơ, ký số) · Tổng quan (việc cần làm, hộp duyệt, biểu đồ nhóm) · Sổ (kỳ thanh toán, nhật ký) · Bảng (lọc cột, ô tìm) · Khung (gắn HĐ, nhật ký) · Nâng giao dịch · Đối tác gửi hồ sơ · Sản phẩm (nguồn, kho, luật, thêm) · Nhà cung cấp (so giá, báo giá, tìm, cấu hình) · Liên kết SP · Đăng nhập · Trạng thái gói · Sơ đồ tổ chức · Yêu cầu.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ đổi thành phần hiển thị nút/tooltip sang bộ chung, câu chữ, testid và thao tác giữ nguyên; nút khoá vẫn khoá, nay có lý do rê chuột).

## Việc còn lại
Còn 23 `<button>` giữ lại (ô/thẻ bấm được, không ép): chọn dòng trong ô tìm đối tác/khung (`PartnerField` x2, `FramePicker`), tab tự dựng (`KindTermsFields`, `OverviewPage` kỳ, `ComparePanel` loại, `ProductHistory` radio), chip lọc (`InboxRowList`, `ColumnFilters` x4, `ColumnPicker`), phân trang (`Pager` x3: kit chưa có icon «tiếp»), mục menu (`EsignPanel` huỷ ký, `FramePanel` gắn HĐ), hàng gập (`HistoryPanel`, `RequestStepsTree`), nút tên sửa tại chỗ (`TitleEdit`, `OrgPage` chọn quản lý), đổi ngôn ngữ (`AuthLayout`). Kit thiếu: icon «tiếp/sau» trong icons.ts; ToggleGroup chưa áp cho tab/chip. `.btn*` trong globals.css chưa gỡ (lát dọn).
