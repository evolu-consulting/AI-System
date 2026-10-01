# Plan · M3-permissions · Frontend (frontend-lead)

Chế độ PLAN · 2026-10-02 · Bổ sung cho `spec.md` §5 và §6 (phần FE). File này **không** sửa contract; kết quả đối chiếu contract ở §9 "Yêu cầu contract: đã chốt" (backend đã chốt ở spec §3 + `plan.md` §11, commit 2d93194; kiểu lấy từ `@ai/contracts`, không tự khai báo).
Nguồn: `spec.md` §1–2, §8, §9 · `design/admin/ui-admin.md` 7.14, 7.15, F3, F4 · `specs/_design/admin-missing-screens.md` §5, §12.5 · canvas `Groups`, `Access`, `Users`, `States` · `readiness/2026-10-01-admin-m1-m4.md` (đã chấp nhận) · `M2-catalog-command/plan-frontend.md` (shell, shared, cổng hook) · `CONVENTIONS.md` §2, §6 · `TECH-DEBT.md` #7, #14.
Quy ước câu chữ: chuỗi lấy nguyên văn từ missing-screens §5/§12.5 và canvas; chuỗi **mới** ở §7. Trùng key thì missing-screens thắng.

## 0. Quyết định chốt (Luật 2; ghi vào `spec.md` §9 "Trong lúc làm" khi BUILD)

| # | Quyết định | Lý do |
|---|---|---|
| D1 | **Không thêm thư viện, không ADR.** DiffViewer tự viết (hàm `diffFields` + bảng 3 cột, không diff từng chữ); ma trận tự viết cửa sổ hoá hai chiều (`useGridWindow`, không `react-virtual`); tách chuỗi dán bằng regex | Spec §1 ưu tiên không thêm; bundle |
| D2 | **Đã được người dùng chấp nhận (A2, A4, A6, A11):** **A4** câu modal có `{user}` khi `current.updated_by` có (workflow, command, feature, group), câu không `{user}` cho user/tenant/`null`; bỏ vế "Lịch sử vẫn giữ v{n}" (M3-R21, R22). **A6** không có UI cấp feature trực tiếp cho user (chỉ hiện lý do `grant_user` ở Kiểm tra quyền). **A11** ô Groups trong drawer user **chỉ đọc** (chip link tới `/groups/$id` + gợi ý, lệch artboard `Users` đã ghi). **A2** không ảnh hưởng FE | Spec §9, chốt tại Gate |
| D3 | **`ConflictDialog` một `AlertDialog`** (Escape và click nền không đóng; chỉ 3 nút), nạp `lazy()`. `Xem khác biệt` mở rộng chính hộp thoại (max-w-3xl, nút giữ `aria-expanded`, bấm lại thu gọn). `Ghi đè` mở `ConfirmDialog` **con** (alertdialog thứ hai, tên riêng nên không trùng role+tên khi e2e: hộp cha bị Radix `aria-hidden`) | missing-screens §12.5, M3-R20 |
| D4 | **Diff so trên dạng payload API, không so state form thô:** mỗi feature cung cấp `toComparable(values)` (chính hàm tạo body PATCH) và `entityToValues(current)`; `diffFields(toComparable(mine), toComparable(entityToValues(current)))` đã loại `version/updated_*/id`, phẳng hoá khoá `description.vi`, `args[1].default`, chỉ trả trường **khác**, tối đa 50 dòng + "Còn {n} trường khác". Giá trị chuỗi hiện có nháy `"en"` như artboard, `undefined/null` hiện `(trống)` | Artboard States 12.5; không lộ trường server |
| D5 | **Sau khi 409:** `Ghi đè` gửi lại **cùng body** với `version = current.version`; nếu lại 409 → nạp `current` mới, hộp thoại mở lại (không vòng tự động). `Tải bản mới` = `form.reset(entityToValues(current))` + version mới + toast `conflict.toast.loaded`. Editor Workflows/Commands áp cách của Features (version từ phản hồi lưu, `keepDirtyValues`) để xử lý TECH-DEBT #14 trong FE1b/FE1c | M3-R20, TD#14 |
| D6 | **Thao tác nhanh ở danh sách** (Switch bật/tắt command và workflow, đổi trạng thái feature, khoá/mở khoá user) cũng mở `ConflictDialog` với `mine` = `{enabled: x}` / `{status: x}` (chỉ khoá mình đổi, nên diff một dòng); `Ghi đè` = gửi lại hành động với version mới; `Tải bản mới` = refetch hàng + toast. Bỏ hẳn nút toast "Tải lại" của M1/M2 (giữ key `errors.versionConflict` làm câu dự phòng khi `details.current` hỏng) | Spec: thay "Tải lại" ở mọi nơi |
| D7 | Cổng hook (bài học M2): **component chỉ gọi hook** của feature mình; mọi `api.ts`/`http`/`ApiError` nằm trong `hooks/` hoặc `lib/`; **hook ≤ 50 dòng** (một hook một việc, hợp nhất bằng hook cha mỏng); thư mục ≤ 10 file ngang hàng (chia `components/<nhóm>/`); đọc feature khác **chỉ qua hook export của `api.ts` bên kia** (hook của mình gọi, component không gọi) | `CONVENTIONS` §2, depcruise `component-no-fetch`, review M2 |
| D8 | `useViewedTenant` (tenant đang xem: tenant_admin cố định, platform chọn qua `?tenant=<mã>`) hiện nằm trong `users/hooks/use-users-view.ts`. M3 tách thành `lib/use-viewed-tenant.ts` **nhận danh sách tenant làm tham số** (hàm thuần theo dữ liệu, không import api); Groups/Access dùng `useTenantOptions` của `features/tenants/api.ts` (thêm hook này, FE2a); Users đổi sang bản dùng chung ở FE4a. Bản trùng `useTenantOptions` ở `users/api.ts` và `features/api.ts` để nguyên (nợ, ghi `TECH-DEBT.md` khi BUILD) | Tránh nhân bản lần thứ ba |
| D9 | **Platform_admin chưa chọn tenant** ở Groups/Ma trận/Kiểm tra quyền: không gọi API, hiện `EmptyState` "Chọn một tenant…" (không dùng "list trả tất cả" của API, vì cột Group, ma trận, tạo group đều thuộc **một** tenant). Nút `+ Tạo group` khoá tới khi chọn tenant (như `canCreate` của Users) | M3-R06 `TENANT_REQUIRED` |
| D10 | **Ma trận lưu qua batch duy nhất** (`PUT /admin/grants/batch`), nháp là `Map<"featureId:groupId", boolean>` chứa **chênh lệch so với server**; chỉ khi > 0 mới bật `Lưu`/`Huỷ`; > 200 thao tác → chặn `Lưu` kèm câu `access.matrix.tooMany` (không tự chia nhiều batch vì mất tính một transaction). Server từ chối batch (một phần tử sai) → không áp gì, FE giữ nháp. `NOT_ENTITLED {feature_ids}` → **đánh dấu cả hàng** của từng feature trong `feature_ids` (viền đỏ + `access.error.notEntitled`, hàng chuyển sang khoá sau khi refetch); `CORE_FEATURE_PROTECTED` (không details) và lỗi khác → toast tĩnh. Backend không trả vị trí từng ô (`details.items` bị từ chối) | M3-R08 |
| D11 | **Hàng của ma trận:** theo M3-R09 (core "Mặc định" khoá, feature đã entitlement, feature thu hồi còn grant = hàng mờ "Đã thu hồi entitlement" không sửa). **Thêm theo artboard** `Access`: feature **chưa mở** (không entitlement, không grant) là hàng mờ "Chưa mở" nằm dưới cùng, **ẩn mặc định**, hiện bằng `Switch "Hiện feature chưa mở ({count})"`; không sửa được. `state` đã có ở contract (C5) | Spec + artboard |
| D12 | **Dán danh sách:** tách bằng `parseUsernameList` **của `@ai/contracts`** (`/[\s,]+/`, trim, chữ thường, bỏ trùng giữ thứ tự; FE không viết lại, `groups/lib/paste.ts` chỉ bọc kiểm `> GROUP_PASTE_MAX` và phần tử `> USERNAME_INPUT_MAX`); > 500 → lỗi inline, nút khoá. **Xem trước** theo artboard bằng `dry_run: true` (C4 đã chốt; debounce 400 ms, huỷ request cũ, không bump `config_version`): "Không tìm thấy: an.vu · Thêm 2 người" với `count` = `added.length`. Sau POST thật: textarea chỉ giữ lại `not_found` để sửa (partial add, M3-R03) | RD#30, artboard `Groups` |
| D13 | Trong khi `Lưu` ở editor Group: `Đổi tên` (rename) là **hộp thoại** (artboard nút `Đổi tên` cạnh tiêu đề) sửa Tên + Mô tả, gửi `PATCH` kèm `version`; `/groups/new` là trang một cột (Key, Tên, Mô tả, `Tạo group`). Key luôn `readOnly` sau khi tạo. Không hiện banner quota "112%" của artboard (M4) | M3-R01, phạm vi |
| D14 | Toast cấp/lưu giữ câu "…trong vài giây" của design (như D5 M2); hiệu lực thật do NOTIFY (T3) và Hub (M5) | Design là chuẩn |
| D15 | `?command=` của `effective-access` **có ở contract nhưng FE không dùng ở M3** (dành cho qc, F4): một lần `GET effective-access` trả đủ feature + command (≤ 1.000, `command_total`), lọc phía client | Giảm gọi API |

## 1. Màn, route, bố cục

Mọi trang trong khung: `<main id="main">`, H1 nhận focus (`PageHeader`), `document.title = "<H1> · Admin"`. `validateSearch` viết tay (không zod). Bộ lọc trên URL, đổi bộ lọc bỏ `page`. Guard: `member` không vào khung (đã có ở `AuthedLayout`); `tenant_admin` thấy Groups, Phân quyền, Users của tenant mình; `platform_admin` thêm `TenantPicker` (`?tenant=<mã>`).

| Route (`routes/_authed/…`) | Màn | Bố cục | Artboard |
|---|---|---|---|
| `/groups` (`groups/index.tsx`) `?tenant&q&page` | Danh sách Groups | Mẫu A: header ("Groups" · subtitle · `+ Tạo group`), `TenantPicker` (platform), ô tìm, bảng. Cột: **Group** (tên + key mono; `beta-testers` có badge "Có sẵn" + dòng "Thấy các feature đang Beta") · **Thành viên** · **Feature** · **Agent** ("—", tới M5) · `⋯` (Sửa · Xoá). `beta-testers` (`is_beta`): không có "Xoá" (menuitem disabled + tooltip) | `Groups` (đối chiếu), mẫu A |
| `/groups/new` (`groups/new.tsx`) `?tenant` | Tạo group | Một cột `max-w-xl`: Key · Tên (`LocalizedInput` VI/EN) · Mô tả (đếm `n/400`) · `Huỷ` · `Tạo group` → `/groups/$id?tab=members` | mẫu B (không artboard) |
| `/groups/$groupId` (`groups/$groupId.tsx`) `?tab=members\|features\|agents&q&page` | Editor Group | Mẫu B đúng artboard `Groups`: breadcrumb "Groups › Kế toán" · header (tên, "{tenant_name} · {tenant_key}", "8 thành viên · 2 feature", nút `Đổi tên`, `⋯` Xoá) · 3 tab **Thành viên · Feature · Agent** | `Groups` |
| `/access` (`access.tsx`) `?tab=matrix\|check&tenant&user&show=unopened` | Phân quyền | `PageHeader` + `Tabs` **Ma trận · Kiểm tra quyền** (đúng artboard `Access`, hai khối) | `Access` |
| `/users` (đổi) `?group=<key>` | Users | Thêm cột **Groups**, `Select "Group"` ở thanh lọc, tab **Quyền hiệu lực** trong drawer sửa, ô Groups chỉ đọc (A11) | `Users`, missing-screens §5 |
| `/commands/$commandId?tab=access` (đổi) | Tab "Ai dùng được" | Thêm cột Group được cấp, "Số user thấy"; bỏ card "chưa khả dụng" | M2 §3.5 |
| Mọi editor/danh sách có `version` | `ConflictDialog` | Hộp thoại chung (§3.1) | `States` 12.5 |

Menu (`features/shell/lib/nav.ts`): nhóm `TRUY CẬP` = **Tenants** (platform) · **Users** · **Groups** · **Phân quyền**. `tenant_admin` thấy Users, Groups, Phân quyền. `crumbsFor()` thêm `/groups*`, `/access`. Menu Groups vào ở FE2a, Phân quyền ở FE3a (route phải có trước khi hiện).

### 1.1 Trạng thái từng màn

Dùng `components/shared/states`. Lỗi tải = `ErrorState` (`alert` + `Thử lại`); lỗi hành động = toast bền trừ khi ghi "inline"; **409 xung đột = `ConflictDialog`** (không toast).

| Màn | Đang tải | Rỗng | Lỗi tải | Không có quyền / 404 | Lỗi hành động / 409 |
|---|---|---|---|---|---|
| Groups list | skeleton bảng 8 hàng | `groups.empty.text` + `+ Tạo group đầu tiên`; lọc: `state.empty.noResults` + `Xoá bộ lọc`; platform chưa chọn tenant: `groups.selectTenant` | `ErrorState` | `FORBIDDEN` giữa phiên → toast `state.forbiddenAction`; tenant lạ trong `?tenant=` → `NotFoundState` | xoá lỗi → toast bền; `BETA_GROUP_PROTECTED` → toast `groups.error.betaProtected` |
| Group editor | skeleton header + tab | tab Thành viên `groups.members.empty`; tab Feature `groups.features.empty` | `ErrorState`; id lạ hoặc tenant khác → `NotFoundState` ("Về danh sách" → `/groups`) | như trên | `KEY_TAKEN` inline dưới Key; `VALIDATION_ERROR` inline theo trường; **`VERSION_CONFLICT` → `ConflictDialog` (rename)**; `BETA_GROUP_PROTECTED` toast; thêm/bớt thành viên lỗi → toast bền (idempotent, không 409) |
| Tab Thành viên | skeleton 5 hàng | `groups.members.empty` | `ErrorState` nhỏ trong tab | — | dán: `not_found` hiện inline dưới ô; `VALIDATION_ERROR` (>500) chặn trước ở client |
| Tab Feature | skeleton danh sách | `groups.features.empty` (chỉ còn hàng core) | `ErrorState` nhỏ | — | `NOT_ENTITLED` → toast `access.error.notEntitled` + refetch; `CORE_FEATURE_PROTECTED` → toast `access.error.coreProtected` |
| Tab Agent | — | Card "Chưa khả dụng" (`common.unavailable` + `groups.agents.body`) | — | — | — |
| Ma trận | skeleton lưới (header thật + 8 hàng) | không có group: `access.matrix.noGroups` + `Tạo group`; platform chưa chọn tenant: `access.selectTenant` | `ErrorState` | — | batch lỗi: `NOT_ENTITLED {feature_ids}` → đánh dấu cả hàng + toast + refetch, bỏ nháp của hàng đã khoá; `INVALID_REFERENCE {field, ids}` → toast `errors.invalidReference` + refetch; `CORE_FEATURE_PROTECTED`/lỗi khác → toast; **không áp một phần** (`access.error.batchFail`) |
| Kiểm tra quyền | skeleton 3 nhóm | chưa chọn user: `access.check.prompt`; user chỉ core: `users.access.empty` | `ErrorState`; user lạ/tenant khác (404) → `access.check.userNotFound` | — | cấp cho group lỗi → toast bền; `NOT_ENTITLED` → toast `access.error.notEntitled` |
| Users (đổi) | như M1 | như M1; lọc group không ai: `state.empty.noResults` | như M1 | — | như M1 + D6 (khoá/mở khoá 409 → `ConflictDialog`) |
| Tab Quyền hiệu lực (drawer) | skeleton 3 nhóm | `users.access.empty` | `ErrorState` nhỏ trong tab | — | — |
| Command › Ai dùng được | như M2 | M2 + nhóm trống: `commands.access.groups.none` | như M2 | — | — |

Mất kết nối: `ConnectionBanner` khoá nút Lưu (đã có). `UnsavedGuard` cho `/groups/new`, hộp thoại Đổi tên khi có chữ, nháp ma trận (rời trang khi có thay đổi chưa lưu, `access.matrix.dirty` ≥ 1) và chế độ Sửa của tab Feature.

### 1.2 Thành phần shadcn

Đã có đủ (`alert-dialog dialog sheet tabs select switch textarea popover checkbox badge table tooltip skeleton alert dropdown-menu breadcrumb sonner`). **Không cần** thêm gói `radix-ui`, không `shadcn add`. Ô tick của ma trận dùng `<button role="checkbox" aria-checked>` tự viết (nhẹ hơn 40.000 `Checkbox` Radix; tri-state `mixed` cho tick hàng/cột).

### 1.3 Component dùng chung mới (≥ 2 feature)

| Component | Việc | Dùng ở |
|---|---|---|
| `components/shared/conflict/ConflictDialog` (+ `DiffTable`, `LazyConflictDialog`, hook `use-conflict`) | §3.1 | Users, Tenants, Workflows, Commands, Features, Groups |
| `components/shared/access/AccessExplainer` (+ `ExplainerSection`, `reasons.ts`) | trình bày `effective-access` (Feature · Command · Agent, lý do câu chữ); prop `readOnly`, `onGrantToGroup?`, `commandQuery?`; **không fetch** | Access (Kiểm tra quyền), Users (tab Quyền hiệu lực) |
| `lib/use-viewed-tenant.ts` | D8 | Groups, Access, Users |
| `lib/conflict.ts` (`parseConflict`, `ConflictInfo`), `lib/diff-fields.ts` (`diffFields`) | hàm thuần | các hook `use-<f>-conflict` |

## 2. Cấu trúc file (feature-first, file ≤ 400 dòng, component ≤ 200, hàm ≤ 50, hook ≤ 50, thư mục ≤ 10 file)

```
apps/admin-web/src/
├─ routes/_authed/        groups/{index,new,$groupId}.tsx · access.tsx · (users.tsx: thêm `group` vào search)   # mỏng: validateSearch + page
├─ lib/                   conflict.ts · diff-fields.ts · use-viewed-tenant.ts · errors.ts (+ mã M3) · format.ts (+ formatDateTime nếu khác ngày)
├─ components/shared/
│  ├─ conflict/           ConflictDialog.tsx · DiffTable.tsx · LazyConflictDialog.tsx · use-conflict.ts
│  └─ access/             AccessExplainer.tsx · ExplainerSection.tsx · ReasonText.tsx · reasons.ts
└─ features/
   ├─ shell/lib/nav.ts    + Groups, Phân quyền; crumbsFor()
   ├─ groups/             api.ts · README.md
   │  ├─ pages/           GroupsPage · GroupCreatePage · GroupEditorPage
   │  ├─ components/list/    GroupTable · group-columns.tsx · GroupRowMenu · GroupDeleteDialog · GroupsEmpty
   │  ├─ components/editor/  GroupForm · GroupHeader · GroupRenameDialog · GroupTabs · AgentTab
   │  ├─ components/members/ MemberTable · MemberAdder · PasteMembers · PasteResult · MemberRemoveButton
   │  ├─ components/grants/  GroupFeaturesTab · GroupFeatureList · GroupFeatureEdit
   │  ├─ hooks/           use-groups-view · use-group-queries · use-group-delete · use-group-form · use-group-conflict · use-group-members · use-paste-members · use-group-grants
   │  └─ lib/             schemas(.test) · paste(.test) · meta(.test)   # meta: isProtected(key)
   ├─ access/             api.ts · README.md
   │  ├─ pages/           AccessPage
   │  ├─ components/matrix/  GrantMatrix · MatrixToolbar · MatrixHeader · MatrixRow · MatrixCell · MatrixEmpty
   │  ├─ components/check/   CheckTab · UserPicker · CommandSearch · GrantToGroupDialog
   │  ├─ hooks/           use-access-view · use-matrix-data · use-matrix-draft · use-matrix-save · use-grid-window · use-effective-access · use-grant-to-group
   │  └─ lib/             matrix(.test) · grid-window(.test)
   ├─ users/              components/ chia thành list/ và drawer/ (§5 FE4a) + UserGroupsField · UserGroupChips · UserAccessTab; hooks/ + use-user-access · use-user-conflict
   ├─ commands/           components/editor-parts/ + AccessGroups · hooks/ + use-command-conflict
   ├─ workflows/ · features/ · tenants/   hooks/ + use-<f>-conflict
```
Gọi API **chỉ** trong `features/<f>/api.ts`. Cross-feature: Users đọc `useEffectiveAccess` (access) và `useGroupOptions` (groups); Access đọc `useGroupOptions`, `useUserOptions` (users); Commands không đọc feature khác; **luôn qua hook của mình bọc hook export của `api.ts` bên kia**. Mỗi feature mới có `README.md` ≤ 30 dòng (mã FR); mỗi file đầu có comment mã `ADM-FR-xx`.
Hiện `users/components/` đã đủ 10 file: FE4a chuyển thành `list/` (UserTable, UserFilters, UsersEmpty, CreateUserButton) và `drawer/` (UserDrawer, UserForm, ResetPasswordDialog, TempPasswordStage, UncopiedConfirm, UserActionDialog + file mới) **trước** khi thêm file (cập nhật import, không đổi hành vi). `features/features/hooks/` còn đúng 1 chỗ trống (nhận `use-feature-conflict`); `features/features/components/` đủ 10, M3 không thêm file ở đó.

## 3. Chi tiết từng màn

### 3.1 `ConflictDialog` (ADM-FR-55, AC-A07; M3-R20…R22)

- **Props** (trình bày, không fetch, không `http`): `{open, entity: "user"|"tenant"|"workflow"|"command"|"feature"|"group", mineVersion, latestVersion, updatedAt, updatedBy: string|null, rows: DiffRow[], moreRows: number, onOverwrite(): Promise<void>, onReload(): void}`.
- **Bước chọn:** `AlertDialog` tiêu đề `conflict.title`; mô tả `conflict.body.byUser` (khi `updatedBy`) hoặc `conflict.body.anon`; `{time}` = `formatClock(updatedAt)` (đã có); 3 nút `Xem khác biệt` · `Ghi đè` · `Tải bản mới`. Focus vào nút `Tải bản mới` (lựa chọn an toàn nhất) khi mở. Không nút Đóng/Huỷ; Escape và click nền bị chặn.
- **Xem khác biệt:** `DiffTable` (`table "Khác biệt…"`, cột **Trường** mono · **Bản của bạn** · **Bản mới nhất (v{n})**), tối đa 50 dòng + `conflict.diff.more`; không có dòng nào khác → `conflict.diff.empty`.
- **Ghi đè:** `ConfirmDialog` mức vừa (alertdialog con) tiêu đề `conflict.overwrite.titleUser|titleAnon`, mô tả `conflict.overwrite.body` ({n} = `latestVersion`, {next} = `latestVersion + 1`), nút `Huỷ` · `Ghi đè` → `onOverwrite()`.
- **Hook `use-conflict`** (≤ 50 dòng, trong `components/shared/conflict/`): `useConflict({entity, buildRows(current), submit(version), onReload(current)})` → `{dialogProps, capture(err, ctx): boolean}`; `capture` gọi `parseConflict(err)`; trả `true` khi là `VERSION_CONFLICT` (đã mở hộp). State giữ `{current, updatedAt}`; `Ghi đè` thành công → đóng; lỗi khác → đóng + chuyển cho `onError` của hook cha; lại 409 → thay `current`, giữ mở.
- **`parseConflict(err): ConflictInfo | null`** (`lib/conflict.ts`): `ApiError` code `VERSION_CONFLICT` có `details.current.version` số và `details.updated_at` chuỗi, ngược lại `null` (rơi về toast `errors.versionConflict`, **không** nút "Tải lại"). `updatedBy` = `current.updated_by` nếu là chuỗi không rỗng, ngược lại `null` (user/tenant luôn `null` theo A4).
- **`diffFields(a, b)`** (`lib/diff-fields.ts`, thuần, có test): đệ quy đối tượng/mảng, khoá `a.b`, `a[1].c`; so sâu; bỏ `version`, `updated_at`, `updated_by`, `created_at`, `id`; sắp theo thứ tự xuất hiện; giá trị hiển thị qua `formatDiffValue` (chuỗi có nháy, số/bool thô, `null/undefined` → `""` + cờ `empty`).
- **Gắn vào feature** (FE1a–d, FE2b): mỗi feature có `use-<f>-conflict.ts` (≤ 50 dòng) tạo `useConflict` với `buildRows = diffFields(toComparable(values), toComparable(entityToValues(current)))`, `submit = (v) => mutate({...body, version: v})`, `onReload = reset(entityToValues(current))`. Form hook cũ chỉ đổi nhánh lỗi 409: gọi `capture`. Phần thao tác nhanh (D6) dùng cùng hook với `mine` một khoá.
- **A11y:** `role="alertdialog"` `aria-labelledby`/`describedby`; `DiffTable` có `<caption class="sr-only">`; thay đổi bước (chọn ↔ khác biệt) không làm mất focus (focus giữ ở nút vừa bấm).

### 3.2 Groups (ADM-FR-62, FR-55; M3-R01…R06, R23)

- **Danh sách:** gọi `GET /admin/groups?tenant_id&q&limit=50&offset` (`keepPreviousData`), sắp do server (`beta-testers` đầu). Hàng bấm → `/groups/$id`. Xoá = `ConfirmDialog` **nặng** (gõ `key`), câu `groups.delete.*` nêu `member_count`/`feature_count` của hàng (M3-R04), toast `groups.toast.deleted`; `is_beta` không có nút (menuitem `disabled` + tooltip `groups.protected.tip`), server `BETA_GROUP_PROTECTED` vẫn toast.
- **Tạo:** `POST` (platform gửi `tenant_id`); `KEY_TAKEN` → inline `groups.error.keyTaken`; thành công → toast `groups.toast.created` + sang editor tab Thành viên. Key chuẩn hoá khi gõ (`normalizeKey`: chữ thường, bỏ dấu, dấu cách → `-`).
- **Editor:** `Đổi tên` mở `GroupRenameDialog` (Tên VI/EN + Mô tả, `Lưu` / `Huỷ`) → `PATCH {name, description, version}`; thành công toast `groups.toast.saved`, header cập nhật; **409 → `ConflictDialog` (`entity="group"`)**; `updated_by` có → câu có `{user}` (A4). `is_beta`: nhãn `groups.beta.hint` dưới tiêu đề; Đổi tên được, không có `⋯ Xoá`.
- **Tab Thành viên** (`?tab=members`, mặc định): `combobox "Thêm người"` (RefPicker, nguồn `GET /admin/users?q&limit=50&tenant_id`, loại người đã là thành viên ở client bằng `member ids` của trang hiện tại; thêm trùng server idempotent) → `POST …/members {usernames:[x]}` → toast `groups.toast.memberAdded`; bảng thành viên server phân trang `limit=50` + `?q`: **Người dùng** (avatar chữ cái đầu + tên hiển thị + `username` mono) · **Group khác** (chip ≤ 2 + "+n", từ `other_groups` ≤ 3 + `other_groups_total`) · **Lần đăng nhập cuối** (`formatLastLogin`, "Chưa đăng nhập" badge `warn`) · `button "Bỏ {username} khỏi group"` (icon ×, `aria-label` có username) → `DELETE` ngay + toast `groups.toast.memberRemoved` + `Hoàn tác` 5 s (= `POST` lại). Người bị khoá hiện badge `Đã khoá` nhưng vẫn là thành viên (M3-R03).
- **Dán danh sách** (D12): `textarea "Dán danh sách username"` (nhãn thấy được `groups.paste.label`), đếm `groups.paste.count`; > 500 → `groups.paste.tooMany` + khoá nút; nút `Thêm {count} người` → kết quả `{added, not_found, already}`: toast `groups.toast.pasted` (hoặc `groups.toast.pastedPartial`), `not_found` liệt kê trong `status` `groups.paste.notFound` ("Không tìm thấy: an.vu"), textarea thay bằng danh sách `not_found` (để sửa tại chỗ), dòng phụ `groups.paste.already` khi `already` > 0. Danh sách thành viên refetch.
- **Tab Feature** (`?tab=features`): `Card` "Feature được cấp" với `Sửa`; chế độ xem: hàng cho từng feature được cấp (tên · command mono · badge trạng thái `on/beta/off`) và hàng `core` ("Mọi người đều có", badge `Mặc định`, không sửa được); chế độ Sửa: danh sách ô tick các feature có entitlement chưa thu hồi (ghi chú `groups.features.hint`), hàng thu hồi còn grant hiện mờ + `access.matrix.revoked` (tick giữ nguyên, khoá), `Lưu` → `PUT /admin/grants/batch` (`add`/`remove` theo chênh lệch) → toast `groups.toast.featuresSaved`; không đổi gì thì `Lưu` khoá. Dữ liệu: `GET /admin/grants/matrix?tenant_id=<group.tenant_id>&group_id=<id>` (cột của group này, C5; `granted_group_ids` chứa id group ⇔ đã cấp).
- **Tab Agent** (`?tab=agents`): card "Chưa khả dụng" (`common.unavailable` + `groups.agents.body`), không gọi API.

### 3.3 Ma trận Grants (ADM-FR-35, 32; M3-R07…R10)

- **Dữ liệu:** `GET /admin/grants/matrix?tenant_id` (bắt buộc với platform) → `groups[]` (≤ 200, kèm `group_total`) + `features[]` (`{feature, state, command_names ≤ 10, command_count, granted_group_ids}`). `group_total > groups.length` → `Alert` `access.matrix.groupsTrimmed` + `searchbox "Lọc group"` (gửi `q`, debounce 300 ms). Hàng theo thứ tự: `core` · entitled · revoked còn grant · (ẩn) none. `staleTime` 0 sau khi lưu (invalidate).
- **Cửa sổ hoá hai chiều:** hàng cao 48 px, cột 112 px, cột đầu (nhãn feature) rộng 280 px **sticky trái**, dòng tiêu đề cột sticky trên. `lib/grid-window.ts: visibleRange({scroll, viewport, size, count, overscan:3}) → {start, end}` (thuần, test); `use-grid-window` đọc `scrollTop/Left` + `ResizeObserver` (bọc `requestAnimationFrame`). Hàng render = nhãn sticky + spacer trái + các ô trong cửa sổ + spacer phải; hàng ngoài cửa sổ = spacer cao. Tối đa ~ 20 hàng × 12 cột ≈ 240 ô trong DOM dù 200 × 200.
- **Ô:** `MatrixCell` (`memo`, props nguyên thuỷ: `checked`, `dirty`, `locked`, `label`) = `<button role="checkbox" aria-checked aria-label="{feature} cho group {group}">`; chấm tím nhỏ khi `dirty`; tooltip `Đã cấp` / `Chưa cấp` / `Công ty chưa được mở feature này` / `Mọi người đều có`. Bàn phím: `Space` đổi, mũi tên di chuyển (roving tabindex, một tab-stop cho cả lưới), `Home/End` đầu/cuối hàng. Lưới `role="grid"` `aria-rowcount`/`aria-colcount` thật (kể cả ô ngoài cửa sổ), ô render có `aria-rowindex`/`aria-colindex`.
- **Tick hàng/cột:** ô tiêu đề hàng có `checkbox "Cấp {feature} cho mọi group"` (tri-state `mixed`), tiêu đề cột `checkbox "Cấp mọi feature cho group {group}"`; bấm khi chưa đủ → bật tất cả ô **sửa được** của hàng/cột, khi đủ → tắt; bỏ qua ô khoá (core, thu hồi, chưa mở).
- **Thanh trên:** `status` "{count} thay đổi chưa lưu" · `Huỷ` (bỏ nháp) · `Lưu` (khoá khi 0 thay đổi, khi `> 200`, khi mất kết nối). `Lưu` → `PUT /admin/grants/batch?tenant_id` → toast `access.toast.saved` ({added} cấp · {removed} thu); refetch ma trận; nháp xoá.
- **Hàm thuần `lib/matrix.ts`** (test): `toggleCell`, `toggleRow`, `toggleCol`, `effectiveChecked(server, draft)`, `draftToBatch(draft, rows, cols)`, `rowState(row, draft)` (checked|mixed|unchecked), `countChanges`. Nháp luôn là chênh lệch; bật rồi tắt lại cùng ô → xoá khỏi nháp.
- **Hook:** `use-matrix-data` (query), `use-matrix-draft` (reducer thuần, ≤ 50 dòng), `use-matrix-save` (mutation + xử lý lỗi), `use-access-view` (tenant + tab từ URL). `GrantMatrix` chỉ ghép.

### 3.4 Kiểm tra quyền + AccessExplainer (ADM-FR-36; M3-R11…R13)

- **Tab** `?tab=check&user=<username>&tenant=<mã>`: `combobox "Người dùng"` (RefPicker, nguồn `GET /admin/users?q&limit=50&tenant_id`, giá trị = username, hiện tên + group) → khi có `user`: `GET /admin/users/:id/effective-access`. Ô `searchbox "Tìm command"` lọc phía client (không dấu `/`, so khớp tên/alias/mô tả).
- **`AccessExplainer`** (shared, trình bày): `Alert` đầu trang khi `blockers[]` khác rỗng (`user_inactive` → `access.reason.userInactive`, `tenant_locked` → `access.reason.tenantLocked`; khi đó mọi mục đều không thấy); thanh tóm tắt (tên, username, chip `user.groups`, `access.check.summary` "Thấy {visible}/{command_total} command"); 3 nhóm:
  - **Feature:** mỗi feature của catalog: dòng ✓ "qua group Kế toán" / "qua feature core (mặc định cho mọi người)" / "qua group beta-testers" / "được cấp trực tiếp cho người này"; feature không hiệu lực gom dưới `Hiện feature không dùng được ({count})` (ẩn mặc định).
  - **Command:** ✓ `/kiemtra-hoadon` "qua feature Kế toán · group Kế toán" (mono). ✕ nằm trong khối `Hiện command không thấy ({count})` (mở sẵn khi có chữ ở ô tìm); mỗi dòng ✕ có `button "Vì sao không?"` (mở dòng lý do, `aria-expanded`), lý do dựng từ `blocked_by[]` (mỗi feature chặn một câu từ `missing[]`, ví dụ "Feature Kinh doanh chưa cấp cho lan.tran hay group nào của lan.tran.") và `missing[]` cấp command (`command_disabled`, `workflow_disabled`, `no_effective_feature`).
  - **Agent:** `users.access.agentsUnavailable` ("Chưa khả dụng"), không gọi API.
- **Hành động gợi ý** (chỉ khi `onGrantToGroup` có, tức Kiểm tra quyền, không có ở drawer user): command có `suggestion = {action:"grant_feature", feature}` → nút `Cấp {feature} cho group…` → `GrantToGroupDialog` (`dialog "Cấp {feature} cho group"`: `combobox "Group"` — group của user xếp đầu, rồi các group khác của tenant · `Cấp` · `Huỷ`) → batch `add` → toast `access.toast.grantedToGroup`; refetch `effective-access`. `no_entitlement` (trong `blocked_by`): tenant_admin chỉ thấy câu "Liên hệ nền tảng để mở." (không nút); platform_admin thêm `link "Mở feature {feature}"` → `/features/$id?tab=tenants`. `beta_not_member`: nút `Thêm {user} vào beta-testers` (`POST members {usernames:[user]}` vào group `is_beta` của tenant, lấy từ danh sách group). Các lý do còn lại (`feature_off`, `command_disabled`, `workflow_disabled`, `user_inactive`, `tenant_locked`) chỉ hiện câu.
- **Hàm thuần `components/shared/access/reasons.ts`** (test): `reasonKey(code)` (phủ `ACCESS_REASONS`, `FEATURE_MISSING`, `COMMAND_MISSING`) + `reasonParams`, `commandLines(command)`; map mã → key i18n (không nối chuỗi), mã lạ → `access.reason.unknown`.
- **Tab Quyền hiệu lực của drawer user** (FE4b): `UserAccessTab` bọc `AccessExplainer readOnly` (không nút gợi ý) + `link "Mở Kiểm tra quyền"` → `/access?tab=check&user=<username>&tenant=<mã>`; nạp `lazy()` và chỉ gọi API khi tab mở.

### 3.5 Users (ADM-FR-62, 36; M3-R13)

- Cột **Groups**: `groups[]` (≤ 50) hiện tối đa 2 chip (tên group, `max-w-24 truncate`) + chip `+n` với n = `group_count − 2` (tooltip liệt kê tên còn lại trong `groups`); trống → "—". `Select "Group"` (nguồn `useGroupOptions` = `GET /admin/groups?tenant_id&limit=200`, giá trị `key`, mục đầu `Tất cả group`); platform chưa chọn tenant → `disabled` + `title` nhắc chọn tenant; đổi tenant bỏ `group`. URL `?group=<key>`; khớp key → id để gửi `group`; key lạ → bỏ lọc và hiện chip lọc "Group: {key} ✕" (không 404).
- Drawer sửa: tab **Thông tin · Quyền hiệu lực**; khi tạo không có tab. Ô **Groups** (chỉ đọc, A11): `list "Groups"` chip link tới `/groups/$id`, trống → `users.field.groupsNone`, gợi ý `users.field.groupsReadonly`. Không đổi hợp đồng `PATCH /admin/users`. Chỉ hiện khi sửa.
- Conflict: `PATCH` user 409 → `ConflictDialog entity="user"` (không `{user}`).

### 3.6 Command › "Ai dùng được" (ADM-FR-24; M3-R14)

Bảng M2 thêm cột **Group được cấp** (chip "tên group · feature" ≤ 3 từ `groups[]` + `commands.access.groups.more` với n = `group_count − 3` khi lớn hơn 0) và đổi cột số: **Số user thấy** = `visible_user_count` (tooltip `commands.access.visibleHint` nêu `active_user_count`). Tổng ở trigger tab = tổng `visible_user_count` khi `total` ≤ 50. Xoá card `commands.access.groupsLater` (và key). Chỉ `platform_admin` (PlatformOnly đã có).

## 4. Validate phía client (khớp contract; câu lỗi nguyên văn)

| Trường | Luật | Key (VI/EN ở §7) |
|---|---|---|
| Group · Key | chuẩn hoá rồi `^[a-z0-9-]{2,32}$` (M3-R01) | `groups.error.keyFormat` |
| Group · Trùng key | 409 `KEY_TAKEN` | `groups.error.keyTaken` |
| Group · Tên VI | bắt buộc, 1–64 sau trim | `groups.error.nameRequired` |
| Group · Tên EN | ≤ 64 (tuỳ chọn) | `groups.error.nameRequired` |
| Group · Mô tả | ≤ 400 | `groups.error.descMax` |
| Dán username | ≥ 1 mục; ≤ `GROUP_PASTE_MAX` (500) sau tách/bỏ trùng; mỗi mục ≤ `USERNAME_INPUT_MAX` (64) | `groups.paste.tooMany` |
| Ma trận | ≤ `GRANT_BATCH_MAX` (200) thao tác/batch (M3-R08) | `access.matrix.tooMany` |
| Cấp cho group | phải chọn group | `access.grant.groupRequired` |

Schema form dùng hằng/regex từ `@ai/contracts` (như M1/M2); thông điệp là key i18n; server kiểm lại và FE hiển thị bằng cùng câu. Hàm thuần có test `bun test`: `groupSchema` (biên key 1/2/32/33 ký tự, tên 64/65, mô tả 400/401), `normalizeGroupKey`, `checkPaste` (bọc `parseUsernameList`: 500/501, mục 64/65), `diffFields` (lồng, mảng, bỏ khoá hệ thống, bằng nhau, thiếu/dư khoá, > 50 dòng), `parseConflict`, `matrix.ts` (toggle/row/col/batch/mixed/≤ 200), `visibleRange` (biên, `count` nhỏ hơn viewport, overscan), `reasonKey`, `isProtected`, parser search param từng route, `navGroups`/`crumbsFor`, `describeError` mã M3, `formatUpdated` không đổi.

## 5. Role + nhãn cho e2e (phải giữ đúng khi code; QC dùng nguyên văn)

| Màn | Nhãn |
|---|---|
| Menu | `link "Groups"` · `link "Phân quyền"` trong `navigation` (tenant_admin và platform_admin) |
| Groups list | `heading "Groups"` · `link "+ Tạo group"` · `combobox "Tenant"` (platform) · `searchbox "Tìm theo tên, key…"` · `table "Groups"` · hàng chứa key · `text "Có sẵn"` + `text "Thấy các feature đang Beta"` ở `beta-testers` · `button "Thao tác khác"` → `menuitem "Sửa"` / `"Xoá"` (với `beta-testers`, `menuitem "Xoá"` có `aria-disabled="true"`) · `alertdialog "Xoá Kế toán?"` + `textbox "Gõ ke-toan để xác nhận"` + `button "Xoá group"` |
| Group tạo | `heading "Group mới"` · `textbox "Key"` · `textbox "Tên"` (+ `tab "VI"`/`"EN"` trong `tablist "Ngôn ngữ"`) · `textbox "Mô tả"` · `button "Tạo group"` · `button "Huỷ"` |
| Group editor | `heading "Kế toán"` (tên theo ngôn ngữ) · `button "Đổi tên"` → `dialog "Đổi tên group"` (`textbox "Tên"`, `textbox "Mô tả"`, `button "Lưu"`, `button "Huỷ"`) · `tab "Thành viên"` / `"Feature"` / `"Agent"` |
| Tab Thành viên | `combobox "Thêm người"` · `table "Thành viên"` · hàng chứa username · `button "Bỏ lan.tran khỏi group"` · `textbox "Dán danh sách username"` · `button "Thêm 3 người"` (số theo `count`) · `status` chứa "Không tìm thấy: an.vu" · toast `status` "Đã bỏ lan.tran khỏi Kế toán" + `button "Hoàn tác"` |
| Tab Feature | `button "Sửa"` · `checkbox "Kế toán"` (trong chế độ Sửa; nhãn = tên feature) · `button "Lưu"` · `button "Huỷ"` · `text "Mọi người đều có"` (hàng core) |
| Tab Agent | `text "Chưa khả dụng"` |
| Phân quyền | `heading "Phân quyền"` · `tab "Ma trận"` / `"Kiểm tra quyền"` · `combobox "Tenant"` (platform) |
| Ma trận | `grid "Ma trận feature × group"` · `checkbox "Kế toán cho group Kế toán"` (mỗi ô: "{feature} cho group {group}") · `checkbox "Cấp Kế toán cho mọi group"` · `checkbox "Cấp mọi feature cho group Kế toán"` · `status` "2 thay đổi chưa lưu" · `button "Huỷ"` · `button "Lưu"` · `switch "Hiện feature chưa mở (1)"` · `text "Đã thu hồi entitlement"` · `text "Mặc định"` (hàng core, ô `aria-disabled`) |
| Kiểm tra quyền | `combobox "Người dùng"` · `searchbox "Tìm command"` · `heading "Feature"` / `"Command"` / `"Agent"` (h3) · `text "Chưa khả dụng"` (Agent) · `button "Hiện command không thấy (2)"` · `button "Vì sao không?"` · `button "Cấp Kinh doanh cho group…"` → `dialog "Cấp Kinh doanh cho group"` (`combobox "Group"`, `button "Cấp"`, `button "Huỷ"`) · `text` chứa "Thấy /kiemtra-hoadon" |
| Users | như missing-screens §5 cộng: `columnheader "Groups"` · `combobox "Group"` (mục `Tất cả group`) · `tab "Quyền hiệu lực"` (drawer sửa) · `link "Mở Kiểm tra quyền"` · `list "Groups"` trong drawer (A11) |
| Command editor | tab `Ai dùng được`: `columnheader "Group được cấp"` · `columnheader "Số user thấy"` |
| `ConflictDialog` | `alertdialog "Có người vừa lưu bản mới hơn"` · `button "Xem khác biệt"` (`aria-expanded`) · `table "Khác biệt giữa bản của bạn và bản mới nhất"` (cột `Trường` / `Bản của bạn` / `Bản mới nhất (v44)`) · `button "Ghi đè"` · `button "Tải bản mới"` · `alertdialog "Ghi đè thay đổi của thu.ha?"` (hoặc `"Ghi đè thay đổi mới nhất?"`) + `button "Huỷ"` / `button "Ghi đè"` · toast `status` "Đã tải bản mới nhất · v44" |

Dòng trùng role/tên trong cùng trang đều có hậu tố số thứ tự hoặc tên đối tượng (không `.nth()` mơ hồ). `ConflictDialog` hiện **trước** khi toast nào khác; sau `Ghi đè` thành công toast lưu thường (`<f>.toast.saved`).

## 6. Hiệu năng (CONVENTIONS §6)

- **Bundle:** JS ban đầu hiện **115,8 KB** gzip, trần 150 KB. Thêm vào ban đầu: i18n M3 (~230 key × 2 locale, ước +4,5 KB gzip), `nav.ts`, `lib/{conflict,diff-fields,use-viewed-tenant}`, `errors.ts`; **ước ≤ 122 KB**. `ConflictDialog` + `DiffTable` + `AccessExplainer` + ma trận **không** vào bundle ban đầu: `lazy()`/route chunk. Hiện chưa có cách đo trước: FE0 đo ngay sau khi thêm i18n (`check:bundle`), vượt 128 KB → tách locale theo route.
- **Chunk route ≤ 50 KB gzip** (ước): groups (list + editor + 3 tab) ~28, access (ma trận + kiểm tra) ~30, conflict (lazy) ~6, `AccessExplainer` dùng chung (chunk tách tự động, ~8). Drawer user nạp `UserAccessTab` bằng `lazy()` để chunk `users` không phình. FE5 đo từng chunk.
- **Bảng:** danh sách Groups, thành viên, Users phân trang server `limit=50` → không virtualize. Ma trận (tới 200 × 200 = 40.000 ô) **bắt buộc** cửa sổ hoá (`useGridWindow`, ≤ ~240 ô trong DOM); `MatrixCell`/`MatrixRow` `memo` với props nguyên thuỷ, nháp là `Map` bất biến cập nhật theo ô; `useDeferredValue` cho ô tìm command. `AccessExplainer` render ≤ 50 command + "Còn {n}…" (lọc rồi cắt).
- **Truy vấn:** `staleTime` 30 s cho danh sách chọn (groups `limit=200`, users `limit=50`, tenants); ma trận và `effective-access` `staleTime: 0` và invalidate sau mọi lưu/batch/thêm thành viên; huỷ request cũ khi đổi `q` (debounce 300 ms); `effective-access` chỉ nạp khi có `user` (tab Quyền hiệu lực: khi tab mở). `keepPreviousData` cho mọi list. `ConflictDialog` không nạp dữ liệu.
- **Re-render:** hook form chỉ `useWatch` đúng trường; `PasteMembers` đếm bằng `useDeferredValue`; `parseUsernames` chạy `useMemo` theo chuỗi.

## 7. Câu chữ MỚI (VI | EN)

Chuỗi `§12.5`/`§5`/canvas giữ nguyên văn (đã ghi ở trên). Key mới (đủ 2 locale; `_one/_other` dùng cho `{count}` như M2, VI hai dạng cùng chữ):

| Key | VI | EN |
|---|---|---|
| nav.groups / nav.access | Groups / Phân quyền | Groups / Access |
| conflict.title | Có người vừa lưu bản mới hơn | Someone just saved a newer version |
| conflict.body.byUser | {user} vừa sửa {entity} này lúc {time} (v{n}). Bản của bạn dựa trên v{mine}. | {user} edited this {entity} at {time} (v{n}). Your copy is based on v{mine}. |
| conflict.body.anon | Bản này vừa được sửa lúc {time} (v{n}). Bản của bạn dựa trên v{mine}. | This was just edited at {time} (v{n}). Your copy is based on v{mine}. |
| conflict.entity.user / tenant / workflow / command / feature / group | user / tenant / workflow / command / feature / group | user / tenant / workflow / command / feature / group |
| conflict.action.diff / overwrite / reload | Xem khác biệt / Ghi đè / Tải bản mới | View differences / Overwrite / Load latest |
| conflict.diff.aria | Khác biệt giữa bản của bạn và bản mới nhất | Differences between your version and the latest |
| conflict.diff.field / mine / latest | Trường / Bản của bạn / Bản mới nhất (v{n}) | Field / Your version / Latest (v{n}) |
| conflict.diff.empty | Không có trường nào khác nhau. Có thể người kia chỉ lưu lại bản cũ. | No fields differ. The other person may have just re-saved. |
| conflict.diff.more | Còn {n} trường khác | {n} more fields |
| conflict.diff.none | (trống) | (empty) |
| conflict.overwrite.titleUser / titleAnon | Ghi đè thay đổi của {user}? / Ghi đè thay đổi mới nhất? | Overwrite {user}'s changes? / Overwrite the latest changes? |
| conflict.overwrite.body | Bản v{n} sẽ bị thay bằng bản của bạn (thành v{next}). | v{n} will be replaced by your version (becoming v{next}). |
| conflict.toast.loaded | Đã tải bản mới nhất · v{n} | Loaded latest · v{n} |
| groups.list.title / subtitle | Groups / Nhóm người dùng của {tenant}. Cấp feature cho cả nhóm thay vì từng người. | Groups / Groups of {tenant}. Grant features to a whole group instead of person by person. |
| groups.list.create / search | + Tạo group / Tìm theo tên, key… | + New group / Search by name, key… |
| groups.col.group / members / features / agents | Group / Thành viên / Feature / Agent | Group / Members / Features / Agents |
| groups.badge.builtin | Có sẵn | Built-in |
| groups.beta.hint | Thấy các feature đang Beta | Sees features in Beta |
| groups.menu.edit / delete | Sửa / Xoá | Edit / Delete |
| groups.protected.tip | Group beta-testers có sẵn, không xoá được | The built-in beta-testers group can't be deleted |
| groups.selectTenant | Chọn một tenant để xem group của tenant đó. | Choose a tenant to see its groups. |
| groups.empty.text / cta | Chưa có group nào. Tạo group để cấp feature cho cả phòng ban. / + Tạo group đầu tiên | No groups yet. Create a group to grant features to a whole team. / + Create your first group |
| groups.editor.titleNew / breadcrumb.new | Group mới / Group mới | New group / New group |
| groups.summary | {members} thành viên · {features} feature | {members} members · {features} features |
| groups.field.key / name / description | Key / Tên / Mô tả | Key / Name / Description |
| groups.field.keyLocked | Key không đổi được sau khi tạo | Key can't be changed after creation |
| groups.field.descCount | {n}/400 | {n}/400 |
| groups.create.submit | Tạo group | Create group |
| groups.rename.button / title | Đổi tên / Đổi tên group | Rename / Rename group |
| groups.tab.members / features / agents | Thành viên / Feature / Agent | Members / Features / Agents |
| groups.members.add / addPlaceholder | Thêm người / Tìm người dùng… | Add people / Search users… |
| groups.members.col.user / other / lastLogin | Người dùng / Group khác / Lần đăng nhập cuối | User / Other groups / Last sign-in |
| groups.members.remove.aria | Bỏ {username} khỏi group | Remove {username} from group |
| groups.members.empty | Group này chưa có thành viên. | This group has no members yet. |
| groups.paste.label | Thêm nhiều người: dán username, mỗi dòng một người | Add many: paste usernames, one per line |
| groups.paste.aria | Dán danh sách username | Paste a list of usernames |
| groups.paste.count_one / _other | {count} username | {count} username / {count} usernames |
| groups.paste.submit_one / _other | Thêm {count} người | Add {count} person / Add {count} people |
| groups.paste.notFound | Không tìm thấy: {names} | Not found: {names} |
| groups.paste.already_one / _other | {count} người đã ở trong group | {count} already in the group |
| groups.paste.tooMany | Tối đa 500 username mỗi lần. Bạn đã dán {count}. | At most 500 usernames at a time. You pasted {count}. |
| groups.paste.checking | Đang kiểm tra… | Checking… |
| groups.features.title / hint | Feature được cấp / Chỉ chọn được feature mà công ty đã được cấp. | Granted features / You can only pick features the company has been granted. |
| groups.features.edit | Sửa | Edit |
| groups.features.core | Mọi người đều có | Everyone has it |
| groups.features.empty | Group chưa được cấp feature nào ngoài core. | This group has no features beyond core. |
| groups.agents.body | Cấp agent cho group làm ở Agent Studio, khi Agent Hub sẵn sàng. | Granting agents to a group is done in Agent Studio once Agent Hub is ready. |
| groups.delete.title / body / typeToConfirm / submit | Xoá {name}? / {members} thành viên sẽ rời group và {features} feature đang cấp cho group sẽ bị thu hồi. Tài khoản người dùng vẫn giữ nguyên. / Gõ {key} để xác nhận / Xoá group | Delete {name}? / {members} members will leave the group and {features} granted features will be revoked from it. User accounts stay as they are. / Type {key} to confirm / Delete group |
| groups.toast.created / saved / deleted | Đã tạo {name} / Đã lưu {name} / Đã xoá {name} | Created {name} / Saved {name} / Deleted {name} |
| groups.toast.memberAdded / memberRemoved | Đã thêm {username} vào {group} / Đã bỏ {username} khỏi {group} | Added {username} to {group} / Removed {username} from {group} |
| groups.toast.pasted / pastedPartial | Đã thêm {count} người vào {group} / Đã thêm {added} người, {missing} username không tìm thấy | Added {count} people to {group} / Added {added}, {missing} usernames not found |
| groups.toast.featuresSaved | Đã lưu feature của {group}. Thành viên thấy thay đổi trong vài giây. | Saved features of {group}. Members see the change within seconds. |
| groups.error.keyFormat | Chỉ dùng chữ thường không dấu, số, dấu - (2–32 ký tự) | Use lowercase letters, digits and - only (2–32 chars) |
| groups.error.keyTaken | Key đã được dùng trong tenant này | Key is already used in this tenant |
| groups.error.nameRequired | Nhập tên group (tối đa 64 ký tự) | Enter a group name (at most 64 characters) |
| groups.error.descMax | Mô tả tối đa 400 ký tự | Description can be at most 400 characters |
| groups.error.betaProtected | Group beta-testers có sẵn: không xoá hay đổi key được. | The built-in beta-testers group can't be deleted or re-keyed. |
| access.title / subtitle | Phân quyền / Cấp feature cho từng group. Chỉ cấp được feature mà công ty đã được nền tảng mở. | Access / Grant features to groups. You can only grant features the platform has opened for the company. |
| access.tab.matrix / check | Ma trận / Kiểm tra quyền | Matrix / Access check |
| access.selectTenant | Chọn một tenant để phân quyền cho tenant đó. | Choose a tenant to manage its access. |
| access.matrix.title / aria | Ma trận feature × group / Ma trận feature × group | Feature × group matrix / Feature × group matrix |
| access.matrix.dirty_one / _other | {count} thay đổi chưa lưu | {count} unsaved change / {count} unsaved changes |
| access.matrix.tooMany | Tối đa 200 thay đổi mỗi lần lưu (đang có {count}). Lưu bớt rồi làm tiếp. | At most 200 changes per save ({count} now). Save some, then continue. |
| access.matrix.cell | {feature} cho group {group} | {feature} for group {group} |
| access.matrix.rowAll / colAll | Cấp {feature} cho mọi group / Cấp mọi feature cho group {group} | Grant {feature} to every group / Grant every feature to group {group} |
| access.matrix.tip.on / off / notOpened / core | Đã cấp / Chưa cấp / Công ty chưa được mở feature này / Mọi người đều có | Granted / Not granted / The company hasn't been given this feature / Everyone has it |
| access.matrix.badge.default / unsaved / beta / notOpened | Mặc định / Chưa lưu / Beta / Chưa mở | Default / Unsaved / Beta / Not opened |
| access.matrix.revoked | Đã thu hồi entitlement | Entitlement revoked |
| access.matrix.showUnopened | Hiện feature chưa mở ({count}) | Show unopened features ({count}) |
| access.matrix.noGroups / noGroupsCta | Chưa có group nào. Tạo group trước, rồi quay lại cấp feature. / Tạo group | No groups yet. Create a group first, then come back to grant features. / Create group |
| access.matrix.unopenedHint | Liên hệ nền tảng để mở feature này cho công ty. | Contact the platform to open this feature for the company. |
| access.toast.saved | Đã lưu quyền · {added} cấp, {removed} thu. Thành viên thấy thay đổi trong vài giây. | Saved · {added} granted, {removed} revoked. Members see the change within seconds. |
| access.toast.grantedToGroup | Đã cấp {feature} cho group {group} | Granted {feature} to group {group} |
| access.error.notEntitled | Công ty chưa được mở feature này nên không cấp được. Đã tải lại ma trận. | The company hasn't been given this feature, so it can't be granted. The matrix was reloaded. |
| access.error.coreProtected | core có sẵn cho mọi người, không cần cấp. | core is available to everyone and needs no grant. |
| access.error.batchFail | Không lưu được, chưa có thay đổi nào được áp dụng. | Couldn't save; none of the changes were applied. |
| access.check.title / subtitle | Kiểm tra quyền / Trả lời "sao tôi không thấy lệnh X" | Access check / Answers "why can't I see command X" |
| access.check.user / userPlaceholder | Người dùng / Nhập username… | User / Enter a username… |
| access.check.prompt | Chọn một người dùng để xem họ dùng được gì và vì sao. | Choose a user to see what they can use, and why. |
| access.check.userNotFound | Không tìm thấy người dùng này trong tenant. | This user isn't in the tenant. |
| access.check.search / searchPlaceholder | Tìm command / Tìm command, ví dụ kiemtra | Search commands / Search commands, e.g. kiemtra |
| access.check.section.features / commands / agents | Feature / Command / Agent | Features / Commands / Agents |
| access.check.summary | Thấy {visible}/{total} command | Sees {visible} of {total} commands |
| access.check.sees / notSees | Thấy {name} / Không thấy {name} | Can see {name} / Can't see {name} |
| access.check.showHidden / hideHidden | Hiện command không thấy ({count}) / Ẩn command không thấy | Show hidden commands ({count}) / Hide hidden commands |
| access.check.showUnusable | Hiện feature không dùng được ({count}) | Show unavailable features ({count}) |
| access.check.why / hideWhy | Vì sao không? / Ẩn lý do | Why not? / Hide reason |
| access.check.more | Còn {count} mục, gõ để lọc | {count} more, type to filter |
| access.check.grantTo | Cấp {feature} cho group… | Grant {feature} to a group… |
| access.check.addBeta | Thêm {user} vào beta-testers | Add {user} to beta-testers |
| access.check.openFeature | Mở feature {feature} | Open feature {feature} |
| access.grant.title | Cấp {feature} cho group | Grant {feature} to group |
| access.grant.group / groupRequired | Group / Chọn một group | Group / Choose a group |
| access.grant.hint | Thành viên của group thấy các command của feature này trong vài giây. | Members of the group see this feature's commands within seconds. |
| access.grant.submit | Cấp | Grant |
| access.reason.grantGroup | qua group {group} | via group {group} |
| access.reason.grantUser | được cấp trực tiếp cho người này | granted directly to this user |
| access.reason.betaMember | qua group beta-testers | via the beta-testers group |
| access.reason.viaFeatureGroup | qua feature {feature} · group {group} | via feature {feature} · group {group} |
| access.reason.viaFeature | qua feature {feature} | via feature {feature} |
| access.reason.featureOff | Feature {feature} đang tắt. | Feature {feature} is off. |
| access.reason.betaNotMember | Feature {feature} đang ở Beta và {user} chưa thuộc group beta-testers. | Feature {feature} is in Beta and {user} isn't in the beta-testers group. |
| access.reason.noEntitlement | Feature {feature} chưa được mở cho công ty. Liên hệ nền tảng để mở. | Feature {feature} hasn't been opened for the company. Contact the platform to open it. |
| access.reason.noGrant | Feature {feature} chưa cấp cho {user} hay group nào của {user}. | Feature {feature} isn't granted to {user} or any of their groups. |
| access.reason.noEffectiveFeature | Command chưa thuộc feature nào dùng được. | The command isn't in any available feature. |
| access.matrix.groupsTrimmed | Đang hiện {shown}/{total} group. Gõ để lọc. | Showing {shown} of {total} groups. Type to filter. |
| access.matrix.filterGroups | Lọc group | Filter groups |
| access.reason.commandDisabled / workflowDisabled | Command đang tắt. / Workflow của command đang tắt. | The command is disabled. / The command's workflow is disabled. |
| access.reason.userInactive / tenantLocked | Tài khoản này đang bị khoá. / Công ty đang bị khoá. | This account is locked. / The company is locked. |
| access.reason.unknown | Không rõ lý do. | Reason unknown. |
| users.col.groups / filter.group / filter.allGroups | Groups / Group / Tất cả group | Groups / Group / All groups |
| users.filter.groupChip | Group: {key} | Group: {key} |
| users.filter.groupNeedsTenant | Chọn tenant trước | Choose a tenant first |
| users.groups.more | Còn: {names} | Also: {names} |
| users.field.groupsReadonly | Sửa thành viên ở trang Group. | Edit membership on the Group page. |
| users.field.groupsNone | Chưa thuộc group nào | Not in any group |
| users.access.summary | Thấy {visible}/{total} command | Sees {visible} of {total} commands |
| commands.access.col.groups / visible | Group được cấp / Số user thấy | Granted groups / Users who see it |
| commands.access.groups.none | Chưa group nào được cấp | No group granted yet |
| commands.access.groups.more | +{count} group nữa | +{count} more groups |
| commands.access.visibleHint | Đã tính feature, group và Beta. Công ty có {active} user đang hoạt động. | Counts feature, group and Beta rules. The company has {active} active users. |

Gỡ khỏi locale: `commands.access.groupsLater`. Giữ `errors.versionConflict` (câu dự phòng), `common.reload` (không dùng cho 409 nữa; còn dùng nơi khác thì giữ).

## 8. Bảng mã lỗi API → câu hiển thị (`lib/errors.ts`, mở rộng `STATIC_KEYS`/`ERROR_MESSAGE_KEYS`)

| Mã | Hiển thị |
|---|---|
| `VERSION_CONFLICT` (mọi PATCH có version) | `ConflictDialog` (D3); thiếu/hỏng `details.current` → toast `errors.versionConflict`, không nút |
| `BETA_GROUP_PROTECTED` (409, chỉ khi xoá) | toast `groups.error.betaProtected` |
| `KEY_TAKEN` (group) | inline `groups.error.keyTaken` (màn Tenants/Workflows/Features giữ key riêng của họ) |
| `NOT_ENTITLED {feature_ids}` (409, grant/batch) | toast `access.error.notEntitled` + refetch; ở ma trận đánh dấu cả hàng theo `feature_ids` (D10) |
| `CORE_FEATURE_PROTECTED` (409, không details; trong grant/batch) | toast `access.error.coreProtected` (màn Feature vẫn dùng `features.error.coreProtected`: chọn theo nơi gọi, hàm `describeError(err, {scope})`) |
| `TENANT_REQUIRED` | không xảy ra (D9) nhưng map `common.tenantPicker.required` |
| `INVALID_REFERENCE {field, ids}` (batch: `feature_ids`/`group_ids`; grant: `feature_id`/`group_id`/`user_id`) | toast `errors.invalidReference` + refetch |
| `FORBIDDEN` / `NOT_FOUND` / `NETWORK_ERROR` | như M1 |

`API_ERRORS` sau M3 = 36 mã; `ERROR_MESSAGE_KEYS` mở rộng đúng hai mã mới, không hiển thị `message` của server.

## 9. Yêu cầu contract: đã chốt (spec §3, plan.md §11, commit 2d93194)

Backend-lead đã trả lời C1–C12; không còn yêu cầu mở. Khi code, lấy kiểu và hằng từ `@ai/contracts`, không tự khai báo.

| # | Kết quả đã chốt | FE dùng |
|---|---|---|
| C1 | Cờ `is_beta` (không `is_builtin`); tenant **phẳng** `tenant_id, tenant_key, tenant_name` (không lồng); `GroupListItem` có `member_count, feature_count, agent_count, version, updated_at, updated_by`; `description: string \| null`; `PATCH {version, name?, description?}` (không nhận `key`); `DELETE` 204; list sắp `tenant_key`, `beta-testers` đầu | Groups list/editor |
| C2 | `GroupMember` có `role, status, locked_by_tenant, last_login_at, added_at, added_by, other_groups: GroupRef[] ≤ 3, other_groups_total`; `DELETE …/members/:user_id` luôn 204 | Tab Thành viên |
| C3 | `{added, not_found, already}` (username đã chuẩn hoá); user bị khoá vẫn vào `added`; khác tenant/sai định dạng → `not_found` | Thêm, dán |
| C4 | `dry_run?: boolean` trong body: không ghi, không NOTIFY | Xem trước dán (D12) |
| C5 | `GET /admin/grants/matrix?tenant_id&group_id&q&limit&offset` → `{tenant_id, groups[] ≤ 200 (GroupRef + member_count), group_total, features:[{feature, state: core\|entitled\|revoked\|none, command_names ≤ 10, command_count, granted_group_ids}]}`; platform thiếu `tenant_id` → 400 `TENANT_REQUIRED`; `none` trả đủ (D11 giữ) | Ma trận, tab Feature |
| C6 | **Từ chối `details.items`.** `tenant_id` ở **query**; `NOT_ENTITLED {feature_ids}` → FE đánh dấu **cả hàng**; `CORE_FEATURE_PROTECTED` không details; `INVALID_REFERENCE {field:"feature_ids"\|"group_ids", ids}`; một cặp trùng trong batch → 400 | D10 |
| C7 | `EffectiveAccess {user:{…, tenant_id, tenant_key, status, groups}, blockers[], features:[{feature, effective, reasons[], missing[]}], commands:[{id, name, aliases, description, visible, via[], blocked_by[], missing[], suggestion}], command_total, agents:{available:false}, config_version}`; `commands` ≤ 1.000; `?command=` có nhưng FE không dùng (D15) | §3.4 |
| C8 | `User.groups: GroupRef[] ≤ 50` + `group_count` trên mọi response user; `?group=<uuid>`; `PATCH /admin/users` không đổi | Users |
| C9 | `groups:[{id,key,name,is_beta,feature}] ≤ 20`, `group_count` (số cặp), `visible_user_count` | §3.6 |
| C10 | `GroupVersionConflictDetailsSchema`; `current` đầy đủ thực thể, `updated_by` có ở workflow/command/feature/group | `ConflictDialog` |
| C11 | `BETA_GROUP_PROTECTED`, `NOT_ENTITLED` (+ `NotEntitledDetailsSchema`); `API_ERRORS` = 36 mã | §8 |
| C12 | `GROUP_KEY_RE, GROUP_NAME_MAX, GROUP_DESC_MAX, GROUP_PASTE_MAX, GRANT_BATCH_MAX, BETA_GROUP_KEY, USERNAME_INPUT_MAX, USER_GROUPS_MAX, MATRIX_GROUPS_MAX, ACCESS_COMMANDS_MAX` + hàm `parseUsernameList` | §4 |

## 10. Artboard / ADR đề xuất

- **ADR:** không (D1). Nếu Gate muốn diff từng chữ hoặc `react-virtual` thì ADR Proposed riêng + Gate (không đề xuất).
- **Artboard (không chặn Gate):** (1) Group tạo mới + hộp thoại Đổi tên (mẫu B/dialog); (2) Ma trận: tri-state hàng/cột, hàng "Đã thu hồi entitlement", cảnh báo > 200 thay đổi; (3) Hộp thoại "Cấp {feature} cho group…"; (4) Drawer user: ô Groups chỉ đọc + tab Quyền hiệu lực (khớp A11). Canvas `Groups`, `Access`, `Users`, `States` đủ để code; FE đã ghi cách xử lý chỗ thiếu ở D11, D13.

## 11. Câu hỏi cho người dùng (Gate)

Không câu mới. Bốn câu đã được người dùng chấp nhận đúng mặc định (D2):
1. **A2** vế "≤ 5 s" = NOTIFY ≤ 1 s + `hub_ro` đúng (không ảnh hưởng FE).
2. **A4** câu modal có `{user}` khi `updated_by` có; bỏ "Lịch sử vẫn giữ v{n}" tới M4. Mặc định: có.
3. **A6** không UI cấp feature cho user. Mặc định: đúng.
4. **A11** ô Groups drawer user chỉ đọc (lệch artboard `Users`). Mặc định: đúng.
Quyết định FE: D11 (hàng "Chưa mở" ẩn mặc định, theo artboard; contract có `state: "none"`) và D12 (`dry_run` đã chốt).

## 12. Đề nghị cho qc (Q1/Q2)

- Tách e2e theo từng task để lệnh xong xanh tại chính task: `e2e/conflict-users.spec.ts`, `conflict-tenants`, `conflict-workflows`, `conflict-commands`, `conflict-features`, `conflict-groups`, `groups-list`, `groups-editor`, `groups-members`, `groups-features`, `access-matrix`, `access-check`, `users-groups`, `users-access`, `commands-access`, `m3-flow` (AC-A07 hai phiên: modal, diff chỉ trường khác, `Ghi đè` → v9, `Tải bản mới`; M3-AC08/09/10). Tên file là đề nghị, qc chốt và báo FE (lệnh `bunx playwright test <tên>` ở `tasks.md` sẽ đổi theo).
- Nhãn ở §5 là nguyên văn. Ca "nhãn khớp test" (bài học M2): QC khoá test **sau** khi đọc §5; FE chỉ đổi nhãn khi QC đồng ý.
- Dữ liệu seed cần cho e2e: tenant `acme` có group `beta-testers` + `ke-toan` (8 người), feature "Kế toán" entitlement cho `acme`, feature "Pháp chế" chưa mở, 1 feature thu hồi còn grant; user bị khoá; `thu.ha` (đã có).
