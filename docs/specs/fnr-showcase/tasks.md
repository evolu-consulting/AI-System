---
id: fnr-showcase
lát: fnr-showcase
cr: CR-103
làn: nhanh
migration: không
phụ thuộc: flow-node-registry R1 (registry), R2 (node if) — wiring ở phase B
---
## Plan (ngắn)
Hai phase. **Phase A (làm xong, chạy song song với R1/R2):** phần thuần của node `set`, seed flow mẫu, trang showcase, điều
tra mở băng. Không đụng file R1/R2 đang sửa. **Phase B (sau khi R1 + R2 gộp):** nối dây `set` vào engine/contract/FE registry,
mở băng route cho admin-web, chạy thật. Spec: `docs/specs/flow-node-registry/` (proposal R4, design §4).

## Làm
Phase A (xong):
- [x] Contract `packages/contracts/src/hub-admin/process-set.ts`: `SetExecutorSchema` ≤ 20 dòng (`input` | `const`), `FLOW_SHOWCASE_KEY`; export qua `hub-admin/index.ts`. CHƯA vào union `executor`.
- [x] BE thuần `hub-api/.../processes/domain/set/set.rules.ts`: `setFields`, `setDefIssues` (luật `SET_INVALID`, chưa vào `PROCESS_DEF_RULES`) + unit table-driven.
- [x] FE `components/editor/StageSet.tsx` (editor node `set`, chưa nối `StageForm`) + chuỗi i18n vi/en `process.admin.editor.stage.set.*`.
- [x] Seed `tools/scripts/src/seed-flow-showcase.ts` (+ `.build.ts` thuần): cờ `--apply`, `--i-know-prod`, chỉ tenant `demo`, dry-run in def; cờ nhóm `--legal-group` (mặc định `pb-kinh-doanh`, demo chưa có Pháp chế riêng), `--accounting-group` (`pb-ke-toan`), `--director-group` (`pb-giam-doc`).
- [x] Trang admin-web `/processes/showcase` (`routes/_authed/processes/showcase.tsx`, `pages/ShowcasePage.tsx`, `components/showcase/*`, `hooks/use-showcase.ts`, `lib/showcase.ts`): canvas chỉ đọc (dùng lại `CanvasView` + `readOnly` có sẵn, không sửa canvas), form input + "Chạy thử", `RunProgress`/`RunLog`/`RunActions` (Đạt/Chưa đạt), ô "Đổi node" liệt kê họ node (R3 nối `canSwap`). Sửa nhỏ `api.ts`: `runDef(..., inputs?)`, `useRun(..., pollMs?)`. `routeTree.gen.ts` thêm tay theo mẫu `processes/new`.
- [x] e2e viết sẵn `e2e/fnr-showcase/showcase.fnr.ts` (không chạy; cần phase B + seed; chưa có `playwright*.config.ts` ⇒ phase B thêm hoặc đưa vào config sẵn có).

## Không làm / Chạm
Không sửa (R1/R2 đang làm): `processes/runs/`, `defs/def.rules.ts`, `defs/defs.service.ts`, `nodes/`, `application/ports.ts`, `modules/kh/`, `stage-convert.ts`; không thêm `set` vào union executor; không mở băng, không đổi `processes.mount.ts`/`app.ts`/`nav.ts`; không chạy seed `--apply`.

## Test tối thiểu
- Unit: `domain/set/set.rules.test.ts` (11 ca: ép số, thiếu input, key chưa khai/trùng, input lạ, lệch kiểu, hằng lệch kiểu, trần 20 dòng) và `lib/showcase.test.ts` (5 ca). Xanh; tsc contracts/hub-api/admin-web/scripts sạch.
- e2e: viết, không chạy (Luật 0b).

## Quyết định trong lúc làm
- `set` đặt schema ở file riêng + export ở `hub-admin/index.ts` (không sửa `processes.ts` để khỏi đụng R2); phase B thêm vào union và `PROCESS_DEF_RULES`.
- Luật def trả `SET_INVALID` cục bộ; ép số cho field `number`: input không phải số ⇒ bỏ dòng (kiểm kiểu ở lúc lưu def + lúc start).
- Giá trị input kiểu `number` gửi `{type:"number", value}` (đúng `ProcessInputValueSchema`); `input` văn bản để rỗng.
- Canvas chỉ đọc dùng `readOnly` sẵn có + `ops` no-op (Proxy) vì `CanvasHandlers.ops` bắt buộc; không đổi canvas.
- Làm tươi tiến độ bằng polling 1,5 s tới khi run kết thúc (admin chưa có stream; `useRun` thêm tham số tuỳ chọn). Không có chờ ngủ trong code ngoài `refetchInterval` của react-query.
- Def mẫu stage `if` dùng `output` tối thiểu (template/section/fields rỗng) — chỉnh theo hình dạng R2 chốt (contract cho phép rỗng khi `kind=if`).
- Pháp chế: demo chưa có nhóm riêng ⇒ mặc định `pb-kinh-doanh`, đổi bằng cờ.

### Điều tra mở băng `/process-defs*`, `/process-runs*` cho admin-web (chưa làm)
- Hub: `createApp` → `mountProcesses({ publicRoutes: deps.frozenModules !== false })` (`app.ts:204`, `processes.mount.ts:126`); `HUB_FROZEN_MODULES=off` (mặc định) ⇒ `mountRoutes` KHÔNG mount (404). `mountRoutes` gộp 6 bộ route: runs, gates, asks, inbox, usage, defs. Engine/vòng nền vẫn chạy (không phụ thuộc cờ).
- Admin-web: `probeEngine` trả `off` khi `PUBLIC_FROZEN_MODULES!=on` (`features/processes/api.ts`); `guard.ts` redirect `/` khi `isFrozenPath` (`shell/lib/nav.ts`). Chỉ gửi `X-App` cho `/auth/*`, KHÔNG gửi cho gọi Hub ⇒ không thể dùng `X-App` làm cổng (client tự khai, giả được). Cổng thật = role trong JWT.
- Đã có sẵn: `defsRoutes` gắn `requireAdminRole()` cho `/process-defs*`, `/agent-teams`, `/process-editor/context` (member ⇒ 403). `/process-runs*` phục vụ cả chat-web (member xem run `access: task`) nên cần cổng role khi mở cho admin.
- Đề xuất tối thiểu (phase B, kèm test): `publicRoutes` đổi thành `"off" | "admin" | "all"`; `frozenModules` bật ⇒ `all`, tắt ⇒ `admin`: chỉ mount `defsRoutes` + `processRunsRoutes` (+ `gatesRoutes` nếu nút Đạt/Chưa đạt đi qua đó) sau `r.use(prefix, requireAdminRole())` cho `/process-runs*`; `asks`, `inbox`, `usage` và mọi route chat-web giữ đóng băng. FE: `PUBLIC_FROZEN_MODULES` giữ nguyên cho chat-web; admin-web bỏ điều kiện `frozenModulesOn` trong `probeEngine` + cho `/processes/showcase` (và `/processes*`) khỏi `isFrozenPath`. Test: int member ⇒ 403 `/process-runs/:id`; admin ⇒ 200; chat-web route `/process-inbox` vẫn 404; tenant_admin không đọc tenant khác. Cập nhật `docs/platform/modules.md`. Rủi ro an ninh (đổi mô hình cách ly) ⇒ làn đầy đủ, Opus, không làm trong phase A.

## Việc còn lại
Phase B (xong, sau R1 + R3 + unfreeze gộp):
- [x] `set` vào union executor + `EXECUTOR_KINDS` + `NODE_FAMILY_OF`/`NODE_PRODUCES` + `SET_INVALID`; `nodes/set` (NodeSpec + launcher đồng bộ: ghi output + fields, done, không `hub.runs`); `SnapStage` có `set`.
- [x] Sửa lõi tối thiểu: `runs/launcher.ts` cho `more` của node thắng (`{ more, ...launch }`) — node chạy đồng bộ xong stage thì kick bước kế (nếu không run kẹt ở bước sau).
- [x] FE registry `set` (`lib/set-form.ts`, `StageSet` nối trong `StageForm`, `stage-convert`, `stageViews` nhãn `set`, khoá i18n kind/err); `NodeSwapBox` dùng `canSwap` (chỉ đọc, không lưu).
- [x] Int `tests/acceptance/fnr-showcase/set.int.test.ts` (fields đúng, run done, 0 `hub.runs`).
- [x] Seed căn theo hình `if` của fnr-if (`when{op,conds[{from{kind:input|field}}]}`, `then_step/else_step`); dry-run chỉ còn lỗi `stages.3.executor.kind` (đợi fnr-if gộp); UUID Group dry-run giả cố định.
- Trang showcase đã bọc `ProcessRouteGate`; không dùng `/admin/sources*`.
Còn lại:
1. Sau khi fnr-if gộp: dry-run phải sạch; chỉnh `output` của stage `if` nếu R2 đòi; seed demo `--apply` (cần user xác nhận).
2. e2e `showcase.fnr.ts`: thêm `playwright*.config.ts` (cần stack + seed) và chạy một lần cuối đợt.
3. Ghi `docs/platform/modules.md` nếu chưa (do fnr-unfreeze).
## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED engine/flow-engine.md
#### Yêu cầu: Node set và trang showcase
Node `set` ghi field từ input run hoặc hằng, không gọi AI; trang `/processes/showcase` của admin-web vẽ flow mẫu, chạy thử và duyệt tại chỗ.
- Kịch bản: khi admin bấm "Chạy thử" với số tiền 150.000.000 và mục đích "mua sắm" thì sau hai bước duyệt song song run tới "Giám đốc duyệt"
- Kịch bản: khi số tiền 50.000.000 thì run đi nhánh else "Hoàn tất"
- Kịch bản: khi dịch vụ AI tạm ngưng thì flow mẫu vẫn chạy hết