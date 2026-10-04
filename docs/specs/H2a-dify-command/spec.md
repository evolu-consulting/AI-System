---
id: H2a-dify-command
title: Dify + command `/` + MCP (Command Runner, workflow.async, agent dify-*, tool side_effect)
milestone: H2a
status: draft                 # draft → ready → approved → in-progress → done
requirements:
  [HUB-FR-10, HUB-FR-11, HUB-FR-12, HUB-FR-13, HUB-FR-14, HUB-FR-23, HUB-FR-24, HUB-FR-50, HUB-FR-51,
   HUB-FR-76, HUB-FR-80, HUB-FR-95, HUB-BR-01, HUB-BR-04, HUB-BR-06, HUB-BR-11, HUB-BR-12, HUB-BR-19, HUB-BR-20,
   WRK-FR-06, WRK-FR-07, WRK-FR-13,
   AC-H01, AC-H02, AC-H05, AC-H11, AC-H12, AC-H22, AC-W06]
design:
  - docs/design/agent-hub/ba-agent-hub.md (§5 Router, §6.2, §6.3 FR-23/24/95, §6.6 FR-50/51, §6.8 FR-76/80, §7, §9, §11, §12 câu 4/7)
  - docs/design/worker/ba-worker.md (§2 `workflow.async`, §5.1 FR-06/07, §5.2 FR-13, §7, §10 AC-W06)
  - docs/design/architecture.md (§4 command/catalog, §6.A)
  - docs/specs/M2-catalog-command/spec.md (M2-R13…R19 command/input map) · plan.md §3.2 (định dạng secret)
  - docs/specs/H1-hub-core/spec.md (nền: H1-R01…R26) · spec-decisions.md "Kết luận H1"
  - CR-019, CR-028, CR-031, CR-034
owner: backend-lead (TS + Python)
---

# H2a · Dify + command `/` + MCP

Mốc con đầu của H2 (`docs/ROADMAP.md` H2a–H2d). Nền: H1.

## 1. Phạm vi
**Mục tiêu:** đường **command** chạy thật end-to-end (gõ `/dich en` → Hub → Dify → stream về), workflow trong catalog Admin dùng được làm **tool** của agent qua MCP, agent bọc một workflow (`dify-*`), và Admin có điểm gọi "Test command" cho M5.

| # | Làm | Mã |
|---|---|---|
| 1 | Router: tin bắt đầu `/` → Command Runner, không bao giờ rơi xuống Orchestrator; `//` = chữ `/` | HUB-BR-01 |
| 2 | Cache thêm catalog Admin (features, feature_commands, entitlements, grants, commands, command_names, workflows) + quyền command | HUB-FR-76, AC-H05, AC-H11 |
| 3 | `GET /commands` (menu `/`, chỉ lệnh user được dùng, không lộ workflow/key) | HUB-FR-10 |
| 4 | Parse cú pháp, áp input map (nguồn M2-R16), validate theo input schema, `CMD_NOT_FOUND` + ≤ 3 gợi ý, `CMD_MISSING_ARG` | HUB-FR-11, 12, 14, AC-H01, H02 |
| 5 | Command Runner `mode=sync` trong Hub (Dify streaming → `delta`), timeout, huỷ (stop task Dify) | HUB-FR-13, 80 |
| 6 | `mode=async` → job `workflow.async` chạy ở Agent Runtime (Python): Dify streaming, tiến độ, retry 2 s/8 s, đưa lại queue khi Runtime chết | HUB-FR-13, WRK-FR-06, 07, AC-W06 |
| 7 | Runtime agent `dify-workflow` / `dify-agent` (chạy trong Hub, không job) | HUB-FR-23 |
| 8 | MCP server `/mcp` của Hub: tool = workflow gắn cho agent của job; token theo job; payload `agent.cli` có `mcp`; Runtime nối MCP vào Claude Agent SDK | HUB-FR-24 (phần `mcp`), 50, WRK-FR-13, HUB-BR-11, 12, 19, AC-H12 |
| 9 | Xác nhận trước tool `side_effect` (Hub chặn ở MCP, agent chuyển thành `need_input`) | HUB-FR-95, HUB-BR-20, AC-H22 |
| 10 | `POST /internal/test-run` (service token) chạy thử command nháp — đầu vào cho M5 (ADM-FR-23) | HUB-FR-51 |
| 11 | Usage `billing=dify` cho mọi lời gọi Dify; `user=<tenant>:<user_id>` | HUB-FR-33 (phần Dify), 80, WRK-FR-07 |
| 12 | Tách `runtimes/cli/job_run.py` (398/400 dòng) trước khi thêm MCP vào đường CLI | nợ H1 (spec-decisions "Nợ chuyển TECH-DEBT") |

**Không làm (H2a):** `@agent`, `GET /agents`, Orchestrator theo tenant, `max_concurrent_runs`, `delta` từ Runtime, F3–F7 (→ **H2b**); đính kèm file, `POST /attachments`, Dify `/files/upload` (→ **H2c**; map `attachment` bắt buộc mà không có file → `CMD_MISSING_ARG`); `llm`/`python`, Model Gateway API, fallback, Codex/Gemini, `maint.probe` (→ **H2d**); quota, `/agent-grants` (→ H3); Studio, vế "Xem như model thấy" của AC-H12 (→ H4); sửa file Admin/Chat.

## 2. Nghiệp vụ
Chỉ phần cụ thể hoá BA; nguồn BA ở cột cuối.

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H2a-R01 | Sau khi bỏ khoảng trắng đầu: bắt đầu `//` → bỏ **một** `/`, xử lý như chữ qua Orchestrator (H1). Bắt đầu `/` → Command Runner. Tên lệnh = chuỗi sau `/` tới khoảng trắng đầu, so **không phân biệt hoa thường** với `admin.command_names` (tên + alias, M2-R13). Tên rỗng (`/` hoặc `/ abc`) → `CMD_NOT_FOUND` không gợi ý | HUB-BR-01, FR-11 |
| H2a-R02 | Quyền command = đúng luật phần feature/command của Kiểm tra quyền M3 (`apps/admin-api/src/modules/access/*.rules.ts`, spec M3): command `enabled` ∧ workflow `enabled` ∧ ∃ feature F chứa command: F `on` (hoặc `beta` ∧ user thuộc group `beta-testers`) ∧ (F = `core` ∨ entitlement chưa thu hồi cho tenant) ∧ F cấp cho user hoặc group của user. Hub viết lại hàm thuần tương đương (không import file Admin) + **test đối chiếu** cùng bộ dữ liệu với Admin; nợ gộp vào `packages/*` | HUB-FR-76, BR-19 |
| H2a-R03 | Kiểm quyền hai lần: lúc `GET /commands` và lúc chạy (tra cache hiện hành). Không có quyền / không tồn tại / bị tắt → cùng `CMD_NOT_FOUND`; gợi ý chỉ lấy trong lệnh user được dùng | HUB-FR-14, 76, AC-H11 |
| H2a-R04 | Gợi ý: khoảng cách Levenshtein giữa tên gõ và mọi tên/alias user được dùng, giữ khoảng cách ≤ max(2, ⌊len/3⌋), sắp theo khoảng cách rồi tên, trả tên chính, khử trùng, ≤ 3 | HUB-FR-14, AC-H02 |
| H2a-R05 | Parse: tách token theo khoảng trắng; `"…"` gom một token (`\"` thoát); token gán theo thứ tự `args`; arg `rest=true` nuốt phần còn lại **nguyên văn** (giữ khoảng trắng trong). Thiếu → `default` → `fallback` (`$selection` = `context.selection`) → rỗng. Thừa token khi không có `rest` → bỏ, ghi trace | HUB-FR-11, AC-H01 |
| H2a-R06 | Input map theo M2-R16: `arg`, `const`, `selection`, `page_url`, `page_text` (từ `context` của request, H2a-R16), `user_id`, `tenant_id` (uuid từ JWT), `attachment` (H2c). Validate theo `workflows.input_schema`: input `required` rỗng → `CMD_MISSING_ARG` `details.missing` = tên **tham số command** tương ứng (hoặc tên input nếu nguồn không phải `arg`); sai kiểu số/boolean → `CMD_MISSING_ARG` `details.invalid` | HUB-FR-12 |
| H2a-R07 | `CMD_NOT_FOUND` / `CMD_MISSING_ARG` trả **trước khi tạo run**: không lưu message, không run, không gọi Orchestrator/Dify. HTTP + body theo §3 (Q3) | HUB-BR-01, AC-H02, H11 |
| H2a-R08 | Run command: `runs.kind='command'`, `command_id`, `feature_id` = feature theo key nhỏ nhất user được cấp chứa lệnh (BA §12 câu 4). Snapshot command + workflow chốt lúc tạo run; sửa/tắt giữa chừng không ảnh hưởng run đang chạy | HUB-BR-06, AC-H05 |
| H2a-R09 | `mode=sync`: Hub gọi Dify `response_mode=streaming` (app `workflow` → `POST {base_url}/workflows/run`; `chat`/`agent` → `POST {base_url}/chat-messages`, `query` = input tên `query`, thiếu → `CMD_MISSING_ARG`). `text_chunk` / `message` / `agent_message.answer` → `delta` (cắt ≤ 40 ký tự như H1-R09). Không có chunk nào → khi `workflow_finished` lấy `outputs[output.field]` (thiếu `output.field` → `text`); vẫn rỗng → `UPSTREAM_ERROR` (không trả rỗng). Một step nhãn tĩnh "Đang chạy lệnh" (không tên workflow/node) | HUB-FR-13, BR-04 |
| H2a-R10 | Timeout = `commands.timeout_s` (sync) → huỷ request + gọi API stop task của Dify (best-effort) → `run.failed TIMEOUT`. `POST /runs/:id/cancel` → như vậy với `CANCELLED`, ≤ 5 s | HUB-FR-13, 43 |
| H2a-R11 | Ánh xạ lỗi Dify: HTTP 401/403 hoặc secret thiếu/giải mã lỗi → `NOT_CONFIGURED`; 404 (app/endpoint) → `NOT_CONFIGURED`; 400 `invalid_param` → `UPSTREAM_ERROR`; 429/5xx/lỗi mạng → `UPSTREAM_ERROR`; SSE `error` hoặc `workflow_finished.status ∈ {failed, stopped}` (HTTP 200) → `UPSTREAM_ERROR`. `message` cho user tĩnh, không chép thân lỗi Dify; thân lỗi (≤ 300 ký tự, đã che key) chỉ vào trace | BR-04, HUB-NFR-04 |
| H2a-R12 | `mode=async`: Hub tạo job `workflow.async` (không chứa secret), run/SSE như sync (client không đổi). Runtime: Dify streaming, `job.progress` (Hub chuyển thành `step.started/finished`, **không** phát `job.progress` ra kênh chat), `job.result{text}`. Timeout = `commands.timeout_s` | HUB-FR-13, WRK-FR-07 |
| H2a-R13 | Retry `workflow.async`: tối đa 2 lần, backoff 2 s rồi 8 s, **chỉ** khi lỗi mạng/5xx **trước** khi nhận sự kiện đầu (`workflow_started`/chunk đầu). Mất heartbeat > 60 s → `orphaned` → về `queued` (`attempts`+1, tối đa 3 lần chạy) thay vì `failed` như `agent.cli`. Workflow `side_effect` không retry/không đưa lại queue sau khi request đã gửi (Q6) | WRK-FR-06, AC-W06 |
| H2a-R14 | Agent `dify-workflow` (app `workflow`) / `dify-agent` (app `chat`/`agent`): `runtime_options.workflow_key` trỏ đúng một workflow, loại app khớp runtime (sai → seed từ chối). Task → `query` (input `query`, hoặc input chuỗi bắt buộc duy nhất; không xác định được → seed từ chối). `dify-agent` giữ `conversation_id` Dify trong `hub.cli_sessions(conversation_id, agent_id, provider_key='dify')`. Kết quả luôn `done{text}`; lỗi theo R11. Chạy trong Hub, timeout `agents.timeout_s`, huỷ như R10 | HUB-FR-23 |
| H2a-R15 | Gọi Dify luôn `user = <tenant_key>:<user_id>` (test-run: `platform:<user_id>` của người bấm). Mỗi lời gọi một dòng `usage_logs`: `billing='dify'`, `provider_key='dify'`, `model=null`, token từ `metadata.usage` (chat) hoặc `total_tokens` (workflow → `input_tokens`, `output_tokens=0`), `cost_usd` = `total_price` nếu `currency='USD'` không thì 0, `latency_ms`, `feature_id` của run command (tool/agent → `null`) | HUB-FR-80, 33, WRK-FR-07 |
| H2a-R16 | Body gửi tin mở rộng `context?: {selection?, page_url?, page_text?}` (≤ giới hạn §3); chỉ dùng khi input map trỏ tới (không gửi kèm cho Orchestrator/agent) | HUB-BR-07 |
| H2a-R17 | Secret: Hub giải mã app-key theo M2 plan §3.2 (`SECRET_MASTER_KEY` chung với Admin) **ngay trước khi gọi**, không cache bản rõ quá một lời gọi; bản rõ không bao giờ vào DB (`jobs.payload`, `run_steps`, `usage_logs`, `messages`), Redis, SSE, trace, log, MCP | ADM-BR-04, AC-A06 |
| H2a-R18 | MCP `/mcp` (Streamable HTTP, JSON-RPC: `initialize`, `tools/list`, `tools/call`). Token: 32 byte ngẫu nhiên, tạo lúc enqueue job `agent.cli` có workflow, lưu **hash** (sha256), phạm vi (tenant, user, agent, run, flow, job); hợp lệ chỉ khi job `running`. Thiếu/sai/hết hạn → 401. Orchestrator không có MCP (H1-R17) | HUB-FR-50, WRK-FR-13 |
| H2a-R19 | `tools/list` = `hub.agent_workflows` của agent ∩ workflow `enabled` ∩ `payload.mcp.tools` (snapshot lúc tạo job). Tên tool = `workflows.key` (BR-11), mô tả = `workflows.description`, `inputSchema` JSON Schema dựng từ `input_schema` kèm mô tả từng tham số — đọc từ cache hiện hành (sửa mô tả ở Admin → job **mới** thấy trong ≤ 5 s, AC-H12). Không kiểm quyền feature (BR-19). `tools/call` tool ngoài danh sách → lỗi JSON-RPC không lộ tồn tại | HUB-FR-50, BR-11, 19, AC-H12 |
| H2a-R20 | `tools/call`: validate `arguments` theo schema → gọi Dify như R09 (gom kết quả, không stream), `user` R15, timeout = min(`agents.timeout_s`, 300 s) (BA §12 câu 7). Kết quả text; lỗi → `isError=true` + câu tĩnh. Mỗi lời gọi = `run_steps.type='tool'` (`workflow_id`, input đã che) + usage R15 | HUB-FR-50, BR-12 |
| H2a-R21 | `side_effect`: `tools/call` tool có `side_effect=true` mà flow không có xác nhận `confirmed` cho đúng (flow, agent, workflow) → **không gọi Dify**, ghi xác nhận `pending` (gắn run hiện tại), trả `isError=true` mã `CONFIRMATION_REQUIRED` + chỉ dẫn "trả `need_input` với choices [Đồng ý, Huỷ]" (theo `locale`). Agent trả `need_input` → SSE `ask` (H1-R08) | HUB-FR-95, BR-20, AC-H22 |
| H2a-R22 | Tin kế trong flow: nội dung (trim, không phân biệt hoa thường) bằng đúng choice "Đồng ý"/"Agree" và có `pending` của run ngay trước → `confirmed`; khác → `declined`. Run kế được gọi tool **đúng một lần**: tiêu thụ nguyên tử (`UPDATE … SET status='consumed' WHERE status='confirmed' RETURNING`) trước khi gọi Dify; lần hai → lại `CONFIRMATION_REQUIRED`. Xác nhận chỉ sống cho run kế tiếp của flow. Trace ghi `CONFIRMATION_REQUIRED` / confirmed / consumed | HUB-FR-95, BR-20 |
| H2a-R23 | Nguồn cờ `side_effect`: cột `admin.workflows.side_effect` nếu tồn tại (kiểm `information_schema` lúc nạp cache); chưa có (Admin chưa áp CR-034) → danh sách `workflow_flags.side_effect: [<key>]` trong seed yaml Hub (Q2) | CR-034 |
| H2a-R24 | `POST /internal/test-run`: chỉ `Authorization: Bearer <HUB_INTERNAL_TOKEN>` (so hằng thời gian); body = command nháp (dạng `CommandCreate` của `@ai/contracts` + `text`, `context?`, `actor_user_id`); chạy đường sync R05–R11 **không** kiểm quyền feature, không tạo conversation/run/message; trả JSON `{output, steps[], usage, ms}` hoặc lỗi theo mã R11. Không SSE | HUB-FR-51 |
| H2a-R25 | Tương thích C1: request không bắt đầu `/` và không dùng trường mới → response/SSE parse được bằng `@ai/contracts/chat` (strict) như H1; bộ `test:contract:chat` 41 ca xanh không sửa | H1-R01, CHAT-AC-33 |

## 3. Contract (backend-lead)
<!-- backend-lead: plan.md §2. Ràng buộc đã biết dưới đây. -->
- **Không sửa `@ai/contracts/chat`** (của C1). Phần mới cho client ở subpath mới **`@ai/contracts/chat-ext`** (superset, Hub sở hữu tới khi combine): `GET /commands` (`CommandMenuItem{name, aliases, description{vi,en}, args[{name, description, required, has_fallback}]}`), `SendMessageRequestExt` (+`context`), mã lỗi HTTP mới `CMD_NOT_FOUND` (404, `details.suggestions: string[] ≤ 3`), `CMD_MISSING_ARG` (422, `details.missing[]`, `details.invalid[]`). Kênh SSE giữ nguyên tập sự kiện C1. Ghi **CR-impact** cho phiên Chat (menu `/`, gửi `context`, hiện lỗi pre-run) — Q3.
- **Hub↔Runtime `@ai/contracts/hub`:** `JobPayload` thêm biến thể `workflow.async`; `agent.cli.mcp` từ `null` → `{url, token, tools[]} | null`; `RunEvent` thêm tiến độ cho workflow nếu cần; `contracts:gen` + `contracts:check` (ADR-0009).
- **Nội bộ:** `/mcp` (R18–R22) · `POST /internal/test-run` (R24) · cách Runtime lấy app-key cho `workflow.async` (Q5).

| Method | Path | Role | Request | Response | Lỗi (HTTP · code) |
|---|---|---|---|---|---|
| GET | `/commands` | mọi user | — | `CommandMenuItem[]` | 401 |
| POST | `/conversations/:id/messages` | chủ hội thoại | `SendMessageRequestExt` | SSE (C1) | 404 `CMD_NOT_FOUND` · 422 `CMD_MISSING_ARG` · như C1 |
| POST | `/mcp` | token job | JSON-RPC | JSON-RPC | 401 |
| POST | `/internal/test-run` | service token | xem R24 | xem R24 | 401 · 400 · lỗi R11 |

## 4. Dữ liệu (backend-lead)
<!-- backend-lead: plan.md §3 / plan-db.md. Ràng buộc đã biết: -->
- `hub.runs`: `kind` thêm `command`, cột `command_id`, `feature_id` (không FK sang `admin`). `run_steps.type` thêm `workflow`, `tool` + `workflow_id`.
- `hub.jobs`: `type` thêm `workflow.async`; `mcp_token_hash` (hoặc bảng riêng), `attempts` dùng cho R13.
- Mới `hub.tool_confirmations` (tenant_id, user_id, flow_id, agent_id, workflow_id, status `pending|confirmed|declined|consumed`, run_id, timestamps; RLS như bảng hội thoại).
- Quyền đọc `admin.*` của `hub_ro`: features, feature_commands, feature_entitlements, feature_grants, commands, command_names, workflows — kiểm grant hiện có (0000 mặc định, TECH-DEBT #34). **`admin.secrets`: `hub_ro` bị REVOKE ALL (M2 `0004_catalog_rls.sql`)** → cần GRANT cột `(id, ciphertext, iv, key_version)` + policy SELECT cho `hub_ro` (Q1, phụ thuộc Admin).
- Seed yaml: agent `dify-*` (`runtime_options.workflow_key`), `agent_workflows` cho agent `agentic-cli` mẫu, `workflow_flags` (R23). Test int Admin giữ nguyên (HUB-H1-AC-08).

## 5. UI
Không có UI Hub. Menu `/`, `context`, lỗi pre-run: phiên Chat (Q3). Nút Test: M5.

## 6. Hiệu năng
| Chỉ tiêu | Ngưỡng | Đo bằng |
|---|---|---|
| `GET /commands`, `tools/list` (từ cache) | ≤ 50 ms p95 | `test:perf` (không chặn) |
| Overhead Hub trước khi gọi Dify | ≤ 200 ms p95 | `test:perf` |
| Chunk Dify → `delta` tới client | ≤ 100 ms thêm | int (mock stream có dấu thời gian) |
| Sửa/tắt command/feature ở Admin → `GET /commands` đổi | ≤ 5 s (NOTIFY `config_changed`) | acceptance AC-H05 (chặn) |
| Huỷ command sync/async | ≤ 5 s | acceptance (chặn) |

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| **Dify thật** | Chỉ smoke thủ công `DIFY_LIVE=1` (Q10) |
| **Mock Dify** | `tools/mocks/src/dify.ts` hiện **chỉ `blocking`** (từ chối `response_mode≠blocking`), 3 kịch bản theo token (`ok/unauthorized/timeout`), không stream, không stop, không 5xx/`failed`. H2a cần: SSE `workflows/run` + `chat-messages` (`text_chunk`, `message`, `agent_message`, `agent_thought`, `workflow_finished`, `message_end`, `error`, `ping`), API stop, kịch bản 5xx n lần, `status=failed`, chậm, `metadata.usage`. Mặc định: **mock riêng của Hub** (in-process Hono trong test support/`tools/hub-dev`), không sửa `tools/mocks` (Admin/M0 đang dùng, có test khoá) — Q9 |
| Admin (secret, `side_effect`, M5) | Q1 grant secret; Q2 cờ `side_effect` qua seed; M5 gọi `/internal/test-run` khi combine |
| Claude Agent SDK + MCP HTTP | `fake-cli` thêm chỉ thị `#fake:tool=<key>[ args=<json>]` gọi `/mcp` thật bằng token job (đường token, side_effect, timeout là code thật); `claude-sub` + MCP chỉ smoke `HUB_LIVE=1` |
| API key model | Không cần ở H2a (Q1 H1 vẫn hiệu lực: Orchestrator `agentic-cli`/`claude-sub`; test `fake-cli`) |

Env mới (tên · dev): `SECRET_MASTER_KEY` (Hub, chung giá trị với admin-api) · `HUB_INTERNAL_TOKEN` (chung với admin-api cho M5) · `HUB_MCP_URL=http://localhost:4000/mcp` (URL Runtime/CLI gọi, WSL2 mirrored) · `HUB_DIFY_TIMEOUT_MAX_S=300` · `DIFY_LIVE` (smoke). Không env chứa app-key Dify (key nằm ở `admin.secrets`).

Nguồn tham khảo cách gọi Dify (không chép giá trị): auto-pilot `apps/extension-hub/src/core/dify/{chat-client,client}.ts`, `apps/copilot-hub/apps/api/src/brain/dify-agent-brain.ts`.

## 8. Tiêu chí nghiệm thu (qc)
Nguyên văn AC ở BA (`ba-agent-hub` §11, `ba-worker` §10).

| AC | Phạm vi H2a | Test |
|---|---|---|
| AC-H01 | Đủ, `context.selection` gửi qua `chat-ext`; mock Dify ghi nhận `inputs.source_text="xin chào"`, `target_lang="en"`, `user=<tenant_key>:<user_id>` | acceptance |
| AC-H02 | Đủ: `CMD_NOT_FOUND` + gợi ý `dich`; không run, không job Orchestrator | acceptance |
| AC-H05 | Đủ: tắt command / feature → ≤ 5 s biến khỏi `GET /commands`; run dở vẫn `run.finished` (mock chậm) | acceptance |
| AC-H11 | Đủ: không entitlement → không trong menu; gõ vẫn `CMD_NOT_FOUND`, mock Dify 0 lời gọi | acceptance |
| AC-H12 | Vế "lời gọi thật": sửa `workflows.description` → job **mới** `tools/list` thấy mô tả mới ≤ 5 s. Vế Studio → H4 | acceptance |
| AC-H22 | Đủ với `fake-cli #fake:tool=create_trello_card`: lượt 1 → `ask{choices:[Đồng ý, Huỷ]}`, Dify 0 lời gọi; "Đồng ý" → đúng 1 lời gọi; gọi thẳng `/mcp` không xác nhận → trace `CONFIRMATION_REQUIRED` | acceptance |
| AC-W06 | Đủ cho `workflow.async`: kill Runtime giữa job → > 60 s → `queued` lại → chạy xong; run `finished` | Python int + TS int |

**AC kỹ thuật mới**

| AC | Given / When / Then | Test |
|---|---|---|
| HUB-H2a-AC-01 | Bảng parse/map: ngoặc kép, `\"`, `rest` giữ khoảng trắng, `default`, `fallback $selection`, thừa token, thiếu input bắt buộc → `details.missing`, sai kiểu → `details.invalid` | unit |
| HUB-H2a-AC-02 | Sync: mock stream 5 chunk → 5+ `delta`, `run.finished.content` = nối delta; không chunk → lấy `outputs[field]`; rỗng → `UPSTREAM_ERROR`; 1 dòng `usage_logs` `billing=dify` đúng R15 | acceptance |
| HUB-H2a-AC-03 | Lỗi Dify 401 → `NOT_CONFIGURED`; 503 → `UPSTREAM_ERROR`; 200 + `status=failed` → `UPSTREAM_ERROR`; quá `timeout_s` → `TIMEOUT` + mock nhận stop; cancel → `CANCELLED` ≤ 5 s + stop | acceptance |
| HUB-H2a-AC-04 | App-key giả `LEAK_KEY_…` không xuất hiện (thô/base64/hex) trong SSE, `jobs.payload`, `run_steps`, `usage_logs`, `messages`, Redis stream, log hub-api/Runtime | int |
| HUB-H2a-AC-05 | `/mcp`: không token / token sai / token job đã xong / token job khác agent → 401 hoặc tool không thấy; `tools/list` chỉ workflow gắn agent ∩ enabled; tenant A không gọi được tool qua token tenant B | int |
| HUB-H2a-AC-06 | `workflow.async`: 503 hai lần rồi OK → xong, 3 lần gọi, khoảng cách ≥ 2 s, ≥ 8 s (env rút ngắn cho test); 400 → không retry; `side_effect` + lỗi sau khi gửi → không retry | Python int |
| HUB-H2a-AC-07 | Agent `dify-workflow` / `dify-agent` được Orchestrator delegate → `done` pass-through; lượt 2 `dify-agent` gửi lại `conversation_id` lượt 1 | acceptance |
| HUB-H2a-AC-08 | `/internal/test-run`: sai token → 401; đúng → `{output, steps, usage, ms}`, không tạo `conversations/runs/messages`, Dify nhận `user=platform:<id>` | int |
| HUB-H2a-AC-09 | `//abc` → Orchestrator nhận "/abc"; lệnh bị thu hồi giữa lúc menu và gửi → `CMD_NOT_FOUND` | acceptance |
| HUB-H2a-AC-10 | Quyền command Hub = Admin: cùng fixture (feature on/off/beta, core, entitlement thu hồi, grant user/group) → tập lệnh Hub = tập lệnh của Kiểm tra quyền Admin | int đối chiếu |
| HUB-H2a-AC-11 | Hồi quy: `test:contract:chat` (Hub thật) 41 ca xanh; `contracts:check` xanh với biến thể job mới; test int Admin xanh nguyên văn | contract + CI |

Lệnh xong mốc: `done:h2a` (qc định nghĩa ở `test-plan.md` §7, mẫu `done:h1`).

## 9. Câu hỏi mở (mặc định dùng nếu người dùng không trả lời)
| # | Câu hỏi | Mặc định | Mức |
|---|---|---|---|
| Q1 | `hub_ro` không đọc được `admin.secrets` (M2 REVOKE). Ai cấp quyền? | Migration trong `packages/db/migrations-hub/` (Hub sở hữu): `GRANT SELECT (id, ciphertext, iv, key_version) ON admin.secrets TO hub_ro` + policy `FOR SELECT TO hub_ro`; ghi CR-impact để phiên Admin rà khi combine. Hub chỉ đọc bản mã, giải mã bằng `SECRET_MASTER_KEY` | Cao (secret) |
| Q2 | `admin.workflows.side_effect` chưa có (CR-034, phiên Admin) | R23: đọc cột nếu có, không thì `workflow_flags` trong seed yaml Hub; xoá nhánh dự phòng khi combine | Thường |
| Q3 | Contract chat mới (`GET /commands`, `context`, `CMD_*`) | Subpath `@ai/contracts/chat-ext` (superset, không sửa `chat`); lỗi pre-run HTTP 404/422; không thêm sự kiện SSE; CR-impact cho phiên Chat | Cao (contract) |
| Q4 | Command thuộc nhiều feature → `feature_id` | Feature key nhỏ nhất user được cấp (BA §12 câu 4) | Thường |
| Q5 | Runtime lấy app-key Dify cho `workflow.async` thế nào (Runtime không đọc `admin.*`, payload không chứa secret)? | Endpoint nội bộ Hub `POST /internal/jobs/:job_id/dify-credential` xác thực bằng token job (như MCP), chỉ khi job `running`, trả key qua TLS/localhost, Runtime giữ trong bộ nhớ tới hết job. Phương án B: Hub tự chạy async (không job) — đơn giản hơn nhưng lệch BA-W §2 | Cao (secret) |
| Q6 | Retry/đưa lại queue workflow `side_effect` | Không, sau khi request đã gửi (tránh chạy hai lần) — chặt hơn BA-W §2 | Thường |
| Q7 | Timeout tool | min(`agents.timeout_s`, `HUB_DIFY_TIMEOUT_MAX_S`=300) (BA §12 câu 7) | Thường |
| Q8 | Thư viện MCP server TS (`@modelcontextprotocol/sdk`) hay tự viết JSON-RPC tối thiểu? | Tự viết tập con (`initialize`, `tools/list`, `tools/call`, response JSON không SSE) — không thêm thư viện; nếu backend-lead chọn thư viện → ADR-0010 Proposed, Gate trình người dùng (Luật 2b) | Thường |
| Q9 | Mock Dify streaming đặt ở đâu | Mock riêng của Hub (test support / `tools/hub-dev`); `tools/mocks` không đổi | Thường |
| Q10 | Có Dify thật để smoke không? | Smoke `DIFY_LIVE=1` cuối mốc (như I2 của H1), `blocked` tới khi người dùng tạo workflow + secret ở Admin; không chặn `done:h2a` | Thường |
| Q11 | Agent `dify-*` map task → input | `query`, hoặc input chuỗi bắt buộc duy nhất; khác → seed từ chối (R14) | Thường |
| Q12 | Đường sync dùng `blocking` hay `streaming`? | `streaming` (app agent của Dify chỉ hỗ trợ streaming; cho `delta` sớm) | Thường |

Quyết định trong lúc làm: `spec-decisions.md` (mẫu H1).

## 10. Tranh chấp test
- (không)
