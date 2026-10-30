---
id: fnr-swap
lát: fnr-swap
cr: CR-103
làn: nhanh
migration: không
phụ thuộc: flow-node-registry (R1)
---
## Plan (ngắn)
R3: luật đổi node cùng họ dùng chung FE/BE + ô chọn loại node ở editor lấy từ registry FE.

## Làm
- [x] contracts: `NODE_PRODUCES` (node-family.ts), `fieldRefsTo` + `canSwap` thuần (node-swap.ts) + unit table-driven.
- [x] FE: `lib/swap-guard.ts` (dựng def từ draft, gọi canSwap); `StageGeneral` dựng ô "Người thực hiện" từ `FE_NODES`, mục không đổi được bị vô hiệu + tooltip lý do; đổi loại dùng `defaults()` của registry (bỏ bảng `PATCH_OF` riêng). i18n vi/en `editor.stage.swap.*`.

## Không làm / Chạm
- Không đổi server (`def.rules` vẫn chặn tham chiếu hỏng). Không chạm nodes/if, nodes/set (R2/R4).
- Chạm chung tối thiểu: node-family.ts (thêm map), index.ts (export), registry không đổi, Fields.tsx (`Option.title`).

## Test tối thiểu
- unit `node-swap.test.ts`; tsc contracts + admin-web; biome --changed. Không e2e.

## Quyết định trong lúc làm
- Giữ một ô chọn (agent/team/loại cố định) thay vì thêm ô loại riêng: agent/team vẫn chọn theo tên; chỉ stage đã có loại mới bị chặn (stage trống chọn tự do).
- Loại mới đăng ký (`if`, `set`) phải thêm một dòng vào `NODE_PRODUCES` (thiếu ⇒ lỗi typecheck, như `NODE_FAMILY_OF`).
- Stage dở dang không chuyển được sang def bị bỏ qua khi kiểm (server kiểm lại lúc lưu).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-30 (đợt CR-103)

### ADDED engine/flow-engine.md
#### Yêu cầu: Đổi node cùng họ
Editor chỉ cho đổi loại node trong cùng họ (work/wait/apply) và khi field mà bước sau dùng vẫn còn.
- Kịch bản: khi đổi `agent` sang `tool` mà luật rẽ nhánh dùng field vẫn khai báo thì lưu được
- Kịch bản: khi đổi `agent` sang `wait_until` thì editor không cho chọn
- Kịch bản: khi run đang chạy và def bị đổi node thì run vẫn chạy theo snapshot cũ

## Việc còn lại
- Gộp Delta vào docs/current cuối đợt; sau khi R2/R4 merge: thêm `if`/`set` vào `NODE_PRODUCES`.