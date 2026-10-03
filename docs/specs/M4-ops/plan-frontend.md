# Plan · M4-ops · Frontend (frontend-lead)

PLAN · 2026-10-03 · bổ sung spec §5. Không sửa contract: spec §3 chưa có → dựa BA §8 + ms §14; điểm cần chốt ở §10.
Nguồn: spec · `ui-admin` 7.2, 7.10–7.16, F7 · `missing-screens` (**ms**) §0, 1, 4.3, 7, 8, 10–12 · canvas M4 + `Sidebar` · M3 plan-frontend D3–D9.
**Câu chữ:** key đã có ở ms dùng **nguyên văn, không chép lại**; §7 chỉ chuỗi **mới**. Trùng key thì ms thắng.

## 0. Quyết định (Luật 2; chép vào spec §9 "Trong lúc làm" khi BUILD)

| # | Quyết định | Lý do |
|---|---|---|
| D1 | **Không dùng `recharts`.** Cột ngày tự viết SVG (`DailyBars` ~120 dòng): chồng Trong quota + Vượt quota (vân chéo), `<title>` mỗi cột | recharts + d3 ≈ 100 KB gzip > chunk 50 KB; artboard là cột đơn giản |
| D2 | QR = `<img src={qr_svg}>` server trả (plan-cd §4.2); web **không** cài `qrcode`; `otpauth_url`/`secret` cho nhập tay | plan §2 #1 |
| D3 | Không thêm `input-otp`, `react-day-picker`: `OtpInput` = **một** `<input inputMode="numeric" autocomplete="one-time-code" maxLength=6>` vẽ 6 ô bằng CSS, tự gửi khi đủ 6; `PeriodFilter` = `Popover` + preset 7/30/90 ngày + 2 `<input type="date">` | ms §10 e2e "1 input duy nhất"; bundle |
| D4 | shadcn mới chép từ `radix-ui` đã có: `accordion`, `collapsible`, `toggle-group`. không npm mới | ADR-0001 |
| D5 | Mở rộng `DiffTable` M3 (chuyển `components/shared/diff/`): prop `labels{before,after}`, `mode` update/create/delete, chữ "đã đổi" (không chỉ màu), dòng "{n} trường không đổi · Hiện". `lib/diff-fields.ts` thêm `diffAll()` → `{changed, unchanged}` | ms §7.2; dùng ở Audit, Import, Conflict |
| D6 | `QuotaBanner` trong `AppShell` dưới topbar, **mọi trang** của tenant_admin, không nút đóng (Q12); platform/không quota/< 80 % → không render; lỗi tải → im lặng. Query `staleTime` 60 s, refetch khi focus, invalidate sau lưu quota | R06, F7 |
| D7 | Tab tenant theo `?tab=`; `UnsavedGuard` dirty = info ∨ quota. Info và Quota **dùng chung `version` tenant**: lưu tab nào xong thì ghi `version` mới vào form tab kia | mẫu secrets; tránh 409 giả |
| D8 | Chi tiết audit = `Sheet` 640 px, route con `/audit/$auditId` (mở thẳng URL vẫn thấy timeline); đóng → `/audit` giữ search | ms §7.2 |
| D9 | Usage: feature null hiện **"Không theo feature"** (spec R08 thắng chữ artboard) + giữ chú thích artboard | Luật 2: spec > design |
| D10 | Hub chưa có (Q5): card "Command lỗi nhiều nhất 24 giờ", "Agent Studio" hiện `common.unavailable` + `overview.hubPending`; bỏ dòng phụ "2,1% lỗi" | spec Q5 |
| D11 | Giá trị secret (Import), mã dự phòng, `totp_token`: chỉ state/bộ nhớ (`gcTime: 0`, không URL/storage); xoá khi unmount/đổi file/quay lại | BR-04, R16 |
| D12 | Tải file: `lib/download.ts` (`fetch` Bearer → Blob → `<a download>`, tên từ `Content-Disposition`), toast `transfer.toast.downloaded` | không lộ token qua URL |
| D13 | Giữ cổng hook M3 D7. Câu audit = hàm thuần `lib/audit-sentence.ts` chung cho Tổng quan + Nhật ký | CONVENTIONS §2 |

## 1. Route, menu, quyền

| Route (`routes/_authed/…`) | Màn | platform_admin | tenant_admin |
|---|---|---|---|
| `index.tsx` → `overview/pages/OverviewPage` | Tổng quan | bản `Main` | bản `TenantOverview` |
| `tenants/$tenantId.tsx` `?tab` | tab Quota | sửa | — (Tenants: 403) |
| `usage.tsx` `?tenant&period` | Chi phí & quota | mọi tenant | ép tenant mình, không ô Tenant |
| `audit/route.tsx`, `audit/$auditId.tsx` `?tenant&entity&action&actor&from&to&q` | Nhật ký | + "Toàn hệ thống", Khôi phục | tenant mình, chỉ đọc |
| `transfer.tsx` `?tab=export\|import` | Import / Export | có | `PlatformOnly` → 403 |
| `account.2fa.tsx` | Xác thực hai bước | có | có |
| `login.tsx` (bước 2 trong `LoginPage`, cùng URL) | Nhập mã TOTP | — | — |
member: mọi route trên → `/member` (`MEMBER_ALLOWED` không thêm).
Menu (`shell/lib/nav.ts`, khớp `Sidebar`): nhóm cuối **HỆ THỐNG**: `Chi phí & quota`, `Nhật ký`, `Import / Export` (chỉ platform). `crumbsFor` thêm `/usage`, `/audit`, `/audit/:id`, `/transfer`, `/account/2fa`. Menu avatar thêm `Xác thực hai bước` (ms §11).

## 2. Thành phần dùng chung mới

| Thành phần | Nơi | Ghi chú |
|---|---|---|
| `QuotaBar` | `components/shared/quota/` | `progressbar` nhãn "Run"/"Token"/"USD" ("Run · {feature}"), `aria-valuenow` ≤ 100 + `aria-valuetext`; màu theo token; vượt → vân chéo; quota trống → chữ, không progressbar |
| `quota-format` | `lib/quota-format.ts` (+test) | `pctLevel()` none/warn/over; format `4,1M`, `212,40 US$` qua `Intl` theo locale |
| `KpiCard` | `components/shared/kpi/` | `section aria-labelledby` (e2e `region`); `null` → "—" + `Tooltip` `overview.kpi.noData`; skeleton; lỗi riêng từng card (ms §12.3) |
| `DailyBars` | `components/shared/chart/` | D1; `role="img"` + `aria-label` tóm tắt + bảng `sr-only` |
| `DiffTable`, `OtpInput`, `PeriodFilter` | `shared/diff`, `shared/form` | D5, D3; nút `button "Thời gian"` hiện "Thời gian: 30 ngày" |
| `QuotaBanner` | `features/shell/components/` | D6; `Alert` vàng/cam `role="alert"` + link "Xem chi tiết" → `/usage` |
| ConflictDialog | `shared/conflict/` | R17: user/tenant có `updated_by` → câu `{user}`; bước Ghi đè thêm `conflict.overwrite.history` cho mọi entity |

## 3. Chi tiết từng màn

### 3.1 Tenant › tab Quota (FR-40; R02; Q9) — `TenantQuota`
- Theo artboard + ms §4.3. Hàng "Cả tenant" luôn có; hàng feature có nút icon `Bỏ quota {feature}`. Ô `type="number"` (step 1 / 0.01), placeholder "Không giới hạn", lỗi dưới ô (§5). Thanh lưu `EditorSaveBar`.
- `+ Thêm quota theo feature` → `Popover` + `SearchCombobox` "Chọn feature" (đã entitlement + `core`, trừ feature đã có hàng).
- Lưu = `PUT` cả bộ + `version` tenant → `toast.saved`; invalidate tenant, banner, usage. 409 → `ConflictDialog` entity `tenant` (mine = mảng quota dạng payload).

### 3.2 Chi phí & quota `/usage` (FR-42; R03, R07–R09) — `Usage`
- Lọc: (platform) `TenantPicker` · `Select` "Kỳ" (12 tháng gần nhất, giờ VN, R01) · `Xuất CSV` (D12).
- KPI Số run · Token · Số thu + delta (không render "% token qua subscription", "Slot subscription" — thiếu dữ liệu contract, TECH-DEBT #30); "Chi phí thật", "Biên" **chỉ render khi response có khoá** (server đã loại, R08 — FE không dựa role).
- `DailyBars` số thu theo ngày + chú thích.
- Platform + "Tất cả tenant": bảng "Theo tenant" (link `/tenants/$id?tab=quota`). Một tenant/tenant_admin: card "Quota tháng" (QuotaBar) thay bảng.
- "Top feature theo số thu" (5 dòng, D9); "Top user theo số thu" (`top_users`, luôn có). `billable_usd` null → "Chưa định giá"; hàng `overage` → badge err "Vượt quota".

### 3.3 Tổng quan `/` (ui 7.2; R06, R09; Q5) — `Main`, `TenantOverview`
- Thay `shell/pages/HomePage.tsx`. Tenant: ms §1 nguyên văn; `Reset mật khẩu` mở drawer Users (đã có).
- Platform (artboard `Main`, chữ ở §7): 5 KPI · "Tenant sắp hoặc đã vượt quota" (top 5 theo %) · Agent Studio + Command lỗi (D10) · "Thay đổi gần đây" (8 dòng; link "Xem nhật ký" chung 2 role thay "Nhật ký" của artboard).

### 3.4 Nhật ký `/audit` (FR-51, 52; R12, R13; Q7, Q8) — `Audit`, `States`
- ms §7 nguyên văn: lọc, nhóm theo ngày, `Tải thêm` = `useInfiniteQuery` con trỏ (limit 50). "Người thực hiện" = `SearchCombobox` trên `GET /admin/users?q` (đã có).
- Lọc "Loại" gồm cả Entitlement, 2FA; Import không có thực thể → lọc theo Hành động = Import.
- Chi tiết (D8): câu + `audit.detail.meta` · `DiffTable` (update Trước/Sau; create chỉ Sau; delete chỉ Trước; secret một dòng "Giá trị: đã thay đổi"; import: danh sách Thêm/Sửa).
- `Khôi phục bản trước` khi `entry.restorable` (luôn có) → ConfirmDialog vừa → toast, invalidate list + entity. Lỗi theo §8; 403 → toast `state.forbiddenAction` + nạp lại phiên.

### 3.5 Import / Export `/transfer` (FR-54; R14, R15; Q11, Q13) — `ImportPreview`; Export không artboard (ms §8, mẫu B có tab — đủ để code)
- Export: ms §8; "Chọn tất cả" tri-state; n và số đếm từ `export/meta`; không chọn → nút khoá + `transfer.export.none`.
- Import 1: `label` bọc `input type=file accept=".yaml,.yml"` (sr-only, nhãn "Chọn file") + kéo-thả; kiểm đuôi + ≤ 1 MB ở client (`lib/import-file.ts` +test).
- Import 2 (artboard): chip Thêm/Sửa/Không đổi = nút lọc `aria-pressed`; `Accordion` theo loại; `Xem thay đổi` → `DiffTable` inline; ô secret `type=password`. Không thay đổi → `transfer.import.nothing`, ẩn Áp dụng.
- Import 3: ms §8 → về bước 1, invalidate mọi query catalog.

### 3.6 2FA (FR-08; R16; Q10) — `Enable2FA`; bước đăng nhập không artboard (ms §10.2, mẫu D — đủ để code)
- Trang ms §10.1: `off → reauth → scan → verify → backup → on` (reducer thuần `lib/totp-steps.ts` +test). File `ai-system-backup-codes-{tenant}-{username}.txt`; rời trang ở bước 3 → `UnsavedGuard`.
- Member vào `/account/2fa` → `/member`. Admin tắt 2FA hộ user **giữ phiên** của user.
- Đã bật: `Tạo lại mã dự phòng` (dialog có `Mã xác thực`, rồi hiện bước Lưu mã); Tắt theo ms.
- Đăng nhập: `totp_required` → `LoginTotpStep` (cùng `/login`; `session.pendingTotp {token, tenant, username}` trong bộ nhớ như `pendingChange`): dòng mono "acme · thu.ha", `OtpInput` autofocus; `Dùng mã dự phòng` ↔ `Dùng mã từ ứng dụng`; `Quay lại đăng nhập` giữ mã công ty + tên đăng nhập. Verify → `authenticated` điều hướng như cũ; `password_change_required` → `/change-password`.
- Users: `⋯ › Tắt 2FA` khi `user.totp_enabled` ∧ không phải mình → ConfirmDialog vừa → toast.

## 4. Trạng thái (bộ chung ms §12; Mất mạng: `ConnectionBanner` có sẵn khoá Lưu/Áp dụng/Khôi phục)

| Màn | Đang tải | Rỗng | Lỗi | 403/404 | 409 |
|---|---|---|---|---|---|
| Tab Quota | skeleton 2 hàng | chỉ hàng "Cả tenant" | `ErrorState` trong tab | tenant khác: 404 trang | ConflictDialog |
| Usage | KPI + khung biểu đồ skeleton | Hub chưa có: "—" + tooltip, `usage.empty.noData` (R09); kỳ trống: `usage.empty.period` | từng card | `?tenant=` khác (tenant_admin) → 404 | — |
| Tổng quan | KPI skeleton | câu rỗng từng card; Hub "—" | từng card | — | — |
| Nhật ký | 8 dòng skeleton | `audit.empty` / rỗng do lọc | `ErrorState` | 404 trong Sheet | restore: toast |
| Import/Export | xem trước: skeleton + nút khoá | `transfer.import.nothing` | `ErrorState` bước 2, giữ file | tenant_admin: `ForbiddenState` | `transfer.import.stale` + chạy lại dry-run |
| 2FA | card skeleton | — | `ErrorState` | — | — |

## 5. Validate phía client (khớp contract)

| Trường | Luật | Câu |
|---|---|---|
| Số run, Số token | trống hoặc nguyên > 0 | `quota.error.positive` (ms §4.3); thập phân → `quota.error.integer` |
| Số USD | trống hoặc > 0, ≤ 2 số thập phân, < 10^10 | `quota.error.positive` / `quota.error.usdFormat` |
| File import | `.yaml/.yml`, ≤ 1 MB | `transfer.import.wrongType` / `tooLarge` |
| Giá trị secret thiếu | luật giá trị M2 (`secrets/lib/schemas.ts`) | câu M2 |
| Mã TOTP | 6 chữ số | không báo, chỉ gửi khi đủ |
| Mã dự phòng | `^[2-9a-hjkmnp-z]{4}-?[2-9a-hjkmnp-z]{4}$` (= `BACKUP_ALPHABET`, plan-cd §6) sau chuẩn hoá (thường, bỏ khoảng trắng) | `login.totp.backupFormat` |
| Mật khẩu hiện tại | không rỗng | câu M1 đã có |
| Export | ≥ 1 loại | `transfer.export.none` |

## 6. Role + nhãn e2e (bổ sung ms §1, 4.3, 7, 8, 10, 12 — giữ nguyên văn)
- Menu: `link "Chi phí & quota"` · `link "Nhật ký"` · `link "Import / Export"` · `menuitem "Xác thực hai bước"`.
- Quota: `tab "Quota"` · `spinbutton "Số run · Cả tenant"` / `"Số token · Kế toán"` / `"Số USD · Kế toán"` · `button "+ Thêm quota theo feature"` · `combobox "Chọn feature"` · `button "Bỏ quota Kế toán"` · `progressbar "Run"` / `"Run · Kế toán"` · `button "Lưu"`.
- Usage: `heading "Chi phí & quota"` · `combobox "Tenant"` · `combobox "Kỳ"` · `button "Xuất CSV"` · `region "Số run"`/`"Token"`/`"Số thu"`/`"Chi phí thật"`/`"Biên"` · `img` tên bắt đầu "Số thu theo ngày" · `table "Theo tenant"` · `region "Top feature theo số thu"`.
- Tổng quan platform: `region` theo tiêu đề KPI/card (§7) · `link "Tạo tenant"` · `link "Tạo command"`.
- Banner: `alert` chứa câu ms §1 + `link "Xem chi tiết"`; **không** có nút đóng.
- Nhật ký: Sheet = `dialog` tên là câu mô tả · `button "Đóng"`.
- 2FA: nút xác nhận trong `alertdialog "Tắt xác thực hai bước?"` = `button "Tắt xác thực hai bước"` (e2e lấy trong phạm vi dialog) · `heading "Lưu mã dự phòng"` · `alertdialog "Tắt xác thực hai bước?"` · `alertdialog "Tạo lại mã dự phòng?"`. Users: `menuitem "Tắt 2FA"` · `alertdialog "Tắt 2FA của binh.vo?"` · `button "Tắt 2FA"` · hàng Users `button "Thao tác khác"` (⋯). KPI "—": tooltip Radix `role=tooltip`.

## 7. Câu chữ MỚI (VI \| EN)
Chuỗi định dạng không cần dịch (giống nhau 2 ngôn ngữ): `quota.bar.used` "{used} / {limit}", `audit.detail.meta` "{time} · v{n} · {scope}", `tenants.quota.cell` "{field} · {scope}", `audit.entity.*` / `audit.entityLabel.*` theo 12 giá trị `AUDIT_ENTITIES`: tenant, user, user_totp, group, grant, entitlement, feature, workflow, command, secret, quota, config; ánh xạ `user_totp`→key `twofa` (nhãn 2FA), `config`→`config`; thực hiện trong `lib/audit-sentence.ts`. Key chữ thường; nhãn viết hoa đầu.

| Key | VI | EN |
|---|---|---|
| nav.group.system / usage / audit / transfer | HỆ THỐNG / Chi phí & quota / Nhật ký / Import / Export | SYSTEM / Usage & quota / Audit log / Import / Export |
| account.twofa | Xác thực hai bước | Two-step verification |
| transfer.toast.downloaded | Đã tải {file} | Downloaded {file} |
| quota.unit.runs / tokens | {n} run / {n} token | {n} runs / {n} tokens |
| quota.bar.unlimited | {used} · Không giới hạn | {used} · Unlimited |
| quota.badge.warn / over / overPct | {pct}% quota / Vượt quota / Vượt {pct}% | {pct}% of quota / Over quota / Over by {pct}% |
| quota.error.integer | Nhập số nguyên | Enter a whole number |
| tenants.quota.title / hint | Quota tháng {month} / Để trống một ô = Không giới hạn. | Quota for {month} / Leave a cell empty for unlimited. |
| tenants.quota.remove / pickFeature / noFeatureLeft | Bỏ quota {feature} / Chọn feature / Mọi feature đã có quota | Remove quota for {feature} / Choose a feature / Every feature already has a quota |
| usage.title / subtitle | Chi phí & quota / {period}. Vượt quota không chặn, phần vượt được tính phí riêng. | Usage & quota / {period}. Going over quota doesn't block; overage is billed separately. |
| usage.period / current / previous / csv | Kỳ / Tháng này / Tháng trước / Xuất CSV | Period / This month / Last month / Export CSV |
| usage.kpi.runs / tokens / billable / cost / margin | Số run / Token / Số thu / Chi phí thật / Biên | Runs / Tokens / Revenue / Actual cost / Margin |
| usage.kpi.delta / marginPct | {sign}{pct}% so với tháng {prev} / {pct}% số thu | {sign}{pct}% vs {prev} / {pct}% of revenue |
| usage.chart.title / inQuota / over | Số thu theo ngày / Trong quota / Vượt quota | Revenue by day / Within quota / Over quota |
| usage.chart.bar / summary | Ngày {date} · {amount} / Số thu theo ngày, tổng {total}, cao nhất {max} ngày {date} | {date} · {amount} / Revenue by day, total {total}, peak {max} on {date} |
| usage.byTenant.title / noQuota | Theo tenant / {used} · không đặt quota | By tenant / {used} · no quota set |
| usage.col.tenant / quota / billable / cost | Tenant / Quota tháng / Số thu / Chi phí thật | Tenant / Monthly quota / Revenue / Actual cost |
| usage.topFeature.title / topUser.title | Top feature theo số thu / Top user theo số thu | Top features by revenue / Top users by revenue |
| usage.noFeature / noFeatureNote | Không theo feature / Run qua agent chat không gắn feature nào nên đứng riêng một dòng. | No feature / Agent-chat runs aren't tied to a feature, so they get their own row. |
| usage.unpriced | Chưa định giá | Not priced yet |
| usage.empty.noData / period | Chưa có dữ liệu từ Agent Hub / Không có run nào trong kỳ này. | No data from Agent Hub yet / No runs in this period. |
| overview.platform.subtitle | Toàn bộ nền tảng · {n} tenant · cập nhật lúc {time} | Whole platform · {n} tenants · updated {time} |
| overview.platform.createTenant / createCommand | Tạo tenant / Tạo command | New tenant / New command |
| overview.kpi.activeTenants / enabledCommands | Tenant đang hoạt động / Commands đang bật | Active tenants / Enabled commands |
| overview.kpi.workflows / unattached | Workflows / {n} chưa gắn | Workflows / {n} unattached |
| overview.kpi.runs24h | Số run 24 giờ | Runs (24h) |
| overview.nearQuota.title / empty / ok | Tenant sắp hoặc đã vượt quota / Chưa tenant nào đặt quota. / Trong quota | Tenants near or over quota / No tenant has a quota yet. / Within quota |
| overview.nearQuota.col.quota / status | Quota tháng · run / Trạng thái | Monthly quota · runs / Status |
| overview.agentStudio.body | Agent, Coordinator, model và vận hành nằm ở Agent Studio. Agent chọn workflow từ catalog của Admin. | Agents, coordinators, models and operations live in Agent Studio. Agents pick workflows from the Admin catalog. |
| overview.agentStudio.open / topErrors.title | Mở Agent Studio / Command lỗi nhiều nhất 24 giờ | Open Agent Studio / Most failing commands (24h) |
| overview.hubPending | Sẽ có khi Agent Hub sẵn sàng. | Available once Agent Hub is ready. |
| audit.sentence.totpOff | {actor} đã tắt 2FA của {subject} | {actor} turned off 2FA for {subject} |
| audit.sentence.totpOffSelf (dùng khi actor_id = entity_id) | {actor} đã tắt 2FA | {actor} turned off 2FA |
| audit.sentence.totpOn / totpRegen | {actor} đã bật 2FA / {actor} đã tạo lại mã dự phòng | {actor} turned on 2FA / {actor} regenerated backup codes |
| audit.sentence.members | {actor} đã đổi thành viên {name} (Thêm {a} · Bớt {r}) | {actor} changed members of {name} ({a} added · {r} removed) |
| audit.sentence.passwordReset | {actor} đã đặt lại mật khẩu của {subject} | {actor} reset the password of {subject} |
| audit.sentence.quota / entitlement | {actor} đã đổi quota {name} / {actor} đã đổi quyền feature {name} của {subject} | {actor} changed quota {name} / {actor} changed feature access {name} for {subject} |
| audit.sentence.import ({file} = entity_name, {a}/{u} = after.added/updated, ms §7) | {actor} đã nhập cấu hình từ {file} (Thêm {a} · Sửa {u}) | {actor} imported configuration from {file} ({a} added · {u} updated) |
| audit.error.changedSince | Không khôi phục được: {name} đã được sửa sau thay đổi này. Mở bản mới nhất để xem. | Can't restore: {name} has changed since. Open the latest version to review. |
| audit.period.days / custom / from / to / apply | Thời gian: {n} ngày / Tuỳ chọn / Từ ngày / Đến ngày / Áp dụng | Period: {n} days / Custom / From / To / Apply |
| transfer.import.file / fields | {file} · {size} · hợp lệ / {n} trường | {file} · {size} · valid / {n} fields |
| transfer.import.secretUsedBy / valueLabel | Workflow {key} trong file dùng secret này. / Giá trị {name} | Workflow {key} in the file uses this secret. / Value for {name} |
| transfer.import.stale | Cấu hình vừa thay đổi. Đã tạo lại bản xem trước. | Configuration just changed. The preview was refreshed. |
| twofa.account / accountName | Tên tài khoản trong ứng dụng / AI System ({tenant} · {username}) | Account name in the app / AI System ({tenant} · {username}) |
| twofa.regen.title / submit | Tạo lại mã dự phòng? / Tạo lại | Generate new backup codes? / Generate |
| twofa.error.wrongCreds | Mật khẩu hoặc mã không đúng | Incorrect password or code |
| login.totp.backupFormat | Mã dự phòng có dạng xxxx-xxxx | Backup codes look like xxxx-xxxx |
| users.reset2fa.title / toast | Tắt 2FA của {username}? / Đã tắt 2FA của {username} | Turn off 2FA for {username}? / Turned off 2FA for {username} |
| users.reset2fa.body | {name} sẽ đăng nhập chỉ bằng mật khẩu cho tới khi tự bật lại. Thao tác được ghi vào nhật ký. | {name} will sign in with a password only until they turn it on again. This is recorded in the audit log. |
| conflict.overwrite.history | Lịch sử vẫn giữ v{n}. | History keeps v{n}. |
Xoá key `overview.welcome/soon/platform.body/tenant.body`.

## 8. Mã lỗi API → câu (`lib/errors.ts`; đã chốt: plan-cd §3.3, §4.3; plan-contract §2.4)

| Mã | Câu |
|---|---|
| `NAME_TAKEN` / `VERSION_CONFLICT` (restore) | `audit.error.nameTaken` / `audit.error.changedSince` (toast, không mở ConflictDialog) |
| `VERSION_CONFLICT` (import áp dụng) | `transfer.import.stale` + chạy lại dry-run |
| `IMPORT_INVALID` (`details.errors[{path,code,message,params}]`) · `SECRETS_REQUIRED` · 413 `PAYLOAD_TOO_LARGE` | Alert `transfer.import.invalid` + danh sách · `transfer.import.secretsMissing` · `transfer.import.tooLarge` |
| `INVALID_OTP` (401, login) · `INVALID_CURRENT_CODE` (400) | `login.totp.wrong` (xoá ô, focus) · bật `twofa.verify.wrong`; tắt/tạo lại: cả `INVALID_CURRENT_PASSWORD` lẫn `INVALID_CURRENT_CODE` → `twofa.error.wrongCreds` |
| `INVALID_TOTP_TOKEN` (401) | `login.totp.expired` → về form đăng nhập |
| `TEMP_LOCKED` · `INVALID_CURRENT_PASSWORD` (reauth bật) | `login.tempLocked` · `password.error.currentWrong` |

## 9. Hiệu năng (không chặn mốc; `check:bundle` vẫn trong Lệnh xong FE)
Chunk theo route (`autoCodeSplitting`); D1, D2; JS ban đầu chỉ thêm banner + nav (< 3 KB). Timeline > 200 dòng: `content-visibility: auto` mỗi dòng. `staleTime` Usage/banner 60 s, Overview 30 s.

## 10. Backend-lead đã chốt (2026-10-03)
Mọi đề xuất FE §10 cũ đã chốt (tên trường, `qr_svg`, `/admin/overview`, `quota-banner`, `export/meta`, `updated_by`…): xem plan §2 "Đối chiếu FE §10" và plan-contract/plan-cd. Không dùng `recharts` (ADR-0005).

## 11. Câu hỏi
- **Q-FE1 (người dùng chốt 2026-10-03: để sau, TECH-DEBT #29):** Tab **Feature** của Tenant còn "Chưa khả dụng" (ui 7.13; ngoài phạm vi M4; entitlement API theo feature). Mặc định: **không làm ở M4**, ghi `TECH-DEBT.md` (đã cấp được ở `/features/:id`). Muốn có → task FE7 + `GET /admin/tenants/:id/entitlements` (đổi phạm vi).
- Còn lại theo mặc định spec Q0–Q13.

## 12. Task FE (đã điền `tasks.md`)
**LX** = `bun run typecheck && bun test apps/admin-web && bun run i18n:check && bun run check:fn --files <file đổi> && bun run depcruise --all && bun run check:size && bunx playwright test e2e/<spec> --reporter=line`. FE0b, FE2, FE6a thêm `bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web check:bundle`. Tên spec e2e là đề xuất cho qc.

Danh sách task: xem `tasks.md` (nguồn chính).
File chính từng task: cột File của `tasks.md`.
