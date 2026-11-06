---
id: cr121-c
lát: cr121-c
cr: CR-121
làn: nhanh
migration: admin 0037 (c18), pack-contracts 0076 (c20), hub 0103 (chỉ c9 nếu cần; cột source_template_id/rel_version đã có ⇒ dự kiến KHÔNG cần). Điều phối giao journal `when` trước khi giao lát.
phụ thuộc: spec docs/specs/cr121-c/spec.md
---
## Plan (ngắn)
13 lát c9…c21 (≤ 60 phút/agent; Sonnet, Sonnet high cho lát `cao`, Opus low soát lát `cao`). Spec: `spec.md` (R1–R9, Q1–Q11, D1–D5). Perf mỗi lát ghi bên dưới (D8). Dùng chung: `features/processes/lib/view-mode.ts` (chế độ canvas/danh sách, Q11) do **c11** tạo, c15/c17 dùng lại.

## Lát
| Lát | Đợt | Artboard | Loại | Rủi ro | Phụ thuộc |
|---|---|---|---|---|---|
| c9 · API: lượt chạy lọc slot/def + `clone-for-company` + đọc chỉ-xem thư viện theo tenant | 1 | — | API hub-api + contracts | cao | — |
| c10 · Nav 6 mục | 1 | `Main` | UI | thường | — |
| c18 · gỡ `contracts-approval-engine` + cột `admin.features.app` | 1 | — (Q-1 lọc Ứng dụng) | migration + admin-api + admin-web | cao | — |
| c16 · Công cụ AI + bật/tắt Dify theo công ty + "Dùng bởi" | 1→2 (sau c10, trước c11; D6; người dùng đồng ý) | `AiTools` | UI + API đọc | thường (endpoint role/cách ly) | c10 |
| c11 · Công ty › Quy trình | 2 | `CompanyFlows`, `Tpl-Detail` | UI | thường | c9, c10, c16 |
| c19 · check vai app ↔ vai hub | 2 | — | ops check | cao | c18 |
| c20 · tên công ty một nguồn (`company_name`) | 2 | — | migration pack-contracts + chuyển chỗ đọc + check | cao | c19 (cùng `registry.ts`) |
| c12 · Công ty › Ứng dụng bảng + LevelControl + ⓘ | 3 | `Company` | UI | thường | c11, c18 |
| c13 · Gỡ chỗ gán 3, 4 + chuyển hướng | 3 | `Library` (gỡ flowsMode) | UI | thường | c12 |
| c14 · 5 tab công ty (platform_admin + tenant_admin) | 3 | `Tpl-Settings` | UI | thường | c13, c16 |
| c21 · cấu hình mail một nguồn | 3 | — | config + ops check | cao | c20 |
| c15 · Thư viện đối chiếu | 4 | `Library` | UI | thường | c13, c11 |
| c17 · Trình sửa đối chiếu + chỉ xem + Sao chép | 4 | `Tpl-Editor` (đối chiếu `Tpl-Run`) | UI | thường | c9, c11, c15 |

Nối tiếp: c9 ‖ c10 ‖ c18 (file không chung); c16 sau c10; c11 → c12 → c13 → c14; c15 → c17 (nối tiếp, KHÔNG song song). `ops/adapters/checks/registry.ts` sửa tuần tự c18 → c19 → c20 → c21. i18n: mỗi lát một namespace riêng (c18: `features.app.*`), merge driver JSON.

## Phạm vi file + xong khi + perf (mỗi lát)
- **c9** · File: `packages/contracts/src/chat/processes-api.ts` (`ProcessRunListQuerySchema` + `slot?`, `def_id?`), `packages/contracts/src/hub-admin/processes.ts` (schema res `{def_id, source_template_id, rel_version, created}`), `hub-api/src/modules/processes/runs/{runs.routes.ts:55, runs.repo.ts listRuns}`, `processes/library/{library.routes.ts, library.service.ts (cloneForCompany), library.repo.ts, routing.service.ts, routing.repo.ts}`; test mới `runs/runs-slot-filter.int.test.ts`, `library/clone-for-company.int.test.ts`. Route: `POST /tenants/:tid/process-defs/:id/clone-for-company` (201 mới / 200 `created:false` / 422 `NOT_LIBRARY_DEF`, `SLOT_GONE`), `GET /tenants/:tid/process-library/:id`; vai kiểm ở service (platform_admin mọi tenant; tenant_admin chỉ tenant mình, tenant lạ 404; member 403). Quy tắc đổi luật: chỉ luật trỏ đúng def nguồn, `FOR UPDATE` hàng gán, một transaction, audit. · Xong khi: unit schema; MỘT int mỗi endpoint; int chặn chéo tenant (404/403); int idempotent (lần 2 `created:false`); Opus low soát. · Perf: lọc slot/def cùng câu SQL, index (tenant, slot); clone = số câu cố định.
- **c10** · File: `apps/admin-web/src/features/shell/lib/nav.ts` + `nav.test.ts`, router admin-web (grep `/workflows`), route `/ai-tools` (tạm → /workflows), redirect `/commands` `/agents`. · Xong khi: `nav.test.ts` xanh, unit chuyển hướng. · Perf: không.
- **c18** · File: `packages/db/migrations/0037_*.sql` + journal; `admin-web/features/features/lib/feature-meta.ts`; `admin-api/modules/tenants/tenants.repo.ts:33-37`; `hub-api/modules/seed/seed.tenant-fixtures.ts`; `packs/kit/adapters/pack-guard.middleware.ts:100` (mô tả); `capabilities.rules.test.ts`, `feature-assign.test.ts`, `e2e/{app-config.spec.ts,journey-approval/*}` (qc), i18n vi/en (nhắc engine feature); check trong `ops/adapters/checks/flow-coverage.check.ts` + `registry.ts`. · Xong khi: int migrate (không còn feature/entitlement engine; mọi feature có `app` hợp lệ; backfill `han-muc-duyet → contracts`); grep không còn tham chiếu feature engine hay suy app từ tiền tố; ops check đỏ khi lệch; Opus low soát. · Perf: migration set-based, một câu mỗi bảng.
- **c16** · File: admin-web `features/ai-tools/**` (mới), `features/workflows/{components/list/*,lib/usage.ts,hooks/use-workflows-nav.ts}`, `features/tenants/{components/tools/{ToolRow,ToolOffDialog}.tsx,hooks/use-tenant-tools.ts,lib/workspace-tabs.ts,pages/TenantDetailPage.tsx (chỉ dòng tab),api.ts (chỉ hàm tools)}` (gỡ tab `workflow-tools`); admin-api `modules/workflow-tools/{adapters/workflow-tools.{routes,repo,mapper}.ts,application/workflow-tools.usecase.ts}` (thêm đọc gộp "Dùng bởi", platform_admin only, role khác 403). · Xong khi: unit lib; int "Dùng bởi" (một câu SQL) + 403 role khác; e2e D5 (qc) bật/tắt Dify theo công ty; grep mọi chỗ đọc tab cũ liệt kê trong báo cáo. · Perf: đọc theo tập, số câu cố định.
- **c11** · File: `features/tenants/flows/**` (mới), `features/processes/lib/view-mode.ts` + test (Q11), chuyển `SlotRouting`/`RoutingRules`/`useSlotRoutingActions` về đây, gỡ `TenantProcessSlots` khỏi thẻ app (chỗ gán cũ khác tạm import vị trí mới, gỡ ở c13). Ngăn "Mở trình sửa"/xem mặc định canvas. · Xong khi: unit hàng việc/trạng thái+lý do + `view-mode`; e2e D5 hành trình gán (platform_admin, không seed bật sẵn) + tenant_admin Sao chép/Gán (qc, `e2e/cr121-c-flows.spec.ts`); sửa `_journey.ts:57`, `flows.cs.ts:32`, `tenant-routing.pa.ts:90`; báo cáo liệt kê mọi chỗ đọc `TenantProcessSlots`. · Perf: không chạm đường nóng; không truy vấn từng hàng.
- **c12** · File: `features/tenants/apps/**`, `LevelControl`, i18n `tenants.apps.*`. · Xong khi: unit LevelControl (cắt + tooltip, ⓘ); bảng đọc cột `app` (c18); dải Cần xử lý mở ngăn Gán; qc sửa `app-config.spec.ts:108/163`, `feature-ui.spec.ts:69`. · Perf: không chạm đường nóng.
- **c13** · File: `features/apps/**` (`/apps/$appKey`), `features/processes/**` (`flowsMode`, `RulesPanel`). · Xong khi: grep sạch `useSlotRoutingActions`/`flowsMode` ngoài tab Quy trình (liệt kê); unit chuyển hướng `/apps/$appKey?tab=…`, `/processes?tenant=`. · Perf: không chạm đường nóng.
- **c14** · File: `features/tenants/{pages/TenantDetailPage.tsx,lib/workspace-tabs.ts,settings/**,members/**}`, chuyển hướng `?tab=` cũ. · Xong khi: unit `workspace-tabs.test.ts`; qc sửa `groups-*.spec` (14 dòng), `stg/smoke.stg.ts:164`, `deployed/20-flows-visible.ro.deployed.ts:52-58`; e2e D5 tenant_admin 5 tab. · Perf: không chạm đường nóng.
- **c15** · File: `features/processes/components/library/{LibraryListCells,LibraryToolbar,LibraryFilter,LibraryEditorBody}.tsx` (cột Các bước/Dùng bởi/Cập nhật, tìm, lọc; chi tiết canvas mặc định). · Xong khi: unit lib; e2e viết (cuối đợt). · Perf: không chạm đường nóng.
- **c17** · File: `features/processes/components/{editor/{StagesCard,EditorRunsTab,DefInfoCard}.tsx,library/{LibraryEditorBody,FlowStatusBar,CloneDialog,PublishDialog,FlowStepCard}.tsx,canvas/{ProcessCanvas,CanvasView,CanvasToolbar}.tsx}`; `packages/flow-canvas/src/{mode.ts,layout/vertical.ts}` chỉ nếu đối chiếu artboard lệch; nút "Sao chép cho công ty này" gọi `clone-for-company`. · Xong khi: unit; e2e chỉ xem canvas + Sao chép (200 lần 2) viết sẵn. · Perf: không chạm đường nóng.
- **c19** · File: `ops/adapters/checks/app-roles.check.ts` (mới) + `registry.ts`. Quy tắc 1,3,4,5 = lỗi; quy tắc 2 = cảnh báo (spec D2). · Xong khi: int từng quy tắc (đỏ/xanh). · Perf: một câu SQL theo tập, không lặp theo tenant.
- **c20** · File: `packages/db/migrations-pack-contracts/0076_*.sql` (+ trigger `brand_config_bump`), `packages/contracts/src/pack-contracts/company.ts`, `hub-api/modules/packs/contracts/{brand.mount.ts,adapters/company.repo.ts,adapters/extraction.repo.ts,application/extraction.ports.ts}`, `seed.tenant-fixtures.ts:142`, `tools/scripts/src/{seed-demo-v2,demo-ai-fix}.ts`, test HD9/V2-L/CR118 liên quan (qc), `ops/.../tenant-profile.check.ts` (mới) + `registry.ts`. `/pack/me` đọc tên qua tenant của phiên (RLS). · Xong khi: int backfill; int đổi tên ở admin ⇒ `/pack/me` đổi ETag; int chặn đọc chéo tenant; Opus low soát. · Perf: migration set-based; `/pack/me` giữ một câu cố định.
- **c21** · File: `hub-api/src/config/{env.ts,env-deps.ts}`, `modules/notify/notify.mount.ts`, `.env.example`, `deploy/prod-sohoptac2/README.md`, `ops/.../notify-config.check.ts` (mới) + `registry.ts`. · Xong khi: int seed-một-lần idempotent (không ghi đè secret có sẵn); check cảnh báo khi secret trống. · Perf: một câu SQL theo tập.

## Không làm / Chạm
Engine D, DLC (`dlc:check` giữ seam), Community, Tpl-Run logic. Không chạy e2e trong lát; e2e + `test:all` một lần cuối đợt.

## Test tối thiểu
Lát này (chỉ tài liệu): `bun run openspec:check`.

## Quyết định trong lúc làm
- c16 trước c11 (D6); "Sao chép cho công ty này" tự gán thay bản cũ (Q9); tenant_admin Xem + Sao chép + Gán/Đổi công ty mình, tenant lạ 404, member 403 (Q8); canvas mặc định (Q11); D2 vai hub = `admin.users.role` (quy tắc 2 = cảnh báo), D3 tên công ty = `admin.tenants.name`, D4 kho secret Hub — người dùng chốt.
- Đường đọc chỉ-xem `GET /tenants/:tid/process-library/:id` là tên do spec đặt (người dùng chốt "đường đọc chỉ-xem theo tenant"), c9 có thể đổi tên nếu trùng quy ước, giữ nguyên ngữ nghĩa vai.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: lát chỉ thêm spec + kế hoạch cho CR-121 C; hành vi đổi ở các lát c9…c21, mỗi lát tự ghi Delta)

## Việc còn lại
Giao c9 ‖ c10 ‖ c18; sau c10 giao c16; sau c9+c16 giao c11; rồi c12 → c13 → c14; c19 → c20 → c21 theo `registry.ts`; c15 → c17.
