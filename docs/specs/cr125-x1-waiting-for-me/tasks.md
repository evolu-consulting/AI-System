---
id: cr125-x1-waiting-for-me
lát: cr125-x1-waiting-for-me
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
CEO review (docs/specs/CR-125/demo-assessment.md, sửa 1–2 + ghi chú ngày): giám đốc vào Tổng quan thấy "Cần xử lý: 0 việc" dù có HĐ chờ ký; điện thoại không có lối "Chờ tôi"; ngày kiểu mm/dd.

## Làm
- API: `GET /my-work` thêm `signing[]` — HĐ chờ CHÍNH người xem KÝ (phong bì còn mở, mình là người ký công ty chưa ký và đã tới lượt) bằng MỘT câu SQL trong cùng tx với danh sách; `approvals[]` giữ nguyên (nguồn "Chờ tôi duyệt"). Một đọc cho cả thẻ, trang và thanh dưới.
- Web: thẻ đầu Tổng quan "Chờ bạn: N ký · M duyệt" (ẩn khi 0, bấm ⇒ trang "Chờ tôi duyệt"); trang đó có thêm khối "Chờ bạn ký"; thanh dưới điện thoại có mục "Chờ tôi" số đỏ (thế chỗ "Sản phẩm & Giá").
- Ngày: MỘT bộ định dạng `viDate` / `viDateTime` (dd/mm/yyyy, giờ Việt Nam) thay mọi `toLocale*String()` theo máy trong app Sổ Hợp Tác.

## Không làm / Chạm
- Ô chọn ngày gốc của trình duyệt (`<input type="date">`) hiện theo ngôn ngữ trình duyệt/hệ điều hành, không do JS quyết ⇒ chưa đổi (cần bộ chọn ngày riêng — lát sau).
- Không canvas, esign (chỉ ĐỌC phong bì), partner. Không migration.

## Test tối thiểu
unit `waiting.test.ts`, `format-datetime.test.ts`; int + đo `mywork-signing.int.test.ts`; journey e2e G2 một lần + ảnh desktop/375.

## Quyết định trong lúc làm
- perf: phần ký = MỘT câu SQL thêm vào tx của `GET /my-work` (không thêm vòng). Đo thật 1.000 phong bì: p50 4,1 ms · p95 11,2 ms (ngưỡng 300 ms).
- "Một nguồn": thẻ và thanh dưới đếm từ cùng `GET /my-work` (`approvals` = cùng `openTasksOf` với "Chờ tôi duyệt").

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr124-cr125)

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Danh sách hợp đồng
Giám đốc thấy ngay việc chờ chính mình: thẻ "Chờ bạn: N ký · M duyệt" đầu Tổng quan và mục "Chờ tôi" số đỏ ở thanh dưới điện thoại, cùng một nguồn với trang "Chờ tôi duyệt"; mọi ngày trong app hiện dd/mm/yyyy qua một bộ định dạng.
- Kịch bản: khi người dùng là người ký công ty đã tới lượt của một phong bì còn mở thì HĐ đó nằm trong danh sách chờ ký của họ, người khác và tenant khác không thấy [test: apps/hub-api/src/modules/packs/contracts/adapters/mywork-signing.int.test.ts » chỉ phong bì còn mở, mình là người ký chưa ký và đã tới lượt]
- Kịch bản: khi có việc ký và duyệt thì số hiển thị là tổng hợp từ một đọc, bằng 0 thì ẩn [test: apps/workspace-web/src/features/overview/lib/waiting.test.ts » 2 ký + 1 duyệt ⇒ tổng 3]
- Kịch bản: khi hiển thị ngày thì luôn dd/mm/yyyy theo giờ Việt Nam [test: apps/workspace-web/src/components/shared/format-datetime.test.ts » ngày ISO ⇒ dd/mm/yyyy (30/09 chứ không 09/30)]
- Kịch bản: khi giám đốc đăng nhập lúc có HĐ chờ duyệt thì thẻ Chờ bạn và số đỏ ở thanh dưới điện thoại hiện [test: e2e/journey-approval/cr122-flows.spec.ts » G2 · tenant_admin: Sao chép → 3 lỗi 409 → sửa người duyệt → Xuất bản (gốc tự Tắt) → HĐ B theo bản công ty, HĐ A giữ bản cũ → Quay về bản gốc]

## Việc còn lại
Ô chọn ngày gốc của trình duyệt (mm/dd theo máy) — cần bộ chọn ngày riêng.
