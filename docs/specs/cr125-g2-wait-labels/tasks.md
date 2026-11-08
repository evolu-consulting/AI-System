---
id: cr125-g2-wait-labels
lát: cr125-g2-wait-labels
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Một nhãn chờ duyệt ("Đang chờ người duyệt", động từ Duyệt) cho trạng thái run, ghi chú bước, dòng thời gian; admin-web dịch bằng khoá i18n.

## Làm
- hub: `WAITING_REVIEW_TEXT` dùng chung ở run-log-text/run-timeline rules.
- admin-web: `runStatusLine` (RunHeader) dịch `waiting_review` bằng `process.run.line.reviewOther`.
- i18n run.vi: "Kiểm"→"Duyệt" (reviewMe/reviewOther/region/title/escalatedNote).

## Không làm / Chạm
Giữ "Kiểm ngay" (e2e khoá sdlc.pa.ts). chat-web không đổi code (đã dùng khoá run.line.*).

## Test tối thiểu
unit run-log-text.rules, run-timeline.rules, run-detail-view.

## Quyết định trong lúc làm
Không thêm truy vấn/trường contract; mã trạng thái = `run.status` có sẵn.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Nhãn chờ duyệt thống nhất
Trạng thái run, ghi chú bước và dòng thời gian cùng dùng một nhãn "Đang chờ người duyệt"; admin-web dịch trạng thái `waiting_review` bằng khoá i18n.
- Kịch bản: khi run ở waiting_review thì nhãn trạng thái và ghi chú bước giống nhau [test: apps/hub-api/src/modules/processes/domain/runs/run-log-text.rules.test.ts » CR-125 G2 · một nhãn chờ duyệt]
- Kịch bản: khi admin xem run waiting_review thì dòng trạng thái lấy từ khoá i18n [test: apps/admin-web/src/features/processes/lib/run-detail-view.test.ts » runStatusLine (CR-125 G2)]

## Việc còn lại
Không.