---
id: cr125-m1-contracts
lát: cr125-m1-contracts
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: m0
---
## Plan (ngắn)
Sổ `MODULES` ở `packages/contracts/src/modules/` là MỘT nguồn danh sách node. `CORE_NODES`, `AppManifest.nodes`, `process-module-nodes` (MULTI) đọc lại từ sổ ở dạng `AppNodeDecl` cũ (bỏ `kind/baseExecutor/configPort/legacy`) ⇒ khoá `stage.node`, API, def đã lưu không đổi.

## Làm
- `modules/types.ts`: PortSchema/PortWidget, FeatureNodeDecl, FeatureModule, ModuleIssue(+mã), BoundSummary.
- `modules/core/index.ts`: module `core` — 4 node bảng cũ (nay `kind: base` + `baseExecutor`) + Duyệt/Nếu/Kết thúc (bước cơ bản, không stage mẫu); cổng zod cho Hẹn giờ.
- `modules/contracts/esign/node.ts`, `modules/community/show-post/node.ts`: khai báo chuyển từ manifest; `index.generated.ts` (viết tay) = `MODULES`.
- `modules/modules.rules.ts`: `moduleIssues` (MOD_DUP/UNBOUND/TOOL_MISSING/PORT_MISMATCH/EVENT_UNBOUND/OUTCOME_UNBOUND/ORPHAN_BINDING), `nodesOfApp`, `toAppNode`, `withEvents`, `baseNodeOf`, `featureNodeByKey`.
- `package.json` contracts: subpath `./modules`.

## Không làm / Chạm
Không chạm hub-api, admin-web, DLC, engine/FlowDef, DB. Sự kiện (`events`) còn ở `AppManifest.events`. Đường dẫn khai báo node chưa có `configPort` cho Ký số (m4).

## Test tối thiểu
`modules/modules.rules.test.ts` (unit); chạy lại app-manifest + hub-admin của contracts.

## Quyết định trong lúc làm
- Khai báo node app (esign, show-post) chuyển vào `modules/<app>/<node>/node.ts` ngay m1 (bản đồ file ghi m4) — cách duy nhất để manifest đọc từ `MODULES` mà không vòng lặp, không hai danh sách.
- Duyệt/Nếu/Kết thúc: `stages: []` (executor approve/if không thuộc `NODE_EXECUTORS` của bảng node; giữ `manifest.ts` nguyên) ⇒ không vào `CORE_NODES`/palette. Kết thúc: `baseExecutor: "set"` + `outcome` (xem `baseNodeOf`).
- `notify` khớp Gửi email khi có kênh `email`, ngược lại Thông báo chuông.
- Cổng Chờ khoảng chưa khai (hằng giờ ở `hub-admin/process-wait.ts`, import sẽ kéo vòng lặp) ⇒ m5/m6.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr124-cr125)
Không thay đổi hành vi (lý do: gom khai báo node vào sổ MODULES, CORE_NODES/AppManifest.nodes/process-module-nodes đọc lại cùng nội dung; thêm kiểu + luật moduleIssues chưa được hub-api/admin-web gọi)

## Việc còn lại
- m2: hub `moduleRegistry.verify` dùng `moduleIssues` + `withEvents(MODULES, APP_MANIFESTS)`; tóm tắt binding.
- m3: `module:index` sinh `index.generated.ts`; `check:modules` (MOD_INDEX_STALE); scaffold.
- m4: `configPort` Ký số = schema args tool; chuyển `events` vào module.
- Cổng Chờ khoảng; `baseNodeOf` chưa được editor/validator gọi (m5).
