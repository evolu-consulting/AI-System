---
id: cr122-e5c-esign-sweep
lát: cr122-e5c-esign-sweep
cr: CR-122
làn: nhanh (migration chỉ thêm cột; vòng quét + huỷ phong bì ⇒ Opus low soát)
migration: gói contracts 0079 (idx 75, when 1806300000000)
phụ thuộc: E5b (21652e992)
---
## Plan (ngắn)
Thêm nhánh quét theo PHONG BÌ cho node Ký số (HĐ không có bước Ký số kiểu cũ): nhắc đúng chu kỳ, không gửi trùng, quá hạn ⇒ huỷ phong bì + bắn `esign.voided` cho lượt đang chờ. Đường quét theo `approvals` giữ nguyên.

## Làm
- Migration `0079_esign_envelope_sweep.sql`: `esign_envelopes.reminded_at`, `expired_at` (nullable, không backfill).
- `esign-sweep.repo.ts` `esignEnvelopeSweep`: MỘT câu CTE cho cả lô (`FOR UPDATE SKIP LOCKED`, ≤ limit): phong bì `sent|delivered` có `due_h`/`remind_every_h`, mốc gửi `created_at`; loại phong bì mà HĐ còn bước Ký số kiểu cũ (nhánh `approvals` lo). Nhắc khi `max(gửi, nhắc cuối) + chu kỳ ≤ now` ⇒ ghi `reminded_at` (quét lại không trùng); quá hạn ⇒ ghi `expired_at` lần đầu (`first` ⇒ chuông một lần), quá hạn thì không nhắc nữa.
- `esign-sweep.ts`: gọi nhánh phong bì cùng tx (một câu thêm) + chuông (người ký công ty chưa ký khi tới lượt / người phụ trách khi chờ đối tác / quá hạn ⇒ người phụ trách); sau tx `d.expire` (song song ≤ 4) cho HĐ quá hạn.
- `esign-expire.ts` + `esign-void.ts` `voidForExpiry`: huỷ ở nhà cung cấp OK ⇒ `voided` (reason `esign-expired`) rồi hook `onStatus` ⇒ `esign.voided` vào lượt (cùng đường webhook ⇒ `wait_event` rẽ nhánh `voided`); huỷ hụt ⇒ giữ mở, vòng sau thử lại (không chuông lặp).

## Không làm / Chạm
- Không đổi nhánh quét `approvals`, luật thuần `esign-sweep.rules.ts`, engine/wait_event (rẽ nhánh `esign.voided` do E3 đã có int).
- Không có sự kiện `timeout` riêng cho Ký số: hết hạn = huỷ phong bì ⇒ `voided` (khớp `also_events` của node); `timeout_h` của stage chờ vẫn là lưới an toàn nếu vòng quét tắt.

## Test tối thiểu
- int `adapters/esign-sweep-node.int.test.ts` (DB thật + nhà cung cấp giả + đồng hồ giả): nhắc đúng một lần mỗi chu kỳ, quét hai lần liền nhau không trùng, quá hạn ⇒ huỷ + `esign.voided` + không lặp.

## Quyết định trong lúc làm
- Mốc gửi = `esign_envelopes.created_at` (phong bì tạo lúc gửi). `reminded_at`/`expired_at` ghi bằng `now` của vòng quét (tham số) ⇒ test đồng hồ giả.
- Quá hạn trả hàng mỗi vòng tới khi phong bì thôi mở (huỷ hụt ⇒ thử lại), chuông chỉ ở lần đầu (`expired_at` null).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED current/pack-contracts/esign-node-sweep.md
#### Yêu cầu: Vòng quét nhắc và hết hạn theo phong bì của node Ký số
Phong bì mở của node Ký số (không có bước Ký số kiểu cũ) được nhắc đúng chu kỳ, không nhắc trùng, và quá hạn thì bị huỷ và bắn esign.voided cho lượt đang chờ.
- Kịch bản: khi đủ chu kỳ nhắc thì nhắc một lần và ghi mốc nhắc, chưa đủ chu kỳ thì không nhắc [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-sweep-node.int.test.ts » nhắc đúng MỘT lần mỗi chu kỳ (nhắc mỗi 2h, hạn 48h)]
- Kịch bản: khi quét hai lần liền nhau cùng thời điểm thì không nhắc và không chuông trùng [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-sweep-node.int.test.ts » quét hai lần liền nhau cùng thời điểm ⇒ không nhắc / chuông trùng]
- Kịch bản: khi quá hạn thì huỷ phong bì và bắn esign.voided một lần, quét lại không lặp [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-sweep-node.int.test.ts » quá hạn ⇒ huỷ phong bì + bắn esign.voided cho lượt, chuông một lần, quét lại không lặp]

## Việc còn lại
- Chuỗi i18n chuông/nhãn "quá hạn" của node ở UI; ops-watch đếm phong bì mở quá hạn mà huỷ hụt liên tục (nếu cần).
