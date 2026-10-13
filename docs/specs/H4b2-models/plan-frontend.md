---
spec: H4b2-models
part: frontend
owner: frontend-lead
status: draft (lỗ hổng readiness lần 1 đã đóng 2026-10-13)
requirements: [HUB-FR-66, HUB-FR-67, HUB-FR-78, HUB-BR-17, AC-H04, AC-H4b2-01, AC-H4b2-02, AC-H4b2-03, AC-H4b2-04, AC-H4b2-05]
---

# Plan frontend · H4b-2 · Studio → Models + Quyền agent (`apps/studio-web`)

Nguồn: spec §1/§2/§5 · ui-agent-studio §8, §9, F3, F5 · artboard `Models.dc.html`, `Access.dc.html` + mockup **đã duyệt 2026-10-13** (`canvas/H4b2-Provider-Sheet|Check|Runbook|States.dc.html`) · mẫu code: `features/secrets` (Sheet, ConfirmDialog, InUseDialog), `features/orchestrator`, `components/shared/conflict/ConflictDialog` · H4a `plan-frontend.md` D1–D12 và H4b-1 D4/D8 vẫn đúng. **Contract = spec §3** (backend-lead chốt); mục 8 đối chiếu C1–C7 với contract.

## 0. Quyết định
| # | Quyết định | Lý do |
|---|---|---|
| D1 | Không thêm thư viện, không ADR. StepsEditor **chỉ có nút Lên/Xuống**, không kéo-thả (ghi `docs/TECH-DEBT.md` #162) | tối giản |
| D2 | Hai route lazy: `/models` (`?tab=providers\|profiles`, `?drawer=`, `?guide=`) và `/access`. Tab Đơn giá **không hiện** (ngoài phạm vi, Q1) | spec §1 |
| D3 | **Kiểm tra key / Kiểm tra lại = một request đồng bộ** `POST /providers/:id/check` (≤ 10 s, Q3), hiện trong `dialog "Kết quả kiểm tra · {key}"`: đang chạy → đạt / lỗi / chưa hỗ trợ / đã yêu cầu. Không polling. `ok = status==='ok'`, `supported = status!=='unsupported'`. Ánh xạ kết quả → câu chữ: bảng "check.* theo kết quả" ở §3. 409 `PROVIDER_READONLY` hoặc 404 khi gọi check → đóng hộp, toast `errors.PROVIDER_READONLY`/`errors.NOT_FOUND`, refetch danh sách; 409 `NOT_CONFIGURED` → toast "Hub chưa cấu hình HUB_SECRETS_KEY" (không mở hộp). Lỗi nguyên văn của hãng nằm trong `<details open> "Chi tiết"` dạng `pre`; FE không bao giờ hiện hay giữ giá trị key | AC-H4b2-02 |
| D4 | SecretField = `select` secret `provider_api_key` (đã lưu ở Secrets); Sheet **Sửa** gọi `GET /providers/:id` lấy `secret`, `version`, `state.last_error` (chỉ có ở chi tiết, không ở list) + link "Tạo secret" → `/secrets?kind=provider_api_key&drawer=new`; theo mẫu K1 Sheet. Không có ô nhập giá trị nên không áp D4 H4b-1 | HUB-FR-66 |
| D5 | `Loại` chỉ chọn lúc tạo, sau đó chỉ đọc. Sheet theo loại: `api` → Hãng, Base URL, API key, Bật; `subscription-cli` → Hãng, Số slot tối đa, Bật, link "Hướng dẫn đăng nhập" | UI §8 |
| D6 | Runbook (F3) là Sheet tĩnh: 3 bước + nút Sao chép (`navigator.clipboard`), lệnh theo hãng nằm trong i18n (`anthropic: claude login`, `openai: codex login`, `google: gemini`); hãng khác → bước 2 ghi "Xem runbook Worker". Không cần contract | UI F3 |
| D7 | Dòng "Lúc này sẽ chạy bằng…" của Profile lấy `active_step` **của server** (`GET /model-profiles`), không tự suy (cùng luật `pickStep`); `null` → `profile.liveNone`. Agent có model riêng thì **không dự phòng** (người dùng chốt 2026-10-13): server chỉ xét bước 0, FE chỉ hiện `active_step`. Cảnh báo vàng khi `all_subscription` (HUB-FR-67). Slot hiển thị = `slots_in_use/max_concurrency` | spec §2, §3.B |
| D8 | Xoá provider: **luôn** mở `alertdialog "Xoá {key}?"` rồi gọi `DELETE ?version=N`; `409 PROVIDER_IN_USE` → `alertdialog "Không xoá được {key}"` kèm badge `details.profiles[].key` (mẫu InUseDialog); `PROVIDER_HAS_HISTORY`/`PROVIDER_READONLY` → toast theo key `errors.*`. Sheet đóng sau khi lưu thành công. Tắt provider = công tắc `Bật` trong Sheet | Q2 |
| D9 | Ma trận Quyền agent: ô là `switch` (bật = cấp entitlement; tắt = mở ConfirmDialog thu hồi nêu "N grant", N lấy từ ô). **Hàng = agent, cột = tenant** (theo `Access.dc.html`). Click phần số/tên ô mở drawer xem (chỉ đọc). Cấp (bật) không cần xác nhận; cập nhật lạc quan, lỗi thì hoàn về và toast. Ô có `agent.only_tenant_id` khác tenant của cột: **không có switch**, hiện "—" (`title` "Chỉ dùng cho {tenant}"). 409 `AGENT_IS_DEFAULT` → toast `access.errors.isDefault`, switch hoàn về, **không refetch**. `truncated` → dòng "Chỉ hiện 200 đầu tiên. Dùng bộ lọc." | UI §9 |
| D10 | Mọi ghi: invalidate `["me"]` để ConfigBadge đổi vN (như H4b-1 D9). 409 phiên bản (provider/profile) → `ConflictDialog` dùng chung có "Xem khác biệt" ẩn (như H4b-1 D8). Ma trận 409 `VERSION_CONFLICT` → toast + refetch (riêng `AGENT_IS_DEFAULT` xem D9) | H4a |
| D11 | Hàng agent đang tắt: tiêu đề mờ + chú thích "Hàng agent đang tắt"; tenant `active=false`: cột mờ, switch vẫn dùng được | UI §9 |
| D12 | Mất mạng: `OfflineBanner` của khung. Trạng thái rỗng/lỗi/không quyền theo mockup `States.dc.html` | CONVENTIONS |

## 1. Cấu trúc
```
src/routes/_authed/models.tsx · access.tsx          lazy; validateSearch
src/features/models/api.ts      providers + profiles + check (đường dẫn tương đối /studio/api)
  hooks/{use-providers,use-profiles,use-provider-mutations,use-check-provider}.ts
  components/{ProviderTable,ProviderSheet,CheckDialog,RunbookSheet,InUseDialog,ProfileList,StepsEditor,LiveSummary}.tsx
  pages/ModelsPage.tsx · README.md
src/features/access/api.ts      ma trận + drawer + cấp/thu hồi
  components/{AccessMatrix,CellDrawer,RevokeDialog}.tsx · pages/AccessPage.tsx · README.md
src/features/shell/lib/nav.ts   models, access: soon → link
```
Mỗi component ≤ 200 dòng; `StepsEditor` tách `StepRow`. Bước cũ có `model = null`: ô Model để trống, bắt nhập khi lưu.

## 2. Màn hình
| Màn | Bố cục | Đang tải | Rỗng | Lỗi | Không quyền / 409 |
|---|---|---|---|---|---|
| Providers | Artboard `Models.dc.html`: `table "Danh sách provider"` cột Provider · Loại · Hãng · Trạng thái · Slot · Ghi chú · Thao tác. Thao tác: `api` [Kiểm tra key] [Sửa]; subscription [Kiểm tra lại] [Hướng dẫn] (khi `logged_out`/`error`) [Sửa]; [Xoá] | Skeleton 4 dòng `aria-busy` | EmptyState + [+ Thêm provider] | `ErrorState` + [Thử lại] | 403 → EmptyState quyền; xoá 409 → D8; lưu 409 → D10 |
| Provider Sheet | `Provider-Sheet.dc.html`; footer [Huỷ] [Lưu] | "Đang lưu…" disabled | — | lỗi trường dưới ô; lỗi khác toast | `KEY_TAKEN` → dưới `Khoá provider` |
| Kiểm tra | `Check.dc.html`; nút [Kiểm tra lại] trong hộp chạy lại cùng request | `status` "Đang kiểm tra key…" (subscription: "Đang kiểm tra phiên đăng nhập…") `aria-busy`, [Đóng] disabled | — | theo bảng "check.* theo kết quả" §3 | `unsupported` → "Chưa hỗ trợ kiểm tra cho hãng này" |
| Runbook | `Runbook.dc.html` | — | — | — | — |
| Profiles | Artboard `Models.dc.html`: danh sách trái + StepsEditor phải; [Lưu profile] ở đầu StepsEditor, bật khi có thay đổi | skeleton | EmptyState + [+ Profile mới] | ErrorState | lưu 409 → D10; bước chỉ-subscription → cảnh báo vàng |
| Quyền agent | Artboard `Access.dc.html` (hàng agent × cột tenant); lọc `combobox "Lọc theo agent"` / `"Lọc theo tenant"`; drawer `dialog "Chi tiết {agent} × {tenant}"` | skeleton lưới | "Chưa có agent để cấp" | ErrorState | thu hồi: `alertdialog "Thu hồi {agent} khỏi {tenant}?"` |

## 3. Câu chữ (key `models.*`, `access.*` trong `packages/i18n/locales/studio/{vi,en}.json`)
| Key | VI | EN |
|---|---|---|
| models.title / subtitle | "Models" / "Provider là nơi gọi model (API hoặc CLI subscription). Profile là chuỗi bước dự phòng; agent chỉ trỏ tới profile." | "Models" / "A provider is where models are called (API or CLI subscription). A profile is a fallback chain; agents only point to a profile." |
| tab.providers / profiles / aria | "Providers" / "Profiles" / "Models" | "Providers" / "Profiles" / "Models" |
| provider.add / table.aria | "+ Thêm provider" / "Danh sách provider" | "+ Add provider" / "Provider list" |
| provider.kind.api / sub | "API" / "Subscription" | "API" / "Subscription" |
| provider.col.* | "Provider" "Loại" "Hãng" "Trạng thái" "Slot" "Ghi chú" "Thao tác" | "Provider" "Type" "Vendor" "Status" "Slots" "Notes" "Actions" |
| provider.status.ok/busy/cooldown/error/logged_out/none | "ok" "bận" "cooldown" "lỗi" "hết phiên" "Chưa có Worker kiểm" | "ok" "busy" "cooldown" "error" "logged out" "Not checked by a Worker yet" |
| provider.vendor.anthropic/openai/google/fake | "Anthropic" "OpenAI" "Google" "Fake (dev)" | same |
| provider.note.dev | "dev" (cột Ghi chú khi `dev_only`; cooldown dùng `provider.cooldownUntil`) | "dev" |
| provider.cooldownUntil | "Mở lại sau {min} phút ({time})" (`{time}` = HH:mm:ss theo locale) | "Reopens in {min} min ({time})" |
| provider.action.check / recheck / guide / edit / delete | "Kiểm tra key" / "Kiểm tra lại" / "Hướng dẫn" / "Sửa" / "Xoá" | "Check key" / "Check again" / "Guide" / "Edit" / "Delete" |
| provider.sheet.create / edit | "Thêm provider" / "Sửa provider · {key}" | "Add provider" / "Edit provider · {key}" |
| provider.field.key / kind / vendor / baseUrl / secret / slots / enabled | "Khoá provider" "Loại" "Hãng" "Base URL (tuỳ chọn)" "API key" "Số slot tối đa" "Bật provider" | "Provider key" "Type" "Vendor" "Base URL (optional)" "API key" "Max slots" "Enable provider" |
| provider.field.secretHint | "Chọn secret loại Provider API key đã lưu ở màn Secrets. Không hiện giá trị." | "Pick a Provider API key secret saved on the Secrets screen. The value is never shown." |
| provider.field.subKeyHint | "Khoá phải trùng provider đã cài ở Worker (xem runbook)" | "The key must match the provider installed on the Worker (see runbook)" |
| provider.field.createSecret / kindLocked / slotsHint | "Tạo secret" / "không đổi được sau khi tạo" / "Dùng chung cho mọi tenant. Giới hạn theo tenant đặt ở Admin." | "Create secret" / "cannot change after creation" / "Shared by all tenants. Per-tenant limits are set in Admin." |
| provider.toast.saved / deleted | "Đã lưu {key}" / "Đã xoá {key}" | "Saved {key}" / "Deleted {key}" |
| provider.delete.title / body / confirm | "Xoá {key}?" / "Provider sẽ bị xoá." / "Xoá" | "Delete {key}?" / "The provider will be deleted." / "Delete" |
| provider.inUse.title / body | "Không xoá được {key}" / "Provider đang là bước của các profile sau. Gỡ bước, hoặc chỉ tắt provider." | "Cannot delete {key}" / "The provider is a step in the profiles below. Remove the step, or just disable the provider." |
| check.title | "Kết quả kiểm tra · {key}" | "Check result · {key}" |
| check.running / ok / fail / unsupported / timeout | "Đang kiểm tra key…" / "Key hợp lệ" / "Key không hợp lệ" / "Chưa hỗ trợ kiểm tra cho hãng này" / "Không kết nối được tới hãng trong 10 giây" | "Checking key…" / "Key is valid" / "Key is invalid" / "Check is not supported for this vendor" / "Could not reach the vendor within 10 seconds" |
| check.* theo kết quả | `auth_failed` "Key không hợp lệ" · `http_error` "Hãng trả lỗi HTTP {status}" · `timeout` = `check.timeout` · `network` "Không kết nối được tới hãng" · `secret_unreadable` "Không đọc được secret. Lưu lại API key ở Secrets" · `requested` "Đã yêu cầu kiểm tra. Worker chưa kiểm xong, thử lại sau ít phút" · subscription đang chạy "Đang kiểm tra phiên đăng nhập…" | `auth_failed` "Key is invalid" · `http_error` "Vendor returned HTTP {status}" · `timeout` = `check.timeout` · `network` "Could not reach the vendor" · `secret_unreadable` "Could not read the secret. Save the API key again in Secrets" · `requested` "Check requested. The Worker has not finished yet, try again in a few minutes" · "Checking login session…" |
| errors.NOT_CONFIGURED (toast) | "Hub chưa cấu hình HUB_SECRETS_KEY" | "The Hub has no HUB_SECRETS_KEY configured" |
| check.okSub / failSub | "Kiểm tra lại: phiên đăng nhập hợp lệ" / "Phiên đăng nhập chưa hợp lệ" (loại subscription thay "Key") | "Login session is valid" / "Login session is not valid" |
| check.checkedAt / details / again / close | "Kiểm lúc {time}" / "Chi tiết" / "Kiểm tra lại" / "Đóng" | "Checked at {time}" / "Details" / "Check again" / "Close" |
| guide.title / lead | "Đăng nhập CLI · {key}" / "Hết phiên đăng nhập. Trong lúc chờ, profile tự dự phòng sang bước kế." | "CLI login · {key}" / "The login session expired. Meanwhile profiles fall back to the next step." |
| guide.cmd1 | `ssh <user>@<worker-host>` (lệnh bước 1, có nút Sao chép) | same |
| guide.step1 / step2 / step3 | "SSH vào máy Worker" / "Chạy lệnh đăng nhập" / "Bấm Kiểm tra lại" | "SSH into the Worker machine" / "Run the login command" / "Click Check again" |
| guide.copy / copied / note | "Sao chép" / "Đã sao chép" / "Hub không đăng nhập thay bạn. Nội dung lấy từ runbook Worker." | "Copy" / "Copied" / "The Hub does not sign in for you. Content comes from the Worker runbook." |
| profile.add / save / saved / steps / addStep | "+ Profile mới" / "Lưu profile" / "Đã lưu profile {key}" / "Các bước" / "+ Thêm bước" | "+ New profile" / "Save profile" / "Saved profile {key}" / "Steps" / "+ Add step" |
| profile.field.name / provider / model / on | "Tên profile" "Provider" "Model" "Chuyển bước kế khi" | "Profile name" "Provider" "Model" "Fall back when" |
| profile.on.error / quota / timeout | "lỗi" / "hết quota" / "quá giờ" | "error" / "quota" / "timeout" |
| profile.live | "Lúc này sẽ chạy bằng bước {n} · {key}" (n = `active_step`+1 của server; không tự suy) | "Currently runs on step {n} · {key}" |
| profile.liveNone | "Hiện không bước nào sẵn sàng" | "No step is ready right now" |
| profile.subOnly | "Profile này chỉ có bước subscription. Hết slot hoặc cooldown thì chạy lỗi ALL_PROVIDERS_EXHAUSTED. Chỉ nên dùng cho dev/test." | same meaning in EN |
| state.empty.providers / profiles / agents | "Chưa có provider nào" / "Chưa có profile nào" / "Chưa có agent để cấp" | "No providers yet" / "No profiles yet" / "No agents to grant" |
| state.error / retry / forbidden | "Không tải được dữ liệu" / "Thử lại" / "Bạn không có quyền xem mục này" | "Could not load data" / "Retry" / "You don't have permission to view this" |
| access.title / subtitle | "Quyền agent" / "Tenant nào được có agent nào. Grant cho group/user do tenant admin cấp ở Admin › Groups." | "Agent access" / "Which tenants may use which agents. Grants for groups/users are set by tenant admins in Admin › Groups." |
| access.matrix.aria / cell.label / cell.na / truncated | "Ma trận quyền agent" / "{agent} × {tenant}" (`agent.key` × `tenant.key`; nhãn accessible của switch; **không** có `cell.on/off`) / "Chỉ dùng cho {tenant}" (title của "—") / "Chỉ hiện 200 đầu tiên. Dùng bộ lọc." | "Agent access matrix" / "{agent} × {tenant}" / "Only for {tenant}" / "Showing the first 200 only. Use the filters." |
| access.cell.count | "{n} grant" | "{n} grants" |
| access.agentOff | "Hàng agent đang tắt" | "Agent row is off" |
| access.filter.agent / tenant / all | "Lọc theo agent" / "Lọc theo tenant" / "Tất cả" | "Filter by agent" / "Filter by tenant" / "All" |
| access.drawer.title / grantedAt / grantedBy / grants / note | "Chi tiết {agent} × {tenant}" / "Ngày cấp" / "Người cấp" / "Grant trong tenant" / "Grant do tenant_admin cấp trong Admin › Groups." | "Details {agent} × {tenant}" / "Granted on" / "Granted by" / "Grants in tenant" / "Grants are set by tenant_admin in Admin › Groups." |
| access.revoke.title / body / confirm | "Thu hồi {agent} khỏi {tenant}?" / "{n} grant trong tenant {tenant} sẽ mất hiệu lực. Grant được giữ lại và tự có hiệu lực khi cấp lại. Run đang chạy vẫn xong." / "Thu hồi" | "Revoke {agent} from {tenant}?" / "{n} grants in tenant {tenant} will stop working. Grants are kept and work again when re-granted. Running runs finish." / "Revoke" |
| access.toast.granted / revoked | "Đã cấp {agent} cho {tenant}" / "Đã thu hồi {agent} khỏi {tenant}" | "Granted {agent} to {tenant}" / "Revoked {agent} from {tenant}" |
| access.errors.isDefault | "Agent đang là mặc định của tenant này. Đổi mặc định ở Admin trước khi thu hồi." | "This agent is the tenant default. Change the default in Admin before revoking." |
| access.errors.conflict | "Quyền vừa được thay đổi. Đã tải lại ma trận." | "Access was just changed. The matrix has been reloaded." |
Lỗi API: `errors.PROVIDER_IN_USE`, `errors.PROVIDER_HAS_HISTORY`, `errors.PROVIDER_READONLY`, `errors.PROFILE_IN_USE`, `errors.KEY_TAKEN` ("Khoá này đã được dùng" / "This key is already used"), dùng lại `errors.FORBIDDEN`, `conflict.*`.

## 4. Validate client (zod; khớp contract khi chốt)
| Trường | Luật | VI | EN |
|---|---|---|---|
| Khoá provider (tạo) | `ProviderKeySchema` `^[a-z][a-z0-9-]{1,47}$` | "Bắt đầu bằng chữ thường; chỉ chữ thường, số và - (2–48 ký tự)" | "Start with a lowercase letter; only lowercase letters, digits and - (2–48 characters)" |
| Hãng | bắt buộc | "Chọn hãng" | "Choose a vendor" |
| API key (loại api) | bắt buộc chọn secret | "Chọn API key" | "Choose an API key" |
| Base URL | trống hoặc URL `https?://` | "Địa chỉ không hợp lệ" | "Invalid URL" |
| Số slot tối đa | số nguyên 1–100 | "Nhập số nguyên từ 1 đến 100" | "Enter an integer from 1 to 100" |
| Tên profile | `ProviderKeySchema` | như Khoá provider | như Khoá provider |
| Bước | 1–5; mỗi bước có provider + model **bắt buộc 1–100 ký tự** (bước cũ `model=null` → ô trống, bắt nhập khi lưu) | "Cần ít nhất một bước" / "Nhập model (1–100 ký tự)" | "At least one step is required" / "Enter a model (1–100 characters)" |
400 `VALIDATION_ERROR` `details.issues[{path}]` gắn đúng trường như H4a.

## 5. Role + nhãn cho e2e (VI; giữ nguyên khi code)
| Phần tử | Role · nhãn |
|---|---|
| Menu | `link "Models"`, `link "Quyền agent"` trong `navigation "Menu Studio"` |
| Models | `heading "Models"` · `tablist "Models"` với `tab "Providers"`, `tab "Profiles"` · `button "+ Thêm provider"` · `table "Danh sách provider"`, `row` chứa key; trong dòng `button "Kiểm tra key"` / `"Kiểm tra lại"` / `"Hướng dẫn"` / `"Sửa"` / `"Xoá"`, `status` trạng thái |
| Provider Sheet | `dialog "Thêm provider"` / `"Sửa provider · {key}"` · `textbox "Khoá provider"` (tạo) · `combobox "Loại"` (tạo) · `combobox "Hãng"` · `combobox "API key"` · `textbox "Base URL (tuỳ chọn)"` · `spinbutton "Số slot tối đa"` · `checkbox "Bật provider"` · `link "Tạo secret"` · `button "Lưu"` `button "Huỷ"` |
| Kiểm tra | `dialog "Kết quả kiểm tra · {key}"` · `status` ("Đang kiểm tra key…" / "Key hợp lệ" / "Key không hợp lệ" / "Chưa hỗ trợ kiểm tra cho hãng này") · `group "Chi tiết"` (details) · `button "Kiểm tra lại"` `button "Đóng"` |
| Runbook | `dialog "Đăng nhập CLI · {key}"` · `button "Sao chép lệnh bước 1"`, `"Sao chép lệnh bước 2"` · `button "Kiểm tra lại"` `button "Đóng"` |
| Xoá | `alertdialog "Xoá {key}?"` (`button "Huỷ"`, `button "Xoá"`) · đang dùng: `alertdialog "Không xoá được {key}"` + badge tên profile + `button "Đóng"` |
| Profiles | `list "Danh sách profile"` (mỗi `link` = tên) · `button "+ Profile mới"` · `textbox "Tên profile"` · `list "Các bước"`, mỗi `listitem` có `combobox "Provider"`, `textbox "Model"`, `group "Chuyển bước kế khi"` (3 `checkbox` lỗi/hết quota/quá giờ), `button "Lên"`, `button "Xuống"`, `button "Xoá bước"` · `button "+ Thêm bước"` · `button "Lưu profile"` · `status` "Lúc này sẽ chạy bằng…" |
| Quyền agent | `heading "Quyền agent"` · `table "Ma trận quyền agent"`; hàng = agent, cột = tenant; mỗi ô `switch "{agent.key} × {tenant.key}"` (aria-checked; ô `only_tenant_id` không có switch, chỉ "—") · `combobox "Lọc theo agent"`, `combobox "Lọc theo tenant"` · `button "Chi tiết {agent.key} × {tenant.key}"` mở drawer · `dialog "Chi tiết {agent} × {tenant}"` (+ `button "Đóng"`) · `alertdialog "Thu hồi {agent} khỏi {tenant}?"` (`button "Huỷ"`, `button "Thu hồi"`) |
| Không có | không element hiện giá trị key; DOM không chứa key sau "Kiểm tra key" |

## 6. Accessibility
Sheet/Dialog trả focus về nút gọi; `Kết quả kiểm tra` là `status` `aria-live=polite`, trạng thái không chỉ dựa màu (có chữ); công tắc ma trận là `button role=switch` có nhãn đủ; chỉ nút Lên/Xuống (bàn phím), không kéo-thả; copy báo bằng `status`; tương phản ≥ 4.5:1 theo token.

## 7. Hiệu năng
Hai chunk lazy, ước ≤ 14 KB gzip tổng (không chặn mốc). Ma trận: số agent × tenant nhỏ, không virtualize; `AccessCell` memo theo `(agentId, tenantId, on, count)`. Bảng provider poll trạng thái sống `refetchInterval` 10 s khi tab hiển thị (tạm dừng khi ẩn).

## 8. Đối chiếu đề nghị C1–C7 với contract spec §3 (backend-lead đã chốt)
| # | Đề nghị | Dùng cho |
|---|---|---|
| C1 | **Đã chốt khác**: list có `version`, `slots_in_use`, `has_secret`, state; `secret`, `state.last_error`, `used_by_profiles` chỉ ở `GET /providers/:id` (Sheet Sửa gọi) | Bảng, Sheet |
| C2 | `POST/PUT/DELETE /providers`, tối giản; `PUT` có `version` (409 `VERSION_CONFLICT`); `DELETE` 409 `PROVIDER_IN_USE` với `details.profiles:[{id,name}]`; 409 `KEY_TAKEN` | Sheet, D8 |
| C3 | **Đã chốt**: `{status: ok\|error\|unsupported\|requested, error_code, http_status, message, latency_ms, checked_at}`; FE suy `supported`/`ok` (D3) | CheckDialog |
| C4 | `GET/POST/PUT/DELETE /model-profiles` `steps` theo `ProfileStepSchema`, kèm `version`, `agent_count`, `active_step`, `all_subscription` | Profiles |
| C5 | `GET /agent-entitlements` → `{agents:[{id,name,enabled}],tenants:[{id,name}],cells:[{agent_id,tenant_id,granted_at,granted_by,grant_count}]}` (chỉ ô đã cấp; chưa cấp không có trong `cells`) | Ma trận |
| C6 | `PUT /agent-entitlements/:agent_id/:tenant_id` (cấp, idempotent) · `DELETE` (thu hồi, trả `{affected_grants:n}`) | Cấp/thu hồi |
| C7 | `GET /agent-entitlements/:agent_id/:tenant_id/grants` → `[{subject_type:"group"\|"user",subject_name,granted_by,granted_at}]` | Drawer |
C5–C7: path nhận; drawer gộp grants vào `GET /agent-entitlements/:agent_id/:tenant_id`; cell có `grants:{group,user,tenant}`, agent có `is_orchestrator`/`only_tenant_id`. Hình chính xác: spec §3, không chép lại.

## 9. Đối chiếu AC
| AC | FE chứng minh bằng |
|---|---|
| AC-H4b2-01 | Sheet tạo provider api chọn secret → dòng trong bảng; DOM không có giá trị key |
| AC-H4b2-02 | CheckDialog lỗi/ok + `group "Chi tiết"` |
| AC-H4b2-03 | StepsEditor Lên/Xuống + lưu; `alertdialog "Không xoá được…"` có tên profile |
| AC-H4b2-04 / 05 | switch ma trận bật; thu hồi nêu "{n} grant" |
