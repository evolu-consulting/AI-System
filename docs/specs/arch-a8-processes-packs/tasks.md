---
id: arch-a8-processes-packs
lát: arch-a8-processes-packs
cr:
làn: nhanh
migration: không
phụ thuộc: arch-a1-depcruise
---
## Plan (ngắn)

Dọn baseline depcruise lát 4 + 11 của `docs/specs/arch-a1-depcruise/tasks.md`: processes/seed/ops đi vào gói chỉ qua `packs/<gói>/public.ts` (luật thuần) hoặc `packs/<gói>/testing/` (chỉ test); phá vòng; test-kit ra khỏi mã production.

## Làm

- Lát 11: `launcher` <-> `launcher-batch` (tách `launcher-plan.ts`: `plan`/`launchAfterCommit`/`headOf`); vòng contracts `approval-engine-facts`<->`usecase`, `approval-engine.ports`<->`approval-flow.usecase` (tách `approval-flow.ports.ts`), `approval.usecase`<->`flow-submit` (tách `approval-act.types.ts`; `approval.usecase` vẫn re-export kiểu); `cr116-bench.harness.ts` chuyển vào `adapters/test/`; `test-support/slot-default.ts` dùng kiểu `Sql` của `postgres`; `community-optin.int.test` đi qua `processes/testing/slot-assign.ts`.
- Lát 4: `packs/contracts/public.ts` thêm luật thuần (`compileSlotStages`, `validateSlotBody`, `defaultSlotBody`, `APPROVAL_DEFAULT_DEF`, `esignEventOf`, `attentionOf`, `FLOW_ROUTE_*`); `packs/community/public.ts` mới (`communitySlotSpecs`); `packs/contracts/testing/index.ts` (mount, tool, usecase, repo cho int test của processes); luật `platform-no-pack-internals` miễn thêm `packs/<gói>/public.ts` và `packs/<gói>/testing/`; seed/ops/processes đổi import.
- Baseline: 156 -> 47 (sinh lại từ lần quét đầy đủ, không sửa tay).

## Không làm / Chạm

Không chạm `packs/dlc` (10 mục `cross-module-deep` còn lại), admin-web, `adapters/partner-*`, mã audit/sự kiện HĐ (cr125-audit-trail).

## Test tối thiểu

tsc hub-api; `bun test apps/hub-api` (đỏ có sẵn: seed.processes K1 T5g, registry.test ranh giới nodes — file partner/esign/intake mount có sẵn từ trước); int evotest 30 file (processes library/triggers, ops, seed, community-optin, contracts slot): 141 pass.

## Quyết định trong lúc làm

- `testing/` của gói được dùng làm khe cho int test của module khác (re-export mount/usecase/repo thật); `no-prod-import-testing` chặn mã production.

## Delta (so với docs/current)
Không thay đổi hành vi (lý do: refactor import/tách file kiểu + luật dependency-cruiser; runtime không đổi).
Trạng thái gộp: chưa gộp

## Việc còn lại

- 9 vi phạm có sẵn ngoài baseline từ trước lát này (partner-mailbox pack-no-platform-db-internals, admin-web StageForm, workspace-web partner-inbox) — của lát khác.
- `packs/dlc` cross-module-deep 10 (Rowan), `packs.filebox` cross-module-flat 2, ca-domain 11, pack-boundary 13, component-no-fetch 15, vòng dlc-workspace + P-d.