# ux-excel — góp ý khách (Excel) · làn nhanh

- E1 `ExportButtons` -> một nút "Xuất" + `PopMenu` (Excel / CSV), logic xuất giữ nguyên.
- E2 `ActionsCell`: nút "Xem" -> icon mắt (aria-label/tooltip "Xem hợp đồng").
- E3 `ContractReviewPage`: bỏ AskContractPanel + AppendixPanel khỏi trang (code feature giữ).
- E4 Header needs_review: Huỷ + "Xác nhận và lưu" (saveFirst) + menu ⋯ (Đọc lại / Từ chối, `overflowOf`); không xác nhận được -> "Lưu nháp" (`showDraftSave`).
- E5 `ExtractDialog`: hộp "Upload hợp đồng" (tên tệp + chip Trích thông tin / Đọc danh sách hàng / Tóm tắt). API chưa báo bước nên chip chạy theo thời gian (`extract-progress.ts`); hiện khi đang tải lên (list) hoặc HĐ `extracting` (trang HĐ, đã poll 2 s), đóng khi trạng thái đổi.
- Test: unit `extract-progress.test.ts`, `approval-head.test.ts`; e2e sửa hd3-flow, products-confirm, ui-gating, gap-b-list.
