---
id: fix-cr181-pdf-open
lát: fix-cr181-pdf-open
cr: CR-181
làn: nhanh
migration:
phụ thuộc:
---
## Plan (ngắn)
Màn ký/hộp xem báo «Không mở được tệp này», «Tự đặt theo…» disabled (e2e cr181 K01–K04, journey-dot2, partner-sign-link). Gốc: hai nơi (`use-pdf-doc.ts`, `PdfPane.tsx`) dùng CHUNG `GlobalWorkerOptions.workerPort`; huỷ một lần mở (effect chạy lại do `file` đổi tham chiếu — nội dung tệp được tải 2 lần trong trace) làm chết Worker chung ⇒ lần mở sau lỗi «PDFWorker.create - the worker is being destroyed». Tái hiện bằng bản build thật trên Chromium 153 (hai lần mở, huỷ lần đầu ⇒ lỗi; PDF của e2e mở bình thường khi không huỷ ⇒ không phải do PDF/phông Inter/CR-188).

## Làm
- [x] `lib/pdf-worker.ts` `openPdf`: mỗi lần mở một Worker riêng (`PDFWorker({ port })`), `dispose` huỷ task + Worker của riêng nó.
- [x] `use-pdf-doc.ts`, `PdfPane.tsx` dùng `openPdf`; lỗi thật ghi `console.error` (trước đây nuốt).

## Không làm / Chạm
Không tìm vì sao `file` đổi tham chiếu mỗi lần render ở màn ký (chỉ làm hook chịu được chạy lại); ghi một dòng cho điều phối nếu cần tối ưu tải 2 lần.

## Test tối thiểu
unit `apps/workspace-web/src/lib/pdf-worker.test.ts` (đỏ trước: mỗi lần mở Worker riêng, huỷ lần 1 không đụng lần 2); kiểm tay trên bản build thật (Chromium 153) hai lần mở liên tiếp + mở lại sau huỷ; e2e `cr181` chạy lại bởi điều phối.

## Quyết định trong lúc làm
- Không đổi `[file]` của effect (SignedViewer tạo tệp theo từng bản, `load` khác nhau).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa lỗi nạp pdf.js, hành vi mong đợi vốn là mở được tệp)

## Việc còn lại
Điều phối chạy lại việc `cr181` trên evotest.
