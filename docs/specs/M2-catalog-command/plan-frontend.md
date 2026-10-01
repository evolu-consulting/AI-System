# Plan · M2-catalog-command · Frontend (frontend-lead)

Chế độ PLAN · 2026-10-01 · Bổ sung cho `spec.md` §5 và §6 (phần FE). File này **không** sửa contract; chỗ cần backend đổi ghi ở §9 "Yêu cầu contract".
Nguồn: `spec.md` §1–2, §8 · `design/admin/ui-admin.md` 7.3, 7.4, 7.6, 7.8, 7.12 · `specs/_design/admin-missing-screens.md` §0, §2, §3, §6, §12 (câu chữ + nhãn e2e gốc) · canvas `Commands`, `Workflows`, `Secrets` (`Access` chỉ đối chiếu) · `readiness/2026-10-01-admin-m1-m4.md` (đã chấp nhận) · `M1-foundation-identity/plan-frontend.md` (shell, shared, lỗi → i18n) · `CONVENTIONS.md` §2, §6.
Quy ước câu chữ: chuỗi "§n" lấy nguyên văn từ `admin-missing-screens.md`; chuỗi **mới** của file này ở §7. Trùng key thì `admin-missing-screens` thắng. Mã lỗi API dưới đây là tên trong spec M2-Rnn; backend-lead chốt tên cuối ở contract (T1) thì FE đổi theo, không đổi nghĩa.

## 0. Quyết định chốt (Luật 2, ghi vào `spec.md` §9 "Trong lúc làm" khi BUILD)

| # | Quyết định | Lý do |
|---|---|---|
| D1 | **Không thêm thư viện, không ADR.** Không có editor JSON (input schema nhập bằng dòng, §3.3); không kéo-thả (sắp xếp tham số bằng nút `↑` `↓`); không `cmdk` (RefPicker tự viết bằng `Popover` + `listbox`); không TanStack Table (phân trang server ≤ 50 dòng, như D9 M1) | Spec §7 ưu tiên không thêm thư viện; `radix-ui` đã có `Popover`/`Switch` |
| D2 | Mẫu trang theo `ui-admin.md` §3: **Secrets = drawer** (Sheet 520px); **Workflows, Commands = trang riêng** (`/x/new`, `/x/:id`); **Features = trang có tab**. Artboard `Workflows` vẽ panel chi tiết cạnh danh sách, FE làm trang riêng vì form có bảng input schema (tới 50 dòng) và khớp sitemap `/workflows/new` · `/workflows/:id` | ui-admin §3, bảng "Mẫu chỉnh sửa" |
| D3 | Menu: nhóm `CHỨC NĂNG` (Features, Commands, Workflows) đứng **trên** `TRUY CẬP`; nhóm `BẢO MẬT` (Secrets) đứng dưới `TRUY CẬP`. Chỉ `platform_admin`. `tenant_admin` mở thẳng URL → `ForbiddenState` trong khung; không gọi API (`enabled:false`). Không "Lịch sử" ở bất kỳ đâu (M4), không nút Test, không "Kiểm tra kết nối", không "Lấy từ Dify" | spec §1, M2-R28 |
| D4 | Artboard `Workflows` bước 2 ghi "Dán key, lấy input…": FR-12 không làm ở M2 → đổi thành "Chọn secret, khai báo input, viết mô tả. Chưa gắn cũng được" | Mơ hồ A8 |
| D5 | Toast lưu: `"Đã lưu {name}"` (không "Đã lưu và áp dụng · v{n}", chưa có `config vN`, M3), như D17 của M1. Câu chữ ở missing-screens nói "trong vài giây" (confirm Tắt feature, Thu hồi, toast cấp) **giữ nguyên** vì design đã duyệt; hiệu lực thật do Hub/M3 (M2-R24) | Design là chuẩn |
| D6 | **Nhân bản command làm ở FE:** `/commands/new?from=<id>` đọc `GET /admin/commands/:id`, điền sẵn tên `<name>-copy`, `enabled=false`, **bỏ alias** (alias dùng chung không gian tên nên sẽ trùng), giữ feature/workflow/args/map; lưu bằng `POST`. Không cần endpoint. Tên `-copy` trùng → 409 `COMMAND_NAME_TAKEN` hiện dưới ô tên | M2-R13, R15 |
| D7 | Kiểm trùng tên/alias "ngay khi rời ô" (ui-admin 7.4): `GET /admin/commands?q=<tên>&limit=5`, so khớp **chính xác** tên/alias của kết quả (bỏ command đang sửa). Server vẫn là nguồn quyết định (409 hiện cùng câu dưới ô). Không cần endpoint mới | Không đổi contract |
| D8 | Icon feature: `Select` ~16 icon lucide chọn sẵn (map tĩnh, tree-shake), mặc định `package`; giá trị lạ từ server hiển thị `package`. Không nạp cả bộ lucide | Bundle |
| D9 | Validate input map ở client là **hàm thuần** `validateInputMap(schema, args, map)` (cùng luật M2-R16/R17) để chặn trước khi gửi; lỗi `INPUT_MAP_INVALID` từ server dựng lại cùng UI từ `details`. Sai kiểu = **cảnh báo** vàng, không chặn (M2-R17, RD#51): trước khi lưu dùng cảnh báo tính ở client, sau khi tải/lưu dùng `warnings[]` của server (`{var,type,source,reason: type_mismatch|const_invalid}`), hai nguồn gộp theo `var` | AC-A03 |
| D10 | Secret: giá trị chỉ sống trong state của form (RHF) → `reset()` ngay khi gửi xong/đóng drawer; mutation `gcTime: 0` + `reset()` sau khi xong (TanStack giữ `variables` trong cache); không đưa vào URL, `localStorage`, log, toast, `title`; ô `type=password`, `autoComplete="new-password"`, `spellCheck=false`; nút Hiện/Ẩn **chỉ** tác động giá trị đang gõ. Lỗi của `/admin/secrets*` hiển thị bằng key tĩnh, **không** chèn `message` server | M2-R03, AC-A06 |
| D11 | Đồng bộ chip có số: Secrets/Workflows/Commands/Features dùng `counts` của API (M2-R26). Workflows: `Tất cả = counts.all`; `Chưa gắn` = `counts.unattached` (đề xuất contract Y5) | M1 D11 |
| D12 | Mọi `PATCH` gửi `version`; lệch → 409 `VERSION_CONFLICT` **G14:** UI chỉ hiện `errors.versionConflict` trong toast bền kèm nút `Tải lại` (refetch, bỏ thay đổi đang sửa), đúng M1 D13. **Không** modal diff (M3), **không** tự gửi lại, **không** nút "Ghi đè"; form giữ nguyên chữ người dùng cho tới khi họ bấm `Tải lại`. Áp dụng cho `PATCH` workflow/command/feature và Switch ở danh sách (hoàn lại Switch + toast). Lưu ý: `version` của feature và command còn tăng chéo khi đổi tập feature↔command (spec §3 `version`), nên 409 có thể xảy ra giữa hai editor khác nhau | M2-R25, G14 |
| D13 | Mọi tên route, query-key, key i18n ghi ở file này; không đổi sau Gate để qc khoá test | |

## 1. Màn, route, bố cục

Mọi trang trong khung dùng `<main id="main">`, H1 nhận focus (`PageHeader`), `document.title = "<H1> · Admin"`. Search param viết tay `validateSearch` (không zod, như M1). Bộ lọc trên URL, đổi bộ lọc bỏ `page`.

| Route (file `routes/_authed/…`) | Màn | Bố cục | Artboard |
|---|---|---|---|
| `/secrets` (`secrets.tsx`) `?q&used=yes\|no&page&drawer=new\|replace\|note&secret=<NAME>` | Secrets | Mẫu A + drawer C. Cột: Tên (mono) · Giá trị (`•••• 7f3a`, mono) · Ghi chú · Đang được dùng bởi (link `/workflows?q=<key>`, badge `off` "Chưa dùng" khi rỗng) · Cập nhật ("12/09/2026 · minh.pham") · `⋯` (Thay giá trị · Sửa ghi chú · Xoá). Chip `Tất cả/Đang dùng/Chưa dùng`. Không hành động xem/copy giá trị | `Secrets` |
| `/workflows` (`workflows/index.tsx`) `?q&status=on\|off\|unattached&secret=<NAME>&page` | Workflows | Mẫu A. Hộp hướng dẫn 3 bước (đóng được, nhớ trong `localStorage ai.workflowsGuide`) → chip `Tất cả/Bật/Tắt/Chưa gắn` → bảng. Cột: Workflow (tên + key mono) · Loại (`workflow\|chat\|agent`) · Đang được dùng bởi (`2 command · 1 agent`, bấm mở Popover DependencyList; `Chưa gắn` = badge `warn`) · Trạng thái (badge) · `⋯` (Sửa · Bật/Tắt · Tạo command · Xoá). `?secret=` hiện chip "Secret: NAME ✕" (`button "Bỏ lọc secret"`) | `Workflows` |
| `/workflows/new`, `/workflows/$workflowId` (`workflows/new.tsx`, `workflows/$workflowId.tsx`) `?tab=info\|input\|preview\|usage` | Editor workflow | Mẫu B: breadcrumb → header (tên, key mono, badge, nút `Tạo command từ workflow này` (link, ẩn khi tạo mới)) → 4 tab → thanh lưu dính đáy. Tab **Thông tin**: Key (khoá khi đã lưu) · Tên · Loại (radio) · Secret (Select, giá trị = `secret.id`, hiện tên; nguồn `GET /admin/secrets?limit=200`) · Base URL · Output field · **Mô tả** (Textarea, đếm `n/400`, gợi ý "Viết như đang dặn một người mới: dùng khi nào, không dùng khi nào.") · công tắc Bật. Tab **Input**: bảng tham số (§3.3). Tab **Model thấy gì**: `<pre>` JSON tool (chỉ đọc, §3.4). Tab **Đang được dùng bởi**: DependencyList. Tab Info+Input chung một form, chung nút Lưu; tab có lỗi hiện chấm `err` | `Workflows` (panel) + D2 |
| `/commands` (`commands/index.tsx`) `?q&status=on\|off&feature=<id>&workflow=<id>&page` | Danh sách Commands | Mẫu A đúng missing-screens §2: chip, 2 `Select` (Feature, Workflow), cột Tên+alias · Mô tả (+ "EN thiếu") · Workflow (+ badge `Tắt`) · Feature (chip link `/features/$id`) · Chế độ · Trạng thái (`Switch`) · Cập nhật · `⋯` (**Sửa · Nhân bản · Bật/Tắt · Xoá**; không Lịch sử) | missing-screens §2 |
| `/commands/new`, `/commands/$commandId` (`commands/new.tsx`, `commands/$commandId.tsx`) `?from=<id>&workflow=<id>&tab=config\|access` | Editor command | Canvas `Commands`: breadcrumb "Commands › /dich" → header (`/dich` mono, badge, "alias translate, tr", nút `Nhân bản`) → tab `Cấu hình` · `Ai dùng được` (+ "3 tenant · 142 user") → **5 bước** (1 Đặt tên và gói chức năng · 2 Chọn workflow · 3 Người dùng gõ gì · 4 Đưa vào workflow · 5 Hiển thị kết quả) → thanh lưu dính đáy (`Chưa lưu thay đổi` · `Huỷ` · `Lưu`). **Không có panel "Chạy thử"**, không "Chạy với tư cách user…", không gợi ý "Bạn chưa chạy thử bản này"; cột phải của canvas bỏ, nội dung một cột `max-w-3xl` | `Commands` (bỏ Test panel) |
| `/features` (`features/index.tsx`) `?q&status=on\|beta\|off&page` | Danh sách Features | Mẫu A (§3.1). `⋯` đổi trạng thái bằng `DropdownMenu` (Sửa · Bật · Tắt · Chuyển sang Beta · Xoá; `core` chỉ "Sửa"). Tắt → ConfirmDialog vừa | missing-screens §3.1 |
| `/features/new`, `/features/$featureId` (`features/new.tsx`, `features/$featureId.tsx`) `?tab=info\|commands\|tenants` | Editor Feature | Mẫu B, 3 tab (§3.2). `/features/new`: tab Tenant khoá, hint "Lưu feature trước để cấp cho tenant" | missing-screens §3.2 |
| Tab "Feature" của Tenant | giữ card "Chưa khả dụng" (A10) | Không đổi | — |

**Guard:** `PlatformOnly` (shared) bọc mọi trang M2: `role !== platform_admin` → `ForbiddenState` (không redirect, không gọi API). `:id` lạ → `NotFoundState`. Server 403 giữa phiên (`FORBIDDEN`) → toast `state.forbiddenAction`.

### 1.1 Trạng thái từng màn

Dùng bộ `components/shared/states` (M1 §12). "Lỗi tải" = `ErrorState` (`alert` + `Thử lại`). Lỗi lưu/hành động = toast bền (`notifyError`) trừ khi ghi "inline".

| Màn | Đang tải | Rỗng | Lỗi tải | Lỗi hành động / 409 |
|---|---|---|---|---|
| Secrets | skeleton bảng 8 hàng; drawer khi mở bằng `?secret=` lạ chờ list | `secrets.empty` + `+ Thêm secret`; do lọc: `state.empty.noResults` + `Xoá bộ lọc` | `ErrorState` | `SECRET_NAME_TAKEN` → inline dưới Tên (`secrets.error.nameTaken`); `SECRET_IN_USE` → dialog chặn + DependencyList; `VALIDATION_ERROR` → inline `secrets.error.*` (không echo); khác → toast bền; `?secret=` không có trong list → drawer đóng + `NotFoundState` nhỏ trong drawer |
| Workflows list | skeleton | `workflows.empty` (hướng dẫn luồng 3 bước, ui-admin 7.6) + `+ Khai báo workflow`; do lọc: noResults | `ErrorState` | `WORKFLOW_IN_USE` (tắt/xoá) → dialog chặn + DependencyList commands + agents; khác → toast |
| Workflow editor | skeleton header + form | — | `ErrorState`; id lạ → `NotFoundState` | `KEY_TAKEN` inline dưới Key; `SCHEMA_BREAKS_COMMANDS {commands}` → Alert đỏ trên thanh lưu + DependencyList, **không** lưu; `WORKFLOW_IN_USE` (tắt bằng công tắc) → dialog chặn; `VERSION_CONFLICT` → D12; `INVALID_REFERENCE {field:"secret_id"}` (secret vừa bị xoá: toast `errors.invalidReference`, refetch danh sách secret)/lỗi validate → inline theo trường |
| Commands list | skeleton | `commands.empty` + `+ Tạo command đầu tiên` (không có workflow nào → nút `Khai báo workflow trước` link `/workflows/new`, `commands.empty.noWorkflow`); do lọc: noResults | `ErrorState` | toggle lỗi → hoàn lại Switch + toast bền; `WORKFLOW_DISABLED` → toast `commands.error.workflowDisabled`; xoá lỗi → toast |
| Command editor | skeleton 5 bước | — | `ErrorState`; id lạ → `NotFoundState`; `?from=` lạ → `NotFoundState` | `COMMAND_NAME_TAKEN {name}` inline dưới ô trùng (tên hoặc alias); `COMMAND_NEEDS_FEATURE` inline dưới Feature; `INPUT_MAP_INVALID` → Alert trên bước 4 + đánh dấu hàng (§4); `WORKFLOW_DISABLED` → Alert dưới Workflow; `VERSION_CONFLICT` → D12 |
| Features list | skeleton | `features.empty` + `+ Tạo feature`; do lọc: noResults | `ErrorState` | `CORE_FEATURE_PROTECTED` → toast `features.error.coreProtected`; `FEATURE_HAS_EXCLUSIVE_COMMANDS {commands}` → dialog chặn + DependencyList (`features.delete.blocked`) |
| Feature editor | skeleton | tab Commands `features.commands.empty`; tab Tenant `features.tenants.empty` (core: `features.tenants.coreAll`) | `ErrorState` | `KEY_TAKEN` inline; `COMMAND_NEEDS_FEATURE {commands}` → chặn lưu, hàng orphan đỏ; thu hồi/cấp lỗi → toast bền; `VERSION_CONFLICT` → D12 |

Mất kết nối: `ConnectionBanner` của shell khoá nút Lưu (đã có). Phiên hết hạn: dialog của shell. `UnsavedGuard` cho 3 editor (Workflow, Command, Feature) và drawer Secret khi có chữ đang gõ.

### 1.2 Thành phần shadcn

Đã có: `button input label card badge table dialog alert-dialog sheet dropdown-menu select tabs radio-group checkbox tooltip skeleton alert separator breadcrumb sonner`. Cần thêm (FE0, `bunx shadcn@4.21.0 add switch textarea popover`; cùng gói `radix-ui` hiện có): `Switch`, `Textarea`, `Popover`. Không thêm `toggle-group` (FilterChips đã có), `command`, `form`.

### 1.3 Component dùng chung mới (`components/shared/`, ≥ 2 feature)

| Component | Việc | Dùng ở |
|---|---|---|
| `PlatformOnly` | bọc trang, `ForbiddenState` khi không phải platform_admin; truyền `enabled` cho hook | cả 4 feature |
| `DependencyList` | `{sections: {title, items: {id, label, mono?, href?, badge?}[]}[]}`; nhóm "Command", "Agent", "Workflow"; agent hiện `Agent …{6 ký tự cuối id}` (Mơ hồ A6), không link | Secrets (chặn xoá, drawer), Workflows (chặn xoá/tắt, tab, popover), Features (chặn xoá), Workflow editor (`SCHEMA_BREAKS_COMMANDS`) |
| `RefPicker` | `combobox` mở `Popover` có ô tìm + `listbox` (`role="option"`, ↑↓ Enter Esc); props `{label, options, selectedIds?, onPick, isLoading, onSearch?}`; chỉ render ≤ 50 mục + dòng "Còn {n} kết quả, gõ để lọc" | Feature (Thêm command, Cấp cho tenant), Command (Thêm feature) |
| `LocalizedInput` | ô văn bản có `tablist "Ngôn ngữ"` VI/EN (một ô, đổi giá trị theo tab); `multiline` tuỳ chọn; badge "EN thiếu" khi EN trống | Feature (Tên, Mô tả), Command (Mô tả, mô tả tham số) |
| `toast.tsx` (mở rộng) | `notifySuccess(message, action?, durationMs?)`: nút hành động trong toast `status` (Hoàn tác 5 s; "Xem các workflow dùng secret này") | Commands, Features, Secrets |

Chỉ dùng trong một feature thì nằm trong feature (`SecretField`, `SchemaEditor`, `ArgsEditor`, `InputMapEditor`).

## 2. Cấu trúc file (feature-first, file ≤ 400 dòng, component ≤ 200, hàm ≤ 50)

```
apps/admin-web/src/
├─ routes/_authed/        secrets.tsx · workflows/{index,new,$workflowId}.tsx · commands/{index,new,$commandId}.tsx · features/{index,new,$featureId}.tsx   # mỏng: validateSearch + page
├─ lib/                   errors.ts (+ mã lỗi M2) · normalize.ts (+ normalizeSecretName, normalizeCommandName) · format.ts (+ formatUpdated "12/09/2026 · minh.pham")
├─ components/shared/     PlatformOnly · DependencyList · RefPicker · LocalizedInput · toast (mở rộng)
├─ components/ui/         switch · textarea · popover (shadcn)
└─ features/
   ├─ shell/lib/nav.ts    nhóm + mục M2 theo role; crumbsFor() thêm 4 màn
   ├─ secrets/            api.ts · pages/SecretsPage · components/{SecretTable, SecretRowMenu, SecretDrawer, SecretCreateForm, SecretReplaceForm, SecretNoteForm, SecretField, SecretDeleteDialog} · hooks/use-secrets-view.ts · lib/{schemas,status}.ts
   ├─ workflows/          api.ts · pages/{WorkflowsPage, WorkflowEditorPage} · components/{WorkflowTable, WorkflowRowMenu, WorkflowGuide, UsageCell, WorkflowInfoSection, SchemaEditor, SchemaParamRow, ToolPreview, WorkflowBlockedDialog} · hooks/{use-workflows-view, use-workflow-actions} · lib/{schemas, tool-preview}.ts
   ├─ commands/           api.ts · pages/{CommandsPage, CommandEditorPage} · components/{CommandTable, CommandRowMenu, CommandToggle, StepName, AliasField, FeatureField, StepWorkflow, WorkflowCard, StepArgs, ArgRow, StepInputMap, InputMapRow, StepOutput, SyntaxPreview, AccessTab} · hooks/{use-commands-view, use-command-actions, use-command-form} · lib/{schemas, input-map, syntax, defaults}.ts
   └─ features/           api.ts · pages/{FeaturesPage, FeatureEditorPage} · components/{FeatureTable, FeatureRowMenu, DisableFeatureDialog, FeatureInfoTab, FeatureCommandsTab, FeatureTenantsTab, RevokeDialog, GrantPicker, FeatureIcon} · hooks/{use-features-view, use-feature-actions} · lib/{schemas, icons}.ts
```
Gọi API **chỉ** trong `features/<f>/api.ts`. `features/features/` hơi lặp tên nhưng khớp quy ước `features/<tên feature>`. Component trình bày không fetch (page/hook gọi `api.ts`). Cross-feature: Commands đọc danh sách Features/Workflows và Features đọc Commands **chỉ qua hook export của `api.ts` bên kia** (không import component/lib của nhau; dep-cruiser giữ). Mỗi feature có `README.md` ≤ 30 dòng (mã FR); mỗi file đầu có comment mã `ADM-FR-xx`.

## 3. Chi tiết từng màn

### 3.1 Secrets (ADM-FR-50, BR-04)
- **Drawer Thêm** (`?drawer=new`): `textbox "Tên"` (mono; mỗi lần gõ `normalizeSecretName`: HOA, bỏ dấu, dấu cách/`-` → `_`) · `Giá trị` (`SecretField`) · `Ghi chú` (≤ 200) · `Huỷ` · `Lưu`.
- **Drawer Thay giá trị** (`?drawer=replace&secret=NAME`, tiêu đề = tên): dòng chỉ đọc `secrets.replace.current` · `Giá trị mới` (trống, không tự điền) · DependencyList "Đang được dùng bởi" · `Huỷ` · `Lưu giá trị mới`. Thành công → toast `secrets.toast.replaced` + hành động `secrets.toast.viewWorkflows` (→ `/workflows?secret=NAME`), drawer đóng, list refetch (hiện `last4` mới từ response).
- **Drawer Sửa ghi chú** (`?drawer=note&secret=NAME`): chỉ `Ghi chú` (`PATCH` ghi chú; không đụng giá trị; không gửi `version`, spec M2-R25 secrets không có version).
- **Xoá:** `used_by.length > 0` hoặc 409 `SECRET_IN_USE` → dialog chặn `secrets.delete.blocked` + DependencyList + nút `Đóng`; còn lại ConfirmDialog **nặng** (gõ lại tên) → toast `secrets.toast.deleted`.
- `SecretField`: `<input type=password>` + nút `aria-pressed` `Hiện giá trị đang gõ`/`Ẩn giá trị` (chỉ khi ô có chữ). Đóng drawer/`Huỷ` → `reset()` form.
- **AC-A06 phía FE:** không đâu render giá trị; list chỉ `last4`; bảng/drawer/toast/title không chứa giá trị gõ; e2e quét `page.content()`.

### 3.2 Workflows (ADM-FR-10, 11, 13, 14, 15)
- **Danh sách:** nhãn `Chưa gắn` khi `unattached`; `Đang được dùng bởi` mở Popover (lazy `GET …/usages`, cache 30 s). Menu `⋯`: Tắt khi còn command bật/agent → 409 → dialog chặn (`workflows.blocked.disable`); Xoá khi còn tham chiếu → dialog chặn (`workflows.delete.blocked`, AC-A05: liệt kê **cả command và agent**); còn lại ConfirmDialog nặng (gõ key) → toast `workflows.toast.deleted`. `Tạo command` → `/commands/new?workflow=<id>`.
- **Editor:** tạo → `POST`, về `/workflows/$id`; sửa → `PATCH` kèm `version`. Mô tả đếm sau trim, nút Lưu không khoá (lỗi hiện khi rời ô và khi bấm Lưu, cuộn tới lỗi đầu và focus). `Chưa gắn` hợp lệ (AC-A13): hiện badge ở header.
- **Công tắc `Bật`:** tắt khi còn command bật/agent → server 409 → dialog chặn, công tắc quay lại. Không chặn bằng client (client không biết agent).

### 3.3 Input schema nhập tay (`SchemaEditor`)
Bảng dòng, tối đa 50. Mỗi dòng (`aria-label` có số thứ tự): `textbox "Tên tham số {n}"` (mono) · `combobox "Kiểu {n}"` (`text|number|boolean|select|file`) · `checkbox "Bắt buộc {n}"` · `textbox "Mô tả tham số {n}"` (bắt buộc) · khi `select`: `textbox "Lựa chọn {n}"` nhập phân tách bằng dấu phẩy → mảng, ≥ 1, trim, bỏ trùng · `↑` `↓` (aria "Chuyển tham số {n} lên/xuống") · `button "Xoá tham số {n}"`. Nút `+ Thêm tham số` (disabled ở 50 kèm `workflows.schema.max`). Thứ tự dòng = thứ tự mảng. Mô tả không chuẩn hoá khi lưu (M2-R08): gửi nguyên văn sau `trim` chỉ để kiểm rỗng.

### 3.4 "Model thấy gì"
`toToolPreview(workflow)` thuần (có test): `{name: key, description, parameters: {<name>: {type: string|number|boolean (select → enum, file → string), description}}, required:[…]}`. Chỉ đọc, kèm ghi chú `workflows.preview.note` (minh hoạ, Hub có thể thêm trường). Không gọi server.

### 3.5 Commands (ADM-FR-20, 21, 22, 24; BR-01, 02, 06, 10)
- **Danh sách:** Switch bật/tắt: **tắt → toast `commands.toast.disabled` + `Hoàn tác` 5 s** (hoàn tác = `PATCH enabled:true` với version mới); bật → toast `commands.toast.enabled`. Workflow tắt → Switch `disabled` + tooltip `commands.list.workflowOff` (bọc `span tabIndex=0`). Xoá = ConfirmDialog nặng (gõ tên), body `commands.delete.body` với `{features}` = tên feature nối bằng ", ".
- **Bước 1** Tên (`textbox "Tên command"`, tiền tố `/` trang trí `aria-hidden`; gõ `normalizeCommandName`: bỏ `/` đầu, chữ thường, bỏ dấu) · Alias (`textbox "Alias"` + `button "Thêm alias"` hoặc Enter; chip `button "Bỏ alias tr"`; ≤ 5, không trùng nhau/tên) · Mô tả (`LocalizedInput`, VI bắt buộc ≤ 200) · Feature (`combobox "Thêm feature"` RefPicker, chip `button "Bỏ feature core"`; mặc định `core`; bỏ hết → lỗi inline).
- **Bước 2** Workflow: `combobox "Workflow"` (Select, lấy `GET /admin/workflows?limit=200`, hiện key + tên, option `Tắt` mờ); thẻ tóm tắt (tên, mô tả, "2 command · 1 agent"). Workflow tắt → Alert `commands.error.workflowDisabled` và Lưu bị khoá nếu đang bật command. Đổi workflow: `reconcileMap()` giữ map còn hợp lệ, **liệt kê map bị bỏ** trong Alert info `commands.map.dropped` (ui-admin 7.4); input trùng tên tham số tự map `arg`.
- **Bước 3** Tham số (`ArgsEditor`): dòng `Tên` (`^[a-z][a-z0-9_]*$`) · `Mô tả` (`LocalizedInput` gọn) · `Mặc định` · `Nếu trống lấy` (Select: không · `selection` · `page_text` · `page_url` = `ARG_FALLBACKS`) · `Nuốt phần còn lại` (checkbox, tối đa 1 và phải ở dòng cuối) · `↑` `↓` · `Xoá`. `SyntaxPreview`: `/dich <lang = vi> <text…>` cập nhật ngay (hàm `buildSyntax`).
- **Bước 4** Input map (`InputMapEditor`): một dòng cho **mỗi input của workflow** (tên mono, `*` nếu bắt buộc, kiểu): `combobox "Nguồn của {name}"` với 8 nguồn (`arg`, `selection`, `page_url`, `page_text`, `attachment`, `user_id`, `tenant_id`, `const`; nhãn người dùng: "Tham số", "Đoạn bôi đen", "URL trang", "Nội dung trang", "File đính kèm", "ID người dùng", "ID tenant", "Giá trị cố định") · khi `arg`: `combobox "Tham số của {name}"` (chỉ tham số đã khai báo ở bước 3) · khi `const`: `textbox "Giá trị của {name}"` (≤ 4000). Hiển thị cú pháp BA `$args.lang` kế bên (chỉ đọc). Dòng bắt buộc chưa chọn nguồn → viền đỏ + `aria-invalid` + câu `commands.error.mapMissing` ({names} = tên input của dòng đó). Cảnh báo sai kiểu (§4) hiện icon vàng + `aria-describedby`, **không chặn**.
- **Bước 5** Output: `textbox "Output field"` (điền sẵn từ `workflow.output_field`) · `combobox "Hiển thị"` (Markdown/Text/JSON) · `radio "sync"|"async"` (nhóm "Chế độ"; đổi → timeout mặc định 30/120 nếu người dùng chưa sửa) · `spinbutton "Timeout (giây)"` 1–600.
- **Lưu:** validate toàn form (client) → cuộn + focus lỗi đầu; `POST`/`PATCH` kèm `version`. Thiếu input bắt buộc: **chặn gửi** và hiện `commands.error.mapMissing` ("thiếu input bắt buộc: target_lang", AC-A03). Thành công: toast `commands.toast.saved`, tạo mới → `/commands/$id`.
- **Tab "Ai dùng được"** (M2-R23): bảng tenant có phân trang `limit=50` (`GET …/access` trả `{items,total,command_active}`: Mã công ty mono · Tên (badge `err` "Đã khoá" khi `tenant_active=false`) · Feature (chip) · Số user đang hoạt động); `command_active=false` → Alert `commands.access.inactive` trên bảng; tổng ở trigger tab = `total` tenant (kèm tổng user khi `total` ≤ 50, ngược lại chỉ số tenant, `commands.access.summaryTenants`); khối nhóm/grant: card "Chưa khả dụng" (`commands.access.groupsLater`, M3). Tab khoá khi tạo mới.

### 3.6 Features + entitlement (ADM-FR-30, 31, 33, 34)
- **Danh sách:** `core` badge `info` "Mặc định" + "Mọi tenant". Đổi trạng thái: `Bật`/`Chuyển sang Beta` áp dụng ngay (toast `features.toast.statusChanged`); **Tắt** → ConfirmDialog vừa (`features.disable.*`) với `{commands}` = `command_count`, `{users}` = tổng `active_user_count` của entitlement (= `affected_user_count` của `GET /admin/features/:id` (nạp khi mở hộp thoại; `core` không tắt được); lỗi nạp → dùng `features.disable.bodyNoCount`). Xoá: ConfirmDialog nặng (gõ key); 409 `FEATURE_HAS_EXCLUSIVE_COMMANDS` → dialog chặn + DependencyList.
- **Tab Thông tin:** Key (`readOnly` + `features.field.keyLocked` sau khi tạo) · Tên + Mô tả (`LocalizedInput`) · Icon (Select) · Trạng thái (RadioGroup Bật/Beta/Tắt; `core`: khoá + `features.core.hint`). Beta hint `features.field.betaHint`.
- **Tab Commands:** bảng + `combobox "Thêm command"` (RefPicker; nguồn `GET /admin/commands?limit=200&q=`); `button "Bỏ /dich khỏi feature"`; bỏ command chỉ có feature này → hàng đỏ + `features.commands.orphan` + **chặn Lưu** (`commands.error.featureRequired`). Danh sách là **nháp**, lưu chung với tab Thông tin qua thanh lưu (Y2).
- **Tab Tenant:** lưu ngay từng thao tác. `button "+ Cấp cho tenant"` → RefPicker tenant chưa có (`GET /admin/tenants?limit=200`, loại tenant đã cấp, ghi chú tenant khoá vẫn cấp được) → `PUT` → toast `features.toast.granted`. Bảng: Mã công ty · Tên · Số user đang dùng · Cấp lúc · Cấp bởi · `button "Thu hồi"`. Thu hồi = ConfirmDialog nặng (gõ mã công ty), `features.revoke.*` (`{users}` = `active_user_count`, `{commands}` = số command của feature) → toast `features.toast.revoked` + `Hoàn tác` 5 s (= `PUT` lại). `core`: không có nút, hiện `features.tenants.coreAll`.

## 4. Validate phía client (khớp contract; câu lỗi nguyên văn)

Schema form dùng hằng/regex từ `@ai/contracts` (như M1), thông điệp là **key i18n**. Server vẫn kiểm lại; lỗi server hiển thị bằng cùng câu.

| Trường | Luật | VI | EN |
|---|---|---|---|
| Secret · Tên | chuẩn hoá rồi `^[A-Z0-9_]{2,64}$` | `secrets.error.nameFormat` (§6) | idem |
| Secret · Giá trị | không rỗng; 8–2048, không trim | rỗng: `secrets.error.valueRequired` (§6); `secrets.error.valueLength` | idem |
| Secret · Ghi chú | ≤ 200 | `secrets.error.noteMax` | idem |
| Workflow · Key | `^[a-z0-9-]{2,32}$` | `workflows.error.keyFormat` | idem |
| Workflow · Tên | 1–128 sau trim | `workflows.error.nameRequired` | idem |
| Workflow · Mô tả | **20–400 sau trim** | `workflows.error.descLength` | idem |
| Workflow · Secret | bắt buộc | `workflows.error.secretRequired` | idem |
| Workflow · Base URL | `http(s)://`, `URL` hợp lệ, không `username/password` | `workflows.error.baseUrl` | idem |
| Tham số · Tên | `^[A-Za-z_][A-Za-z0-9_]*$`, ≤ 64, không trùng | `workflows.error.paramName` / `workflows.error.paramDup` | idem |
| Tham số · Mô tả | không rỗng sau trim | `workflows.error.paramDesc` | idem |
| Tham số · Lựa chọn | khi `select` ≥ 1 | `workflows.error.optionsRequired` | idem |
| Tham số · Số lượng | ≤ 50 | `workflows.schema.max` | idem |
| Command · Tên/alias | chuẩn hoá rồi `^[a-z0-9-]{2,32}$`; ≤ 5 alias; không trùng | `commands.error.nameFormat` / `commands.error.aliasDup` / `commands.error.aliasMax` | idem |
| Command · Trùng tên | D7 + 409 `COMMAND_NAME_TAKEN` | `commands.error.nameTaken` | idem |
| Command · Mô tả | VI bắt buộc ≤ 200; EN ≤ 200 | `commands.error.descRequired` | idem |
| Command · Feature | ≥ 1 | `commands.error.featureRequired` (§ ui-admin 7.4) | idem |
| Command · Workflow | bắt buộc | `commands.error.workflowRequired` | idem |
| Tham số lệnh | `^[a-z][a-z0-9_]*$`, không trùng; ≤ 1 `rest` và phải cuối | `commands.error.argName` / `commands.error.argDup` / `commands.error.argRest` | idem |
| Input map | mọi input `required` có nguồn; khoá lạ; `arg` trỏ tham số chưa khai báo; `const` ≤ 4000 | `commands.error.mapMissing` · `commands.error.mapUnknown` · `commands.error.mapUnknownArg` · `commands.error.constMax` | idem |
| Cảnh báo sai kiểu (không chặn) | `file` ← nguồn khác `attachment`; `attachment` → input không phải `file`; `number`/`boolean` ← nguồn văn bản cố định không đúng dạng; `select` ← `const` ngoài `options` | `commands.warn.mapType` | idem |
| Output | field không rỗng ≤ 128; `timeout_s` nguyên 1–600 | `commands.error.outputField` / `commands.error.timeout` | idem |
| Feature · Key | `^[a-z0-9-]{2,32}$` | `features.error.keyFormat` (§3) | idem |
| Feature · Tên | VI bắt buộc ≤ 64 | `features.error.nameRequired` | idem |
| Feature · Mô tả | ≤ 400 | `features.error.descMax` | idem |

Hàm thuần có test `bun test`: `normalizeSecretName`, `normalizeCommandName`, `secretSchema`, `workflowSchema` (đủ biên 19/20/400/401 ký tự), `validateInputMap` (missing/unknown/unknown_args/warnings), `reconcileMap` (đổi workflow), `buildSyntax`, `toToolPreview`, `formatUpdated`, parser search param từng route, `describeError` mã M2, `navGroups`/`crumbsFor`.

## 5. Role + nhãn cho e2e (phải giữ đúng khi code)

Secrets, Commands, Features: nguyên văn missing-screens §2, §3, §6 (đã liệt kê ở đó). Bổ sung/làm rõ:

| Màn | Nhãn |
|---|---|
| Menu | `link "Commands"` · `link "Workflows"` · `link "Features"` · `link "Secrets"` trong `navigation`; `tenant_admin` không thấy (count 0) |
| Secrets | `heading "Secrets"` · `button "+ Thêm secret"` · `table "Secrets"` · hàng chứa tên · `button "Thao tác khác"` → `menuitem "Thay giá trị"`/`"Sửa ghi chú"`/`"Xoá"` · `dialog "DIFY_TRANSLATE_KEY"` · `getByLabel("Tên")` · `getByLabel("Giá trị")` / `getByLabel("Giá trị mới")` · `button "Hiện giá trị đang gõ"` · `button "Lưu"` / `button "Lưu giá trị mới"` · `alertdialog "Xoá DIFY_OLD_KEY?"` + `textbox "Gõ DIFY_OLD_KEY để xác nhận"` · chặn: `alertdialog "Không xoá được DIFY_TRANSLATE_KEY"` + `button "Đóng"` · toast `status` "Đã thay giá trị DIFY_TRANSLATE_KEY · •••• a91d" + `button "Xem các workflow dùng secret này"` |
| Workflows list | `heading "Workflows"` · `link "+ Khai báo workflow"` · `searchbox "Tìm theo tên, key, mô tả…"` · `radio "Tất cả"`/`"Bật"`/`"Tắt"`/`"Chưa gắn"` · `table "Workflows"` · hàng chứa key · `text "Chưa gắn"` · `button "Thao tác khác"` → `menuitem "Sửa"`/`"Bật"`/`"Tắt"`/`"Tạo command"`/`"Xoá"` · chặn: `alertdialog` tiêu đề "Không xoá được translate" liệt kê `link "/dich"`, "Agent …{id}" + `button "Đóng"` · `alertdialog "Xoá translate?"` + `textbox "Gõ translate để xác nhận"` + `button "Xoá workflow"` |
| Workflow editor | `tab "Thông tin"`/`"Input"`/`"Model thấy gì"`/`"Đang được dùng bởi"` · `textbox "Key"` · `textbox "Tên"` · `radiogroup "Loại"` (`radio "workflow"\|"chat"\|"agent"`) · `combobox "Secret"` · `textbox "Base URL"` · `textbox "Output field"` · `textbox "Mô tả"` · `switch "Bật workflow"` · `button "+ Thêm tham số"` · `textbox "Tên tham số 1"` · `combobox "Kiểu 1"` · `checkbox "Bắt buộc 1"` · `textbox "Mô tả tham số 1"` · `button "Xoá tham số 1"` · `link "Tạo command từ workflow này"` · `button "Lưu"` |
| Commands editor | `tab "Cấu hình"`/`"Ai dùng được"` · `textbox "Tên command"` · `textbox "Alias"` + `button "Thêm alias"` · `button "Bỏ alias tr"` · `textbox "Mô tả"` + `tab "VI"`/`"EN"` (trong `tablist "Ngôn ngữ"`) · `combobox "Thêm feature"` · `button "Bỏ feature core"` · `combobox "Workflow"` · `button "+ Thêm tham số"` · `textbox "Tên tham số 1"` · `combobox "Nguồn của target_lang"` · `combobox "Tham số của target_lang"` · `textbox "Giá trị của tone"` · `textbox "Output field"` · `combobox "Hiển thị"` · `radio "sync"`/`"async"` · `spinbutton "Timeout (giây)"` · `alert` chứa "thiếu input bắt buộc: target_lang" · `button "Lưu"` · `button "Nhân bản"`. **Không tồn tại** `button` nào tên "Chạy thử"/"Test" và không có `menuitem "Lịch sử"` (e2e kiểm count 0) |
| Features | như missing-screens §3, cộng `menuitem "Chuyển sang Beta"`/`"Bật"`/`"Tắt"` trong menu hàng. Thu hồi entitlement gõ **mã công ty** (`textbox "Gõ acme để xác nhận"`), xoá feature gõ **key** |

Dòng trùng role/tên trong cùng trang đều có hậu tố số thứ tự (`… 1`) hoặc tên đối tượng để chọn xác định (không dùng `.nth()` mơ hồ).

## 6. Hiệu năng (CONVENTIONS §6)

- **Bundle:** JS ban đầu hiện **106,9 KB** gzip, trần 150 KB. Thêm vào ban đầu: i18n M2 (~150 key × 2 ngôn ngữ ≈ +10 KB thô, ước +3 KB gzip), `nav.ts` mở rộng, `PlatformOnly`, `toast`. Ước tổng ≤ 112 KB. Không đưa `Popover`/`Switch`/`Textarea`/editor vào ban đầu: chỉ route-chunk nhập (autoCodeSplitting đã bật).
- **Chunk route ≤ 50 KB gzip** (ước): secrets ~12, workflows (list+editor) ~25, commands (list+editor) ~35, features ~25. Editor command tách thêm `lazy()` cho `AccessTab` (tab ít dùng). FE7 đo từng chunk; mở rộng `check-bundle` thêm `CHUNK_BUDGET_BYTES = 50 KB` (không đổi phép kiểm ban đầu, test hiện có giữ nguyên).
- **Bảng:** phân trang server `limit=50` → không virtualize (chỉ bắt buộc > 200). Danh sách chọn (RefPicker, Select Workflow/Feature/Tenant) lấy `limit=200`, render ≤ 50 mục, lọc phía client trong 200 và gọi lại server theo `q` (debounce 300 ms) khi tổng > 200.
- **Re-render:** hàng `DataTable` đã `memo`; cột `useMemo`; hàng `SchemaParamRow`/`ArgRow`/`InputMapRow` `memo` và chỉ `useWatch` đúng trường (không `watch()` cả form); Select tham số của bước 4 phụ thuộc `useWatch("args")` ở **một** nơi (`StepInputMap`) rồi truyền xuống. Hàm `validateInputMap` chạy `useMemo` theo `(schema, args, map)`. Switch ở danh sách Commands cập nhật lạc quan hàng đó, không refetch cả bảng (chỉ invalidate khi xong).
- **Truy vấn:** `staleTime` 30 s cho danh sách chọn (workflows/features/tenants), `keepPreviousData` cho list; huỷ request cũ khi đổi `q`. `usages` và `entitlements` chỉ nạp khi mở Popover/dialog/tab.

## 7. Câu chữ MỚI (VI | EN) — ngoài missing-screens §2, 3, 6

| Key | VI | EN |
|---|---|---|
| nav.group.features | CHỨC NĂNG | FEATURES |
| nav.group.security | BẢO MẬT | SECURITY |
| nav.commands / workflows / features / secrets | Commands / Workflows / Features / Secrets | Commands / Workflows / Features / Secrets |
| common.dismiss | Đóng | Close |
| common.moveUp / moveDown | Chuyển lên / Chuyển xuống | Move up / Move down |
| secrets.error.valueLength | Giá trị dài 8–2048 ký tự | Value must be 8–2048 characters |
| secrets.error.noteMax | Ghi chú tối đa 200 ký tự | Note can be at most 200 characters |
| secrets.field.noValueHint | Giá trị không xem lại được sau khi lưu | The value can't be viewed again after saving |
| secrets.note.title | Sửa ghi chú · {name} | Edit note · {name} |
| secrets.toast.noteSaved | Đã lưu ghi chú {name} | Saved note for {name} |
| secrets.col.unused | Chưa dùng | Unused |
| secrets.drawer.create / replace | Thêm secret / Thay giá trị | Add secret / Replace value |
| workflows.list.title | Workflows | Workflows |
| workflows.list.subtitle | Catalog dùng chung. Command và agent đều chọn workflow từ đây. Khai báo trước, gắn sau cũng được. | Shared catalog. Commands and agents both pick workflows from here. Declare first, attach later is fine. |
| workflows.list.create | + Khai báo workflow | + Declare workflow |
| workflows.list.search | Tìm theo tên, key, mô tả… | Search by name, key, description… |
| workflows.guide.title | Khai báo workflow | Declare a workflow |
| workflows.guide.s1.title / body | Tạo trên Dify / Dựng workflow bằng Claude session, lấy app key | Build it on Dify / Build the workflow with a Claude session and get the app key |
| workflows.guide.s2.title / body | Khai báo ở đây / Chọn secret, khai báo input, viết mô tả. Chưa gắn cũng được | Declare it here / Pick the secret, declare inputs, write the description. Unattached is fine |
| workflows.guide.s3.title / body | Gắn cho command hoặc agent / Command ở Admin · agent ở Agent Studio | Attach to a command or agent / Commands in Admin · agents in Agent Studio |
| workflows.guide.dismiss.aria | Ẩn hướng dẫn | Hide the guide |
| workflows.filter.all / on / off / unattached | Tất cả / Bật / Tắt / Chưa gắn | All / Enabled / Disabled / Unattached |
| workflows.filter.secret / clearSecret | Secret: {name} / Bỏ lọc secret | Secret: {name} / Clear secret filter |
| workflows.col.workflow / type / usedBy / status | Workflow / Loại / Đang được dùng bởi / Trạng thái | Workflow / Type / Used by / Status |
| workflows.usage.commands_one / _other | {count} command | {count} command / {count} commands |
| workflows.usage.agents_one / _other | {count} agent | {count} agent / {count} agents |
| workflows.unattached | Chưa gắn | Unattached |
| workflows.menu.edit / enable / disable / createCommand / delete | Sửa / Bật / Tắt / Tạo command / Xoá | Edit / Enable / Disable / Create command / Delete |
| workflows.createCommandFrom | Tạo command từ workflow này | Create a command from this workflow |
| workflows.tab.info / input / preview / usage | Thông tin / Input / Model thấy gì / Đang được dùng bởi | Details / Input / What the model sees / Used by |
| workflows.field.key / name / type / secret / baseUrl / outputField / description / enabled | Key / Tên / Loại / Secret / Base URL / Output field / Mô tả / Bật workflow | Key / Name / Type / Secret / Base URL / Output field / Description / Enable workflow |
| workflows.field.keyLocked | Key không đổi được sau khi tạo | Key can't be changed after creation |
| workflows.field.descHint | Viết như đang dặn một người mới: dùng khi nào, không dùng khi nào. | Write it as if briefing a newcomer: when to use it and when not to. |
| workflows.field.descCount | Agent đọc nguyên văn mô tả này để biết khi nào gọi workflow · {n}/400 | Agents read this description verbatim to decide when to call the workflow · {n}/400 |
| workflows.type.workflow / chat / agent | workflow / chat / agent | workflow / chat / agent |
| workflows.schema.title / add / max | Input / + Thêm tham số / Tối đa 50 tham số | Input / + Add parameter / At most 50 parameters |
| workflows.schema.col.name / type / required / description / options | Tên tham số / Kiểu / Bắt buộc / Mô tả tham số / Lựa chọn | Parameter name / Type / Required / Parameter description / Options |
| workflows.schema.optionsHint | Cách nhau bằng dấu phẩy | Separate with commas |
| workflows.schema.empty | Workflow chưa có input. Thêm tham số để command và agent truyền dữ liệu vào. | No inputs yet. Add parameters so commands and agents can pass data in. |
| workflows.preview.note | Minh hoạ cách agent thấy workflow này; Hub có thể thêm trường khác. | An illustration of how an agent sees this workflow; Hub may add other fields. |
| workflows.usage.empty | Chưa có command hay agent nào dùng workflow này. | No command or agent uses this workflow yet. |
| workflows.usage.agent | Agent …{id} | Agent …{id} |
| workflows.blocked.disable | Không tắt được {key}: đang được dùng bởi | Can't disable {key}: used by |
| workflows.delete.title / blocked / typeToConfirm / submit | Xoá {key}? / Không xoá được {key}: đang được dùng bởi / Gõ {key} để xác nhận / Xoá workflow | Delete {key}? / Can't delete {key}: used by / Type {key} to confirm / Delete workflow |
| workflows.schemaBreaks | Không lưu được: thay đổi này làm hỏng các command sau. Sửa chúng trước. | Can't save: this change breaks these commands. Fix them first. |
| workflows.toast.saved / deleted / enabled / disabled | Đã lưu {name} / Đã xoá {name} / Đã bật {name} / Đã tắt {name} | Saved {name} / Deleted {name} / Enabled {name} / Disabled {name} |
| workflows.empty | Chưa có workflow nào. Tạo workflow trên Dify (bằng Claude session) → dán app key vào secret → khai báo input và mô tả ở đây. | No workflows yet. Build a workflow on Dify (with a Claude session) → put the app key in a secret → declare inputs and description here. |
| workflows.empty.cta | + Khai báo workflow đầu tiên | + Declare your first workflow |
| workflows.error.keyFormat | Chỉ dùng chữ thường không dấu, số, dấu - (2–32 ký tự) | Use lowercase letters, digits and - only (2–32 chars) |
| workflows.error.keyTaken | Key đã được dùng | Key is already in use |
| workflows.error.nameRequired | Nhập tên workflow (tối đa 128 ký tự) | Enter a workflow name (at most 128 characters) |
| workflows.error.descLength | Mô tả dài 20–400 ký tự | Description must be 20–400 characters |
| workflows.error.secretRequired | Chọn một secret | Choose a secret |
| workflows.error.baseUrl | Nhập URL http:// hoặc https:// hợp lệ, không kèm tên đăng nhập | Enter a valid http:// or https:// URL without credentials |
| workflows.error.paramName | Chỉ dùng chữ, số, _ và không bắt đầu bằng số (tối đa 64 ký tự) | Use letters, digits and _ only, not starting with a digit (at most 64 chars) |
| workflows.error.paramDup | Tên tham số bị trùng | Duplicate parameter name |
| workflows.error.paramDesc | Mô tả tham số là bắt buộc | Parameter description is required |
| workflows.error.optionsRequired | Danh sách lựa chọn cần ít nhất một mục | Add at least one option |
| commands.tab.config / access | Cấu hình / Ai dùng được | Configuration / Who can use it |
| commands.access.summary | {tenants} tenant · {users} user | {tenants} tenants · {users} users |
| commands.access.col.key / name / features / users | Mã công ty / Tên / Feature / Số user | Company key / Name / Features / Users |
| commands.access.empty | Chưa tenant nào dùng được command này. Gán command vào một feature và cấp feature cho tenant. | No tenant can use this command yet. Put it in a feature and grant the feature to a tenant. |
| commands.access.inactive | Command đang tắt hoặc workflow của nó đang tắt: chưa ai dùng được. | The command or its workflow is disabled: nobody can use it yet. |
| commands.access.summaryTenants | {tenants} tenant | {tenants} tenants |
| commands.access.tenantLocked | Đã khoá | Locked |
| errors.invalidReference | Dữ liệu chọn đã cũ. Đã tải lại danh sách, hãy chọn lại. | The selection is out of date. The list was reloaded; please choose again. |
| commands.access.groupsLater | Quyền theo nhóm và người dùng chưa khả dụng. | Group and user access isn't available yet. |
| commands.step1 / step2 / step3 / step4 / step5 | Đặt tên và gói chức năng / Chọn workflow / Người dùng gõ gì / Đưa vào workflow / Hiển thị kết quả | Name and feature bundle / Choose a workflow / What the user types / Feed the workflow / Show the result |
| commands.field.name / alias / aliasAdd / description / features / featuresAdd | Tên command / Alias / Thêm alias / Mô tả cho người dùng / Feature quyết định ai thấy lệnh này / Thêm feature | Command name / Alias / Add alias / Description for users / Features decide who sees this command / Add feature |
| commands.field.workflow / outputField / render / mode / timeout / enabled | Workflow / Output field / Hiển thị / Chế độ / Timeout (giây) / Bật command | Workflow / Output field / Display / Mode / Timeout (seconds) / Enable command |
| commands.alias.remove.aria / feature.remove.aria | Bỏ alias {name} / Bỏ feature {name} | Remove alias {name} / Remove feature {name} |
| commands.render.markdown / text / json | Markdown / Văn bản / JSON | Markdown / Text / JSON |
| commands.mode.sync / async | sync / async | sync / async |
| commands.args.add / col.name / col.description / col.default / col.fallback / col.rest | + Thêm tham số / Tham số / Mô tả / Mặc định / Nếu trống lấy / Nuốt phần còn lại | + Add parameter / Parameter / Description / Default / If empty use / Take the rest |
| commands.args.syntax | Cú pháp | Syntax |
| commands.args.empty | Lệnh chưa có tham số: người dùng chỉ gõ /{name}. | No parameters: users just type /{name}. |
| commands.fallback.none / selection / page_text / page_url | Không / Đoạn bôi đen / Nội dung trang / URL trang | None / Selection / Page text / Page URL |
| commands.map.col.input / source / value | Input của workflow / Nguồn / Giá trị | Workflow input / Source / Value |
| commands.map.source.arg / selection / page_url / page_text / attachment / user_id / tenant_id / const | Tham số / Đoạn bôi đen / URL trang / Nội dung trang / File đính kèm / ID người dùng / ID tenant / Giá trị cố định | Parameter / Selection / Page URL / Page text / Attachment / User ID / Tenant ID / Fixed value |
| commands.map.source.aria / arg.aria / value.aria | Nguồn của {name} / Tham số của {name} / Giá trị của {name} | Source of {name} / Parameter for {name} / Value for {name} |
| commands.map.pickWorkflow | Chọn workflow để khai báo cách đưa dữ liệu vào. | Choose a workflow to map its inputs. |
| commands.map.dropped | Đã bỏ map của: {names} (workflow mới không có các input này). | Dropped mappings for: {names} (the new workflow has no such inputs). |
| commands.map.autoMapped | Đã tự map {names} theo tên tham số. | Auto-mapped {names} by parameter name. |
| commands.error.nameFormat | Chỉ dùng chữ thường không dấu, số, dấu - (2–32 ký tự) | Use lowercase letters, digits and - only (2–32 chars) |
| commands.error.nameTaken | /{name} đã được dùng bởi command khác | /{name} is already used by another command |
| commands.error.aliasDup / aliasMax | Alias bị trùng / Tối đa 5 alias | Duplicate alias / At most 5 aliases |
| commands.error.descRequired | Nhập mô tả (tối đa 200 ký tự) | Enter a description (at most 200 characters) |
| commands.error.featureRequired | Command phải thuộc ít nhất một feature | A command must belong to at least one feature |
| commands.error.workflowRequired | Chọn một workflow | Choose a workflow |
| commands.error.workflowDisabled | Workflow đang tắt. Bật workflow trước. | The workflow is disabled. Enable it first. |
| commands.error.argName / argDup / argRest | Tên chỉ gồm chữ thường, số, _ và bắt đầu bằng chữ / Tên tham số bị trùng / Chỉ một tham số được nuốt phần còn lại và phải là tham số cuối | Lowercase letters, digits and _ only, starting with a letter / Duplicate parameter name / Only one parameter can take the rest, and it must be last |
| commands.error.mapMissing | thiếu input bắt buộc: {names} | missing required input: {names} |
| commands.error.mapUnknown / mapUnknownArg | Input không có trong workflow: {names} / Tham số chưa khai báo: {names} | Input not in the workflow: {names} / Undeclared parameter: {names} |
| commands.error.constMax / outputField / timeout | Giá trị cố định tối đa 4000 ký tự / Nhập output field (tối đa 128 ký tự) / Timeout từ 1 đến 600 giây | Fixed value at most 4000 characters / Enter an output field (at most 128 characters) / Timeout must be 1–600 seconds |
| commands.warn.mapType | Nguồn "{source}" có thể không khớp kiểu {type} của {name}. Vẫn lưu được. | Source "{source}" may not match the {type} type of {name}. You can still save. |
| commands.toast.saved | Đã lưu /{name} | Saved /{name} |
| commands.editor.unsaved | Chưa lưu thay đổi | Unsaved changes |
| commands.breadcrumb.new | Command mới | New command |
| commands.duplicate.hint | Bản sao của /{name}: đã tắt, không có alias. | Copy of /{name}: disabled, no aliases. |
| features.disable.bodyNoCount | Các command trong feature biến khỏi menu trong vài giây. Run đang chạy vẫn chạy xong. | The feature's commands disappear from menus within seconds. Running jobs will finish. |
| features.toast.statusChanged | Đã chuyển {feature} sang {status} | Moved {feature} to {status} |
| features.toast.saved / deleted | Đã lưu {name} / Đã xoá {name} | Saved {name} / Deleted {name} |
| features.error.nameRequired / descMax | Nhập tên feature (tối đa 64 ký tự) / Mô tả tối đa 400 ký tự | Enter a feature name (at most 64 characters) / Description can be at most 400 characters |
| features.error.coreProtected | Feature core không thể xoá, tắt hay đổi sang Beta | The core feature can't be deleted, disabled or moved to Beta |
| features.tenants.col.key / name / users / grantedAt / grantedBy | Mã công ty / Tên / Số user đang dùng / Cấp lúc / Cấp bởi | Company key / Name / Active users / Granted at / Granted by |
| features.tenants.saveFirst | Lưu feature trước để cấp cho tenant | Save the feature first to grant it to tenants |
| features.tenants.pickerEmpty | Mọi tenant đã được cấp. | Every tenant is already granted. |
| features.commands.col.name / description / others | Tên / Mô tả / Feature khác | Name / Description / Other features |
| features.commands.addPlaceholder | Tìm command… | Search commands… |
| features.icon.package / calculator / languages / file-text / bar-chart / flask / users / shield | Gói / Máy tính / Dịch thuật / Tài liệu / Biểu đồ / Thử nghiệm / Người dùng / Bảo mật | Package / Calculator / Languages / Document / Chart / Experiment / Users / Shield |
| picker.more | Còn {n} kết quả, gõ để lọc | {n} more results, type to filter |
| picker.empty | Không có kết quả | No results |
| errors.secretInUse / workflowInUse / schemaBreaks / commandNameTaken / workflowDisabled / commandNeedsFeature / coreProtected / featureExclusive / inputMapInvalid | các câu tương ứng ở trên (map vào key `secrets.delete.blocked`, `workflows.blocked.*`, `workflows.schemaBreaks`, `commands.error.nameTaken`, `commands.error.workflowDisabled`, `commands.error.featureRequired`, `features.error.coreProtected`, `features.delete.blocked`, `commands.error.mapMissing`) | idem |

Plural: `_one`/`_other` đủ ở **cả hai** locale (VI hai dạng cùng chữ) để `i18n:check` khớp key; FE2 sửa `i18n-keys.test.ts` chấp nhận hậu tố plural khi mã dùng `count`.
FE2 chốt danh sách ~16 icon (8 icon đầu ở bảng trên, thêm cho đủ) kèm nhãn VI/EN; tên lucide thật ánh xạ trong `features/features/lib/icons.ts` (`bar-chart` → `ChartBar`, `flask` → `FlaskConical`).

## 8. Bảng mã lỗi API → câu hiển thị (`lib/errors.ts`, mở rộng `STATIC_KEYS`/`ERROR_MESSAGE_KEYS`)

| Mã (M2-R) | Hiển thị |
|---|---|
| `SECRET_NAME_TAKEN` (R04) | inline `secrets.error.nameTaken` |
| `SECRET_IN_USE {used_by[]}` (R05) | dialog chặn (D-list) |
| `WORKFLOW_IN_USE {action:"delete"|"disable",commands[],agents[]}` (R11) | dialog chặn (D-list) theo `action` (`workflows.delete.blocked` / `workflows.blocked.disable`); dùng luôn `details`, không gọi lại `usages` |
| `SCHEMA_BREAKS_COMMANDS {commands:[{id,name,missing[],unknown[]}]}` (R18) | Alert đỏ + D-list, mỗi command ghi biến thiếu/lạ |
| `WORKFLOW_DISABLED` (R14) | `commands.error.workflowDisabled` |
| `COMMAND_NAME_TAKEN {name}` (R13) | inline `commands.error.nameTaken` |
| `INPUT_MAP_INVALID {missing,unknown,unknown_args}` (R17) | câu dựng từ `details` (`message` server cố định tiếng Anh, không hiển thị): `mapMissing` ({names} = `details.missing`, "thiếu input bắt buộc: target_lang"), `mapUnknown`, `mapUnknownArg` + đánh dấu hàng |
| `COMMAND_NEEDS_FEATURE` (R19) | `commands.error.featureRequired` |
| `CORE_FEATURE_PROTECTED` (R20, R22) | toast `features.error.coreProtected` |
| `FEATURE_HAS_EXCLUSIVE_COMMANDS {commands[]}` (R21) | dialog chặn |
| `KEY_TAKEN` (dùng chung với M1; `message` server chỉ để log) | tuỳ màn: `workflows.error.keyTaken` / `features.error.keyTaken` |
| `VALIDATION_ERROR` của `/admin/secrets*` | inline theo `details` trường, câu tĩnh; **không** dùng `message` server |
| `VERSION_CONFLICT` | D12 (G14) |
| `INVALID_REFERENCE {field, ids}` | toast bền `errors.invalidReference` (danh sách chọn đã cũ; refetch danh sách chọn) |
| `FORBIDDEN`, `NOT_FOUND`, mạng | như M1 |

## 9. Yêu cầu contract: đã chốt (spec §3, commit 63ead5c)

Backend-lead đã trả lời Y1–Y10 ở spec §3 và `plan.md` §11. Không còn yêu cầu mở. Khi code, lấy kiểu từ `@ai/contracts`, không tự khai báo.

| # | Kết quả đã chốt | FE dùng |
|---|---|---|
| Y1 | Secret có `id`; workflow gửi `secret_id`, response `secret:{id,name}`; `GET /admin/features/:id/entitlements` → `{items,total}` (chỉ chưa thu hồi; `core` rỗng) | Select secret có value = `id`; tab Tenant dùng `ListQueryBase` (`q`, phân trang) |
| Y2 | `FeatureDetail.commands[]` + `affected_user_count`; `POST/PATCH` nhận `command_ids` (thay cả tập); `COMMAND_NEEDS_FEATURE {commands}` | Tab Commands nháp lưu chung; hộp thoại Tắt dùng `affected_user_count` |
| Y3, Y5, Y9 | Item list đủ cột; `counts` `{all,on,off}` / `{all,on,off,unattached}` / `{all,on,beta,off}`; `?feature=` và `?workflow=` theo id; `?secret=<NAME>`; `is_core` | Chip có số; `core` nhận biết bằng `is_core` ("Mọi tenant") |
| Y4 | `Command.warnings[]`; `INPUT_MAP_INVALID.details` đủ 3 khoá | §8, D9 |
| Y6 | `PATCH /admin/secrets/:name {note: string or null}` | Drawer Sửa ghi chú |
| Y7 | `GET /admin/commands/:id/access` → `{items,total,command_active}` có phân trang | §3.5 tab Ai dùng được |
| Y8 | `fallback ∈ ARG_FALLBACKS`; `output.field` bắt buộc 1–128 | Select fallback, bước 5 |
| Y10 | `updated_by` = username hoặc null | Cột "Cập nhật": thiếu thì chỉ hiện ngày |

Giới hạn lấy từ contract: tham số workflow ≤ 50, mô tả ≤ 400, lựa chọn ≤ 50 mục × 100 ký tự; tham số lệnh ≤ 20, `^[a-z][a-z0-9_]{0,31}$`; alias ≤ 5; `base_url` ≤ 2048; `output_field` ≤ 128; mô tả command VI/EN ≤ 200; `const` ≤ 4000; `default` ≤ 1000; `icon` `^[a-z0-9-]{1,40}$`.


Phụ thuộc task (điều phối đã sửa trong tasks.md, FE ghi nhận): FE2 phụ thuộc thêm Q2; FE1a phụ thuộc thêm T2 và FE0b.

## 10. Artboard / ADR đề xuất

- **ADR:** không (D1). Nếu sau này đòi editor JSON hoặc kéo-thả → ADR Proposed riêng + Gate.
- **Artboard:** không bắt buộc. Tuỳ chọn, **không chặn Gate**: (1) Workflows — trang editor 4 tab (artboard hiện chỉ vẽ panel cạnh danh sách, D2); (2) Commands — bản editor bỏ panel "Chạy thử" (artboard hiện còn Test panel, FR-23 là M5). Features danh sách/editor dùng mẫu A/B, không cần vẽ.

## 11. Câu hỏi (kèm mặc định đề xuất)

Không có câu chặn Gate. Hai chỗ đề nghị người dùng xác nhận (mặc định đã áp dụng, đổi thì sửa ở D2/D5):
1. Workflows/Commands editor là **trang riêng** thay vì panel/drawer như hình vẽ Workflows? → Mặc định **trang riêng** (ui-admin §3 cho Command và Workflow).
2. Giữ nguyên câu "có hiệu lực sau vài giây" ở toast cấp feature dù Hub chưa đọc catalog ở M2 (M2-R24)? → Mặc định **giữ** (câu chữ design đã duyệt; hiệu lực thật là việc của Hub/M3).
Các yêu cầu contract Y1–Y10 đã được backend-lead chốt (§9); không còn câu hỏi mở.

## 12. Chốt cho QC (FE2, trả lời Q2 của spec §9)

| Chủ đề | Chốt (nguyên văn) | Key |
|---|---|---|
| Nút xác nhận xoá secret | `Xoá secret` (EN `Delete secret`) | `secrets.delete.submit` |
| Nút xác nhận xoá feature | `Xoá feature` (EN `Delete feature`) | `features.delete.submit` |
| Nút xác nhận thu hồi entitlement | `Thu hồi feature` (EN `Revoke feature`) | `features.revoke.submit` |
| Dialog xoá secret / feature | `Xoá {name}?` / `Xoá {feature}?`; ô gõ `Gõ {name} để xác nhận` / `Gõ {key} để xác nhận` (feature gõ **key**) | `secrets.delete.title/typeToConfirm`, `features.delete.title/typeToConfirm` |
| H1 editor Workflows | tạo: `Workflow mới`; sửa: **tên workflow** (không phải key) | `workflows.editor.titleNew` |
| H1 editor Features | tạo: `Feature mới`; sửa: **tên feature theo ngôn ngữ đang dùng** | `features.editor.titleNew` |
| H1 editor Commands | tạo: `Command mới`; sửa: `/{tên}` | `commands.editor.titleNew` |
| Tooltip switch command khoá | `Bật workflow {key} trước` (đã có ở missing-screens §2) | `commands.list.workflowOff` |
| Lỗi tên trùng phía client | `/{name} đã được dùng bởi command khác`, hiện khi blur ô tên (kiểm bằng danh sách đã tải) và khi server trả `COMMAND_NAME_TAKEN` | `commands.error.nameTaken` |
| Nhân bản | `Bản sao của /{name}: đã tắt, không có alias.`; tên mặc định `{name}-copy` | `commands.duplicate.hint` |
| Đổi ngôn ngữ | Locale lấy từ `users.locale` khi **đăng nhập** (`LoginPage` gọi `i18n.changeLanguage(user.locale)`), rồi `ai.locale` trong localStorage, rồi ngôn ngữ trình duyệt. Menu tài khoản đổi và `PATCH /auth/me {locale}`. Test EN (sửa `users.locale` rồi đăng nhập) khớp hành vi này | (M1, không đổi) |

Xung đột cấu trúc JSON: `commands.empty` và `workflows.empty` vừa là câu vừa có `.cta` → câu đổi thành `commands.empty.text`, `workflows.empty.text` (`.cta`, `.noWorkflow` giữ). Test khoá không tham chiếu hai key này.
