---
id: cr140-payment-ledger
cr: CR-140
lane: Sonnet + soát Opus (ghi sổ thanh toán, khoá đồng thời, cách ly công ty) · không UI · không migration
---
# CR-140 · Bước 11 «Đã chi» ghi vào sổ thanh toán của HĐ

## Plan ngắn
| Phần | Làm |
|---|---|
| Node | `contracts.record-payment` «Ghi thanh toán vào HĐ» (`packages/contracts/src/modules/contracts/record-payment/`): luật thuần `planRecordPayment` / `pickContract`. |
| Tool | `contracts-record-payment` (`apps/hub-api/.../contracts/adapters/record-payment.{tool,repo}.ts`): ghi MỘT dòng `contracts.obligations` (kind payment, hướng pay, đã xong) + sổ đối tác + nhật ký HĐ; không bảng/migration mới. |
| Cổng engine | `PackRunsPort.stepContext` (`processes/runs/pack-run-record.ts`): HĐ gắn trong CÂY lượt, người đóng việc gần nhất, lượt có node này. |
| Seed | `seed-purchase-flow.data.ts`: bước `11-ghi-so-hd` sau `11-thanh-toan` (số tiền bước 10, ngày chi bước 11). |

## Quyết định trong lúc làm
| # | Quyết định | Lý do |
|---|---|---|
| 1 | Đồng thời: `pg_advisory_xact_lock(công ty, lượt)` ở câu riêng rồi mới kiểm cờ + ghi | READ COMMITTED: snapshot theo câu ⇒ kiểm-rồi-ghi trong một câu không chặn hai lời gọi song song; không cần migration (không thêm unique index). |
| 2 | HĐ lấy từ liên kết lượt↔HĐ của engine trên cây lượt; args chỉ đối chiếu | Không tin `contract_id` từ args. Lượt thật không có HĐ (đơn < 20 triệu) + args trống ⇒ bỏ qua; lệch / nhiều HĐ ⇒ lỗi. |
| 3 | `done_by` = người đóng việc gần nhất của lượt (thủ quỹ), ghi bằng scope công ty (`system`) | Thủ quỹ có thể không thấy HĐ theo luật thấy; mọi câu lọc công ty tường minh. |
| 4 | Số tiền nguyên 1…1e15, rỗng ⇒ lấy giá trị HĐ (cả hai trống ⇒ lỗi); tổng đã trả + số này ≤ giá trị HĐ (nếu HĐ có giá trị) | Không ép "" thành 0; không ghi vượt giá trị HĐ. Ngày chi sai/trống ⇒ lỗi (không lấy hôm nay). |
| 5 | Tool `agent: false` + kiểm lượt có bước node này | Không lộ cho Agent/MCP; gọi ngoài node bị từ chối. |

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED tools/demo-purchase.md
#### Yêu cầu: Khoản đã chi ở bước 11 vào sổ thanh toán của HĐ
Khi thủ quỹ xác nhận «Đã chi» ở bước 11 của quy trình mua hàng mẫu và hợp đồng không có đợt thanh toán đang mở, hệ thống ghi một dòng «đã trả» vào sổ thanh toán của hợp đồng (số tiền ở bước đề nghị thanh toán, ngày chi, người xác nhận chi); chạy lại không ghi trùng; đơn không có hợp đồng thì bỏ qua; hợp đồng có đợt thanh toán đang mở thì để bước «Xác nhận mốc» lo.
- Kịch bản: luật số tiền / ngày / chọn hợp đồng [test: packages/contracts/src/modules/contracts/record-payment/config.test.ts » planRecordPayment]
- Kịch bản: bước 11 có stage ghi sổ [test: tools/scripts/src/seed-purchase-flow.data.test.ts » CR-140 · bước 11: sau «Đã chi» ghi khoản đã chi vào sổ thanh toán của HĐ (số tiền bước 10, ngày chi bước 11)]
- Kịch bản: ghi một dòng, người ghi là thủ quỹ khác người tạo HĐ, chạy lại / song song không trùng [test: apps/hub-api/src/modules/packs/record-payment.int.test.ts » HĐ không có đợt]
- Kịch bản: HĐ khác trong cùng công ty, công ty khác, gọi ngoài node đều bị từ chối [test: apps/hub-api/src/modules/packs/record-payment.int.test.ts » chặn]
