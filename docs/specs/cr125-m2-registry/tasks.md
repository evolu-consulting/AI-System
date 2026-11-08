---
id: cr125-m2-registry
lát: cr125-m2-registry
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: cr125-m1
---
## Plan (ngắn)
Sổ module máy chủ ở kit (`moduleRegistry`): gói đăng ký xử lý theo khoá module/node/sự kiện; cuối `mountPacks` gọi `verify` đối chiếu `MODULES` (m1) bằng `moduleIssues`. Thiếu ⇒ ném tại khởi động.

## Làm
- `kit/application/module.ports.ts` (NodeBinding, EventBinding, ModuleRegistry), `kit/adapters/module-registry.ts` (`createModuleRegistry`, `moduleRegistry`), xuất qua `kit/public.ts`.
- Đăng ký hộ sổ cũ, hành vi không đổi: `esign.mount` (validator tool → `nodeConfigRegistry.registerTool`), `flow-events.mount` (contracts FactsReader + OutcomeHandler), `community-flow.mount` (community readers/handler + node `show-post`), `intake.mount` (tool bước + node Ký số, `options_path`).
- `packs.modules-check.ts`: `mountedApps` + `verifyPackModules`; `packs.mount.ts` gọi một dòng cuối mount (trước `afterPacksMounted`).
- Tín hiệu chờ: `esign.completed/declined/voided` chuyển từ `events` sang `AppManifest.signals` (không dữ kiện/kết quả, không vào «Bắt đầu khi»); `moduleIssues` bỏ qua EVENT/OUTCOME_UNBOUND cho tín hiệu, tín hiệu không node nào chờ ⇒ `MOD_SIGNAL_ORPHAN`. Không có def/seed/migration nào bắt đầu bằng chúng (chỉ `wait_event`).
- contracts `orphanIssues`: khoá node không có dấu chấm ⇒ app `unknown`.

## Không làm / Chạm
Không đụng admin-web, tools/scripts (m3), packs/dlc, domain community, engine/FlowDef, DB. Core là bước cơ bản (`kind: base`) không cần binding. Cổng cấu hình ký số (`configPort` = schema args) nối ở m4: `argsSchema` chưa khai nên chưa kiểm `MOD_PORT_MISMATCH` cho Ký số.

## Test tối thiểu
- unit: `kit/adapters/module-registry.test.ts`, `packs.mount.test.ts` (verify lỗi ⇒ ném), `packages/contracts/src/modules/modules.rules.test.ts` (unknown).
- int: `packs.module-registry.int.test.ts` (mount thật: `MODULES` × binding thật ⇒ 0 lỗi, không báo giả).

## Quyết định trong lúc làm
- Sổ là singleton process (như `flowPortRegistry`); `verify` lọc theo app đang gắn (`mountedApps`: core luôn, contracts theo cờ, community cần DB) để mount một phần không báo thiếu/thừa giả.
- Perf: verify một lần lúc khởi động, O(node + sự kiện) (~10 node, ~8 sự kiện); không có SQL.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt CR-125 cuoi dot)

### ADDED engine/so-module-khoi-dong.md
#### Yêu cầu: Kiểm module lúc khởi động
Khi hub khởi động, sau khi gắn mọi gói, sổ module đối chiếu khai báo node/sự kiện (`MODULES`) với xử lý máy chủ đã đăng ký; có bất kỳ lỗi nào thì hub không lên, nêu số lỗi và từng câu tiếng Việt kèm cách khắc phục.
- Kịch bản: khi binding Ký số hoặc xử lý sự kiện bị gỡ thì khởi động ném «Khởi động dừng: N lỗi module» kèm câu MOD_UNBOUND tiếng Việt [test: apps/hub-api/src/modules/packs/packs.mount.test.ts » binding Ký số / sự kiện bị gỡ ⇒ ném câu «Khởi động dừng» + MOD_UNBOUND tiếng Việt]
- Kịch bản: khi đủ binding thì sổ không báo lỗi và không ném [test: apps/hub-api/src/modules/packs/kit/adapters/module-registry.test.ts » đủ binding ⇒ không lỗi, không ném]
- Kịch bản: khi gắn gói thật (contracts, community) thì khai báo `MODULES` với binding thật không có lỗi giả [test: apps/hub-api/src/modules/packs/packs.module-registry.int.test.ts » mountPacks (contracts + community) không ném, MODULES × binding thật ⇒ 0 lỗi]
- Kịch bản: khi chỉ gắn một phần app thì khai báo và binding của app không gắn bị bỏ qua [test: apps/hub-api/src/modules/packs/kit/adapters/module-registry.test.ts » apps lọc cả khai báo lẫn binding: app không gắn ⇒ bỏ qua]
- Kịch bản: khi binding lặp cùng khoá hoặc đăng ký hộ thì sổ cũ (bộ đọc, xử lý kết quả, validator) nhận đúng đối tượng như trước [test: apps/hub-api/src/modules/packs/kit/adapters/module-registry.test.ts » bindEvent/bindNode chuyển nguyên đối tượng cho flowPortRegistry/nodeConfigRegistry, gộp tool khi bindNode lặp]
- Kịch bản: khi có binding cho khoá node không dấu chấm thì lỗi ORPHAN ghi app «unknown» [test: packages/contracts/src/modules/modules.rules.test.ts » MOD_ORPHAN_BINDING: khoá node không có dấu chấm ⇒ app «unknown»]

- Kịch bản: khi tín hiệu chờ ký số không có node nào chờ thì báo MOD_SIGNAL_ORPHAN, còn tín hiệu có node chờ thì không cần binding hay dữ kiện [test: packages/contracts/src/modules/modules.rules.test.ts » tín hiệu chờ: không cần binding/dữ kiện, phải có node chờ (wait_event.event/also_events/exits.on) — không thì MOD_SIGNAL_ORPHAN]

## Việc còn lại
- m4: `configPort` Ký số = schema args tool ⇒ `argsSchema` vào `bindNode` (bật kiểm MOD_PORT_MISMATCH thật); m5: binding bước cơ bản core.
