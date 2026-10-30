---
id: pl-library-fix
lát: pl-library-fix
cr: CR-105
làn: đầy đủ
migration: không
phụ thuộc: pl-library-api (L2a), pl-slot-shape (L2b)
---
## Plan (ngắn)
Tiếp L2a: lưu từ canvas (chỉ `stages`) dựng lại `slot_body` qua `SlotSpec.fromStages`; rollback bắt buộc `version`; thêm 2 ca int
engine còn thiếu của Delta CR-105; đo `resolveSlot` p95.

## Làm
- `SlotSpec.fromStages?` (kit) — `contracts.approval` cài bằng `slotBodyFromStages` (`fromStages` của L2b ⇒ mã đứng chỗ id ⇒ `*_key`).
- `library-draft.slotDraft`: không `slot_body` ⇒ `fromStages`; dạng song song/If/nhánh ⇒ 422 `SLOT_SHAPE_UNSUPPORTED {stage}`.
- `RollbackProcessDefRequestSchema.version` bắt buộc ⇒ hai lần quay lại đồng thời ⇒ một 409 `VERSION_CONFLICT`.

## Không làm / Chạm
UI (admin-web gửi `version` khi quay lại — L3 cần cập nhật `rollbackDef`).

## Test tối thiểu
`library.routes.int` (+2 ca: quay lại đồng thời, lưu từ canvas), `approval-engine-slot.int` (+2 ca Delta), `slot-resolve.perf.int`.

## Quyết định trong lúc làm
- 2026-10-31 `stage.slot` của def thư viện mang mã ở chỗ id (do `compileSlotStages`); canvas có thể gửi `*_key` ⇒ lấy id ?? key rồi
  đổi sang `*_key` (id = null) — body thư viện không bao giờ giữ id Group.
- 2026-10-31 hai ca engine đổi khe/nháp bằng SQL trực tiếp (test gói không import `modules/processes/**`); route đổi mặc định đã có int ở L2a.
- 2026-10-31 đo `resolveSlot` p95 = 0,83 ms (200 lượt, 10.000 tenant, 500 release; ngưỡng 5 ms).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-30 (đợt CR-105)

Không thay đổi hành vi (lý do: Delta ở docs/specs/process-library/tasks.md)

## Việc còn lại
- L3 (admin-web `library-api.ts` `rollbackDef`): gửi `version` nháp khi quay lại (nay bắt buộc, thiếu ⇒ 400).
