---
id: DOC-ui-gaps
lát: A5 (phần còn lại của DOC-ui-list)
cr: CR-101 (Intake 2026-10-27 R30 UI, Câu 8, Câu 9)
làn: nhanh
migration: không
phụ thuộc: DOC-ui-list, DOC-legal, DOC-ui-frame đã merge
---
# DOC-ui-gaps — root_id/source trong list, upload chọn loại, cột Nguồn, cảnh báo pháp lý ở form, baseline nav

## Đã làm
1. Backend list: `docs[]` thêm `root_id` (khoá khớp `children.frame_root_id`, HĐ NT phiên bản ≥ 2 có id ≠ root_id) và `source` (giao dịch; HĐ ⇒ null) — cùng câu SQL (`docsOf`), số câu list vẫn 2. Int: `DOC-model` (v2 root_id + con theo root), `DOC-deals` (source). Perf `list-frame` giữ 2 câu SQL; p95 `nest=1` trang đầu quanh 40–53 ms tuỳ tải máy (bản gốc trước thay đổi cũng 53–54 ms trên máy này; có thay đổi đo 40–43 ms) — không phải do lát này.
2. UI list: lồng con theo `root_id`; cột "Nguồn" CHỈ hiện khi lọc Giao dịch (giữ 7 cột mặc định, không vỡ e2e/baseline).
3. Upload: hộp chọn loại chứng từ trước khi vào hàng đợi (HĐ kinh tế + "Thuộc HĐ nguyên tắc" có tìm kiếm / HĐ nguyên tắc + hạn mức + cách đặt hàng), gửi `doc_type`/`frame_root_id`/`credit_limit`/`order_terms`. Giao dịch không tải tệp (gắn file = nâng).
4. Form Giao dịch: cảnh báo pháp lý trước khi lưu (`legal-warn.ts`, cùng luật máy chủ; ngưỡng GET /company; chỉ cảnh báo, không áp khi có HĐ NT hoặc tích "đã giao/đã thanh toán ngay"; giới thiệu chỉ tính hoa hồng cố định).
5. Baseline win32 chụp lại (nav 4 mục + tiêu đề + bộ lọc loại): 40 tệp. Baseline linux (CI/evotest) cần chụp trên Linux: `deploy/evotest/run-tests.ps1 -Step e2e -Capture cw`.

## Còn lại / quyết định
- AI gợi ý loại (`ai_read.doc_type_suggest`, tô vàng, chọn lại) CHƯA làm: không có API đổi `doc_type` sau khi tải lên (chỉ nhận lúc upload) và chỗ hiển thị là màn kiểm HĐ (`contract-review`, lát khác). TODO: API đổi loại (409 FRAME_HAS_CHILDREN đã có mã) + chip "AI gợi ý" ở màn kiểm.
- Ghi chú giao dịch: `DealCreateRequest` chưa có trường `note`.
- Hộp chọn loại chặn mọi lần chọn tệp ở danh sách (thêm 1 bước bấm "Tải lên"); `/contracts/new` (trang upload cũ) không đổi, vẫn tải thẳng HĐ kinh tế.