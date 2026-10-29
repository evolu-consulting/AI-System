---
id: fnr-fix-set
lát: fnr-fix-set
cr: CR-103
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa lỗi review CR-103 trên fnr-showcase: (1, Cao) node `set` luôn `done`, bỏ qua cổng duyệt; (2, Thấp) seed flow mẫu chèn thẳng bằng `insertDef`, bỏ qua kiểm/ép trường của API lưu.

## Làm
- [x] `nodes/set/launch.ts`: đi đường hậu-output như stage agent/tool/team (stage `queued`→`running`, `transition(stage_output)` + `effects`): `after: review` ⇒ `waiting_review` + task duyệt (nhắc/chuyển cấp/exclude_starter do `openReview` lo); `after: auto` ⇒ done + join, `more` = kick bước kế.
- [x] `runs/executor-ref.ts`: `set` có ExecutorRef cố định (thread/view không tra catalog agent/team bằng id `set`); `runs/team-load.ts`: `set` không đọc run_steps; `adapters/tools/tool-stage.repo.ts`: export `stateOf`.
- [x] Seed: `seed-flow-showcase.check.ts` (`checkShowcase`: contracts → `validateProcessDef` → `withHandoff`/`normalizeStage`); dry-run báo cả lỗi luật def (refs giả), `--apply` dùng `loadDefRefs` thật + chèn bản đã ép; cờ `--admin a,b` (mặc định `demo-owner`) thêm vào 3 Group duyệt bằng `grantGroup` (chế độ route admin: chỉ admin gọi `/review-tasks`).
- [x] Int: `tests/acceptance/fnr-showcase/set.int.test.ts` thêm ca set + review (task mở, stage chờ, 0 hub.runs; Đạt ⇒ bước kế chạy ⇒ run done).

## Không làm / Chạm
Không sửa luật state machine; không đổi contract; không chạy seed `--apply`.

## Test tối thiểu
Int 2 ca (auto + review) xanh; unit set/showcase giữ nguyên; tsc hub-api + tools/scripts sạch.

## Quyết định trong lúc làm
- Stage `set` chuyển `running` trong cùng tx trước khi nhận output (state machine chỉ nhận output từ stage đang chạy; không ai thấy trạng thái giữa).
- Seed nhóm duyệt: `grantGroup` (actor hệ thống, audit `membersAudit`) — user ngoài/không tồn tại ⇒ lỗi cả lô.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa lỗi review CR-103 — set + review phải mở cổng duyệt như yêu cầu ở fnr-showcase)