---
id: cr121-c
lát: cr121-c
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: spec docs/specs/cr121-c/spec.md
---
## Plan (ngắn)
Chia phần C còn lại thành 9 lát c9…c17 (≤ 60 phút/agent, Sonnet; Opus low soát c9). Spec: `spec.md` (R1–R9, Q1–Q7). Không migration.

## Lát
| Lát | Đợt | Artboard | Loại | Phụ thuộc | File sở hữu (không lát song song nào dùng chung) |
|---|---|---|---|---|---|
| c9 · API lượt chạy theo slot/def + sao chép thư viện→công ty (tự gán thay bản cũ, idempotent, audit) | 1 | — (cấp API cho Tpl-Editor, CompanyFlows) | API (hub-api + contracts) | — | `packages/contracts/src/chat/processes-api.ts`, `apps/hub-api/src/modules/processes/{core,runs}/*list*`, `defs/defs.{routes,service}.ts`, routing luật định tuyến, test int mới. Sonnet high + Opus low soát tenant/đường ghi |
| c10 · Nav 6 mục | 1 | `Main` | UI | — | `apps/admin-web/src/features/shell/lib/nav.ts` + `nav.test.ts`, route `/ai-tools` (chuyển hướng tạm → /workflows), redirect `/commands` `/agents` |
| c16 · Công cụ AI (+ bật/tắt Dify theo công ty, "Dùng bởi") | 1→2 (sau c10, trước c11 — D6 gỡ tab `workflow-tools` cùng lát; người dùng đã đồng ý lệch thứ tự intake) | `AiTools` | UI + API đọc "Dùng bởi" | c10 | `apps/admin-web/src/features/{ai-tools,workflows,commands,agents}/**`, tab `workflow-tools` trong `features/tenants/` (chỉ file panel + dòng registry), hub-api module đọc gộp |
| c11 · Công ty › Quy trình | 2 | `CompanyFlows`, `Tpl-Detail` | UI | c9, c10, c16 | `features/tenants/flows/**` (mới), chuyển `SlotRouting`/`RoutingRules`/`useSlotRoutingActions` về đây (D6) + gỡ `TenantProcessSlots` khỏi thẻ app; chỗ gán cũ khác tạm import vị trí mới (gỡ ở c13) |
| c12 · Công ty › Ứng dụng bảng + LevelControl + ⓘ | 3 | `Company` | UI | c11, c18 | `features/tenants/apps/**`, `LevelControl`, i18n `tenants.apps.*` |
| c13 · Gỡ chỗ gán 3, 4 + chuyển hướng app/processes | 3 (nối tiếp c12) | `Library` (phần gỡ flowsMode), — | UI | c11, c12 | `features/apps/**` (`/apps/$appKey`), `features/processes/**` (`flowsMode`, `RulesPanel`) |
| c14 · 5 tab công ty (platform_admin + tenant_admin) | 3 (nối tiếp c13) | `Tpl-Settings` | UI | c12, c13, c16 | `features/tenants/{TenantDetailPage,tabs,settings,members}/**`, chuyển hướng `?tab=` cũ; e2e tenant_admin |
| c15 · Thư viện đối chiếu | 4 | `Library` | UI | c13 | `features/processes/library/**` (cột Các bước/Dùng bởi/Cập nhật, tìm, lọc) |
| c17 · Trình sửa đối chiếu + chỉ xem + "Sao chép cho công ty" | 4 | `Tpl-Editor` (đối chiếu `Tpl-Run`) | UI | c9, c11, c15 | `features/processes/editor/**`, `packages/flow-canvas` (chỉ phần soi lệch), i18n `process/admin.*` |

**Làn dữ liệu (Luật GỐC 1; spec mục "Một nguồn dữ liệu")**
| Lát | Đợt | Mục | Loại | Phụ thuộc | File sở hữu |
|---|---|---|---|---|---|
| c18 · gỡ `contracts-approval-engine` + cột `admin.features.app` | 1 | D1, D5 | migration admin **0037** + admin-api + admin-web (features/lib) — Sonnet high, Opus low soát diff dữ liệu/RLS | — | `packages/db/migrations/0037_*.sql` + journal, `apps/admin-api/src/modules/{tenants,features}/**`, `admin-web/features/features/lib/feature-meta.ts`, `hub-api/.../seed.tenant-fixtures.ts`, fixture/test/i18n nhắc engine feature, check mới trong `flow-coverage.check.ts` + `ops/.../registry.ts` |
| c19 · vai app ↔ vai hub: check đối chiếu (vai hub = `admin.users.role`) | 2 | D2 | int + ops check | c18 | `ops/adapters/checks/app-roles.check.ts` (mới), `registry.ts` |
| c20 · tên công ty một nguồn: gỡ `company_name` khỏi `contracts.company_settings` | 2 | D3 | migration pack-contracts (số do điều phối giao) + backfill + chuyển chỗ đọc + check — Sonnet high, Opus low soát dữ liệu | c19 (cùng `registry.ts`) | `packages/db/migrations-pack-contracts/` (mới, sửa trigger `brand_config_bump`), `packages/contracts/src/pack-contracts/company.ts`, module cài đặt công ty/`/pack/me` của contracts, `seed-demo-v2.ts`, `demo-ai-fix.ts`, test HD9/V2-L/CR118 liên quan (qc), `ops/.../tenant-profile.check.ts` (mới), `registry.ts` |
| c21 · cấu hình mail một nguồn (kho secret Hub) | 3 | D4 | config + ops check | c20 | `hub-api/src/config/env.ts`, `env-deps.ts`, `modules/notify/notify.mount.ts`, `.env.example`, `deploy/prod-sohoptac2/README.md`, `ops/.../notify-config.check.ts` (mới), `registry.ts` |
c12 (bảng Công ty › Ứng dụng) và Q-1 đọc cột `app` ⇒ c12 phụ thuộc thêm c18. c18 chạy ‖ c9, c10 (file không chung).

Nối tiếp bắt buộc (cùng vùng): c11 → c12 → c13 → c14 (đợt 3 tuần tự). Song song được: c9 ‖ c10; c15 ‖ c17 chỉ khi không chung `features/processes/` (c15 = library/, c17 = editor/ ⇒ được). Điểm nóng chung `packages/i18n` vi.json/en.json: lát song song dùng namespace riêng, merge driver JSON xử lý.

## Chi tiết mỗi lát (xong khi)
- **c9** unit schema + MỘT int mỗi endpoint mới (lọc slot/def; sao chép thư viện→công ty) + MỘT test chặn đọc chéo tenant. Perf: đọc theo tập, số câu SQL cố định, index theo (tenant, slot).
- **c10** `nav.test.ts` cập nhật; unit chuyển hướng URL cũ. Perf: không.
- **c16** unit lib; int "Dùng bởi" (một câu SQL); e2e viết (không chạy) bật/tắt theo công ty. Gỡ tab `workflow-tools` cùng lát (grep mọi chỗ đọc, liệt kê).
- **c11** unit lib hàng việc/trạng thái+lý do; e2e viết lại các điểm gán (`_journey.ts:57`, `flows.cs.ts:32`, `tenant-routing.pa.ts:90`) do qc. D6: báo cáo liệt kê mọi chỗ đọc `TenantProcessSlots`.
- **c12** unit LevelControl (cắt + tooltip); e2e `app-config.spec.ts:108/163`, `feature-ui.spec.ts:69` do qc.
- **c13** grep sạch `useSlotRoutingActions`/`flowsMode` ngoài tab Quy trình; chuyển hướng `/apps/$appKey?tab=…`, `/processes?tenant=`.
- **c14** `workspace-tabs.test.ts`, `groups-*.spec` (14 dòng), `stg/smoke.stg.ts:164`, `deployed/20-flows-visible.ro.deployed.ts:52-58` do qc; e2e tenant_admin 5 tab.
- **c15/c17** unit lib; e2e viết (chạy cuối đợt); c17 e2e chỉ xem + sao chép.

## Không làm / Chạm
Engine D, DLC (`dlc:check` giữ seam), Community, Tpl-Run logic, migration. Không chạy e2e trong lát; e2e + `test:all` một lần cuối đợt.

## Test tối thiểu
Lát này (chỉ tài liệu): `bun run openspec:check`.

## Quyết định trong lúc làm
- c16 lên trước c11 (D6: chuyển công tắc Dify rồi gỡ tab cũ cùng lát); người dùng đã đồng ý.
- "Sao chép cho công ty này" TỰ GÁN thay bản cũ, một thao tác, audit, idempotent (người dùng chốt) ⇒ c9 là đường ghi dữ liệu: Sonnet high viết, **Opus low soát**.
- D2 vai hub = `admin.users.role`; D3 tên công ty = `admin.tenants.name`; D4 nguồn mail = kho secret Hub (env chỉ seed lần đầu) — người dùng chốt, không còn câu hỏi mở.
- Chưa có API "Dùng bởi"/sao chép thư viện→công ty (kiểm hub-api 2026-11-06): c9 và c16 thêm.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: lát chỉ thêm spec + kế hoạch cho CR-121 C; hành vi đổi ở các lát c9…c17, mỗi lát tự ghi Delta)

## Việc còn lại
Giao c9 ‖ c10; sau c10 giao c16; sau c9+c16 giao c11; tiếp c12 → c13 → c14; c15 ‖ c17.
