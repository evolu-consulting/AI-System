---
id: arch-a5-workspace-web
lát: arch-a5-workspace-web
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Dọn slice 7 của arch-a1-depcruise: component workspace-web không import trực tiếp `api.ts`/`web-kit/http`; đi qua cổng `features/<f>/hooks/use-*-api.ts` và `src/lib/api-error.ts`. Phá 2 vòng bằng cách tách kiểu sang lib.

## Làm
- 10 file `hooks/use-*-api.ts` (re-export) + `lib/api-error.ts`; đổi import ở 19 component.
- `contract-approval/lib/approval-view.ts` (kiểu `ApprovalView`), `contracts-list/lib/columns.ts` (khoá cột).
- Gỡ 26 mục khỏi `.dependency-cruiser-known-violations.json`.

## Không làm / Chạm
features/partners (CR-124), DLC, app khác.

## Test tối thiểu
Unit workspace-web + tsc + build + check:bundle + depcruise (không đổi hành vi).

## Quyết định trong lúc làm
Dùng re-export hook thay vì viết hook mới (giống admin-web `use-feedback-api.ts`) để không đổi hành vi.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: tách gọi API khỏi component)

## Việc còn lại
