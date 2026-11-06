---
id: cr121-f18-copy-editor-simple
lát: cr121-f18-copy-editor-simple
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: c17, c17b, F14
---
## Plan (ngắn)
UAT lượt 4: trình sửa BẢN RIÊNG công ty lộ trường kỹ thuật ("Ký hiệu chạy" kèm "!", "Group được chạy… / Thêm Group", "Ngân sách token cả lượt", công tắc "Bật"). Luật GỐC 3 + "design đơn giản".

## Làm (một `DefInfoCard`, thêm `variant`, không fork)
- `copy` (bản riêng): chỉ Tên, Mô tả, Thời hạn lượt chạy (+ Không hết hạn); khối "Nâng cao" thu gọn chỉ còn "Giới hạn chi phí AI mỗi lượt (tuỳ chọn)".
- `library` (thư viện, platform): Tên, Mô tả, Thời hạn; "Nâng cao": Mã nội bộ của quy trình (không còn "!"), Giới hạn chi phí AI, "Đang bật".
- `full` (tạo mới / mẫu): giữ nguyên.
- ẨN hẳn với bản riêng (lý do kiểm mã): ký hiệu — bản riêng chạy qua khe/luật, không gọi bằng `!ký hiệu` (c9b); "Group được chạy" — Hub dựng lại `run_group_ids: []` từ khe khi lưu (`slotDraft`) nên chỉnh vô tác dụng; "Gợi ý nhập" — chỉ cho lệnh chat `!key`; công tắc "Bật" — bản riêng `enabled=false` vẫn chạy (c9b). Dữ liệu cũ của các trường này vẫn được gửi lại nguyên khi lưu.
- `infoVariant` (lib thuần) chọn kiểu; i18n vi/en: `advanced`, `keyInternal`, `budgetAi`, `enabledLib`.

## Test
unit `lib/company-copy.test.ts » CR-121 f18`. Chưa chụp ảnh (môi trường agent không dựng được stack UAT) — điều phối chụp lại `1b-trinh-sua-ban-rieng-platform` và trình sửa thư viện. Không sửa e2e. Perf: không chạm.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/trinh-sua-thong-tin-don-gian.md
#### Yêu cầu: Thẻ Thông tin của trình sửa chỉ hiện trường nghiệp vụ (CR-121 UAT)
Trình sửa bản riêng công ty chỉ hiện Tên, Mô tả, Thời hạn lượt chạy; giới hạn chi phí AI nằm trong "Nâng cao"; ký hiệu, nhóm được chạy, gợi ý nhập và công tắc Bật không hiện vì không có tác dụng với bản riêng. Trình sửa thư viện gom mã nội bộ, giới hạn chi phí AI và "Đang bật" vào "Nâng cao".
- Kịch bản: thư viện / bản riêng / quy trình thường chọn đúng kiểu thẻ [test: apps/admin-web/src/features/processes/lib/company-copy.test.ts » CR-121 f18 · thẻ Thông tin chỉ trường nghiệp vụ]