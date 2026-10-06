---
spec: H4a-studio-shell-agents
part: frontend-copy
owner: frontend-lead
---

# Phụ lục plan-frontend H4a · Câu chữ VI/EN (nguyên văn)

Key trong namespace `studio` (`packages/i18n/locales/studio/{vi,en}.json`). Câu lỗi validate: plan-frontend §4.

| Key | VI | EN |
|---|---|---|
| app.name | ✦ Agent Studio | ✦ Agent Studio |
| nav.group.config / access / test / ops / system | Cấu hình agent / Truy cập / Thử nghiệm / Vận hành / Hệ thống | Agent configuration / Access / Testing / Operations / System |
| nav.overview, agents, orchestrator, tools, models, secrets, access, playground, runs, cost, jobs, audit, transfer | Tổng quan, Agents, Orchestrator, Tools, Models, Secrets, Quyền agent, Playground, Runs, Chi phí & usage, Jobs & Worker, Nhật ký thay đổi, Import / Export | Overview, Agents, Orchestrator, Tools, Models, Secrets, Agent access, Playground, Runs, Cost & usage, Jobs & Worker, Change log, Import / Export |
| soon / soonH4b / soonH4c | Sắp có / Sắp có (H4b) / Sắp có (H4c) | Coming soon / Coming soon (H4b) / Coming soon (H4c) |
| topbar.configBadge | hub config v{n} | hub config v{n} |
| topbar.toAdmin | ⇄ Admin | ⇄ Admin |
| user.logout / language | Đăng xuất / Ngôn ngữ | Sign out / Language |
| login.title / subtitle | Đăng nhập Agent Studio / Dành cho quản trị nền tảng. Dùng tài khoản Admin của bạn. | Sign in to Agent Studio / For platform administrators. Use your Admin account. |
| login.tenant / username / password / submit / submitting | Mã công ty / Tên đăng nhập / Mật khẩu / Đăng nhập / Đang đăng nhập… | Company code / Username / Password / Sign in / Signing in… |
| login.err.invalid / locked / tempLocked / network / server | Sai mã công ty, tên đăng nhập hoặc mật khẩu. / Tài khoản đã bị khoá. Liên hệ quản trị viên. / Tạm khoá đến {time} / Không kết nối được máy chủ. Hãy thử lại. / Có lỗi xảy ra, hãy thử lại sau (mã {code}). | Wrong company code, username or password. / Your account is locked. Contact your administrator. / Temporarily locked until {time} / Cannot reach the server. Please try again. / Something went wrong, please try again later (code {code}). |
| login.mustChange | Bạn cần đổi mật khẩu ở Admin trước khi vào Studio. | You need to change your password in Admin before using Studio. |
| login.totp.* | theo Admin `auth.login.totp.*` (chép chữ sang namespace studio) | idem |
| session.expired | Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại. | Your session has expired. Please sign in again. |
| forbidden.title / body / toChat | Bạn không có quyền vào Agent Studio / Agent Studio chỉ dành cho quản trị nền tảng (platform_admin). / Về Chat | You don't have access to Agent Studio / Agent Studio is only for platform administrators (platform_admin). / Back to Chat |
| notFound.title / back | Không tìm thấy trang / Về Agents | Page not found / Back to Agents |
| state.error.title / retry | Không tải được dữ liệu / Thử lại | Couldn't load data / Retry |
| agents.title / subtitle | Agents / Mỗi agent = runtime + model profile + system prompt + workflow được gắn làm tool. Orchestrator chỉ thấy agent mà user được cấp. | Agents / Each agent = runtime + model profile + system prompt + workflows attached as tools. The Orchestrator only sees agents the user is granted. |
| agents.create / createFirst | + Tạo agent / + Tạo agent đầu tiên | + Create agent / + Create first agent |
| agents.empty | Chưa có agent nào. Orchestrator sẽ tự trả lời mọi câu hỏi. | No agents yet. The Orchestrator will answer every question itself. |
| agents.noMatch / clearFilters | Không có agent nào khớp bộ lọc / Xoá bộ lọc | No agents match the filters / Clear filters |
| agents.search / filter.all / filter.off | Tìm agent / Tất cả / Đang tắt | Search agents / All / Disabled |
| agents.col.* | Agent / Runtime / Profile / Workflow / Tenant / Trạng thái / Thao tác | Agent / Runtime / Profile / Workflows / Tenants / Status / Actions |
| agents.badge.orch / orchTenants / notGranted / overlap | Orchestrator / Orchestrator · {n} tenant / Chưa cấp / Mô tả trùng ý | Orchestrator / Orchestrator · {n} tenants / Not granted / Overlapping description |
| agents.attention | {n} agent đang bật nhưng chưa cấp cho tenant nào: {keys} | {n} enabled agents are not granted to any tenant: {keys} |
| agents.menu.* | Nhân bản / Đặt làm Orchestrator / Thử trong Playground / Cấp cho tenant… / Bật / Tắt / Xoá | Duplicate / Set as Orchestrator / Try in Playground / Grant to tenant… / Enable / Disable / Delete |
| agents.orchLocked | Agent đang là Orchestrator, không tắt hoặc xoá được. | This agent is the Orchestrator; it can't be disabled or deleted. |
| agents.toast.disabled / undo / enabled | Đã tắt {name}. Orchestrator sẽ không còn chọn agent này. / Hoàn tác / Đã bật {name} | Disabled {name}. The Orchestrator will no longer pick this agent. / Undo / Enabled {name} |
| agents.delete.title / body / confirm | Xoá agent {key}? / Không khôi phục được. Agent đã có lịch sử chạy thì chỉ tắt được. / Xoá agent | Delete agent {key}? / This can't be undone. Agents with run history can only be disabled. / Delete agent |
| agents.toast.deleted | Đã xoá agent {key} | Deleted agent {key} |
| agents.setOrch.title / body / confirm | Đặt {name} làm Orchestrator mặc định? / Mọi tin nhắn của tenant không có bản riêng sẽ đi qua agent này. / Đặt làm Orchestrator | Set {name} as the default Orchestrator? / All messages of tenants without their own Orchestrator will go through this agent. / Set as Orchestrator |
| editor.titleNew / titleEdit / copySuffix | Tạo agent / Sửa agent / (bản sao) | Create agent / Edit agent / (copy) |
| editor.dirty / cancel / save / saving | Bản nháp chưa lưu / Huỷ / Lưu / Đang lưu… | Unsaved draft / Cancel / Save / Saving… |
| editor.tryRun / viewAsModel | Chạy thử / Xem như model thấy | Test run / View as the model sees it |
| editor.step1..5 | Thông tin / Runtime & model / Workflow được gắn làm tool / System prompt / Quyền | Details / Runtime & model / Workflows attached as tools / System prompt / Access |
| editor.field.* | Key / Tên hiển thị (VI) / Tên hiển thị (EN) / Mô tả cho Orchestrator / Runtime / Model profile / CLI / Tool có sẵn được phép / Dùng MCP / Thư mục làm việc / Timeout (giây) / Ngân sách token / System prompt / Bật agent | Key / Display name (VI) / Display name (EN) / Description for the Orchestrator / Runtime / Model profile / CLI / Allowed built-in tools / Use MCP / Working directory / Timeout (seconds) / Token budget / System prompt / Enable agent |
| editor.descHint / counter | Nói rõ khi nào dùng và khi nào không. Orchestrator chọn agent gần như chỉ dựa vào đoạn này. / {n} / 1000 | Say clearly when to use it and when not to. The Orchestrator picks agents almost only from this text. / {n} / 1000 |
| editor.keyLocked | Key không đổi được sau khi tạo. | The key can't be changed after creation. |
| editor.runtimeMissing | Chưa có Worker đăng ký runtime này — lưu được nhưng chưa chạy được. | No Worker has registered this runtime yet — you can save, but it won't run. |
| editor.cliNotReady | {cli} chưa chạy được tới khi có H2d. Lưu được để chuẩn bị trước. | {cli} won't run until H2d. You can save it to prepare. |
| editor.bash.warn / ack | Bash cho phép agent chạy lệnh hệ thống trên máy Worker. / Tôi hiểu agent chạy được lệnh hệ thống trên máy Worker | Bash lets the agent run system commands on the Worker machine. / I understand the agent can run system commands on the Worker machine |
| editor.cwdHint | Agent chỉ đọc/ghi trong thư mục làm việc của job. Thư mục home, ổ Windows và job khác luôn bị chặn. | The agent can only read/write in the job's working directory. Home, Windows drives and other jobs are always blocked. |
| editor.wf.add / remove / hint / empty / pickerTitle / pickerSearch / pickerEmpty / attach | + Gắn workflow từ catalog / Gỡ / Tên và mô tả tool lấy từ workflow ở Admin. Muốn sửa mô tả thì sửa ở Admin › Workflows ↗ / Chưa gắn workflow nào. / Chọn workflow từ catalog / Tìm theo key hoặc tên / Catalog chưa có workflow nào đang bật. Workflow được tạo ở Admin. / Gắn | + Attach workflow from catalog / Remove / Tool name and description come from the workflow in Admin. To edit the description, go to Admin › Workflows ↗ / No workflows attached. / Choose a workflow from the catalog / Search by key or name / The catalog has no enabled workflows. Workflows are created in Admin. / Attach |
| editor.wf.needOne | Agent cần một workflow | The agent needs a workflow |
| editor.access.count / manage | Đã cấp cho {n} tenant. Tenant admin tự cấp cho group trong Admin › Groups. / Quản lý quyền agent | Granted to {n} tenants. Tenant admins grant groups in Admin › Groups. / Manage agent access |
| editor.orchView.title / hint / ok / overlap | Xem như Orchestrator thấy / Đoạn Orchestrator nhận về agent này, đặt cạnh các agent khác để soát mô tả trùng ý. / Không thấy mô tả trùng ý / Trùng ý với {key} ({pct}%) | View as the Orchestrator sees it / What the Orchestrator receives about this agent, next to other agents, to spot overlapping descriptions. / No overlapping descriptions / Overlaps with {key} ({pct}%) |
| editor.toast.saved / notGranted | Đã lưu agent · hub config v{n} / Chưa tenant nào dùng được agent này. | Agent saved · hub config v{n} / No tenant can use this agent yet. |
| orch.title / subtitle | Orchestrator / Agent nhận mọi tin nhắn, chọn agent chuyên trách (delegate), tự trả lời (answer) hoặc hỏi lại (ask). Tin bắt đầu bằng @agent đi thẳng tới agent đó. | Orchestrator / The agent that receives every message and delegates to a specialist agent, answers itself, or asks back. Messages starting with @agent go straight to that agent. |
| orch.default / field.* | Cấu hình mặc định / Agent làm Orchestrator / Số bước tối đa / Ngân sách token / run / Số tin lịch sử / Không có agent nào phù hợp | Default configuration / Orchestrator agent / Max steps / Token budget per run / History messages / When no agent fits |
| orch.noMatch.answer / ask | Tự trả lời (chat chung) / Hỏi lại người dùng | Answer itself (general chat) / Ask the user |
| orch.slow | Chậm: mỗi quyết định khởi động CLI vài giây và chiếm slot subscription. Khi có API key, nên chuyển sang runtime llm với model rẻ. | Slow: each decision starts the CLI for a few seconds and takes a subscription slot. With an API key, prefer an llm runtime with a cheap model. |
| orch.tenants.title / add / defaultRow / empty / note | Orchestrator theo tenant / + Thêm cho tenant / Mặc định (toàn hệ thống) / Chưa tenant nào có Orchestrator riêng. / Hub chọn bản của tenant trước, không có thì dùng mặc định. | Orchestrator per tenant / + Add for tenant / Default (system-wide) / No tenant has its own Orchestrator yet. / The Hub uses the tenant's own Orchestrator first, otherwise the default. |
| orch.tenants.col.* / edit / delete | Tenant / Agent / Số bước / Cập nhật / Thao tác · Sửa · Xoá | Tenant / Agent / Steps / Updated / Actions · Edit · Delete |
| orch.sheet.titleNew / titleEdit / tenant | Thêm Orchestrator cho tenant / Sửa Orchestrator của {tenant} / Tenant | Add Orchestrator for a tenant / Edit {tenant}'s Orchestrator / Tenant |
| orch.delete.title / body / confirm | Xoá Orchestrator của {tenant}? / Tenant sẽ quay về dùng bản mặc định. / Xoá | Delete {tenant}'s Orchestrator? / The tenant will go back to the default. / Delete |
| orch.toast.saved / deleted | Đã lưu Orchestrator · hub config v{n} / Đã xoá Orchestrator của {tenant} | Orchestrator saved · hub config v{n} / Deleted {tenant}'s Orchestrator |
| conflict.* | chép cấu trúc Admin `conflict.*` (title, body, Xem khác biệt / Ghi đè / Tải bản mới); entity: agent / Orchestrator | idem |
| unsaved.* | Bỏ thay đổi chưa lưu? / Rời trang / Ở lại | Discard unsaved changes? / Leave / Stay |
| offline.banner | Mất kết nối, thay đổi chưa được lưu | Connection lost, changes not saved |

**Lỗi theo mã** (`studio.errors.<CODE>`; mã lạ → `login.err.server`):
| Mã | VI | EN |
|---|---|---|
| FORBIDDEN | Bạn không còn quyền thực hiện thao tác này | You no longer have permission to do this |
| VERSION_CONFLICT | (ConflictDialog) | (ConflictDialog) |
| INVALID_REFERENCE `{field}` | Dữ liệu chọn đã bị đổi hoặc không còn hợp lệ ({field}). Tải lại và chọn lại. | The selected item changed or is no longer valid ({field}). Reload and choose again. |
| BASH_ACK_REQUIRED | Xác nhận bạn hiểu rủi ro khi bật Bash | Confirm you understand the risk of enabling Bash |
| AGENT_IN_USE_AS_ORCHESTRATOR | Agent đang là Orchestrator. Chọn agent khác làm Orchestrator trước. | This agent is the Orchestrator. Choose another Orchestrator first. |
| AGENT_HAS_HISTORY | Agent đã có lịch sử chạy nên không xoá được. Hãy tắt agent thay vì xoá. | This agent has run history and can't be deleted. Disable it instead. |
| AGENT_HAS_ACCESS | Agent vẫn đang được cấp cho tenant/group. Thu hồi quyền trước khi xoá. | This agent is still granted to tenants/groups. Revoke access before deleting. |
| ORCHESTRATOR_EXISTS | Tenant này đã có Orchestrator riêng. | This tenant already has its own Orchestrator. |
| NOT_FOUND | Mục này không tồn tại hoặc đã bị xoá. | This item doesn't exist or was deleted. |
| VALIDATION_ERROR `{fields}` | gắn vào từng trường theo §4; không map được → "Dữ liệu chưa hợp lệ, kiểm tra lại các trường." | attach per field; fallback "Some fields are invalid, please check." |

