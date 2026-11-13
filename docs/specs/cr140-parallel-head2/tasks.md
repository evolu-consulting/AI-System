# cr140-parallel-head2 — 3 Minor sau review lát cr140-parallel-head

- [x] 1. `parallelStageIssues`: bước «cùng duyệt» còn `group_id` riêng ⇒ `PARALLEL_RULE_INVALID`; editor (admin-web `stage-convert.ts#reviewGroupToDef`) gửi `group_id: null` khi bật cùng duyệt.
- [x] 2. Hiển thị: `approverFieldsOf` (thẻ HĐ) và `flow-preview.rules#gateOf` truyền nhóm của thẻ/nhánh vào `headGate`.
- [x] 3. Xem trước luồng: nhánh head_only mà nhóm chưa có trưởng ⇒ cảnh báo `no_head` «Nhóm X chưa có trưởng phòng — cả nhóm sẽ duyệt được.» (không chặn); bước song song không còn báo nhầm «chưa chọn phòng duyệt».

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED engine/duyet-cung-luc.md
#### Yêu cầu: Nhánh «cùng duyệt» chỉ trưởng phòng
Bước «Duyệt cùng lúc nhiều nhóm» không có nhóm riêng của bước (`group_id` phải `null`, nhóm nằm trong `parallel.groups`), lưu sai ⇒ `PARALLEL_RULE_INVALID`. Thẻ của nhánh bật «Chỉ trưởng phòng duyệt» hiện tên trưởng phòng nhóm đó. Xem trước luồng cảnh báo (không chặn) khi nhánh bật cờ mà nhóm chưa có trưởng phòng.
- Kịch bản: bước cùng duyệt còn nhóm riêng bị từ chối khi lưu [test: apps/hub-api/src/modules/processes/gates/parallel-approve.test.ts » CR-140 · bước «cùng duyệt» còn `group_id` riêng ⇒ RULE_INVALID]
- Kịch bản: thẻ nhánh hiện tên trưởng phòng [test: apps/hub-api/src/modules/processes/domain/runs/pack-steps.rules.test.ts » CR-140 · approverFieldsOf thẻ «cùng duyệt»]
- Kịch bản: cảnh báo nhóm chưa có trưởng [test: apps/hub-api/src/modules/processes/domain/preview/flow-preview.test.ts » CR-140 · nhánh «cùng duyệt» head_only, nhóm chưa có trưởng ⇒ cảnh báo, không báo «chưa chọn phòng»]

Có chủ ý (không đổi): Group «cũng quyết» (`also_group_ids`) và nhóm «Quá hạn chuyển cho» (chuyển cấp) vẫn bỏ qua cửa trưởng phòng — thành viên các nhóm này quyết được kể cả khi bước/nhánh bật `head_only`.

Quyết định trong lúc làm:
- Cảnh báo dùng khuôn sẵn của xem trước luồng (mã `no_head`, `PreviewWarning`); không thêm cảnh báo riêng ở API lưu/kích hoạt.
- Xem trước luồng chưa mô phỏng từng nhánh song song (người nhận việc theo nhánh) — chỉ thêm cảnh báo; ghi Việc còn lại.

## Việc còn lại
- Xem trước luồng: liệt kê người nhận việc theo từng nhánh «cùng duyệt» (hiện bước song song không có người nhận ⇒ có thể báo «chưa có ai nhận việc»).
- Def công ty đã lưu trước đây có `parallel` + `group_id` khác null: lưu lại qua editor sẽ tự về null; lưu bằng API thô sẽ bị 422.
