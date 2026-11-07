---
id: arch-a10-rest
lát: arch-a10-rest
cr:
làn: nhanh
migration: không
phụ thuộc: arch-a9-new-leaks
---
## Plan (ngắn)

Dọn nốt mọi mục baseline không thuộc DLC của `arch-a1-depcruise` (lát cuối). Sửa thật, không baseline.

## Làm

- `pack-no-platform-db-internals` (7): kit `adapters/pack-directory.ts` (xuất ở `kit/public.ts`) đọc hộ `admin.*`/`hub.*` — `deptHeadOf`, `activeUserOf`, `activeMembersAmong`, `internalMembersOfGroups`, `escalateTargetsOf`, `companyGroups`, `directoryRows`, `creatorDepartmentsOf` (+ `CREATOR_DEPARTMENTS_SQL`), `tenantFlowTriggersOn`. `esign-flow/esign-node/esign-sweep/flow-facts/manage.members/flow-events.mount` gọi kit (SQL giữ nguyên văn); `contract-flow.int.test` dùng `kit/testing/system-scope`.
- `ca-application-inward-only`: `PackNavViewer` (cùng hình `AuthUser`) khai trong `pack-nav.ports`.
- `no-routes-to-repo`: kiểu hàng Community chuyển `domain/flow-rows.types.ts` (repo re-export).
- `pack-no-hub-modules`: test phân loại lỗi tool chuyển sang `processes/domain/tools/pack-tool-error.test.ts`.
- admin-web `component-no-fetch` (6): `isApiError` ở `lib/errors`, hook `use-partner-data`, `use-run-live`.
- workspace-web legacy (3 + vòng): hook `errCodeOf`/`refreshCompany`, `usePartnerEvents`; kiểu `PartnerContactDraft` về `lib/contacts` (hết vòng với `api.ts`).
- `tests/acceptance/P-d` vòng: `_count.ts` lấy `Json` từ `P-a/_support/pa` (không đổi assertion); relock `tests/.lock`.
- Baseline 36 -> 15, toàn DLC.

## Không làm / Chạm

DLC còn lại (15): dlc-workspace vòng 1, `packs/dlc` cross-module-deep 10, ca-domain 2, `dlc.mount` hub-scope 1, `dlc.routes` admin-role.middleware 1. Không chạm canvas, `esign.repo`, `approval-engine-card.usecase`, `partner-send.repo`.

## Test tối thiểu

tsc hub-api/admin-web/workspace-web; `bun test` hub-api + web partners/ledger/processes (chỉ K1 T5g đỏ); int evotest 16 file (esign-*, contract-flow, flow-events, community-flow*, partner-*, flow-facts): 80 pass; 1 đỏ `flow-facts.repo.int › trần 20 bước (migration 0097)` đỏ cả trên gd0 (không phải của lát này).

## Quyết định trong lúc làm

- Kit làm "cửa đọc hộ" admin/hub cho gói (cùng khuôn `packHosts`/`packBell`), thay vì gói tự mở `hub-scope`.

## Delta (so với docs/current)
Không thay đổi hành vi (lý do: tách file/hook/cổng kit + sửa import; SQL và hành vi runtime giữ nguyên).
Trạng thái gộp: chưa gộp

## Việc còn lại

Chỉ các mục DLC (Rowan).