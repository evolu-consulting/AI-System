# modules/mcp — MCP server `/mcp` của Hub (HUB-FR-50, HUB-FR-95, WRK-FR-13)

Spec H2a-dify-command (R18–R22); plan P7, §6; `plan-db` §2–3; câu chữ `plan-errors` §4–5.

| File | Vai trò |
|---|---|
| `mcp.rules.ts` | `parseRpc`, `negotiateProtocol`, `toolInputSchema`, `mcpToolsFor`, `validateToolArgs`, `toolTimeoutS` |
| `confirm.rules.ts` | `isAgreeReply`, `confirmationPrompt`, `confirmationInstruction` (xác nhận `side_effect`) |

Trạng thái: B0 chỉ có chữ ký; route/service/repo ở B8–B9. Token job băm bằng `lib/job-token.ts`.
