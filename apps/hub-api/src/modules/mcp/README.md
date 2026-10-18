# modules/mcp — MCP server `/mcp` của Hub (HUB-FR-50, HUB-FR-95, WRK-FR-13)

Spec H2a-dify-command (R18–R22); plan P7, §6; `plan-db` §2–3; câu chữ `plan-errors` §4–5.

| File | Vai trò |
|---|---|
| `mcp.rules.ts` | `parseRpc`, `negotiateProtocol`, `toolInputSchema`, `mcpToolsFor` (bỏ app `chat`/`agent` thiếu `query`; H2c `hasFiles`), `validateToolArgs` (input `file` = chuỗi), `fileArg`, `toolTimeoutS`; dựng result/lỗi JSON-RPC, câu lỗi tool (`plan-errors` §4), chế độ 2026-07-28 (`resultType`, `ttlMs`, `cacheScope`) |
| `mcp.routes.ts` | POST `/mcp` (401 thân rỗng + `WWW-Authenticate`, `-32700`, notification 202), GET/DELETE 405 |
| `mcp.service.ts` | `authenticate` (token → job `agent.cli` `running`), `handle` (`initialize`/`server/discover`/`ping`/`tools/list`/`tools/call`: kiểm tham số + file + cổng rồi gọi `WorkflowInvoker`); chỗ nối `SideEffectGate` (B9) + `refuseSideEffect` (cổng mặc định); K1: `ctx.kh` + `kh-query` qua `KhQueryService` |
| `adapters/workflow-invoker.ts` | P-d2 T18s · cổng `WorkflowInvoker` + `DifyWorkflowInvoker`: key → bước `tool` `running` → upload file → Dify gom (hạn tool + kết nối `/mcp`: đóng → abort + stop) → kết thúc bước (ngoại lệ → `failed INTERNAL_ERROR`) + usage; một bản dùng chung dựng ở `app.mcp.ts` |
| `mcp-call.ts` | `stepCodeOf` (kết quả Dify → mã bước) |
| `mcp-files.ts` | H2c (B8, P12, R23): `resolveToolFiles` (input `file` → `fileArg` theo `payload.attachments`), `uploadToolFiles` (Dify `/files/upload` qua `attachments/attachment-dify.ts` → `inputs[input]` object), câu `TOOL_FILE_TEXT` |
| `mcp.repo.ts` | token hash → job (plan-db §2), INSERT/UPDATE bước `tool` (`insertStep` P11 ở `lib/run-steps.ts`), xác nhận `consumeConfirmation`/`requireConfirmation`/`runLocale` (plan-db §3.2) |
| `confirm.rules.ts` | `isAgreeReply`, `confirmationPrompt`, `confirmationInstruction`, `confirmationRequiredResult` (`content[0]` JSON `ToolConfirmationRequired`, `content[1]` chỉ dẫn, `structuredContent`) |
| `confirm.service.ts` | `confirmationGate` (`SideEffectGate` thật, plan-db §3.2): transaction `user` của job — tiêu thụ nguyên tử `confirmed` (→ gọi Dify một lần, bước `tool` `detail.confirmation=consumed`) hoặc bước `tool` `failed` CONFIRMATION_REQUIRED + `pending` → `confirmationRequiredResult(runs.locale)`, không gọi Dify |

Wiring: `src/app.mcp.ts` (`mountMcp`, `runnerMcp` — `mcp` của payload job agent). Token job băm bằng `lib/job-token.ts`,
không bao giờ log. `app.mcp.ts` nối `confirmationGate`; `McpService` không có cổng thì từ chối tool `side_effect`. Quyết định
`pending` → `confirmed`/`declined` ở E12 (`runs/confirm.repo.ts`).
