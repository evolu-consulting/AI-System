---
id: cr125-m10-switch-void-race
lát: cr125-m10-switch-void-race
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: cr125-m4-esign
---
## Plan (ngắn)
Wave review M3: webhook «voided» của phong bì CŨ chen giữa lúc đổi cách ký ⇒ lượt rời bước chờ / phong bì mới mồ côi. Sửa: lease đổi cách ký
đánh dấu `reason = 'switching'` (cột có sẵn, cùng `expire_claimed_at`); đồng bộ/webhook ghi bằng `syncUpdate` (UPDATE có điều kiện: còn đúng
trạng thái đã đọc, không đang đổi cách ký trong lease, là phong bì mới nhất của HĐ) — không thoả ⇒ chỉ audit, không tín hiệu. `voidClaimed`
trả false ⇒ dừng, không gửi lại.

## Làm
- [x] `esign.repo.ts` claimSwitch/releaseSwitch đặt/xoá `switching`; `syncUpdate` mới
- [x] `esign-sync-guard.ts` + `esign.usecase.ts` sync dùng guard; `esign-switch.ts` dừng khi voidClaimed false
- [x] int `esign-switch-webhook.int.test.ts`

## Không làm / Chạm
Không migration, không bảng mới, không UI.

## Test tối thiểu
evotest int (-Dirty): esign-switch-webhook, esign-switch, esign-sync, esign-push, esign-expire-claim ⇒ 8 pass.

## Quyết định trong lúc làm
- Audit sự kiện bị bỏ qua ghi `approval_settings_audit` (`esign_event_ignored`), actor = người gửi phong bì (webhook không có người dùng).
- Webhook lặp cho cùng phong bì: UPDATE có điều kiện theo trạng thái đã đọc ⇒ chỉ một lần tín hiệu.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr124-cr125)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Đổi cách ký không làm lượt rời bước chờ
Trong lúc đổi cách ký (giữ quyền đổi), sự kiện của phong bì cũ từ nhà cung cấp chỉ được ghi audit, không báo cho luồng; sau khi đổi xong chỉ sự kiện của phong bì mới báo cho luồng, mỗi sự kiện một lần.
- Kịch bản: khi webhook voided của phong bì cũ tới giữa lúc đổi cách ký thì luồng vẫn chờ phong bì mới và chỉ nhận đúng một sự kiện của phong bì mới [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-switch-webhook.int.test.ts » trong lease chỉ audit, không tín hiệu, sau khi đổi chỉ phong bì mới tới lượt, một lần]

## Việc còn lại
Không. L6 (wave review) đã sửa: `signed_at != null` ở `esign-switch.ts` + `esign-sweep.rules.ts` (khoá vắng = chưa ký), unit trong `esign-switch.test.ts`.
