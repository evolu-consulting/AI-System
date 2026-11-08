---
id: cr122-e5d-expire-claim
lát: cr122-e5d-expire-claim
cr: CR-122
làn: đầy đủ (sửa Blocker soát E5–E5c: tác động ra nhà cung cấp, khoá/đồng thời — Opus low soát)
migration: gói contracts 0080 (idx 76, when 1806400000000)
phụ thuộc: E5c
---
## Plan (ngắn)
Huỷ phong bì quá hạn phải (B1) giành quyền bằng UPDATE có điều kiện trước khi gọi nhà cung cấp và (B2) chỉ chạm ĐÚNG phong bì đã quét. Kèm: validator cấu hình ký số chạy theo khoá tool.

## Làm
- Migration `0080_esign_expire_claim.sql`: `esign_envelopes.expire_claimed_at` (nullable, không backfill).
- `ESignRepo.claimExpire(id, now, leaseMin)`: MỘT UPDATE có điều kiện trên đúng `id` — còn mở, đã quá `due_h` lúc `now`, chưa ai giữ hoặc lease (10 phút) đã hết ⇒ trả hàng; ngược lại null. `esign-expire.ts`: giành quyền TRƯỚC `voidEnvelope`; chỉ bên giành được mới huỷ + bắn `esign.voided`; kiểm `contractId` khớp.
- `esign-sweep.repo.ts`: hàng quá hạn đang được giữ (lease chưa hết) không trả về; `esign-sweep.ts` truyền `envelopeId` + `now` (đồng hồ vòng quét) tới `expire`.
- Kit `nodeConfigRegistry.registerTool(toolKey, v)`: `check` chạy validator theo `node` HOẶC theo khoá tool của stage (cùng hàm không chạy hai lần); gói contracts đăng ký theo `contracts-esign-send` ⇒ def gọi thẳng tool không mang `node` vẫn bị kiểm lúc lưu.

## Không làm / Chạm
- Không đổi logic nhắc, nhánh quét `approvals`, engine. Huỷ hụt ở nhà cung cấp không nhả quyền sớm: chờ hết lease rồi tự thử lại (tránh gọi dồn khi nhà cung cấp lỗi).

## Test tối thiểu
- int `adapters/esign-expire-claim.int.test.ts` (3 ca), `defs/defs-node-config.int.test.ts` (+ca không `node`); unit `esign-node.validator.test.ts` (validator theo tool).

## Quyết định trong lúc làm
- Điều kiện "đã quá hạn" nằm TRONG câu UPDATE giành quyền (không tin tham số người gọi) ⇒ tham chiếu phong bì cũ/chưa tới hạn không huỷ được.
- Lease 10 phút (`ESIGN_EXPIRE_LEASE_MIN`); lượt quét chỉ trả hàng quá hạn không còn lease.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### ADDED current/pack-contracts/esign-expire-claim.md
#### Yêu cầu: Huỷ phong bì quá hạn chỉ một lần và đúng phong bì
Huỷ phong bì quá hạn của node Ký số giành quyền trước khi gọi nhà cung cấp, chỉ bên giành được mới huỷ và bắn esign.voided, và chỉ chạm đúng phong bì đã quét.
- Kịch bản: khi nhiều lượt cùng huỷ một phong bì thì nhà cung cấp bị gọi một lần và chỉ có một sự kiện [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-expire-claim.int.test.ts » nhiều lượt cùng huỷ một phong bì ⇒ nhà cung cấp bị gọi một lần, một sự kiện esign.voided]
- Kịch bản: khi gửi lại phong bì mới sau khi quét thì phong bì mới không bị huỷ nhầm [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-expire-claim.int.test.ts » gửi lại phong bì mới sau khi quét ⇒ phong bì mới không bị huỷ nhầm, tham chiếu cũ không chạm được]
- Kịch bản: khi tiến trình chết sau khi giành quyền thì hết lease lượt sau giành lại được [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-expire-claim.int.test.ts » tiến trình chết sau khi giành quyền ⇒ trong lease không ai huỷ, hết lease lượt sau giành lại]
#### Yêu cầu: Kiểm cấu hình ký số theo khoá tool
- Kịch bản: khi def gọi thẳng tool gửi ký không mang node thì vẫn bị kiểm lúc lưu [test: apps/hub-api/src/modules/processes/defs/defs-node-config.int.test.ts » E5d · def gọi thẳng tool gửi ký KHÔNG mang `node` vẫn bị kiểm (validator theo khoá tool)]

## Việc còn lại
- Nhả quyền sớm khi huỷ hụt có lỗi vĩnh viễn (nhà cung cấp trả 4xx) nếu cần ops-watch.
