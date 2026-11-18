---
id: fix-cr182-owner-tap
lát: fix-cr182-owner-tap
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Soát UI lượt 5: ở 390px chạm avatar «Phụ trách» không hiện tên (ô vừa là tooltip vừa là trigger menu chọn người, chạm mở thẳng menu hoặc bị nuốt).

## Làm
- [x] Điện thoại (≤ 640px) + đã có người phụ trách: `OwnerPopover` — chạm avatar ⇒ popover hiện «Phụ trách: tên»; có quyền đổi ⇒ thêm nút «Đổi người phụ trách» mở danh sách ngay trong popover; không quyền ⇒ chỉ tên.
- [x] Máy tính giữ nguyên (rê chuột ⇒ tên, bấm ⇒ menu chọn; testid `owner-select`, `owner-option-*` không đổi).
- [x] i18n `contracts.gapa1.owner.change` (VI/EN). `OwnerFace` chuyển sang `OwnerPopover.tsx`; `ownerOptions` ở `lib/manage.ts`.

## Không làm / Chạm
- Chạm: `apps/workspace-web/src/features/contract-review/{components/ManagePanel.tsx,components/OwnerPopover.tsx,lib/manage.ts}`, `packages/i18n/locales/contracts/gapa1.*`.
- Không làm: HĐ chưa giao người (cur null) giữ nút «Chưa giao» mở menu như cũ.

## Test tối thiểu
`OwnerRow.test.tsx » OwnerPopover (điện thoại)`, `manage.test.ts » ownerOptions`.

## Quyết định trong lúc làm
- Danh sách chọn nằm trong chính popover (không mở DropdownMenu thứ hai trên cùng avatar) để chạm không bị menu nuốt.
- bun test không có DOM nên hành vi chạm thật chưa kiểm; qc thêm e2e 390px: chạm `owner-select` ⇒ thấy `owner-name`; có quyền ⇒ `owner-change` ⇒ `owner-option-*`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Điện thoại và Tổng quan (nguồn: cr125-ux-s4-contract-card)
- Kịch bản: khi ở điện thoại chạm avatar «Phụ trách» thì hiện popover tên; người có quyền đổi thấy thêm «Đổi người phụ trách», người không có quyền chỉ thấy tên [test: apps/workspace-web/src/features/contract-review/components/OwnerRow.test.tsx » OwnerPopover (điện thoại)]

## Việc còn lại
- qc: e2e 390px cho ô Phụ trách (xem Quyết định).
