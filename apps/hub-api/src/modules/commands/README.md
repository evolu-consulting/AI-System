# modules/commands — lệnh `/` (HUB-FR-10, HUB-FR-11, HUB-FR-12, HUB-FR-76, HUB-BR-01)

Spec H2a-dify-command (R01–R08, R16); plan §4–§5.1, chữ ký hàm thuần `plan-rules.md`.

| File | Vai trò |
|---|---|
| `catalog.types.ts` | `CatalogWorkflow`, `CatalogCommand`, `WorkflowJobInput` (kiểu cache catalog Admin) |
| `command-parse.rules.ts` | `classifyMessage`, `tokenize`, `bindArgs` (R05) |
| `command-input.rules.ts` | `buildInputs` (R06), `appNeedsQuery` |
| `command-access.rules.ts` | `usableCommands` — chép `visible` của `computeEffectiveAccess` Admin (P5, Q4) |
| `suggest.rules.ts` | `levenshtein`, `suggestCommands` (R04) |
| `menu.rules.ts` | `toMenuItem` (GET `/commands`) |

Trạng thái: `usableCommands` xong (B1; catalog cache ở `modules/config/catalog.*`); hàm khác còn stub B0, route/service/driver ở B2–B5.
Phụ thuộc: `@ai/contracts` (kiểu). Luật thuần, không I/O.
