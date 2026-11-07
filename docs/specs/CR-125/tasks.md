# CR-125 · Tasks

Trạng thái gộp: chưa gộp

## Bản đồ file

Ghi chú: "(mới)" = chưa có, tạo trong lát. "giữ" = chỉ đọc hoặc giữ API. Đường dẫn đã kiểm bằng Glob/Grep ngày 2026-11-07; mục ghi "(kiểm)" chưa mở file.

| Lát | File | Hàm / ký hiệu | Thay đổi |
|---|---|---|---|
| m0 | docs/specs/CR-125/tasks.md | — | file này |
| m1 | packages/contracts/src/modules/types.ts (mới) | FeatureModule, FeatureNodeDecl, PortSchema, ModuleIssue, BoundSummary | kiểu + zod cổng; sổ `MODULES` |
| m1 | packages/contracts/src/modules/modules.rules.ts (mới) | moduleIssues | luật thuần, O(node + sự kiện + kết quả) |
| m1 | packages/contracts/src/modules/core/** (mới) | module core | khai báo Duyệt, Nếu, Thông báo, Kết thúc, Chờ tới, Chờ khoảng (kind base, baseExecutor) |
| m1 | packages/contracts/src/modules/index.generated.ts (mới) | MODULES | sinh bằng module:index (m3); m1 viết tay bản đầu |
| m1 | packages/contracts/src/app-manifest/core.nodes.ts | CORE_NODES (dòng 5) | thành re-export từ MODULES |
| m1 | packages/contracts/src/app-manifest/nodes.rules.ts | nodesFor (dòng 105), luật options_path (dòng 70) | đọc từ MODULES; giữ luật |
| m1 | packages/contracts/src/app-manifest/contracts.manifest.ts | nodes (esign, dòng ~165–185) | `nodes` thành re-export; khai báo chuyển sang m4 |
| m1 | packages/contracts/src/app-manifest/community.manifest.ts | nodes | chỉ ghi vào sổ, không chuyển node |
| m1 | packages/contracts/src/app-manifest/manifest.ts | AppNodeDecl.config (dòng 141–142) | giữ kiểu |
| m1 | packages/contracts/src/hub-admin/process-module-nodes.ts | moduleClusters (dòng 94), MULTI | đọc từ MODULES |
| m1 | packages/contracts/package.json | exports | thêm subpath `./modules` |
| m2 | apps/hub-api/src/modules/packs/kit/application/module.ports.ts (mới) | NodeBinding, EventBinding, ModuleRegistry | cổng xử lý máy chủ |
| m2 | apps/hub-api/src/modules/packs/kit/adapters/module-registry.ts (mới) | createModuleRegistry, verify | bindNode/bindEvent/verify |
| m2 | apps/hub-api/src/modules/packs/kit/public.ts | export | xuất moduleRegistry |
| m2 | apps/hub-api/src/modules/packs/kit/adapters/flow-port-registry.ts | flowPortRegistry (dòng 10) | giữ API, bọc bằng bindNode |
| m2 | apps/hub-api/src/modules/packs/kit/adapters/node-config-registry.ts | nodeConfigRegistry (dòng 15) | giữ API, bọc bằng bindNode |
| m2 | apps/hub-api/src/modules/packs/packs.mount.ts | cuối mount | gọi moduleRegistry.verify(MODULES) |
| m2 | apps/hub-api/src/modules/packs/packs.mount.test.ts | test mount | thêm case verify lỗi ⇒ ném |
| m3 | tools/scripts/src/check-modules.ts (mới) | main | moduleIssues + kiểm index; tương tự check-app-events.ts |
| m3 | tools/scripts/src/module-index.ts (mới) | main | sinh index.generated.ts |
| m3 | tools/scripts/src/module-new.ts (mới) | main | scaffold node.ts, binding.ts, Panel.tsx |
| m3 | package.json (gốc) | scripts (dòng 118, 125) | thêm check:modules, module:index, module:new; `check` gọi check:modules |
| m3 | tools/scripts/src/slice.ts | slice:merge, postRebaseGates (dòng 171, 186–189) | thêm check:modules vào cổng |
| m4 | packages/contracts/src/modules/contracts/esign/node.ts (mới) | configPort | = EsignNodeConfigSchema |
| m4 | packages/contracts/src/pack-contracts/esign-node.ts | EsignNodeConfigSchema (dòng 21), EsignNodeConfig (dòng 35) | nguồn schema, giữ |
| m4 | packages/contracts/src/app-manifest/contracts.manifest.ts | esign node (dòng 169, 182) | chuyển khai báo sang node.ts |
| m4 | apps/hub-api/src/modules/packs/contracts/nodes/esign/binding.ts (mới) | NodeBinding "contracts.esign" | tools, validate, options |
| m4 | apps/hub-api/src/modules/packs/contracts/adapters/esign-node.validator.ts | esignNodeValidator (dòng 11) | giữ, dùng từ binding |
| m4 | apps/hub-api/src/modules/packs/contracts/adapters/intake.tools.ts | esignSend (dòng 28), tool "contracts-esign-send" | args parse bằng configPort.schema |
| m4 | apps/hub-api/src/modules/packs/contracts/esign.mount.ts | esignModule (101), esignUserRoutes (261), mountEsignWebhook (271) | chỉ còn gọi binding (lưu ý: tool KHÔNG đăng ký ở đây) |
| m4 | apps/hub-api/src/modules/packs/contracts/adapters/esign-node.validator.test.ts, esign-node.int.test.ts | test | giữ, thêm case MOD_PORT_MISMATCH |
| m5 | apps/hub-api/src/modules/packs/core/nodes/** (mới) | binding base | bindNode cho Duyệt, Nếu, Thông báo, Kết thúc, Chờ tới, Chờ khoảng; không sửa engine |
| m5 | apps/hub-api/src/modules/packs/core-tools.mount.ts | mount | gọi bindNode |
| m5 | apps/hub-api/src/modules/packs/contracts/flow-events.mount.ts | sự kiện contracts (facts, outcome) | bindEvent |
| m5 | apps/hub-api/src/modules/packs/kit/application/flow-events.ports.ts | FactsReader (dòng 33), OutcomeHandler (dòng 58) | giữ kiểu |
| m5 | apps/hub-api/src/modules/packs/community-flow.mount.ts | sự kiện community | bindEvent |
| m5 | apps/hub-api/src/modules/packs/community/adapters/flow-ports.ts | FactsReader community (kiểm) | bindEvent |
| m5 | apps/hub-api/src/modules/packs/contracts/flow-events.mount.test.ts | test | cập nhật theo bindEvent |
| m6a | apps/admin-web/src/features/processes/modules/panel-registry.ts (mới) | panelRegistry, NodePanel | register / panelFor |
| m6a | apps/admin-web/src/features/processes/modules/generic/** (mới) | panel chung | dựng từ configPort + widgets |
| m6a | apps/admin-web/src/features/processes/modules/contracts/esign/Panel.tsx (mới) | EsignPanel | panel riêng Ký số |
| m6a | apps/admin-web/src/features/processes/components/flow/NodeConfigPanel.tsx | toàn file (dòng 1–2, 125–128 useOptions) | gỡ nhánh esign viết tay, dùng panelRegistry |
| m6a | apps/admin-web/src/features/processes/components/library/FlowEsignFields.tsx | toàn file | gỡ (MOD-FR-08) |
| m6a | apps/admin-web/src/features/processes/lib/wait-form.ts | validate form chờ | chuyển kiểm sang schema (kiểm chi tiết khi làm) |
| m6a | apps/admin-web/src/features/processes/components/editor/StageIf.tsx | — | KHÔNG sửa; thuộc cr123-u4, chạy sau u4 merge |
| m6b | apps/admin-web/src/features/processes/lib/palette-node.ts | nodeToPatches, nodeLabel | đọc nguồn MODULES qua palette-api |
| m6b | apps/admin-web/src/features/processes/palette-api.ts | usePalette (dòng 18–23) | giữ endpoint |
| m6b | apps/hub-api/src/modules/processes/library/palette.routes.ts | GET /process-palette (dòng 24–28) | nguồn đổi sang MODULES |
| m6b | apps/hub-api/src/modules/processes/defs/node-features.ts | paletteOf (dòng 18) | đọc MODULES |
| m6b | apps/admin-web/src/features/processes/components/flow/NodePalette.tsx | danh sách palette | đọc từ palette-api |
| m6b | apps/admin-web/src/features/processes/components/flow/NodeMenuContent.tsx | menu "+" (dòng 35, 63) | đọc từ palette-api |
| m6b | apps/admin-web/src/features/processes/lib/module-cluster.ts; components/canvas/module-cluster.ts | re-export moduleClusters (dòng 8; dòng 55) | giữ |
| m6b | apps/admin-web/src/features/processes/lib/insert-on-edge.ts | — | (kiểm: chưa xác nhận tồn tại) |
| m7 | e2e/** (journey-approval, e2e/_kit/flows.ts) | — | qc viết; chạy một lần cuối CR |

Thiếu so với spec (đã kiểm): thư mục `packages/contracts/src/modules/` và `apps/hub-api/.../packs/core/` chưa có; `check-modules.ts`, `module-new.ts`, `module-index.ts` chưa có; `FlowEsignFields.tsx` nằm ở `components/library/`, không ở `components/flow/`. Tool esign đăng ký ở `intake.tools.ts`, không ở `esign.mount.ts`.

## Delta (so với docs/current)
Không thay đổi hành vi (lý do: bản đồ file; Delta theo từng lát)
