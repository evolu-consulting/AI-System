# modules/mcp — MCP server `/mcp` của Hub (HUB-FR-50, HUB-FR-95, WRK-FR-13)

Spec H2a-dify-command (R18–R22); plan P7, §6; `plan-db` §2–3; câu chữ `plan-errors` §4–5.

| File | Vai trò |
|---|---|
| `mcp.rules.ts` | `parseRpc`, `negotiateProtocol`, `toolInputSchema`, `mcpToolsFor`, `validateToolArgs`, `toolTimeoutS`; dựng result/lỗi JSON-RPC, câu lỗi tool (`plan-errors` §4), chế độ 2026-07-28 (`resultType`, `ttlMs`, `cacheScope`) |
| `mcp.routes.ts` | POST `/mcp` (401 thân rỗng + `WWW-Authenticate`, `-32700`, notification 202), GET/DELETE 405 |
| `mcp.service.ts` | `authenticate` (token → job `agent.cli` `running`), `handle` (`initialize`/`server/discover`/`ping`/`tools/list`/`tools/call`), gọi Dify gom + bước `tool` + usage; chỗ nối `SideEffectGate` (B9) |
| `mcp.repo.ts` | token hash → job (plan-db §2), INSERT/UPDATE bước `tool` (`insertStep` P11 ở `lib/run-steps.ts`) |
| `confirm.rules.ts` | `isAgreeReply`, `confirmationPrompt`, `confirmationInstruction` (xác nhận `side_effect`) |

Wiring: `src/app.mcp.ts` (`mountMcp`, `runnerMcp` — `mcp` của payload job agent). Token job băm bằng `lib/job-token.ts`,
không bao giờ log. Xác nhận `side_effect` (pending/consume `tool_confirmations`) là B9; tới đó tool `side_effect` bị từ chối.
