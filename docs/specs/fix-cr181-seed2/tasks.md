---
id: fix-cr181-seed2
lát: fix-cr181-seed2
cr: CR-181
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa seed `--sign-only`: tên tệp đọc từ `contracts.files`; HĐ mẫu đã rời Nháp ⇒ tạo HĐ mẫu mới theo ngày.

## Làm
- [x] `sampleState`: tên tệp = `contracts.files` join `contract_files` theo `(file_id, tenant_id)` + tệp chính (`contracts.file_id`, nếu không mỗi lần chạy lại tải lại hợp đồng).
- [x] `pickSampleTarget`/`dailySampleTarget`: id `c1810000-0000-4000-8000-16YYMMDD0000`, tiêu đề «… · dd/mm» (giờ VN); HĐ cũ giữ nguyên; cùng ngày chạy lại không tạo thêm.
- [x] Unit test kế hoạch/chọn HĐ (13 ca).

## Không làm / Chạm
Không int test cho `sampleState`: seed tools chưa có khuôn int cho schema pack contracts (cần dựng DB + migration gói); câu SQL đã `export` để thêm sau.

## Test tối thiểu
`bun test tools/scripts/src/seed-cr181-sign*.test.ts` → 13 xanh.

## Quyết định trong lúc làm
- HĐ Nháp mẫu còn tồn tại (bất kỳ ngày) ⇒ dùng lại, không tạo thêm.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa seed dữ liệu mẫu)
