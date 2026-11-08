---
id: cr125-m4-esign
lát: cr125-m4-esign
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: m1, m2, m3, m6a
---
## Plan (ngắn)
Ký số chuyển hẳn sang khuôn module (MOD-FR-01/04) + hai quyết định 2026-11-07 (MOD-FR-11/12): (A) node Ký số không còn nhà cung cấp, người ký chọn cách ký lúc ký; (B) tự nối đầu vào có đúng một nguồn.

## Làm
- contracts: `ESIGN_CONFIG_PORT` (= `EsignNodeConfigSchema`, bỏ `provider`) ở `modules/contracts/esign/node.ts`; `modules/auto-map.ts` (`autoMapInputs`, `mapAskMessage`); `AppNodeIo.fix`.
- hub-api: `nodes/esign/binding.ts` (tool + argsSchema + validator), `esign.mount`/`intake.mount` chỉ gọi binding; tool bỏ `cfg.provider`; `checkNode` bỏ kiểm nhà cung cấp; `esign-switch.ts` (đổi cách ký lúc ký khác loại phong bì); `EnvelopeRow.dueH/remindEveryH`.
- workspace-web: `EsignSignMethodDialog` (chọn cách ký khi > 1 cách khả dụng) ở «Ký ngay".
- admin-web: panel Ký số bỏ ô nhà cung cấp; `lib/auto-bind.ts` tự nối khi thêm node; câu `argRequired` nghiệp vụ.

## Không làm / Chạm
Không chạm `requires`/process-real-rule (m5), DLC, CR-124 partners. Không migration: `provider` cũ trong args đã lưu bị bỏ qua khi đọc; tool vẫn khai tham số `provider` (đã bỏ, bỏ qua) để def cũ không bị từ chối. Đường GỬI ký không thêm truy vấn (chỉ thêm 2 cột vào SELECT envelope).

## Test tối thiểu
unit: auto-map, auto-bind, esign-node (decode), esign-switch, esign-view; int server: esign files; e2e journey-approval một lần.

## Quyết định trong lúc làm
- Đổi cách ký khác loại phong bì = huỷ + gửi lại (không bắn `esign.voided`, luồng vẫn chờ); chặn khi đã có người ký.
- Tự nối chỉ nối nguồn «Bắt đầu khi» thành tham số tool; nguồn từ bước trước vẫn do người dùng chọn (chỉ hỏi khi không có nguồn nào).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr124-cr125)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Người ký chọn cách ký lúc ký
Node Ký số chỉ khai người ký, hạn ký và nhắc; không chọn nhà cung cấp. Lúc bấm «Ký ngay», người ký chọn trong các cách công ty đã bật; chỉ một cách thì ký thẳng. Def cũ có `provider` vẫn chạy (trường bị bỏ qua).
- Kịch bản: args cũ có `provider` ⇒ đọc cấu hình vẫn hợp lệ, trường bị bỏ qua [test: packages/contracts/src/pack-contracts/esign-node.test.ts » CR-125 m4 · provider cũ bị bỏ qua]
- Kịch bản: người ký chọn cách khác loại phong bì ⇒ huỷ phong bì cũ và gửi lại cùng người ký/hạn [test: apps/hub-api/src/modules/packs/contracts/application/esign-switch.test.ts » CR-125 m4 · đổi cách ký]
- Kịch bản: nhiều cách khả dụng ⇒ hỏi; một cách ⇒ ký thẳng [test: apps/workspace-web/src/features/contract-esign/lib/esign-view.test.ts » CR-125 m4 · chọn cách ký]

#### Yêu cầu: Thêm node tự nối đầu vào có đúng một nguồn
Thêm node tự nối mọi đầu vào có đúng một nguồn (vd mã hợp đồng từ «Bắt đầu khi»); chỉ hỏi khi nhiều nguồn hoặc không có, bằng câu nghiệp vụ kèm cách khắc phục.
- Kịch bản: một nguồn ⇒ nối, không hỏi; không nguồn ⇒ «cần … — thêm bước Tải hợp đồng trước» [test: packages/contracts/src/modules/auto-map.test.ts » autoMapInputs]
- Kịch bản: thêm Ký số vào flow bắt đầu từ hợp đồng ⇒ `contract_id` được nối vào tham số tool [test: apps/admin-web/src/features/processes/lib/auto-bind.test.ts » autoBindNode]