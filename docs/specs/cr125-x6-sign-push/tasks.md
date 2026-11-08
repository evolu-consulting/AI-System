---
id: cr125-x6-sign-push
lát: cr125-x6-sign-push
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: cr125-x2-sign-card
---
## Plan (ngắn)
Thay poll 4 giây của thẻ ký số (x2) bằng ĐẨY từ hub (Luật 4c: không poll để chờ trạng thái). Phong bì đổi trạng thái (gửi, ký xong, từ chối, huỷ, hết hạn, đổi cách ký) ⇒ hub phát `esign.updated` `{contract_id, status}` lên `ustream:<user>` (kênh `/me/stream` sẵn có) cho người gửi + người ký công ty của HĐ; thẻ nghe và tải lại trạng thái ngay. Dự phòng duy nhất: tải lại khi quay lại cửa sổ.

## Làm
Contract `esign.updated` (`me-stream-process.ts`); `ESignRepo.watchers` (một câu, tenant của phong bì); `esignModule` `publish` + `changed` (gửi) + `onStatus` (mọi trạng thái cuối/huỷ); `mountEsignWebhook` nhận `redis`; web `esign-push.ts` + hook `use-esign` nghe stream, bỏ `refetchInterval`.

## Không làm / Chạm
Không migration; không đổi luồng ký; người xem không phải người gửi/ký vẫn thấy cập nhật khi quay lại cửa sổ (dự phòng).

## Test tối thiểu
Int `esign-push.int.test.ts` (Redis + DB thật: webhook/đồng bộ ⇒ chỉ người gửi/ký của đúng HĐ nhận); unit `esign-push.test.ts`; hành trình `journey-approval` một lần.

## Quyết định trong lúc làm
Người nhận lấy trong tx hệ thống của tenant phong bì (role job không đọc `signers` — giữ nguyên quyền hẹp của nó). Lỗi đẩy chỉ log, không làm hỏng luồng ký.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr124-cr125)

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Thẻ ký số tự cập nhật bằng sự kiện đẩy
Thẻ ký số của người gửi/người ký cập nhật trong khoảng một giây khi phong bì đổi trạng thái, nhờ sự kiện đẩy; không hỏi trạng thái định kỳ; quay lại cửa sổ thì tải lại một lần.
- Kịch bản: phong bì ký xong qua webhook/đồng bộ thì người gửi và người ký nhận sự kiện esign.updated, người khác thì không [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-push.int.test.ts » esign.updated chỉ tới người gửi và người ký của đúng HĐ]

