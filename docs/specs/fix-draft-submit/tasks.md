# fix-draft-submit — HĐ nhập tay không có «Gửi duyệt» + xem trước luồng sai nhánh [CR-157][CR-160]

## Nguyên nhân thật (bản test, HĐ 01a1dae9…)
- HĐ tải tệp lên, AI đọc quá hạn (`TIMEOUT`) ⇒ lượt đọc `approvals.status = 'failed'` vẫn gắn `contracts.run_id`. Người dùng «Nhập tay» ⇒ `extract_state = ready` nhưng `run_id` còn dính.
- Thẻ duyệt trả `step = 'cancelled'` (≠ null) ⇒ web (`head-rule.ts`) coi là «bật duyệt cấp 1» (`off = false`) ⇒ `confirmSave = false` ⇒ chỉ còn «Lưu nháp», không câu giải thích. KHÔNG phải no_flow (quy trình pos1 không điều kiện ⇒ hasFlowFor = true), không phải deal rỗng (`deal` NULL chỉ làm chip hiện «Bán» mặc định; Gửi không đòi `deal`).
- Xem trước luồng: `outline` chỉ có dữ kiện của app (`readFacts`), thiếu dữ kiện LÕI `starter_is_top` (engine tự đọc lúc chạy) ⇒ node Nếu rẽ sai nhánh ⇒ vẫn hiện «Trưởng phòng duyệt · Chưa chọn người duyệt» cho người đứng đầu.

## Delta (so với docs/current)

Trạng thái gộp: chưa gộp

### MODIFIED web/hop-dong-review.md
#### Yêu cầu: Nháp lần đầu luôn có «Gửi duyệt» hoặc lý do vì sao không
Nháp lần đầu: lượt duyệt đã kết thúc (đọc AI hỏng / huỷ / xong) không tính là bật duyệt, nên «Gửi duyệt» bấm được. Không gửi được (chưa có quy trình, không phải người tạo/phụ trách, còn bước duyệt đang mở) thì «Gửi duyệt» vẫn là nút chính nhưng khoá, kèm lý do ngay cạnh nút; «Lưu nháp» và «Huỷ» nằm trong «Thao tác».
- Kịch bản: khi thẻ duyệt báo bước đã kết thúc thì «Gửi duyệt» vẫn bấm được [test: apps/workspace-web/src/features/contract-review/lib/head-rule.test.ts » thẻ duyệt báo bước đã kết thúc]
- Kịch bản: khi nháp lần đầu không gửi duyệt được thì «Gửi duyệt» là nút chính bị khoá kèm lý do [test: apps/workspace-web/src/features/contract-review/lib/head-rule.test.ts » headActs: không Gửi duyệt được; e2e/cr127/j14-chua-co-quy-trinh.spec.ts]

#### Yêu cầu: Chuyển sang nhập tay bỏ lượt đọc AI đã hỏng
Khi chuyển HĐ nháp đọc lỗi sang nhập tay, HĐ không còn gắn lượt đọc hỏng (lượt cũ giữ làm lịch sử) để thẻ duyệt không báo bước «huỷ».
- Kịch bản: khi người dùng chuyển sang nhập tay thì HĐ không còn gắn lượt đọc hỏng và Gửi duyệt được [test: apps/hub-api/src/modules/packs/contracts/adapters/manual-entry.int.test.ts » lượt đọc AI đã hỏng không còn gắn HĐ]

#### Yêu cầu: Xem trước luồng đi đúng nhánh theo người gửi
«Khi gửi, hợp đồng sẽ đi qua» tính dữ kiện lõi `starter_is_top` của người gửi: người đứng đầu sơ đồ thì bỏ bước duyệt của trưởng phòng; người khác thì vẫn nêu tên người duyệt.
- Kịch bản: khi người gửi là trưởng phòng gốc thì xem trước bỏ bước duyệt của trưởng phòng [test: apps/hub-api/src/modules/processes/library/flow-outline.int.test.ts » người gửi là trưởng phòng gốc]
- Kịch bản: khi người gửi thường thì xem trước vẫn có bước duyệt kèm tên người duyệt [test: apps/hub-api/src/modules/processes/library/flow-outline.int.test.ts » người gửi thường]

## Việc còn lại / báo
- HĐ đã hỏng sẵn trên bản test (run_id còn dính) hết lỗi nhờ sửa phía web, không cần backfill.
- `deal` NULL khi lưu nháp nhập tay (UI hiện «Bán» mặc định): chưa sửa, ngoài phạm vi.
