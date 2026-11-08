---
id: eng-links-race
lát: eng-links-race
cr: CR-107
làn: nhanh
migration: pack_contracts 0069_eng_links_claim
phụ thuộc:
---
## Plan (ngắn)
Lỗi (đã xác nhận trong code): `pass()` duyệt cuối ghi `pending_links` TRƯỚC `act`, câu UPDATE không gắn người/task. Hai người cùng
Đạt bước cuối: B ghi đè SP của A, hoặc B nhận "đã đóng" rồi ghi null ⇒ xoá SP của A trước khi `contracts-finalize` đọc ⇒ HĐ duyệt
thiếu/sai SP. Sửa: biến chỗ `pending_links` thành **chỗ giữ một người một lúc** gắn (lần bấm, người, task).

## Làm
- [x] Test int tái hiện (đỏ trước): hai lần Đạt song song (Promise.all, 2 kết nối pool thật), cổng engine thật chỉ chặn `act` bằng tín hiệu.
- [x] Migration `0069_eng_links_claim`: cột `pending_claim uuid`, `pending_by uuid`, `pending_task text`, `pending_at timestamptz` (chỉ thêm; RLS FORCE của bảng giữ nguyên).
- [x] Repo `setPendingLinks(aid, run, op)`: `op.links` ⇒ giữ chỗ + ghi SP; `op.release` ⇒ trả chỗ so-rồi-xoá theo `pending_claim`.
- [x] `pass()` thẻ engine: mã `claim` ngẫu nhiên mỗi lần bấm; giữ chỗ thất bại ⇒ `APPROVAL_NOT_OPEN`, KHÔNG gọi `act`; act lỗi/not_open ⇒ trả chỗ của chính lần bấm.

## Không làm / Chạm
- Không sửa `approval-engine.usecase.ts` (finalize vẫn đọc `pending_links` qua `byRun` — giờ luôn là SP của người giữ chỗ), rules, sweep, registry.
- Chạm: `approval-engine-card.usecase.ts`, `approval-engine.repo.ts`, `approval-engine.ports.ts` (kiểu op), migration 0069, unit test thẻ, int test mới.

## Test tối thiểu
- Unit `approval-engine-card.usecase.test.ts`: trả chỗ đúng (claim, người, task); bị người khác giữ ⇒ APPROVAL_NOT_OPEN, không act.
- Int `tests/acceptance/CF/approval-links-race.int.test.ts`: đua hai người ⇒ HĐ active, item gắn đúng SP người thắng.

## Quyết định trong lúc làm
- **Giữ chỗ thay vì lưu SP theo từng người.** Finalize chỉ biết `lastApprover` và đang ở file không được sửa; lưu map theo người cần
  finalize chọn theo người ⇒ ngoài phạm vi. Giữ chỗ: chỉ người giữ chỗ được gọi `act` trên task cuối ⇒ SP trong `pending_links` luôn
  là của người có thể thắng; người thua bị chặn TRƯỚC `act` nên không ghi đè, không xoá.
- **Vì sao không đua:** giữ chỗ là MỘT câu UPDATE có điều kiện trên hàng lượt; hai lần giữ song song ⇒ lần sau chờ khoá hàng, Postgres
  xét lại WHERE trên bản mới (đã có `pending_claim` khác, cùng task, còn hạn) ⇒ 0 hàng. Trả chỗ so `pending_claim = mã lần bấm` ⇒ không
  bao giờ xoá chỗ của lần bấm khác (kể cả cùng người bấm đúp).
- **Được giữ đè khi:** chưa ai giữ; người giữ ở task KHÁC (chỉ có một task mở mỗi bước — thấy task mới ⇒ task cũ đã đóng ⇒ `act` của
  người giữ cũ không thắng được); hoặc chỗ giữ quá 15 phút (người giữ chết giữa giữ chỗ và trả chỗ; một `act` chỉ tốn mili-giây).
- Cùng người bấm đúp: lần sau bị chặn (APPROVAL_NOT_OPEN), lần đầu chạy tiếp — không xoá SP lẫn nhau.
- Không có quorum nhiều task trên một bước (engine một task review/bước, cả Group dùng chung) ⇒ cùng task = cùng chỗ giữ.
- Migration idx 65 / `when` 1800150000000 (0068 giữ cho lát khác).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Đạt bước cuối kèm gắn SP an toàn khi nhiều người bấm cùng lúc
Đạt bước cuối giữ chỗ `pending_links` gắn (lần bấm, người, task) trong tx gói trước khi `act`; người khác Đạt cùng task trong lúc đó bị
chặn trước `act` (`APPROVAL_NOT_OPEN`); act thất bại chỉ trả đúng chỗ của lần bấm đó. `contracts-finalize` áp đúng SP của người thắng.
- Kịch bản: khi hai người cùng Đạt bước cuối với SP khác nhau thì HĐ duyệt với đúng SP của người thắng, lỗi của người thua không xoá SP [test: tests/acceptance/CF/approval-links-race.int.test.ts » hai người Đạt cùng lúc, SP khác nhau ⇒ HĐ duyệt với ĐÚNG SP của người thắng]
- Kịch bản: khi người khác đang giữ chỗ cùng task thì Đạt trả APPROVAL_NOT_OPEN và không gọi engine; act lỗi thì trả chỗ đúng lần bấm [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-card.usecase.test.ts » CR-107 · trả chỗ đúng lần giữ và chặn khi người khác giữ (không act)]

## Việc còn lại
- Ngoài phạm vi (có từ trước): Đạt bước cuối qua màn engine chung (không qua thẻ) vẫn áp `pending_links` của người đang giữ chỗ nếu có.
