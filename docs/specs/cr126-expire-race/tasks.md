---
id: cr126-expire-race
lát: cr126-expire-race
cr: CR-126
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
P1-48e (lock-order.int) đỏ chập chờn: apply thắng ⇒ run `waiting_review` với `expires_at` đã qua, sweep kế KHÔNG hết hạn.
Nguyên nhân: sau COMMIT apply, `postThread(runId)` đăng tin thread, mỗi tin một tx khoá run `FOR SHARE` (`lockEventRun`).
`claimExpired` khoá `FOR UPDATE SKIP LOCKED` ⇒ xung đột `FOR SHARE` ⇒ bỏ qua đúng run đó trong lượt sweep chạy trùng lúc poster.

## Làm
- `runs/expire.ts` `claimExpired`: `for update skip locked` → `for no key update skip locked` (UPDATE không đổi khoá chỉ cần NO KEY UPDATE;
  vẫn bỏ qua run tx quy trình giữ `FOR UPDATE`).
- `core/core.repo.ts` `lockEventRun`: `for share` → `for key share` (đúng khoá FK `room_messages.process_run_id` lấy sớm; chỉ `FOR UPDATE`
  chặn được ⇒ thứ tự run → rooms của RA-01 giữ nguyên; tx giữ NO KEY UPDATE không chặn FK nên không chu trình).

## Không làm / Chạm
Không đổi test, không migration. Chạm: `apps/hub-api/src/modules/processes/runs/expire.ts`, `apps/hub-api/src/modules/processes/core/core.repo.ts`.

## Test tối thiểu
evotest int: lock-order (4 lượt xanh sau sửa, 1 lượt đỏ trước sửa), thread-poster, pf1/pf2 thread, expire-load, review-tasks.lock-order,
HD4 locks, P-b2 race, subprocess, hub-uow — xanh.

## Quyết định trong lúc làm
- Sửa ở khoá (nguồn duy nhất) thay vì thêm vòng thử lại trong `expireRuns`: hết hạn không còn bị chặn bởi khoá chỉ đọc (poster, chèn FK,
  vòng nhắc `FOR KEY SHARE`), vẫn nhường tx đang đổi trạng thái run.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-09 (đợt cr126-wave)

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Lượt quá hạn hết hạn ở lượt quét kế dù tin thread đang đăng
Lượt quá hạn (`expires_at` đã qua) chỉ được để lượt sau khi một thao tác đang đổi trạng thái lượt giữ nó; việc đăng tin thread hay chèn
dữ liệu con của lượt không làm lượt quét hết hạn bỏ qua lượt đó.
- Kịch bản: khi bước vừa xong chuyển lượt quá hạn sang chờ duyệt (tin thread đang đăng) thì lượt quét kế đặt lượt thành hết hạn [test: tests/acceptance/P-a/pf1/lock-order.int.test.ts » P1-48e · ×20: job stage xong (apply) ∥ sweepOnce (hết hạn) ⇒ cuối cùng expired]

## Việc còn lại
Không.
