---
id: H1-hub-core
title: Hub lõi (apps/hub-api) + Agent Runtime tối thiểu (apps/agent-runtime)
milestone: H1
status: draft            # draft → ready → approved → in-progress → done
requirements:
  [HUB-FR-01, HUB-FR-02, HUB-FR-03, HUB-FR-20, HUB-FR-21, HUB-FR-25, HUB-FR-27, HUB-FR-28, HUB-FR-29,
   HUB-FR-31, HUB-FR-32, HUB-FR-33, HUB-FR-40, HUB-FR-41, HUB-FR-42, HUB-FR-43, HUB-FR-45, HUB-FR-60,
   HUB-FR-61, HUB-FR-62, HUB-FR-74, HUB-FR-75, HUB-FR-77, HUB-FR-83, HUB-FR-86, HUB-FR-88, HUB-FR-89,
   HUB-FR-90, HUB-BR-02, HUB-BR-03, HUB-BR-04, HUB-BR-06, HUB-BR-08, HUB-BR-14, HUB-NFR-01, HUB-NFR-02,
   HUB-NFR-03, HUB-NFR-04,
   WRK-FR-01, WRK-FR-02, WRK-FR-03, WRK-FR-04, WRK-FR-05, WRK-FR-10, WRK-FR-11, WRK-FR-12, WRK-FR-14,
   WRK-FR-15, WRK-FR-17, WRK-FR-20, WRK-FR-23, WRK-FR-24, WRK-FR-25, WRK-BR-02, WRK-BR-04, WRK-BR-05,
   WRK-BR-06, WRK-BR-07, WRK-NFR-01, WRK-NFR-02, WRK-NFR-03, WRK-NFR-04, WRK-NFR-06,
   AC-H06, AC-H07, AC-H08, AC-H09, AC-H13, AC-H14, AC-H15,
   AC-W02, AC-W03, AC-W04, AC-W05, AC-W07, AC-W08, AC-W09, AC-W10, AC-W11,
   CHAT-AC-31, CHAT-AC-32, CHAT-AC-33]
design:
  - docs/design/agent-hub/ba-agent-hub.md (§6.1, 6.3, 6.5, 6.8, §8, §9, §11)
  - docs/design/worker/ba-worker.md (§5, §6, §7, §10)
  - docs/adr/0007-hub-ts-agent-runtime-python.md · CR-019/020/021/025/028/029
  - docs/specs/C1-chat-ui/spec.md (§3, §8)
owner: backend-lead (TS + Python)
---

# H1 · Hub lõi + Agent Runtime tối thiểu

## 1. Phạm vi
**Mục tiêu:** `chat-web` chạy với Hub thật thay mock. Hub thật pass bộ test contract chat (`tests/contract/chat`, `HUB_URL`) ở phần "mọi Hub". Một luồng thật: tin nhắn → Orchestrator → delegate 1 agent `agentic-cli` (Claude Agent SDK Python, provider `claude-sub`) → stream về.

| # | Làm | Mã |
|---|---|---|
| 1 | `apps/hub-api` (TS/Bun/Hono): verify JWT EdDSA bằng khoá công khai Admin, không gọi Admin | HUB-FR-01, 74 |
| 2 | Cache cấu hình từ `admin` (hub_ro: tenants, trạng thái user, groups, group_members) + `hub`; LISTEN `config_changed`, `hub_config_changed`, poll 60 s | HUB-FR-02, 03 |
| 3 | Conversations · flows · messages · runs: CRUD, POST message → SSE đúng contract C1 (không `agent`/`provider`), `GET /runs/:id/events` + `Last-Event-ID` (Redis Streams), `POST /runs/:id/cancel`, `GET /runs/:id`, `GET /health` | HUB-FR-40, 41, 42, 43, 45 |
| 4 | Cách ly tenant/user, 404 thay 403; khoá tenant/user → 401 ngay | HUB-FR-75, 88, BR-02, BR-14 |
| 5 | Vòng lặp Orchestrator trong Hub: `delegate\|answer\|ask`, `max_steps`, ngân sách, kết quả agent `done\|partial\|need_input`, hỏi lại, pass-through; chỉ thấy agent user được dùng | HUB-FR-20, 21, 25, 27, 28, 29, 62 (phần runtime), 77, BR-03, 06, 08 |
| 6 | `AgentRunner` bản job (`hub.jobs` + `NOTIFY` + Redis Stream); manifest `hub.agent_types` | HUB-FR-89, 90 |
| 7 | `apps/agent-runtime` (Python, WSL2): claim `SKIP LOCKED`, heartbeat/orphaned, `XADD`, timeout, cancel process group ≤ 5 s, `agentic-cli`/`claude-sub`, `work/<job_id>/` + hook đường dẫn, resume session, nhận diện rate limit → cooldown, slot provider + tenant đếm trong DB, ghi `usage_logs` (token) | WRK-FR-01…05, 10–12, 14, 15, 17, 20, 23–25, WRK-BR-*, WRK-NFR-* |
| 8 | Schema `hub` thật (Drizzle, `packages/db`) + seed yaml (agent, Orchestrator, provider, profile, entitlement, grant); tương thích `hub.usage_logs` Admin M4 đang đọc | HUB-FR-60, 61, 83, 86 |
| 9 | Contract Hub↔Runtime: zod → JSON Schema → pydantic, CI kiểm khớp | ADR-0007 #6 |
| 10 | Provider giả `fake-cli` (chỉ dev/test) cho test/CI | §7 |

**Không làm (H1):** Studio UI/API (`/studio/*`, CRUD agent/provider/profile, Playground, dry-run, routing tests, audit cấu hình Hub); command `/` + Dify + MCP (`/mcp`, WRK-FR-13) và HUB-BR-01 (H2); runtime `llm`/`python`/`dify-*`, Codex/Gemini; fallback nhiều bước và `ALL_PROVIDERS_EXHAUSTED` ngoài profile 1 bước; quota, overage, `price_book`, `billable_usd` (để `null`), `/agent-grants` + Kiểm tra quyền, `/admin/usage` (H3); attachments; trace API và xem trace theo role (HUB-FR-52, 87); `maint.probe` (WRK-FR-22).

## 2. Nghiệp vụ
Chỉ phần cụ thể hoá BA.

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H1-R01 | Contract chat `@ai/contracts/chat` là nguồn chân lý phía client: Hub chỉ import, không sửa. Mọi response/SSE parse được bằng zod của contract; lệch → sửa Hub | C1 §3, CHAT-AC-33 |
| H1-R02 | JWT: thuật toán `EdDSA` cố định (cấm `none`/HS*), `iss="admin"`, `aud="ai-system"`, `sub`=user_id, `tid`=tenant_id, `role`; khoá công khai từ env. Sai chữ ký/hạn/aud/claim/uuid hoặc role ngoài enum → 401 `AUTH_EXPIRED` | HUB-FR-01, 74; `admin-api/src/lib/jwt.ts` |
| H1-R03 | Mọi truy vấn repo bắt buộc tham số `(tenant_id, user_id)` từ JWT, không nhận từ body/query. Tài nguyên không tồn tại / của user khác / của tenant khác → cùng một 404 `NOT_FOUND`, kể cả `tenant_admin`/`platform_admin` (H1 chưa có API xem chéo) | HUB-FR-75, BR-02, 14 |
| H1-R04 | Tenant khoá / user không hoạt động (theo cache, ≤ 5 s sau `config_changed`) → 401 trước khi chạm tài nguyên. Admin chết → dùng cache | HUB-FR-88, NFR-03 |
| H1-R05 | **Mọi tin qua Orchestrator** (chưa có command: tin bắt đầu bằng `/` coi là text thường tới H2). Orchestrator nhận: tin, tối đa `history_n` message của **flow**, `flows.agent_id` (gợi ý), danh sách agent đang bật ∧ entitlement chưa thu hồi ∧ grant (user hoặc group) — chỉ `key` + mô tả. Chính Orchestrator không nằm trong danh sách | HUB-FR-20, 77, 45, BR-03 |
| H1-R06 | Quyết định Orchestrator là JSON `{decision: delegate\|answer\|ask, …}` (zod). JSON hỏng → thử lại 1 lần kèm nhắc định dạng; vẫn hỏng → `run.failed UPSTREAM_ERROR`. `delegate` tới agent ngoài danh sách được phép → bỏ, ghi trace, tính vào `max_steps`, không chạy (kiểm lại quyền mỗi delegate) | HUB-FR-20, 77, BR-04 |
| H1-R07 | `max_steps` (mặc định 5) và `token_budget`: vượt → dừng; chưa có câu trả lời nào → `run.failed BUDGET_EXCEEDED`, đã có → `run.finished` kèm câu báo trong `content` | HUB-FR-21 |
| H1-R08 | Kết quả agent: `done{text}` + run chỉ 1 delegate → pass-through (stream thẳng `delta`, Orchestrator không viết lại); `partial{text,missing}` → quay lại Orchestrator, không có agent khác thì `answer` phần đã làm + nói rõ phần thiếu; `need_input{question,choices?}` → SSE `ask`, run `finished` (message assistant mang `ask`), `flows.agent_id` = agent hỏi; tin kế của flow nhận gợi ý "đang chờ agent X" | HUB-FR-27, 28, 29 |
| H1-R09 | Orchestrator `answer(text)`/`ask(question)`: Hub cắt text thành `delta` theo từ (≤ 40 ký tự/delta); `run.finished.content` = nối toàn bộ `delta` (bất biến contract) | C1 §3 |
| H1-R10 | `run.started` phát ngay sau xác thực + tạo run (trước khi gọi Orchestrator), `quota={state:"ok",pct:0}` tới H3. Mỗi lần gọi Orchestrator và mỗi delegate là một step; nhãn step là chuỗi tĩnh trung tính (không tên agent/provider), theo `locale` của user | C1-R04, HUB-NFR-01 |
| H1-R11 | Một flow chỉ có một run `running`; POST vào flow đang chạy → 409 `FLOW_BUSY` (unique partial index `runs(flow_id) WHERE status='running'`). Không `flow_id` → tạo flow mới; `flow_id` thuộc hội thoại khác/lạ → 404 | HUB-FR-45, C1-R01 |
| H1-R12 | **SSE**: Hub (instance sở hữu run) là người ghi duy nhất vào stream client `sse:<run_id>` với id tường minh `<seq>-0`, `seq` từ 1 (khớp "id liên tiếp từ 1" của contract chat). Stream Runtime→Hub `run:<run_id>` (id Redis tự sinh) chỉ Hub đọc rồi dịch sang `sse:<run_id>`. `Last-Event-ID: n` → `XREAD` từ `n-0` ở bất kỳ instance nào. TTL = `RUN_EVENTS_RETENTION_S` (contract chat) sau khi run kết thúc; quá hạn → 410 `EVENTS_EXPIRED`. Lệch chữ với HUB-FR-42 → §9 Q6 | HUB-FR-42, NFR-02, C1-R06 |
| H1-R13 | Instance sở hữu run ghi `runs.owner` + lease (gia hạn 10 s). Lease quá 30 s mà run còn `running` → instance khác (sweeper) đóng run: `run.failed INTERNAL_ERROR` vào `sse:<run_id>`, huỷ job con | HUB-NFR-02, 03 |
| H1-R14 | Huỷ: `POST /runs/:id/cancel` → ghi `jobs.cancel_requested_at` + `NOTIFY job_cancel` cho mọi job `queued/running` của run, phát `run.failed{code:CANCELLED}`; Runtime dừng ≤ 5 s. Idempotent: run đã kết thúc → 200 kèm status hiện tại, không phát sự kiện mới | HUB-FR-43, AC-H06 |
| H1-R15 | Cấu hình chốt lúc run bắt đầu (`runs.config_version`): NOTIFY giữa chừng không đổi agent/profile của run đang chạy | HUB-BR-06 |
| H1-R16 | Seed yaml là nguồn cấu hình duy nhất tới H4: idempotent (upsert theo `key`, không xoá thứ không có trong yaml), không chứa secret (`claude-sub` dùng đăng nhập CLI sẵn), mỗi lần seed tăng `hub_config_version` + `NOTIFY hub_config_changed`; validate bằng zod, một transaction, lỗi → không ghi dở | HUB-FR-60, 61, 62 |
| H1-R17 | Orchestrator = một agent (`orchestrator_settings.agent_id`), `agentic-cli` + `claude-sub`, không tool, không MCP; thiếu/không hợp lệ lúc khởi động → hub-api không lên (HUB-BR-08). Chậm (mỗi quyết định là một job CLI) — chấp nhận ở H1 | HUB-FR-62, CR-025 |
| H1-R18 | Hub chỉ tạo job cho profile **1 bước**. Provider hết slot (hoặc tenant đạt `max_concurrent_sub`) → job chờ tối đa `max_wait_s` (30 s) rồi `fallback` không còn bước → `run.failed ALL_PROVIDERS_EXHAUSTED` (CR-019). Provider `cooldown/logged_out/error` → như vậy, ngay lập tức | HUB-FR-86, WRK-FR-24 |
| H1-R19 | Một lần claim = một transaction: advisory lock theo `provider_key` → đếm `running` của provider và của tenant (`admin.tenants.max_concurrent_sub`, cache ≤ 5 s, `null` = không giới hạn) → chọn job `SKIP LOCKED` → `running`. Job cùng `(conversation_id, agent_id)` chạy tuần tự | WRK-FR-01, 20, 24, BR-05 |
| H1-R20 | Không retry `agent.cli`. Mất heartbeat > 60 s khi `running` → `orphaned` → `failed(reason=orphaned)` → Hub phát `run.failed INTERNAL_ERROR`. Runtime khởi động lại: kill process group còn sót của job `running` thuộc `worker_id` mình (theo `jobs.pgid`), đặt `orphaned` | WRK-FR-02, 23, BR-04, NFR-03 |
| H1-R21 | Sandbox: CLI chạy `start_new_session`, `env` tường minh (không kế thừa `os.environ`; không DB/Redis URL, khoá), `cwd=work/<job_id>/`. Hook `PreToolUse` của Agent SDK chặn mọi đường dẫn sau `realpath` nằm ngoài `work/<job_id>/` — gồm home user chạy CLI (`~/.claude`…), `/mnt/*`, `work/<job khác>/`. `allowed_tools` mặc định Read, Grep; không Bash. Chặn → tool result lỗi quyền, không lộ nội dung file | WRK-FR-11, 12, BR-02, 07, AC-W05/W11 |
| H1-R22 | Huỷ/timeout: SIGTERM cả process group, 3 s sau SIGKILL, xác nhận không còn pid trong group; job `cancelled`/`timed_out`; slot trả (rời `running`) | WRK-FR-04, 05, NFR-06 |
| H1-R23 | `cli_sessions(conversation_id, agent_id, provider_key)` → `session_id`. Có thì resume; resume lỗi (mất session) → dựng prompt từ `history_n` message gần nhất của flow, không báo lỗi user. Job của Orchestrator không dùng session | WRK-FR-14, HUB-FR-45 |
| H1-R24 | Rate limit nhận diện từ lỗi/output của Agent SDK (429, "usage limit", "rate limit"): có giờ reset thì `cooldown_until` = giờ đó, không thì +30 phút; ghi `provider_state`, job `failed(quota)`; run `ALL_PROVIDERS_EXHAUSTED` (R18) | WRK-FR-15 |
| H1-R25 | `usage_logs` cho mọi job (cả job Orchestrator): `billing='subscription'`, `cost_usd=0`, token vào/ra từ SDK (thiếu → 0, không bịa), `billable_usd=null`, `overage=false`, `feature_id=null` | WRK-FR-17, HUB-FR-83 |
| H1-R26 | Log có `run_id`, `tenant_id`, `user_id` (Hub) / `job_id`, `run_id`, `tenant_id` (Runtime); không log secret, nội dung file/tin nhắn | HUB-NFR-04, WRK-NFR-04 |

## 3. Contract (backend-lead)
Từng trường: `plan.md` §2.
- **Kênh chat:** chỉ import `@ai/contracts/chat` (E5–E15 `C1 plan §2.4`, SSE `§2.5`); thêm `GET /health`. Hub không `/auth/*` (Q2), không `/__mock/*`.
- **Hub↔Runtime** `@ai/contracts/hub`: `JobPayload` (`agent.cli`), `RunEvent` trên `run:<run_id>` (`job.started`, `job.progress`, `job.result`, `job.failed`; mỗi job đúng một kết thúc), `AgentResult`, `OrchestratorDecision`, `AgentTypeManifest`, `HUB_JOB_ERROR_CODES` ⊂ `CHAT_RUN_ERROR_CODES`. `bun run contracts:gen` sinh `apps/agent-runtime/contracts/hub.schema.json` + `src/agent_runtime/contracts/hub.py`; `contracts:check` so byte (ADR-0009).
- **NOTIFY:** `config_changed` (Admin, có sẵn) · `hub_config_changed {v, version}` (seed) · `job_enqueued {v, job_id, provider_key}`, `job_cancel {v, job_id, run_id}` (Hub).

## 4. Dữ liệu (backend-lead)
Cột/RLS/khoá: `plan.md` §3; bảng Runtime + SQL: `plan-db.md`.
- Bảng: cấu hình (`config_meta, providers, model_profiles, agents, orchestrator_settings, agent_entitlements, agent_grants, agent_workflows`) · hội thoại (`conversations, flows, messages, runs, run_steps`) · Runtime (`jobs, cli_sessions, provider_state, agent_types, usage_logs`). Không làm: `price_book, secrets, attachments, routing_tests*, audit_log`.
- **Tương thích Admin:** `packages/db/migrations-hub/` qua `runHubMigrations` (`db:migrate` gọi sau `runMigrations` không đổi) → test khoá Admin giữ `{main: 9, dev: 3}` và 3 bảng `hub.*`. Ba bảng stub nâng cấp idempotent, giữ tên/kiểu/CHECK/index/`GRANT SELECT … admin_rw`; `usage_logs` chỉ thêm cột nullable `job_id, cache_read_tokens, cache_write_tokens`, không RLS, không FK (HUB-H1-AC-08).
- Role: `hub_api` (login = `hub_rw` + `hub_ro`) · `agent_runtime` (role Runtime duy nhất; không `admin.*`, đọc giới hạn tenant qua `hub.tenant_sub_limit`). RLS (`app.scope` user/system + tenant + user) trên 5 bảng hội thoại (Q7).
- Seed: `apps/hub-api/seed/*.yaml` + `bun run hub:seed` (`plan.md` §3.6).

## 5. UI
Không có UI (Studio để H4). Cấu hình qua seed yaml (H1-R16).

## 6. Hiệu năng
| Chỉ tiêu | Ngưỡng | Đo bằng |
|---|---|---|
| HUB-NFR-01 `run.started` tới client | ≤ 500 ms sau POST (không chờ Orchestrator/CLI) | `test:perf` (không chặn Lệnh xong, như M3) |
| Overhead Hub (xác thực + quyền + tạo run, không tính job) | ≤ 200 ms p95 | `test:perf` |
| WRK-NFR-01 nhận job khi còn slot | ≤ 2 s sau `INSERT` (NOTIFY; poll dự phòng 1 s) | int Python, `fake-cli` |
| Huỷ | ≤ 5 s tới khi hết process (H1-R22) | AC-H06/W03/W10 (chặn Lệnh xong) |
| Claim job (10 000 `queued`) | ≤ 20 ms p95 | `test:perf` |

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| Admin (JWT, schema `admin`) | Thật cho dev + contract chat (`/auth/*`, Q2). Test hub-api tự ký JWT bằng cặp khoá test (`bun run keys:dev`), không cần admin-api |
| Postgres · Redis | Docker Compose của repo (Windows); Runtime trong WSL2 gọi `localhost` (mirrored, Q5) |
| Claude Code CLI + subscription | Thật chỉ cho smoke thủ công (`HUB_LIVE=1`): CLI cài + đăng nhập trong WSL2, `claude-agent-sdk` Python. Test/CI không dùng |
| **`fake-cli`** (provider giả, `agent-runtime/providers/`) | Thay CLI bằng script tất định, cùng interface provider; trả `AgentResult`/`OrchestratorDecision` theo chỉ thị trong prompt (`#fake:delegate=<key>`, `ask`, `partial`, `sleep=<s>`, `spawn-child`, `read=<path>` (qua đúng hook), `ratelimit`, `crash`); không chỉ thị → echo. **Từ chối đăng ký khi `APP_ENV` ∉ {development, test}**. Đường sandbox, hook, process group, slot đều là code thật |
| Dify · MCP · Studio · Codex/Gemini | Không có (H2+) |

Env mới (tên · dev): `HUB_PORT=4000` · `HUB_DATABASE_URL` (role `hub_api`) · `REDIS_URL` · `JWT_PUBLIC_KEY` (PEM Admin) · `HUB_INSTANCE_ID` · `HUB_JOB_MAX_WAIT_S=30` · `AGENT_RT_DATABASE_URL` (role `agent_runtime`) · `AGENT_RT_WORKER_ID` · `AGENT_RT_WORK_DIR=/home/<user>/work` (không `/mnt/c`) · `APP_ENV`. Runtime không mở cổng.

## 8. Tiêu chí nghiệm thu (qc)
Nguyên văn AC-H/AC-W ở BA (`ba-agent-hub` §11, `ba-worker` §10); bảng nêu phần thuộc H1.

| AC | Phạm vi H1 | Test |
|---|---|---|
| AC-H06 | Run `agentic-cli` (`fake-cli #fake:sleep`) huỷ → ≤ 5 s `cancelled`, process dừng, `run.failed CANCELLED` | acceptance + int |
| AC-H07, H08 | Đủ trên `GET /conversations/:id`, `/runs/:id`, `/runs/:id/events`, cancel, messages: user khác, tenant khác, cả `tenant_admin` → 404. `/runs/:id/trace` hoãn (H3) | contract + acceptance |
| AC-H09 | Nửa đầu: agent có entitlement, chưa grant → không vào danh sách Orchestrator, không delegate. Nửa "cấp ≤ 5 s" → H3 (chưa có `/agent-grants`); H1 kiểm bằng seed + `hub_config_changed` | acceptance |
| AC-H13 | Biến thể: tenant đạt `max_concurrent_sub`, chờ `max_wait_s` (test đặt nhỏ) → `ALL_PROVIDERS_EXHAUSTED` (chưa có bước API) | int |
| AC-H14, H15 | Đủ, với `fake-cli`; `flows.agent_id` cập nhật; `ask` không có `agent`; tin kế route về agent đã hỏi | acceptance |
| AC-W02 | Rate limit → `provider_state=cooldown` + `cooldown_until`, job `failed(quota)`, run `ALL_PROVIDERS_EXHAUSTED` (chưa dự phòng API) | Python int |
| AC-W03, W10 | Đủ: slot provider + tenant trả; không còn pid trong group, kể cả process con | Python int |
| AC-W04 | Đủ (resume cùng provider) + ca mất session → dựng lại từ message | Python int |
| AC-W05, W11 | Đủ: symlink, `..`, tuyệt đối, `/mnt/c`, `~/.claude/.credentials.json`; nội dung không vào output/log | Python unit + int |
| AC-W07, W08 | Đủ phần slot (W07 kết thúc bằng `ALL_PROVIDERS_EXHAUSTED reason=tenant_slots` thay vì dự phòng API) | Python int (song song thật) |
| AC-W09 | Phần token: `billing=subscription`, `cost_usd=0`, token đủ; `billable_usd=null` | Python int |
| CHAT-AC-31, 32, 33 | Qua HUB-H1-AC-01 | `tests/contract/chat` |

**AC kỹ thuật mới**

| AC | Given / When / Then | Test |
|---|---|---|
| HUB-H1-AC-01 | Given hub-api + agent-runtime(`fake-cli`) + admin-api + seed, When `HUB_URL`=hub-api, `AUTH_URL`=admin-api, `CHAT_CONTRACT_USERS` trỏ user seed, chạy `bun run test:contract:chat`, Then mọi ca "mọi Hub" xanh (ca `describe.if(isMock)` tự bỏ); không sửa mã test | contract |
| HUB-H1-AC-02 | Given `HUB_LIVE=1` + `claude-sub` đã đăng nhập, When gửi "Xin chào" (chat-web hoặc `curl`), Then SSE đủ `run.started`…`run.finished`, nội dung không rỗng, `usage_logs` ≥ 1 dòng, không `agent`/`provider` trên SSE | smoke thủ công |
| HUB-H1-AC-03 | Given 2 instance hub-api (cổng khác, chung DB/Redis), When POST ở A, ngắt sau `delta` thứ 3, `GET /runs/:id/events` + `Last-Event-ID: 3` ở B, Then nhận đúng id 4…n, không lặp/mất, đúng một sự kiện kết thúc; quá `RUN_EVENTS_RETENTION_S` → 410 | int |
| HUB-H1-AC-04 | Given job `running`, When `kill -9` agent-runtime, Then ≤ 90 s job `orphaned→failed`, `run.failed INTERNAL_ERROR`, flow không kẹt `FLOW_BUSY`; Runtime khởi động lại không để process CLI mồ côi | int (Python + TS) |
| HUB-H1-AC-05 | Given instance sở hữu run bị kill, When quá lease 30 s, Then instance khác đóng run (`INTERNAL_ERROR`) và huỷ job con | int |
| HUB-H1-AC-06 | Given contract Hub↔Runtime, When `bun run contracts:check`, Then JSON Schema + pydantic sinh lại không khác bản đã commit; `pyright` strict qua; payload mẫu hợp lệ đi qua cả hai chiều | CI |
| HUB-H1-AC-07 | Given 20 claimer song song (2 tenant, provider `max_concurrency`=2, một tenant `max_concurrent_sub`=1), When 50 job vào, Then mọi thời điểm `running` theo provider ≤ 2 và theo tenant ≤ 1; không job nào bị claim hai lần | Python int |
| HUB-H1-AC-08 | Given DB đã chạy stub dev và DB sạch, When `bun run db:migrate`, Then cả hai thành công, schema `hub` như nhau; test int của Admin (usage, tổng quan, access) xanh nguyên văn | int |
| HUB-H1-AC-09 | Given token chữ ký sai, `alg=none`, hết hạn, `aud` sai, `sub` không phải uuid, thiếu `tid`, tenant khoá, user khoá, When gọi bất kỳ endpoint (kể cả `/runs/:id/events`), Then 401 `AUTH_EXPIRED`, không chạm DB tài nguyên | unit + int |
| HUB-H1-AC-10 | Given `fake-cli` trả JSON hỏng 2 lần / delegate agent không được phép / delegate lặp vô hạn, Then `UPSTREAM_ERROR` / bỏ + trace / `BUDGET_EXCEEDED` đúng H1-R06, R07 | acceptance |
| HUB-H1-AC-11 | Given seed chạy 2 lần, Then không trùng dòng, `hub_config_version` tăng; yaml sai → không ghi gì; thiếu Orchestrator hợp lệ → hub-api không khởi động | int |
| HUB-H1-AC-12 | Given user A có tin ở hai flow, When Orchestrator chạy ở flow 1, Then prompt chỉ chứa message của flow 1 (C1-R02) | acceptance |

Lệnh xong mốc (chốt ở plan): `bun run typecheck && bun test && bun run test:int && bun run test:contract:chat` (HUB_URL=hub-api) · `bun run contracts:check` · Python (`cd apps/agent-runtime`): `uv run ruff check . && uv run pyright && uv run pytest && uv run pytest -m int` · `bun run check:size --all` · `bunx depcruise --all` · `bun run test:lock:verify` · `bun run trace --check`.

## 9. Quyết định
### Trước Gate (đã chốt với người dùng)
- Hub TS + Agent Runtime Python (CR-028/ADR-0007), WSL2 (CR-029), subscription chỉ dev/test và profile 1 bước được phép (CR-019), mọi tin qua Orchestrator (CR-025), Orchestrator là một agent (CR-020).
- **Q1 (người dùng 2026-10-04):** chưa có API key → Orchestrator và agent đều chạy `agentic-cli` qua `claude-sub` (CLI). Q2–Q10: chưa có ý kiến khác → dùng mặc định bên dưới.
- Phiên Hub không sửa Chat/Admin/test khoá C1. Cần dùng chung `access.rules.ts`, `jwt.ts`… của Admin → đề xuất chuyển sang `packages/*` (ghi TECH-DEBT), không sửa file Admin.

### Câu hỏi mở (mỗi câu có mặc định; PLAN dùng mặc định nếu không có trả lời)
| # | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| Q1 | Orchestrator chạy bằng gì khi dev chưa có API key? | `agentic-cli` qua `claude-sub` (H1-R17), chấp nhận chậm; test/CI dùng profile `fake-cli`. Profile API thêm ở H2 |
| Q2 | Test contract gọi `/auth/*` tại `AUTH_URL`; Hub thật không phát JWT | Chạy với `AUTH_URL`=admin-api thật (cùng khoá JWT). Nếu `/auth/*` của admin-api lệch contract chat → ghi "Tranh chấp test", việc của phiên Chat khi combine; Hub không sửa test khoá. User fixture (`lan, hoa, an, khoa`) tạo bằng script trong `tools/` gọi admin-api bằng `platform_admin` (không sửa seed Admin) |
| Q3 | Cổng dev | hub-api `4000` (`HUB_PORT`); agent-runtime không mở cổng |
| Q4 | Vị trí contract | Chat: `@ai/contracts/chat` (chỉ import). Hub↔Runtime: `@ai/contracts/hub` (mới) |
| Q5 | Runtime (WSL2) gọi Postgres/Redis Docker trên Windows | `networkingMode=mirrored`, `localhost`. Dự phòng: host IP trong env |
| Q6 | Id SSE so với id Redis Stream | **Đã giải** (CR-030 đã sửa HUB-FR-42, ADR-0007 #5); TTL `sse:` = `RUN_EVENTS_RETENTION_S` (600 s) |
| Q7 | Cách ly tenant ở DB | **Chốt** (`plan.md` §3.4): lọc ở repo + RLS 5 bảng hội thoại (`hub_rw`); bảng Runtime không RLS, câu Hub lọc `tenant_id`; `usage_logs` không RLS (Admin đọc toàn nền) |
| Q8 | Seed: user nào được grant, chạy ở môi trường nào | Grant theo `tenant_key + username` trong yaml (tra id lúc seed; thiếu user → bỏ qua + cảnh báo); seed chạy mọi môi trường (chưa có Studio), `fake-cli` chỉ nạp khi `APP_ENV` ∈ dev/test |
| Q9 | Thư viện mới | ADR-0008 (Python), ADR-0009 (TS + codegen), Proposed |
| Q10 | `max_wait_s` khi hết slot · sandbox gốc Claude Code hay chỉ hook | 30 s, test đặt qua env · H1 chỉ hook WRK-BR-07 + `allowed_tools` (không Bash) |

### Trong lúc làm (agent tự quyết theo Luật 2)
- 2026-10-04 · docs-architect · H1-R09, R10, R12, R13 và `fake-cli` thuộc agent-runtime: BA không nói; contract chat đòi id 1..n, nhiều instance cần chủ run, test cần CLI tất định.
- 2026-10-04 · backend-lead · `plan.md` §1: P1 migration Hub tách thư mục (test khoá Admin assert `{main: 9, dev: 3}`) · P4 JWT chép verify + test vector · P5 claim một advisory lock toàn cục (thay "theo provider" ở H1-R19: slot tenant đếm chung mọi provider) · P6 kết quả agent đệm rồi cắt `delta` · P7/P8 Hub cũng quét orphan và hết hạn `queued` quá `max_wait_s`.
- 2026-10-04 · backend-lead · `orphaned` = `failed` + `error_reason=orphaned`; thứ tự khoá `flows → runs → run_steps → messages → jobs` (`plan.md` §3.5); một URL DB/role (`HUB_DATABASE_URL`).

## 10. Tranh chấp test
- (không)
