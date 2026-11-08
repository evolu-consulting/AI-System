---
id: cr122-p9b-e2e-ingest
lát: cr122-p9b-e2e-ingest
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: cr122-p9-ingest-formats
---
## Plan (ngắn)
Q1 báo journey `journey-approval` ca G1.2 đỏ ở `uploadAndOpen` (không thấy "Xác nhận và lưu" sau 120 s), nghi p9 làm AI không trả trường. Chẩn đoán từ log `cr122-q1-e2e/.data/evotest/20261106-234111-1400-e2e`.

## Làm
- Tệp G1.2 tải lên là `hop-dong-mua-<run>.md` (`text/markdown`, `e2e/journey-approval/_journey.ts:137`) ⇒ type `md` ⇒ `source_text` có sẵn ⇒ đường VĂN BẢN, không qua lấy chữ PDF, không đính tệp. p9 không đổi đường này (`run-extraction.sourceText` trả `src.text` ngay).
- Stack e2e: `AI_PROVIDER=subscription` + CLI Claude GIẢ (`_ja-stack.ts`) đọc lời nhắc từ stdin; không cần tệp đính kèm.
- Ảnh chụp trang lỗi cho thấy AI ĐÃ đọc: tên, nhà cung cấp, giá trị 150.000.000, hiệu lực đều điền; thẻ "Tóm tắt" đúng. Chỉ thiếu nút "Xác nhận và lưu" — nút này do thẻ duyệt (`ApprovalParts`, `v.confirm`) hiện khi lượt duyệt đã mở, tức lỗi #4 (HĐ gửi duyệt khi bật flow theo sự kiện) mà P11 sửa; Q1 đã `fixme` G1.2 vì #4 trước đó.
- Thêm unit hồi quy `extraction-text-source.test.ts`: HĐ có `source_text` (md/text/zip-office) không gọi `fileText`, không đính tệp, agent nhận chữ ⇒ `needs_review`.

## Không làm / Chạm
- Không sửa sản phẩm (không có hồi quy do p9), không sửa e2e.

## Test tối thiểu
- Unit `apps/hub-api/src/modules/packs/contracts/application/extraction-text-source.test.ts` (2 pass).
- e2e job `journey-approval` chạy trên worktree này (đã có p9 + P11): xem kết quả ở "Việc còn lại".

## Quyết định trong lúc làm
- Không sửa code p9: bằng chứng cho thấy đường đọc `.md` nguyên vẹn; nguyên nhân nằm ở bước mở lượt duyệt.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

Không thay đổi hành vi (lý do: chẩn đoán + thêm unit hồi quy, không đổi code sản phẩm).

## Việc còn lại
- Kết quả e2e `journey-approval` trên HEAD gd0 (p9 + P11) ghi trong báo cáo của lát.
