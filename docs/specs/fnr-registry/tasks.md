---
id: fnr-registry
lát: fnr-registry
cr: CR-103
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
R1 của CR-103 (`docs/specs/flow-node-registry/design.md` §1, §2): tách nhánh `executor.kind` của engine quy trình ra
registry loại node, **không đổi hành vi**. Lõi hỏi registry (cờ năng lực / hook), không so kind, không import
`nodes/<kind>/*`.

## Làm
- [x] Contracts `hub-admin/node-family.ts`: `NodeFamily` (work/wait/apply/control), `NODE_FAMILY_OF`, `nodeFamily()`,
  `hasNodeFamily()` (thuần, dùng chung FE/BE; R3 thêm `canSwap` ở đây). Không đổi schema zod.
- [x] BE `processes/nodes/`: `types.ts` (`NodeSpec`), `registry.ts` (thuần: `nodeSpecOf`, `agentIdOf`, `runsAsAgent`,
  `gatesRealAction`, `executorRefMiss`, `nodeDefIssues`, `normalizeStage`, `toolKeysOf`), `registry.launch.ts`
  (`nodeLauncherOf` → `prepare?`/`launch`), mỗi loại `nodes/{agent,team,tool,wait-until,apply}/{node,launch}.ts`.
- [x] `runs/launch-common.ts`: phần launcher dùng chung (`KickResult`, `LaunchCtx`, `launchStage`, `markStageRunning`,
  `lostPermission`) chuyển nguyên văn từ `launcher.ts`; `launcher.plan` giữ thứ tự starterUsable → prepare (team) → launch.
- [x] Đổi điểm gọi: `def.rules` (ref executor, luật team/tool, `ensureHandoff`, `withHandoff`), `defs.service`
  (key tool), `launcher-session` (phiên agent), `launcher-step` (cổng hành động thật, preconfirm), `view-apply`,
  `view-autofix`, `view.service` (họ `apply`), `kh.start`, `kh.summary.rules`.
- [x] Chuyển `defs/wait-stage.rules.ts` → `nodes/wait-until/`; `ensureToolStage` + luật D2-14 → `nodes/tool/node.ts`.
- [x] FE `features/processes/nodes/registry.ts` (kind, family, labelKey, defaults(), draftExecutor/draftValue, fromDef,
  toDef) + `draftKindOf`; `lib/stage-convert.ts` đọc từ đây. Không đổi UI.

## Không làm / Chạm
- Không đổi API / schema zod / DB / RLS; không migration. Không sửa test khoá.
- Còn so kind ngoài `nodes/` (có lý do): `runs/apply-driver.ts` (driver riêng của Áp, chạy từ sweep),
  `runs/team-exec.ts` (runner riêng của nhóm), `stage-driver.ts`/`team-runner.ts` (chỉ truyền giá trị kind, không rẽ
  nhánh), `application/ports.ts` (chú thích). FE: `StageGeneral.tsx`, `stage-view.ts`, `*-form.ts` giữ hằng `*_EXECUTOR`
  (UI, ngoài phạm vi R1).
- Module node gọi helper trong `runs/` (launch-common, wait-launch, apply-launch, team-load…) — chưa tách hẳn sang
  `core/ports` như design §1 (R1 chỉ chuyển nguyên văn).

## Test tối thiểu
- Unit `nodes/registry.test.ts` (BE): mọi kind của union contract có `NodeSpec` + `NodeLauncher` + họ khớp; ranh giới
  import (file ngoài `nodes/` trong `hub-api/src/modules` và `admin-web/.../processes` không import `nodes/<kind>/*`).
- Unit `features/processes/nodes/registry.test.ts` (FE): mọi kind có `FeNode`, `draftKindOf`.
- Lưới an toàn: unit + int processes/kh hiện có, `test:frozen`.

## Quyết định trong lúc làm
- Tách registry làm hai file: `registry.ts` (thuần, `def.rules` dùng — không kéo DB/driver, tránh vòng import) và
  `registry.launch.ts` (launcher dùng). Test ranh giới cho phép `nodes/registry*`.
- Hook tối thiểu theo người gọi thật: `agentId`, `realAction`, `handoff`, `refMiss`, `defIssues`, `normalize`, `toolKey`,
  `prepare`, `launch`. Chưa có `settle`/`view`/`session` riêng (view Áp dùng `hasNodeFamily(…, "apply")`; phiên agent
  dùng `agentIdOf`). `produces` khai sẵn cho R3.
- Thứ tự lỗi INVALID giữ nguyên nhờ `NODE_LIST` cố định (team trước tool).
- `markStageRunning`: guard `agent|tool` → `gatesRealAction` (agent/apply/tool) — tương đương vì Áp không gọi hàm này và
  team luôn `real = null`.
- Không có `*.perf.int.test.ts` trong processes/kh ⇒ không có số perf trước/sau; refactor không thêm câu SQL nào.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-30 (đợt CR-103)

Không thay đổi hành vi (lý do: tách loại node ra registry, hành vi engine giữ nguyên; yêu cầu nằm ở docs/specs/flow-node-registry)

## Việc còn lại
- R2 node If, R3 `canSwap`, R4 node `set` + showcase (CR-103).
