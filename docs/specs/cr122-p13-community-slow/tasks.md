---
id: cr122-p13-community-slow
lát: cr122-p13-community-slow
cr: CR-122
làn: đầy đủ (trạng thái bài chờ duyệt)
migration: không
phụ thuộc: cr122-p11-first-launch
---
## Plan (ngắn)
Chẩn đoán + sửa: e2e `flows.cs.ts › 3` bước duyệt bài của flow `post.created` mở rất chậm (chờ tới ~200 s, trước đó API trả
`FLOW_TASK_NOT_OPEN`). Hỏi: community có cùng kiểu lỗi #4 (p11) không?

## Bằng chứng (code + int, không đoán)
Đường đi: `post.service.create` (cờ bật: `emitEvent` CÙNG tx, KHÔNG `startScreen`) → `hub.flow_events` → `dispatchOnce`
(`dispatcher.ts`) → `flowLaunchOf` (`flow-launch.ts`) → `StartService.createFromApi` → kick bước đầu.
- Phía engine KHÔNG chậm: int đỏ-trước-sửa cho thấy MỘT `dispatchOnce` ⇒ `launched 1`, run gắn bản ghi (`pack_record_id`), task Duyệt
  (`hub.review_tasks` open) có ngay. Không vòng nền/backoff/timer nào chen; không có node AI screen trong def này.
- Phía Community chậm: cờ bật ⇒ bài `moderation = pending, mod_screen = 'running'` (`openModeration`) nhưng agent screen cũ KHÔNG chạy
  (flow thay). `awaitingReview` (`domain/flow.rules.ts`) với `running` chỉ true khi quá `SCREEN_STALE_MS` = 2 phút ⇒ hàng đợi/nút Duyệt
  không mở, `decide` ⇒ `NOT_OPEN` ⇒ `FLOW_TASK_NOT_OPEN` (409). Quá 2 phút + vòng tải lại của e2e ⇒ ~120-200 s.
- Cùng họ lỗi #4: lượt do bộ điều phối mở không được gắn/báo cho bản ghi app (community chưa dùng `OutcomeHandler.launched` của p11).
  Khác: bài không bị gắn sai máy (không có thẻ máy cũ), chỉ "chờ hết hạn" thay vì "chờ flow mở".
- Đỏ trước sửa (evotest int, 2/2 đỏ): `awaitingReview` = false sau `dispatchOnce` dù task engine đã mở.

## Sửa
- `adapters/flow-ports.ts`: `communityOutcomeHandler().launched` (cho `post.created`) ⇒ `flow-events.repo.openReviewForFlow`: CÙNG tx tạo
  run, `mod_screen: running → null` (CAS `moderation = pending and mod_screen = running`, một câu, idempotent).
- `domain/flow.rules.ts` `awaitingReview`: `pending` + `mod_screen = null` ⇒ chờ người duyệt ngay (trước: không có trạng thái này).

## Chủ ý thiết kế / còn lại (ghi rõ)
- Cờ TẮT (đường khe cũ): agent `community-screen` chạy trước Duyệt là CHỦ Ý thiết kế (CR-120); chờ = thời gian agent (timeout 30 s,
  lỗi/UNAVAILABLE ⇒ vào duyệt ngay, treo ⇒ 2 phút). Không đổi ở lát này. Chưa có trace e2e cho biết ca 3 chạy cờ bật hay tắt
  (e2e không bật cờ; gán qua khe `process_tenant_defs`) ⇒ qc cần xem `flow_triggers` của công ty e2e khi chạy lại.
- Cờ BẬT: người duyệt duyệt ở Community qua `decide` (máy bài); task Duyệt của run trong hub vẫn mở, kết cục flow sau đó ⇒
  `already_applied` (OutcomeHandler CAS). Hợp nhất 2 nơi quyết (decide qua task engine như thẻ HĐ p11) là lát sau.
- Bài mở trước khi cập nhật này (đang `running` mà đã có run): hết hạn 2 phút như cũ (không backfill; dữ liệu chuyển tiếp ngắn).

## Test
- `packs/community/adapters/community.flow-launch.int.test.ts` (evotest int, xanh 2/2): route đăng bài → một `dispatchOnce` thật ⇒ task
  Duyệt (hub) mở + `awaitingReview` true + `decide` 200; perf đăng bài → task mở ≤ 5 s (đo 40 ms ở `*Once`, không ngủ).
- `domain/flow.rules.test.ts` (+1 ca). Không hồi quy: `community.flow-events.int`, `community.flows.int` xanh (25 ca).

## Quyết định trong lúc làm
- Không migration: dùng `mod_screen = null` (CHECK 0008 cho phép; trigger chỉ chặn đối tác, hook chạy vai hệ thống/gói).
- Không đổi cờ TẮT, không đổi SCREEN_STALE_MS (an toàn khi agent treo).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Duyệt bài khi công ty bật flow theo sự kiện
Công ty bật FLOW_TRIGGERS và gán flow `post.created`: ngay khi bộ điều phối mở lượt, bài vào hàng "chờ người duyệt" (không đợi hết hạn
agent sàng lọc 2 phút); người duyệt duyệt được ngay. Chưa có lượt mở thì bài vẫn "đang xử lý".
- Kịch bản: đăng bài, một lượt điều phối ⇒ task Duyệt mở và người duyệt duyệt được [test: thủ công — file test community.flow-launch.int.test.ts không còn trong repo]
- Kịch bản: sự kiện tới task mở ≤ 5 s [test: thủ công — file test community.flow-launch.int.test.ts không còn trong repo]
- Kịch bản: bài chờ không screen (flow đã mở lượt) ⇒ chờ người duyệt ngay [test: apps/hub-api/src/modules/packs/community/domain/flow.rules.test.ts » CR-122 P13 · pending + không screen (flow đã mở lượt) ⇒ chờ người duyệt ngay, không đợi quá hạn]

## Việc còn lại
- [ ] qc chạy lại `community-web-stack` (ca flows.cs.ts › 3) một lần cuối đợt; xác nhận cờ của công ty e2e.
- [ ] Lát sau: quyết duyệt bài qua task engine (một nơi quyết), như thẻ HĐ p11.
