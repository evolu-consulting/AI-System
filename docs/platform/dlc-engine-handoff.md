# Handoff: DLC chạy trong engine quy trình (bản đang chạy trên sohoptac2)

Cập nhật 2026-11-03. Bản code: `platform/gd0` = `platform/gd0_dlc_fix` tại `e2e0fb03` (file `VERSION` trên host ghi bản này).
Tài liệu này mô tả **bản mới**: quy trình DLC là một gói (`dlc`) của engine quy trình trong hub-api. **Bản cũ** (flow quy
trình DLC dựng trên Dify, route `/dify/*`, vé `hub_ticket`, tool `dlc-answer` / `dlc-waiting`) đã bị gỡ ở `66c2a9f1` và
`7ef14199`; đừng đọc code/tài liệu cũ đó như cơ chế hiện tại. Dify vẫn còn, nhưng **chỉ** chạy hook agent và các tool
workflow (mục 6).

Quy ước sở hữu, dải migration, luật `when`, cổng test: xem `docs/platform/dlc-integration.md` (đọc trước khi sửa chỗ chung).

---

## 1. Bức tranh một trang

```
Người dùng (chat-web)                         Admin (admin-web › Quy trình › Thư viện)
  │ "@dlc-agent hôm nay có gì cần xử lý"        │ dựng sơ đồ bước DLC cho 3 khe dlc.new-system|enhancement|bug-fix
  ▼                                             ▼
Agent Hub (hub-api runs) ── dlc-agent ──► tool gói `dlc-start` (qua /mcp)
                                              │ chọn dây chuyền + project, lấy sơ đồ của khe cho tenant,
                                              │ ensureDef `dlc-<mode>`, mở process run GẮN hội thoại Chat,
                                              │ ghi dlc.flows, kick
                                              ▼
                    Engine quy trình (hub-api modules/processes)
                    mỗi bước = 1 stage `tool` (tool gói `dlc-step`, tham số hằng)
                    cổng duyệt sau bước = `after.review` (Đạt / Chưa đạt + quay lại)  ◄── người duyệt trong chat
                                              │                                          (thẻ "Xem và duyệt")
                                              ▼
                    dlc-step: chạy việc của bước (intake/spec/qc/setup/build/verify/report/deploy/agent)
                       ├─ gọi agent DLC trong ĐÚNG hội thoại của lượt (AgentCallService, chờ người khi agent hỏi)
                       ├─ sinh agent domain/QC (SpawnService)
                       └─ gọi dlc-workspace qua HTTP (repo git, queue, merge + cổng test, artifact, ticket, deploy)
                                              │
                                              ▼
                    dlc-workspace (apps/dlc-workspace, :4600)  ── trello-cron ◄── Trello (thẻ góp ý)
                       repo git mỗi project, queue FIFO, chạy lệnh trong container, deploy container dlc-app-<key>
```

Trạng thái của một lượt nằm ở 3 nơi:
- **Engine** (`hub.process_runs`, `stage_runs`, task review): bước nào đang chạy, chờ duyệt, quay lại.
- **`dlc.flows`** (pack schema, 1 hàng / lượt, `id` = id process run): spec, plan, lệnh test, agent đã sinh, log build,
  báo cáo, kết quả deploy, kết quả gần nhất từng bước.
- **dlc-workspace** (đĩa): code (git), queue việc, artifact `docs/dlc/*.md`, ticket, lịch sử deploy.

---

## 2. Gói `dlc` trong hub-api (`apps/hub-api/src/modules/packs/dlc/`)

### 2.1 Nối vào app
- `packs.mount.ts` → `mountDlcWired` (`packs/core-tools.mount.ts`) → `mountDlc` (`dlc.mount.ts`):
  - đăng ký 3 **khe** thư viện (`slotRegistry.register(dlcSlotSpec(mode))`);
  - đăng ký 2 **tool gói** `dlc-step`, `dlc-start` vào `PackToolRegistry`.
- `packs.mount.ts` mount route đọc `app.route("/pack/dlc", dlcRoutes(db, packRuns))`.
- Cầu Agent Hub: `app.n2.ts withPackBridges` tạo `dlcAgents: {}`; `app.ts` gọi `bindDlcAgents` (`app.dlc.ts`) gắn
  `bridge.port = agentHubPort({ calls: AgentCallService, spawn: SpawnService })`. Gói không import module hub; chỉ thấy
  kiểu `AgentHubPort` (`application/ports.ts`).
- Workspace: `DLC_WS_URL` + `DLC_WS_TOKEN` (env hub-api). Thiếu ⇒ mọi lời gọi workspace ném
  `dlc: chưa cấu hình workspace DLC`.

### 2.2 Khe và sơ đồ bước (`domain/dlc-flow.rules.ts`)
- Khe: `dlc.new-system`, `dlc.enhancement`, `dlc.bug-fix`. Def tenant của lượt: key `dlc-<mode>` (`dlcProcessKey`).
- `slot_body = { steps: DlcStep[] }`, mỗi bước:
  `{ kind:"dlc", key, name, action, agent_key|null, instruction, gate:{group_key, back_to[]}|null, max_rounds, timeout_min }`.
- `action` ∈ `intake, spec, qc, setup, build, verify, report, deploy, agent`. Agent mặc định: spec→`dlc-spec`,
  qc→`dlc-qc`, verify→`dlc-verify`; `agent` bắt buộc chọn `agent_key`.
- Luật thứ tự (`NEEDS`): qc, setup cần spec đứng trước; build cần setup; verify, deploy cần build.
- Giới hạn: 1–10 bước; `max_rounds` 1–10 (mặc định 3); `timeout_min` 5–1440 (mặc định 60); instruction ≤ 8000.
- **KIND_MIX**: bước duyệt của khe hợp đồng (`slot.kind=review`) và bước DLC không trộn trong một sơ đồ.
- **Biên dịch** (`compileDlcStages`): mỗi bước ⇒ 1 stage `executor.kind="tool"`, `tool_key="dlc-step"`, `args` hằng
  (`action, mode, step, agent, instruction, rounds`), `timeout_s = timeout_min*60`, output 3 trường
  `status / summary / project`, `stage.slot = bước nguyên vẹn` (để canvas dựng lại body bằng `dlcBodyFromStages`).
- **Cổng duyệt**: `gate` ⇒ `after = { kind:"review", group_key, also_group_keys:["dlc-owner"], back_to_steps:[vị trí] }`.
  Lúc mở lượt, `resolveDlcStages` đổi mã Group → id theo tenant; thiếu Group ⇒ không mở được lượt
  ("công ty thiếu Group duyệt ... (bật gói DLC)"). `dlcGroupKeys` luôn thêm `dlc-owner` khi có cổng (`66785a9a`).
- Sơ đồ mặc định (`defaultDlcBody`, seed hub 0070, giống flow Dify cũ):

| # | key | action | cổng (Group `dlc-editor` + `dlc-owner`) | timeout |
|---|---|---|---|---|
| 0 | intake | intake | không | 10' |
| 1 | spec | spec ("Phân tích lỗi + plan" ở bug-fix) | có | 240' |
| 2 | qc | qc | có, quay lại `spec` | 240' |
| 3 | setup | setup | không | 10' |
| 4 | build | build (max_rounds 3) | không | 1440' |
| 5 | verify | verify (max_rounds 1) | không | 1440' |
| 6 | report | report ("Báo cáo · duyệt deploy") | có, quay lại `build` | 10' |
| 7 | deploy | deploy | không | 60' |

### 2.3 Mở lượt: tool `dlc-start` (`adapters/dlc.tools.ts`, `application/start-flow.usecase.ts`)
- Chỉ gọi được từ agent trong Chat (`ctx.runId` = hub run của job; `jobContext` tra `hub.runs` ⇒ `conversation_id`,
  user, role; user phải trùng người gọi).
- Tham số: `ticket_id` | `project` + `requirement`, `flow` (trống ⇒ ticket `kind=bug` ⇒ bug-fix, còn lại enhancement).
- Các bước: đọc ticket ở workspace → `pickTarget` (project: tham số > `project_key` của ticket > `app` của ticket; thiếu ⇒
  lỗi "hỏi người dùng project nào") → `resolveSlot(tenant, khe)` (bản gán / mặc định / xuất bản; không có ⇒
  `defaultDlcBody`) → validate → phân giải Group → `ensureDef(dlc-<mode>)` → `port.start` với
  `conversation_id` (run có origin `conversation` ⇒ bước duyệt + câu hỏi hiện trong hội thoại) → insert `dlc.flows`
  (lỗi ⇒ cancel run) → `kick()`.
- Trả `{ run_id, mode, project, process }`.
- **Giới hạn đã biết**: `input` của run = `requirement || ticket.name || project`. dlc-agent hiện **không chuyển lời
  dặn thêm của người** (vd "dùng Times New Roman") vào `requirement` ⇒ spec agent phải hỏi lại. Chưa sửa.

### 2.4 Chạy bước: tool `dlc-step` (`application/run-step.usecase.ts` + `step-*.ts`)
- Chỉ chạy trong stage của một lượt DLC (`ctx.processRunId` là UUID và có hàng `dlc.flows`; mode phải khớp).
- Lỗi nghiệp vụ ⇒ `PackToolBusinessError` ⇒ engine **không tự thử lại**, mở quyết định cho người
  (Thử lại `add_attempt` / Huỷ).
- Khi người duyệt **Chưa đạt / quay lại**, engine chạy lại stage với `ctx.feedback` (= `stage_runs.feedback`). Bước
  agent nhận khối "THE REVIEWER SENT THIS STEP BACK" + kết quả lần trước (`state.results[step]`).
- Agent luôn chạy trong hội thoại của lượt, nhân danh người bắt đầu lượt (`whoOf`); lượt không gắn hội thoại ⇒ lỗi.

| action | file | làm gì | ghi vào `dlc.flows.state` | status trả |
|---|---|---|---|---|
| intake | step-ops | `upsertProject` (gắn conversation), đọc ticket, (new-system) đọc spec-files, dựng spec đầu vào, `putArtifact spec-input`, ticket ⇒ `taken` | `spec`, `tag` (mã lượt `ns/en/bf` + 6 ký tự cuối run id) | done |
| spec | step-agents | `specPrompt` → agent; đọc khối ```json cuối: `stack, test_command, tasks[], domains[], qc[]`; không có `tasks` ⇒ lỗi | `plan`, `planText` (kèm hỏi–đáp với người), `testCommand`, `results.spec` | done |
| qc | step-agents | `qcPrompt`: agent viết test case + test chạy được lên `main`, commit; JSON `test_command, cases, spec_problem` | `testCommand`, `results.qc` | done / `spec_problem` |
| setup | step-build | `teamOf(plan)` ⇒ spawn dev agent từ mẫu `dlc-build`, QC agent từ `dlc-qc`; `settings(testCommand, stack)`; `tasksOf` ⇒ enqueue | `spawned` | done |
| build | step-build | feedback ⇒ enqueue 1 việc sửa đầu queue; `drainQueue`: `next(prefix=tag)` (busy ⇒ chờ 30 s) → agent domain làm trên nhánh việc → `integrate` | `buildLog` | done / `failed_items` |
| verify | step-build | `verifyPrompt` → JSON `coverage, tests_pass, gaps[]`; còn gaps và còn vòng ⇒ enqueue gaps + drain lại | `verifyReport`, `coverage`, `buildLog` | done / `gaps` |
| report | step-ops | `reportText` (queue, build log, verify, git log, plan) ⇒ artifact `result`; ticket ⇒ `done` | `report` | `ready_to_deploy` / `nothing_to_deploy` |
| deploy | step-ops | `ws.deploy(project)`; project chưa cấu hình deploy ⇒ bỏ qua | `deploy {ok, sha, url, note}` | `deployed` / `skipped` (lỗi ⇒ fail bước) |
| agent | step-agents | `agentPrompt` với `instruction` của bước | `results.<step>` | done |

- Prompt mỗi bước: `domain/dlc-prompts.rules.ts`. Agent **không** tự xin Approve/Reject nữa (cổng do engine giữ);
  agent vẫn hỏi người khi chưa rõ (`need_input`).
- Agent domain: key `dlc-<project>-<domain>` (`domainAgentOf`); domain lạ ⇒ dev đầu tiên.
- Trần nội dung: `results` 40 000 ký tự/bước, `verifyReport` 60 000, `requirement` 200 000, `state` < 4 MB.

### 2.5 Route đọc cho modal duyệt: `GET /pack/dlc/runs/:id/steps/:step` (`adapters/dlc.routes.ts`, `e2e0fb03`)
- Trả `{ step, text }`: spec ⇒ `planText`, report ⇒ `report`, verify ⇒ `verifyReport`, bước khác ⇒ `results[step]`
  (`domain/dlc-detail.rules.ts`, trần 60 000).
- Quyền: run phải thấy được qua `stepsView` (RLS tenant) **và** người gọi là người bắt đầu run, admin, hoặc
  `can_act` một task review đang mở của run. Không đạt ⇒ 404. Cố ý không dùng cổng gói (Group gói ≠ Group duyệt).
- Test: `adapters/dlc.routes.test.ts` (4 case).

### 2.6 Dữ liệu
- Pack migration `packages/db/migrations-pack-dlc/0001_init.sql`: `packs.install('dlc')`, bảng `dlc.flows`
  (`id` = process run id, `tenant_id`, `mode`, `project` `^[a-z0-9][a-z0-9-]{0,47}$`, `ticket_id`, `requirement`,
  `conversation_id`, `started_by`, `state jsonb`), `packs.secure_table` (RLS FORCE, role `dlc_rw`). Đăng ký ở
  `packages/db/src/migrate-packs.ts`.
- Repo `adapters/flows.repo.ts`: `get`, `insert`, `patch` (= `state || patch`, gộp nông; `results` do use case gộp sẵn).
- Hub migration `0070_dlc_library_seed.sql`: 3 def thư viện mặc định (id `0d1c0000-…-000000000071/72/73`, key
  `dlc-<mode>-md`) + bản phát hành v1 + `process_slots` mặc định; `ON CONFLICT DO NOTHING`. Test
  `domain/dlc-seed.rules.test.ts` giữ SQL khớp `defaultDlcBody`. Dải hub dành cho DLC: 0070–0080.

### 2.7 Thay đổi engine quy trình đi kèm (`66c2a9f1`)
- `PackRunRequest.conversation_id` ⇒ run origin `{kind:"conversation"}` (người bắt đầu phải là chủ hội thoại).
- Tool gói nhận `ctx.feedback` khi stage chạy lại (đọc `stage_runs.feedback` ở `tool-stage-load.repo.ts`).
- `STAGE_TIMEOUT_S_HARD_MAX = 86_400` khi lưu def (`packages/contracts/src/hub-admin/processes.ts`); form admin vẫn
  giới hạn theo `STAGE_TIMEOUT_S.max`.

---

## 3. Agent Hub phía nền tảng (`apps/hub-api/src/modules/dlc-calls/`)

- **`AgentCallService.call(who, agentKey, prompt, signal)`**: tạo tin `@<agent> <prompt>` (≤ 60 000) trong hội thoại của
  lượt như người bắt đầu lượt gõ, đi đường `direct` (`prepareMention` → `runs.start`), đọc SSE.
  - Trước mỗi lần gọi: xoá `hub.cli_sessions` của agent trong hội thoại ⇒ mỗi bước một phiên Claude mới (không kéo
    transcript cũ; tiết kiệm token).
  - Run kết thúc bằng câu hỏi (sự kiện `ask`) ⇒ poll 2 s tìm run kế của cùng agent / cùng flow (thread) trong hội thoại
    (người trả lời trong thread hoặc tag agent) ⇒ đọc tiếp; ghi `dialog[{question, answer}]`. Tối đa 40 lượt hỏi, chờ
    tối đa 24 h hoặc tới khi stage hết hạn (`signal`).
- **`SpawnService.spawn`**: tạo/cập nhật agent `dlc-<project>-<domain>` từ agent mẫu (cùng profile, model, tool
  workflow, hook; prompt = phần chung của mẫu + "## Your domain in this project"), bật cho tenant, cấp quyền người bắt
  đầu lượt. Ghi qua service Studio ⇒ có audit. Mẫu phải là `agentic-cli` có `profile_id`.
- **`agentHubPort.jobContext`**: tra `hub.runs` + `admin.users` cho `dlc-start`.

### Sticky agent (`45f218e7`, `modules/runs/run-plan.ts`, `runs.repo.ts`)
- `HUB_STICKY_AGENT=on`: tin **không tag** ngay sau run `direct` của agent X (cùng hội thoại, hoặc cùng flow khi trả lời
  trong thread) và X còn trong AU của người gửi ⇒ đi tiếp tới X thay vì Orchestrator. Mặc định off; sohoptac2 bật.
  Nhờ vậy "xử lý mục 1" sau danh sách của `@dlc-agent` tới đúng dlc-agent. Test: `sticky-agent.rules.test.ts`.

---

## 4. Duyệt trong chat (chat-web, `535f3325` → `18d375b3` → `e2e0fb03`)

- `features/processes/run-block/lib/dlc-review.ts`: chỉ run có `process.key` bắt đầu `dlc-`. `dlcReviewTarget` lấy task
  review đang mở (ưu tiên `my_tasks`, sau đó `open_tasks`). Từ chối ⇒ `backToStep = max(back_to_steps)` (bước gần nhất
  được cấu hình), không cấu hình ⇒ làm lại chính bước.
- `components/DlcReviewDialog.tsx`: nút "Xem và duyệt" (run `waiting_review`), modal hiện nội dung đầy đủ từ
  `GET /pack/dlc/runs/:id/steps/:stepKey` (rỗng/lỗi ⇒ bảng tóm tắt output stage). Duyệt = `POST
  /review-tasks/:id/decision {result:"pass"}`; Từ chối = `{result:"fail", feedback, backToStep}`.
- `components/RunCard.tsx`: nút trên thẻ run (khi UI quy trình bật).
- `components/DlcConversationReview.tsx` + `thread/pages/ConversationPage.tsx`: thẻ "chờ duyệt" trên khung nhập, nằm ở
  **fallback** của `ProcessEngineGate`. Lý do: prod build tắt `PUBLIC_FROZEN_MODULES` ⇒ cổng engine off ⇒ thẻ run không
  vẽ. Thẻ tự nạp chuỗi `process.*`, poll `GET /process-runs?conversation_id=&scope=mine` mỗi 15 s, lỗi/403 ⇒ ẩn. Cờ
  `PUBLIC_FROZEN_MODULES` **cố ý không bật**.
- i18n: `packages/i18n/locales/process/run.{vi,en}.json` (`process.run.dlcReview.*`).
- Đã kiểm headless trên host (demo-owner, run `72204d96`): thẻ + plan đầy đủ hiện. **Chưa có e2e cho modal.**

## 5. Admin dựng sơ đồ (admin-web, `f9140601`, `c1b8f734`, `dacda73c`)

- Quy trình › Thư viện, khe `dlc.*` chỉ có Canvas (form mode ẩn).
- Nút "Thêm bước duyệt" tách: phần chính = bước duyệt (như cũ, stage mang `slot.kind=review`), mũi tên mở menu
  "Thêm bước duyệt" / "Thêm bước DLC".
- Bước DLC: thẻ riêng trên canvas; form `components/library/DlcStageForm.tsx` (việc, agent theo key, lời dặn, cổng duyệt
  theo mã Group + quay lại bước nào, số vòng, hạn). Luật ở `lib/dlc-slot.ts` (+ test), dựng stage mới ở
  `lib/fresh-stages.ts`.
- Canvas không vẽ cạnh giữa bước duyệt và bước DLC; KIND_MIX báo ngay trên canvas và chặn lưu.
- `dlc-step` là tool hệ thống của khe (không kiểm theo catalog tool tenant). i18n trong `process/admin.{vi,en}.json`
  dưới prefix `dlc`.

---

## 6. Phần vẫn chạy trên Dify (`tools/dlc-dify/`)

Dify **không** còn chạy quy trình. Còn 2 vai:
1. **Hook agent** (`hook-flows.ts`): `dlc-hook-session-start`, `-user-prompt-submit`, `-pre-tool-use`, `-post-tool-use`,
   `-stop`, `-post-compact`. Hook lấy access token của user qua admin-api `/internal/tokens` ⇒ cần
   `HUB_ADMIN_API_URL=http://admin-api:3001` ở hub-api. Hook nói chuyện với KH fork `dlc-kh:9310` (persona, lesson).
2. **Tool workflow của agent** (đi qua `/mcp` của Hub):
   - Đội (`dlc-spec/qc/build/verify` + agent sinh ra): `dlc-ws-files`, `dlc-ws-write`, `dlc-ws-exec`, `dlc-ws-commit`,
     `dlc-ws-artifact` (`ws-tool-flows.ts`), `dlc-kh-search` (`ops-tool-flows.ts`, `/vector/query` top-k).
   - dlc-agent: `dlc-spec-upload`, `dlc-project-init`, `dlc-tickets`, `dlc-ticket-read`, `dlc-project-status`,
     `dlc-deploys`, `dlc-deploy` (`tool-flows.ts`, `ops-tool-flows.ts`) **+ tool gói `dlc-start`** (`pack_tools`, không
     phải Dify).
- Agent (`agents.ts`): `dlc-spec` (deep, persona KH `agent-spec-analyst`), `dlc-qc` (`agent-test-author`), `dlc-build`
  (mẫu dev, `agent-solo`), `dlc-verify` (`agent-judge`), `dlc-agent` (cửa vào chat). Agent bước kiểu cũ
  (`dlc-size`, `dlc-understand`, …) bị tắt khi seed.
- Seed: `bun tools/dlc-dify/seed.ts [--apply] --tenant <t> --users <a,b>` (mặc định chỉ in kế hoạch). Seed bật workflow
  tool cho tenant, nhưng **bỏ qua** khi admin-api đóng băng module (prod 404, `ccc3be10`); `/mcp` chỉ gate workflow
  theo command/feature nên tool vẫn tới agent.
- Trần chờ: `HUB_DIFY_TIMEOUT_MAX_S=3600` (hub-api), `AGENT_RT_HUB_TOOL_TIMEOUT_MAX_S=3600` (agent-runtime).
- Flow quy trình cũ trên Dify host (`dlc-new-system/enhancement/bug-fix`, `dlc-answer`, `dlc-waiting`) vẫn còn trong
  Dify nhưng không agent nào dùng.

---

## 7. dlc-workspace (`apps/dlc-workspace/`, Bun + Hono, Bearer `DLC_WS_TOKEN`)

- Env: `DLC_WS_DIR` (bắt buộc), `DLC_WS_TOKEN` (≥ 32 ký tự), `DLC_WS_PORT` (4600), `DLC_WS_IMAGE` (`node:22-bookworm`,
  ảnh chạy lệnh), `DLC_WS_EXEC_MAX_S` (1800).
- Mỗi project = 1 repo git (`main`) + 1 queue + artifact `docs/dlc/<name>.md` + settings (`test_command`, `stack`) +
  cấu hình deploy (tuỳ chọn).
- Route chính: `POST/GET /projects`, `GET /projects/:key` (queue, summary, git log), `PUT …/settings`,
  `GET/PUT …/files`, `POST …/exec` (bash trong container), `POST …/commit`, `PUT …/artifacts/:name`,
  `GET/POST …/spec-files`, `GET/POST …/queue`, `POST …/queue/next {prefix}`, `POST …/integrate {task_id}`,
  `POST …/queue/:id/result`, `GET …/deploys`, `POST …/deploy`, `POST /tickets/hook`, `GET /tickets`,
  `GET/PATCH /tickets/:id`, `GET /health`.
- **Queue** (`queue.rules.ts`): FIFO, một việc `in_progress` / project. `next(prefix)` chỉ trả việc có id bắt đầu bằng
  mã lượt; lượt khác đang giữ việc ⇒ `busy` (`793e1ede`). Kết quả: đạt ⇒ `ready_to_deploy` (đã merge + test xanh, có
  `sha`); lỗi ⇒ về đầu queue, `attempts+1`, tới `MAX_ATTEMPTS=3` ⇒ `failed`. Trạng thái khác: `deployed`, `cancelled`.
- **Integrate** (`queue.routes.ts` + `git.ts`): commit nhánh việc → merge tuần tự vào `main` → chạy `test_command` trên
  main. **Cổng test** (`test-gate.rules.ts`): đạt khi exit 0, HOẶC không thụt lùi so với main trước merge (passed không
  giảm, failed không tăng) vì QC viết toàn bộ test trước (TDD). Đọc số test từ Jest/Vitest, node:test, pytest.
- **Deploy** (`deploy.ts`): chọn commit (HEAD hoặc merge mới nhất của việc `ready_to_deploy`), xuất bản sạch ra
  `<dir>/<key>/releases/<sha>`, build trong container một lần, thay container `dlc-app-<key>` (data ở
  `<dir>/<key>/data`, env bí mật ở `<dir>/<key>/deploy.env`); việc trong commit ⇒ `deployed`. Không push code đi đâu.
- **Ticket**: `trello-cron.ts` poll list Trello (`TRELLO_LIST_IDS`, `TRELLO_POLL_S`=30) ⇒ `POST /tickets/hook` (lọc
  trùng). Project của ticket lấy từ dòng `DLC project:` / `App:` trong thẻ. Trạng thái: `new`, `taken`, `done`,
  `dismissed`. `trello-mock.ts` (máy dev, admin-api `TRELLO_API_URL` trỏ tới).

---

## 8. Môi trường sohoptac2 (149.202.83.5, host của Phát; Vi25 gọi là prod)

- Project Docker `sohoptac2` ở `~/workspace/sohoptac2` (hub-api, admin-api, web, agent-runtime, tool, pg…).
  Deploy hub: `powershell -File deploy/prod-sohoptac2/deploy.ps1 -Ref platform/gd0 [-Key <ssh key>]` (mặc định
  `F:\workspace\id_evoc_key`, user `evoc`). **Chạy từ PowerShell**: Git Bash lấy nhầm tar GNU và fail ở bước đóng gói.
  Script từ chối khi bản trong `VERSION` không phải tổ tiên của `-Ref` (trừ `-Force`). Exit 0 chưa đủ: kiểm `/health`,
  bundle, và thao tác thật.
- `docker-compose.yml` (trong repo) cho hub-api: `HUB_STICKY_AGENT=on`, `HUB_MAX_CONCURRENT_RUNS=5` (bước DLC chờ người
  chiếm 1 run của user; 2 ⇒ chat bị 429 `TOO_MANY_RUNS`), `HUB_ADMIN_API_URL`, `HUB_DIFY_TIMEOUT_MAX_S`;
  agent-runtime: `AGENT_RT_HUB_TOOL_TIMEOUT_MAX_S`.
- `.env` trên host (không nằm trong repo, deploy giữ nguyên): `HUB_PUBLIC_INTERNAL_URL=http://hub-api:4000` (runtime
  gọi `/mcp`), `DLC_WS_URL=http://dlc-ws:4600`, `DLC_WS_TOKEN`. Backup `.env.bak-dlc-20261102T175109Z`.
- Hạ tầng DLC **ngoài** deploy.ps1, ở `~/dlc-ai/`: compose project `dlc-ws` (container `dlc-ws` + `trello-cron`, nguồn
  `~/dlc-ai/app/src`), Dify (`dlc-dify`), KH fork `dlc-kh:9310`. Cập nhật nguồn workspace bằng
  `~/dlc-ai/host-port.sh ws` (đọc `/tmp/dlc-ws-src.tgz`); các lệnh khác: `env`, `pack` (bật gói `dlc` cho tenant demo +
  thành viên Group), `seed` (seed Dify + agent). Bản workspace trên host đã có `793e1ede`; các commit sau đó không đụng
  `apps/dlc-workspace`.
- Tenant `demo`: gói `dlc` bật; `dlc-owner` = demo-owner; `dlc-editor` = demo, demo-editor.
  `HUB_PROCESS_ROUTES=admin` ⇒ chỉ tenant_admin quyết được cổng và `/me/review-tasks` không mount (thẻ duyệt trong chat
  ẩn với người không phải admin).
- Login Claude của host: setup token Team ở `claude-home/.claude/.credentials.json` (backup `.bak-20261103-maxtoken`,
  `.bak-20261030T120534`). Đổi token xong, agent-runtime cần tới ~20 phút để kiểm lại provider
  (`ALL_PROVIDERS_EXHAUSTED` trong khoảng đó).
- App demo của project workspace: `http://149.202.83.5:4610/` (container `dlc-app-<key>`).
- Công cụ lái trên host: `~/dlc-ai/hd.sh new|say|runs|status|raw|msgs|decide|decide-run`, `~/dlc-ai/auto-pass.sh`.

## 9. Chạy local (PC Cá nhân)

- Repo `E:\Workspaces\EvoBuzz\AI-System`; push qua SSH alias `git@evobuzz` (HTTPS 403 với tài khoản cá nhân).
- AI-System: `scripts\dev-up.ps1 -DbName ai_system_gd0` (admin :3000, chat :3100, admin-api :3001, hub :4000).
  `.env.local` cần `DLC_WS_URL`, `DLC_WS_TOKEN`, `HUB_DIFY_TIMEOUT_MAX_S=3600`, `HUB_INTERNAL_TOKEN`,
  `HUB_ADMIN_API_URL`, `HUB_PUBLIC_INTERNAL_URL=http://host.docker.internal:4000`, `HUB_STICKY_AGENT=on`,
  `SEED_ADMIN_EMAIL`.
- Workspace + trello-mock :4700 + trello-cron: `E:\STTTemp\dlc-gd0-local\dlc-local-up.ps1` (`-Down` để tắt);
  `DLC_WS_DIR=C:\dlc-workspace`.
- Dify local :8099 (`E:\Workspaces\EvoBuzz\dify-local\dify\docker`); agent-runtime container `ai-dlc-runtime-gd0`.
- KH cho hook ở local: chưa có (hook chạy, KH trả 503, không chặn flow).
- Lái kịch bản: `bun E:\STTTemp\dlc-gd0-local\drive-dlc.ts new|say|msgs|tasks|decide|run|status|runs`.
- Kiểm trước khi bàn giao: `bun run typecheck` (hoặc `--filter` hub-api / admin-web / dlc-workspace),
  `bun test apps/dlc-workspace apps/hub-api/src/modules/packs/dlc`, `bun run dlc:check`.

---

## 10. Project dùng để test: The Memories (`the-memories`)

App mẫu mà DLC sửa trong mọi lượt test. Không phải sản phẩm thật. KH có project `eval-the-memories` (alias
`the-memories`, "Sage Journal") giữ tri thức của app gốc; `dlc-kh-search` của đội DLC tra ở đó.

- **App**: blog cá nhân "Sage Journal", style "03 Sage Botanical". `web/` React 19 + Vite (test `node:test`), `server/`
  Python 3 stdlib HTTP server + SQLite (test `unittest`). Home `/#/` (đọc bài), Admin `/#/admin` (viết/sửa bài, ảnh;
  mục "Giao diện" import theme CSS), dropdown theme cho người xem, nút **Góp ý** (Lỗi / Ý tưởng / Khác).
- **Góp ý ⇒ Trello**: `POST /api/feedback {kind: bug|idea|other, message, name?, page?}` (`server/app.py`,
  `server/feedback.py`, giới hạn theo IP). Lưu SQLite, rồi tạo thẻ Trello nếu có `TRELLO_*`. Tên thẻ
  `[Lỗi|Ý tưởng|Khác] <nội dung>`; mô tả có dòng `App: The Memories`, `DLC project: the-memories`, người gửi, trang,
  phiên bản, `Mã góp ý: fb-…`. Workspace đổi thẻ thành ticket: tên/nhãn có bug/lỗi/fix ⇒ `kind=bug` (⇒ Bug Fix),
  còn lại `enhancement`; project lấy từ `DLC project:`.
- **Project workspace** (`<DLC_WS_DIR>/the-memories/`): `project.json` (key, `conversation_id`, `stack`,
  `test_command`, cấu hình deploy, lịch sử deploy, `test_baseline`), `repo/` (git, `main`), `wt/` (worktree nhánh việc),
  `releases/<sha>/`, `data/` (SQLite + ảnh của app chạy), `deploy.env` (bí mật của app: `HOST, PORT, BLOG_DATA_DIR,
  BLOG_ADMIN_USER, BLOG_ADMIN_PASSWORD, TRELLO_API_URL, TRELLO_KEY, TRELLO_TOKEN, TRELLO_FEEDBACK_LIST_ID`).
- **Lệnh test**: `python3 scripts/test_all.py` (chạy cả web và server). Baseline gần nhất local: `19716e97`, 380 pass /
  0 fail.
- **Deploy** (cấu hình trong `project.json`): build `cd web && npm ci && npm run build` (ảnh exec), chạy
  `python -m server` trong `python:3.12-slim`, cổng `4610:8000`, container `dlc-app-the-memories`.
  Local: http://localhost:4610/ ; host: http://149.202.83.5:4610/.
- **Artifact DLC** trong repo `docs/dlc/`: `spec-input.md`, `plan.md`, `test-plan.md`, `verification.md`, `result.md`
  (ghi đè mỗi lượt; lịch sử ở git log).
- **Nguồn repo ban đầu (local)**: `E:\STTTemp\dlc-demo\tm2.bundle` (bản cũ hơn `the-memories.bundle`). Local hiện ở
  `C:\dlc-workspace\the-memories` (`DLC_WS_DIR=C:\dlc-workspace`). Trên host, project nằm trong thư mục dữ liệu của
  container `dlc-ws` (`~/dlc-ai/`).
- **Trello giả (local)**: `E:\STTTemp\dlc-gd0-local\trello-mock.json`, list `list-moi` ("📥 Mới"), API :4700.
  `deploy.env` của app local trỏ Trello vào mock ⇒ góp ý trên :4610 thành thẻ ở mock ⇒ trello-cron (30 s) ⇒ ticket.

Lịch sử lượt trên The Memories:

| nơi | lượt | dây chuyền | ticket | nội dung | kết quả |
|---|---|---|---|---|---|
| local | `23b5967b` | Enhancement | `t-8d459481` | "N phút đọc" trên thẻ bài | 4 task, release `a609b5a` |
| local | `3b8c52e6` | Bug Fix | `t-a056eb05` | dateTime là số Unix | verify 369/0, release `7a3ac26` |
| local | `e62a838f` | Bug Fix | `t-9a3ef703` | dateTime ISO ở Home/PostModal/Admin | verify 380/0, release `d63795c` |
| host | `b9311ddc` | Enhancement | `t-82660d23` | đổi màu xanh ⇒ vàng (chọn phương án B: theme `honey-yellow.css`, mặc định giữ Sage) | verify 385/0, coverage 100%, 8 bước xong |
| host | `72204d96` | Bug Fix | `t-5fb34fc6` | font ⇒ Times New Roman | `waiting_review` ở cổng spec/plan, chờ Rowan |

## 11. Full flow test (làm lại từ đầu)

Mỗi bước dưới đây ghi: **Làm gì**, **Cần gì** (thành phần phải chạy, dữ liệu phải có), **Config** (env, seed,
quyền), **Deploy** (bản code nào phải lên đâu). Cột "Deploy" nói theo host sohoptac2; local thì "deploy" = chạy bản code
đó trên máy (dev-up / dlc-local-up / container runtime) và restart tiến trình sau khi đổi code.

### Bước 0 — Nền (làm một lần cho mỗi môi trường)

- **Cần**: AI-System (hub-api, admin-api, chat-web, admin-web, agent-runtime, Postgres), Dify (hook + tool workflow),
  KH fork cho hook (`dlc-kh:9310`, chỉ có trên host), dlc-workspace + trello-cron, Docker trên máy chạy workspace (exec
  và deploy app đều là container).
- **Config**:
  - hub-api: `DLC_WS_URL`, `DLC_WS_TOKEN`, `HUB_PUBLIC_INTERNAL_URL` (runtime gọi `/mcp`), `HUB_ADMIN_API_URL`,
    `HUB_INTERNAL_TOKEN`, `HUB_DIFY_TIMEOUT_MAX_S=3600`, `HUB_STICKY_AGENT=on`, `HUB_MAX_CONCURRENT_RUNS=5`.
  - agent-runtime: `AGENT_RT_HUB_TOOL_TIMEOUT_MAX_S=3600`; login Claude hợp lệ (`claude-home/.claude/.credentials.json`).
  - dlc-workspace: `DLC_WS_DIR`, `DLC_WS_TOKEN` (cùng giá trị với hub-api), `DLC_WS_IMAGE`, `DLC_WS_EXEC_MAX_S`.
  - trello-cron: `TRELLO_API_URL` (thật hoặc mock), `TRELLO_KEY`, `TRELLO_TOKEN`, `TRELLO_LIST_IDS`, `TRELLO_POLL_S`,
    `DLC_WS_URL`, `DLC_WS_TOKEN`.
  - Tenant: bật gói `dlc` (`PUT /admin/tenants/:id/packs/dlc`) ⇒ tạo Group `dlc-owner` / `dlc-editor`; thêm người duyệt
    vào Group (`host-port.sh pack` làm cả hai cho tenant demo).
  - Seed Dify + agent: `tools/dlc-dify/seed.ts --apply --tenant <t> --users <...>` (`host-port.sh seed`): tạo flow hook
    + tool trên Dify, catalog workflow ở admin, 5 agent DLC, gắn hook/tool, bật agent cho tenant, cấp quyền user,
    dlc-agent có `pack_tools: ["dlc-start"]`.
- **Deploy**:
  - Code hub/admin/chat/runtime: `deploy.ps1 -Ref platform/gd0` (chạy `setup.sh`: migrate hub ⇒ 0070 seed 3 sơ đồ
    mặc định; migrate pack ⇒ `dlc.flows`).
  - Code dlc-workspace + trello-cron: **không** đi theo deploy.ps1; đóng gói `apps/dlc-workspace/src` ⇒
    `/tmp/dlc-ws-src.tgz` ⇒ `host-port.sh ws`.
  - Biến `.env` của hub: `host-port.sh env` (có backup).
  - Kiểm: `/health` hub, `GET <dlc-ws>/health`, trong DB có `dlc.flows` và 3 def `dlc-*-md`.

### Bước 1 — Project test có trong workspace (một lần cho mỗi project)

- **Làm gì**: project `the-memories` tồn tại trong workspace với repo `main`, lệnh test, cấu hình deploy, app đang chạy.
- **Cần**: repo app trong `<DLC_WS_DIR>/the-memories/repo` (local lấy từ `tm2.bundle`); KH project của app
  (`eval-the-memories`) để `dlc-kh-search` có tri thức.
- **Config**: `POST /projects {key, title, conversation_id?, kh_project}` (hoặc dlc-agent `dlc-project-init`);
  `PUT /projects/the-memories/settings {test_command, stack, apps:["The Memories"], deploy:{build_command, image,
  run_command, port:4610, container_port:8000, url}}`; file `<DLC_WS_DIR>/the-memories/deploy.env` (bí mật app + Trello
  để nút Góp ý tạo thẻ).
- **Deploy**: `POST /projects/the-memories/deploy` một lần ⇒ container `dlc-app-the-memories` ở :4610.

### Bước 2 — Khách góp ý ⇒ thẻ Trello

- **Làm gì**: nút **Góp ý** trên :4610 (Ý tưởng ⇒ Enhancement, Lỗi ⇒ Bug Fix) hoặc
  `POST :4610/api/feedback {"kind":"idea"|"bug","message":"..."}`.
- **Cần**: app đang chạy; Trello (thật, hoặc mock :4700 ở local) nhận được.
- **Config**: `TRELLO_API_URL`, `TRELLO_KEY`, `TRELLO_TOKEN`, `TRELLO_FEEDBACK_LIST_ID` trong `deploy.env` của app
  (list phải trùng một list trong `TRELLO_LIST_IDS` của cron). Mô tả thẻ phải có `DLC project: the-memories` (app tự ghi).
- **Deploy**: không (đã có từ bước 1). Đổi `deploy.env` ⇒ deploy lại app để container nhận env mới.

### Bước 3 — Thẻ ⇒ ticket trong workspace

- **Làm gì**: trello-cron poll (30 s) ⇒ `POST /tickets/hook` ⇒ ticket `new` (`kind` bug/enhancement, `project_key`).
- **Cần**: trello-cron chạy và gọi được workspace.
- **Config**: env trello-cron (bước 0). Kiểm `GET <ws>/tickets?status=new` (Bearer `DLC_WS_TOKEN`).
- **Deploy**: không.

### Bước 4 — Hỏi dlc-agent trong chat

- **Làm gì**: chat-web, hội thoại mới: `@dlc-agent Hôm nay có những gì cần giải quyết` ⇒ `dlc-tickets` ⇒ danh sách 2
  dòng/mục có mã ticket.
- **Cần**: agent `dlc-agent` bật cho tenant và người dùng có quyền; tool workflow Dify `dlc-tickets`,
  `dlc-ticket-read` tới được agent qua `/mcp`; hook Dify chạy (KH lỗi không chặn).
- **Config**: seed bước 0; `HUB_PUBLIC_INTERNAL_URL`, `HUB_ADMIN_API_URL`; Dify gọi được workspace
  (`DLC_WS_URL_FOR_DIFY`) lúc seed.
- **Deploy**: Dify flow (seed). Đổi prompt/tool của agent ⇒ sửa `tools/dlc-dify/*` rồi chạy lại seed.

### Bước 5 — Mở lượt (`dlc-start`)

- **Làm gì**: `xử lý mục 1` (không tag) ⇒ dlc-agent gọi tool gói `dlc-start(ticket_id)` ⇒ lượt `dlc-<mode>` gắn hội
  thoại, thẻ run hiện trong chat.
- **Cần**: hub-api có gói `dlc` (code từ `66c2a9f1`), engine quy trình bật, sơ đồ của khe hợp lệ, Group duyệt phân giải
  được, người gọi có quyền ghi gói `dlc`.
- **Config**: `HUB_STICKY_AGENT=on` (nếu không phải gõ `@dlc-agent xử lý mục 1`); sơ đồ khe: mặc định từ 0070, admin
  sửa ở Quy trình › Thư viện (khe `dlc.*`, Canvas); Group `dlc-editor` + `dlc-owner` có thành viên.
- **Deploy**: hub-api (deploy.ps1).
- Lời dặn thêm trong câu này hiện **không** vào lượt (mục 12).

### Bước 6 — intake + spec (agent hỏi người)

- **Làm gì**: intake tạo/gắn project, ticket ⇒ `taken`, spec đầu vào ⇒ artifact `spec-input`. spec: dlc-spec đọc code,
  tra KH, hỏi người trong thread (A/B/C…) ⇒ trả lời trong thread hoặc tag `@dlc-spec` ⇒ plan + đội + JSON `tasks`.
- **Cần**: `AgentCallService` (hub), agent-runtime chạy được Claude, tool `dlc-ws-*` + `dlc-kh-search` cho dlc-spec,
  workspace chạy được container exec.
- **Config**: `DLC_WS_URL/TOKEN` ở hub; hạn bước spec (mặc định 240'); không ai trả lời tới hạn ⇒ bước lỗi, engine mở
  quyết định ⇒ `add_attempt`.
- **Deploy**: hub-api, agent-runtime; dlc-workspace (bước 0).

### Bước 7 — Cổng spec trong chat

- **Làm gì**: thẻ "chờ duyệt" trên khung nhập ⇒ **Xem và duyệt** ⇒ modal plan đầy đủ ⇒ Duyệt (pass) hoặc Từ chối + lý
  do (spec chạy lại với góp ý).
- **Cần**: chat-web có `DlcConversationReview` (`18d375b3`) + modal đọc `GET /pack/dlc/runs/:id/steps/spec`
  (`e2e0fb03`); người duyệt là người bắt đầu run / admin / thành viên Group cổng.
- **Config**: `HUB_PROCESS_ROUTES`: host đang `admin` ⇒ chỉ tenant_admin thấy và quyết; `all` ⇒ `dlc-editor` cũng
  quyết được (cần chủ sản phẩm chốt). Không cần bật `PUBLIC_FROZEN_MODULES`.
- **Deploy**: chat-web + hub-api (deploy.ps1, cùng bản `platform/gd0`).

### Bước 8 — qc + cổng qc

- **Làm gì**: dlc-qc viết test case + test tự động lên `main` (test của task mới đỏ là đúng), commit, artifact
  `test-plan` ⇒ cổng qc ⇒ Duyệt (Từ chối ⇒ quay về spec).
- **Cần**: như bước 6 (agent dlc-qc + tool ws); lệnh test chạy được trong `DLC_WS_IMAGE`.
- **Config**: `test_command` lấy từ plan/QC (The Memories: `python3 scripts/test_all.py`).
- **Deploy**: không thêm.

### Bước 9 — setup + build + verify

- **Làm gì**: setup sinh agent `dlc-the-memories-<domain>` từ mẫu `dlc-build` / `dlc-qc`, đặt settings, đưa task vào
  queue. build: lấy việc theo mã lượt ⇒ agent domain làm trên nhánh ⇒ `integrate` (merge tuần tự + cổng test, lỗi ⇒
  thử lại tới 3 lần). verify: dlc-verify đối chiếu 100% spec, gaps ⇒ việc sửa ⇒ build lại (tối đa `max_rounds`).
- **Cần**: `SpawnService` (hub) + agent mẫu `dlc-build`, `dlc-qc` có profile; workspace có `queue/next {prefix}`
  (`793e1ede`); Docker cho exec.
- **Config**: hạn build/verify 1440'; `max_rounds` theo sơ đồ.
- **Deploy**: hub-api; dlc-workspace phải có bản ≥ `793e1ede` (host đã có).

### Bước 10 — report + cổng duyệt deploy

- **Làm gì**: report ghi `docs/dlc/result.md`, ticket ⇒ `done` ⇒ cổng "Báo cáo · duyệt deploy": modal hiện báo cáo
  (queue, build log, nghiệm thu, git) ⇒ Duyệt ⇒ deploy. Từ chối + góp ý ⇒ quay về build, góp ý thành 1 việc sửa đầu
  queue.
- **Cần / Config / Deploy**: như bước 7 (route `steps/report`).

### Bước 11 — deploy app

- **Làm gì**: `ws.deploy` ⇒ build release của commit đã merge ⇒ thay `dlc-app-the-memories` ⇒ việc ⇒ `deployed`.
- **Cần**: project có cấu hình `deploy` (bước 1), Docker trên máy workspace, cổng 4610 trống/được thay.
- **Config**: `deploy.env` của project.
- **Deploy**: không (chính bước này deploy app).
- **Kiểm**: stage deploy `deployed`, :4610 có thay đổi, ticket `done`, `GET /projects/the-memories/deploys` có bản ghi
  mới, `docs/dlc/result.md` trong repo.

Bug Fix: như trên, bước 1 chọn **Lỗi** (`kind: "bug"`) ⇒ ticket `kind=bug` ⇒ dây chuyền Bug Fix (spec tên "Phân tích lỗi
+ plan", agent đọc code `main`, tìm nguyên nhân, plan sửa nhỏ nhất + test hồi quy).

Lái bằng script thay cho UI (local, user demo-owner):
`bun E:\STTTemp\dlc-gd0-local\drive-dlc.ts new` ⇒ `say <conv> "<tin>"` ⇒ `runs <conv>` ⇒ `status <run> <conv>` ⇒
`tasks` ⇒ `decide <task> pass|fail ["góp ý"] [back_to_step]` ⇒ `run <run>`. Login bị giới hạn tần suất nên token cache
10 phút. Trên host: `~/dlc-ai/hd.sh` (thêm `decide-run <run> add_attempt|cancel`), `~/dlc-ai/auto-pass.sh` tự duyệt các
cổng của một lượt.

Kiểm nhanh khi kẹt:
- dlc-agent không có tool ⇒ tenant chưa bật workflow tool / `HUB_PUBLIC_INTERNAL_URL` sai (runtime trong docker không
  gọi được `/mcp`).
- Cổng mở nhưng không ai thấy task ⇒ Group `dlc-editor` / `dlc-owner` của tenant rỗng; trên host còn
  `HUB_PROCESS_ROUTES=admin` (chỉ tenant_admin quyết).
- Chat 429 `TOO_MANY_RUNS` ⇒ `HUB_MAX_CONCURRENT_RUNS` quá thấp (bước chờ người giữ 1 run).
- `ALL_PROVIDERS_EXHAUSTED` ⇒ login Claude của runtime hỏng hoặc vừa đổi (chờ provider kiểm lại).
- Hook lỗi 401 từ KH ⇒ thiếu `HUB_ADMIN_API_URL`.

## 12. Còn mở

- dlc-agent không chuyển lời dặn thêm của người vào `dlc-start` (`requirement`).
- Chưa có e2e cho modal duyệt trong chat.
- `HUB_PROCESS_ROUTES=admin` trên host: muốn `dlc-editor` (không phải admin) duyệt cần quyết định của chủ sản phẩm.
- Đổi mật khẩu 3 user demo của sohoptac2 (đã lộ trong transcript).
- `C:\RWTemp\Key.txt` (Laptop công ty) vẫn giữ setup token.
- KH cho hook ở local.
- Bug mở trong KH: trả lời trong thread mở bằng "Trả lời tiếp" dưới block của agent, không tag, có trường hợp vẫn rơi
  về orchestrator (xem finding của project `ai-sdlc`).
- `dlc-project-init` không còn tự gắn hội thoại; intake gắn lại khi mở lượt.
