---
id: eng-review-fix
lát: eng-review-fix
cr: CR-107
làn: nhanh
migration: không
phụ thuộc: eng-card-ui, eng-links-race
---
## Plan (ngắn)
Sửa 4 phát hiện review cuối đợt CR-107 (1 TB + 3 Thấp).

## Làm
- [x] (TB) `/me/stream` qua cổng chat ở dạng LỌC (`chatRouteKind` = `stream`): công ty không có `chat-app` vẫn mở được stream nhưng chỉ nhận sự kiện quy trình (`ME_STREAM_PROCESS_EVENTS`); sự kiện phòng/run phòng bị bỏ ở phiên (`MeStreamOpen.allow`, mốc `#last` vẫn dời). Stream vốn theo `ustream:<user_id>` của chính người gọi ⇒ không mở rộng dữ liệu. Đối tác (external) vẫn bị `externalFirewall` chặn `/me/stream` (403) trước cổng chat.
- [x] contracts-web `process-stream`: 4xx trừ 408/429 ⇒ dừng nối lại (`isFatalStreamError`); lưới tải lại `advanceDelay` bỏ trần 10 lần, giữ 30 s (react-query không poll khi tab ẩn; chỉ khi đang chuyển bước, không `attention`).
- [x] `attach` run mới ⇒ xoá `pending_links/claim/by/task/at`.
- [x] `claim` cho chính người giữ (`pending_by`) giữ lại cùng task; người khác vẫn thua.
- [x] Journal gói contracts nhảy idx 63→65 (`0069_eng_links_claim`, không có 0068): Drizzle chỉ đọc `tag`/`when`/hash (không dùng `idx`), migrate-guard cũng vậy ⇒ hợp lệ trên DB sạch và DB đang ở 0067 (đã kiểm `journalDrift` = [] cả hai). Không đổi số.

## Không làm / Chạm
Không đổi contract, không migration, không đổi luật đối tác.

## Test tối thiểu
unit `chat-gate.rules.test.ts`, `advance-wait.test.ts`; int `chat-gate.int.test.ts`, `tests/acceptance/CF/approval-links-race.int.test.ts`.

## Quyết định trong lúc làm
- Lọc thay vì mở hẳn: sự kiện phòng là Chat AI ⇒ vẫn ẩn với công ty không có `chat-app`.
- Giữ lại của chính người giữ: hai tab cùng người bấm Đạt song song có thể làm lần thua trả chỗ (xoá SP chờ của lần thắng nếu finalize chưa đọc) — chấp nhận (cùng người, UI đã chặn bấm đúp).
- Migration gói contracts kế tiếp phải dùng `when` > 1800150000000 (số file 0068 được, guard bắt nếu `when` nhỏ hơn).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Thẻ duyệt chờ engine bằng push, không poll vô hạn
Hub cho công ty không có Chat AI mở `/me/stream` nhưng chỉ phát sự kiện quy trình của chính user. Thẻ duyệt dừng nối lại stream khi gặp 4xx (trừ 408/429); lưới tải lại giãn dần 2·4·8·16 s rồi giữ 30 s, không dừng sau 10 lần, chỉ khi đang chuyển bước và không có `attention`.
- Kịch bản: khi công ty bị thu hồi chat-app mở /me/stream thì nhận process.updated của mình, không nhận sự kiện phòng hay của người khác [test: apps/hub-api/src/modules/chat-gate/chat-gate.int.test.ts » CR-107 · công ty bị thu hồi mở /me/stream]
- Kịch bản: khi GET /me/stream thì cổng phân loại stream và chỉ cho sự kiện quy trình nếu không có Chat AI [test: apps/hub-api/src/modules/chat-gate/chat-gate.rules.test.ts » CR-107 · GET /me/stream ⇒ stream]
- Kịch bản: khi stream trả 4xx thì dừng nối lại, 408/429/5xx thì nối lại [test: apps/workspace-web/src/features/contract-approval/lib/advance-wait.test.ts » isFatalStreamError]
- Kịch bản: khi chờ chuyển bước thì độ trễ 2·4·8·16·30 s rồi giữ 30 s [test: apps/workspace-web/src/features/contract-approval/lib/advance-wait.test.ts » advanceDelay]

#### Yêu cầu: Giữ chỗ Đạt duyệt cuối
Chính người đang giữ chỗ được giữ lại cùng task (người khác vẫn bị chặn tới khi trả chỗ hoặc quá 15 phút); gắn run mới xoá chỗ giữ và SP chờ của run cũ.
- Kịch bản: khi người giữ bấm lại cùng task thì giữ được, người khác thì không; attach run mới thì pending_* null [test: tests/acceptance/CF/approval-links-race.int.test.ts » review CR-107: chính người giữ giữ lại được]

## Việc còn lại
- relock `tests/.lock` cho `tests/acceptance/CF/approval-links-race.int.test.ts` (qc).
