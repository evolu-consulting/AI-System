# modules/dify — gọi Dify (HUB-FR-89, HUB-FR-90)

Spec H2a-dify-command (R09–R11, R14, R15, R17, R20); plan §5.2, §5.4; bảng lỗi `plan-errors` §2 (chung với Runtime Python, RT3).

| File | Vai trò |
|---|---|
| `dify.rules.ts` | URL/body run & stop, `interpretDifyEvent`, `mapDifyHttpError`, `finalText`, `difyUsage`, `maskSecret`/`maskInputs`, `difyUser`, `difyAgentInput` |

Trạng thái: B0 chỉ có chữ ký; client SSE, `credential.service`, `dify.usage`, `dify-agent-runner` ở B4/B7.
Phụ thuộc: `@ai/contracts`, `commands/catalog.types`. Không log app-key.
