---
id: arch-a6-community-domain
lát: arch-a6-community-domain
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Dọn baseline depcruise (arch-a1 lát 8+9) riêng `packs/community`: domain chỉ built-in; 2 int test thoát khỏi lớp adapters.

## Làm
- `domain/quote.types.ts` (kiểu cổng gốc + kiểu View), `domain/flow-view.types.ts`; `pack-ports.ts` re-export từ domain.
- `brand.rules.ts`: nhận `accents`/`defaultAccent` qua tham số (adapter `org.routes.ts` truyền từ contracts).
- `flow-slots.rules.ts`: kiểu `SlotSpec` khớp kit khai tại chỗ.
- 2 int test `community.flow-{events,launch}` chuyển lên `packs/` (tầng mount) — hết vi phạm pack-no-hub-modules / hub-scope.
- Gỡ 22 mục baseline.

## Không làm / Chạm
packs/contracts, packs/dlc, kit (không đổi), modules khác.

## Test tối thiểu
unit domain community; int community trên evotest; tsc hub-api.

## Quyết định trong lúc làm
Không thêm cổng kit: vi phạm hub-modules/hub-scope chỉ nằm ở 2 file test tích hợp với engine processes ⇒ chuyển tầng.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: Clean Architecture community)

## Việc còn lại
