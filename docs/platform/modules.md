# Module nền tảng: đang dùng và đóng băng

> **Phạm vi (2026-11-08):** file này chỉ còn là bảng đóng băng/mở khoá module theo CR-095…CR-118 (một số dòng cũ về `processes`/`dlc` đã lỗi thời: CR-120..125 chuyển flow sang `company_flows` + module tính năng). Kiến trúc lớp, cửa `public.ts`, cưỡng chế và khuôn module tính năng: **[architecture.md](architecture.md)** (một nguồn).

CR-095 (người dùng duyệt 2026-10-19). App quản lý hợp đồng (contracts-web) là sản phẩm; Agent Hub giữ lại nhưng ở chế độ bảo trì tối thiểu.
**Đóng băng** = không xoá mã/bảng, không sửa trừ khi lát yêu cầu; route công khai và UI tắt mặc định bằng cờ; suite test ra khỏi cổng hằng ngày.
Bảng đã đối chiếu với mã (`apps/hub-api/src/app*.ts`, `apps/admin-api/src/app.ts`, import chéo giữa module).

Cờ (mặc định `off`; `.env.example` bật cho dev/test): `HUB_FROZEN_MODULES` (hub-api), `ADMIN_FROZEN_MODULES` (admin-api), `PUBLIC_FROZEN_MODULES` (build-time của admin-web, chat-web, studio-web); `HUB_PROCESS_ROUTES=off|admin|all` (hub-api, CR-103, vắng ⇒ theo `HUB_FROZEN_MODULES`).
`createApp` trong test in-process: vắng `frozenModules` ⇒ mount hết (test cũ giữ nguyên); `server.ts` luôn điền từ env.

| Module | Trạng thái | Lý do | Owner |
|---|---|---|---|
| hub-api `processes` — route editor/lượt chạy cho admin (`/process-defs`, `/agent-teams`, `/process-editor`, `/processes`, `/process-runs*` gồm usage/cancel/decide, `/review-tasks/:id/decision`) | **đang dùng (chỉ admin)** khi `HUB_PROCESS_ROUTES=admin` | CR-103 (fnr-unfreeze): editor quy trình + `/processes/showcase` của admin-web; chặn `requireAdminRole` ở gốc mọi tiền tố (role JWT, member 403). Vắng biến ⇒ theo `HUB_FROZEN_MODULES` (on ⇒ `all`, off ⇒ `off`). **Ràng buộc (fnr-fix-unfreeze):** ở `admin` người duyệt phải là admin VÀ thuộc Group duyệt (luật task không nới: tenant_admin ngoài Group ⇒ 404); member không có hộp việc; câu hỏi AI (asks) không trả lời được ⇒ lượt chạy chờ. `GET /process-defs` trả header `X-Process-Routes: admin` để editor cảnh báo | hub |
| hub-api `processes` — route chat-web (`/review-tasks/:id/answer\|forward`, hộp thư `/me/review-tasks`, `/me/process-inbox*`) | đóng băng | Không mount ở `admin`; chỉ `HUB_PROCESS_ROUTES=all` hoặc `HUB_FROZEN_MODULES=on` | hub |
| hub-api `processes` — engine, vòng nền, cầu `packRuns`/`packTools` (cờ `HUB_PROCESS_ENGINE`) | **đang dùng (nội bộ)** | Gói hợp đồng (HD2/HD3, N2) chạy qua engine tới khi lát M3 tách; không đổi cờ này | hub |
| hub-api `rooms` — route `/rooms*` | đóng băng | Chat người–người không thuộc sản phẩm | hub |
| hub-api `rooms` — dịch vụ + `RoomRunPoster` + `/directory` + `/me/stream` | đang dùng | `/me/stream` (stream realtime) và engine (`ThreadPoster`, `roomSender`) dùng chung dịch vụ | hub |
| hub-api `sources` — `/admin/sources*`, `/internal/jobs/:id/sources-resolved` | đóng băng | Chỉ phục vụ quy trình P-b | hub |
| hub-api `kh` — `/studio/api/kh/connections*` | đóng băng | Connector KnowledgeHub cũ | hub |
| hub-api `kh` — `KhRuntime`, `kh-query`, `khPrepareJob` | đang dùng (mã) | `mcp` và `runner` import trực tiếp; không có route công khai | hub |
| hub-api `dlc` — `/dlc/*` | **đã xoá** (bản dlc-dify, gộp 2026-10-30 qua `slice/integrate-prod`) | Module cũ + env `HUB_DLC_*` gỡ; thay bằng hub-api `dify-calls`, app `apps/dlc-workspace`, `tools/dlc-dify` (tài liệu của nhóm dlc-dify) | hub |
| hub-api `orchestrator` | **đang dùng** (không đóng băng) | `runDrivers` dùng làm vòng chạy run của chat; tách = đổi đường chạy chat | hub |
| hub-api `mention` (`@`, `directDriver`), `commands` (`/`) | **đang dùng** (không đóng băng) | `sendMessageRoutes` gọi `prepareMention`/`prepareCommand`; `app.runner` dùng `directDriver` | hub |
| hub-api autofix/runner P-c (`/internal/jobs/:id/source-credential`, `apply-result`) | đang dùng (không tách) | Route token-job nhỏ, không UI; gỡ cần sửa runner chung | hub |
| admin-api `workflows`, `workflow-tools`, `transfer` (export/import), `commands` | đóng băng | Cờ `ADMIN_FROZEN_MODULES` (route `/admin/workflows`, `/admin/commands`, `/admin/export`, `/admin/import`, workflow-tools) | admin |
| admin-web: Commands, Workflows, Transfer, Nguồn (nav + route) | đóng băng | Redirect về `/` khi `PUBLIC_FROZEN_MODULES` ≠ on | admin |
| admin-web: Quy trình (`/processes*`) | theo Hub lúc chạy | CR-103: không gate theo cờ build; dò `GET /process-defs` (200 ⇒ hiện nav + trang, 404 ⇒ ẩn/NotFound) | admin |
| chat-web: phòng, Users/Groups trong sidebar, hộp thư quy trình, Workspaces DLC | đóng băng | Ẩn sidebar + redirect `/rooms/:id`, `/process-inbox`; `useRoomList` không gọi API | chat |
| studio-web: Cài đặt KnowledgeHub (`/settings`) | đóng băng | Ẩn nav + redirect | hub |
| auth, tenants, users, groups, access, audit, quotas, secrets, identity-import, packs (gồm contracts), agents, agent-grants, conversations, runs/runner, mcp, dify, knowledge, notify, attachments, stream/me-stream, studio, seed, config | đang dùng | Lõi chung + sản phẩm hợp đồng + chat qua Agent Hub/Dify | core |

CR-102 (Community): gói mới `community` (đang dùng khi có) và user ngoài `admin.users.kind='external'`. `/directory`, `/me/stream`, kit members, pack guard, chat-gate, agent-grants, portal catalog phải lọc/chặn user ngoài (lát C2) — sửa lọc nhỏ, không mở lại module đóng băng (`processes`/`rooms`/`dlc`); không cần `test:frozen`. Cổng gói↔gói: ADR-0031.

CR-118 (ADR-0035): kit thêm endpoint flow chung `/pack/:k/flow/*` (cờ `HUB_FLOW_RUNTIME`, mặc định tắt) + node `form` (lát sau) — chỉ cộng thêm, KHÔNG mở route đóng băng của `processes`.

CR-115 (người dùng chốt 2026-11-03, lát `cr115-batch-launch`): **mở khoá có giới hạn** — CHỈ cho stage agent khởi chạy từ hẹn `retry` của vòng hẹn giờ: đường launcher/timer (`processes/adapters/timers/timer-sweep.ts`, `runs/launcher*.ts`, `adapters/hub-uow.ts` `systemEach`, `adapters/outbox.ts` `kickMany`, `runs/stage-job-inputs.ts`), `runs` `insertRun`, tạo job + `run_steps`, dọn `cli_sessions` của dify. Đường chat/HTTP và mọi đường khác giữ nguyên; không đổi hành vi bên ngoài (test tương đương `tests/acceptance/P-d/d1/batch-launch.int.test.ts`). Ngoài phạm vi này các module trên vẫn theo bảng.

CR-118 (người dùng chốt 2026-11-04, **kế hoạch đợt 2**, chưa mở khoá): engine `processes` chỉ được **cộng thêm** hai thứ, không sửa lõi, không mở route đóng băng — (a) loại node mới `form` (`processes/nodes/form`: người làm có form, quyết + payload ghi vào stage output trong cùng transaction; lát `cr118-node-form`, Opus, test trước); (b) endpoint flow chung của kit (`GET /pack/:k/flow/:slot/:ref`, `POST /pack/:k/flow/tasks/:id/actions/:action`, `POST /pack/:k/flow/:slot/summary`) qua `PackRunsPort`/`stepsView` (lát `cr118-flow-api`). Vẫn đóng băng: route chat-web `/me/process-inbox*`, `/review-tasks/:id/answer|forward`, rooms, sources, kh, `HUB_PROCESS_ROUTES=all`, dạng khe `contracts.approval` (tuần tự), DLC (Rowan). Trước khi xong lát: `test:frozen` + `dlc:check`. Đợt 1 (web gộp + `/pack/me`) không chạm module đóng băng.
CR-118 (a) **đã làm** (lát `cr118-node-form`): phạm vi chạm đúng — `processes/nodes/form/*` + 1 dòng registry (`nodes/registry*.ts`), `domain/form/form.rules.ts`, `gates/form-out.ts` + `GateService.formSubmit` + nhánh trong `#review` (stage `form` chỉ quyết qua gửi form), route `POST /review-tasks/:id/form` (cùng tầng `/decision`, chịu `HUB_PROCESS_ROUTES=admin`), 1 dòng kiểu `SnapStage` (`runs/launcher-prompt.ts`) + `ExecutorKind` (`domain/types.ts`), `FORM_EXECUTOR_REF` (`runs/executor-ref.ts`), bỏ đọc bước output cho `form` (`runs/team-load.ts`), stub editor admin-web; không migration, không đổi đường chat/batch CR-115.

CR-116 (lát `cr116-apply-hub`, pha 2 theo số đo `docs/specs/cr116-bench-hub/tasks.md`): **mở khoá có giới hạn** engine `processes` — CHỈ (a) migration Hub 0088: index `review_tasks(stage_run_id, tenant_id)` + `runs(stage_run_id, tenant_id, started_at)` và hàm definer theo tập `hub.process_runs_recipients` (cùng thân/cách ly 0020); (b) `core/core.repo.ts` `runRecipientsMany` + `core/recipients-defer.ts`, `adapters/timers/stage-timer.repo.ts` + `adapters/hub-uow.ts` `systemEach` gom người nhận `process.updated` một câu mỗi tx lô hẹn giờ; (c) `runs/stage-driver.ts` `lockAndLoad` khoá + đọc đầu run + nguồn một câu (`runs/stage-sources.ts` `stageSourceCtxOf`). Không đổi hành vi bên ngoài (test tương đương `apps/hub-api/src/modules/processes/core/run-recipients.int.test.ts`). Không làm B4 (bắn hẹn CTE) và bảng đếm chưa đọc.

Test: suite đóng băng ở `tools/scripts/src/frozen.rules.ts`. `test:affected` và `test:all --no-frozen` (cổng hằng ngày trên server) bỏ chúng; `bun run test:frozen` chạy theo yêu cầu; `bun run test:all` / `run-tests.ps1 -All` chạy hết. Sửa mã module đóng băng (hoặc engine quy trình khi làm M3) ⇒ chạy `test:frozen` trước khi xong lát.

## Nâng cấp hằng tháng (3 dòng)
1. Bun, Postgres, Redis, Dify ghim phiên bản chính xác (Bun `1.3.14` ở `package.json`, `ci.yml`, Dockerfile; Postgres `16.15-alpine`, Redis `7.4.11-alpine` ở `compose.yaml`, `deploy/*`; chưa có image Dify trong cấu hình deploy). Mỗi tháng: nâng một thành phần một lần, đổi mọi nơi cùng commit.
2. Chạy `deploy/evotest/run-tests.ps1 -Step all -All -Dirty` (gồm suite đóng băng) và `bun run test:frozen`; xanh mới giữ bản mới.
3. Đỏ ở suite đóng băng chỉ do nâng cấp ⇒ sửa tối thiểu hoặc hoãn nâng cấp; không mở lại module chỉ để thêm tính năng.