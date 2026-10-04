# modules/runner — AgentRunner (HUB-FR-89, HUB-FR-24)

Một job `agent.cli` cho một step của run, plan H1 §5.6, P7/P8/P11, contract `@ai/contracts/hub` §2.2–2.3.

| File | Vai trò |
|---|---|
| `job-agent-runner.ts` | `AgentRunner` (`run(task, signal): AsyncIterable<RunEvent>`), `JobAgentRunner`, `runJob` (→ `JobOutcome` cho B8) |
| `run-stream-reader.ts` | `RunStreamReader`: một kết nối `XREAD BLOCK 1000` multiplex `run:<id>`, đọc từ đầu stream, người gọi lọc `job_id` |
| `runner.repo.ts` | `provider_state`, `run_steps` + `INSERT jobs` + `pg_notify('job_enqueued')` một transaction, đọc job, hết hạn `queued`, slot tenant |
| `orphan-sweep.ts` | B10 · quét orphan phía Hub (plan-db §5.5, 10 s): `failed orphaned` + XADD `job.failed` (`seq` = epoch ms) vào `run:<id>` |
| `runner.rules.ts` | thuần: `buildJobPayload`, `providerBlocked`, `eventFromJobRow` (dựng từ DB), `syntheticFailed`, `runErrorCodeOf` |

Luồng `run`: payload (bước 0 profile, đã `JobPayloadSchema`) → provider `cooldown/logged_out/error` ⇒ `job.failed ALL_PROVIDERS_EXHAUSTED provider_unavailable`, không job, không step → đăng ký `run:<id>` → transaction `system` (run_steps `running` → jobs → NOTIFY) → `step.started` → sự kiện job; im 2 s ⇒ đọc `jobs` (kết thúc ⇒ dựng từ DB; `queued` quá `maxWaitS` ⇒ `UPDATE … WHERE status='queued'` + `queueTimeoutReason`) → step `ok/failed` (`detail` giữ `message` gốc, P11) → `step.finished` → sự kiện kết thúc. `signal` abort ⇒ dừng, không ghi.

Chỗ cắm B8: `app.ts` dựng `new RunStreamReader(redis, logger, signal)` + `new JobAgentRunner({db, reader, maxWaitS: deps.jobMaxWaitS ?? 30, log})`, driver Orchestrator gọi `runJob(runner, {run: writer.run, snapshot, agent, role, prompt, systemPrompt?, history, seq, emit: writer.emit}, writer.signal, log)`. B9 huỷ job qua SQL §5.7 (runner chỉ dừng theo `writer.signal`).

Phụ thuộc: `@ai/db/hub-scope`, `@ai/db/schema/hub`, `modules/config` (kiểu), `modules/runs` (`queueTimeoutReason`, `SseEventBody`, `xreadPairs`), `modules/conversations` (`stepLabel`).
