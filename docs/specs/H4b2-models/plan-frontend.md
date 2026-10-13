---
spec: H4b2-models
part: frontend
owner: frontend-lead
status: draft
requirements: [HUB-FR-66, HUB-FR-67, HUB-FR-78, HUB-BR-17, AC-H04, AC-H4b2-01, AC-H4b2-02, AC-H4b2-03, AC-H4b2-04, AC-H4b2-05]
---

# Plan frontend · H4b-2 · Studio → Models + Quyền agent (`apps/studio-web`)

Nguồn: spec §1/§2/§5 · ui-agent-studio §8, §9, F3, F5 · artboard `Models.dc.html`, `Access.dc.html` + mockup mới (Provider-Sheet, Check, Runbook, States; ở scratchpad, sau Gate chép vào `docs/design/agent-hub/canvas/`) · mẫu code: `features/secrets` (Sheet, ConfirmDialog, InUseDialog), `features/orchestrator`, `components/shared/conflict/ConflictDialog` · H4a `plan-frontend.md` D1–D12 và H4b-1 D4/D8 vẫn đúng. **Contract chưa có (spec §3 do backend-lead viết)**: mục 8 là đề nghị, FE không tự đổi.

## 0. Quyết định
| # | Quyết định | Lý do |
|---|---|---|
| D1 | Không thêm thư viện, không ADR. Kéo-thả StepsEditor dùng thư viện kéo-thả **đã có** ở Studio (nếu chưa có: nút Lên/Xuống trước, kéo-thả để sau, không thêm dependency) | tối giản |
| D2 | Hai route lazy: `/models` (`?tab=providers\|profiles`, `?drawer=`, `?guide=`) và `/access`. Tab Đơn giá **không hiện** (ngoài phạm vi, Q1) | spec §1 |
| D3 | **Kiểm tra key / Kiểm tra lại = một request đồng bộ** (≤ 10 s, Q3), hiện trong `dialog "Kết quả kiểm tra · {key}"`: đang chạy → đạt / lỗi / chưa hỗ trợ. Không polling. Lỗi nguyên văn của hãng nằm trong `<details open> "Chi tiết"` dạng `pre`; FE không bao giờ hiện hay giữ giá trị key | AC-H4b2-02 |
| D4 | SecretField = `select` secret `provider_api_key` (đã lưu ở Secrets) + link "Tạo secret" → `/secrets?kind=provider_api_key&drawer=new`; theo mẫu K1 Sheet. Không có ô nhập giá trị nên không áp D4 H4b-1 | HUB-FR-66 |
| D5 | `Loại` chỉ chọn lúc tạo, sau đó chỉ đọc. Sheet theo loại: `api` → Hãng, Base URL, API key, Bật; `subscription-cli` → Hãng, Số slot tối đa, Bật, link "Hướng dẫn đăng nhập" | UI §8 |
| D6 | Runbook (F3) là Sheet tĩnh: 3 bước + nút Sao chép (`navigator.clipboard`), lệnh theo hãng nằm trong i18n (`anthropic: claude login`, `openai: codex login`, `google: gemini`); hãng khác → bước 2 ghi "Xem runbook Worker". Không cần contract | UI F3 |
| D7 | Dòng "Lúc này chạy bằng…" của Profile tính **ở client** từ danh sách provider (status/slot/cooldown) và thứ tự bước; không endpoint riêng. Profile không có bước `api` → cảnh báo vàng (HUB-FR-67) | spec §2 |
| D8 | Xoá provider: `409 PROVIDER_IN_USE` → `alertdialog "Không xoá được {key}"` kèm badge các profile (mẫu InUseDialog). Biết trước từ danh sách thì không gọi API. Tắt provider = công tắc `Bật` trong Sheet | Q2 |
| D9 | Ma trận Quyền agent: ô là `switch` (bật = cấp entitlement; tắt = mở ConfirmDialog thu hồi nêu "N grant", N lấy từ ô). Click phần số/tên ô mở drawer xem (chỉ đọc). Cấp (bật) không cần xác nhận; thay đổi cập nhật lạc quan, lỗi thì hoàn về và toast | UI §9 |
| D10 | Mọi ghi: invalidate `["me"]` để ConfigBadge đổi vN (như H4b-1 D9). 409 phiên bản (provider/profile) → `ConflictDialog` dùng chung có "Xem khác biệt" ẩn (như H4b-1 D8). Ma trận 409 → toast + refetch | H4a |
| D11 | Cột agent đang tắt: tiêu đề mờ + `aria-disabled` chú thích "Agent đang tắt", công tắc vẫn dùng được | UI §9 |
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
Mỗi component ≤ 200 dòng; `StepsEditor` tách `StepRow`.

## 2. Màn hình
| Màn | Bố cục | Đang tải | Rỗng | Lỗi | Không quyền / 409 |
|---|---|---|---|---|---|
| Providers | Artboard `Models.dc.html`: `table "Danh sách provider"` cột Provider · Loại · Hãng · Trạng thái · Slot · Ghi chú · Thao tác. Thao tác: `api` [Kiểm tra key] [Sửa]; subscription [Kiểm tra lại] [Hướng dẫn] (khi `logged_out`/`error`) [Sửa]; [Xoá] | Skeleton 4 dòng `aria-busy` | EmptyState + [+ Thêm provider] | `ErrorState` + [Thử lại] | 403 → EmptyState quyền; xoá 409 → D8; lưu 409 → D10 |
| Provider Sheet | `Provider-Sheet.dc.html`; footer [Huỷ] [Lưu] | "Đang lưu…" disabled | — | lỗi trường dưới ô; lỗi khác toast | `PROVIDER_KEY_TAKEN` → dưới `Khoá provider` |
| Kiểm tra | `Check.dc.html`; nút [Kiểm tra lại] trong hộp chạy lại cùng request | `status` "Đang kiểm tra key…" `aria-busy`, [Đóng] disabled | — | lỗi mạng → trạng thái lỗi "Không kết nối được tới hãng trong 10 giây" hoặc lỗi trả về | `supported=false` → "Chưa hỗ trợ kiểm tra cho hãng này" |
| Runbook | `Runbook.dc.html` | — | — | — | — |
| Profiles | Artboard `Models.dc.html`: danh sách trái + StepsEditor phải; [Lưu profile] ở đầu StepsEditor, bật khi có thay đổi | skeleton | EmptyState + [+ Profile mới] | ErrorState | lưu 409 → D10; bước chỉ-subscription → cảnh báo vàng |
| Quyền agent | Artboard `Access.dc.html`; lọc `combobox "Lọc theo agent"` / `"Lọc theo tenant"`; drawer `dialog "Chi tiết {agent} × {tenant}"` | skeleton lưới | "Chưa có agent để cấp" | ErrorState | thu hồi: `alertdialog "Thu hồi {agent} khỏi {tenant}?"` |

## 3. Câu chữ (key `models.*`, `access.*` trong `packages/i18n/locales/studio/{vi,en}.json`)
| Key | VI | EN |
|---|---|---|
| models.title / subtitle | "Models" / "Provider là nơi gọi model (API hoặc CLI subscription). Profile là chuỗi bước dự phòng; agent chỉ trỏ tới profile." | "Models" / "A provider is where models are called (API or CLI subscription). A profile is a fallback chain; agents only point to a profile." |
| tab.providers / profiles / aria | "Providers" / "Profiles" / "Models" | "Providers" / "Profiles" / "Models" |
| provider.add / table.aria | "+ Thêm provider" / "Danh sách provider" | "+ Add provider" / "Provider list" |
| provider.kind.api / sub | "API" / "Subscription" | "API" / "Subscription" |
| provider.col.* | "Provider" "Loại" "Hãng" "Trạng thái" "Slot" "Ghi chú" "Thao tác" | "Provider" "Type" "Vendor" "Status" "Slots" "Notes" "Actions" |
| provider.status.ok/busy/cooldown/error/logged_out | "ok" "bận" "cooldown" "lỗi" "hết phiên" | "ok" "busy" "cooldown" "error" "logged out" |
| provider.cooldownUntil | "Mở lại sau {min} phút ({time})" | "Reopens in {min} min ({time})" |
| provider.action.check / recheck / guide / edit / delete | "Kiểm tra key" / "Kiểm tra lại" / "Hướng dẫn" / "Sửa" / "Xoá" | "Check key" / "Check again" / "Guide" / "Edit" / "Delete" |
| provider.sheet.create / edit | "Thêm provider" / "Sửa provider · {key}" | "Add provider" / "Edit provider · {key}" |
| provider.field.key / kind / vendor / baseUrl / secret / slots / enabled | "Khoá provider" "Loại" "Hãng" "Base URL (tuỳ chọn)" "API key" "Số slot tối đa" "Bật provider" | "Provider key" "Type" "Vendor" "Base URL (optional)" "API key" "Max slots" "Enable provider" |
| provider.field.secretHint | "Chọn secret loại Provider API key đã lưu ở màn Secrets. Không hiện giá trị." | "Pick a Provider API key secret saved on the Secrets screen. The value is never shown." |
| provider.field.createSecret / kindLocked / slotsHint | "Tạo secret" / "không đổi được sau khi tạo" / "Dùng chung cho mọi tenant. Giới hạn theo tenant đặt ở Admin." | "Create secret" / "cannot change after creation" / "Shared by all tenants. Per-tenant limits are set in Admin." |
| provider.toast.saved / deleted | "Đã lưu {key}" / "Đã xoá {key}" | "Saved {key}" / "Deleted {key}" |
| provider.delete.title / body / confirm | "Xoá {key}?" / "Provider sẽ bị xoá." / "Xoá" | "Delete {key}?" / "The provider will be deleted." / "Delete" |
| provider.inUse.title / body | "Không xoá được {key}" / "Provider đang là bước của các profile sau. Gỡ bước, hoặc chỉ tắt provider." | "Cannot delete {key}" / "The provider is a step in the profiles below. Remove the step, or just disable the provider." |
| check.title | "Kết quả kiểm tra · {key}" | "Check result · {key}" |
| check.running / ok / fail / unsupported / timeout | "Đang kiểm tra key…" / "Key hợp lệ" / "Key không hợp lệ" / "Chưa hỗ trợ kiểm tra cho hãng này" / "Không kết nối được tới hãng trong 10 giây" | "Checking key…" / "Key is valid" / "Key is invalid" / "Check is not supported for this vendor" / "Could not reach the vendor within 10 seconds" |
| check.okSub / failSub | "Kiểm tra lại: phiên đăng nhập hợp lệ" / "Phiên đăng nhập chưa hợp lệ" (loại subscription thay "Key") | "Login session is valid" / "Login session is not valid" |
| check.checkedAt / details / again / close | "Kiểm lúc {time}" / "Chi tiết" / "Kiểm tra lại" / "Đóng" | "Checked at {time}" / "Details" / "Check again" / "Close" |
| guide.title / lead | "Đăng nhập CLI · {key}" / "Hết phiên đăng nhập. Trong lúc chờ, profile tự dự phòng sang bước kế." | "CLI login · {key}" / "The login session expired. Meanwhile profiles fall back to the next step." |
| guide.step1 / step2 / step3 | "SSH vào máy Worker" / "Chạy lệnh đăng nhập" / "Bấm Kiểm tra lại" | "SSH into the Worker machine" / "Run the login command" / "Click Check again" |
| guide.copy / copied / note | "Sao chép" / "Đã sao chép" / "Hub không đăng nhập thay bạn. Nội dung lấy từ runbook Worker." | "Copy" / "Copied" / "The Hub does not sign in for you. Content comes from the Worker runbook." |
| profile.add / save / saved / steps / addStep | "+ Profile mới" / "Lưu profile" / "Đã lưu profile {name}" / "Các bước" / "+ Thêm bước" | "+ New profile" / "Save profile" / "Saved profile {name}" / "Steps" / "+ Add step" |
| profile.field.name / provider / model / on | "Tên profile" "Provider" "Model" "Chuyển bước kế khi" | "Profile name" "Provider" "Model" "Fall back when" |
| profile.on.error / quota / timeout | "lỗi" / "hết quota" / "quá giờ" | "error" / "quota" / "timeout" |
| profile.live | "Lúc này sẽ chạy bằng bước {n} · {key}" (+ " — bước {m} đang {status}." nếu có bước bị bỏ) | "Currently runs on step {n} · {key}" |
| profile.liveNone | "Hiện không bước nào sẵn sàng" | "No step is ready right now" |
| profile.subOnly | "Profile này chỉ có bước subscription. Hết slot hoặc cooldown thì chạy lỗi ALL_PROVIDERS_EXHAUSTED. Chỉ nên dùng cho dev/test." | same meaning in EN |
| profile.drag | "Kéo để đổi thứ tự" | "Drag to reorder" |
| state.empty.providers / profiles / agents | "Chưa có provider nào" / "Chưa có profile nào" / "Chưa có agent để cấp" | "No providers yet" / "No profiles yet" / "No agents to grant" |
| state.error / retry / forbidden | "Không tải được dữ liệu" / "Thử lại" / "Bạn không có quyền xem mục này" | "Could not load data" / "Retry" / "You don't have permission to view this" |
| access.title / subtitle | "Quyền agent" / "Tenant nào được có agent nào. Grant cho group/user do tenant admin cấp ở Admin › Groups." | "Agent access" / "Which tenants may use which agents. Grants for groups/users are set by tenant admins in Admin › Groups." |
| access.matrix.aria / cell.on / cell.off | "Ma trận quyền agent" / "{agent} đã cấp cho {tenant}" / "{agent} chưa cấp cho {tenant}" | "Agent access matrix" / "{agent} granted to {tenant}" / "{agent} not granted to {tenant}" |
| access.cell.count | "{n} grant" | "{n} grants" |
| access.agentOff | "Agent đang tắt" | "Agent is off" |
| access.filter.agent / tenant / all | "Lọc theo agent" / "Lọc theo tenant" / "Tất cả" | "Filter by agent" / "Filter by tenant" / "All" |
| access.drawer.title / grantedAt / grantedBy / grants / note | "Chi tiết {agent} × {tenant}" / "Ngày cấp" / "Người cấp" / "Grant trong tenant" / "Grant do tenant_admin cấp trong Admin › Groups." | "Details {agent} × {tenant}" / "Granted on" / "Granted by" / "Grants in tenant" / "Grants are set by tenant_admin in Admin › Groups." |
| access.revoke.title / body / confirm | "Thu hồi {agent} khỏi {tenant}?" / "{n} grant trong tenant {tenant} sẽ mất hiệu lực. Grant được giữ lại và tự có hiệu lực khi cấp lại. Run đang chạy vẫn xong." / "Thu hồi" | "Revoke {agent} from {tenant}?" / "{n} grants in tenant {tenant} will stop working. Grants are kept and work again when re-granted. Running runs finish." / "Revoke" |
| access.toast.granted / revoked | "Đã cấp {agent} cho {tenant}" / "Đã thu hồi {agent} khỏi {tenant}" | "Granted {agent} to {tenant}" / "Revoked {agent} from {tenant}" |
| access.errors.conflict | "Quyền vừa được thay đổi. Đã tải lại ma trận." | "Access was just changed. The matrix has been reloaded." |
Lỗi API: `errors.PROVIDER_IN_USE`, `errors.PROVIDER_KEY_TAKEN` ("Khoá này đã được dùng" / "This key is already used"), dùng lại `errors.FORBIDDEN`, `conflict.*`.

## 4. Validate client (zod; khớp contract khi chốt)
| Trường | Luật | VI | EN |
|---|---|---|---|
| Khoá provider (tạo) | `^[a-z0-9][a-z0-9-]{1,63}$` | "Chữ thường, số và - (2–64 ký tự)" | "Lowercase letters, digits and - (2–64 characters)" |
| Hãng | bắt buộc | "Chọn hãng" | "Choose a vendor" |
| API key (loại api) | bắt buộc chọn secret | "Chọn API key" | "Choose an API key" |
| Base URL | trống hoặc URL `https?://` | "Địa chỉ không hợp lệ" | "Invalid URL" |
| Số slot tối đa | số nguyên ≥ 1 | "Nhập số nguyên từ 1" | "Enter an integer, 1 or more" |
| Tên profile | `^[a-z0-9][a-z0-9-]{1,63}$` | "Chữ thường, số và - (2–64 ký tự)" | same in EN |
| Bước | ≥ 1; mỗi bước có provider + model (model ≤ 128 ký tự, không trống) | "Cần ít nhất một bước" / "Nhập model" | "At least one step is required" / "Enter a model" |
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
| Quyền agent | `heading "Quyền agent"` · `table "Ma trận quyền agent"`; mỗi ô `switch "{agent} × {tenant}"` (aria-checked) · `combobox "Lọc theo agent"`, `combobox "Lọc theo tenant"` · `button "Chi tiết {agent} × {tenant}"` mở drawer · `dialog "Chi tiết {agent} × {tenant}"` (+ `button "Đóng"`) · `alertdialog "Thu hồi {agent} khỏi {tenant}?"` (`button "Huỷ"`, `button "Thu hồi"`) |
| Không có | không element hiện giá trị key; DOM không chứa key sau "Kiểm tra key" |

## 6. Accessibility
Sheet/Dialog trả focus về nút gọi; `Kết quả kiểm tra` là `status` `aria-live=polite`, trạng thái không chỉ dựa màu (có chữ); công tắc ma trận là `button role=switch` có nhãn đủ; kéo-thả luôn có nút Lên/Xuống (bàn phím); copy báo bằng `status`; tương phản ≥ 4.5:1 theo token.

## 7. Hiệu năng
Hai chunk lazy, ước ≤ 14 KB gzip tổng (không chặn mốc). Ma trận: số agent × tenant nhỏ, không virtualize; `AccessCell` memo theo `(agentId, tenantId, on, count)`. Bảng provider poll trạng thái sống `refetchInterval` 10 s khi tab hiển thị (tạm dừng khi ẩn).

## 8. Đề nghị contract (backend-lead chốt ở spec §3; FE không tự đổi)
| # | Đề nghị | Dùng cho |
|---|---|---|
| C1 | `GET /providers` mỗi item: `{id,key,kind,vendor,base_url,max_concurrency,enabled,version,secret:{id,name}\|null,state:{status,slots_used,cooldown_until,last_error}\|null}` (state tính sẵn, FE không join) | Bảng, LiveSummary |
| C2 | `POST/PUT/DELETE /providers`, tối giản; `PUT` có `version` (409 `VERSION_CONFLICT`); `DELETE` 409 `PROVIDER_IN_USE` với `details.profiles:[{id,name}]`; 409 `PROVIDER_KEY_TAKEN` | Sheet, D8 |
| C3 | `POST /providers/:id/check` đồng bộ ≤ 10 s → `{supported:boolean, ok:boolean, message:string (nguyên văn, không chứa key), checked_at}`; hết giờ trả `ok:false` với mã/`message` rõ | CheckDialog |
| C4 | `GET/POST/PUT/DELETE /model-profiles` với `steps:[{provider_key,model,on:("error"\|"quota"\|"timeout")[]}]` theo thứ tự, kèm `version` và `agent_count` | Profiles |
| C5 | `GET /agent-entitlements` → `{agents:[{id,name,enabled}],tenants:[{id,name}],cells:[{agent_id,tenant_id,granted_at,granted_by,grant_count}]}` (chỉ ô đã cấp; chưa cấp không có trong `cells`) | Ma trận |
| C6 | `PUT /agent-entitlements/:agent_id/:tenant_id` (cấp, idempotent) · `DELETE` (thu hồi, trả `{affected_grants:n}`) | Cấp/thu hồi |
| C7 | `GET /agent-entitlements/:agent_id/:tenant_id/grants` → `[{subject_type:"group"\|"user",subject_name,granted_by,granted_at}]` | Drawer |
Chưa có C-nào thì FE dùng mock server của `bun run mocks` theo các hình trên.

## 9. Đối chiếu AC
| AC | FE chứng minh bằng |
|---|---|
| AC-H4b2-01 | Sheet tạo provider api chọn secret → dòng trong bảng; DOM không có giá trị key |
| AC-H4b2-02 | CheckDialog lỗi/ok + `group "Chi tiết"` |
| AC-H4b2-03 | StepsEditor Lên/Xuống + lưu; `alertdialog "Không xoá được…"` có tên profile |
| AC-H4b2-04 / 05 | switch ma trận bật; thu hồi nêu "{n} grant" |
