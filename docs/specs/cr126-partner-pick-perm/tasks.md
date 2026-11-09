---
id: cr126-partner-pick-perm
lát: cr126-partner-pick-perm
cr: CR-126
làn: nhanh
migration: không
phụ thuộc: cr126-partner-pick-engine
---
## Plan (ngắn)
Sửa theo soát Opus: (1) điền sẵn (đối tác + email) chỉ cho người quyết được bước form; (2) quy trình bật mà node chưa có nhóm phụ trách ⇒ chặn lưu.

## Làm
- `processes/runs/pack-runs-extra.ts` `withFormPrefill`: chỉ bước mở có `task.can_act === true` (thẻ HĐ / FlowTask lấy prefill từ đây ⇒ cùng được chặn).
- `processes/defs/def-group-bind.ts` `withNodeAssignee`: `enabled` + `nodeAssigneeNeeds` có nhóm trống ⇒ 422 `NODE_ASSIGNEE_MISSING` (câu «Chọn nhóm phụ trách gửi đối tác»).
  Readiness mẫu Thư viện (gán/sao chép/bật Đối tác) đã chặn nhóm trống từ lát trước (`READINESS_ASSIGNEE_MISSING`).

## Không làm / Chạm
Không e2e. Perf: không thêm câu SQL (kiểm can_act trên dữ liệu đã có).

## Quyết định trong lúc làm
- Nháp (chưa bật) vẫn lưu được khi chưa chọn nhóm — để người dùng thêm node rồi cấu hình sau.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/gui-doi-tac-xac-nhan.md
#### Yêu cầu: Điền sẵn và nhóm phụ trách của bước chọn người nhận
Danh sách đối tác + email điền sẵn chỉ gửi cho người quyết được bước; quy trình đang bật phải có nhóm phụ trách cho bước chọn người nhận.
- Kịch bản: khi người xem lượt không quyết được bước thì không nhận điền sẵn [test: apps/hub-api/src/modules/processes/runs/form-prefill-perm.test.ts » người xem không quyết được]
- Kịch bản: khi người được giao mở bước thì nhận điền sẵn [test: apps/hub-api/src/modules/processes/runs/form-prefill-perm.test.ts » người được giao]
- Kịch bản: khi lưu quy trình đang bật mà chưa chọn nhóm phụ trách thì bị chặn với câu chọn nhóm phụ trách gửi đối tác [test: apps/hub-api/src/modules/processes/runs/form-prefill-perm.test.ts » quy trình BẬT, chưa chọn nhóm]

## Việc còn lại
- Int đầy đủ qua `stepsView` (người xem vs người được giao) chưa viết — luật kiểm ở unit trên đúng hàm gắn prefill.
- e2e s7/q6 đỏ (lượt trước): có thể do mẫu Thư viện chưa có `assignee_group` ⇒ readiness mới chặn; điều phối kiểm ở lượt e2e.
