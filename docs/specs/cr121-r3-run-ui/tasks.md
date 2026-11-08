---
id: cr121-r3-run-ui
lát: cr121-r3-run-ui
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: R-1 (điều khiển lượt chạy), R-2 (API chi tiết + nhật ký bước)
---
## Plan (ngắn)
Thay thân `ProcessRunPage` (admin-web) bằng "Chi tiết lượt chạy" theo mockup Tpl-Run: đầu trang, sơ đồ ngang có hiệu ứng, dòng thời gian, ngăn nhật ký bước (Cơ bản/Gỡ lỗi), thao tác Dừng / Chạy lại bước / Chạy lại cả lượt có lý do bắt buộc.

## Làm
- `lib/run-detail-view.ts` (+ test): trạng thái bước → kiểu node; hiện nút theo trạng thái + vai; câu lỗi dễ hiểu (409 `pack_bound`).
- `run-detail-api.ts`: `useRunDetail` (làm tươi 5 s tới khi kết thúc), `useStageLog`, `useRunControl`.
- `components/run-detail/*`: RunHeader, RunFlow (CSS `.run-part`/`.run-nb` trong `globals.css`, tôn trọng reduced-motion), RunTimeline (liên kết `ref_run_id`), StepDrawer (DetailDrawer) + StepDebug, ControlDialog (chip lý do), RunDetailBody.
- i18n `process.admin.runDetail.*` vi + en.

## Không làm / Chạm
API, chat-web, migration. Giữ: RunActions (quyết định/huỷ cũ), AutofixBlocks, OutputDialog, UsageTab (thu gọn dưới trang). `RunProgress`/`RunLog` còn dùng ở ShowcasePage ⇒ giữ (D6: không còn trên trang admin run).

## Test tối thiểu
Unit `run-detail-view.test.ts` (chạy xanh). e2e `e2e/K1/admin/cr121-run.k1.ts` (viết, chưa chạy; stack K1/P-b2); `notice.k1.ts` sửa selector (kết quả nay mở qua ngăn bước).

## Quyết định trong lúc làm
- e2e đặt đuôi `.k1.ts` (config K1 project admin, Hub thật) thay vì `.spec.ts`: config gốc chỉ có admin-api, không có Hub nên spec gốc không chạy được trang này.
- "Mở lại quy trình" cho lượt gắn gói: API mở lại hiện có là `POST /pack/contracts/contracts/:id/reopen` (theo id hợp đồng) mà `RunDetail` không có id hợp đồng ⇒ UI ẩn nút Chạy lại cả lượt khi 409 `pack_bound` và hiện câu giải thích (mở lại từ màn hợp đồng).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/processes-run-page.md
#### Yêu cầu: Chi tiết lượt chạy (admin)
Trang lượt chạy hiện đầu trang (mã lượt có sao chép, quy trình + phiên bản, công ty, kích hoạt bởi, mốc thời gian, trạng thái + lý do), sơ đồ ngang các bước, dòng thời gian thu gọn được; bấm bước mở nhật ký bước (Cơ bản; Gỡ lỗi chỉ khi server trả debug).
- Kịch bản: khi quản trị mở lượt chạy và bấm một bước thì thấy ngăn "Nhật ký bước n" có tab Cơ bản [test: e2e/K1/admin/cr121-run.k1.ts » mở lượt chạy]
- Kịch bản: khi chọn mức theo vai thì tab Gỡ lỗi chỉ hiện khi dữ liệu có mức debug [test: apps/admin-web/src/features/processes/lib/run-detail-view.test.ts » tab Gỡ lỗi chỉ khi level=debug]

#### Yêu cầu: Thao tác lượt chạy có lý do
Dừng / Chạy lại bước / Chạy lại cả lượt qua thẻ xác nhận nói hậu quả, bắt buộc chọn lý do (Gửi nhầm, Cần sửa nội dung, Dữ liệu sai, Khác); nút hiện theo trạng thái và vai; lượt gắn gói trả 409 `pack_bound` thì ẩn nút và giải thích.
- Kịch bản: khi lượt đang chạy thì quản trị thấy Dừng, không thấy Chạy lại [test: apps/admin-web/src/features/processes/lib/run-detail-view.test.ts » runControls]
- Kịch bản: khi dừng lượt phải chọn lý do rồi mới xác nhận được [test: e2e/K1/admin/cr121-run.k1.ts » dừng lượt]
- Kịch bản: khi bước lỗi/xong thì chỉ platform_admin thấy Chạy lại bước [test: apps/admin-web/src/features/processes/lib/run-detail-view.test.ts » canRerunStepUi]

## Việc còn lại
- Nút "Mở lại quy trình" cho lượt gắn gói: cần `RunDetail` trả id hợp đồng/gói (hoặc API mở lại theo run) rồi gọi `/pack/contracts/contracts/:id/reopen`. Hiện chỉ giải thích.
- Chạy e2e `cr121-run.k1.ts` + `notice.k1.ts` ở cuối đợt (stack K1).
- Tenant-side trang lượt chạy (chat-web): lát sau.