# AI System — Kiến trúc tổng thể

Ghi lại kết quả thảo luận thiết kế · v0.4 · cập nhật 2026-10-01 · trạng thái: **đang thảo luận, chưa code**

## Tài liệu BA từng service

- [**Admin**](admin/ba-admin.md): tenant, user và auth, group, feature và phân quyền, command, catalog workflow, secret, quota, audit (ADM-*)
- [**UI/UX Admin**](admin/ui-admin.md): đặc tả giao diện chi tiết (khung, thành phần, sitemap và các màn hình, luồng thao tác, trạng thái, microcopy)
- [**UI Agent Studio**](agent-hub/ui-agent-studio.md): UI của Agent Hub gồm agent, Orchestrator, tool (chọn workflow từ catalog), quyền agent, model, Playground
- [**UI Vận hành**](agent-hub/ui-operations.md): Runs và trace, Chi phí và usage theo tenant, Jobs và Worker (một mục trong Agent Studio)
- [**UI Chat & Extension**](chat-app/ui-chat-extension.md): UI người dùng cuối của Hub (đăng nhập, composer, menu "/", các bước, ngữ cảnh trang)
- [**Agent Hub**](agent-hub/ba-agent-hub.md): cấu hình agent (Agent Studio), kiểm tra quyền, command runner, Orchestrator, runtime, Model Gateway, hội thoại, SSE, MCP (HUB-*)
- [**Worker**](worker/ba-worker.md): job async, agent CLI, Subscription Pool (slot theo tenant), dự phòng, runbook (WRK-*)

## 1. Các quyết định đã chốt

- **2 service tự viết bằng TypeScript:** *Admin* (backend + DB) và *Agent Hub*, cộng **Agent Runtime (Worker)** viết bằng **Python**, process riêng, không chung codebase với Hub (CR-028, [ADR-0007](../adr/0007-hub-ts-agent-runtime-python.md)). Hub và Agent Runtime nói chuyện qua Postgres (`hub.jobs` + NOTIFY), Redis Streams (sự kiện run) và MCP của Hub.
- **Chat App, Extension, Mobile** đều chỉ là client (FE).
- **Không có Flow factory.** Workflow Dify được tạo và sửa bằng *Claude session* (qua mcp-dify).
- **Multi-tenant (v0.4):** tenant là **công ty / khách hàng bên ngoài**. Công ty vận hành hệ thống cũng là một tenant (`platform`), nơi có `platform_admin`. Dữ liệu cách ly theo `tenant_id` + `user_id`. Truy cập sai tenant trả 404.
- **Dùng chung toàn hệ thống:** command, workflow, secret, key Dify, API key. Chỉ `platform_admin` tạo và sửa. Hub gửi `user = <tenant>:<user_id>` cho Dify để truy vết. Workflow không được dùng knowledge base hay bộ nhớ chứa dữ liệu của tenant khác.
- **Chia quyền sở hữu cấu hình (v0.4):** *Admin* giữ tenant, user/auth, group, feature, command, **catalog workflow dùng chung**, secret của workflow, quota. *Agent Hub* giữ **cấu hình agent**: agent, Orchestrator, provider, model profile, secret provider, quyền agent. Workflow chỉ khai báo một nơi (ở Admin), nên rotate key một chỗ. Hub đọc workflow và secret từ schema `admin` (chỉ đọc).
- **Workflow là catalog dùng chung (v0.4).** Tạo sẵn được, chưa gắn đâu cũng được (nhãn "Chưa gắn"). Workflow không có quyền riêng. Có hai nơi dùng, độc lập nhau: **command** (user gõ `/lệnh`, quyền qua feature) và **agent** (dùng workflow làm tool khi chat, quyền qua agent grant). Agent không liên quan tới command: quyền command (feature) và quyền agent (grant) **độc lập**, workflow dùng làm tool của agent không cần quyền feature của command trỏ tới cùng workflow (HUB-BR-19, CR-034).
- **Agent chỉ chọn workflow**, không đặt tên hay viết mô tả lại. Hub dùng luôn tên, mô tả và mô tả tham số của workflow làm tool cho model. Vì vậy mô tả workflow (20–400 ký tự, nói rõ khi nào dùng) và mô tả từng tham số là **bắt buộc**.
- **Feature là gói command để cấp quyền.** Mỗi command thuộc ít nhất 1 feature (mặc định `core`). Quyền có 2 tầng: **entitlement** (`platform_admin` cho tenant được có feature) và **access** (`tenant_admin` cấp cho group/user trong phạm vi entitlement). Tắt feature thì mọi command trong đó biến khỏi menu trong ≤ 5 giây.
- **Quyền agent cũng 2 tầng:** `platform_admin` entitlement agent cho tenant (trong Agent Studio), `tenant_admin` cấp cho group/user ngay trên trang Groups của Admin UI (Admin UI gọi `hub/agent-grants`). Orchestrator chỉ thấy agent user được dùng.
- **Agent Hub có UI riêng: Agent Studio** (`/studio`). Studio chứa cả mục Vận hành (Runs, Chi phí, Jobs & Worker). Đăng nhập bằng cùng JWT do Admin phát, yêu cầu role `platform_admin`.
- **Mọi request từ client đều đi qua Agent Hub.** Client không gọi thẳng Dify, nên không có key nào nằm trong client.
- **Agent Hub có một Orchestrator mặc định toàn hệ thống** và `platform_admin` có thể đặt **Orchestrator riêng cho một tenant** (CR-032; chọn bản tenant → mặc định, chốt vào snapshot run). Nó chọn agent chuyên trách để chat hoặc làm việc. User cũng gọi thẳng một agent bằng `@agent` (bỏ qua Orchestrator, CR-033).
- **Hỗ trợ nhiều model** (không riêng Claude), qua cả *subscription* (CLI) lẫn *API*.
- **Agent có thể chạy bằng Claude Code** (Claude Agent SDK **Python**), Codex hoặc Gemini CLI (runtime `agentic-cli`), hoặc là agent nội bộ viết bằng Python (runtime `python`); tất cả chạy ở Agent Runtime. Runtime `llm` cũng chạy ở Agent Runtime; chỉ `dify-*` chạy trong Hub.
- **API là đường chính khi phục vụ tenant thật; subscription cho dev/test (CR-019).** Subscription CLI dùng chung cho mọi tenant, tính phí theo token. Mỗi tenant có giới hạn slot subscription để chia công bằng.
- **Quyền: 3 role.** `platform_admin` (toàn hệ thống), `tenant_admin` (trong tenant mình), `member` (dùng command/agent được cấp). Xem bảng ở phần 8.
- **Chi phí và quota theo tenant (MUST).** Mọi run ghi `tenant_id`, `feature_id` vào `usage_logs`. Quota mặc định không giới hạn (đang test). **Mặc định không chặn khi vượt:** cảnh báo ở 80% và 100%, phần vượt đánh dấu `overage` để tính phí; `platform_admin` có thể bật chặn cứng theo tenant (CR-034). Mỗi user tối đa `max_concurrent_runs` run đồng thời (mặc định 2).
- **Tool của agent chỉ đi qua Dify** (workflow hoặc agent app). Không có loại gọi HTTP trực tiếp.
- **Bảo vệ định tuyến:** có bộ câu kiểm thử. Mỗi lần lưu thay đổi ảnh hưởng tới Orchestrator, bộ câu tự chạy với toàn bộ agent, và hệ thống chặn lưu nếu số câu đúng giảm quá 1 câu so với baseline (mỗi câu chạy 3 lần lấy đa số; `platform_admin` được lưu đè kèm lý do, CR-034). Bộ câu gắn theo từng Orchestrator.
- **Chống ghi đè cấu hình:** dùng trường `version` (trả 409 khi xung đột). Nút Test chạy được trên bản nháp chưa lưu.
- **UI:** dùng shadcn/ui, song ngữ VI/EN. Có ba giao diện: Admin UI (tenant, user, group, feature, command, workflow, chi phí & quota), Agent Studio (agent, model, vận hành), và Chat App/Extension (người dùng cuối). Worker không có UI.
- **Auth bằng user/pass.** Đăng nhập bằng mã công ty (tenant key) + username + password. Admin phát JWT chứa `user_id`, `tenant_id`, `role` (không chứa danh sách quyền). Hub chỉ kiểm tra JWT và tự tính quyền.
- **Dùng chung một Postgres:** schema `admin` do Admin ghi, schema `hub` do Hub và Agent Runtime ghi (Drizzle quản migration; Python dùng SQL thuần cho `jobs`, `usage_logs`, `cli_sessions`, `provider_state`, `agent_types`). Hub đọc cấu hình trực tiếp từ schema `admin` (chỉ đọc), nên không cần API cấu hình nội bộ. Ngược lại, Admin đọc (chỉ đọc) `hub.agent_workflows`, `hub.agent_grants` và `hub.usage_logs` để hiện "đang được dùng bởi", agent đã cấp và màn Chi phí & quota.
- **Hub nhận thay đổi cấu hình qua Postgres NOTIFY** `config_changed`, cộng poll `config_version` mỗi 60 giây để phòng mất thông báo. Đổi quyền có hiệu lực trong ≤ 5 giây.
- **Client chỉ gọi Admin để đăng nhập.** Menu command lấy từ `GET hub/commands`, chỉ gồm lệnh user được dùng.

## 2. Sơ đồ tổng

```
┌──────────── ADMIN (backend + DB, schema admin) ────────────┐   ┌────────────────── AGENT HUB (schema hub) ──────────────────┐
│ Admin UI  (platform_admin · tenant_admin)                  │   │ Agent Studio UI  /studio  (platform_admin)                 │
│  Tenants · Users · Groups · Phân quyền · Features ·        │   │  Agents · Orchestrator · Tools(chọn workflow từ catalog)    │
│  Commands · Workflows(catalog chung) · Secrets ·           │   │  · Quyền agent · Models · Secrets · Playground             │
│  Chi phí & quota · Nhật ký · Import/Export                 │   │  · Vận hành · Nhật ký                                      │
│                                                            │   │                                                            │
│ Auth API  /auth/login · /auth/refresh                      │   │ Runtime                                                    │
│           → JWT{user_id, tenant_id, role}                  │   │  1. verify JWT → user_id, tenant_id, role; tính quyền      │
│ Config API (CRUD tenants/users/groups/features/            │   │  2. Router  /cmd → Command Runner (lệnh user được cấp)     │
│             commands/workflows/secrets/quotas)             │   │             chat → ORCHESTRATOR → agent user được dùng      │
│                                                            │   │  3. Runtime adapters: llm · dify-wf · dify-agent · cli     │
│ DB: tenants · users · groups · features · grants ·         │──▶│  4. Model Gateway: profile → sub → hết quota → API         │
│     commands · workflows · secrets · quotas · audit        │   │     ghi usage theo tenant (cost_usd, billable_usd)         │
│     (Hub chỉ ĐỌC: quyền, command, workflow + secret)       │   │ DB: agents · agent_workflows · agent_grants · providers    │
└───────────────┬────────────────────────────────────────────┘   │     · model_profiles · price_book · secrets                │
                │ login → JWT                                    │     · conversations · runs · jobs · usage · audit          │
                ▼                                                │                                                            │
┌───────────────────────────┐   mọi request kèm JWT              └──────┬───────────────┬─────────────────┬───────────────────┘
│ CHAT APP / Extension      │──────────────────────────────────────────▶│               │                 │
│ lưu JWT, tự refresh       │◀──── SSE kết quả ──────────────────────── │               ▼                 ▼
└───────────────────────────┘                                           ▼       Subscription CLI    Dify workflows
                                                                     API models   (WORKER)        (catalog: command + agent)

   CLAUDE SESSION (build-time) ── tạo/sửa workflow trên Dify ──▶ khai báo 1 lần ở catalog Admin (Workflows)
   → dùng cho command (quyền qua feature) và/hoặc agent (quyền qua agent grant)
```

## 3. Thành phần & trách nhiệm

| Thành phần | Loại | Sở hữu / làm | Không làm |
|---|---|---|---|
| **Admin** | Service (backend + DB + UI) | Tenant, user và đăng nhập (phát JWT), group, feature và phân quyền (entitlement, access), cấu hình *command*, catalog workflow dùng chung (cho command và agent), secret của workflow, quota. Màn Chi phí & quota theo tenant | Không chạy workflow, không cấu hình agent |
| **Agent Hub** | Service + UI (Agent Studio) | **Sở hữu cấu hình agent** (agent, Orchestrator, provider, profile, secret provider, quyền agent, bảng giá bán). Agent chọn workflow từ catalog Admin. Chạy mọi thứ: kiểm tra quyền, Router, Command Runner, Orchestrator, agent, Model Gateway. Lưu hội thoại, run, job, chi phí theo tenant | Không quản lý tenant, user, group. Không sửa command hay workflow |
| **Agent Runtime (Worker)** | Process Python riêng (`apps/agent-runtime`, WSL2) | Nạp và chạy mọi agent `llm`/`agentic-cli`/`python`, job async. Lấy job từ `hub.jobs` (Postgres `SKIP LOCKED`), đẩy sự kiện qua Redis Streams, chạy CLI subscription (claude, codex, gemini), giới hạn slot theo tenant, ghi manifest `hub.agent_types` | — |
| **Chat App / Extension / Mobile** | Client | Giao diện. Đăng nhập (có mã công ty), lấy menu command, gửi request lên Hub | Không gọi Dify hay model trực tiếp, không giữ key |
| **Dify** | External | Thực thi workflow | — |
| **Claude session** | Công cụ build-time | Tạo và sửa workflow trên Dify, thay cho Flow factory | — |
| Postgres, Redis | Hạ tầng | Postgres: DB và hàng đợi job (`hub.jobs`). Redis: Streams sự kiện run, bộ đếm quota theo tháng | — |

## 4. Admin — cấu hình + auth

Admin là service riêng, có backend và DB. Nó quản lý tenant, user, group, feature và khai báo **command nào trỏ tới workflow nào**. Workflow là catalog dùng chung cho cả command và agent (v0.4). Cấu hình agent, provider và model thuộc Agent Hub (v0.3).

### Các bảng chính

| Bảng | Nội dung |
|---|---|
| `tenants` | key (mã công ty), tên, active, `max_concurrent_sub` (slot subscription, null = không giới hạn), settings |
| `users` | tenant_id, username (duy nhất trong tenant), password_hash, role (`platform_admin` \| `tenant_admin` \| `member`), active |
| `groups`, `group_members` | Group thuộc tenant. User ở nhiều group, không lồng group ở v1. Là đơn vị để gán feature và agent |
| `workflows` | Catalog dùng chung: tên, mô tả (bắt buộc), Dify app, loại (workflow/chat/agent), input schema kèm mô tả từng tham số (bắt buộc), tham chiếu secret app-key. Có thể chưa gắn đâu |
| `commands` | `/aaa` → workflow X, alias, cách map input, cách hiển thị output, sync/async, timeout, bật/tắt |
| `features`, `feature_commands` | Gói command để cấp quyền. Trạng thái Bật / Tắt / Beta. Feature `core` luôn tồn tại, không xoá được |
| `feature_entitlements`, `feature_grants` | Tenant nào được có feature (entitlement). Feature cấp cho group/user nào trong tenant (access) |
| `tenant_quotas` | Quota theo tenant, có thể theo feature: số run, token, USD mỗi tháng, ngưỡng cảnh báo 80% |
| `secrets` | App-key Dify và API key, mã hoá. Không bao giờ trả về cho client |
| `audit_log` | Nhật ký thay đổi, kèm `tenant_id` |

### Hai đường đọc cấu hình

- **Client:** lấy danh sách command, nhãn, form qua `GET hub/commands`. Chỉ có lệnh user được dùng. **Không có secret.**
- **Hub:** không qua API. Hub đọc thẳng schema `admin` (chỉ đọc): tenant, group, feature, grant, quota, command, workflow và secret của workflow.

### Form cấu hình một command (phác thảo)

```
┌─ Command: /dich ─────────────────────────────────────┐
│ Tên        [dich      ]  Alias [translate, tr     ]  │
│ Mô tả      [Dịch đoạn văn                         ]  │
│ Workflow   [translate (từ catalog)          ▼]       │
│ Input map  source_text ← [$args.text    ▼]           │
│            target_lang ← [$args.lang    ▼] mặc định vi│
│ Output     [result] render [markdown ▼]              │
│ Chế độ     (•) sync  ( ) async    Timeout [60]s      │
│ Feature    [core                 ▼]   [x] Bật        │
│                        [ Test ]  [ Lưu ]             │
└──────────────────────────────────────────────────────┘
```

### Ví dụ cấu hình (dạng yaml, để export/import/seed)

```
commands:
  - name: dich
    aliases: [translate, tr]
    workflow: translate                 # tham chiếu catalog
    features: [core]                    # thuộc ít nhất 1 feature
    args:
      - { name: lang, default: vi }
      - { name: text, rest: true, fallback: $selection }
    inputs: { source_text: $args.text, target_lang: $args.lang }
    output: { field: result, render: markdown }
    mode: sync
```

## 5. Agent Hub

Agent Hub là nơi điều phối agent. Nó quyết định dùng workflow hay agent nào để xử lý từng yêu cầu. Hub chạy theo kiểu *modular monolith*: một service nhưng chia module rõ ràng.

| Module | Việc |
|---|---|
| **Agent Studio (config)** | UI và API cấu hình agent, Orchestrator, tool (chọn workflow từ catalog Admin), quyền agent, provider, model profile, secret provider, bảng giá bán. Chỉ `platform_admin`. Có audit riêng |
| **Auth guard** | Verify JWT bằng khoá chung với Admin, lấy ra `user_id`, `tenant_id` và `role` |
| **Config cache** | Nạp command, workflow và secret, tenant, group, feature, grant, quota từ schema `admin` (chỉ đọc), cùng cấu hình agent của chính Hub. Làm mới qua NOTIFY. Từ đó tính quyền của user |
| **Router** | Tin nhắn bắt đầu bằng `/` thì đi Command Runner; bắt đầu bằng `@<agent_key>` thì gọi thẳng agent, bỏ qua Orchestrator (CR-033); còn lại (kể cả tin thứ 2+ trong flow, CR-025) đi Orchestrator. Lệnh user không có quyền → `CMD_NOT_FOUND`, tag sai → `AGENT_NOT_FOUND` (không rơi xuống Orchestrator) |
| **Command / Workflow Runner** | Là cổng duy nhất gọi Dify: map input, gọi workflow. Job chạy lâu thì đẩy sang Agent Runtime |
| **Orchestrator agent** | Một bản mặc định + tuỳ chọn một bản riêng mỗi tenant (CR-032). Hiểu ý người dùng, chọn một hoặc nhiều agent trong số agent user được dùng, nối các bước, gộp kết quả. Không có agent nào thì tự trả lời. Là **một agent được chọn** (CR-020), mặc định runtime `llm`/model rẻ vì mọi tin đều qua nó (CR-025); nhận kết quả agent có cấu trúc `done|partial|need_input` (HUB-FR-27), agent hỏi lại thì route tin kế về đúng agent đó (HUB-FR-28), một delegate + `done` thì stream thẳng (HUB-FR-29); Hub giữ vòng lặp điều phối, CLI không tự gọi agent khác |
| **Runtime adapters** | `dify-workflow` · `dify-agent` chạy trong Hub. `llm` · `agentic-cli` · `python` do Agent Runtime chạy; Hub chỉ có `AgentRunner` (tạo job + đọc Redis Stream, HUB-FR-89) |
| **Model Gateway** | Một interface chung cho mọi hãng, dùng cho Orchestrator trong Hub (agent `llm` dùng bản Python ở Agent Runtime). Lo retry, dự phòng theo profile, ghi log token và chi phí theo tenant (`cost_usd`, `billable_usd`) |
| **Subscription Pool** (ở Agent Runtime) | Theo dõi quota và trạng thái bận của từng CLI, xếp hàng job, giới hạn slot mỗi tenant. Hết quota thì chuyển sang API |
| **MCP tools** | Mở các tool của Hub ra dưới dạng MCP server, để agent CLI / agent Python ở Agent Runtime cũng gọi được workflow |

## 6. Hai luồng chạy

### A. Command — đường tắt, không cần suy luận

```
User gõ "/aaa hello"
 → Chat App gửi lên Agent Hub (kèm JWT)
 → Router thấy "/aaa", kiểm tra quyền (feature), tra config: aaa → workflow X, map input
 → Workflow Runner gọi Dify X
 → trả kết quả về Chat App (SSE/WS)
```

### B. Chat tự do — điều phối

```
User gõ "kiểm tra hoá đơn này rồi tạo thẻ Trello"
 → Agent Hub → Orchestrator (mọi tin, kể cả tin thứ 2+ trong flow) đọc danh sách agent user được dùng (cấu hình trong Agent Studio) + gợi ý agent gần nhất của flow
 → chọn Agent HoáĐơn  → dùng workflow invoice (chọn từ catalog Admin)
 → chọn Agent Trello  → dùng workflow trello-create
 → Orchestrator gộp kết quả (agent trả done/partial/need_input; partial → agent khác hoặc nói rõ phần thiếu; need_input → hỏi lại user), trả về Chat App
```

> ℹ️ Command và agent dùng chung catalog workflow nhưng độc lập nhau. Command gọi workflow qua `/lệnh`, quyền theo feature. Agent chọn workflow làm tool, quyền theo agent grant. Nếu agent có chọn workflow `translate`, gõ `/dich` hay chat "dịch giúp tôi" đều chạy cùng một workflow.

## 7. Runtime & đa model

Agent và model được tách riêng. Agent chỉ trỏ tới một *model profile*. Profile quyết định dùng hãng nào, gọi qua subscription hay API, và dự phòng sang đâu khi lỗi.

```
  ORCHESTRATOR → chọn agent
     ▼
  ┌──────────────── RUNTIME ADAPTERS ─────────────────────────────────────┐
  │  llm-chat        dify-workflow      agentic-cli                       │
  │     │                 │            (claude-code / codex / gemini-cli) │
  └─────┼─────────────────┼──────────────────────┼────────────────────────┘
        ▼                 ▼                      ▼
  ┌────────────┐    ┌──────────┐     ┌──────────────────────────────┐
  │ MODEL      │    │  Dify    │     │ SUBSCRIPTION POOL (Agent RT)│
  │ GATEWAY    │    └──────────┘     │ máy đã đăng nhập CLI         │
  │ fallback,  │◀── dự phòng khi ────│ giới hạn job đồng thời       │
  │ log chi phí│    hết quota        │ và slot mỗi tenant           │
  └────────────┘                     └──────────────────────────────┘
   anthropic · openai · gemini · openrouter · ollama
```

|  | API (trả theo token) | Subscription (Claude Pro/Max, ChatGPT, Gemini…) |
|---|---|---|
| Cách gọi | Gọi HTTP qua Model Gateway (có thể dùng LiteLLM hoặc Vercel AI SDK) | Qua CLI chính chủ của hãng (`claude`, `codex`, `gemini`), đã đăng nhập sẵn trên máy Agent Runtime |
| Chạy song song | Tốt, chỉ bị giới hạn bởi rate limit | Kém: vướng quota theo cửa sổ thời gian, chỉ nên chạy 1–2 job cùng lúc |
| Vai trò hiện tại (CR-019) | Đường chính khi phục vụ tenant thật; dùng cho việc cần phản hồi nhanh | Cho dev/test và việc agentic nặng khi có gói phù hợp. Dùng chung cho mọi tenant |
| Tính phí tenant | Token vào/ra × đơn giá bán trong `hub.price_book` | Như API: token vào/ra × đơn giá bán. Chi phí thật `cost_usd` = 0 |

- Subscription CLI **dùng chung cho mọi tenant**. Giới hạn slot mỗi tenant bằng `tenants.max_concurrent_sub` (null = không giới hạn, mặc định lúc test). Profile **không bắt buộc** có bước API cuối: hết bước thì lỗi `ALL_PROVIDERS_EXHAUSTED` (CR-019); phục vụ tenant thật cần bước API.
- `billable_usd` (số thu của tenant) tính theo `price_book`, dùng chung cho API và subscription. Chưa có đơn giá thì vẫn ghi token, tính sau. Workflow Dify ghi token/chi phí từ metadata Dify nếu có, không có thì ghi số run và thời gian.

### Agent chạy bằng Claude Code

- Nên dùng **Claude Agent SDK Python** (`claude-agent-sdk`, CR-028) thay vì tự sinh process `claude -p`. SDK có cùng vòng lặp agent, tool có sẵn, MCP, hook và session. Tài liệu: `code.claude.com/docs/en/agent-sdk`.
- Chạy trên Agent Runtime theo kiểu async, stream tiến độ về Chat App.
- Giới hạn danh sách tool được phép, chạy trong thư mục hoặc container riêng cho từng job, không mount secret vào.
- Lưu ánh xạ `conversation_id → session_id` để lượt sau tiếp tục đúng session.

> ⚠️ **Lưu ý:** xác nhận loại gói subscription đang dùng cho phép phục vụ nhiều khách hàng.

## 8. Auth user/pass

| Việc | Cách làm |
|---|---|
| Tạo user | `platform_admin` tạo tenant. `platform_admin` hoặc `tenant_admin` tạo user trên Admin UI. Không có trang tự đăng ký |
| Lưu mật khẩu | Hash bằng argon2id, không lưu mật khẩu gốc. Mật khẩu ≥ 10 ký tự. Có cờ `must_change_password` |
| Đăng nhập | `POST /auth/login` với mã công ty (tenant key) + username + password. Trả về access token (JWT, 15 phút) và refresh token (30 ngày, xoay vòng). Sai 5 lần thì khoá tạm 15 phút |
| Hub kiểm tra | Verify chữ ký JWT bằng khoá chung. Không cần gọi sang Admin mỗi request. JWT chỉ chứa `user_id`, `tenant_id`, `role`. Quyền do Hub tự tính từ schema `admin` đang cache |
| Phân quyền | `platform_admin`: toàn hệ thống (workflow, command, feature, secret, tenant, entitlement, quota, Agent Studio, trace mọi tenant). `tenant_admin`: trong tenant mình (user, group, cấp feature và agent trong phạm vi entitlement, xem chi phí & quota, audit của tenant), không vào Agent Studio. `member`: dùng command/agent được cấp, đổi mật khẩu của mình |
| 2FA | TOTP cho `platform_admin` và `tenant_admin` (SHOULD). SSO ngoài phạm vi v1 |
| Khoá user | Đặt `active=false` và thu hồi refresh token. Access token hết hạn sau tối đa 15 phút |
| Khoá tenant | Khoá mọi user trong tenant và thu hồi refresh token |
| Extension | Có màn hình đăng nhập, lưu token trong `chrome.storage`, tự refresh |

## 9. Phân chia dữ liệu

- **Admin:** dữ liệu ít thay đổi, gồm tenant, user, group, feature, phân quyền, cấu hình, quota và secret.
- **Agent Hub:** dữ liệu thay đổi liên tục, gồm hội thoại, run, job, file đính kèm, session của CLI và log chi phí. Mọi bản ghi đều gắn `tenant_id` và `user_id` lấy từ JWT. Truy cập sai tenant trả 404.
- **Xem trace:** `platform_admin` xem mọi tenant. `tenant_admin` chỉ xem chi phí, không xem nội dung chat. Mỗi lần xem trace ghi audit `view_trace` kèm tenant.

> ✅ **Đã chốt:** dùng chung một Postgres. Schema `admin` do Admin ghi, Hub chỉ đọc (kể cả workflow và secret của workflow). Schema `hub` do Hub và Agent Runtime ghi. Secret được mã hoá bằng master key trong env, dùng chung giữa Admin và Hub. Hàng đợi job nằm ở Postgres (`hub.jobs`, `SKIP LOCKED`); Redis dùng cho Streams sự kiện run và bộ đếm quota theo tháng (đối soát với `usage_logs`).

## 10. Câu hỏi còn mở

1. ~~Dùng chung một DB hay hai DB riêng?~~ Đã chốt: dùng chung, tách schema.
2. ~~Hub cập nhật cấu hình bằng poll hay webhook?~~ Đã chốt: Postgres NOTIFY, cộng poll 60 giây dự phòng.
3. Dropdown chọn workflow trong catalog lấy dữ liệu từ đâu: dán tay app-key, hay Admin đăng nhập Dify Console API để tự list app và đọc input schema?
4. Orchestrator và các agent `llm` chạy trong Hub (khuyên dùng), hay dùng app agent trên Dify?
5. Stack cụ thể (ngôn ngữ, framework) chưa chốt. Các câu hỏi mở riêng của từng service nằm trong tài liệu BA của service đó.

## 11. Diễn tiến thảo luận (vì sao ra thiết kế này)

1. **Sơ đồ gốc:** Chat App → Agent Hub → Dify workflow, và Chat App gửi "commands" thẳng sang Dify.
2. **Đề xuất ban đầu:** Agent Hub + Worker + Flow factory (tuỳ chọn). Góp ý rằng client không nên gọi thẳng Dify vì sẽ lộ key. Đây là bài học từ auto-pilot, nơi 8 app-key Dify bị nhúng trong extension.
3. **Bỏ Flow factory** vì workflow sẽ được tạo bằng Claude session. Bỏ auth ở giai đoạn đó. Cấu hình command lúc này là file `commands.yaml` trong Hub.
4. **Cần admin page:** ban đầu hiểu nhầm admin page chỉ là giao diện của Hub. *Chốt lại:* Admin là service riêng, chứa cấu hình cho FE (command → workflow). Agent Hub là nơi điều phối agent.
5. **Chốt ba ý:** Admin giữ catalog workflow dùng chung. Mọi request đi qua Agent Hub, trong đó Orchestrator chọn agent. Admin có backend và DB.
6. **Agent dùng Claude Code:** được, coi là runtime `agentic-cli` và nên dùng Agent SDK.
7. **Đa model, cả subscription lẫn API:** thêm `providers`, `model_profiles`, Model Gateway và Subscription Pool.
8. **v0.3: cấu hình agent chuyển về Agent Hub.** Hub tự khai báo workflow/tool cho agent, không tham chiếu command của Admin, và có UI riêng là Agent Studio (gồm cả Vận hành). *(v0.4 đổi lại phần workflow, xem bước 10.)*
9. **Đối tượng người dùng:** ban đầu gồm cả nội bộ lẫn bên ngoài, nên cần Policy theo audience, quota và BYOK. *Sau đó đơn giản hoá:* chỉ dùng nội bộ, đăng nhập bằng user/pass qua Admin. *(v0.4 mở lại cho khách hàng bên ngoài, xem bước 10.)*
10. **v0.4: multi-tenant, feature, quota, workflow dùng chung.** Tenant là công ty / khách hàng bên ngoài, cách ly theo `tenant_id`. Role đổi thành `platform_admin`, `tenant_admin`, `member`. Đăng nhập thêm mã công ty. Thêm group, feature (gói command, 2 tầng entitlement và access) và quyền agent 2 tầng. Workflow thành catalog dùng chung ở Admin: command và agent cùng chọn từ đó. Bỏ `hub.tools`, thay bằng `hub.agent_workflows`. Bỏ cờ cho agent dùng command như tool. Subscription dùng chung cho mọi tenant, tính phí theo token (`price_book`, `billable_usd`), giới hạn slot mỗi tenant. Quota theo tenant chỉ cảnh báo, không chặn.
11. **CR-028 / ADR-0007: Hub TS + Agent Runtime Python.** Người dùng muốn agent nội bộ viết bằng Python. Chọn Hub giữ TypeScript (dùng lại luật quyền, secret, JWT, Drizzle của Admin), Worker thành Agent Runtime Python chạy mọi agent `llm`/`agentic-cli`/`python`. Hàng đợi chuyển sang Postgres (`SKIP LOCKED`, slot đếm trong DB), sự kiện run qua Redis Streams (để `Last-Event-ID` đúng khi nhiều instance Hub), contract zod → JSON Schema → pydantic, manifest `hub.agent_types` cho Studio. Đồng thời sửa chỗ "subscription là đường chính" lệch CR-019.

`Tham khảo` Dự án `D:\AI\evoluconsulting\auto-pilot`: copilot-hub/api tương đương Agent Hub, DWC tương đương Flow factory (đã bỏ), RQ worker tương đương Worker. Các luật nên giữ lại từ đó: một cổng duy nhất gọi Dify, một Brain interface duy nhất cho reasoning, dữ liệu cách ly theo `user_id` (nay thêm `tenant_id`).
