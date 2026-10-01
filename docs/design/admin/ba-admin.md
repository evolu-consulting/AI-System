# Admin Service — Business Requirements

Nguồn chân lý cho danh tính, phân quyền và cấu hình của nền tảng AI multi-tenant

`v0.4 · draft` · `2026-10-01` · `Mã yêu cầu: ADM-*`

## 1. Mục đích & phạm vi

**Vấn đề cần giải quyết.** Nếu mỗi client tự hardcode "command nào gọi workflow nào", thì mỗi lần thêm hoặc đổi workflow Dify lại phải sửa code và phát hành lại client. Các key cũng dễ bị rải khắp nơi. Từ v0.4, hệ thống phục vụ nhiều công ty khách hàng (tenant), nên còn cần một nơi quyết định **tenant nào, nhóm nào, ai được dùng gì** và **dùng hết bao nhiêu**. Admin gom toàn bộ việc này về một chỗ: người vận hành đổi được hành vi của hệ thống mà không cần deploy.

**Admin chịu trách nhiệm:**

- Danh tính: tenant, user, group, đăng nhập, phát và thu hồi token.
- Phân quyền: 3 role quản trị, feature (gói command), entitlement theo tenant, cấp quyền cho group/user.
- Catalog workflow Dify **dùng chung** cho cả command và agent, cùng các command trỏ tới workflow.
- Quota và báo cáo chi phí theo tenant.
- Lưu secret (app-key Dify) dưới dạng mã hoá.
- Nhật ký thay đổi (audit log) và import/export cấu hình.

> ⚠️ **v0.4:** hệ thống chuyển từ "chỉ nội bộ" sang **multi-tenant cho công ty / khách hàng bên ngoài**. Workflow trở thành catalog dùng chung: agent ở Agent Hub chọn workflow từ đây, không khai báo tool riêng nữa. Cấu hình agent, Coordinator, provider, model profile vẫn thuộc [Agent Hub](../agent-hub/ba-agent-hub.md).

**Admin không làm:** không chạy workflow, không gọi LLM, không lưu hội thoại, không cấu hình agent. Những việc đó thuộc Agent Hub. Khi bấm nút "Test" trên Admin, Admin chỉ nhờ Hub chạy thử.

> ℹ️ **Giả định:** command, workflow, secret, key Dify và API key **dùng chung toàn hệ thống**; tenant chỉ được cấp quyền dùng, không tự tạo. Dùng chung một Postgres với Agent Hub, trong đó Admin sở hữu schema `admin`.

## 2. Actor

| Actor | Mô tả | Dùng Admin để |
|---|---|---|
| **Platform admin** (người) | Người vận hành nền tảng, role `platform_admin`, thuộc tenant `platform` | Quản lý tenant, workflow, command, feature, secret, entitlement, quota; xem mọi tenant |
| **Tenant admin** (người) | Quản trị của một công ty khách hàng, role `tenant_admin` | Quản lý user, group và cấp quyền trong tenant của mình; xem chi phí, quota, audit của tenant |
| **Member** (người) | Nhân viên của tenant dùng Chat App hoặc Extension, role `member` | Chỉ đăng nhập và đổi mật khẩu của chính mình |
| **Agent Hub** (hệ thống) | Service điều phối | Đọc (read-only qua DB) tenant, group, feature, quyền, quota, command và workflow; nhận thông báo khi thay đổi; verify JWT |
| **Builder** (người + Claude session) | Người tạo workflow trên Dify bằng Claude session | Khai báo workflow mới vào catalog (thường là platform admin) |

## 3. Thuật ngữ

| Thuật ngữ | Định nghĩa |
|---|---|
| Tenant | Một công ty / khách hàng dùng nền tảng. Mọi user và dữ liệu runtime đều thuộc đúng một tenant. Công ty vận hành cũng là một tenant (`platform`) |
| Group | Nhóm user trong một tenant. Là đơn vị để cấp feature và agent |
| Workflow (catalog entry) | Bản khai báo một app Dify gồm tên, mô tả, loại app, input schema và secret app-key. Dùng chung cho command và agent. Có thể tạo sẵn mà chưa gắn vào đâu |
| Command | Lệnh bắt đầu bằng `/` mà user gõ trong chat. Mỗi command trỏ tới đúng một workflow và có luật map tham số sang input |
| Feature | Gói command để bật/tắt và cấp quyền. Feature không chạy gì |
| Entitlement | Tenant **được phép có** một feature (do platform admin cấp) |
| Grant | Group hoặc user trong tenant **được dùng** một feature (do tenant admin cấp, trong phạm vi entitlement) |
| Quota | Giới hạn mức dùng theo tháng của tenant (số run, token, USD). Vượt quota không bị chặn, chỉ cảnh báo và tính phí phần vượt |
| Secret | Giá trị nhạy cảm (key). Lưu mã hoá, UI chỉ hiện `••••` và 4 ký tự cuối |

## 4. User stories

| ID | Là… | Tôi muốn… | Để… |
|---|---|---|---|
| US-A01 | Tenant admin | tạo tài khoản cho nhân viên và đặt mật khẩu tạm | họ đăng nhập được vào Chat App và Extension |
| US-A02 | Tenant admin | khoá tài khoản khi nhân viên nghỉ | người đó mất quyền truy cập ngay |
| US-A03 | Builder | khai báo một workflow Dify vừa tạo vào catalog, kể cả khi chưa biết dùng ở đâu | command hoặc agent dùng được nó sau này |
| US-A04 | Platform admin | tạo command `/dich` trỏ tới workflow translate và map tham số | user gõ `/dich` là chạy được, không cần sửa client |
| US-A05 | Platform admin | bấm Test với input mẫu ngay trên form | biết cấu hình chạy đúng trước khi mở cho mọi người |
| US-A08 | Platform admin | bật/tắt một command hoặc cả một feature | tạm ngưng một chức năng lỗi mà không phải xoá |
| US-A09 | Admin | xem ai đã sửa gì và khi nào, rồi khôi phục bản trước | truy vết và sửa sai nhanh |
| US-A10 | Platform admin | export toàn bộ cấu hình ra yaml và import lại | sao lưu, chuyển môi trường, hoặc để Claude session sinh cấu hình |
| US-A11 | Member | đổi mật khẩu của mình | thay mật khẩu tạm do admin cấp |
| US-A12 | Platform admin | tạo tenant mới và tạo tenant admin đầu tiên | onboard một công ty khách hàng |
| US-A13 | Platform admin | cấp cho tenant các feature theo gói đã bán | tenant chỉ thấy đúng những gì họ mua |
| US-A14 | Tenant admin | tạo group "Kế toán" và cấp feature "Kế toán" cho group đó | chỉ phòng kế toán thấy các lệnh kế toán |
| US-A15 | Tenant admin | xem một user đang thấy những command và agent nào, và vì sao | trả lời nhanh câu hỏi "sao tôi không thấy lệnh X" |
| US-A16 | Platform admin | đặt quota tháng cho tenant và xem chi phí theo tenant × feature | kiểm soát chi phí và tính tiền cho khách hàng |
| US-A17 | Tenant admin | nhận cảnh báo khi tenant dùng tới 80% và 100% quota | chủ động điều chỉnh trước khi bị tính phí vượt |

## 5. Yêu cầu chức năng

**MUST** bắt buộc cho v1 · **SHOULD** nên có trong v1 · **COULD** để sau

### 5.1 Auth & user

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| ADM-FR-01 | Đăng nhập bằng **mã công ty (tenant key) + username + password**, trả về access token (JWT, 15 phút) và refresh token (30 ngày). JWT chứa `user_id`, `tenant_id`, `role` | **MUST** |
| ADM-FR-02 | Refresh: đổi refresh token lấy access token mới, xoay vòng refresh token (bản cũ mất hiệu lực) | **MUST** |
| ADM-FR-03 | Đăng xuất: thu hồi refresh token hiện tại | **MUST** |
| ADM-FR-04 | Admin tạo, sửa, khoá hoặc mở khoá user và đặt lại mật khẩu. `tenant_admin` chỉ thao tác trên user của tenant mình. Không có trang tự đăng ký | **MUST** |
| ADM-FR-05 | Khoá user thì thu hồi toàn bộ refresh token của user đó | **MUST** |
| ADM-FR-06 | User có cờ `must_change_password`. Khi bật, lần đăng nhập đầu bắt buộc phải đổi mật khẩu | **SHOULD** |
| ADM-FR-07 | Sai mật khẩu 5 lần liên tiếp thì khoá tạm 15 phút | **SHOULD** |
| ADM-FR-08 | 2FA (TOTP) cho `platform_admin` và `tenant_admin` | **SHOULD** |

### 5.2 Tenant & group

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| ADM-FR-60 | CRUD tenant, **không có Xoá ở v1, chỉ Khoá** ([CR-006](../../CHANGE-REQUESTS.md)) (chỉ `platform_admin`): key (mã công ty), tên, trạng thái, giới hạn slot subscription `max_concurrent_sub` (trống = không giới hạn). Tạo tenant kèm tạo `tenant_admin` đầu tiên | **MUST** |
| ADM-FR-61 | Khoá tenant thì mọi user trong tenant bị khoá và thu hồi refresh token. Mở khoá thì khôi phục trạng thái trước đó của từng user | **MUST** |
| ADM-FR-62 | CRUD group trong tenant: key, tên (vi/en), mô tả. Thêm/bớt thành viên, hỗ trợ dán danh sách username để thêm hàng loạt. Không lồng group | **MUST** |
| ADM-FR-63 | Username duy nhất trong tenant (hai tenant có thể cùng có `an`) | **MUST** |

### 5.3 Catalog workflow

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| ADM-FR-10 | CRUD workflow: key (slug), tên, **mô tả (bắt buộc, 20–400 ký tự, nói rõ khi nào dùng)**, loại app (`workflow` \| `chat` \| `agent`), base URL Dify, tham chiếu secret app-key, input schema, output field | **MUST** |
| ADM-FR-11 | Nhập input schema bằng tay (tên biến, kiểu, bắt buộc hay không, **mô tả bắt buộc**). Mô tả workflow và mô tả tham số được Agent Hub dùng nguyên văn làm tool cho model | **MUST** |
| ADM-FR-12 | Nút "Lấy schema từ Dify": gọi Dify để tự điền input schema từ app thật. *Hoãn, không làm ở M2, ẩn nút ([CR-012](../../CHANGE-REQUESTS.md))* | **COULD** |
| ADM-FR-13 | Không được xoá hoặc tắt workflow đang được command hoặc agent dùng. Hộp xác nhận liệt kê nơi đang dùng (đọc `hub.agent_workflows`) | **MUST** |
| ADM-FR-14 | Workflow **chưa gắn** vào command hay agent nào là hợp lệ. Danh sách có nhãn "Chưa gắn" và bộ lọc tương ứng | **MUST** |
| ADM-FR-15 | Cột "Đang được dùng bởi" liệt kê cả command (Admin) và agent (Agent Hub) | **MUST** |

### 5.4 Command

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| ADM-FR-20 | CRUD command: tên, alias, mô tả, workflow, danh sách tham số, input map, output (field + kiểu hiển thị), chế độ sync/async, timeout, bật/tắt, **feature (≥ 1, mặc định `core`)** | **MUST** |
| ADM-FR-21 | Input map hỗ trợ các nguồn: `$args.<tên>`, `$selection` (đoạn bôi đen), `$page.url`, `$page.text`, `$attachment`, `$user.id`, `$tenant.id`, và giá trị hằng | **MUST** |
| ADM-FR-22 | Khi lưu phải validate: mọi input bắt buộc của workflow đều đã được map, và không map vào biến không tồn tại | **MUST** |
| ADM-FR-23 | Nút Test: nhập tham số mẫu, Admin nhờ Hub chạy thử **bằng bản đang sửa (chưa cần lưu)**, gửi cấu hình nháp trong body, rồi hiện kết quả, thời gian chạy và lỗi (nếu có). Có ô "Chạy với tư cách user…" để kiểm tra quyền | **MUST** |
| ADM-FR-24 | Tab "Ai dùng được": danh sách tenant, group và số user thấy command này, kèm lý do (qua feature nào, grant nào). *M2 chỉ phần tenant (feature + entitlement); phần group/grant ở M3 ([CR-013](../../CHANGE-REQUESTS.md))* | **SHOULD** |

### 5.5 Feature & phân quyền

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| ADM-FR-30 | CRUD feature (chỉ `platform_admin`): key, tên và mô tả (vi/en), icon, danh sách command, trạng thái `on` \| `off` \| `beta` | **MUST** |
| ADM-FR-31 | **Entitlement:** `platform_admin` cấp hoặc thu hồi feature cho tenant | **MUST** |
| ADM-FR-32 | **Grant:** `tenant_admin` cấp feature cho group hoặc user trong tenant, chỉ trong phạm vi feature đã được entitlement | **MUST** |
| ADM-FR-33 | **Kill switch:** tắt feature thì mọi command bên trong biến khỏi menu trong ≤ 5 giây. Run đang chạy vẫn chạy xong | **MUST** |
| ADM-FR-34 | Trạng thái `beta`: feature chỉ hiện cho user thuộc group `beta-testers`, có nhãn "Beta" trong menu `/` | **SHOULD** |
| ADM-FR-35 | Ma trận phân quyền feature × group, tick để cấp, thao tác hàng loạt | **SHOULD** |
| ADM-FR-36 | Công cụ **Kiểm tra quyền**: chọn user, xem feature, command và agent user thấy được, kèm lý do. Dùng chung cho tab "Quyền hiệu lực" trên trang user | **MUST** |
| ADM-FR-37 | Trang group hiện cả agent được cấp cho group. Tenant admin cấp agent cho group ngay tại đây (dữ liệu ghi vào `hub.agent_grants` qua API của Hub) | **MUST** |

### 5.6 Quota & chi phí

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| ADM-FR-40 | `platform_admin` đặt quota tháng cho tenant: số run, số token, số USD; chung cho cả tenant hoặc riêng từng feature. **Mặc định không giới hạn** | **MUST** |
| ADM-FR-41 | **Không chặn khi vượt quota.** Khi đạt 80% và 100%, gửi cảnh báo cho `tenant_admin` (email + banner trong Admin). Phần vượt được Hub đánh dấu `overage` để tính phí riêng | **MUST** |
| ADM-FR-42 | Màn "Chi phí & quota": KPI tháng theo tenant, thanh quota đã dùng / giới hạn, biểu đồ theo ngày, top feature, export CSV. `platform_admin` thấy cả chi phí thật (`cost_usd`) và số thu (`billable_usd`); `tenant_admin` chỉ thấy tenant mình và số thu | **MUST** |

### 5.7 Secret, audit, import/export

| ID | Yêu cầu | Ưu tiên |
|---|---|---|
| ADM-FR-50 | CRUD secret (chỉ `platform_admin`): tên, giá trị (chỉ ghi, không đọc lại được), ghi chú. Mã hoá AES-256-GCM bằng master key lấy từ env | **MUST** |
| ADM-FR-51 | Mọi thay đổi cấu hình, user, group, quyền và quota đều ghi audit log: ai, lúc nào, tenant nào, thực thể nào, trước/sau. Secret chỉ ghi "đã đổi", không ghi giá trị. `tenant_admin` chỉ xem audit của tenant mình | **MUST** |
| ADM-FR-52 | Khôi phục một thực thể về trạng thái "trước" lấy từ audit log | **SHOULD** |
| ADM-FR-53 | Mỗi lần lưu cấu hình hoặc quyền thì tăng `config_version` và gửi thông báo `config_changed` cho Hub (Postgres NOTIFY) | **MUST** |
| ADM-FR-54 | Export và import yaml cho workflow, command, feature, tenant, group và grant. Secret chỉ export tên, không export giá trị. Import có bước xem trước khác biệt (diff) trước khi áp dụng | **SHOULD** |
| ADM-FR-55 | **Chống ghi đè**: mỗi command, workflow, feature, group và user có trường `version`. Khi lưu phải gửi version đang sửa. Nếu lệch với DB thì trả 409 kèm bản mới nhất, và UI cho chọn Xem khác biệt / Ghi đè / Tải bản mới | **MUST** |

## 6. Luật nghiệp vụ

| ID | Luật |
|---|---|
| ADM-BR-01 | Tên command và alias là **duy nhất toàn hệ thống**, chỉ gồm chữ thường, số và `-`, không dấu. Ví dụ: `dich`, `kiemtra-hoadon` |
| ADM-BR-02 | Một command trỏ tới **đúng một** workflow. Nhiều command và nhiều agent có thể dùng chung một workflow |
| ADM-BR-04 | Giá trị secret không bao giờ trả ra khỏi Admin qua API, UI hay export |
| ADM-BR-05 | Có 3 role: `platform_admin` (toàn hệ thống, kể cả Agent Studio), `tenant_admin` (trong tenant của mình, không vào Agent Studio), `member` (chỉ gọi `/auth/*` và đổi mật khẩu của mình) |
| ADM-BR-06 | Thực thể bị tắt thì vẫn lưu trong DB, nhưng Hub coi như không tồn tại: không hiện trong menu command, agent không gọi được |
| ADM-BR-08 | Admin không được tự khoá chính mình hoặc tự hạ role của mình. Luôn phải còn ít nhất một `platform_admin` active và mỗi tenant (kể cả tenant đang khoá) còn ít nhất một `tenant_admin` active ([CR-007](../../CHANGE-REQUESTS.md)) |
| ADM-BR-09 | Mọi truy vấn của `tenant_admin` bị giới hạn theo `tenant_id` của họ. Truy cập thực thể của tenant khác trả 404 |
| ADM-BR-10 | Mỗi command phải thuộc ít nhất một feature. Feature `core` luôn tồn tại, được entitlement cho mọi tenant, không xoá được |
| ADM-BR-11 | User dùng được `/cmd` ⇔ cmd thuộc feature F ∧ F đang bật (hoặc `beta` và user thuộc `beta-testers`) ∧ F được entitlement cho tenant của user ∧ F được cấp cho user hoặc cho một group user thuộc về |
| ADM-BR-12 | Thu hồi entitlement của tenant thì các grant bên trong mất hiệu lực nhưng vẫn giữ lại, cấp lại entitlement thì grant có hiệu lực trở lại |
| ADM-BR-13 | Workflow không có quyền riêng. Quyền nằm ở nơi dùng nó: command (qua feature) hoặc agent (qua agent grant ở Hub) |
| ADM-BR-14 | Tenant không tự tạo command, workflow hay secret. Mọi tenant dùng chung catalog, key Dify và API key |

## 7. Mô hình dữ liệu (schema `admin`)

> ℹ️ Dùng chung một Postgres. Admin **ghi** schema `admin`. Agent Hub có DB role **chỉ đọc** trên schema này để tính quyền, quota và chạy command/workflow. Admin có quyền **chỉ đọc** `hub.agent_workflows` (biết workflow nào đang được agent dùng), `hub.agent_grants` (hiện agent đã cấp cho group) và `hub.usage_logs` (màn Chi phí & quota).

| Bảng | Trường chính |
|---|---|
| `tenants` | id, key (mã công ty, unique), name, active, max_concurrent_sub (null = không giới hạn), settings (jsonb), created_at, version |
| `users` | id, tenant_id, username, password_hash, display_name, role (`platform_admin` \| `tenant_admin` \| `member`), locale (vi\|en), active, must_change_password, failed_logins, locked_until, totp_secret, version, created_at, updated_at · unique (tenant_id, username) |
| `refresh_tokens` | id, user_id, token_hash, expires_at, revoked_at, created_at, user_agent |
| `groups` | id, tenant_id, key, name (jsonb vi/en), description, version · unique (tenant_id, key) |
| `group_members` | group_id, user_id, added_by, added_at |
| `secrets` | id, name (unique), ciphertext, iv, last4, note, updated_by, updated_at |
| `workflows` | id, key (unique), name, description, app_type, base_url, secret_id, input_schema (jsonb, có mô tả từng tham số), output_field, enabled, version, timestamps |
| `commands` | id, name (unique), aliases (text[]), description, workflow_id, args (jsonb), input_map (jsonb), output (jsonb), mode, timeout_s, enabled, version, timestamps |
| `features` | id, key (unique), name (jsonb), description (jsonb), icon, status (`on` \| `off` \| `beta`), version |
| `feature_commands` | feature_id, command_id |
| `feature_entitlements` | feature_id, tenant_id, granted_by, granted_at, revoked_at |
| `feature_grants` | id, feature_id, tenant_id, subject_type (`group` \| `user`), subject_id, granted_by, granted_at |
| `tenant_quotas` | id, tenant_id, feature_id (null = cả tenant), period (`month`), max_runs, max_tokens, max_usd, warn_pct (mặc định 80) |
| `audit_log` | id, tenant_id, actor_id, action, entity, entity_id, before (jsonb), after (jsonb), at |
| `config_meta` | config_version (int), updated_at |

```
tenants 1─* users ─*─* groups           (qua group_members)
tenants 1─* tenant_quotas
secrets 1─* workflows 1─* commands
workflows 1─* hub.agent_workflows        (Hub ghi, Admin chỉ đọc)
features *─* commands                   (qua feature_commands)
features *─* tenants                    (qua feature_entitlements)
features 1─* feature_grants ─▶ group | user
users 1─* refresh_tokens
```

## 8. API

| Nhóm | Endpoint | Ai gọi |
|---|---|---|
| Auth | `POST /auth/login` (tenant, username, password) · `POST /auth/refresh` · `POST /auth/logout` · `POST /auth/change-password` · `POST /auth/totp/*` | Mọi client |
| Tenant | `GET/POST /admin/tenants` · `PATCH /admin/tenants/:id` · `POST /admin/tenants/:id/lock` | platform_admin |
| User | `GET/POST /admin/users` · `PATCH /admin/users/:id` · `POST /admin/users/:id/reset-password` · `GET /admin/users/:id/effective-access` | platform_admin, tenant_admin (trong tenant) |
| Group | `GET/POST /admin/groups` · `PATCH/DELETE /admin/groups/:id` · `POST/DELETE /admin/groups/:id/members` | platform_admin, tenant_admin |
| Catalog | `GET/POST /admin/workflows` · `PATCH/DELETE /admin/workflows/:id` · `GET /admin/workflows/:id/usages` | platform_admin |
| Command | `GET/POST /admin/commands` · `PATCH/DELETE /admin/commands/:id` · `POST /admin/commands/:id/test` | platform_admin |
| Feature | `GET/POST /admin/features` · `PATCH/DELETE /admin/features/:id` · `PUT/DELETE /admin/features/:id/entitlements/:tenant_id` | platform_admin |
| Grant | `GET/POST/DELETE /admin/grants` (feature × group/user) | tenant_admin, platform_admin |
| Quota & chi phí | `GET/PUT /admin/tenants/:id/quotas` · `GET /admin/usage?tenant&feature&from&to` (Admin đọc từ `hub.usage_logs`) | platform_admin; tenant_admin chỉ đọc tenant mình |
| Secret | `GET /admin/secrets` (chỉ trả tên và last4) · `PUT /admin/secrets/:name` | platform_admin |
| Khác | `GET /admin/audit` · `POST /admin/audit/:id/restore` · `GET /admin/export` · `POST /admin/import?dry_run=1` | platform_admin; tenant_admin chỉ đọc audit của tenant |

Mọi `PATCH` gửi kèm `version`; lệch thì trả `409 Conflict`. Endpoint `/test` của command nhận cấu hình nháp trong body và được Admin chuyển tiếp sang `POST hub/internal/test-run`, kèm service token và danh tính của admin đang thao tác. Cấp agent cho group được Admin UI gọi sang `hub/agent-grants` bằng JWT của tenant admin (Hub chỉ cho cấp agent đã được entitlement cho tenant đó).

## 9. Màn hình

| Màn hình | Nội dung chính |
|---|---|
| Đăng nhập / đổi mật khẩu | Form mã công ty + username + password. Nếu `must_change_password` thì chuyển sang màn đổi mật khẩu |
| Tổng quan | platform_admin: số tenant, command, workflow, user; tenant vượt quota. tenant_admin: số user, group, mức dùng quota tháng. Các thay đổi gần đây |
| Features | Bảng feature với trạng thái, số command, số tenant được entitlement. Editor gồm command bên trong và tab Cấp quyền |
| Commands | Bảng command. Form gồm chọn workflow, input map, feature, khu Test ở bên phải, tab "Ai dùng được" |
| Workflows | Bảng catalog với nhãn "Chưa gắn". Form có trình sửa input schema (mô tả bắt buộc). Cột "Đang được dùng bởi" (command, agent) |
| Tenants | Danh sách tenant, số user, feature và agent được entitlement, quota, giới hạn slot subscription. Khoá tenant |
| Users | Bảng user (lọc theo role/trạng thái/group). Tạo user, reset mật khẩu, khoá/mở. Tab "Quyền hiệu lực" |
| Groups | Thành viên, feature được cấp, agent được cấp |
| Phân quyền | Ma trận feature × group, công cụ Kiểm tra quyền |
| Chi phí & quota | KPI, thanh quota, biểu đồ theo ngày, top feature, export CSV |
| Secrets | Bảng tên, last4, ngày cập nhật. Nút "Thay giá trị" |
| Audit | Dòng thời gian thay đổi, xem diff trước/sau, nút Khôi phục |

## 10. Yêu cầu phi chức năng

| ID | Yêu cầu |
|---|---|
| ADM-NFR-01 | **Bảo mật:** mật khẩu hash bằng argon2id. Refresh token chỉ lưu dạng hash. JWT ký **EdDSA (Ed25519)**: Admin giữ private key, Hub verify bằng public key (xem ADR-0001). Master key mã hoá secret nằm trong env, không nằm trong DB |
| ADM-NFR-02 | **Lan truyền cấu hình và quyền:** Hub nhận được thay đổi trong vòng ≤ 5 giây sau khi lưu |
| ADM-NFR-03 | **Hiệu năng:** các trang CRUD phản hồi < 300ms với vài nghìn bản ghi (nhiều tenant). Báo cáo chi phí một tháng < 2 giây |
| ADM-NFR-04 | **Sẵn sàng:** Admin chết thì Hub vẫn chạy bằng cấu hình và quyền đang cache, và vẫn verify JWT được. Chỉ không đăng nhập mới được và không sửa cấu hình được |
| ADM-NFR-05 | **Truy cập:** Admin UI mở qua Internet cho tenant admin, bắt buộc HTTPS. API quản trị của `platform_admin` có thể giới hạn thêm theo IP/VPN |
| ADM-NFR-06 | **Migration:** schema được quản lý bằng migration có version. Có seed tạo tenant `platform`, feature `core` và `platform_admin` đầu tiên từ env |
| ADM-NFR-07 | **Cách ly tenant:** mọi truy vấn có `tenant_id` ở tầng repository, có test tự động chống truy cập chéo tenant |

## 11. Tiêu chí nghiệm thu (các kịch bản chính)

> **AC-A01 · Đăng nhập**
> Given user `an` của tenant `acme` đang active, When đăng nhập đúng mã công ty `acme` và mật khẩu, Then nhận access token (có `user_id`, `tenant_id`, `role`, hết hạn sau 15 phút) và refresh token.
> Given sai mật khẩu 5 lần, When thử lần thứ 6, Then bị từ chối với thông báo "tạm khoá đến HH:MM".

> **AC-A02 · Khoá user**
> Given user `an` đang đăng nhập trên Extension, When tenant admin khoá `an`, Then lần refresh tiếp theo thất bại, và chậm nhất sau 15 phút `an` mất quyền truy cập Hub.

> **AC-A03 · Tạo command**
> Given workflow `translate` có input bắt buộc `source_text`, `target_lang`, When tạo `/dich` mà chưa map `target_lang`, Then không lưu được và báo "thiếu input bắt buộc: target_lang".
> When map đủ, chọn feature `core` và lưu, Then trong ≤ 5 giây `/dich` xuất hiện trong menu `/` của mọi user.
> *Chia vế ([CR-011](../../CHANGE-REQUESTS.md)): M2 kiểm phía Admin (vế 1 và "lưu được"); vế "≤ 5 giây trong menu" đo ở Hub cùng NOTIFY `config_changed` (FR-53) ở M3.*

> **AC-A04 · Test command**
> Given `/dich` đã lưu, When bấm Test với `text="hello", lang="vi"`, Then hiện kết quả trả về từ Dify cùng thời gian chạy. Nếu key sai thì hiện rõ lỗi của Dify (không nuốt lỗi).

> **AC-A05 · Xoá workflow đang dùng**
> Given `/dich` và agent "Trợ lý dịch" đang dùng workflow `translate`, When xoá `translate`, Then bị chặn và hiện danh sách gồm cả command lẫn agent đang dùng.

> **AC-A06 · Secret**
> When gọi `GET /admin/secrets` hoặc export, Then kết quả chỉ có tên và last4, tuyệt đối không có giá trị thật.

> **AC-A07 · Hai admin cùng sửa**
> Given admin A và B cùng mở `/dich` (version 7), When B lưu trước (version 8) rồi A bấm Lưu, Then A nhận thông báo xung đột kèm diff giữa bản của A và bản 8. Bản của B không bị ghi đè âm thầm.

> **AC-A08 · Test bản nháp**
> Given đang sửa input map của `/dich` nhưng chưa lưu, When bấm Test, Then kết quả phản ánh input map mới, và người dùng Chat vẫn chạy bản cũ cho đến khi Lưu.

> **AC-A09 · Cách ly tenant**
> Given tenant admin của `acme`, When gọi `GET /admin/users/:id` với id của user thuộc tenant `globex`, Then nhận 404.

> **AC-A10 · Cấp feature theo group**
> Given feature "Kế toán" (gồm `/kiemtra-hoadon`) được entitlement cho `acme`, When tenant admin cấp "Kế toán" cho group "Kế toán", Then trong ≤ 5 giây thành viên group thấy `/kiemtra-hoadon`, còn user khác trong `acme` không thấy và gõ lệnh thì nhận `CMD_NOT_FOUND`.

> **AC-A11 · Thu hồi entitlement**
> Given grant ở AC-A10, When platform admin thu hồi entitlement "Kế toán" của `acme`, Then `/kiemtra-hoadon` biến khỏi menu của cả group. When cấp lại entitlement, Then grant cũ có hiệu lực trở lại mà không phải cấp lại.

> **AC-A12 · Vượt quota**
> Given `acme` có quota 1.000 run/tháng và đã dùng 999, When user chạy thêm 2 run, Then cả 2 run đều chạy; tenant admin nhận cảnh báo 100%; run thứ 1.001 được đánh dấu `overage` trong báo cáo.

> **AC-A13 · Workflow chưa gắn**
> When builder khai báo workflow `report-tax` mà không tạo command hay gắn agent nào, Then lưu được, workflow có nhãn "Chưa gắn", và không user nào thấy hay chạy được nó.

## 12. Ngoài phạm vi & câu hỏi mở

### Ngoài phạm vi v1

- SSO, OAuth. Tenant tự tạo command, workflow hoặc mang key riêng (BYOK).
- Group lồng nhau, đồng bộ group từ AD / Google Workspace.
- Chặn cứng khi vượt quota (v1 chỉ cảnh báo).
- Tạo workflow Dify từ Admin (việc này làm bằng Claude session).

### Câu hỏi mở

1. ~~JWT ký HS256 hay RS256?~~ Đã chốt 2026-10-01: **EdDSA (Ed25519)**.
2. Có cần môi trường nháp (draft/publish), hay lưu là áp dụng ngay, dựa vào Test và audit để khôi phục? v1 đang chọn lưu là áp dụng ngay.
3. Stack cụ thể (ngôn ngữ, framework UI) chưa chốt.
4. Kênh gửi cảnh báo quota ngoài email (webhook, Slack của tenant) có cần ở v1 không?
