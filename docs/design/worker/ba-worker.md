# Agent Runtime (Worker) — Business Requirements

Chạy mọi agent `llm`, `agentic-cli`, `python` và việc dài ngoài luồng request; là nơi chạy các CLI subscription (Claude Code, Codex, Gemini). Viết bằng **Python** ([ADR-0007](../../adr/0007-hub-ts-agent-runtime-python.md), CR-028)

`v0.4 · draft` · `2026-10-01` · `Mã yêu cầu: WRK-*`

## 1. Mục đích & phạm vi

**Vấn đề cần giải quyết.** Có hai loại việc không nên chạy trong request HTTP của Hub:

- **Việc chạy lâu**, như workflow Dify mất vài phút hoặc agent làm nhiều bước.
- **Việc gắn với một máy cụ thể**: CLI subscription đã đăng nhập sẵn trên đúng một máy và chỉ chạy được 1–2 job cùng lúc.

Agent Runtime (gọi tắt Worker, giữ mã `WRK-*`) lấy job từ hàng đợi Postgres, chạy, báo tiến độ, ghi kết quả. Nó cũng quản lý quota của các tài khoản subscription, và chia slot subscription công bằng giữa các tenant.

**Quan hệ với Hub (CR-028):** **không còn chung codebase**. Hub là TypeScript/Bun; Agent Runtime là Python (`apps/agent-runtime`), chạy thành process riêng trên máy đã đăng nhập CLI (WSL2 Ubuntu, CR-029). Không có API công khai và không có API config với Admin: nó chỉ nói chuyện với Hub qua **Postgres** (`hub.jobs`, `NOTIFY job_enqueued`/`job_cancel`), **Redis Streams** (`run:<run_id>`) và **MCP** của Hub. Contract (payload job, sự kiện run, kết quả agent) là pydantic sinh từ zod của Hub.

**Worker không làm:** không quyết định dùng agent nào (việc của Orchestrator), không tự đọc cấu hình agent, không kiểm tra quyền hay quota của user (Hub đã kiểm tra trước khi tạo job). Mọi thông tin cần để chạy đã nằm sẵn trong payload của job, kể cả `tenant_id`.

## 2. Loại job

| Type | Nguồn tạo | Việc | Retry tự động |
|---|---|---|---|
| `agent.run` | Agent runtime `llm` hoặc `python` (HUB-FR-24) | Chạy vòng lặp agent với system prompt, tool (MCP của Hub) và model qua bản Python của Model Gateway; hoặc chạy class agent Python nội bộ trong process con (WRK-FR-26) | Không retry tự động (như `agent.cli`); lỗi trước khi gọi tool thì dự phòng theo profile |
| `workflow.async` | Command `mode=async` hoặc agent `dify-workflow` chạy lâu | Gọi Dify workflow (dùng chế độ streaming hoặc poll), đẩy tiến độ về | Tối đa 2 lần, chỉ khi lỗi mạng hoặc 5xx |
| `agent.cli` | Agent runtime `agentic-cli` | Chạy Claude Code (Claude Agent SDK Python), Codex hoặc Gemini CLI với prompt, tool và MCP được cấp | Không retry. Hết quota thì dự phòng sang bước sau của profile |
| `maint.probe` | Lịch định kỳ (5 phút) | Kiểm tra từng CLI còn đăng nhập và còn quota không, rồi cập nhật `provider_state` | — |
| `maint.cleanup` | Lịch định kỳ (mỗi giờ) | Xoá thư mục làm việc quá hạn và job treo | — |

## 3. Vòng đời job

```
            ┌──────────── cancel ─────────────┐
            │                                 ▼
 queued ──▶ running ──▶ succeeded         cancelled
   ▲          │  │
   │          │  ├──▶ failed      (lỗi không retry được / hết số lần retry)
   │          │  ├──▶ timed_out   (vượt timeout_s)
   │  retry   │  └──▶ fallback ──▶ tạo job mới với bước kế tiếp của profile
   └──────────┘                    (job cũ = failed, reason=quota | tenant_slots)

 heartbeat mất > 60s khi đang running  ──▶  orphaned ──▶ workflow.async: requeue
                                                        agent.cli:      failed
```

## 4. Subscription Pool

Mỗi provider subscription (claude-sub, codex-sub, gemini-sub) tương ứng với **một tài khoản đã đăng nhập trên máy Worker**. Mỗi provider có `max_concurrency` slot (khai báo ở Agent Studio › Models › Providers, mặc định 1).

Pool **dùng chung cho mọi tenant**. Để một tenant không chiếm hết slot, mỗi tenant có thêm giới hạn `tenants.max_concurrent_sub`: số job subscription tenant đó được chạy cùng lúc, tính chung mọi provider subscription. `null` = không giới hạn (mặc định trong giai đoạn test). Giá trị này sửa ở Admin › Tenants.

| Trạng thái | Nghĩa | Chuyển sang khi |
|---|---|---|
| `ok` | Còn slot trống, nhận job được | — |
| `busy` | Mọi slot đang chạy. Job mới phải chờ trong hàng đợi của provider | Một job xong thì về `ok` |
| `cooldown` | Hết quota. Không nhận job đến `cooldown_until` | Nhận diện được thông báo hết quota hoặc rate limit từ CLI |
| `logged_out` | Phiên đăng nhập CLI đã hết hạn | Probe phát hiện ra. Cần người đăng nhập lại (runbook) |
| `error` | CLI lỗi lặp lại (không cài, crash…) | 3 lần lỗi liên tiếp |

> ℹ️ **Nguyên tắc dự phòng:** nếu provider ở trạng thái `cooldown`, `logged_out` hoặc `error`, hoặc đang `busy` quá `max_wait_s` (mặc định 30 giây), thì Worker **không chờ** mà chuyển job sang bước kế tiếp của profile. Bước kế tiếp có thể là CLI khác, hoặc chính Agent SDK chạy bằng API key. Tenant đã dùng hết `max_concurrent_sub` được xử lý như provider `busy` *với riêng tenant đó*: chờ tối đa `max_wait_s` rồi dự phòng (`reason=tenant_slots`). Profile **không bắt buộc** có bước API cuối (CR-019): hết bước thì job lỗi rõ `ALL_PROVIDERS_EXHAUSTED` (HUB-BR-04). Subscription chỉ cho dev/test; phục vụ tenant thật cần bước API.

> ⚠️ **Lưu ý:** cần xác nhận loại gói subscription đang dùng cho phép phục vụ nhiều khách hàng.

## 5. Yêu cầu chức năng

**MUST** bắt buộc cho v1 · **SHOULD** nên có trong v1 · **COULD** để sau

### 5.1 Hàng đợi & thực thi

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| WRK-FR-01 | Lấy job từ **Postgres**: `SELECT … FOR UPDATE SKIP LOCKED` trên `hub.jobs` theo loại, `priority`, `created_at`; `LISTEN job_enqueued` để được đánh thức (kèm poll dự phòng). Bỏ Redis queue (CR-028). Worker khai báo mình phục vụ những loại job và provider nào khi khởi động | **MUST** |
| WRK-FR-02 | Cập nhật `hub.jobs` khi chuyển trạng thái. Gửi heartbeat mỗi 15 giây khi đang chạy | **MUST** |
| WRK-FR-03 | Đẩy sự kiện `job.progress` và `delta` bằng `XADD` vào Redis Stream `run:<run_id>` (TTL ~24 giờ); Hub `XREAD`, đánh số lại và phát qua `sse:<run_id>` (HUB-FR-42, CR-030); Agent Runtime không đặt `id` SSE | **MUST** |
| WRK-FR-04 | Tôn trọng `timeout_s` của job. Quá hạn thì dừng tiến trình và đặt `timed_out` | **MUST** |
| WRK-FR-05 | Nghe tín hiệu huỷ (`LISTEN job_cancel`, kiểm `jobs.cancel_requested_at`; kiểm lại khi khởi động và mỗi heartbeat) và dừng tiến trình trong ≤ 5 giây (dừng nhẹ trước, ép dừng sau) | **MUST** |
| WRK-FR-06 | Retry theo chính sách của từng loại job (mục 2), với backoff 2 giây rồi 8 giây | **MUST** |
| WRK-FR-07 | Gọi Dify (`workflow.async`) với `user = <tenant>:<user_id>` để truy vết. Ghi token và chi phí từ metadata Dify nếu có, không có thì ghi thời gian chạy | **MUST** |

### 5.2 Agent CLI

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| WRK-FR-10 | Claude Code chạy qua **Claude Agent SDK (Python)**. Codex và Gemini chạy qua CLI ở chế độ không tương tác, đọc output dạng JSON stream | **MUST** |
| WRK-FR-11 | Mỗi job có một thư mục làm việc riêng `work/<job_id>/`. File đính kèm của run được copy vào đây. CLI bị giới hạn trong thư mục này | **MUST** |
| WRK-FR-12 | Áp đúng danh sách tool được phép trong payload. Mặc định không có Bash và không có quyền ghi ra ngoài thư mục làm việc | **MUST** |
| WRK-FR-13 | Kết nối MCP tools của Hub bằng token của job (gắn `tenant_id` và `user_id`, hết hạn khi job kết thúc). MCP tool chính là các workflow được gắn cho agent (`hub.agent_workflows`); tên tool là key của workflow. Chỉ những tool có trong payload | **MUST** |
| WRK-FR-14 | Giữ ngữ cảnh: có `session_id` cũ cùng provider thì resume, xong thì ghi `session_id` mới vào `hub.cli_sessions` | **MUST** |
| WRK-FR-15 | Nhận diện hết quota hoặc rate limit từ output/mã lỗi của từng CLI. Có thông tin thời điểm reset thì đặt cooldown đến lúc đó, không có thì mặc định 30 phút | **MUST** |
| WRK-FR-16 | Chuyển tiến trình của CLI (tool đang gọi, file đang đọc) thành `job.progress` có nhãn dễ hiểu | **SHOULD** |
| WRK-FR-17 | Ghi usage vào `hub.usage_logs` cho mọi job: `tenant_id`, `feature_id`, provider, model, token vào/ra, `billing`, `cost_usd`, `billable_usd`. Với subscription: `billing=subscription`, `cost_usd=0`, vẫn ghi đủ token để tính `billable_usd` theo `hub.price_book`. Chưa có đơn giá thì để `billable_usd` trống, tính sau | **MUST** |
| WRK-FR-18 | File agent tạo ra trong thư mục `out/` được đính kèm vào câu trả lời | **COULD** |

### 5.3 Pool & bảo trì

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| WRK-FR-20 | Giới hạn số job chạy đồng thời theo `max_concurrency` của từng provider: đếm các job `running` của provider đó trong **cùng transaction lấy job**, dưới advisory lock theo provider (CR-028) | **MUST** |
| WRK-FR-21 | Dự phòng: tạo job mới với bước kế tiếp của profile (có trong payload). Gửi `step.finished{status: fallback, reason}` để trace ghi lại | **MUST** |
| WRK-FR-22 | Probe định kỳ từng CLI (đã đăng nhập chưa, còn quota không) rồi ghi `hub.provider_state`. Agent Studio (Models và Vận hành) đọc trạng thái này để hiển thị | **SHOULD** |
| WRK-FR-23 | Dọn thư mục làm việc sau 24 giờ. Đánh dấu job `orphaned` khi mất heartbeat quá 60 giây | **MUST** |
| WRK-FR-24 | Giới hạn slot subscription theo tenant: đếm job subscription `running` của từng tenant trong cùng transaction lấy job (advisory lock theo provider; không còn bộ đếm Redis `sub_slots`), không cho vượt `tenants.max_concurrent_sub`. `null` = không giới hạn. Slot tự trả khi job rời trạng thái `running` (xong, lỗi, huỷ, orphaned). Đọc giới hạn từ `admin.tenants` (chỉ đọc, cache ≤ 5 giây) | **MUST** |
| WRK-FR-25 | **Manifest loại agent** (CR-028, HUB-FR-90): khi khởi động ghi/cập nhật `hub.agent_types` (key, runtime, mô tả, JSON Schema tham số cấu hình, version) cho mọi class agent đã đăng ký, gồm các runtime `llm`, `agentic-cli` và agent `python` nội bộ. Loại agent bị gỡ khỏi code thì đánh dấu không còn khả dụng, không xoá agent đang trỏ tới | **MUST** |
| WRK-FR-26 | **Agent `python` chạy trong process con** (CR-028): mỗi job một process con, môi trường không mang secret của hệ thống (như WRK-BR-02), chỉ nhận đúng thứ được cấp trong payload (prompt, tool MCP, thư mục `work/<job_id>/`, token MCP của job). Giao tiếp với Agent Runtime qua interface (stdin/stdout JSON theo contract pydantic); cùng huỷ theo process group, timeout, thư mục làm việc và hook đường dẫn như `agent.cli` | **MUST** |

## 6. Luật nghiệp vụ

| ID | Luật |
|---|---|
| WRK-BR-01 | Tài khoản subscription **dùng chung cho mọi tenant**, tính phí theo token (`billable_usd`). Payload mang `tenant_id` và `user_id` để truy vết và tính phí. Lưu ý: xác nhận loại gói đang dùng cho phép phục vụ nhiều khách hàng |
| WRK-BR-02 | Không truyền secret của hệ thống (DB, master key, API key khác) vào môi trường của tiến trình CLI. Chỉ truyền đúng thứ provider cần |
| WRK-BR-03 | Khi dự phòng sang provider khác thì **không thể** resume session cũ. Job mới nhận tóm tắt N message gần nhất thay cho session |
| WRK-BR-04 | Không retry `agent.cli` tự động, vì agent có thể đã làm dở việc có tác dụng phụ. Chỉ dự phòng khi lỗi xảy ra *trước khi* agent bắt đầu gọi tool |
| WRK-BR-05 | Job của cùng một conversation và cùng agent chạy tuần tự, để không ghi đè session |
| WRK-BR-07 | **Chặn đường dẫn (CR-029):** mọi tool đọc/ghi file của CLI đi qua hook kiểm tra đường dẫn: chuẩn hoá bằng `realpath` (theo symlink) rồi chỉ cho phép trong `work/<job_id>/`. Chặn tuyệt đối thư mục home của user `worker` (chứa phiên đăng nhập `~/.claude`, `~/.codex`, `~/.gemini`), `/mnt/*` (ổ Windows) và thư mục của job khác |
| WRK-BR-06 | Job chỉ chạm dữ liệu của đúng tenant trong payload: file đính kèm, session CLI và MCP token đều gắn `tenant_id`. Không resume session của tenant khác |

## 7. Dữ liệu & giao tiếp

```
HUB ──INSERT hub.jobs + NOTIFY job_enqueued──▶ AGENT RUNTIME (SKIP LOCKED lấy job)
HUB ◀──XREAD Redis Stream run:<run_id> (progress/delta, id = id SSE)── AGENT RUNTIME (XADD)
HUB ──jobs.cancel_requested_at + NOTIFY job_cancel──▶ AGENT RUNTIME
                       Postgres hub.*  ◀──── AGENT RUNTIME ghi jobs / cli_sessions / usage_logs (có tenant_id) / provider_state / agent_types
                       Postgres admin.tenants ──▶ AGENT RUNTIME đọc max_concurrent_sub (chỉ đọc)
                       Slot provider/tenant: đếm job `running` trong transaction lấy job (không có bộ đếm Redis)
WORKER(agent CLI) ──MCP (token job)──▶ HUB /mcp ──▶ Dify workflows (workflow gắn cho agent)
WORKER(workflow.async) ──user=<tenant>:<user_id>──▶ Dify
```

### Payload job `agent.cli` / `agent.run` (ví dụ)

```
{
  "job_id": "j_123", "run_id": "r_456",
  "tenant_id": "t_acme", "user_id": "u_1", "feature_id": null,
  "conversation_id": "c_9", "agent_key": "dev-helper",
  "runtime": "agentic-cli", "agent_type_key": null,   // agent.run: "llm" | "python" (+ agent_type_key)
  "profile_steps": [
    {"provider": "codex-sub"}, {"provider": "claude-sub"},
    {"provider": "anthropic-api", "model": "claude-opus-5"}
  ],
  "step_index": 0,
  "prompt": "...", "system_prompt": "...",
  "allowed_tools": ["Read", "Grep", "Edit"],
  "mcp": {"url": "https://hub/mcp", "token": "job-scoped", "tools": ["translate_text", "check_invoice"]},
  "attachments": ["att_1"], "resume_session": "sess_abc",
  "timeout_s": 600
}
```

`feature_id` có giá trị khi job đến từ command (feature chứa command đó). Job của agent chat để `null`. Payload là contract zod của Hub (JSON Schema → pydantic). `mcp.tools` là key của các workflow được gắn cho agent.

## 8. Vận hành (runbook)

| Tình huống | Xử lý |
|---|---|
| Cài máy Worker mới (CR-029) | Máy Windows: bật WSL2 + Ubuntu, bật `systemd=true` trong `/etc/wsl.conf`, mạng `networkingMode=mirrored` trong `.wslconfig` (WSL gọi `localhost` tới Postgres, Redis, Hub). Trong Ubuntu: tạo user `worker`, cài `uv` (Python) và các CLI, đăng nhập bằng tay từng cái (`claude`, `codex`, `gemini`) dưới user `worker`. Worker chạy bằng unit systemd của Ubuntu, thư mục làm việc trên ổ Linux (`/home/worker/work`, không dùng `/mnt/c`). Khai báo provider trong Agent Studio › Models › Providers. Chạy probe để xác nhận `ok` |
| Máy Windows khởi động lại | WSL không tự chạy khi chưa có ai đăng nhập: đặt Task Scheduler "At startup" chạy `wsl -d Ubuntu --exec /bin/true` và `vmIdleTimeout=-1` để WSL không tự tắt. Kiểm tra `systemctl status ai-worker` trong Ubuntu |
| Provider báo `logged_out` | SSH vào máy Worker và đăng nhập lại CLI tương ứng. Trong lúc chờ, job tự dự phòng sang API |
| Provider `cooldown` liên tục | Giảm `max_concurrency`, thêm tài khoản, hoặc đưa bước API lên trước trong profile |
| Một tenant chiếm gần hết slot subscription | Đặt `max_concurrent_sub` cho tenant đó ở Admin › Tenants. Xem slot theo tenant ở Agent Studio › Vận hành › Jobs & Worker (tab pool) |
| Job treo | Xem `hub.jobs` theo `heartbeat_at`. Job cleanup tự đánh dấu orphaned. Có thể huỷ tay từ trace |

## 9. Yêu cầu phi chức năng

| ID | Yêu cầu |
|---|---|
| WRK-NFR-01 | **Thời gian nhận job:** job bắt đầu chạy trong ≤ 2 giây sau khi vào queue (khi còn slot) |
| WRK-NFR-02 | **Cách ly:** job này không đọc được thư mục làm việc của job khác, kể cả cùng tenant. Khi mở cho nhiều người hơn thì nâng lên container riêng cho từng job |
| WRK-NFR-03 | **Phục hồi:** Worker khởi động lại thì không mất job `queued`. Job `running` được xử lý theo luật orphaned. Slot theo tenant và theo provider vốn đếm từ các job `running` trong DB nên không cần dựng lại |
| WRK-NFR-04 | **Quan sát:** log có `job_id`, `run_id` và `tenant_id`. Lưu stdout/stderr của CLI 7 ngày để debug |
| WRK-NFR-05 | **Quy mô v1:** 1 máy Worker, mỗi subscription 1–2 slot, 5 job `workflow.async` chạy đồng thời |
| WRK-NFR-06 | **Môi trường (CR-029):** máy Worker là Windows, Worker chạy trong **WSL2 Ubuntu** (code Worker chỉ nhắm Linux). Mỗi tiến trình CLI chạy trong process group riêng; huỷ = SIGTERM cả group, sau 3 giây SIGKILL, không còn process con nào sống. Dùng sandbox của Claude Code (Linux) khi provider hỗ trợ, cộng hook ở WRK-BR-07. File đăng nhập CLI chỉ nằm trong `/home/worker`, không nằm trên ổ Windows |

## 10. Tiêu chí nghiệm thu

> **AC-W01 · Dự phòng khi hết quota**
> Given `codex-sub` đang `cooldown`, When nhận job `agent.cli` có profile codex-sub → claude-sub, Then job chạy bằng claude-sub, và trace có một step `fallback(reason=quota)`.

> **AC-W02 · Nhận diện hết quota giữa chừng**
> Given claude-sub trả thông báo rate limit ngay khi bắt đầu, When Worker nhận diện được, Then provider chuyển sang `cooldown` kèm `cooldown_until`, và job được dự phòng sang bước API.

> **AC-W03 · Huỷ**
> Given job `agent.cli` đang chạy, When Hub gửi tín hiệu huỷ, Then trong ≤ 5 giây tiến trình không còn, job có trạng thái `cancelled`, và slot được trả lại (cả slot provider và slot tenant).

> **AC-W04 · Giữ session**
> Given lượt 1 của conversation c_9 với agent dev-helper chạy bằng claude-sub, When đến lượt 2 cùng provider, Then agent resume đúng session cũ (nhớ được ngữ cảnh lượt 1).

> **AC-W05 · Cách ly thư mục**
> When agent cố đọc `../` ra ngoài thư mục làm việc, Then bị từ chối, và step ghi lỗi quyền.

> **AC-W06 · Worker crash**
> Given job `workflow.async` đang chạy thì Worker bị kill, When đã quá 60 giây không có heartbeat, Then job được đưa lại vào queue và chạy xong ở lần sau.

> **AC-W07 · Chia slot theo tenant**
> Given claude-sub có 2 slot, tenant `acme` có `max_concurrent_sub = 1` và đang chạy 1 job trên claude-sub, When job subscription thứ hai của `acme` đến, Then job đó chờ tối đa `max_wait_s` rồi dự phòng sang bước API (`reason=tenant_slots`). Cùng lúc, job của tenant `beta-co` vẫn nhận slot còn trống của claude-sub.

> **AC-W08 · Không giới hạn khi null**
> Given tenant `beta-co` có `max_concurrent_sub = null`, When 2 job subscription của `beta-co` đến và claude-sub còn 2 slot, Then cả 2 job cùng chạy.

> **AC-W09 · Ghi usage để tính phí**
> Given job `agent.cli` của tenant `acme` chạy xong bằng claude-sub, When Worker ghi usage, Then `usage_logs` có `tenant_id = acme`, `billing = subscription`, `cost_usd = 0`, token vào/ra đầy đủ, và `billable_usd` = token × đơn giá trong `price_book` (hoặc trống nếu chưa có đơn giá).

> **AC-W10 · Huỷ dừng cả cây tiến trình**
> Given job `agent.cli` đang chạy và CLI đã sinh process con (ví dụ `rg`), When Hub gửi tín hiệu huỷ, Then trong ≤ 5 giây không còn process nào thuộc process group của job.

> **AC-W11 · Không đọc được phiên đăng nhập CLI**
> When agent cố đọc `~/.claude/.credentials.json`, `/home/worker/.codex/*` hoặc `/mnt/c/...`, Then hook từ chối, step ghi lỗi quyền, và nội dung file không xuất hiện trong output hay log.

## 11. Ngoài phạm vi & câu hỏi mở

### Ngoài phạm vi v1

- Container sandbox cho từng job (v1 chỉ cách ly bằng thư mục và danh sách tool).
- Nhiều máy Worker, mỗi máy giữ một nhóm tài khoản subscription khác nhau.
- Lập lịch chạy agent định kỳ theo yêu cầu của user.
- Slot riêng cho từng tenant theo từng provider (v1 chỉ một giới hạn chung cho mọi provider subscription).

### Câu hỏi mở

1. ~~Máy Worker chạy Windows hay Linux?~~ Đã chốt (CR-029, 2026-10-04): máy Windows, Worker chạy trong WSL2 Ubuntu (WRK-NFR-06, WRK-BR-07).
2. Có cho agent `agentic-cli` dùng Bash ở v1 không, hay chỉ Read/Grep/Edit trong thư mục làm việc?
3. ~~Thư viện queue cụ thể~~ Đã chốt (CR-028, ADR-0007): Postgres `SKIP LOCKED` + `NOTIFY`, không dùng thư viện queue.
4. Tenant chạm `max_concurrent_sub`: chờ `max_wait_s` rồi dự phòng (đang chọn), hay dự phòng sang API ngay?
5. Ai tính `billable_usd`: Worker tính lúc ghi usage (đang chọn), hay Hub tính lại theo lô? Cờ `overage` do Hub đánh dấu theo bộ đếm quota, Worker không kiểm quota. Cần chốt cùng BA Agent Hub.
6. Vì đã phục vụ tenant bên ngoài, có cần đưa container sandbox từng job lên sớm hơn v1 không?
