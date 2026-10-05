# modules/dify — gọi Dify (HUB-FR-89, HUB-FR-90)

Spec H2a-dify-command (R09–R11, R14, R15, R17, R20); plan §5.2, §5.4; bảng lỗi `plan-errors` §2 (chung với Runtime Python, RT3).
Quyết định: `spec-decisions` B-B0-3, B-B4-*.
Thư mục con (TD #44, H2b B0): `agent/` (agent `dify-*`: runner, rules, repo, test). `dify.rules.ts` giữ ở gốc (test khoá import).

| File | Vai trò |
|---|---|
| `dify.rules.ts` | URL/body run & stop, `interpretDifyEvent`, `mapDifyHttpError`, `DIFY_FAILED_STATUSES`, `finalText`, `difyUsage`, `maskSecret`/`maskInputs`, `difyUser`, `difyAgentInput` |
| `dify.client.ts` | `DifyClient.runStreaming(req, signal, onDelta)` → `finished` / `failed{code, reason}` / `aborted` (không ném; huỷ → stop best-effort ≤ 2 s); `stop(req, taskId)` |
| `dify-upload.ts` | H2c B7 · `uploadDifyFile(req, signal, fetch?)` (`POST /files/upload` multipart, hạn 60 s, không ném) → `{ok, id}` / `{ok:false, code, reason, status, detail}` / `ABORTED`; `mapDifyUploadError` (401/403/404 → `NOT_CONFIGURED`; 413/415/`file_too_large`/`unsupported_file_type` → `file_rejected`), `difyUploadId` (plan-rules §5) |
| `credential.service.ts` | `CredentialService.apiKey(workflowId)` (`hub.workflow_secret` dưới `hub_ro` + `decryptSecret`; lỗi → `CredentialError` `NOT_CONFIGURED`); `loadMasterKey` (tự kiểm khởi động), `probeMasterKey` (dò khớp khoá Admin trên workflow có `secret_id`, chỉ cảnh báo) |
| `agent/dify-agent-runner.ts` | B7 · `DifyAgentRunner` (`AgentRunner` cho agent `dify-workflow`/`dify-agent`, plan §5.4): bước `delegate` không hàng `jobs` → workflow theo `runtime_options.workflow_key` (cache catalog) → key → Dify gom trong hạn `agents.timeout_s` (cấu hình Hub hiện hành) → `job.started` → `job.result{agent_result: done}` / `job.failed`; huỷ → stop, không sự kiện kết thúc; phiên `cli_sessions(provider_key='dify')` cho `dify-agent` (Dify 404 **và** thân lỗi chứa "conversation not exist" → xoá phiên, thử lại đúng một lần không `conversation_id`; 404 khác giữ phiên, trả `NOT_CONFIGURED` — review 2 RV2-2); usage `agent_id`, `feature_id` NULL |
| `agent/dify-agent.rules.ts` | thuần: `difyAgentTarget` (workflow bật, loại app khớp runtime, `difyAgentInput`), `difyAgentRequestParts`, `agentText` (≤ `AGENT_TEXT_MAX`), `difyAgentEnd` |
| `agent/dify-agent.repo.ts` | bước `delegate` (`runs FOR SHARE` còn của owner → `insertStep`), đóng bước, đọc/UPSERT/xoá `cli_sessions` (lọc `tenant_id`) |
| `dify.usage.ts` | `logDifyUsage(tx \| db.db, row)` / `recordDifyUsage(db, row)` → `hub.log_dify_usage` (billing `dify`) |

Người dùng client: driver sync (B5), credential Runtime (B6), `dify-*` (B7), MCP (B8), test-run (B10).
Phụ thuộc: `@ai/contracts` (`createSseParser`), `@ai/db`, `lib/secret-crypto`, `commands/catalog.types`. Không log app-key —
thân lỗi upstream chỉ ra ngoài qua `maskSecret(…, apiKey)`.
