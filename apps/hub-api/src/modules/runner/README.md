# modules/runner — AgentRunner (HUB-FR-89, HUB-FR-24)

Một job `agent.cli` cho một step của run, plan H1 §5.6, P7/P8/P11, contract `@ai/contracts/hub` §2.2–2.3.

Thư mục con (TD #44, H2b B0): `job/` (job `agent.cli`: runner, repo, test) · `workflow/` (job `workflow.async`). Ở gốc:
`runner.rules.ts` (test khoá import), `routing-runner.ts`, `run-stream-reader.ts`, `orphan-sweep.ts`.

| File | Vai trò |
|---|---|
| `job/job-agent-runner.ts` | `AgentRunner` (`run(task, signal): AsyncIterable<RunEvent>`), `JobAgentRunner`, `runJob` (→ `JobOutcome` cho B8) |
| `routing-runner.ts` | H2a B7 · `RoutingRunner`: `agentic-cli` → `JobAgentRunner`; `dify-workflow`/`dify-agent` → runner tiêm vào (`modules/dify/agent/dify-agent-runner.ts`; vắng → `job.failed NOT_CONFIGURED`). Dựng ở `app.runner.ts` |
| `run-stream-reader.ts` | `RunStreamReader`: một kết nối `XREAD BLOCK 1000` multiplex `run:<id>`, `await subscribe` trước INSERT job ⇒ đọc từ id cuối hiện có (XREVRANGE), người gọi lọc `job_id`; khoá mới ⇒ `CLIENT UNBLOCK` (thử lại ngắn), `CLIENT ID` lấy lại mỗi `ready` |
| `job/runner.repo.ts` | `provider_state`, `run_steps` + `INSERT jobs` + `pg_notify('job_enqueued')` một transaction, đọc job, hết hạn `queued`, slot tenant |
| `orphan-sweep.ts` | B10 · quét orphan phía Hub (plan-db §5.5, 10 s): `failed orphaned` + XADD `job.failed` (`seq` = epoch ms) vào `run:<id>`. H2a B6: cùng transaction, **trước** câu `failed`, `requeueOrphanJobs` (plan-db H2a §2, `ORPHAN_S = 60` chung hai câu) đưa job `workflow.async` đủ điều kiện về `queued` + NOTIFY `job_enqueued{provider_key:dify}`, không XADD |
| `workflow/workflow-job-runner.ts` · `workflow/workflow-job.repo.ts` | H2a B6 · `WorkflowJobRunner.run({payload, stepDetail, onEnqueued}, signal)` (plan §5.3): transaction `system` `runs FOR SHARE` → provider `dify` bật (DB) → step `workflow` → `INSERT jobs (workflow.async, dify, agent_id NULL)` → NOTIFY; theo dõi `run:<id>` như `JobAgentRunner`, bỏ qua `job.started`/`job.progress`; im 2 s → đọc `jobs`, hết hạn `queued` tính từ `queued_at`. Kết cục `result{text}`/`failed`/`aborted`/`not_enqueued` cho `commands/driver/command-async-driver.ts` |
| `runner.rules.ts` | thuần: `buildJobPayload`, `providerBlocked`, `eventFromJobRow` (dựng từ DB), `syntheticFailed`, `runErrorCodeOf` |

Luồng `run`: payload (bước 0 profile, đã `JobPayloadSchema`) → provider `cooldown/logged_out/error` ⇒ `job.failed ALL_PROVIDERS_EXHAUSTED provider_unavailable`, không job, không step → đăng ký `run:<id>` → transaction `system` (run_steps `running` → jobs → NOTIFY) → `step.started` → sự kiện job; im 2 s ⇒ đọc `jobs` (kết thúc ⇒ dựng từ DB; `queued` quá `maxWaitS` ⇒ `UPDATE … WHERE status='queued'` + `queueTimeoutReason`) → step `ok/failed` (`detail` giữ `message` gốc, P11) → `step.finished` → sự kiện kết thúc. `signal` abort ⇒ dừng, không ghi.

Wiring (`src/app.runner.ts` `agentRunner`): `JobAgentRunner({db, owner, reader, maxWaitS: HUB_JOB_MAX_WAIT_S, log, mcp: runnerMcp(HUB_PUBLIC_INTERNAL_URL, config)})` (payload `agent.cli` có khối `mcp` = URL `/mcp` + tool của agent; production vắng URL → `mcp = null`) + `DifyAgentRunner` gộp trong `RoutingRunner`. Driver Orchestrator gọi `runJob(runner, task, signal, log)`; `seq` của step do DB cấp (`lib/run-steps.ts` `insertStep`, H2a P11). Async lệnh `/` dùng `RunStreamReader` riêng (`app.async.ts`, nợ B-B6-8: gộp một đầu đọc). Huỷ job qua SQL §5.7 (runner chỉ dừng theo `writer.signal`).

Phụ thuộc: `@ai/db/hub-scope`, `@ai/db/schema/hub`, `modules/config` (kiểu), `modules/runs` (`queueTimeoutReason`, `SseEventBody`, `xreadPairs`), `modules/conversations` (`stepLabel`).
