# modules/runs — E12–E15, SSE hai stream, huỷ (HUB-FR-41, HUB-FR-42, HUB-FR-43, HUB-BR-04)

Tạo run + SSE theo contract chat C1 (`@ai/contracts/chat`, C1 plan §2.4–2.5), plan H1 §5.1–5.3, P9/P11/P12, CR-030.
H2b (spec H2b-routing R08–R18): run 3 loại `command`/`orchestrated`/`direct`; `direct` ghi `agent_id` + `responder_key/name` (chốt lúc tạo run) và
kiểm lại agent trên ảnh của run (`mention.service.directOnSnapshot`, RV1-H2); `orchestrated` ghi `orchestrator_tenant_id` khi dùng bản tenant.

Thư mục con: `sse/` (hai đầu stream `sse:<id>`), `close/` (đóng run bởi bên không phải chủ: huỷ, lease, sweeper).

| File | Vai trò |
|---|---|
| `runs.routes.ts` | E12 `POST /conversations/:id/messages` (mount dưới `/conversations`; H2b: `routeMessage` (bọc `classifyMessage` H2a) → `/lệnh` qua `prepareCommand` — 404/422 `CMD_*` trước run; `//…` → tin thường bỏ một `/`; `@tag` qua `prepareMention` — 404 `AGENT_NOT_FOUND`/422 `CMD_MISSING_ARG` trước run; `@@…` → tin thường bỏ một `@`; H2c-R10: `attachment_ids` → `runs.checkSendable` sau body, trước router — 404 `ATTACHMENT_NOT_FOUND`; lệnh nhận `attachments`) · E13 `GET /runs/:id/events` · E14 `GET /runs/:id` |
| `create-run.ts` | H2b P8: `createRunTx` — E12 transaction `user`: advisory user (đầu tiên) → conversations → flows → `flowRunning` (409 `FLOW_BUSY`) → `countRunning` (429 `TOO_MANY_RUNS` + `Retry-After: 5`, log `info run-limit`) → runs (+ `orchestrator_tenant_id`) → messages → attachments (H2c P7/P8: `bindRunFiles` gắn R11 + tập file R14 → `setRunFiles` = `runs.attachment_ids`) → `decideConfirmations`; trả `RunFile[]` |
| `runs.service.ts` | `RunService`: E12 (`createRunTx`), 409 `FLOW_BUSY`, `run.started`; E13/E14; `RunDriver` (chỗ cắm B8); `start(…, plan?: RunPlan)` (`CommandRunStart \| DirectRunStart \| OrchestratedRunStart`): `command` → run `kind=command` + driver riêng (H2a-R08); còn lại → `pickOrchestrator` (cả `direct`, P10) → `RunContext.orchestrator`, log `orchestrator_tenant_invalid`; H2c `checkSendable(u, ids)`, `RunContext.files` (= `runs.attachment_ids`, P9) |
| `runs.repo.ts` | SQL run (lọc `tenant_id`+`user_id`); `finishRun` = `flows FOR UPDATE` → `UPDATE runs … status='running' AND owner=$me` |
| `confirm.repo.ts` | H2a-R22 (plan-db §3.1): `decideConfirmations` trong E12 (flow đã có, sau INSERT messages) — `pending` → `confirmed` (`isAgreeReply`) / `declined`, `confirmed` chưa dùng → `expired`; trace bước `tool` `skipped` `detail.confirmation` cho mỗi dòng vừa quyết |
| `sse/sse-writer.ts` | `SseWriter` (chủ run, `XADD sse:<id> <seq>-0`, fencing, `finish`), `appendExternal` ("XADD bên ngoài"), `RunRegistry` |
| `sse/sse-reader.ts` | `SseReader` (một kết nối `XREAD BLOCK 1000` multiplex), `runEventStream` (XRANGE → theo dõi → đóng ở sự kiện kết thúc, ping 15 s) |
| `close/cancel.routes.ts` · `close/cancel.service.ts` · `close/cancel.repo.ts` | E15 `POST /runs/:id/cancel` + phần huỷ run của E9 (HUB-FR-43, §5.7): `flows FOR UPDATE` → `runs` (chiếm `owner`) → tin assistant → jobs + `NOTIFY job_cancel`; sau COMMIT `abort()` writer cục bộ + `appendExternal` |
| `close/lease.ts` · `close/sweeper.ts` | B10: gia hạn lease 10 s (`registry.ids()`, `FOR UPDATE SKIP LOCKED`; mất run → `abort()`) · sweeper lease §5.8 (`failExpiredRun` + `announceClosed`) |
| `runs.rules.ts` · `run-errors.ts` | thuần: `parseLastEventId`, `eventsExpired`, `leaseExpired`, `queueTimeoutReason` · `runErrorText` (plan-errors); H2b `runErrorTextFor(code, locale, reason)` (F4: `UPSTREAM_ERROR` + `reason: refused` → gợi ý riêng; `runErrorText` không đổi) |
| `run-limit.rules.ts` | H2b (HUB-FR-94, R16): `overLimit` (`running >= limit`), `parseMaxConcurrentRuns` (vắng → 2; nguyên 1–20; khác → ném) — gọi ở `envAppDeps` |

Luật:
- Hub ghi duy nhất `sse:<id>`; entry field `e` = JSON `{event, data}`; TTL 24 h khi chạy, 600 s sau kết thúc; `DEL run:<id>` khi kết thúc.
- `run.failed` + `runs.error_*` = `runErrorText(code, runs.locale)` ghi cùng câu; đọc ra (E11/E14/dựng lại) chỉ từ cột.
- E13: 410 chỉ khi `eventsExpired`; DB đã kết thúc (> 2 s) mà stream thiếu sự kiện kết thúc → dựng từ DB + `appendExternal`.
- Chỗ cắm: B7/B8 cài `RunDriver` (`AppDeps.runDriver`); huỷ (B9) và sweeper (B10) dùng chung `closeRun` (`cancel.repo`) + `announceClosed`; vòng nền (`lib/loop`) chạy trong `createApp`, dừng khi `signal` abort.

Phụ thuộc: `@ai/db/hub-scope`, `@ai/db/schema/hub`, `modules/config` (ảnh + locale), `modules/conversations` (service, kiểm sở hữu).
