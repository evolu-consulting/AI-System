# review-ux (làn nhanh, Luật 0b)
Feedback khách trên trang HĐ contracts-web. Không đổi backend/API.
- [x] 1 Hộp "Xem hợp đồng gốc": tệp không xem trước + `has_source` ⇒ hiện chữ nguồn (`fetchSourceText`, cùng key với SourcePanel) + ghi chú; không có ⇒ thông báo cũ.
- [x] 2 needs_review: nút "Lưu nháp"; thông báo "Đã lưu nháp…" (`saveLabelKey`/`savedNoticeKey` trong lib/review.ts).
- [x] 3 AppendixPanel: gợi ý nhập, đang tìm, không thấy «…», nút Huỷ (`appendix/search-view.ts`).
- [x] 4 SummaryPanel: ẩn mục trống (`nonEmptyRows`; danh sách AI rỗng không render).
Quyết định: phụ lục trong hộp thoại dùng `has_source` của chính phụ lục. Không chạy e2e; e2e cũ có thể đang kỳ vọng nhãn "Lưu"/thông báo cũ (kiểm ở cuối đợt).
