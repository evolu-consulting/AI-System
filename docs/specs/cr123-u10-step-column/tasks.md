---
id: cr123-u10-step-column
lát: cr123-u10-step-column
cr: CR-123
làn: nhanh
migration: không
phụ thuộc: cr123-u9-plain-words
---
## Plan (ngắn)
Danh sách HĐ: cột "Bước" nói bước THẬT ("Chờ Trưởng phòng duyệt", "Chờ Giám đốc ký", "Đã duyệt", "Bị trả lại"…) thay "Chờ xác nhận" khi HĐ đang chờ ký. Lấy từ CÙNG đọc của thẻ duyệt (`stepsView`, Ký số đã gộp một bước ở u6) — một nguồn.

## Làm
- Hub engine: `stepsViewMany` (pack-runs-view.ts) — CÙNG `rowsSql` / `stepOf` / `collapseModuleSteps` với `stepsView`, cho NHIỀU run; ≤ 2 SQL cố định (một câu mọi run × stage × task, một câu tên người ký nếu có). Cầu `PackRunsPort.stepsViewMany`.
- Gói HĐ: luật thuần `stepLabelOf` (domain/approval-step-label.rules); câu SQL danh sách thêm cột `step_runs` (HĐ của trang ⇒ id run, một `json_agg` trong CÙNG câu danh sách); use case `listContracts` gọi MỘT lô nhãn cho cả trang và thêm ĐÚNG MỘT khoá `step_label` (ListRow 22 → 23 khoá; HĐ không có run ⇒ null).
- Web: ô "Bước" dùng `step_label` khi có, không thì nhãn trạng thái như cũ.

## Không làm / Chạm
Không canvas/*, esign, partner. Không migration, không cột tính sẵn.

## Test tối thiểu
unit `approval-step-label.rules.test.ts`, `list-contracts-step.usecase.test.ts`; perf int `pack-runs-steps-many.perf.int.test.ts` (1.000 run, trang 100); khoá test `tests/acceptance/HD1/list.int.test.ts` (23 khoá) + relock; journey e2e G2 chạy một lần + ảnh.

## Quyết định trong lúc làm
- "Một câu truy vấn": câu danh sách giữ MỘT câu (thêm `step_runs` bằng subquery trong cùng câu); nhãn lấy theo MỘT lô engine cho cả trang (≤ 2 SQL, không theo hàng) vì bước thật nằm ở bảng engine `hub.*` mà gói HĐ không đọc trực tiếp (biên module). Không dựng cột tính sẵn (cần migration + ghi ở mọi chuyển bước ⇒ hai nguồn).
- perf (đo thật, 1.000 run, trang 100, evotest): p50 15,4 ms · p95 27,9 ms · max 31,8 ms (ngưỡng 300 ms).
- `tests/acceptance/HD1/list.int.test.ts` ĐỎ sẵn ở nền (`platform/gd0`, 39 ca: "cannot truncate a table referenced in a foreign key constraint") ⇒ không kiểm được ở đây; khoá 23 khoá vẫn được kiểm ở unit use case + journey.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Danh sách hợp đồng
Cột "Bước" của danh sách hợp đồng nói bước thật của lượt duyệt bằng chữ nghiệp vụ (Chờ <tên bước>, Chờ <người ký> ký, Chờ gửi duyệt, Bị trả lại, Đã duyệt, Bị từ chối), lấy từ cùng đọc với thẻ duyệt; mỗi dòng danh sách có thêm đúng một khoá `step_label` (null ⇒ dùng nhãn trạng thái).
- Kịch bản: khi trang danh sách có HĐ ở các bước khác nhau thì mỗi HĐ nhận nhãn bước của chính nó qua MỘT lô cho cả trang [test: apps/hub-api/src/modules/packs/contracts/application/list-contracts-step.usecase.test.ts » một lô cho cả trang, hàng có run ⇒ nhãn, hàng không có run ⇒ null]
- Kịch bản: khi Ký số đang chờ thì nhãn là Chờ người ký ký, khi bước duyệt đang mở thì Chờ tên bước, khi xong thì Đã duyệt [test: apps/hub-api/src/modules/packs/contracts/domain/approval-step-label.rules.test.ts » Ký số đang chờ (cụm đã gộp một bước) ⇒ Chờ <người ký> ký, không biết người ký ⇒ Chờ ký]
- Kịch bản: khi lấy nhãn cho 100 HĐ trong 1.000 lượt thì số câu SQL cố định và p95 dưới 300 ms [test: apps/hub-api/src/modules/processes/runs/pack-runs-steps-many.perf.int.test.ts » trang 100 run trong 1000 run: một lô, p95 thấp (đo thật)]
- Kịch bản: khi nhân viên mở danh sách lúc HĐ chờ Kế toán và HĐ chờ Giám đốc thì thấy nhãn bước thật, không còn "Chờ xác nhận" chung [test: e2e/journey-approval/cr122-flows.spec.ts » G2 · tenant_admin: Sao chép → 3 lỗi 409 → sửa người duyệt → Xuất bản (gốc tự Tắt) → HĐ B theo bản công ty, HĐ A giữ bản cũ → Quay về bản gốc]

## Việc còn lại
HD1/list.int.test.ts đỏ sẵn ở nền ⇒ cần người sửa hạ tầng test (truncate FK) trước khi kiểm 23 khoá bằng HTTP thật.
