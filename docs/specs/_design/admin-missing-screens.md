# Admin — đề xuất các màn chưa có artboard

Tác giả: frontend-lead (PLAN) · 2026-10-01 · Trạng thái: **đề xuất, chờ vẽ lên canvas và duyệt cùng Gate**
Nguồn: `design/admin/ui-admin.md` v0.4 (UI) · `design/admin/ba-admin.md` (BA) · `readiness/2026-10-01-admin-m1-m4.md` (mặc định đã chấp nhận, trích `R#<số dòng>`) · 7 artboard đã có trên canvas.
Quy ước: chỗ BA/UI chưa nói → ghi **Đề xuất** kèm mặc định. Không có quyết định nghiệp vụ mới ngoài các dòng Đề xuất.

---

## 0. Quy ước chung cho mọi màn

### 0.1 Ngôn ngữ thiết kế (theo canvas đã duyệt hướng)
- Font **Be Vietnam Pro** (chữ) + **JetBrains Mono** (tên command `/dich`, key, tên secret, `•••• 7f3a`, số tiền `212,40 US$`, version `v43`, mã dự phòng).
- Nền `#F7F6FA`; card trắng viền `#E6E3EE` bo 12; primary `#6B4FA0`; màu đậm `#2E2150` (tiêu đề, chữ chính).
- Badge 5 biến thể: `ok` (Bật, Đang hoạt động) · `off` (Tắt, Chưa dùng) · `warn` (Beta, 80% quota, Chưa đăng nhập) · `info` (Mặc định, Nền tảng, bạn) · `err` (Đã khoá, Vượt quota).
- Sidebar 248px theo sitemap v0.4; topbar có breadcrumb, ô tìm, badge tenant (`tenant_admin`: tên tenant) hoặc "Nền tảng" (`platform_admin`), badge `config v43`, avatar.
- **Mâu thuẫn cần docs-architect sửa `ui-admin.md` §4–§5:** canvas dùng sidebar 248px, primary `#6B4FA0`, bo card 12px, font Be Vietnam Pro/JetBrains Mono; `ui-admin.md` ghi 240px, `#4f46e5`, 8px, System UI. **Canvas thắng** (đã duyệt sau).

### 0.2 Mẫu trang
| Mẫu | Vùng từ trên xuống | shadcn |
|---|---|---|
| **A. Danh sách** | Header trang (H1 + mô tả 1 dòng + nút chính phải) → (platform_admin) ô chọn tenant → thanh lọc (Input tìm + ToggleGroup chip + Select lọc riêng) → DataTable trong Card → phân trang | `Card`, `Input`, `ToggleGroup`, `Select`, `Table` + TanStack Table, `DropdownMenu`, `Switch`, `Badge`, `Pagination`, `Skeleton` |
| **B. Trang có tab** | Breadcrumb → header (tên + badge trạng thái + nút phụ phải) → `Tabs` → nội dung tab → thanh lưu dính đáy (chỉ tab có form) | `Tabs`, `Card`, `Form`, `AlertDialog` |
| **C. Drawer** | Danh sách mẫu A giữ phía sau → `Sheet side="right"` rộng 520px (100% khi < 1024px): tiêu đề → (tab) → form → chân drawer [Huỷ] [Lưu] | `Sheet`, `Tabs`, `Form` |
| **D. Ngoài khung** | Không sidebar/topbar; card 400px giữa màn hình trên nền `#F7F6FA`; logo ngang trên card | `Card`, `Form`, `InputOTP` |

### 0.3 Dữ liệu mẫu dùng thống nhất
| Loại | Dữ liệu |
|---|---|
| Tenant | `platform` · Nền tảng · 3 user · Không giới hạn · Đang hoạt động — `acme` · Công ty ACME · 120 user · 820 / 1.000 run (82%) — `globex` · Globex Việt Nam · 45 user · 1.080 / 1.000 run (Vượt 8%) — `initech` · Initech · 12 user · Đã khoá |
| User | `minh.pham` Phạm Minh (platform_admin, platform) · `thu.ha` Hà Thu (tenant_admin, acme, thu.ha@acme.vn) · `lan.tran` Trần Lan (member, acme, group Kế toán) · `an` Nguyễn An (member, acme) · `cuong.le` Lê Cường (member, acme, Đã khoá) · `binh.vo` Võ Bình (member, acme, chưa đăng nhập) · `an` (member, globex — trùng username khác tenant) |
| Group (acme) | `ke-toan` Kế toán (8 người) · `beta-testers` (tạo sẵn, 3 người) · `kinh-doanh` Kinh doanh (24 người) |
| Feature | `core` Cơ bản (Mặc định) · `ke-toan` Kế toán · `dich-thuat` Dịch thuật · `bao-cao` Báo cáo (Beta) · `thu-nghiem` Thử nghiệm (Tắt) |
| Workflow | `translate` · `summarize` · `invoice-check` · `report-export` (Tắt) · `report-tax` (Chưa gắn) |
| Command | `/dich` (alias `tr`) · `/tom-tat` · `/kiemtra-hoadon` · `/tr-nhanh` (Tắt) · `/xuat-bao-cao` (workflow Tắt) |
| Secret | `DIFY_TRANSLATE_KEY` •••• 7f3a · `DIFY_INVOICE_KEY` •••• 91c2 · `DIFY_SUMMARIZE_KEY` •••• 0b5e · `DIFY_OLD_KEY` •••• 44aa (chưa dùng) |
| Config | `v43`, cập nhật 10:42 bởi minh.pham |

### 0.4 Luật hiển thị theo role chung
- Menu ẩn hẳn mục không có quyền (P9). Mở thẳng URL không có quyền → trạng thái **Không có quyền** (§12.4).
- Thực thể của tenant khác (tenant_admin mở `/users/<id globex>`) → trạng thái **Không tìm thấy** (404, BR-09).
- `platform_admin` có ô chọn tenant (`?tenant=`) ở Users, Nhật ký (và Groups, Phân quyền, Chi phí — đã có artboard). Nhãn: `combobox "Tenant"`, mục đầu "Tất cả tenant". Ghi dữ liệu khi đang "Tất cả tenant" → nút tạo bị khoá, tooltip "Chọn một tenant trước" (khớp R#38 `TENANT_REQUIRED`).
- Tên đăng nhập hiển thị là **"Tên đăng nhập"** (R#47), trạng thái user là **"Đang hoạt động / Đã khoá"** (R#46).

### 0.5 Câu chữ dùng chung (VI | EN)
| Key | VI | EN |
|---|---|---|
| common.save | Lưu | Save |
| common.cancel | Huỷ | Cancel |
| common.close | Đóng | Close |
| common.confirm | Xác nhận | Confirm |
| common.retry | Thử lại | Retry |
| common.search | Tìm… | Search… |
| common.clearFilters | Xoá bộ lọc | Clear filters |
| common.all | Tất cả | All |
| common.on / off | Bật / Tắt | Enabled / Disabled |
| common.actions | Thao tác | Actions |
| common.moreActions (aria-label nút ⋯) | Thao tác khác | More actions |
| common.undo | Hoàn tác | Undo |
| common.copy | Sao chép | Copy |
| common.copied | Đã sao chép | Copied |
| common.unsaved | Chưa lưu thay đổi | Unsaved changes |
| common.savedVersion | Đã lưu · v{n} | Saved · v{n} |
| toast.saved | Đã lưu và áp dụng · v{n} | Saved and applied · v{n} |
| toast.saveFailed | Không lưu được: {reason} | Couldn't save: {reason} |
| common.you | (bạn) | (you) |
| common.unlimited | Không giới hạn | Unlimited |
| common.tenantPicker.all | Tất cả tenant | All tenants |
| common.tenantPicker.required | Chọn một tenant trước | Select a tenant first |

---

## 1. Tổng quan (tenant_admin) — `/`

**Mục đích:** tenant admin thấy ngay sức khoẻ tenant: bao nhiêu người, nhóm, run và còn bao nhiêu quota. · **Role:** `tenant_admin` (platform_admin xem bản platform đã có artboard). · FR: ba-admin §9, ui-admin 7.2, R#33, R#42.

### Bố cục
1. **Banner quota** (chỉ khi ≥ 80%) dính dưới topbar — `Alert` vàng (80–99%) / cam (≥ 100%).
2. **Header:** H1 "Tổng quan" · mô tả "Công ty ACME · tháng 10/2026".
3. **Hàng KPI** 4 card ngang (≥ 1280: 4 cột; 768–1279: 2 cột; < 768: 1 cột): Users đang hoạt động `118` · Groups `3` · Số run tháng này `820` (delta "+12% so với tháng trước") · Card QuotaBar (các quota của tenant: run `820 / 1.000`, token `4,1M · Không giới hạn`, USD `212,40 / 300,00 US$`) + link "Xem chi phí & quota".
4. **Hàng 2** (2 cột 1:1):
   - Card "Người dùng mới chưa đăng nhập" — danh sách tối đa 5: `binh.vo · Võ Bình · tạo 3 ngày trước` + nút phụ `Reset mật khẩu`… (mở drawer User). Link "Xem tất cả" → `/users?login=never`.
   - Card "Thay đổi gần đây" — 8 dòng audit của tenant: `thu.ha đã cấp Kế toán cho group Kế toán · 10:42`. Link "Xem nhật ký" → `/audit`.
5. Hub chưa có dữ liệu (số run lấy từ `hub.usage_logs`): KPI hiện "—" kèm tooltip "Chưa có dữ liệu từ Agent Hub" (R#33).

### Câu chữ
| Key | VI | EN |
|---|---|---|
| overview.title | Tổng quan | Overview |
| overview.subtitle | {tenant} · tháng {month} | {tenant} · {month} |
| overview.kpi.activeUsers | Users đang hoạt động | Active users |
| overview.kpi.groups | Groups | Groups |
| overview.kpi.runsMonth | Số run tháng này | Runs this month |
| overview.kpi.delta | {sign}{pct}% so với tháng trước | {sign}{pct}% vs last month |
| overview.kpi.quota | Quota tháng | Monthly quota |
| overview.kpi.noData | Chưa có dữ liệu từ Agent Hub | No data from Agent Hub yet |
| overview.quota.link | Xem chi phí & quota | View usage & quota |
| overview.neverLoggedIn.title | Người dùng mới chưa đăng nhập | New users who haven't signed in |
| overview.neverLoggedIn.item | tạo {relative} | created {relative} |
| overview.neverLoggedIn.empty | Mọi người dùng mới đều đã đăng nhập. | All new users have signed in. |
| overview.neverLoggedIn.all | Xem tất cả | View all |
| overview.recent.title | Thay đổi gần đây | Recent changes |
| overview.recent.empty | Chưa có thay đổi nào trong tenant. | No changes in this tenant yet. |
| overview.recent.link | Xem nhật ký | View audit log |
| banner.quota80 | Đã dùng {pct}% quota tháng này | {pct}% of this month's quota used |
| banner.quota100 | Đang vượt quota, phần vượt được tính phí | Over quota — overage is billed separately |
| banner.quotaLink | Xem chi tiết | Details |

### Role + nhãn cho e2e
`heading "Tổng quan"` · `region "Users đang hoạt động"` (mỗi card KPI là `section` có `aria-labelledby` tiêu đề) · `region "Quota tháng"` · `progressbar "Run"` / `"Token"` / `"USD"` (QuotaBar dùng `role="progressbar"` + `aria-valuenow`) · `region "Người dùng mới chưa đăng nhập"` · `region "Thay đổi gần đây"` · `link "Xem nhật ký"` · `link "Xem chi phí & quota"` · banner: `alert` chứa "Đã dùng 82% quota tháng này".

### Luật hiển thị
- Banner chỉ `tenant_admin` thấy (R#42); `warn_pct` cố định 80 (R#48).
- Quota để trống → QuotaBar "Không giới hạn" + số đã dùng.

---

## 2. Commands — danh sách `/commands`

**Mục đích:** tìm, bật/tắt nhanh và mở editor command. · **Role:** chỉ `platform_admin`. · FR: ADM-FR-20, BR-06, ui-admin 7.3. (M2: chưa có Test — ROADMAP.)

### Bố cục (mẫu A)
1. Header: H1 "Commands" · mô tả "Lệnh ngắn người dùng gõ trong Chat và Extension, mỗi lệnh gọi một workflow." · nút chính `+ Tạo command` (phím `N`).
2. Thanh lọc: `Input` tìm (placeholder "Tìm theo tên, alias, mô tả…", phím `/`) · `ToggleGroup` chip `Tất cả 5` `Bật 3` `Tắt 2` · `Select` "Feature" (Tất cả feature / core / Kế toán…) · `Select` "Workflow". Lưu trên URL `?q=&status=&feature=&workflow=`.
3. DataTable cột: **Tên** (mono `/dich` + alias nhỏ `tr`) · **Mô tả** (cắt 1 dòng, cờ "EN thiếu" nếu thiếu bản EN) · **Workflow** (`translate`, badge `Tắt` nếu workflow tắt) · **Feature** (chip, bấm mở feature) · **Chế độ** (`sync`/`async`) · **Trạng thái** (`Switch`) · **Cập nhật** ("2 giờ trước · minh.pham") · `⋯`.
4. Menu `⋯`: Sửa · Nhân bản · Bật/Tắt · Lịch sử · Xoá.
5. Hàng mẫu:
   | Tên | Mô tả | Workflow | Feature | Chế độ | Trạng thái |
   |---|---|---|---|---|---|
   | `/dich` `tr` | Dịch văn bản sang ngôn ngữ khác | translate | core | sync | Bật |
   | `/tom-tat` | Tóm tắt đoạn bôi đen | summarize | core | sync | Bật |
   | `/kiemtra-hoadon` | Kiểm tra hoá đơn VAT đầu vào | invoice-check | Kế toán | async | Bật |
   | `/tr-nhanh` | Dịch nhanh, không giữ định dạng | translate | Dịch thuật | sync | Tắt |
   | `/xuat-bao-cao` | Xuất báo cáo tháng ra Excel | report-export `Tắt` | Báo cáo | async | Tắt (khoá) |

### Tương tác
- Toggle: tắt → toast "Đã tắt /dich · [Hoàn tác]" 5 giây (R mâu thuẫn 6). Workflow tắt → toggle `disabled` + tooltip "Bật workflow report-export trước".
- Xoá: ConfirmDialog **nặng** — gõ lại tên command; hiện "Người dùng các feature core sẽ không gõ được /tr-nhanh nữa." → toast "Đã xoá /tr-nhanh".
- Nhân bản: mở `/commands/new?from=<id>` tên `dich-copy`, Tắt, cùng feature (ui-admin 7.4).
- Lịch sử: `Sheet` liệt kê audit của command (dùng lại component timeline §7).

### Câu chữ
| Key | VI | EN |
|---|---|---|
| commands.list.title | Commands | Commands |
| commands.list.subtitle | Lệnh ngắn người dùng gõ trong Chat và Extension, mỗi lệnh gọi một workflow. | Short commands users type in Chat and the Extension; each calls one workflow. |
| commands.list.create | + Tạo command | + New command |
| commands.list.search | Tìm theo tên, alias, mô tả… | Search by name, alias, description… |
| commands.list.col.name / description / workflow / feature / mode / status / updated | Tên / Mô tả / Workflow / Feature / Chế độ / Trạng thái / Cập nhật | Name / Description / Workflow / Feature / Mode / Status / Updated |
| commands.list.filter.feature / workflow | Feature / Workflow | Feature / Workflow |
| commands.list.enMissing | EN thiếu | EN missing |
| commands.list.toggle.aria | Bật command /{name} | Enable command /{name} |
| commands.list.workflowOff | Bật workflow {key} trước | Enable workflow {key} first |
| commands.list.menu.edit / duplicate / history / delete | Sửa / Nhân bản / Lịch sử / Xoá | Edit / Duplicate / History / Delete |
| commands.toast.disabled | Đã tắt /{name} | Disabled /{name} |
| commands.toast.enabled | Đã bật /{name} | Enabled /{name} |
| commands.toast.deleted | Đã xoá /{name} | Deleted /{name} |
| commands.delete.title | Xoá /{name}? | Delete /{name}? |
| commands.delete.body | Người dùng các feature {features} sẽ không gõ được /{name} nữa. Thao tác này không hoàn tác được. | Users of {features} will no longer be able to run /{name}. This can't be undone. |
| commands.delete.typeToConfirm | Gõ {name} để xác nhận | Type {name} to confirm |
| commands.delete.submit | Xoá command | Delete command |
| commands.empty | Chưa có command nào. Command giúp người dùng gọi workflow bằng một lệnh ngắn như /dich. | No commands yet. A command lets users call a workflow with a short command like /dich. |
| commands.empty.cta | + Tạo command đầu tiên | + Create your first command |
| commands.empty.noWorkflow | Khai báo workflow trước | Add a workflow first |

### Role + nhãn cho e2e
`heading "Commands"` · `link "+ Tạo command"` (điều hướng nên là link) · `searchbox "Tìm theo tên, alias, mô tả…"` · `radio "Bật"`/`"Tắt"`/`"Tất cả"` (ToggleGroup single → radio) · `combobox "Feature"` · `combobox "Workflow"` · `table "Commands"` · `row` chứa "/dich" · `switch "Bật command /dich"` · `button "Thao tác khác"` trong hàng → `menuitem "Nhân bản"` / `"Lịch sử"` / `"Xoá"` · `alertdialog "Xoá /tr-nhanh?"` · `textbox "Gõ tr-nhanh để xác nhận"` · `button "Xoá command"` · toast `status` chứa "Đã tắt /dich" + `button "Hoàn tác"`.

---

## 3. Features — danh sách `/features` + editor `/features/:id`

**Mục đích:** gom command thành gói chức năng, bật/tắt (kill switch) và cấp cho tenant. · **Role:** chỉ `platform_admin`. · FR: ADM-FR-30, 31, 33, 34, BR-10, 12, R#7, R#29.

### 3.1 Danh sách (mẫu A)
- Header: H1 "Features" · "Gói chức năng. Người dùng thấy command khi feature chứa nó được cấp cho họ." · `+ Tạo feature`.
- Chip: `Tất cả 5` `Bật 3` `Beta 1` `Tắt 1`.
- Cột: **Tên** (icon + tên VI, key mono dưới) · **Trạng thái** (`Badge` Bật/Beta/Tắt; `core` thêm badge `info` "Mặc định") · **Commands** (số) · **Tenant** (số tenant được entitlement; `core` ghi "Mọi tenant") · **Cập nhật** · `⋯` (Sửa · Bật · Tắt · Chuyển sang Beta · Xoá).
- Hàng mẫu: `core` Cơ bản · Bật · Mặc định · 6 · Mọi tenant — `ke-toan` Kế toán · Bật · 3 · 2 — `dich-thuat` Dịch thuật · Bật · 2 · 1 — `bao-cao` Báo cáo · Beta · 1 · 1 — `thu-nghiem` Thử nghiệm · Tắt · 0 · 0.
- Đổi trạng thái trên list dùng `DropdownMenu` (3 trạng thái, không dùng Switch). Tắt → ConfirmDialog **vừa** (ui-admin 7.12).

### 3.2 Editor (mẫu B, 3 tab)
Header: breadcrumb "Features › Kế toán" · tên + badge trạng thái · nút phụ `Lịch sử`.

**Tab "Thông tin"** (form, thanh lưu dính đáy):
- `Key` (mono, `^[a-z0-9-]{2,32}$`) — chỉ sửa khi tạo; sau khi lưu `readOnly` kèm gợi ý "Key không đổi được sau khi tạo" (R#29 "key bất biến").
- `Tên` với tab nhỏ `VI` `EN` (VI bắt buộc, EN trống dùng VI).
- `Mô tả` VI/EN (`Textarea`, không bắt buộc — Đề xuất: tối đa 400 ký tự).
- `Icon` — Đề xuất: combobox chọn tên icon lucide (`calculator`, `languages`…), mặc định `package`.
- `Trạng thái` — `RadioGroup`: Bật · Beta ("Chỉ group beta-testers thấy") · Tắt.
- `core`: key, trạng thái khoá, gợi ý "Feature mặc định: luôn bật và tự có hiệu lực với mọi người dùng" (R#7, R#29).

**Tab "Commands"** (lưu ngay khi thêm/bỏ — Đề xuất, giống GrantMatrix lưu 1 lần thì phức tạp hơn; mặc định: danh sách nháp + thanh lưu chung với tab Thông tin):
- `RefPicker` "Thêm command" → bảng: Tên (mono) · Mô tả · Feature khác · nút `✕` (aria "Bỏ /dich khỏi feature").
- Bỏ command mà command không còn feature nào → cảnh báo inline dưới hàng: "/tr-nhanh sẽ không thuộc feature nào và biến khỏi menu" và **chặn lưu** với lỗi "Command phải thuộc ít nhất một feature" (BR-10).

**Tab "Tenant"** (entitlement, mỗi thao tác lưu ngay):
- Nút `+ Cấp cho tenant` → `Popover` + `Command` chọn tenant chưa có.
- Bảng: Mã công ty (mono) · Tên · Số user đang dùng · Cấp lúc · Cấp bởi · nút `Thu hồi`.
- Thu hồi → ConfirmDialog **nặng**: gõ lại mã công ty, "Thu hồi Kế toán của acme? 8 người đang dùng sẽ mất 3 command trong vài giây. Grant của tenant được giữ lại và có hiệu lực trở lại khi cấp lại." (BR-12) → toast "Đã thu hồi Kế toán của acme · [Hoàn tác]".
- `core`: không có nút; dòng "Feature core được cấp cho mọi tenant." (BR-10).

### Luật
- Xoá feature bị chặn khi có command chỉ thuộc feature đó → dialog liệt kê các command (DependencyList) (R#29).
- `core`, `beta-testers` không xoá/tắt/đổi key (R#29): menu `⋯` của `core` chỉ có "Sửa".
- Tắt: "Tắt Kế toán? 3 command biến khỏi menu của 120 người trong vài giây. Run đang chạy vẫn chạy xong." (ui-admin 7.12).

### Câu chữ
| Key | VI | EN |
|---|---|---|
| features.list.title | Features | Features |
| features.list.subtitle | Gói chức năng. Người dùng thấy command khi feature chứa nó được cấp cho họ. | Feature bundles. Users see a command when a feature containing it is granted to them. |
| features.list.create | + Tạo feature | + New feature |
| features.col.name / status / commands / tenants / updated | Tên / Trạng thái / Commands / Tenant / Cập nhật | Name / Status / Commands / Tenants / Updated |
| features.status.on / beta / off | Bật / Beta / Tắt | Enabled / Beta / Disabled |
| features.default | Mặc định | Default |
| features.allTenants | Mọi tenant | All tenants |
| features.menu.toBeta | Chuyển sang Beta | Move to Beta |
| features.tab.info / commands / tenants | Thông tin / Commands / Tenant | Details / Commands / Tenants |
| features.field.key / name / description / icon / status | Key / Tên / Mô tả / Icon / Trạng thái | Key / Name / Description / Icon / Status |
| features.field.keyLocked | Key không đổi được sau khi tạo | Key can't be changed after creation |
| features.field.betaHint | Chỉ group beta-testers thấy | Only the beta-testers group can see it |
| features.core.hint | Feature mặc định: luôn bật và tự có hiệu lực với mọi người dùng | Default feature: always on and available to every user |
| features.commands.add | Thêm command | Add command |
| features.commands.remove.aria | Bỏ /{name} khỏi feature | Remove /{name} from feature |
| features.commands.orphan | /{name} sẽ không thuộc feature nào và biến khỏi menu | /{name} will belong to no feature and disappear from the menu |
| features.commands.empty | Feature chưa có command nào. Thêm command để người được cấp feature này dùng được. | No commands yet. Add commands so people granted this feature can use them. |
| features.tenants.grant | + Cấp cho tenant | + Grant to tenant |
| features.tenants.revoke | Thu hồi | Revoke |
| features.tenants.coreAll | Feature core được cấp cho mọi tenant. | The core feature is granted to every tenant. |
| features.tenants.empty | Chưa cấp cho tenant nào. | Not granted to any tenant yet. |
| features.revoke.title | Thu hồi {feature} của {tenant}? | Revoke {feature} from {tenant}? |
| features.revoke.body | {users} người đang dùng sẽ mất {commands} command trong vài giây. Grant của tenant được giữ lại và có hiệu lực trở lại khi cấp lại. | {users} people will lose {commands} commands within seconds. The tenant's grants are kept and apply again if re-granted. |
| features.revoke.typeToConfirm | Gõ {tenant} để xác nhận | Type {tenant} to confirm |
| features.toast.granted | Đã cấp {feature} cho {tenant} · có hiệu lực sau vài giây | Granted {feature} to {tenant} · takes effect in a few seconds |
| features.toast.revoked | Đã thu hồi {feature} của {tenant} | Revoked {feature} from {tenant} |
| features.disable.title | Tắt {feature}? | Disable {feature}? |
| features.disable.body | {commands} command biến khỏi menu của {users} người trong vài giây. Run đang chạy vẫn chạy xong. | {commands} commands disappear from {users} people's menus within seconds. Running jobs will finish. |
| features.disable.submit | Tắt feature | Disable feature |
| features.delete.blocked | Không xoá được {feature}: các command sau chỉ thuộc feature này. Chuyển chúng sang feature khác trước. | Can't delete {feature}: these commands belong only to it. Move them to another feature first. |
| features.empty | Chưa có feature nào ngoài core. Feature gom các command để cấp cho tenant và group. | No features besides core. Features bundle commands to grant to tenants and groups. |
| features.error.keyTaken | Key đã được dùng | Key is already in use |
| features.error.keyFormat | Chỉ dùng chữ thường không dấu, số, dấu - (2–32 ký tự) | Use lowercase letters, digits and - only (2–32 chars) |

### Role + nhãn cho e2e
`heading "Features"` · `link "+ Tạo feature"` · `table "Features"` · `tab "Thông tin"` / `"Commands"` / `"Tenant"` · `textbox "Key"` · `textbox "Tên"` (tab `tab "VI"`/`"EN"` trong nhóm `tablist "Ngôn ngữ"`) · `radio "Bật"`/`"Beta"`/`"Tắt"` · `combobox "Thêm command"` · `button "Bỏ /dich khỏi feature"` · `button "+ Cấp cho tenant"` · `button "Thu hồi"` (trong hàng acme) · `alertdialog "Thu hồi Kế toán của acme?"` · `textbox "Gõ acme để xác nhận"` · `button "Tắt feature"` · `button "Lưu"`.

---

## 4. Tenants — `/tenants`, `/tenants/new`, `/tenants/:id`

**Mục đích:** onboard công ty khách hàng, cấp feature, đặt quota, khoá/mở khoá. · **Role:** chỉ `platform_admin`. · FR: ADM-FR-60, 61, 40, 31, R#9, R#21, R#31, R#53.

### 4.1 Danh sách (mẫu A)
- Header: H1 "Tenants" · "Công ty khách hàng dùng nền tảng. Mỗi tenant có user, group và quota riêng." · `+ Tạo tenant`.
- Chip: `Tất cả 4` `Đang hoạt động 3` `Đã khoá 1`. Chip phụ "Sắp/đã vượt quota".
- Cột: **Mã công ty** (mono) · **Tên** · **Users** · **Quota tháng này** (QuotaBar nhỏ theo quota chính: run) · **Slot subscription** ("Không giới hạn" / "3") · **Trạng thái** · `⋯` (Mở · Khoá · Mở khoá).
- Hàng mẫu: `platform` Nền tảng · 3 · Không giới hạn · Không giới hạn · Đang hoạt động (badge `info` "Nền tảng") — `acme` Công ty ACME · 120 · 820 / 1.000 (82%, vàng) · 5 · Đang hoạt động — `globex` Globex Việt Nam · 45 · 1.080 / 1.000 (Vượt 8%) · Không giới hạn · Đang hoạt động — `initech` Initech · 12 · 0 / 500 · 2 · Đã khoá.
- Tenant `platform`: không có mục "Khoá" (R#21 cấm khoá tenant platform).
- **Đề xuất:** không có "Xoá tenant" trong v1 (UI chỉ mô tả Khoá; xoá tenant có thể mất dữ liệu → hard stop). Mặc định: không có nút Xoá.

### 4.2 Tạo tenant `/tenants/new` (trang 1 cột, 2 card, 1 nút lưu)
- Card "Công ty": `Mã công ty` (mono, tự chuyển thường + bỏ dấu, gợi ý "Người dùng gõ mã này khi đăng nhập. Không đổi được sau khi tạo." — **Đề xuất** bất biến vì là định danh đăng nhập) · `Tên công ty` · `Giới hạn slot subscription` (số, trống = không giới hạn).
- Card "Tenant admin đầu tiên": `Tên đăng nhập` (`^[a-z0-9._-]{2,32}$`) · `Tên hiển thị` · `Email` (bắt buộc với tenant_admin, R#9) · `Ngôn ngữ` (Tiếng Việt / English, mặc định VI).
- Nút `Tạo tenant`. Thành công → **Dialog mật khẩu tạm** (không đóng bằng click nền, chỉ nút):
  - Tiêu đề "Đã tạo tenant acme"
  - Mô tả "Gửi thông tin sau cho khách qua kênh riêng. Mật khẩu tạm chỉ hiện một lần."
  - Ô đọc (mono): Mã công ty `acme` · Tên đăng nhập `thu.ha` · Mật khẩu tạm `Xk7p-2mQa-9vLr-t4Ne` (16 ký tự, R#53; hiển thị nhóm 4 cho dễ đọc — Đề xuất) · nút `Sao chép tất cả`.
  - Checkbox "Tôi đã lưu mật khẩu tạm" → mới bật nút `Đi tới tenant`.
  - Toast sau khi sao chép: "Đã copy mật khẩu tạm, hãy gửi cho người dùng qua kênh riêng."
  - Sau khi đóng → `/tenants/:id?tab=features`.

### 4.3 Chi tiết `/tenants/:id` (mẫu B, 5 tab)
Header: breadcrumb "Tenants › Công ty ACME" · `acme` mono + badge trạng thái · nút phụ `Khoá tenant` (hoặc `Mở khoá tenant`; ẩn với `platform`).

| Tab | Nội dung |
|---|---|
| **Thông tin** | Form: Mã công ty (readOnly) · Tên công ty · Giới hạn slot subscription (trống = "Không giới hạn") · Trạng thái (chỉ đọc, đổi bằng nút Khoá). Thông tin phụ: tạo lúc, số user. Thanh lưu dính đáy. |
| **Feature** | Bảng entitlement: Feature · Trạng thái feature · Commands · Grant trong tenant (số group) · Cấp lúc · `Thu hồi`. Nút `+ Cấp feature`. `core` luôn có, không thu hồi. Thu hồi = ConfirmDialog nặng như §3.2. |
| **Agent** | M1–M4: Card rỗng "Cấp agent cho tenant làm ở Agent Studio. Mục này sẽ khả dụng khi Agent Hub sẵn sàng." + link "Mở Agent Studio" (tắt, tooltip "Chưa khả dụng") — khớp R#34/ROADMAP M5. |
| **Quota** | Bảng: Phạm vi (Cả tenant / từng feature) · Số run · Số token · Số USD · Đã dùng tháng này (QuotaBar). Mỗi ô là `Input` số, trống = "Không giới hạn". Nút `+ Thêm quota theo feature`. Chú thích "Vượt quota không chặn; tenant admin nhận cảnh báo ở 80% và 100%. Tháng tính theo giờ Việt Nam." (FR-41, R#31). Thanh lưu dính đáy. |
| **Users** | Tóm tắt: `120 user · 2 tenant_admin · 1 đã khoá` + nút `Mở danh sách Users` → `/users?tenant=acme`. |

- Khoá tenant → ConfirmDialog **nặng**: "Khoá tenant acme?" · "Mọi user của acme (120 người) bị đăng xuất và không đăng nhập được." · ô "Gõ acme để xác nhận" · `Khoá tenant` → toast "Đã khoá acme".
- Mở khoá → ConfirmDialog **vừa**: "Mở khoá acme? User trở về trạng thái trước khi khoá tenant; user đã bị khoá riêng vẫn bị khoá." (FR-61, R#21) · `Mở khoá` → toast "Đã mở khoá acme".

### Câu chữ
| Key | VI | EN |
|---|---|---|
| tenants.list.title | Tenants | Tenants |
| tenants.list.subtitle | Công ty khách hàng dùng nền tảng. Mỗi tenant có user, group và quota riêng. | Customer companies on the platform. Each has its own users, groups and quota. |
| tenants.list.create | + Tạo tenant | + New tenant |
| tenants.col.key / name / users / quota / slots / status | Mã công ty / Tên / Users / Quota tháng này / Slot subscription / Trạng thái | Company code / Name / Users / Quota this month / Subscription slots / Status |
| tenants.status.active / locked | Đang hoạt động / Đã khoá | Active / Locked |
| tenants.filter.nearQuota | Sắp/đã vượt quota | Near/over quota |
| tenants.new.title | Tạo tenant | New tenant |
| tenants.new.company | Công ty | Company |
| tenants.new.firstAdmin | Tenant admin đầu tiên | First tenant admin |
| tenants.field.key / name / slots | Mã công ty / Tên công ty / Giới hạn slot subscription | Company code / Company name / Subscription slot limit |
| tenants.field.keyHint | Người dùng gõ mã này khi đăng nhập. Không đổi được sau khi tạo. | Users type this code to sign in. It can't be changed later. |
| tenants.field.slotsHint | Để trống = không giới hạn | Leave empty for unlimited |
| users.field.username / displayName / email / locale | Tên đăng nhập / Tên hiển thị / Email / Ngôn ngữ | Username / Display name / Email / Language |
| tenants.new.submit | Tạo tenant | Create tenant |
| tempPassword.titleTenant | Đã tạo tenant {key} | Tenant {key} created |
| tempPassword.body | Gửi thông tin sau cho khách qua kênh riêng. Mật khẩu tạm chỉ hiện một lần. | Send these details through a private channel. The temporary password is shown only once. |
| tempPassword.password | Mật khẩu tạm | Temporary password |
| tempPassword.copyAll | Sao chép tất cả | Copy all |
| tempPassword.ack | Tôi đã lưu mật khẩu tạm | I've saved the temporary password |
| tempPassword.toast | Đã copy mật khẩu tạm, hãy gửi cho người dùng qua kênh riêng. | Temporary password copied — send it to the user through a private channel. |
| tenants.new.goTo | Đi tới tenant | Go to tenant |
| tenants.tab.info / features / agents / quota / users | Thông tin / Feature / Agent / Quota / Users | Details / Features / Agents / Quota / Users |
| tenants.features.grant | + Cấp feature | + Grant feature |
| tenants.agents.unavailable | Cấp agent cho tenant làm ở Agent Studio. Mục này sẽ khả dụng khi Agent Hub sẵn sàng. | Agents are granted in Agent Studio. This will be available once Agent Hub is ready. |
| tenants.agents.open | Mở Agent Studio | Open Agent Studio |
| common.unavailable | Chưa khả dụng | Not available yet |
| tenants.quota.scope.tenant | Cả tenant | Whole tenant |
| tenants.quota.col.scope / runs / tokens / usd / used | Phạm vi / Số run / Số token / Số USD / Đã dùng tháng này | Scope / Runs / Tokens / USD / Used this month |
| tenants.quota.addFeature | + Thêm quota theo feature | + Add per-feature quota |
| tenants.quota.note | Vượt quota không chặn; tenant admin nhận cảnh báo ở 80% và 100%. Tháng tính theo giờ Việt Nam. | Going over quota doesn't block; tenant admins are alerted at 80% and 100%. Months follow Vietnam time. |
| tenants.users.summary | {users} user · {admins} tenant_admin · {locked} đã khoá | {users} users · {admins} tenant admins · {locked} locked |
| tenants.users.open | Mở danh sách Users | Open Users list |
| tenants.lock.button / unlock.button | Khoá tenant / Mở khoá tenant | Lock tenant / Unlock tenant |
| tenants.lock.title | Khoá tenant {key}? | Lock tenant {key}? |
| tenants.lock.body | Mọi user của {key} ({users} người) bị đăng xuất và không đăng nhập được. | All users of {key} ({users} people) will be signed out and can't sign in. |
| tenants.unlock.title | Mở khoá {key}? | Unlock {key}? |
| tenants.unlock.body | User trở về trạng thái trước khi khoá tenant; user đã bị khoá riêng vẫn bị khoá. | Users return to their state before the tenant was locked; individually locked users stay locked. |
| tenants.toast.locked / unlocked / created | Đã khoá {key} / Đã mở khoá {key} / Đã tạo tenant {key} | Locked {key} / Unlocked {key} / Created tenant {key} |
| tenants.error.keyTaken | Mã công ty đã được dùng | Company code is already in use |
| tenants.error.keyFormat | Chỉ dùng chữ thường không dấu, số, dấu - (2–32 ký tự) | Use lowercase letters, digits and - only (2–32 chars) |
| quota.error.positive | Nhập số lớn hơn 0 hoặc để trống | Enter a number greater than 0 or leave empty |
| quota.error.usdFormat | Tối đa 2 chữ số thập phân | At most 2 decimal places |
| tenants.empty | Chưa có tenant khách hàng nào. Tạo tenant để onboard công ty đầu tiên. | No customer tenants yet. Create one to onboard your first company. |

### Role + nhãn cho e2e
`heading "Tenants"` · `link "+ Tạo tenant"` · `table "Tenants"` · `textbox "Mã công ty"` · `textbox "Tên công ty"` · `spinbutton "Giới hạn slot subscription"` · `textbox "Tên đăng nhập"` · `textbox "Tên hiển thị"` · `textbox "Email"` · `combobox "Ngôn ngữ"` · `button "Tạo tenant"` · `dialog "Đã tạo tenant acme"` · `textbox "Mật khẩu tạm"` (readonly) · `button "Sao chép tất cả"` · `checkbox "Tôi đã lưu mật khẩu tạm"` · `button "Đi tới tenant"` · `tab "Thông tin"`/`"Feature"`/`"Agent"`/`"Quota"`/`"Users"` · `button "Khoá tenant"` · `alertdialog "Khoá tenant acme?"` · `textbox "Gõ acme để xác nhận"` · `button "Mở khoá tenant"` · quota: `spinbutton "Số run · Cả tenant"`.

---

## 5. Users — `/users` + drawer

**Mục đích:** tạo người dùng, reset mật khẩu, khoá khi nghỉ việc, xem vì sao họ thấy/không thấy lệnh. · **Role:** `platform_admin` (chọn tenant), `tenant_admin` (tenant mình). · FR: ADM-FR-04, 05, 06, 63, 36, BR-05, 08, 09, R#9, R#46, R#49, R#53.

### 5.1 Danh sách (mẫu A)
- Header: H1 "Users" · "Người dùng của Công ty ACME. Không có trang tự đăng ký — tạo tài khoản ở đây." · `+ Tạo user`.
- (platform_admin) `combobox "Tenant"`.
- Thanh lọc: tìm ("Tìm theo tên đăng nhập, tên, email…") · chip `Tất cả 120` `Đang hoạt động 118` `Đã khoá 2` · `Select` "Role" (Tất cả role / tenant_admin / member) · `Select` "Group" · chip phụ `Chưa đăng nhập` (`?login=never`).
- Cột: **Tên đăng nhập** (mono) + "(bạn)" · **Tên hiển thị** · **Role** (badge) · **Groups** (chip, tối đa 2 + "+1") · **Đăng nhập gần nhất** ("Hôm qua 17:05" / "Chưa đăng nhập" badge warn) · **Trạng thái** · `⋯`.
- Menu `⋯`: Sửa · Reset mật khẩu · Khoá / Mở khoá · Đăng xuất mọi thiết bị. Hàng "(bạn)": không có Khoá (BR-08).
- Hàng mẫu (acme): `thu.ha (bạn)` Hà Thu · tenant_admin · — · 5 phút trước · Đang hoạt động — `lan.tran` Trần Lan · member · Kế toán, beta-testers · Hôm qua 17:05 — `an` Nguyễn An · member · Kinh doanh — `binh.vo` Võ Bình · member · Kế toán · Chưa đăng nhập — `cuong.le` Lê Cường · member · Kinh doanh · Đã khoá.
- > 200 dòng hiển thị → virtualize; tìm phía server `?q` khi ≥ 500 (R#45).

### 5.2 Drawer tạo/sửa (mẫu C, 2 tab khi sửa; chỉ form khi tạo)
Tiêu đề: "Tạo user" / "lan.tran · Trần Lan". Tab: **Thông tin** · **Quyền hiệu lực**.

Tab Thông tin:
- `Tên đăng nhập` (`^[a-z0-9._-]{2,32}$`, duy nhất trong tenant; khi sửa: readOnly — Đề xuất, BA không nói đổi username; mặc định không cho đổi).
- `Tên hiển thị` (bắt buộc — Đề xuất, tối đa 64).
- `Email` (bắt buộc khi role = tenant_admin, R#9; không bắt buộc với member).
- `Role` (`RadioGroup`): member · tenant_admin. Tenant `platform`: chỉ `platform_admin` (không chọn được). Hàng của mình: disabled + gợi ý "Bạn không thể tự hạ role của mình." Hạ tenant_admin cuối cùng → lỗi "Tenant phải còn ít nhất một tenant_admin đang hoạt động" (BR-08, R#49).
- `Groups` (multi `RefPicker`).
- `Ngôn ngữ` (Tiếng Việt / English).
- Khi tạo: dòng thông tin "Mật khẩu tạm được sinh tự động và chỉ hiện một lần. Người dùng phải đổi mật khẩu ở lần đăng nhập đầu." (FR-06).
- Chân: `Huỷ` · `Tạo user` / `Lưu`.

Sau khi tạo / reset mật khẩu → trong drawer thay form bằng **khối mật khẩu tạm** (giống §4.2): Mã công ty `acme` · Tên đăng nhập `lan.tran` · Mật khẩu tạm (mono) · `Sao chép tất cả` · cảnh báo "Sau khi đóng, bạn không xem lại được mật khẩu này." · nút `Đóng`. Đóng mà chưa sao chép → hỏi "Đóng mà chưa sao chép mật khẩu tạm?" [Quay lại] [Đóng].

Tab **Quyền hiệu lực** (AccessExplainer của user, chỉ đọc; dùng lại component từ artboard Phân quyền):
- Ba nhóm: Feature · Command · Agent.
- Dòng mẫu: `Kế toán` — "qua group Kế toán" · `/kiemtra-hoadon` — "qua feature Kế toán · group Kế toán" · `/dich` — "qua feature core (mặc định cho mọi người)" · `Báo cáo` (Beta) — "qua group beta-testers".
- Agent (M1–M4): "Chưa khả dụng" (R#34).
- Link "Mở Kiểm tra quyền" → `/access?tab=check&user=lan.tran`.

### 5.3 Hành động
- Reset mật khẩu → ConfirmDialog **vừa**: "Reset mật khẩu của lan.tran? Mật khẩu cũ hết hiệu lực, người dùng phải đổi mật khẩu ở lần đăng nhập tới." → hiện khối mật khẩu tạm. (**Đề xuất:** reset cũng thu hồi refresh token — đăng xuất mọi thiết bị; cần backend-lead xác nhận.)
- Khoá → ConfirmDialog **vừa**: "Khoá cuong.le? Người này bị đăng xuất khỏi mọi thiết bị trong tối đa 15 phút." → toast "Đã khoá cuong.le".
- Mở khoá → toast "Đã mở khoá cuong.le" (không cần xác nhận — mức nhẹ, Đề xuất).
- Đăng xuất mọi thiết bị → ConfirmDialog **vừa**: "Đăng xuất lan.tran khỏi mọi thiết bị? Phiên hiện tại hết hạn trong tối đa 15 phút." → toast "Đã đăng xuất lan.tran khỏi mọi thiết bị".
- User bị khoá do khoá tenant: badge `Đã khoá` + tooltip "Khoá theo tenant initech" (R#21 `locked_by_tenant`).

### Câu chữ
| Key | VI | EN |
|---|---|---|
| users.list.title | Users | Users |
| users.list.subtitle | Người dùng của {tenant}. Không có trang tự đăng ký — tạo tài khoản ở đây. | Users of {tenant}. There's no self sign-up — create accounts here. |
| users.list.create | + Tạo user | + New user |
| users.list.search | Tìm theo tên đăng nhập, tên, email… | Search by username, name, email… |
| users.col.username / displayName / role / groups / lastLogin / status | Tên đăng nhập / Tên hiển thị / Role / Groups / Đăng nhập gần nhất / Trạng thái | Username / Display name / Role / Groups / Last sign-in / Status |
| users.filter.role / group / neverLoggedIn | Role / Group / Chưa đăng nhập | Role / Group / Never signed in |
| users.status.active / locked | Đang hoạt động / Đã khoá | Active / Locked |
| users.lockedByTenant | Khoá theo tenant {tenant} | Locked with tenant {tenant} |
| users.neverLoggedIn | Chưa đăng nhập | Never signed in |
| users.menu.edit / resetPassword / lock / unlock / logoutAll | Sửa / Reset mật khẩu / Khoá / Mở khoá / Đăng xuất mọi thiết bị | Edit / Reset password / Lock / Unlock / Sign out everywhere |
| users.drawer.createTitle | Tạo user | New user |
| users.tab.info / access | Thông tin / Quyền hiệu lực | Details / Effective access |
| users.field.role / groups | Role / Groups | Role / Groups |
| users.field.selfRole | Bạn không thể tự hạ role của mình. | You can't lower your own role. |
| users.create.passwordNote | Mật khẩu tạm được sinh tự động và chỉ hiện một lần. Người dùng phải đổi mật khẩu ở lần đăng nhập đầu. | A temporary password is generated and shown only once. The user must change it at first sign-in. |
| users.create.submit | Tạo user | Create user |
| tempPassword.closeWarning | Sau khi đóng, bạn không xem lại được mật khẩu này. | Once closed, you can't view this password again. |
| tempPassword.closeUncopied.title | Đóng mà chưa sao chép mật khẩu tạm? | Close without copying the temporary password? |
| tempPassword.closeUncopied.back | Quay lại | Go back |
| users.access.via | qua {path} | via {path} |
| users.access.core | qua feature core (mặc định cho mọi người) | via core feature (default for everyone) |
| users.access.agentsUnavailable | Chưa khả dụng | Not available yet |
| users.access.openCheck | Mở Kiểm tra quyền | Open access check |
| users.access.empty | Người dùng này chỉ dùng được các command của feature core. | This user can only use core commands. |
| users.reset.title | Reset mật khẩu của {username}? | Reset password for {username}? |
| users.reset.body | Mật khẩu cũ hết hiệu lực, người dùng phải đổi mật khẩu ở lần đăng nhập tới. | The old password stops working; the user must change it at next sign-in. |
| users.reset.submit | Reset mật khẩu | Reset password |
| users.lock.title | Khoá {username}? | Lock {username}? |
| users.lock.body | Người này bị đăng xuất khỏi mọi thiết bị trong tối đa 15 phút. | They'll be signed out of every device within 15 minutes. |
| users.lock.submit | Khoá | Lock |
| users.logoutAll.title | Đăng xuất {username} khỏi mọi thiết bị? | Sign {username} out everywhere? |
| users.logoutAll.body | Phiên hiện tại hết hạn trong tối đa 15 phút. | Current sessions expire within 15 minutes. |
| users.toast.created / saved / locked / unlocked / loggedOut | Đã tạo {username} / Đã lưu {username} / Đã khoá {username} / Đã mở khoá {username} / Đã đăng xuất {username} khỏi mọi thiết bị | Created {username} / Saved {username} / Locked {username} / Unlocked {username} / Signed {username} out everywhere |
| users.error.usernameFormat | Chỉ dùng chữ thường không dấu, số và . _ - (2–32 ký tự) | Use lowercase letters, digits and . _ - only (2–32 chars) |
| users.error.usernameTaken | Tên đăng nhập đã được dùng trong tenant này | Username is already used in this tenant |
| users.error.emailRequired | Tenant admin cần có email để nhận cảnh báo quota | Tenant admins need an email to receive quota alerts |
| users.error.emailFormat | Email không hợp lệ | Invalid email |
| users.error.emailTaken | Email đã được dùng trong tenant này | Email is already used in this tenant |
| users.error.lastAdmin | Tenant phải còn ít nhất một tenant_admin đang hoạt động | The tenant must keep at least one active tenant admin |
| users.error.displayNameRequired | Nhập tên hiển thị | Enter a display name |
| users.empty | Chưa có người dùng nào ngoài bạn. Tạo user để mời đồng nghiệp dùng Chat App. | No users besides you. Create users to invite colleagues to Chat App. |

### Role + nhãn cho e2e
`heading "Users"` · `button "+ Tạo user"` (mở drawer → button) · `combobox "Tenant"` (platform) · `searchbox "Tìm theo tên đăng nhập, tên, email…"` · `combobox "Role"` · `combobox "Group"` · `table "Users"` · `row` chứa "thu.ha (bạn)" · `button "Thao tác khác"` → `menuitem "Reset mật khẩu"` / `"Khoá"` / `"Mở khoá"` / `"Đăng xuất mọi thiết bị"` · `dialog "Tạo user"` (Sheet có role dialog) · `textbox "Tên đăng nhập"` · `textbox "Tên hiển thị"` · `textbox "Email"` · `radio "member"` / `"tenant_admin"` · `combobox "Groups"` · `button "Tạo user"` · `textbox "Mật khẩu tạm"` · `button "Sao chép tất cả"` · `button "Đóng"` · `tab "Quyền hiệu lực"` · `alertdialog "Khoá cuong.le?"` · `button "Khoá"`.

### Luật hiển thị
- `tenant_admin`: role chọn được member/tenant_admin; không thấy ô Tenant.
- `platform_admin` ở tenant `platform`: role cố định `platform_admin`; luôn còn ≥ 1 platform_admin active (BR-08) — lỗi "Hệ thống phải còn ít nhất một platform_admin đang hoạt động" / "The system must keep at least one active platform admin".

---

## 6. Secrets — `/secrets` + drawer

**Mục đích:** lưu key Dify/API dùng chung, chỉ ghi không đọc lại. · **Role:** chỉ `platform_admin`. · FR: ADM-FR-50, BR-04, 14, R#25, R#28, ui-admin 7.8, F5.

### Bố cục (mẫu A + C)
- Header: H1 "Secrets" · "Key dùng chung cho workflow. Giá trị chỉ ghi, không xem lại được." · `+ Thêm secret`.
- Chip: `Tất cả 4` `Đang dùng 3` `Chưa dùng 1`.
- Cột: **Tên** (mono) · **Giá trị** (`•••• 7f3a`, mono) · **Ghi chú** · **Đang được dùng bởi** (link workflow, vd "translate") · **Cập nhật** ("12/09/2026 · minh.pham") · `⋯` (Thay giá trị · Sửa ghi chú · Xoá).
- Hàng mẫu: `DIFY_TRANSLATE_KEY` •••• 7f3a · "App Translate trên Dify prod" · translate — `DIFY_INVOICE_KEY` •••• 91c2 · invoice-check — `DIFY_SUMMARIZE_KEY` •••• 0b5e · summarize — `DIFY_OLD_KEY` •••• 44aa · "Key cũ, chờ xoá" · badge `off` "Chưa dùng".
- Không có hành động xem/copy giá trị ở bất cứ đâu.

### Drawer "Thêm secret"
`Tên` (mono, tự chuyển HOA, dấu cách/`-` → `_`; `^[A-Z0-9_]{2,64}$`) · `Giá trị` (SecretField: password + nút hiện/ẩn chỉ khi đang gõ) · `Ghi chú` (Đề xuất tối đa 200) · `Huỷ` · `Lưu`.

### Drawer "Thay giá trị" (tiêu đề `DIFY_TRANSLATE_KEY`)
- Dòng chỉ đọc: "Giá trị hiện tại: •••• 7f3a · cập nhật 12/09/2026 bởi minh.pham".
- `Giá trị mới` (password, trống, không tự điền) + nút `Hiện`/`Ẩn` (aria "Hiện giá trị đang gõ").
- DependencyList "Đang được dùng bởi: translate (2 command, 1 agent)".
- `Huỷ` · `Lưu giá trị mới`.
- Thành công → toast "Đã thay giá trị DIFY_TRANSLATE_KEY · •••• a91d" + nút `[Xem các workflow dùng secret này]` (M1–M4: Kiểm tra kết nối bị ẩn, R#35 → nút mở `/workflows?secret=DIFY_TRANSLATE_KEY`).
- Xoá: đang dùng → dialog chặn "Không xoá được DIFY_TRANSLATE_KEY: đang được dùng bởi" + DependencyList; không dùng → ConfirmDialog nặng gõ lại tên → toast "Đã xoá DIFY_OLD_KEY".

### Câu chữ
| Key | VI | EN |
|---|---|---|
| secrets.list.title | Secrets | Secrets |
| secrets.list.subtitle | Key dùng chung cho workflow. Giá trị chỉ ghi, không xem lại được. | Shared keys for workflows. Values are write-only and can't be viewed again. |
| secrets.list.create | + Thêm secret | + Add secret |
| secrets.col.name / value / note / usedBy / updated | Tên / Giá trị / Ghi chú / Đang được dùng bởi / Cập nhật | Name / Value / Note / Used by / Updated |
| secrets.filter.used / unused | Đang dùng / Chưa dùng | In use / Unused |
| secrets.menu.replace / editNote / delete | Thay giá trị / Sửa ghi chú / Xoá | Replace value / Edit note / Delete |
| secrets.field.name / value / note / newValue | Tên / Giá trị / Ghi chú / Giá trị mới | Name / Value / Note / New value |
| secrets.field.show / hide | Hiện giá trị đang gõ / Ẩn giá trị | Show typed value / Hide value |
| secrets.replace.current | Giá trị hiện tại: •••• {last4} · cập nhật {date} bởi {user} | Current value: •••• {last4} · updated {date} by {user} |
| secrets.replace.submit | Lưu giá trị mới | Save new value |
| secrets.toast.replaced | Đã thay giá trị {name} · •••• {last4} | Replaced {name} · •••• {last4} |
| secrets.toast.viewWorkflows | Xem các workflow dùng secret này | View workflows using this secret |
| secrets.toast.created / deleted | Đã thêm {name} / Đã xoá {name} | Added {name} / Deleted {name} |
| secrets.delete.blocked | Không xoá được {name}: đang được dùng bởi | Can't delete {name}: used by |
| secrets.error.nameFormat | Chỉ dùng chữ HOA, số và _ (2–64 ký tự) | Use uppercase letters, digits and _ only (2–64 chars) |
| secrets.error.nameTaken | Tên secret đã tồn tại | A secret with this name already exists |
| secrets.error.valueRequired | Nhập giá trị secret | Enter the secret value |
| secrets.empty | Chưa có secret nào. Secret lưu app key Dify để workflow gọi được. | No secrets yet. Secrets store Dify app keys so workflows can call them. |

### Role + nhãn cho e2e
`heading "Secrets"` · `button "+ Thêm secret"` · `table "Secrets"` · `menuitem "Thay giá trị"` · `dialog "DIFY_TRANSLATE_KEY"` · `textbox "Giá trị mới"` (input type=password vẫn có role textbox qua label; QC dùng `getByLabel("Giá trị mới")`) · `button "Hiện giá trị đang gõ"` · `button "Lưu giá trị mới"` · `textbox "Tên"` · `textbox "Giá trị"` → `getByLabel` · `button "Xem các workflow dùng secret này"`. **Kiểm thêm:** trang không chứa chuỗi giá trị thật ở bất kỳ đâu (AC-A06).

---

## 7. Nhật ký thay đổi — `/audit`, `/audit/:id`

**Mục đích:** biết ai đổi gì, khi nào, và khôi phục khi sai. · **Role:** `platform_admin` (mọi tenant, lọc theo tenant, được khôi phục), `tenant_admin` (chỉ tenant mình, **chỉ đọc** — ba-admin §8 "tenant_admin chỉ đọc audit"). · FR: ADM-FR-51, 52, R#36, ui-admin 7.10.

### 7.1 Timeline `/audit`
- Header: H1 "Nhật ký thay đổi" · "Mọi thay đổi cấu hình, người dùng, group, quyền và quota."
- (platform) `combobox "Tenant"` (thêm mục "Toàn hệ thống" cho thực thể `tenant_id=null` — R#36).
- Thanh lọc: `Select` "Loại" (Command, Workflow, Feature, Secret, Tenant, User, Group, Grant, Quota) · `Select` "Hành động" (Tạo · Sửa · Xoá · Khoá · Mở khoá · Cấp · Thu hồi · Khôi phục · Import — R#36) · `combobox "Người thực hiện"` · `DateRangePicker` "Thời gian" (mặc định 30 ngày) · tìm "Tìm theo tên thực thể…".
- Danh sách nhóm theo ngày ("Hôm nay", "Hôm qua", "28/09/2026"). Mỗi dòng: giờ (mono) · avatar chữ + actor · câu mô tả · badge loại · chip version (`v43`) · nút `Xem thay đổi`.
- Dòng mẫu:
  - `10:42` **minh.pham** đã sửa command `/dich` · `v43`
  - `10:15` **thu.ha** đã cấp Kế toán cho group Kế toán (acme) · `v42`
  - `09:58` **minh.pham** đã thay giá trị secret `DIFY_TRANSLATE_KEY` · `v41`
  - `Hôm qua 17:20` **thu.ha** đã khoá user `cuong.le` (acme)
  - `Hôm qua 16:02` **minh.pham** đã import `config-v39.yaml` (Thêm 3 · Sửa 2)
- Phân trang "Tải thêm" (limit 50).

### 7.2 Chi tiết `/audit/:id` (trang, hoặc `Sheet` khi mở từ timeline — Đề xuất: Sheet 640px, URL vẫn đổi thành `/audit/:id` để chia sẻ)
- Header: "minh.pham đã sửa command /dich" · "30/09/2026 10:42 · v43 · Toàn hệ thống".
- DiffViewer theo trường: bảng 3 cột **Trường · Trước · Sau**; trường đổi được tô (`Trước` gạch nền đỏ nhạt, `Sau` nền xanh nhạt, kèm chữ "đã đổi" để không chỉ dựa vào màu). Trường không đổi thu gọn: "12 trường không đổi · Hiện". jsonb (args, input_map) diff theo phần tử: `args[1].default: "en" → "vi"`.
- Secret: chỉ dòng "Giá trị: đã thay đổi" (không có cột trước/sau).
- Tạo: chỉ cột Sau. Xoá: chỉ cột Trước.
- Nút `Khôi phục bản trước` (platform_admin; hành động update/delete; không có với secret, lock/unlock, grant/revoke — Đề xuất: grant/revoke đảo lại bằng thao tác cấp/thu hồi, không qua restore).
- Khôi phục → ConfirmDialog **vừa**: "Khôi phục /dich về trạng thái trước v43?" · "Tạo phiên bản mới v44 với nội dung trước thay đổi này. Lịch sử cũ được giữ nguyên." → toast "Đã khôi phục /dich · v44". Lỗi trùng tên (409 `NAME_TAKEN`): "Không khôi phục được: /dich đã được dùng bởi command khác".

### Câu chữ
| Key | VI | EN |
|---|---|---|
| audit.title | Nhật ký thay đổi | Audit log |
| audit.subtitle | Mọi thay đổi cấu hình, người dùng, group, quyền và quota. | Every change to configuration, users, groups, access and quota. |
| audit.filter.entity / action / actor / period / search | Loại / Hành động / Người thực hiện / Thời gian / Tìm theo tên thực thể… | Type / Action / Actor / Period / Search by entity name… |
| audit.scope.system | Toàn hệ thống | System-wide |
| audit.action.create / update / delete / lock / unlock / grant / revoke / restore / import | Tạo / Sửa / Xoá / Khoá / Mở khoá / Cấp / Thu hồi / Khôi phục / Import | Create / Update / Delete / Lock / Unlock / Grant / Revoke / Restore / Import |
| audit.sentence.update | {actor} đã sửa {entityType} {name} | {actor} updated {entityType} {name} |
| audit.sentence.create | {actor} đã tạo {entityType} {name} | {actor} created {entityType} {name} |
| audit.sentence.delete | {actor} đã xoá {entityType} {name} | {actor} deleted {entityType} {name} |
| audit.sentence.grant | {actor} đã cấp {feature} cho {subject} | {actor} granted {feature} to {subject} |
| audit.sentence.revoke | {actor} đã thu hồi {feature} của {subject} | {actor} revoked {feature} from {subject} |
| audit.sentence.lock / unlock | {actor} đã khoá / mở khoá {entityType} {name} | {actor} locked / unlocked {entityType} {name} |
| audit.sentence.secret | {actor} đã thay giá trị secret {name} | {actor} replaced the value of secret {name} |
| audit.sentence.import | {actor} đã import {file} (Thêm {a} · Sửa {u}) | {actor} imported {file} ({a} added · {u} updated) |
| audit.sentence.restore | {actor} đã khôi phục {name} về trước v{n} | {actor} restored {name} to before v{n} |
| audit.today / yesterday | Hôm nay / Hôm qua | Today / Yesterday |
| audit.viewChanges | Xem thay đổi | View changes |
| audit.loadMore | Tải thêm | Load more |
| audit.diff.field / before / after | Trường / Trước / Sau | Field / Before / After |
| audit.diff.changed | đã đổi | changed |
| audit.diff.unchanged | {n} trường không đổi · Hiện | {n} unchanged fields · Show |
| audit.diff.secret | Giá trị: đã thay đổi | Value: changed |
| audit.restore.button | Khôi phục bản trước | Restore previous version |
| audit.restore.title | Khôi phục {name} về trạng thái trước v{n}? | Restore {name} to before v{n}? |
| audit.restore.body | Tạo phiên bản mới v{next} với nội dung trước thay đổi này. Lịch sử cũ được giữ nguyên. | Creates a new version v{next} with the content before this change. History is kept. |
| audit.restore.submit | Khôi phục | Restore |
| audit.toast.restored | Đã khôi phục {name} · v{n} | Restored {name} · v{n} |
| audit.error.nameTaken | Không khôi phục được: {name} đã được dùng bởi {entityType} khác | Can't restore: {name} is already used by another {entityType} |
| audit.empty | Chưa có thay đổi nào. Mọi thao tác lưu, cấp quyền, khoá sẽ hiện ở đây. | No changes yet. Saves, grants and locks will appear here. |

### Role + nhãn cho e2e
`heading "Nhật ký thay đổi"` · `combobox "Tenant"` · `combobox "Loại"` · `combobox "Hành động"` · `combobox "Người thực hiện"` · `button "Thời gian"` · `list "Nhật ký thay đổi"` → `listitem` chứa "minh.pham đã sửa command /dich" · `button "Xem thay đổi"` · `table "Thay đổi"` (DiffViewer) · `button "Khôi phục bản trước"` (không có với tenant_admin) · `alertdialog "Khôi phục /dich về trạng thái trước v43?"` · `button "Khôi phục"` · `button "Tải thêm"`.

---

## 8. Import / Export — `/transfer`

**Mục đích:** chuyển cấu hình giữa môi trường bằng file yaml, xem trước khác biệt trước khi áp dụng. · **Role:** chỉ `platform_admin`. · FR: ADM-FR-54, R#37, ui-admin 7.11. Mốc M4.

### Bố cục (1 trang, `Tabs`: **Export** · **Import**)
**Tab Export**
- Card "Chọn nội dung": checkbox `Workflows (5)` `Commands (5)` `Features (5)` `Tenants (4)` `Groups (9)` `Grants (21)` + "Chọn tất cả". Ghi chú: "Secret chỉ xuất tên, không xuất giá trị. Cấu hình agent xuất ở Agent Studio."
- Nút `Tải file config-v43.yaml` (tên theo config hiện tại). Toast "Đã tải config-v43.yaml".

**Tab Import** (3 bước, `Stepper` đơn giản bằng danh sách có số)
1. **Chọn file** — vùng kéo-thả "Kéo file .yaml vào đây hoặc Chọn file" (chỉ `.yaml/.yml`, Đề xuất ≤ 1 MB).
2. **Xem trước** — sau khi parse + validate (`POST /admin/import?dry_run=1`):
   - Lỗi file → `Alert` err "File không hợp lệ" + danh sách lỗi có đường dẫn: `commands[2].workflow: workflow "translat" không tồn tại`.
   - Hợp lệ → 3 nhóm chip đếm: `Thêm 3` `Sửa 2` `Không đổi 10`; `Accordion` theo loại; bấm mục → DiffViewer (dùng lại §7.2).
   - Mục "Cần tạo secret" (nếu có): mỗi dòng `DIFY_REPORT_KEY` + `Input` password "Giá trị" — chưa nhập đủ thì nút Áp dụng khoá, tooltip "Nhập giá trị cho 1 secret còn thiếu".
   - Ghi chú cố định: "Import không xoá thực thể không có trong file."
3. **Áp dụng** — `Áp dụng 5 thay đổi` → ConfirmDialog **vừa**: "Áp dụng 5 thay đổi từ config-v39.yaml? Người dùng thấy thay đổi sau vài giây." → toast "Đã import · Thêm 3 · Sửa 2 · v44". Nút phụ `Chọn file khác`.

### Câu chữ
| Key | VI | EN |
|---|---|---|
| transfer.title | Import / Export | Import / Export |
| transfer.subtitle | Chuyển cấu hình giữa các môi trường bằng file yaml. | Move configuration between environments with a yaml file. |
| transfer.tab.export / import | Export / Import | Export / Import |
| transfer.export.pick | Chọn nội dung | Choose content |
| transfer.export.selectAll | Chọn tất cả | Select all |
| transfer.export.type.workflows / commands / features / tenants / groups / grants | Workflows / Commands / Features / Tenants / Groups / Grants | Workflows / Commands / Features / Tenants / Groups / Grants |
| transfer.export.note | Secret chỉ xuất tên, không xuất giá trị. Cấu hình agent xuất ở Agent Studio. | Secrets are exported by name only, never values. Agent config is exported in Agent Studio. |
| transfer.export.download | Tải file {file} | Download {file} |
| transfer.export.none | Chọn ít nhất một loại để xuất | Select at least one type to export |
| transfer.toast.downloaded | Đã tải {file} | Downloaded {file} |
| transfer.import.drop | Kéo file .yaml vào đây hoặc | Drag a .yaml file here or |
| transfer.import.choose | Chọn file | Choose file |
| transfer.import.step1 / step2 / step3 | Chọn file / Xem trước / Áp dụng | Choose file / Preview / Apply |
| transfer.import.invalid | File không hợp lệ | Invalid file |
| transfer.import.wrongType | Chỉ nhận file .yaml hoặc .yml | Only .yaml or .yml files are accepted |
| transfer.import.tooLarge | File lớn hơn 1 MB | File is larger than 1 MB |
| transfer.import.added / updated / unchanged | Thêm {n} / Sửa {n} / Không đổi {n} | Add {n} / Update {n} / Unchanged {n} |
| transfer.import.noDelete | Import không xoá thực thể không có trong file. | Import never deletes entities missing from the file. |
| transfer.import.secretsNeeded | Cần tạo secret | Secrets to create |
| transfer.import.secretsMissing | Nhập giá trị cho {n} secret còn thiếu | Enter values for {n} missing secrets |
| transfer.import.apply | Áp dụng {n} thay đổi | Apply {n} changes |
| transfer.import.nothing | File không có thay đổi nào so với cấu hình hiện tại. | The file has no changes compared to the current configuration. |
| transfer.import.confirm.title | Áp dụng {n} thay đổi từ {file}? | Apply {n} changes from {file}? |
| transfer.import.confirm.body | Người dùng thấy thay đổi sau vài giây. | Users will see the changes within seconds. |
| transfer.import.another | Chọn file khác | Choose another file |
| transfer.toast.imported | Đã import · Thêm {a} · Sửa {u} · v{n} | Imported · {a} added · {u} updated · v{n} |

### Role + nhãn cho e2e
`heading "Import / Export"` · `tab "Export"` / `"Import"` · `checkbox "Workflows"` … `checkbox "Grants"` · `checkbox "Chọn tất cả"` · `button "Tải file config-v43.yaml"` · `button "Chọn file"` (input file ẩn có label "Chọn file" — QC dùng `setInputFiles` trên `getByLabel("Chọn file")`) · `alert` "File không hợp lệ" · `button "Thêm 3"` (chip lọc) · `region "Cần tạo secret"` · `getByLabel("Giá trị DIFY_REPORT_KEY")` · `button "Áp dụng 5 thay đổi"` · `alertdialog` · `button "Xác nhận"`.

---

## 9. Đổi mật khẩu — `/change-password`

**Mục đích:** bắt buộc đặt mật khẩu riêng ở lần đầu/sau reset; tự đổi khi muốn. · **Role:** mọi role (kể cả `member`, ui-admin §2). · FR: ADM-FR-06, R#23, validation ui-admin §9.

### 9.1 Chế độ bắt buộc (mẫu D, ngoài khung)
Vào từ đăng nhập khi server trả `password_change_required` + `change_token` (5 phút). Không có nút bỏ qua, không có sidebar.
- Logo ngang · H1 "Đặt mật khẩu mới" · mô tả "Đây là lần đăng nhập đầu tiên hoặc mật khẩu vừa được đặt lại. Hãy đặt mật khẩu của riêng bạn để tiếp tục."
- Dòng phụ (mono nhỏ): `acme · lan.tran`.
- `Mật khẩu mới` (password + nút Hiện/Ẩn) · thanh độ mạnh 3 nấc `Yếu` / `Trung bình` / `Mạnh` (Đề xuất: tính cục bộ theo độ dài + số loại ký tự, không thêm thư viện; chỉ gợi ý, không chặn trừ luật ≥ 10) · gợi ý "Tối thiểu 10 ký tự. Nên dùng một câu dài dễ nhớ."
- `Nhập lại mật khẩu mới`.
- Nút `Đặt mật khẩu và tiếp tục` (loading + khoá khi gửi).
- Link nhỏ `Đăng xuất`.
- Thành công: admin → `/` + toast "Đã đổi mật khẩu"; member → màn "Tài khoản của bạn dùng Chat App" (đã có trong artboard Đăng nhập).
- `change_token` hết hạn → `Alert` "Phiên đổi mật khẩu đã hết hạn. Hãy đăng nhập lại." + nút `Đăng nhập lại`.

### 9.2 Chế độ tự đổi (trong khung, từ menu avatar)
- Trang hẹp (card 480px trong vùng nội dung). H1 "Đổi mật khẩu" · "Các thiết bị khác sẽ bị đăng xuất sau khi đổi."
- `Mật khẩu hiện tại` · `Mật khẩu mới` (+ độ mạnh) · `Nhập lại mật khẩu mới` · `Huỷ` · `Đổi mật khẩu`.
- Thành công → toast "Đã đổi mật khẩu · các thiết bị khác đã được đăng xuất" (R#23 thu hồi refresh token khác) → quay lại trang trước.
- `member` không vào được khung Admin → Đề xuất: member dùng chế độ tự đổi dạng mẫu D (ngoài khung) cùng route.

### Câu chữ
| Key | VI | EN |
|---|---|---|
| password.forced.title | Đặt mật khẩu mới | Set a new password |
| password.forced.body | Đây là lần đăng nhập đầu tiên hoặc mật khẩu vừa được đặt lại. Hãy đặt mật khẩu của riêng bạn để tiếp tục. | This is your first sign-in or your password was just reset. Set your own password to continue. |
| password.forced.submit | Đặt mật khẩu và tiếp tục | Set password and continue |
| password.self.title | Đổi mật khẩu | Change password |
| password.self.body | Các thiết bị khác sẽ bị đăng xuất sau khi đổi. | Other devices will be signed out after the change. |
| password.self.submit | Đổi mật khẩu | Change password |
| password.field.current / new / confirm | Mật khẩu hiện tại / Mật khẩu mới / Nhập lại mật khẩu mới | Current password / New password / Confirm new password |
| password.field.show / hide | Hiện mật khẩu / Ẩn mật khẩu | Show password / Hide password |
| password.hint | Tối thiểu 10 ký tự. Nên dùng một câu dài dễ nhớ. | At least 10 characters. A long, memorable phrase works well. |
| password.strength.label | Độ mạnh: {level} | Strength: {level} |
| password.strength.weak / medium / strong | Yếu / Trung bình / Mạnh | Weak / Medium / Strong |
| password.error.min | Mật khẩu cần tối thiểu 10 ký tự | Password must be at least 10 characters |
| password.error.max | Mật khẩu tối đa 128 ký tự | Password can be at most 128 characters |
| password.error.mismatch | Mật khẩu nhập lại không khớp | Passwords don't match |
| password.error.same | Mật khẩu mới phải khác mật khẩu hiện tại | The new password must differ from the current one |
| password.error.currentWrong | Mật khẩu hiện tại không đúng | Current password is incorrect |
| password.error.tokenExpired | Phiên đổi mật khẩu đã hết hạn. Hãy đăng nhập lại. | Your password-change session expired. Please sign in again. |
| password.relogin | Đăng nhập lại | Sign in again |
| auth.logout | Đăng xuất | Sign out |
| password.toast.changed | Đã đổi mật khẩu | Password changed |
| password.toast.changedOthers | Đã đổi mật khẩu · các thiết bị khác đã được đăng xuất | Password changed · other devices signed out |

### Role + nhãn cho e2e
`heading "Đặt mật khẩu mới"` · `getByLabel("Mật khẩu mới")` · `getByLabel("Nhập lại mật khẩu mới")` · `getByLabel("Mật khẩu hiện tại")` · `button "Hiện mật khẩu"` · `button "Đặt mật khẩu và tiếp tục"` · `button "Đổi mật khẩu"` · `status` "Độ mạnh: Mạnh" (`aria-live="polite"`) · `alert` chứa "Phiên đổi mật khẩu đã hết hạn" · `button "Đăng xuất"` · không có `button "Bỏ qua"`.

---

## 10. 2FA (TOTP) — bật: `/account/2fa` (Đề xuất route); bước đăng nhập: `/login` bước 2

**Mục đích:** admin tự bật xác thực hai bước; đăng nhập đòi mã 6 số khi đã bật. · **Role:** `platform_admin`, `tenant_admin` (FR-08). `member` không thấy. · FR: ADM-FR-08 (dời vào M4, STATE.md). Readiness R#14: màn "Cài đặt đăng nhập" bị loại → 2FA là **tuỳ chọn tự bật** từ menu avatar (ui-admin §4 "Avatar mở menu: đổi mật khẩu, 2FA", 7.1 "Admin đã bật 2FA thì…"). **Đề xuất:** không bắt buộc 2FA ở v1.

### 10.1 Trang "Xác thực hai bước" (trong khung, card 560px)
**Trạng thái Chưa bật:** badge `off` "Chưa bật" · mô tả "Mỗi lần đăng nhập, bạn nhập thêm mã 6 số từ ứng dụng xác thực trên điện thoại." · nút `Bật xác thực hai bước`.

**Luồng bật** (các bước trong cùng card, có "Bước 1/3"):
0. (Đề xuất) `Mật khẩu hiện tại` → `Tiếp tục` — xác thực lại trước thao tác bảo mật.
1. **Quét mã QR** — ảnh QR 200×200 (`img` alt "Mã QR để thêm tài khoản vào ứng dụng xác thực") · dưới: "Không quét được? Nhập khoá thủ công:" + khoá mono nhóm 4 `JBSW Y3DP EHPK 3PXP` + `Sao chép` · tên tài khoản hiển thị trong app: `AI System (acme · thu.ha)` · nút `Tiếp tục`.
2. **Nhập mã 6 số** — `InputOTP` 6 ô, tự gửi khi đủ 6 số · nút `Xác nhận và bật`. Sai → "Mã không đúng. Kiểm tra giờ trên điện thoại và thử lại."
3. **Lưu mã dự phòng** (Đề xuất — BA chưa có; mặc định 10 mã, 8 ký tự, dùng một lần) — lưới 2 cột mono `k7p2-9xqm` … · `Tải xuống (.txt)` · `Sao chép` · cảnh báo "Mỗi mã dùng được một lần khi bạn mất điện thoại. Mã chỉ hiện một lần." · checkbox "Tôi đã lưu mã dự phòng ở nơi an toàn" → `Hoàn tất`. Toast "Đã bật xác thực hai bước".

**Trạng thái Đã bật:** badge `ok` "Đã bật" · "Bật từ 30/09/2026 · còn 8 mã dự phòng" · nút `Tạo lại mã dự phòng` (Đề xuất; ConfirmDialog vừa "Mã cũ sẽ hết hiệu lực") · nút `Tắt xác thực hai bước` (ConfirmDialog vừa, yêu cầu `Mật khẩu hiện tại` + `Mã xác thực`; toast "Đã tắt xác thực hai bước").

**Đề xuất (cần BA):** admin mất điện thoại và hết mã dự phòng → `platform_admin`/`tenant_admin` có mục `⋯ › Tắt 2FA` trên user khác trong Users (mức vừa, ghi audit). Mặc định: có, chỉ cho user trong phạm vi quản lý; không tự tắt cho chính mình qua đường này.

### 10.2 Bước nhập mã khi đăng nhập (mẫu D, thay card đăng nhập)
Server trả `totp_required` + `totp_token` (Đề xuất 5 phút, như `change_token`).
- Logo · H1 "Xác thực hai bước" · "Nhập mã 6 số trong ứng dụng xác thực của bạn." · dòng mono `acme · thu.ha`.
- `InputOTP` "Mã xác thực" (autofocus, `autocomplete="one-time-code"`, tự gửi khi đủ 6 số) · nút `Xác nhận` (loading + khoá).
- Link `Dùng mã dự phòng` → thay bằng `Input` "Mã dự phòng" (mono, dạng `xxxx-xxxx`) + link `Dùng mã từ ứng dụng`.
- Link `Quay lại đăng nhập`.
- Lỗi: "Mã không đúng hoặc đã hết hạn" (không nói còn bao nhiêu lần). **Đề xuất:** mã sai tính chung bộ đếm FR-07 (5 lần → khoá tạm 15 phút) → "Tạm khoá đến 14:45". `totp_token` hết hạn → "Phiên xác thực đã hết hạn. Hãy đăng nhập lại."
- Thứ tự bước: mật khẩu → mã 2FA (nếu bật) → đặt mật khẩu mới (nếu `must_change_password`) — Đề xuất.

### Câu chữ
| Key | VI | EN |
|---|---|---|
| twofa.title | Xác thực hai bước | Two-step verification |
| twofa.off / on | Chưa bật / Đã bật | Off / On |
| twofa.intro | Mỗi lần đăng nhập, bạn nhập thêm mã 6 số từ ứng dụng xác thực trên điện thoại. | Each time you sign in, you'll also enter a 6-digit code from an authenticator app on your phone. |
| twofa.enable | Bật xác thực hai bước | Turn on two-step verification |
| twofa.step | Bước {n}/3 | Step {n}/3 |
| twofa.reauth | Nhập mật khẩu để tiếp tục | Enter your password to continue |
| common.continue | Tiếp tục | Continue |
| twofa.scan.title | Quét mã QR bằng ứng dụng xác thực | Scan the QR code with your authenticator app |
| twofa.scan.alt | Mã QR để thêm tài khoản vào ứng dụng xác thực | QR code to add the account to your authenticator app |
| twofa.scan.manual | Không quét được? Nhập khoá thủ công: | Can't scan? Enter this key manually: |
| twofa.verify.title | Nhập mã 6 số đang hiện trong ứng dụng | Enter the 6-digit code shown in the app |
| twofa.verify.submit | Xác nhận và bật | Verify and turn on |
| twofa.verify.wrong | Mã không đúng. Kiểm tra giờ trên điện thoại và thử lại. | Incorrect code. Check your phone's clock and try again. |
| twofa.backup.title | Lưu mã dự phòng | Save your backup codes |
| twofa.backup.warn | Mỗi mã dùng được một lần khi bạn mất điện thoại. Mã chỉ hiện một lần. | Each code works once if you lose your phone. They're shown only once. |
| twofa.backup.download | Tải xuống (.txt) | Download (.txt) |
| twofa.backup.ack | Tôi đã lưu mã dự phòng ở nơi an toàn | I've stored my backup codes somewhere safe |
| twofa.backup.done | Hoàn tất | Done |
| twofa.status.since | Bật từ {date} · còn {n} mã dự phòng | On since {date} · {n} backup codes left |
| twofa.regen | Tạo lại mã dự phòng | Generate new backup codes |
| twofa.regen.body | Mã dự phòng cũ sẽ hết hiệu lực. | Your old backup codes will stop working. |
| twofa.disable | Tắt xác thực hai bước | Turn off two-step verification |
| twofa.disable.title | Tắt xác thực hai bước? | Turn off two-step verification? |
| twofa.disable.body | Đăng nhập sẽ chỉ cần mật khẩu. Nhập mật khẩu và mã hiện tại để xác nhận. | Sign-in will only need your password. Enter your password and current code to confirm. |
| twofa.toast.enabled / disabled / regenerated | Đã bật xác thực hai bước / Đã tắt xác thực hai bước / Đã tạo mã dự phòng mới | Two-step verification is on / Two-step verification is off / New backup codes generated |
| login.totp.title | Xác thực hai bước | Two-step verification |
| login.totp.body | Nhập mã 6 số trong ứng dụng xác thực của bạn. | Enter the 6-digit code from your authenticator app. |
| login.totp.code | Mã xác thực | Verification code |
| login.totp.submit | Xác nhận | Verify |
| login.totp.useBackup | Dùng mã dự phòng | Use a backup code |
| login.totp.backupCode | Mã dự phòng | Backup code |
| login.totp.useApp | Dùng mã từ ứng dụng | Use a code from the app |
| login.totp.back | Quay lại đăng nhập | Back to sign in |
| login.totp.wrong | Mã không đúng hoặc đã hết hạn | The code is incorrect or expired |
| login.totp.expired | Phiên xác thực đã hết hạn. Hãy đăng nhập lại. | Your verification session expired. Please sign in again. |
| login.tempLocked | Tạm khoá đến {time} | Temporarily locked until {time} |
| users.menu.reset2fa | Tắt 2FA | Turn off 2FA |

### Role + nhãn cho e2e
`heading "Xác thực hai bước"` · `button "Bật xác thực hai bước"` · `getByLabel("Mật khẩu hiện tại")` · `button "Tiếp tục"` · `img "Mã QR để thêm tài khoản vào ứng dụng xác thực"` · `button "Sao chép"` · `textbox "Mã xác thực"` (InputOTP render một input thật có label — **frontend giữ 1 `input` duy nhất**, không 6 input riêng) · `button "Xác nhận và bật"` · `list "Mã dự phòng"` · `button "Tải xuống (.txt)"` · `checkbox "Tôi đã lưu mã dự phòng ở nơi an toàn"` · `button "Hoàn tất"` · `button "Tắt xác thực hai bước"` · login: `button "Xác nhận"` · `button "Dùng mã dự phòng"` · `textbox "Mã dự phòng"` · `link "Quay lại đăng nhập"` · `alert` "Mã không đúng hoặc đã hết hạn".

---

## 11. Command palette & menu avatar (bổ sung nhỏ, không cần artboard)
- Menu avatar (`DropdownMenu`, `button "Tài khoản của bạn"`): tên + role · `Đổi mật khẩu` · `Xác thực hai bước` (ẩn với member) · `Ngôn ngữ: Tiếng Việt / English` · `Giao diện: Sáng / Tối / Theo hệ thống` · `Bảng gọn` · `Đăng xuất`. EN: Change password · Two-step verification · Language · Theme: Light / Dark / System · Compact tables · Sign out.

---

## 12. Bộ trạng thái chung (dùng cho mọi màn)

Tất cả nằm trong **vùng nội dung**; sidebar và topbar luôn dùng được (ui-admin §9).

### 12.1 Đang tải
- Skeleton đúng hình: bảng = header thật + 8 hàng skeleton cao 40px; form = nhãn thật + ô skeleton; KPI = card với 2 dòng skeleton. Không spinner che trang.
- > 10 giây: dòng dưới skeleton "Vẫn đang tải…" + `Thử lại`.
- A11y: vùng có `aria-busy="true"`; một `status` ẩn đọc "Đang tải".
| VI | EN |
|---|---|
| Đang tải | Loading |
| Vẫn đang tải… | Still loading… |

### 12.2 Rỗng
- Card giữa vùng bảng: icon lucide 32px màu primary nhạt · câu mô tả thực thể dùng để làm gì (mỗi màn một câu, đã ghi ở từng mục) · nút tạo mới.
- Rỗng do bộ lọc: "Không có kết quả cho '{q}'" / "No results for '{q}'" + `Xoá bộ lọc` / `Clear filters`. Không có từ khoá mà có chip lọc: "Không có mục nào khớp bộ lọc" / "Nothing matches these filters".
- Role của người xem không tạo được (tenant_admin ở Nhật ký): chỉ câu mô tả, không nút.

### 12.3 Lỗi tải
- `Alert` err trong vùng nội dung: tiêu đề "Không tải được dữ liệu" · mô tả "{message} (mã {code})" · `Thử lại`. Mã mẫu: `NETWORK_ERROR`, `500`.
- Lỗi một phần (một card Tổng quan lỗi) → lỗi ngay trong card đó, card khác vẫn hiện.
| VI | EN |
|---|---|
| Không tải được dữ liệu | Couldn't load data |
| {message} (mã {code}) | {message} (code {code}) |

### 12.4 Không có quyền (403) / Không tìm thấy (404)
- 403 (mở URL của mục role không có, vd tenant_admin mở `/secrets`): icon khoá · H1 "Bạn không có quyền xem trang này" · "Trang này chỉ dành cho quản trị nền tảng. Nếu cần, hãy liên hệ người quản trị của bạn." · `Về Tổng quan`.
- 404 (thực thể không tồn tại hoặc thuộc tenant khác — không phân biệt, BR-09): H1 "Không tìm thấy" · "Mục này không tồn tại hoặc đã bị xoá." · `Về danh sách`.
- Hành động bị server từ chối 403 giữa chừng (quyền vừa bị hạ): toast lỗi "Bạn không còn quyền thực hiện thao tác này" + tải lại thông tin phiên.
| VI | EN |
|---|---|
| Bạn không có quyền xem trang này | You don't have access to this page |
| Trang này chỉ dành cho quản trị nền tảng. Nếu cần, hãy liên hệ người quản trị của bạn. | This page is for platform admins only. Contact your administrator if you need access. |
| Về Tổng quan | Back to Overview |
| Không tìm thấy | Not found |
| Mục này không tồn tại hoặc đã bị xoá. | This item doesn't exist or was deleted. |
| Về danh sách | Back to list |
| Bạn không còn quyền thực hiện thao tác này | You no longer have permission to do this |

### 12.5 Xung đột 409 (`VERSION_CONFLICT`, FR-55, AC-A07)
Server trả `{error:{code:"VERSION_CONFLICT"}, current, updated_by, updated_at}` (R#4).
- `AlertDialog` (không đóng bằng click nền): tiêu đề "Có người vừa lưu bản mới hơn" · "thu.ha vừa sửa command này lúc 10:42 (v44). Bản của bạn dựa trên v43." · 3 nút: `Xem khác biệt` · `Ghi đè` · `Tải bản mới`.
- `Xem khác biệt` → mở rộng dialog thành DiffViewer 3 cột **Trường · Bản của bạn · Bản mới nhất (v44)**, chỉ các trường khác nhau.
- `Ghi đè` → ConfirmDialog con "Ghi đè thay đổi của thu.ha?" "Bản v44 sẽ bị thay bằng bản của bạn (thành v45). Lịch sử vẫn giữ v44." · `Ghi đè` → gửi lại với `version` = `current.version`.
- `Tải bản mới` → bỏ thay đổi của bạn, nạp v44, toast "Đã tải bản mới nhất · v44".
| VI | EN |
|---|---|
| Có người vừa lưu bản mới hơn | Someone just saved a newer version |
| {user} vừa sửa {entity} này lúc {time} (v{n}). Bản của bạn dựa trên v{mine}. | {user} edited this {entity} at {time} (v{n}). Your copy is based on v{mine}. |
| Xem khác biệt | View differences |
| Ghi đè | Overwrite |
| Tải bản mới | Load latest |
| Bản của bạn / Bản mới nhất (v{n}) | Your version / Latest (v{n}) |
| Ghi đè thay đổi của {user}? | Overwrite {user}'s changes? |
| Bản v{n} sẽ bị thay bằng bản của bạn (thành v{next}). Lịch sử vẫn giữ v{n}. | v{n} will be replaced by your version (becoming v{next}). History keeps v{n}. |
| Đã tải bản mới nhất · v{n} | Loaded latest · v{n} |

### 12.6 Mất kết nối
- Banner vàng dính trên cùng vùng nội dung (`role="status"`): "Mất kết nối, thay đổi chưa được lưu" · nút Lưu khoá cho tới khi có mạng; tooltip nút "Đang chờ kết nối lại". Có mạng lại → banner xanh 3 giây "Đã kết nối lại" và query tự refetch.
- Phát hiện: `navigator.onLine` + lỗi fetch mạng (TanStack Query `onlineManager`).
| VI | EN |
|---|---|
| Mất kết nối, thay đổi chưa được lưu | Connection lost — changes aren't saved |
| Đang chờ kết nối lại | Waiting for connection |
| Đã kết nối lại | Back online |

### 12.7 Phiên hết hạn (ui-admin 7.1)
- Refresh thất bại → `Dialog` "Phiên đăng nhập đã hết hạn" · "Đăng nhập lại để tiếp tục. Dữ liệu đang nhập được giữ nguyên." · `Mật khẩu` (mã công ty + tên đăng nhập hiện sẵn, chỉ đọc) · `Đăng nhập`. (EN: "Your session expired" · "Sign in again to continue. Your unsaved input is kept." · Sign in.)
- Bỏ thay đổi (UnsavedGuard): "Bỏ thay đổi?" · "Các thay đổi chưa lưu sẽ mất." · `Ở lại` · `Bỏ thay đổi` (EN: Discard changes? · Unsaved changes will be lost. · Stay · Discard).

### Role + nhãn cho e2e (chung)
`status` "Đang tải" · `alert` chứa "Không tải được dữ liệu" + `button "Thử lại"` · `heading "Bạn không có quyền xem trang này"` · `link "Về Tổng quan"` · `heading "Không tìm thấy"` · `alertdialog "Có người vừa lưu bản mới hơn"` + `button "Xem khác biệt"`/`"Ghi đè"`/`"Tải bản mới"` · `status` "Mất kết nối, thay đổi chưa được lưu" · `dialog "Phiên đăng nhập đã hết hạn"` · `alertdialog "Bỏ thay đổi?"` · `button "Bỏ thay đổi"` · `button "Ở lại"` · `button "Xoá bộ lọc"`.

---

## 13. Artboard đề xuất vẽ lên canvas

| # | Artboard | Lý do không dùng mẫu được | Mốc |
|---|---|---|---|
| 1 | Tổng quan (tenant_admin) + banner quota 80%/100% | Bố cục KPI khác bản platform | M4 |
| 2 | Tenants — Tạo tenant + dialog mật khẩu tạm | Form 2 card + dialog hiện-một-lần (dùng lại cho Users) | M1 |
| 3 | Tenant chi tiết — tab Quota | Bảng quota nhập trực tiếp + QuotaBar | M4 (tab Thông tin/Feature dùng mẫu B) |
| 4 | Users — danh sách + drawer (tab Thông tin, khối mật khẩu tạm, tab Quyền hiệu lực) | Drawer 2 tab + trạng thái mật khẩu tạm | M1 |
| 5 | Secrets — drawer Thay giá trị | SecretField, DependencyList | M2 |
| 6 | Nhật ký — timeline + DiffViewer + khôi phục | Timeline theo ngày, diff theo trường | M4 |
| 7 | Import / Export — bước Xem trước | Nhóm Thêm/Sửa/Không đổi + Cần tạo secret | M4 |
| 8 | Đổi mật khẩu (bắt buộc) + bước nhập TOTP khi đăng nhập | Mẫu D, phải khớp artboard Đăng nhập | M1 (đổi MK), M4 (TOTP) |
| 9 | 2FA — 3 bước bật (QR · mã · mã dự phòng) | Luồng nhiều bước | M4 |
| 10 | Bảng trạng thái chung: skeleton bảng, rỗng, rỗng do lọc, lỗi tải, 403, 404, dialog 409 mở rộng diff, banner mất kết nối, phiên hết hạn | Chuẩn dùng lại toàn app | M1 |

Không cần artboard riêng (dùng mẫu A/B + câu chữ ở trên): Commands danh sách, Features danh sách + editor, Tenants danh sách, tab Feature/Agent/Users của Tenant.

## 14. Cần backend-lead (không tự đổi contract)
1. Login/2FA: `POST /auth/login` trả thêm `{status:"totp_required", totp_token}` (5 phút); `POST /auth/totp/verify {totp_token, code | backup_code}`; `POST /auth/totp/setup` → `{otpauth_url, secret}`; `POST /auth/totp/enable {code}` → `{backup_codes[]}`; `POST /auth/totp/disable {password, code}`; `POST /auth/totp/backup-codes` (tạo lại); `GET /auth/me` có `totp_enabled`, `backup_codes_left`. QR sinh phía client từ `otpauth_url` hay server trả data URL — Đề xuất server trả `otpauth_url`, client vẽ QR (cần 1 thư viện nhỏ → ADR khi tới M4).
2. Users: list trả `last_login_at`, `locked_by_tenant`, `groups[]`; filter `?role&status&group&login=never`; `POST /admin/users/:id/reset-password` trả `{temp_password}` một lần; xác nhận reset có thu hồi refresh token không; `POST /admin/users/:id/totp/disable` nếu duyệt Đề xuất §10.1.
3. Tenants: `POST /admin/tenants` nhận `{key,name,max_concurrent_sub, first_admin:{username,display_name,email,locale}}` trả `{tenant, first_admin, temp_password}`; list trả `user_count`, quota chính đã dùng; lỗi khoá tenant `platform` (mã đề xuất `PLATFORM_TENANT_LOCKED`).
4. Features: list trả `command_count`, `tenant_count`; entitlement list trả `active_user_count` (cho câu "8 người đang dùng"); lỗi xoá `FEATURE_HAS_EXCLUSIVE_COMMANDS {commands[]}`.
5. Secrets: list trả `used_by[]` (workflow key) và `updated_by`; `DELETE` trả 409 `SECRET_IN_USE {used_by[]}`.
6. Audit: list trả câu mô tả đủ dữ liệu (`entity_name`, `actor_username`, `config_version`); filter `?entity&action&actor&from&to&tenant_id`; `restore` trả 409 `NAME_TAKEN`.
7. Import: `dry_run` trả `{added[],updated[],unchanged_count, missing_secrets[], errors[{path,message}]}`; áp dụng nhận `secrets:{NAME:value}` cho mục Cần tạo secret.
8. Tổng quan tenant: một endpoint gộp (Đề xuất `GET /admin/overview`) trả KPI + 5 user chưa đăng nhập + 8 audit gần nhất để tránh 4 request.
9. Mọi lỗi 403 giữa phiên có mã `FORBIDDEN`; 409 theo R#4.

## 15. Câu hỏi (kèm mặc định đề xuất)
1. Có "Xoá tenant" không? → Mặc định **không** ở v1, chỉ Khoá (tránh mất dữ liệu).
2. Mã công ty và tên đăng nhập có đổi được sau khi tạo? → Mặc định **không** (định danh đăng nhập).
3. 2FA bắt buộc hay tuỳ chọn? → Mặc định **tuỳ chọn tự bật**; mã dự phòng 10 mã × 8 ký tự; mã TOTP sai tính chung bộ đếm khoá tạm.
4. Admin tắt 2FA hộ user mất điện thoại? → Mặc định **có**, `⋯ › Tắt 2FA` mức vừa, ghi audit.
5. Reset mật khẩu có đăng xuất mọi thiết bị? → Mặc định **có**.
6. tenant_admin có được Khôi phục trong Nhật ký? → Mặc định **không** (BA §8 chỉ đọc).
