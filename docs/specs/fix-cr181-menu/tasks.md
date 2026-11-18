---
id: fix-cr181-menu
lát: fix-cr181-menu
cr: CR-181
làn: nhanh
migration: không
phụ thuộc: s4-sig-gate
---
## Plan (ngắn)
Hồi quy: mở menu tài khoản rồi menu biến mất (e2e contracts-web, API giả: `/me/signature` ⇒ 504). Nguyên nhân: `MySignatureMenuItem` gắn observer thứ hai vào query lỗi ⇒ refetch ⇒ `isPending` (react-query v5) bật lại ⇒ `FirstLoginGate` trả `null` ⇒ cả Shell (kèm menu đang mở) bị gỡ rồi dựng lại, menu đóng.

## Làm
- [x] `FirstLoginGate`: `useGateReady` chốt «sẵn sàng» một lần (`latchReady`), không quay lại chờ; quá `GATE_WAIT_MS` (3 giây) ⇒ cho vào app (API treo không che khung).
- [x] Rà: `/me/signature` chỉ ở gate, mục menu, trang `/my-signature`; `/company/signature-settings` chỉ trong hộp Cài đặt (`SignaturePane`) — đều cục bộ, không che khung.

## Không làm / Chạm
Chạm: features/my-signature/components/FirstLoginGate.tsx, gate.test.tsx.

## Test tối thiểu
`bun test apps/workspace-web/src/features/my-signature`

## Quyết định trong lúc làm
- Test ở tầng thuần (`latchReady`): repo không có DOM test; e2e contracts-web là bằng chứng cuối.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED hub/chu-ky.md
#### Yêu cầu: API chữ ký chậm hoặc lỗi không che khung app
Khung app và menu tài khoản luôn dùng được dù API chữ ký lỗi hoặc treo.
- Kịch bản: khi lượt tải đầu đã xong thì tải lại không gỡ khung app [test: apps/workspace-web/src/features/my-signature/gate.test.tsx » đã chốt sẵn sàng thì lượt tải lại (pending quay lại) KHÔNG gỡ khung app]

## Việc còn lại
