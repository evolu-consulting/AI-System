# modules/dify — gọi Dify (HUB-FR-89, HUB-FR-90)

Spec H2a-dify-command (R09–R11, R14, R15, R17, R20); plan §5.2, §5.4; bảng lỗi `plan-errors` §2 (chung với Runtime Python, RT3).
Quyết định: `spec-decisions` B-B0-3, B-B4-*.

| File | Vai trò |
|---|---|
| `dify.rules.ts` | URL/body run & stop, `interpretDifyEvent`, `mapDifyHttpError`, `DIFY_FAILED_STATUSES`, `finalText`, `difyUsage`, `maskSecret`/`maskInputs`, `difyUser`, `difyAgentInput` |
| `dify.client.ts` | `DifyClient.runStreaming(req, signal, onDelta)` → `finished` / `failed{code, reason}` / `aborted` (không ném; huỷ → stop best-effort ≤ 2 s); `stop(req, taskId)` |
| `credential.service.ts` | `CredentialService.apiKey(workflowId)` (`hub.workflow_secret` dưới `hub_ro` + `decryptSecret`; lỗi → `CredentialError` `NOT_CONFIGURED`); `loadMasterKey` (tự kiểm khởi động), `probeMasterKey` (dò khớp khoá Admin, chỉ cảnh báo) |
| `dify.usage.ts` | `logDifyUsage(tx \| db.db, row)` / `recordDifyUsage(db, row)` → `hub.log_dify_usage` (billing `dify`) |

Chưa có: `dify-agent-runner` (B7). Người dùng client: driver sync (B5), credential Runtime (B6), MCP (B8), test-run (B10).
Phụ thuộc: `@ai/contracts` (`createSseParser`), `@ai/db`, `lib/secret-crypto`, `commands/catalog.types`. Không log app-key —
thân lỗi upstream chỉ ra ngoài qua `maskSecret(…, apiKey)`.
