# modules/mention — tag `@agent` (HUB-FR-91, HUB-BR-18)

Spec H2b-routing (R01–R10); plan §4, §5.1–5.2; chữ ký hàm thuần `plan-rules.md`.

| File | Vai trò |
|---|---|
| `mention-parse.rules.ts` | thuần: `routeMessage` (lệnh `/` · tag `@` · `@@` · chữ), `parseMention` |
| `mention.rules.ts` | thuần: `suggestAgents`, `firstUnknownTag`, `directText`, `responderOf` |

Trạng thái: B0 chỉ chữ ký (thân ném `not implemented`). B4: `mention.service.ts` (`prepareMention` → `RunPlan`); B6:
`direct-driver.ts` (run `direct`).
