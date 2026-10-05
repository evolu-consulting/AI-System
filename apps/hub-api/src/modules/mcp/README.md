# modules/mcp — MCP server `/mcp` của Hub (HUB-FR-50, HUB-FR-95, WRK-FR-13)

Spec H2a-dify-command (R18–R22); plan P7, §6; `plan-db` §2–3; câu chữ `plan-errors` §4–5.

| File | Vai trò |
|---|---|
| `mcp.rules.ts` | `parseRpc`, `negotiateProtocol`, `toolInputSchema`, `mcpToolsFor` (bỏ app `chat`/`agent` thiếu `query`), `validateToolArgs`, `toolTimeoutS`; dựng result/lỗi JSON-RPC, câu lỗi tool (`plan-errors` §4), chế độ 2026-07-28 (`resultType`, `ttlMs`, `cacheScope`) |
| `mcp.routes.ts` | POST `/mcp` (401 thân rỗng + `WWW-Authenticate`, `-32700`, notification 202), GET/DELETE 405 |
| `mcp.service.ts` | `authenticate` (token → job `agent.cli` `running`), `handle` (`initialize`/`server/discover`/`ping`/`tools/list`/`tools/call`), gọi Dify gom (hạn tool + kết nối `/mcp`: đóng → abort + stop) + bước `tool` (ngoại lệ → `failed INTERNAL_ERROR`) + usage; chỗ nối `SideEffectGate` (B9) |
| `mcp.repo.ts` | token hash → job (plan-db §2), INSERT/UPDATE bước `tool` (`insertStep` P11 ở `lib/run-steps.ts`), xác nhận `consumeConfirmation`/`requireConfirmation`/`runLocale` (plan-db §3.2) |
| `confirm.rules.ts` | `isAgreeReply`, `confirmationPrompt`, `confirmationInstruction`, `confirmationRequiredResult` (`content[0]` JSON `ToolConfirmationRequired`, `content[1]` chỉ dẫn, `structuredContent`) |
| `confirm.service.ts` | `confirmationGate` (`SideEffectGate` thật, plan-db §3.2): transaction `user` của job — tiêu thụ nguyên tử `confirmed` (→ gọi Dify một lần, bước `tool` `detail.confirmation=consumed`) hoặc bước `tool` `failed` CONFIRMATION_REQUIRED + `pending` → `confirmationRequiredResult(runs.locale)`, không gọi Dify |

Wiring: `src/app.mcp.ts` (`mountMcp`, `runnerMcp` — `mcp` của payload job agent). Token job băm bằng `lib/job-token.ts`,
không bao giờ log. `app.mcp.ts` nối `confirmationGate`; `McpService` không có cổng thì từ chối tool `side_effect`. Quyết định
`pending` → `confirmed`/`declined` ở E12 (`runs/confirm.repo.ts`).
