# Agent Hub — Business Requirements

Cổng runtime duy nhất: nhận yêu cầu từ client, chạy command, điều phối agent, gọi model và Dify

`v0.4 · draft` · `2026-10-01` · `Mã yêu cầu: HUB-*`

## 1. Mục đích & phạm vi

**Vấn đề cần giải quyết.** User muốn gọi AI theo hai cách:

- **Nhanh và chắc chắn** bằng lệnh `/dich`, `/tom`…
- **Tự nhiên** bằng câu nói kiểu "kiểm tra hoá đơn này rồi tạo thẻ Trello".

Cả hai cách đều cần: kiểm tra danh tính và quyền, giấu key, chọn đúng model hoặc workflow, lưu lịch sử, ghi chi phí theo tenant, và báo lỗi rõ ràng. Agent Hub là nơi duy nhất làm những việc này, để client chỉ cần lo giao diện.

**Agent Hub chịu trách nhiệm:**

- Verify JWT, cách ly dữ liệu theo tenant, tính quyền command và agent của user.
- Cung cấp menu command (chỉ những lệnh user được dùng).
- Parse và chạy command, điều phối agent qua Coordinator.
- Runtime `llm`, `dify-workflow`, `dify-agent` chạy ngay trong Hub. Runtime `agentic-cli` và các job dài được giao cho [Worker](../worker/ba-worker.md).
- Model Gateway (dự phòng theo profile), lưu hội thoại, stream kết quả.
- Ghi log chi phí theo tenant, kiểm tra quota (cảnh báo, không chặn), ghi trace.
- Mở workflow của agent ra dưới dạng MCP server.

> ℹ️ **v0.4:** Hệ thống phục vụ **nhiều tenant** (công ty khách hàng). Mọi dữ liệu runtime gắn `tenant_id`. **Workflow là catalog dùng chung** ở Admin (`admin.workflows`): command và agent cùng dùng catalog này. Agent chỉ *chọn* workflow, Hub dùng luôn tên và mô tả của workflow làm tool. Hub vẫn **sở hữu cấu hình agent**: agent, Coordinator, provider, model profile, secret provider, quyền agent. Cấu hình qua UI [Agent Studio](ui-agent-studio.md) (chỉ `platform_admin`).

**Agent Hub không làm:** không sửa command, workflow, feature, tenant hay user (việc của [Admin](../admin/ba-admin.md)), không chạy tiến trình CLI (việc của Worker).

## 2. Actor

| Actor | Tương tác với Hub |
|---|---|
| **Member** (qua Chat App, Extension, Mobile) | Lấy menu, chat, gõ command, xem lịch sử, huỷ tác vụ. Chỉ thấy command và agent được cấp |
| **Tenant admin** (`tenant_admin`) | Như member. Cấp agent cho group/user trong tenant mình (ở trang Groups của Admin, Admin UI gọi `/agent-grants` của Hub). Xem chi phí và quota của tenant, không xem nội dung chat |
| **Platform admin** (`platform_admin`) | Vào Agent Studio. Cấp agent cho tenant (entitlement). Xem trace mọi tenant |
| **Admin service** | Gửi `NOTIFY config_changed`, gọi `/internal/test-run`. Đọc `hub.agent_workflows` (chỉ đọc) để chặn xoá workflow đang dùng |
| **Worker** | Nhận job từ queue, đẩy sự kiện tiến độ về, ghi kết quả vào DB |
| **Dify** | Được Hub gọi để chạy workflow hoặc agent app |
| **Model providers** | Được Model Gateway gọi (API) |
| **Agent CLI** (trong Worker) | Gọi MCP của Hub để dùng workflow được gắn cho agent như tool |

## 3. Thuật ngữ

| Thuật ngữ | Định nghĩa |
|---|---|
| Tenant | Một công ty khách hàng. Công ty vận hành hệ thống cũng là một tenant (`platform`) |
| Conversation | Một phiên chat của một user, gồm nhiều message |
| Run | Một lần xử lý cho một message của user. Có hai loại: `command` hoặc `orchestrated` |
| Step | Một bước trong run: gọi agent, gọi workflow, gọi model, hoặc gọi tool. Mọi step đều được ghi trace |
| Job | Phần việc được đẩy sang Worker (async). Một run có thể có nhiều job |
| Coordinator | Agent đặc biệt: đọc yêu cầu, chọn agent chuyên trách, nối các bước, tổng hợp câu trả lời |
| Context | Dữ liệu client gửi kèm: đoạn bôi đen, URL/nội dung trang, file đính kèm |
| Workflow | Một app Dify trong catalog dùng chung của Admin (`admin.workflows`). Command gọi nó, agent dùng nó làm tool |
| Tool | Workflow được gắn cho agent (`hub.agent_workflows`), trình cho model dưới dạng function |
| Feature | Gói command để cấp quyền (quản lý ở Admin) |
| Entitlement | `platform_admin` cho một tenant được có feature hoặc agent |
| Grant | `tenant_admin` cấp feature hoặc agent cho group/user trong tenant, trong phạm vi entitlement |
| Quota | Hạn mức theo tháng của tenant (run, token, USD). Chỉ cảnh báo, không chặn |

## 4. User stories

| ID | Là… | Tôi muốn… | Để… |
|---|---|---|---|
| US-H01 | Member | gõ `/` và thấy danh sách command được cấp, có mô tả và gợi ý tham số | biết mình làm được gì mà không cần hỏi ai |
| US-H02 | Member | bôi đen đoạn văn trên web rồi gõ `/dich en` | dịch ngay mà không phải copy-paste |
| US-H03 | Member | nhắn yêu cầu bằng lời tự nhiên | hệ thống tự chọn cách làm phù hợp |
| US-H04 | Member | thấy câu trả lời hiện dần và biết hệ thống đang ở bước nào ("đang kiểm tra hoá đơn…") | không phải chờ trong mù mờ |
| US-H05 | Member | huỷ một tác vụ đang chạy lâu | không tốn thời gian và chi phí vô ích |
| US-H06 | Member | mở lại lịch sử chat trên máy khác | tiếp tục công việc |
| US-H07 | Member | đính kèm file (PDF, ảnh, XML) vào tin nhắn | agent xử lý được tài liệu thật |
| US-H08 | Member | nhận thông báo lỗi dễ hiểu khi có sự cố (workflow lỗi, provider quá tải…) | biết nên thử lại hay báo admin |
| US-H09 | Platform admin | xem trace của một run (agent nào, tool nào, model nào, mất bao lâu, tốn bao nhiêu) ở mọi tenant | debug và tối ưu chi phí |
| US-H10 | Platform admin | xem báo cáo chi phí theo tenant, feature, agent và provider, có cả chi phí thật và số thu | kiểm soát ngân sách và tính phí |
| US-H11 | Platform admin | cấp một agent cho một tenant | tenant đó dùng được agent |
| US-H12 | Tenant admin | cấp agent cho một group trong tenant | chỉ đúng nhóm người dùng được agent |
| US-H13 | Tenant admin | được cảnh báo khi tenant dùng tới 80% và 100% quota | chủ động kiểm soát chi phí mà công việc không bị gián đoạn |

## 5. Luồng xử lý

```
Client ──POST /conversations/:id/messages (JWT, text, context, attachments)──▶ HUB
  │
  ├─ 1. Auth guard: verify JWT → user_id, tenant_id, role
  │     tính quyền từ cache schema admin (feature, group) + hub (agent)
  ├─ 2. Lưu message(user) · tạo run (gắn tenant_id)
  │     kiểm tra quota tenant: KHÔNG chặn · ≥ 80% / 100% → cảnh báo, đánh dấu overage
  ├─ 3. Router
  │     ├─ bắt đầu "/" + khớp command user được dùng ─▶ COMMAND RUNNER
  │     │      parse args → áp input_map (args/selection/page/attachment)
  │     │      ├─ mode=sync  → gọi Dify workflow → stream kết quả
  │     │      └─ mode=async → tạo job → Worker → stream tiến độ
  │     ├─ bắt đầu "/" + KHÔNG khớp (hoặc không có quyền) ──▶ CMD_NOT_FOUND + gợi ý
  │     └─ còn lại ──────────────────▶ COORDINATOR
  │            đọc: agent đang bật mà user được dùng (key, mô tả), lịch sử gần, context
  │            không có agent nào → tự trả lời, không gọi tool
  │            lặp ≤ max_steps:
  │              chọn agent → chạy theo runtime:
  │                llm / dify-workflow / dify-agent  → chạy trong Hub
  │                agentic-cli                       → job → Worker
  │              tool = workflow gắn cho agent (catalog admin.workflows)
  │              nhận kết quả → quyết định bước tiếp / kết thúc
  │            tổng hợp câu trả lời cuối
  ├─ 4. Mọi lời gọi model đi qua MODEL GATEWAY (profile → dự phòng; slot subscription theo tenant)
  ├─ 5. Ghi step, usage (tenant, feature, billing, cost_usd, billable_usd, overage), message(assistant)
  └─ 6. SSE: run.started (kèm quota) → step.* → delta → run.finished | run.failed
```

## 6. Yêu cầu chức năng

**MUST** bắt buộc cho v1 · **SHOULD** nên có trong v1 · **COULD** để sau

### 6.1 Auth & cấu hình

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| HUB-FR-01 | Mọi endpoint công khai đều yêu cầu access token hợp lệ. Verify cục bộ (chữ ký và hạn), không gọi sang Admin. Token chứa `user_id`, `tenant_id`, `role` (xem HUB-FR-74) | **MUST** |
| HUB-FR-02 | Nạp từ schema `admin` (chỉ đọc): command, workflow, secret của workflow, tenant, group, thành viên group, feature, entitlement và grant của feature, quota. Nạp cấu hình agent và quyền agent từ schema `hub`. Nạp lúc khởi động và giữ trong bộ nhớ | **MUST** |
| HUB-FR-03 | LISTEN `config_changed` (từ Admin) và `hub_config_changed` (từ Studio, cho các instance khác) thì nạp lại cấu hình. Ngoài ra poll `config_version` mỗi 60 giây để phòng mất thông báo. Thay đổi quyền có hiệu lực trong ≤ 5 giây | **MUST** |
| HUB-FR-04 | Giải mã secret chỉ tại thời điểm gọi ra ngoài. Secret của workflow (app-key Dify) nằm ở Admin, dùng master key chung với Admin. Secret của provider nằm ở Hub, dùng key riêng `HUB_SECRETS_KEY`. Không log và không trả secret ra client | **MUST** |

### 6.2 Command

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| HUB-FR-10 | `GET /commands` trả danh sách command **user được dùng** (tên, alias, mô tả, tham số, gợi ý). Lọc theo HUB-FR-76. Không có thông tin workflow hay key | **MUST** |
| HUB-FR-11 | Parse cú pháp `/tên arg1 arg2 phần-còn-lại…`. Hỗ trợ chuỗi trong ngoặc kép. Tham số `rest` nuốt phần còn lại. Tham số thiếu thì dùng `default` hoặc `fallback` (ví dụ `$selection`) | **MUST** |
| HUB-FR-12 | Áp input map rồi validate theo input schema của workflow. Thiếu input bắt buộc thì trả lỗi và chỉ ra tham số còn thiếu | **MUST** |
| HUB-FR-13 | `mode=sync`: gọi Dify, stream kết quả, có timeout. `mode=async`: tạo job, trả ngay `job_id`, rồi stream tiến độ | **MUST** |
| HUB-FR-14 | Command không tồn tại hoặc user không có quyền: trả `CMD_NOT_FOUND` kèm tối đa 3 gợi ý gần giống (so theo khoảng cách chuỗi, chỉ gợi ý trong các lệnh user được dùng) | **SHOULD** |

### 6.3 Coordinator & agent

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| HUB-FR-20 | Coordinator nhận: yêu cầu, N message gần nhất, context, và danh sách agent đang bật **mà user được dùng** (chỉ key và mô tả, xem HUB-FR-77). Mỗi lượt nó trả ra một trong ba quyết định: `delegate(agent, task)`, `answer(text)`, hoặc `ask(question)` | **MUST** |
| HUB-FR-21 | Vòng điều phối giới hạn `max_steps` (mặc định 5) và ngân sách token của run. Vượt giới hạn thì dừng và trả kết quả đang có, kèm thông báo | **MUST** |
| HUB-FR-22 | Runtime `llm`: chạy trong Hub với system prompt của agent. Tool là các workflow gắn cho agent (`hub.agent_workflows`), trình cho model bằng tên, mô tả và mô tả tham số của chính workflow. Gọi model qua Gateway | **MUST** |
| HUB-FR-23 | Runtime `dify-workflow` và `dify-agent`: agent bọc đúng một workflow trong catalog (loại app tương ứng). Map task thành input rồi gọi Dify | **MUST** |
| HUB-FR-24 | Runtime `agentic-cli`: tạo job loại `agent.cli` cho Worker, kèm prompt, workflow được gắn, token MCP có phạm vi riêng cho job, `tenant_id`, và session trước đó (nếu có) | **MUST** |
| HUB-FR-25 | Không agent nào khớp, hoặc user không được dùng agent nào, thì Coordinator tự trả lời bằng model của nó (chat chung, không gọi tool). Yêu cầu mơ hồ thì hỏi lại user | **MUST** |
| HUB-FR-26 | Chạy song song các delegate độc lập trong cùng một lượt | **COULD** |

### 6.4 Model Gateway

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| HUB-FR-30 | Dùng một interface chung `complete(profile, messages, tools, stream)` cho mọi hãng API (anthropic, openai, gemini, openrouter, ollama) | **MUST** |
| HUB-FR-31 | Thử các bước của profile theo thứ tự. Chuyển sang bước sau khi gặp điều kiện đã khai báo (`error`, `quota`, `timeout`). Ghi lại bước nào đã phục vụ request | **MUST** |
| HUB-FR-32 | Bước là provider subscription thì không gọi trực tiếp mà chuyển thành job cho Worker. Chỉ áp dụng cho runtime `agentic-cli`, vì chat thường nên đi API cho nhanh. Subscription dùng chung cho mọi tenant, giới hạn slot theo tenant (HUB-FR-86) | **MUST** |
| HUB-FR-33 | Ghi usage cho mọi lời gọi: tenant, user, feature, provider, model, token vào/ra, loại tính phí, chi phí thật, số thu, thời gian, run/step (chi tiết ở HUB-FR-83) | **MUST** |

### 6.5 Hội thoại, stream, job

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| HUB-FR-40 | CRUD conversation của chính user (trong tenant của user): tạo, liệt kê, đổi tên, xoá, xem message | **MUST** |
| HUB-FR-41 | Gửi message thì trả về SSE stream các sự kiện chuẩn (mục 9.2) | **MUST** |
| HUB-FR-42 | Client mất kết nối rồi nối lại thì được xem tiếp sự kiện từ `Last-Event-ID`. Run không dừng khi client rớt mạng | **SHOULD** |
| HUB-FR-43 | `POST /runs/:id/cancel` huỷ run và các job con. Worker phải dừng trong ≤ 5 giây | **MUST** |
| HUB-FR-44 | Upload file đính kèm (≤ 20MB/file). Lưu cục bộ hoặc object storage, gắn `tenant_id`, gắn vào message, và chuyển cho Dify hoặc agent khi cần | **SHOULD** |

### 6.6 MCP, test, báo cáo

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| HUB-FR-50 | Endpoint MCP chỉ lộ **các workflow được gắn cho agent** của job (`hub.agent_workflows`), dưới dạng tool có tên, mô tả và mô tả tham số lấy từ workflow. Xác thực bằng token có phạm vi riêng cho từng job (gắn agent, user, tenant) | **MUST** |
| HUB-FR-51 | `POST /internal/test-run` (chỉ Admin gọi được bằng service token): chạy thử *command* (bản nháp gửi trong body), trả kết quả và trace. Việc test agent làm ngay trong Studio | **MUST** |
| HUB-FR-52 | API trace của run: `platform_admin` xem mọi tenant, chủ của run xem run của mình. `tenant_admin` không xem nội dung (HUB-FR-87) | **SHOULD** |
| HUB-FR-53 | Báo cáo usage tổng hợp theo ngày × tenant/feature/user/agent/provider. `platform_admin` thấy mọi tenant, cả `cost_usd` và `billable_usd`. `tenant_admin` chỉ thấy tenant mình | **SHOULD** |

### 6.7 Cấu hình agent — Agent Studio

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| HUB-FR-60 | CRUD agent: key, tên hiển thị (vi/en), mô tả cho Coordinator, runtime, model profile, system prompt, workflow được gắn (`hub.agent_workflows`), timeout, ngân sách token, bật/tắt | **MUST** |
| HUB-FR-61 | Runtime `agentic-cli` có thêm: CLI (claude/codex/gemini), tool có sẵn được phép (Read/Grep/Edit/Bash…), có dùng MCP tools không, chế độ thư mục làm việc | **MUST** |
| HUB-FR-62 | Cấu hình **Coordinator** (duy nhất): model profile, system prompt, `max_steps`, ngân sách token mỗi run, số message lịch sử đưa vào, hành vi khi không có agent nào khớp (tự trả lời / hỏi lại) | **MUST** |
| HUB-FR-63 | **Dry-run định tuyến**: nhập một câu hỏi, xem Coordinator sẽ chọn agent nào và vì sao, mà không thật sự chạy agent | **MUST** |
| HUB-FR-64 | **Gắn workflow cho agent**: chọn từ catalog `admin.workflows` (chỉ đọc, chỉ workflow đang bật), lưu vào `hub.agent_workflows`. Agent không đặt tên và không viết lại mô tả. Tên tool sinh từ key workflow, mô tả và mô tả tham số lấy từ workflow. Muốn sửa mô tả thì sửa workflow ở Admin | **MUST** |
| HUB-FR-65 | Chạy thử workflow đã chọn với input mẫu. Xem trước tool dưới dạng model nhìn thấy (tên, mô tả, JSON schema), lấy từ workflow | **MUST** |
| HUB-FR-66 | CRUD provider: key, loại (`api` \| `subscription-cli`), hãng, base URL, secret, `max_concurrency`. Hiện trạng thái sống (ok/busy/cooldown/logged_out/error) | **MUST** |
| HUB-FR-67 | CRUD model profile: các bước theo thứ tự (provider + model), điều kiện chuyển (`error`, `quota`, `timeout`) | **MUST** |
| HUB-FR-68 | Secret của Hub (API key của provider): chỉ ghi, không đọc lại, mã hoá AES-256-GCM bằng `HUB_SECRETS_KEY`. App-key của workflow là secret của Admin | **MUST** |
| HUB-FR-69 | Audit log riêng cho mọi thay đổi cấu hình của Hub (ai, lúc nào, tenant, trước/sau) và khôi phục bản trước. Mỗi lần lưu thì tăng `hub_config_version` và NOTIFY `hub_config_changed` | **MUST** |
| HUB-FR-70 | **Playground**: chat thử với toàn bộ luồng điều phối (hoặc chỉ một agent), xem trace trực tiếp. Có thể đổi profile tạm thời cho lượt thử. "Chạy như user" thì áp đúng quyền command và agent của user đó | **MUST** |
| HUB-FR-71 | Export và import yaml cho agent (kèm key các workflow được gắn), Coordinator, provider, profile (secret chỉ export tên), có bước xem diff trước khi áp dụng | **SHOULD** |
| HUB-FR-72 | Studio UI và `/studio/api/*` yêu cầu JWT có role `platform_admin`. `tenant_admin` và `member` không vào được Studio. Hub phục vụ Studio UI ở `/studio` (cùng origin) | **MUST** |
| HUB-FR-73 | **Bộ câu kiểm thử định tuyến**: CRUD các câu (nội dung, có file hay không, agent mong đợi theo thứ tự). Khi lưu một thay đổi *ảnh hưởng tới định tuyến* (cấu hình Coordinator; tạo/xoá/bật/tắt agent; sửa mô tả agent), hệ thống tự chạy dry-run toàn bộ bộ câu trên bản nháp, **với toàn bộ agent** (không lọc theo quyền). **Tỉ lệ đúng thấp hơn baseline thì chặn lưu** và liệt kê các câu bị sai. Baseline là tỉ lệ đúng của lần lưu thành công gần nhất | **MUST** |

> ℹ️ **Workflow dùng chung (v0.4):** Admin sở hữu workflow và app-key, Hub chỉ đọc. Một app Dify chỉ khai báo một lần, nên rotate key ở một chỗ. Nguyên tắc "Admin và Hub không tham chiếu chéo" **bỏ cho workflow**: Admin đọc `hub.agent_workflows` (chỉ đọc) để chặn xoá hay tắt workflow đang được agent dùng. Cấu hình agent (agent, Coordinator, provider, profile, secret provider, quyền agent) vẫn thuộc Hub.

### 6.8 Tenant, quyền, quota, chi phí (v0.4)

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| HUB-FR-74 | JWT chứa `user_id`, `tenant_id`, `role` (`platform_admin` \| `tenant_admin` \| `member`). Token không chứa danh sách quyền. Hub tự tính quyền từ cache (HUB-FR-02) | **MUST** |
| HUB-FR-75 | **Cách ly theo tenant:** `conversations`, `runs`, `jobs`, `attachments`, `usage_logs` đều có `tenant_id` lấy từ JWT. Mọi truy vấn lọc theo `tenant_id` và `user_id`. Truy cập tài nguyên của tenant khác trả 404 | **MUST** |
| HUB-FR-76 | **Quyền command:** user dùng được `/cmd` ⇔ cmd thuộc feature F ∧ F bật (hoặc Beta và user thuộc group `beta-testers`) ∧ F có entitlement cho tenant của user ∧ F được cấp cho user hoặc group của user. Áp cho `GET /commands` và kiểm tra lại khi chạy. Không có quyền thì trả `CMD_NOT_FOUND` | **MUST** |
| HUB-FR-77 | **Quyền agent:** user dùng được agent A ⇔ A bật ∧ A có entitlement cho tenant của user (`hub.agent_entitlements`, chưa thu hồi) ∧ A được cấp cho user hoặc group của user (`hub.agent_grants`). Coordinator chỉ nhận danh sách agent user được dùng. Hub kiểm tra lại khi delegate và khi Playground chọn một agent | **MUST** |
| HUB-FR-78 | **Cấp quyền agent:** `platform_admin` cấp và thu hồi entitlement agent cho tenant (trong Studio). `tenant_admin` cấp agent cho group/user trong tenant mình, chỉ với agent đã có entitlement (UI ở trang Groups của Admin, gọi `GET/POST/DELETE /agent-grants` của Hub bằng JWT của chính `tenant_admin`, không qua `/studio`). Thu hồi entitlement thì grant trong tenant mất hiệu lực nhưng vẫn giữ để khôi phục. Mọi thay đổi ghi audit và tăng `hub_config_version` | **MUST** |
| HUB-FR-79 | **Kiểm tra quyền:** API trả các agent một user thấy được kèm lý do (entitlement, grant qua group nào), để công cụ "Kiểm tra quyền" của Admin hiện cùng feature và command | **SHOULD** |
| HUB-FR-80 | Khi gọi Dify, gửi `user = <tenant>:<user_id>` để truy vết | **MUST** |
| HUB-FR-81 | **Kiểm tra quota khi bắt đầu run, không chặn.** Đọc `admin.tenant_quotas` (theo cả tenant, và theo tenant × feature nếu có). Số đã dùng trong tháng (run, token, USD) đếm trong Redis, đối soát định kỳ với `usage_logs`. Không có quota (mặc định) thì không giới hạn. Đã vượt 100% thì run vẫn chạy và usage được đánh dấu `overage = true` | **MUST** |
| HUB-FR-82 | **Cảnh báo quota:** khi số đã dùng chạm `warn_pct` (mặc định 80%) và 100%, Hub phát sự kiện `quota_threshold` (tenant, feature, mức) một lần cho mỗi mức trong tháng. Admin dùng sự kiện này để gửi email và hiện banner cho `tenant_admin`. Sự kiện SSE `run.started` luôn mang `quota: {state, pct}` (`ok` dưới 80%, `warn` ≥ 80%, `over` ≥ 100%) để client hiện dòng nhắc nhẹ cho user | **MUST** |
| HUB-FR-83 | **Log chi phí theo tenant:** mỗi dòng `usage_logs` ghi `tenant_id`, `feature_id` (run command; job agent chat / run orchestrated thì `null`), `billing` (`api` \| `subscription` \| `dify`), `cost_usd` (chi phí thật; subscription = 0), `billable_usd` (số thu của tenant), `overage` | **MUST** |
| HUB-FR-84 | **Bảng giá bán `hub.price_book`:** Hub (hoặc Worker, với job của Worker) tính `billable_usd` lúc ghi `usage_logs`: (token vào × `input_usd_per_mtok` + token ra × `output_usd_per_mtok`) / 1.000.000, theo dòng giá của (provider, model) có `effective_from` gần nhất trước lúc chạy. Dùng chung cho API và subscription. Chưa có đơn giá thì vẫn ghi token, `billable_usd = null`, và được tính lại khi thêm đơn giá. `platform_admin` sửa bảng giá trong Studio | **MUST** |
| HUB-FR-85 | **Chi phí Dify:** ghi token và chi phí từ metadata Dify nếu có. Không có thì ghi số run và thời gian chạy | **MUST** |
| HUB-FR-86 | **Slot subscription theo tenant:** subscription CLI dùng chung cho mọi tenant. Số job subscription chạy cùng lúc của một tenant không vượt `tenants.max_concurrent_sub` (null = không giới hạn, là mặc định). Tenant đã đủ slot thì bước subscription được coi như gặp `quota` và profile chuyển sang bước sau (luôn có bước API dự phòng) | **MUST** |
| HUB-FR-87 | **Xem trace theo role:** `platform_admin` xem trace mọi tenant. `tenant_admin` chỉ xem chi phí của tenant, không xem nội dung chat. Mỗi lần xem trace ghi audit `view_trace` kèm tenant | **MUST** |
| HUB-FR-88 | Tenant hoặc user bị khoá (theo cache) thì Hub từ chối request ngay, không đợi access token hết hạn: trả 401, client về màn đăng nhập | **SHOULD** |

> ℹ️ **Lưu ý:** cần xác nhận loại gói subscription đang dùng cho phép phục vụ nhiều khách hàng.

## 7. Luật nghiệp vụ

| ID | Luật |
|---|---|
| HUB-BR-01 | Message bắt đầu bằng `/` **luôn** được hiểu là command, không bao giờ rơi xuống Coordinator. Muốn gửi chữ bắt đầu bằng "/" thì gõ `//` |
| HUB-BR-02 | Dữ liệu cách ly theo `tenant_id` và `user_id`: user chỉ thấy conversation, run và file của mình. `platform_admin` xem được trace của mọi tenant để debug. `tenant_admin` chỉ xem chi phí, không xem nội dung |
| HUB-BR-03 | Coordinator chỉ thấy agent đang bật mà user được dùng. Agent chuyên trách **không được** gọi ngược lại Coordinator (độ sâu tối đa là 1) |
| HUB-BR-04 | Mọi lỗi đều phải hiện cho user, kèm mã lỗi và gợi ý. Không được im lặng và không được bịa kết quả. Ví dụ: thiếu key thì báo "chưa cấu hình", không được trả rỗng |
| HUB-BR-05 | Khi dự phòng sang provider khác, câu trả lời vẫn hợp lệ, nhưng trace phải ghi rõ provider nào đã phục vụ |
| HUB-BR-06 | Cấu hình và quyền được chốt tại thời điểm run bắt đầu. Sửa giữa chừng thì run đang chạy không bị ảnh hưởng |
| HUB-BR-07 | Context trang (URL, nội dung) chỉ được gửi đi khi command hoặc agent thật sự dùng tới. Không tự động nhồi vào mọi request |
| HUB-BR-08 | Luôn có đúng một cấu hình Coordinator hợp lệ (có profile). Coordinator chỉ thấy các agent đang bật mà user được dùng |
| HUB-BR-09 | Mô tả agent (cho Coordinator) là bắt buộc, từ 20 đến 400 ký tự. Mô tả tool là mô tả của workflow: bắt buộc 20–400 ký tự, kèm mô tả từng tham số, do Admin kiểm khi tạo workflow |
| HUB-BR-10 | Không được xoá profile, provider hoặc secret đang được dùng. Chỉ được tắt, hoặc phải gỡ tham chiếu trước. Workflow đang được agent dùng thì Admin không cho xoá hay tắt, và hiện danh sách agent đang dùng |
| HUB-BR-11 | Tên tool sinh từ key workflow, dạng `^[a-z][a-z0-9_]{2,40}$` (hợp lệ với function-calling của mọi hãng). Key workflow là duy nhất nên tên tool không trùng |
| HUB-BR-12 | Tool của agent chỉ là workflow trong catalog Admin, nên luôn gọi qua Dify (workflow hoặc agent app). Muốn gọi API nội bộ thì bọc nó trong một workflow Dify rồi thêm vào catalog |
| HUB-BR-13 | Không được lưu thay đổi định tuyến khi bộ câu kiểm thử cho tỉ lệ đúng thấp hơn baseline. Muốn lưu thì phải sửa cấu hình cho đạt, hoặc sửa hay xoá câu kiểm thử (việc này có ghi audit kèm lý do). Bộ câu rỗng thì không chặn |
| HUB-BR-14 | Truy cập tài nguyên của tenant khác luôn trả 404 (không phải 403), để không lộ việc tài nguyên đó tồn tại |
| HUB-BR-15 | Command, workflow, secret, provider dùng chung toàn hệ thống. Workflow không được dùng knowledge base hay bộ nhớ chứa dữ liệu của tenant khác |
| HUB-BR-16 | Quota **không bao giờ chặn** run. Vượt quota chỉ sinh cảnh báo và cờ `overage` để tính phí |
| HUB-BR-17 | `tenant_admin` chỉ cấp được agent đã có entitlement cho tenant mình, và chỉ cho group/user trong tenant mình |

## 8. Mô hình dữ liệu (schema `hub`)

| Bảng | Trường chính |
|---|---|
| `conversations` | id, tenant_id, user_id, title, created_at, updated_at, deleted_at |
| `messages` | id, conversation_id, role (user/assistant/system), content, context (jsonb), attachments (jsonb), run_id, created_at |
| `runs` | id, tenant_id, conversation_id, user_id, kind (command/orchestrated), command_id, feature_id, status, config_version, started_at, finished_at, error_code, error_message |
| `run_steps` | id, run_id, seq, type (delegate/workflow/model/tool), agent_id, workflow_id (→ `admin.workflows`), provider_key, model, input (jsonb, đã che secret), output (jsonb), status, started_at, finished_at |
| `jobs` | id, tenant_id, run_id, step_id, type, payload (jsonb), status, attempts, worker_id, heartbeat_at, result (jsonb), error, created_at, finished_at |
| `cli_sessions` | conversation_id, agent_id, provider_key, session_id, updated_at |
| `usage_logs` | id, tenant_id, run_id, step_id, user_id, feature_id, agent_id, provider_key, model, billing (api/subscription/dify), input_tokens, output_tokens, cost_usd, billable_usd, overage (bool), latency_ms, at |
| `price_book` | id, provider_key, model, input_usd_per_mtok, output_usd_per_mtok, effective_from |
| `provider_state` | provider_key, status (ok/busy/cooldown/error/logged_out), cooldown_until, last_error, updated_at |
| `agents` | id, key, name (jsonb vi/en), description, runtime, profile_id, system_prompt, runtime_options (jsonb), timeout_s, token_budget, enabled, version, timestamps |
| `agent_workflows` | agent_id, workflow_id (→ `admin.workflows`), created_by, created_at (thay bảng `tools` cũ) |
| `agent_entitlements` | agent_id, tenant_id, granted_by, granted_at, revoked_at |
| `agent_grants` | id, agent_id, tenant_id, subject_type (group/user), subject_id, granted_by, granted_at |
| `coordinator_settings` | singleton: profile_id, system_prompt, max_steps, token_budget, history_n, on_no_match (answer\|ask), version, updated_by |
| `providers` | id, key, kind, vendor, base_url, secret_id, max_concurrency, enabled |
| `model_profiles` | id, key, steps (jsonb [{provider_id, model, on[]}]) |
| `secrets` | id, name, ciphertext, iv, last4, note, updated_by, updated_at (chỉ secret của provider) |
| `audit_log` · `config_meta` | Giống cấu trúc của Admin (có `tenant_id`), áp dụng cho cấu hình và quyền agent của Hub |
| `routing_tests` | id, prompt, has_attachment, expected_agents (text[] theo thứ tự), note, enabled, created_by |
| `routing_test_runs` | id, trigger (save/manual), config_draft_hash, passed, total, pass_rate, results (jsonb), accepted (bool), by, at |
| `attachments` | id, tenant_id, user_id, filename, mime, size, storage_path, created_at |

Hub chỉ **đọc** schema `admin`: `tenants`, `groups`, `group_members`, `features`, `feature_commands`, `feature_entitlements`, `feature_grants`, `tenant_quotas`, `commands`, `workflows` và secret của workflow. Hub **ghi** schema `hub` (cấu hình agent, quyền agent, bảng giá, dữ liệu runtime). Admin chỉ **đọc** (không ghi) 3 bảng `hub.agent_workflows`, `hub.agent_grants`, `hub.usage_logs`. `user_id`, `tenant_id`, `role` lấy từ JWT, không cần join sang bảng users mỗi request.

## 9. API & sự kiện stream

### 9.1 Endpoint

| Endpoint | Mô tả |
|---|---|
| `GET /commands` | Menu command cho client, chỉ gồm lệnh user được dùng |
| `GET/POST /conversations` · `PATCH/DELETE /conversations/:id` | Quản lý hội thoại (trong tenant của user) |
| `GET /conversations/:id/messages` | Lịch sử (phân trang) |
| `POST /conversations/:id/messages` | Gửi message, trả về SSE stream |
| `GET /runs/:id/events` | Nối lại stream (hỗ trợ `Last-Event-ID`) |
| `POST /runs/:id/cancel` · `GET /runs/:id` · `GET /runs/:id/trace` | Điều khiển và xem run (trace theo HUB-FR-87) |
| `POST /attachments` | Upload file |
| `GET /admin/usage` | Báo cáo chi phí theo tenant × feature × tháng. `platform_admin`: mọi tenant, cả `cost_usd` và `billable_usd`. `tenant_admin`: tenant mình |
| `GET/POST/DELETE /agent-grants` | Cấp agent cho group/user (Admin UI trang Groups gọi, bằng JWT của `tenant_admin`). Chỉ role `tenant_admin`/`platform_admin`. Chỉ trong đúng `tenant_id` của JWT, chỉ với agent đã có entitlement cho tenant đó. `GET` trả các agent đã có entitlement cho tenant kèm grant. Không nằm dưới `/studio` |
| `GET /agent-grants/effective/:user_id` | Agent user thấy được kèm lý do (cho "Kiểm tra quyền" của Admin) |
| `/mcp` | MCP server: workflow gắn cho agent của job (token của job) |
| `/studio` · `/studio/api/{agents,coordinator,workflows,providers,model-profiles,secrets,agent-entitlements,price-book,audit,export,import}` | Agent Studio UI và API cấu hình (role `platform_admin`). `workflows` là catalog Admin, chỉ đọc |
| `POST /studio/api/coordinator/dry-run` · `POST /studio/api/workflows/:id/test` · `POST /studio/api/playground` (SSE) | Thử định tuyến, thử workflow, Playground |
| `/studio/api/routing-tests` (CRUD) · `POST /studio/api/routing-tests/run` | Bộ câu kiểm thử định tuyến. Khi lưu cấu hình ảnh hưởng tới định tuyến, server tự chạy và có thể trả `422 ROUTING_REGRESSION` |
| `POST /internal/test-run` | Admin gọi để test (service token) |

### 9.2 Sự kiện SSE

```
event: run.started     data: {run_id, kind, quota: {state: "ok"|"warn"|"over", pct}}   # warn ≥ 80%, over ≥ 100%; không chặn
event: step.started    data: {step_id, type, label: "Đang kiểm tra hoá đơn…", agent?}
event: delta           data: {text}                       # token câu trả lời
event: step.finished   data: {step_id, status, provider?, ms}
event: job.progress    data: {job_id, message, percent?}  # từ Worker
event: ask             data: {question}                   # Coordinator hỏi lại
event: run.finished    data: {run_id, message_id, usage}
event: run.failed      data: {run_id, code, message, hint}
```

### 9.3 Mã lỗi

| Mã | Ý nghĩa | Gợi ý cho user |
|---|---|---|
| `AUTH_EXPIRED` | Token hết hạn | Client tự refresh |
| `CMD_NOT_FOUND` | Không có command này, hoặc user không được dùng | Kèm gợi ý các command gần giống trong số lệnh user được dùng |
| `CMD_MISSING_ARG` | Thiếu tham số hoặc input bắt buộc | Nêu tên tham số còn thiếu |
| `NOT_CONFIGURED` | Thiếu key hoặc cấu hình | Báo admin |
| `UPSTREAM_ERROR` | Dify hoặc model lỗi | Thử lại sau |
| `ALL_PROVIDERS_EXHAUSTED` | Mọi bước trong profile đều thất bại | Thử lại sau, admin kiểm tra provider |
| `BUDGET_EXCEEDED` | Vượt số bước hoặc ngân sách token của run | Chia nhỏ yêu cầu |
| `TIMEOUT` · `CANCELLED` | Hết giờ hoặc bị huỷ | — |

Vượt quota tenant **không** phải lỗi: run vẫn chạy, `run.started` mang `quota.state = "over"` để client hiện dòng nhắc nhẹ.

## 10. Yêu cầu phi chức năng

| ID | Yêu cầu |
|---|---|
| HUB-NFR-01 | **Độ trễ:** overhead của Hub với command sync ≤ 200ms (không tính thời gian Dify), đã gồm tính quyền và kiểm tra quota. Sự kiện `run.started` đến client trong ≤ 500ms |
| HUB-NFR-02 | **Chạy nhiều instance:** Hub không giữ trạng thái trong process (ngoài cache cấu hình). Chạy được nhiều instance, mỗi instance tự LISTEN riêng. Sự kiện SSE, bộ đếm quota và slot subscription đi qua Redis |
| HUB-NFR-03 | **Chịu lỗi:** Admin chết thì Hub vẫn phục vụ bằng cache (gồm cả quyền). Dify chết thì command báo `UPSTREAM_ERROR`, còn agent `llm` vẫn chạy. Redis mất bộ đếm quota thì dựng lại từ `usage_logs` |
| HUB-NFR-04 | **Quan sát:** mọi log có `run_id`, `tenant_id` và `user_id`. Secret và nội dung file không bao giờ xuất hiện trong log |
| HUB-NFR-05 | **Lưu trữ:** giữ hội thoại 180 ngày. Giữ `run_steps.input/output` 30 ngày rồi xoá, chỉ giữ lại metadata (có thể chỉnh). `usage_logs` giữ lâu dài để tính phí |
| HUB-NFR-06 | **Quy mô v1:** ~50 user, ~20 run chạy đồng thời, tính chung mọi tenant (giữ như v0.3, xem câu hỏi mở) |

## 11. Tiêu chí nghiệm thu

> **AC-H01 · Command với đoạn bôi đen**
> Given `/dich` có tham số `text` với fallback `$selection`, When user bôi đen "xin chào" rồi gõ `/dich en`, Then Dify nhận `source_text="xin chào"`, `target_lang="en"`, và client nhận được stream kết quả.

> **AC-H02 · Command sai tên**
> When gõ `/dihc`, Then nhận `CMD_NOT_FOUND` kèm gợi ý `/dich`, và Coordinator **không** được gọi.

> **AC-H03 · Điều phối nhiều bước**
> Given user được dùng agent `hoadon` và `trello`, When user gửi "kiểm tra hoá đơn đính kèm rồi tạo thẻ Trello nếu sai", Then trace có các step delegate(hoadon), rồi delegate(trello) nếu hoá đơn sai, cuối cùng là answer. Client thấy `step.started` với nhãn dễ hiểu cho từng bước.

> **AC-H04 · Dự phòng provider**
> Given profile *smart* = anthropic-api → openai-api và anthropic đang trả 429, When chạy agent dùng *smart*, Then câu trả lời đến từ openai, và trace ghi `provider=openai-api` kèm lý do dự phòng.

> **AC-H05 · Cập nhật cấu hình nóng**
> When `platform_admin` tắt `/dich` (hoặc tắt feature chứa nó), Then trong ≤ 5 giây `GET /commands` không còn `/dich`. Run `/dich` đang chạy dở vẫn chạy xong.

> **AC-H06 · Huỷ**
> Given một run agentic-cli đang chạy, When user bấm huỷ, Then trong ≤ 5 giây run có trạng thái `cancelled`, tiến trình CLI bị dừng, và client nhận `run.failed{code:CANCELLED}`.

> **AC-H07 · Cách ly dữ liệu giữa user**
> When user A gọi `GET /conversations/:id` với id của user B, Then nhận 404 (không phải 403, để không lộ việc hội thoại đó tồn tại).

> **AC-H08 · Cách ly tenant**
> Given user X thuộc tenant `acme` và run R thuộc tenant `beta`, When X gọi `GET /runs/R`, `GET /runs/R/trace` hoặc `GET /conversations/:id` của tenant `beta`, Then nhận 404. Kể cả khi X là `tenant_admin` của `acme`.

> **AC-H09 · Agent không được cấp thì Coordinator không chọn**
> Given agent `hoadon` có entitlement cho `acme` nhưng chưa cấp cho group nào của user X, When X gửi "kiểm tra hoá đơn này", Then danh sách agent đưa cho Coordinator không có `hoadon`, trace không có delegate(hoadon), và Coordinator tự trả lời (hoặc chọn agent khác X được dùng). When `tenant_admin` cấp `hoadon` cho group của X, Then trong ≤ 5 giây lượt gửi tiếp theo có thể delegate(hoadon).

> **AC-H10 · Vượt quota vẫn chạy và có cảnh báo**
> Given tenant `acme` có quota tháng `max_runs = 100`, `warn_pct = 80`, đã dùng 79 run, When user gửi run thứ 80, Then run chạy bình thường, `run.started` có `quota{state:"warn", pct:80}`, và Hub phát `quota_threshold{level:80}` một lần. When run thứ 101 được gửi, Then run vẫn chạy, `run.started` có `quota.state = "over"`, dòng `usage_logs` có `overage = true`, và `quota_threshold{level:100}` chỉ phát một lần trong tháng.

> **AC-H11 · Command không được cấp**
> Given `/tom` thuộc feature `summary` chưa có entitlement cho tenant của user, Then `GET /commands` không có `/tom`. When user vẫn gõ `/tom abc`, Then nhận `CMD_NOT_FOUND` và Dify không được gọi.

> **AC-H12 · Tool lấy từ workflow**
> Given agent `hoadon` được gắn workflow `check_invoice` có mô tả "Kiểm tra một hoá đơn điện tử…", When `platform_admin` sửa mô tả workflow ở Admin, Then trong ≤ 5 giây tool model nhìn thấy (Studio "Xem như model thấy" và lời gọi thật) dùng mô tả mới, không phải sửa gì ở Studio.

> **AC-H13 · Slot subscription theo tenant**
> Given `acme` có `max_concurrent_sub = 1` và đang có 1 job subscription chạy, When user khác của `acme` chạy agent `agentic-cli` với profile *coder* = claude-sub → anthropic-api, Then job mới chạy bằng anthropic-api, trace ghi lý do dự phòng, và `usage_logs.billing = api`.

## 12. Ngoài phạm vi & câu hỏi mở

### Ngoài phạm vi v1

- Quota theo user, BYOK, SSO.
- Chặn run khi vượt quota.
- Điều khiển thiết bị hay trình duyệt từ xa (extension thực thi lệnh trên trang theo yêu cầu của Hub).
- RAG hay bộ nhớ dài hạn cho từng user.

### Câu hỏi mở

1. Coordinator dùng model nào mặc định: profile rẻ (nhanh) hay profile mạnh (chọn đúng hơn)?
2. File đính kèm lưu ở ổ đĩa cục bộ hay object storage (S3/MinIO)?
3. Extension có cần WebSocket hai chiều (Hub ra lệnh ngược cho extension) ở v1 không?
4. Command thuộc nhiều feature thì `feature_id` của run lấy feature nào? Tạm: feature đầu tiên (theo key) mà user được cấp. Job agent chat và run orchestrated có `feature_id = null`, nên chỉ tính vào quota cả tenant.
5. `max_usd` của quota so với `billable_usd` hay `cost_usd`? Tạm: `billable_usd`.
6. Ai gửi email cảnh báo quota? Tạm: Hub phát `quota_threshold` (NOTIFY), Admin gửi email và hiện banner.
7. Workflow dùng làm tool không có sync/async và timeout riêng (các trường này nằm ở command). Tạm: tool gọi đồng bộ, timeout theo `timeout_s` của agent. Có cần cấu hình riêng cho từng cặp agent–workflow không?
8. Quy mô v1 khi có nhiều tenant thật (số tenant, user, run đồng thời) cần chốt lại.
