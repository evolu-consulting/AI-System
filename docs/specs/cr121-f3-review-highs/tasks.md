---
id: cr121-f3-review-highs
lát: cr121-f3-review-highs
cr: CR-121
làn: đầy đủ (máy trạng thái run + idempotency)
migration: không
phụ thuộc: cr121-r1-run-control, cr121-d6-notify-node
---
## Plan (ngắn)
Sửa 2 High của review cuối đợt CR-121.

## Làm
1. `canRerunStep` nhận `packBound`: run gắn gói ĐÃ KẾT THÚC ⇒ chặn; service trả 409 `PROCESS_RUN_STATE` `{pack_bound:true}`.
   Câu lỗi `process.admin.runDetail.err.packBound` (vi/en) nói dùng "Mở lại quy trình" của gói, áp cho cả chạy lại lượt và chạy lại bước.
2. Khoá dedup node notify thêm `round`: `pn:<run>:<stage run>:<round>:<attempt>`. `resetStage` giữ id, `attempt = 1`, tăng `round` ⇒ mỗi vòng gửi đúng 1 lần.

## Không làm / Chạm
Không đổi UI (admin-web đã map 409 `pack_bound` ⇒ câu `packBound`). Run gói CHƯA kết thúc vẫn chạy lại bước được (giữ hành vi).

## Test tối thiểu
- unit: `run-control.rules.test.ts`, `nodes/notify/notify.rules.test.ts`.
- int: `tests/acceptance/CR-121/notify-node.int.test.ts` (2 ca F-3, đỏ ở fe3d6ab5 trước khi sửa).

## Quyết định trong lúc làm
- Thông báo cũ (khoá không có round) không cần backfill: khoá mới khác dạng nên không đụng khoá cũ.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Chạy lại bước không áp cho lượt gắn gói đã kết thúc
Lượt gắn bản ghi gói (vd duyệt hợp đồng) đã kết thúc thì quản trị không chạy lại bước ở trang lượt chạy; trả 409 kèm `pack_bound` và câu hướng dẫn dùng "Mở lại quy trình" của gói.
- Kịch bản: khi platform_admin chạy lại bước của lượt gắn gói đã xong thì 409 `pack_bound`, bước không mở lại, không gửi gì thêm [test: tests/acceptance/CR-121/notify-node.int.test.ts » F-3 · run gắn gói đã kết thúc: platform_admin chạy lại bước ⇒ 409 pack_bound, không mở lại bước]
- Kịch bản: khi lượt gắn gói còn đang chạy thì vẫn chạy lại bước được [test: apps/hub-api/src/modules/processes/domain/runs/run-control.rules.test.ts » Chạy lại bước: bước lỗi/xong, run đã dừng/hết hạn ⇒ không]

#### Yêu cầu: Node Thông báo gửi mỗi vòng một lần
Khoá chống gửi trùng gồm (run, stage run, vòng, lần thử). Trả lại hay chạy lại bước sang vòng mới thì gửi lại đúng 1 lần; retry/sweep trong cùng vòng thì không gửi lần 2.
- Kịch bản: khi chạy lại bước Thông báo (vòng 2) thì người nhận có thêm đúng 1 thông báo với khoá khác [test: tests/acceptance/CR-121/notify-node.int.test.ts » F-3 · chạy lại bước Thông báo (vòng 2, attempt về 1) ⇒ gửi thêm đúng 1 lần, vòng 1 không bị nuốt]

## Việc còn lại
Không.
