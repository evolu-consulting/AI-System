---
id: fix-wait-until-warning
lát: fix-wait-until-warning
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
`defs-flow.int` ca «sai kiểu date» đỏ: PUT def nối tới `core.wait-until` với `date` kiểu chuỗi trả 200 nhưng không có `warnings`.
Nguyên nhân: commit 4b88899b4 (CR-127 E9) đặt `stages: []` cho 4 node lõi cũ ⇒ `nodesOfApp` bỏ chúng khỏi `CORE_NODES`/palette ⇒ `flowEdgeIssues` coi `core.wait-until` là node lạ (không đòi gì) ⇒ def đã lưu mang khoá cũ lọt kiểm cạnh.

## Làm
- `legacyNodesOfApp` (modules.rules) + `LEGACY_CORE_NODES`/`withLegacyCoreNodes` (core.nodes): node cũ có inputs/outputs vẫn có trong bảng KIỂM CẠNH (không vào menu).
- `edge-check.ts`: `flowEdgeIssues(input, withLegacyCoreNodes(palette))`.
- Unit `core.nodes.test.ts` (tầng rẻ, N1).

## Không làm / Chạm
Không đổi menu/bảng node, không đổi test khoá. Chạm contracts `app-manifest` + hub-api `processes/defs/edge-check.ts`.

## Test tối thiểu
unit `core.nodes.test.ts` + `src/modules`; int `defs-flow.int.test.ts` (7/7); openspec:check, depcruise:affected.

## Quyết định trong lúc làm
Sửa ở lớp kiểm cạnh (gộp node cũ vào bảng kiểm), không đưa node cũ trở lại `CORE_NODES` (sẽ làm hiện lại trên menu).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: khôi phục cảnh báo kiểu cạnh FLOW2-FR-26 vốn đã có trước CR-127 E9 cho def mang khoá node cũ)
