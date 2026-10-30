---
id: pl-seed-keys
lát: pl-seed-keys
cr: CR-105
làn: nhanh
migration: sửa hub 0069 (chưa push/deploy)
phụ thuộc: pl-library-api
---
## Plan (ngắn)
Seed 0069 để mã phòng ban trong `*_group_id` của `stage.slot` (do `compileSlotStages` chép bước "mã đứng chỗ id" của `compileDef`).
`slot_body` của seed đã đúng (`*_group_key`, id null); lỗi nằm ở `stages[].slot`.

## Làm
- `compileSlotStages`: `stage.slot` = bước NGUYÊN của body (mã ở `*_group_key`, `*_group_id` null; Ký số ở `finalize.slot.esign`).
- 0069 sinh lại (chỉ literal `stages` đổi; vẫn `ON CONFLICT DO NOTHING`).
- Backfill: dùng `compileSlotStages` ⇒ cũng ra `stage.slot` theo mã; thêm assert trong `process-library-backfill.int`.

## Quyết định trong lúc làm
- 2026-10-31 chặn phía server: giữ luật sẵn có `validateSlotBody` ⇒ mọi `*_group_id` khác null trong body thư viện = 422
  `SLOT_BODY_INVALID` (rule `GROUP_ID_IN_LIBRARY`) — đơn giản hơn chuẩn hoá; đường canvas (chỉ `stages`) đã chuẩn hoá id→key trong
  `slotBodyFromStages`. Thêm ca int.
- 2026-10-31 DB dev/test đã áp 0069 cũ giữ hàng cũ (ON CONFLICT DO NOTHING); admin-web `repairSlot` đỡ phía đọc.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa seed CR-105)

## Việc còn lại
- Không.
