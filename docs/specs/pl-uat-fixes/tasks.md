---
id: pl-uat-fixes
lát: pl-uat-fixes
cr: CR-105
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa 4 lỗi nhỏ phát hiện khi UAT CR-105 (prod-like local) và chụp lại ảnh.

## Làm
1. **Thẻ duyệt thiếu nút "Đạt" ở bước duyệt cuối (contracts-web).** Nguyên nhân (đã tái hiện): sau khi bước trước Đạt/bỏ qua, engine mở bước kế (nằm sau nút `route`) BẤT ĐỒNG BỘ; thẻ tải lại ngay lúc đó thấy `steps[]` không có bước `open` ⇒ `engineApprovalView` trả không nút, và `useApproval` chỉ tự tải lại khi `step ∈ extract/value/finalize` ⇒ thẻ kẹt không nút cho tới khi F5 (UAT phải gọi API approve tay). Server (máy trạng thái run, quyền `can_act`) đúng: bước mở thì `can_act=true`, bước kế vẫn hiện nút. Sửa: `engineAdvancing()` (engine-card.ts) = lượt engine `level1`, có `steps[]`, chưa có bước `open`, không `needs_reopen` ⇒ tải lại mỗi 2 s + ghi chú "Đang chuyển sang bước duyệt kế tiếp…" (i18n vi/en). Bước 0 vẫn là "Xác nhận và lưu" (thiết kế cũ), bước ≥ 1 là Đạt/Trả lại/Từ chối.
2. **Cột "Số bước" đếm cả nút hệ thống (admin-web /processes).** Cột lấy `stage_count` = mọi stage (4 cho mặc định). Sửa ở nguồn danh sách: `defs.repo` thêm `slot_step_count` (stage có `slot.kind` review/dify); `listStepCount()` (defs.map) — def thư viện chỉ đếm bước duyệt (khớp "Bước n" trên Sơ đồ: mặc định 2, QT thử 3); def thường giữ tổng stage. Chỉ đổi giá trị hiển thị `stage_count` của danh sách; không đổi schema/contract/run.
3. **Bảng tràn ngang 1440px.** Bỏ cột "Dùng cho" (tên khe xuống dòng phụ dưới tên quy trình), huy hiệu "Mặc định" gọn (title đầy đủ), ô tenant `max-w-56` ellipsis, cột Thao tác `nowrap`. Đo: scrollWidth = clientWidth = 1440, không có vùng cuộn ngang.
4. **Xoá bị khoá không nói lý do.** `RowDeleteButton` (tooltip Radix quanh nút khoá) + `deleteLock()` ⇒ "Đang được N tenant dùng — bỏ gán trước khi xoá" (mặc định của khe: câu cũ). i18n `process.admin.library.inUse.assignedN`, `defaultTag` (vi/en).

## Không làm / Chạm
Không đổi server run/quyền/approve; không đổi route approval-flow; không chạy e2e (chưa sửa e2e/**, không cần `test:lock:write`).
Chạm: contracts-web contract-approval, admin-web processes, hub-api defs (list SQL/map), i18n contracts + process/admin.

## Test tối thiểu
- unit: `engine-card.test.ts` (bước cuối mở ⇒ Đạt; đang chuyển bước ⇒ ghi chú + `engineAdvancing`), `defs.map.test.ts` (đếm bước duyệt), `library-view.test.ts` (`deleteLock`).
- typecheck admin-web, contracts-web, hub-api.
- UAT trình duyệt thật local (DB `ai_system_uatfix_test`): ảnh trong `.data/cr105-uat-fix/`.

## Quyết định trong lúc làm
- Đếm bước tính ở SQL list (đã có `jsonb_array_elements`) thay vì client vì danh sách không mang stages; chỉ cho def có `slot`.
- Giữ nút Xoá/Nhân bản dạng nút trong dòng (e2e `process-library.pa.ts` còn đúng) thay vì gom vào menu "…".

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Thẻ duyệt tự cập nhật khi engine chuyển bước
Sau khi một bước duyệt Đạt/bị bỏ qua, nếu bước kế chưa mở thì thẻ hiện ghi chú "Đang chuyển sang bước duyệt kế tiếp…" và tự tải lại mỗi 2 giây tới khi bước mở; bước duyệt mở và người xem quyết được ⇒ hiện Đạt / Trả lại / Từ chối (kể cả bước duyệt thêm từ quy trình thư viện).
- Kịch bản: khi bước duyệt cuối mở và `can_act` thì có Đạt, không có Xác nhận [test: apps/workspace-web/src/features/contract-approval/lib/engine-card.test.ts » bước duyệt cuối (thêm từ quy trình thư viện) mở + can_act ⇒ Đạt, không Xác nhận]
- Kịch bản: khi bước trước đã Đạt mà bước kế chưa mở thì có ghi chú chuyển bước và tự tải lại [test: apps/workspace-web/src/features/contract-approval/lib/engine-card.test.ts » đang chuyển bước (đã Đạt, bước kế chưa mở) ⇒ chưa nút, có ghi chú + tải lại, mở xong ⇒ hết]

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Danh sách quy trình thư viện — Số bước, bố cục, lý do khoá Xoá
Cột "Số bước" chỉ đếm bước duyệt (khớp "Bước n" trên Sơ đồ, không đếm nút hệ thống route/finalize). Bảng vừa 1440px không cuộn ngang (tên khe ở dòng phụ dưới tên). Nút Xoá bị khoá hiện tooltip "Đang được N tenant dùng — bỏ gán trước khi xoá" (hoặc lý do mặc định của khe).
- Kịch bản: khi def thư viện có 2 bước duyệt + route + finalize thì Số bước = 2 [test: apps/hub-api/src/modules/processes/defs/defs.map.test.ts » def thư viện: 2 bước duyệt + route + finalize (4 stage) ⇒ 2]
- Kịch bản: khi quy trình đang được tenant dùng thì nút Xoá khoá kèm số tenant [test: apps/admin-web/src/features/processes/lib/library-view.test.ts » deleteLock: kèm số tenant để nêu lý do 'Đang được N tenant dùng']
- Kịch bản: khi mở danh sách ở 1440px thì không tràn ngang [test: thủ công — UAT trình duyệt đo scrollWidth = 1440, ảnh danh-sach-1440.png]

## Việc còn lại
e2e + test:all chạy một lần cuối đợt (chưa chạy trong lát). Tooltip Xoá sát mép phải ở 1440 (đọc được đủ; có thể đặt side="left" nếu muốn).
