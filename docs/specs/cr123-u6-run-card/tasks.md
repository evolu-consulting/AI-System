---
id: cr123-u6-run-card
lát: cr123-u6-run-card
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Gộp cụm stage node module ở `stepsView` (hub, MỘT nguồn) bằng `moduleClusters`; thẻ duyệt nhận `outcome` ⇒ một dòng "Ký số" + trạng thái.

## Làm
`processes/runs/pack-runs-modules.ts` (+ cột `consumed_event` trong câu SQL sẵn có, số câu SQL không đổi), `PackStepView.module`, thẻ engine `outcome`, `FlowStepView.outcome`, web `ModuleStepRow`.

## Không làm / Chạm
admin-web, esign provider/config, DLC, migration. Tên người ký: chưa (cần dữ liệu phong bì của gói).

## Test tối thiểu
unit `pack-runs-modules.test.ts`.

## Quyết định trong lúc làm
Stage chờ xong không có sự kiện tiêu thụ = hết hạn (timeout); sự kiện khớp `exits[].on` của node ⇒ nhánh đó, còn lại ⇒ xong.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Thẻ duyệt hiển thị Ký số là một dòng
Bước Ký số (gửi + chờ ký xong) hiện MỘT dòng "Ký số" với trạng thái Đang chờ ký · Đã ký · Từ chối · Hết hạn, không tách "Chờ ký xong".
- Kịch bản: khi cụm gửi+chờ ở trạng thái chờ/đã ký/từ chối/hết hạn thì thẻ có đúng một dòng Ký số với trạng thái tương ứng [test: apps/hub-api/src/modules/processes/runs/pack-runs-modules.test.ts » gửi + chờ = MỘT dòng 'Ký số' (không còn 'Chờ ký xong')]

## Việc còn lại
