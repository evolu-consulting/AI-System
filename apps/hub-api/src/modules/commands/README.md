# modules/commands — lệnh `/` (HUB-FR-10, HUB-FR-11, HUB-FR-12, HUB-FR-76, HUB-BR-01)

Spec H2a-dify-command (R01–R08, R16); plan §4–§5.1, chữ ký hàm thuần `plan-rules.md`.
Thư mục con (TD #44, H2b B0): `driver/` (driver sync/async + repo step). `*.rules.ts`, `catalog.types.ts` giữ ở gốc (test khoá import).

| File | Vai trò |
|---|---|
| `catalog.types.ts` | `CatalogWorkflow`, `CatalogCommand`, `WorkflowJobInput` (kiểu cache catalog Admin) |
| `command-parse.rules.ts` | `classifyMessage`, `tokenize`, `bindArgs` (R05) |
| `command-input.rules.ts` | `buildInputs` (R06), `appNeedsQuery` |
| `command-access.rules.ts` | `usableCommands` — chép `visible` của `computeEffectiveAccess` Admin (P5, Q4) |
| `suggest.rules.ts` | `levenshtein`, `suggestCommands` (R04) |
| `menu.rules.ts` | `toMenuItem` (GET `/commands`) |
| `commands.service.ts` | `CommandService.usable(u)` (ảnh catalog + lệnh dùng được, chụp một lần/request), `menu(u)`, `prepare(u, {name, rest, ctx}) → PreparedCommand` (ném `CMD_NOT_FOUND`/`CMD_MISSING_ARG`, R01–R08) |
| `commands.routes.ts` | GET `/commands` (JWT ở gốc `app.ts`, mount qua `app.h2a.ts` `mountH2a`) |
| `driver/command-driver.ts` | `commandDriver(deps, prepared)` → `RunDriver` sync (plan §5.2): step `workflow`, Dify streaming → `delta` ≤ 40, hạn `timeout_s` → stop + `TIMEOUT`, huỷ → stop, usage `billing=dify` |
| `driver/command-async-driver.ts` | B6 · `asyncCommandDriver(deps, prepared)` → `RunDriver` async (plan §5.3): `buildWorkflowJobPayload` → `WorkflowJobRunner` (step + job một transaction, `step.started` sau COMMIT) → `job.result` text → `delta` ≤ 40 + `run.finished`; `job.failed` → `run.failed`; hạn `timeout_s` từ lúc bắt đầu, giữ qua requeue → `TIMEOUT` (writer huỷ job); provider `dify` tắt → `NOT_CONFIGURED`, không job |
| `driver/command-files.ts` | H2c B7 · `uploadCommandFiles(deps, input, signal)`: `PreparedCommand.files` (≤ 1, T9) → `attachments/attachment-dify` upload Dify → `inputs[input] = DifyFileInput`; lỗi → `failed{code, reason, trace.upload}` / `aborted`; log `dify-upload`. Sync gọi trong step `workflow` trước `runStreaming`; async gọi trước enqueue (lỗi ⇒ step mở-đóng `failed`, không job) — spec-decisions B7-4, B7-5 |
| `driver/command-run.repo.ts` | `openWorkflowStep` (`insertStep`, P11) / `closeWorkflowStep` |

Review 1 (RV1-H2/H3): ghi usage lỗi chỉ `warn command-usage-failed` (không làm hỏng run đã xong); ngoại lệ sau khi mở step → `failOpenStep` đóng step `failed INTERNAL_ERROR` (step không treo `running`). Dify `user` = `<tenant_key>:<user_id>` qua `config/catalog.rules.ts` `tenantKeyOf` (thiếu key ⇒ tenant id).

Trạng thái: `usableCommands` (B1; catalog cache ở `modules/config/catalog.*`), menu GET `/commands` (B2), parse/input/gợi ý/`prepare` + E12 tạo run `kind=command` (B3) xong. Driver sync (B5) nối qua `app.h2a.ts` `commandDriverFor`; lệnh `async` (B6) qua `driver/command-async-driver` (`app.async.ts` dựng `WorkflowJobRunner`; app không Redis → `pendingCommandDriver`).
Phụ thuộc: `@ai/contracts` (kiểu); driver: `dify/` (client, credential, usage), `lib/run-steps`, `runs` (kiểu `RunDriver`). Luật `*.rules.ts` thuần, không I/O.
