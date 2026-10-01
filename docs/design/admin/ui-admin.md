# Admin Page — Đặc tả UI/UX

Thiết kế chi tiết giao diện quản trị: bố cục, thành phần, từng màn hình, luồng thao tác, trạng thái và câu chữ

`v0.4 · draft` · `2026-10-01` · `shadcn/ui · song ngữ VI/EN` · `Dựa trên BA Admin (ADM-*)`

> ⚠️ **v0.4:** hệ thống thành **multi-tenant**. Admin UI thêm Features, Tenants, Groups, Phân quyền, Chi phí & quota, và có 3 role (`platform_admin`, `tenant_admin`, `member`). Workflows là **catalog dùng chung** cho cả command và agent. Agents, Models và Vận hành vẫn ở [**Agent Studio**](../agent-hub/ui-agent-studio.md); chỉ `platform_admin` thấy nút chuyển app "Admin ⇄ Agent Studio".

=======================================================

## 1. Mục tiêu & nguyên tắc UX

**Mục tiêu:**

- Một platform admin, không cần là dev sâu, phải thêm được một command mới trỏ tới workflow Dify, test và bật cho mọi người trong **dưới 3 phút**, mà không cần đọc tài liệu.
- Một tenant admin phải tạo được group, thêm người và cấp một feature cho group đó trong **dưới 2 phút**, và trả lời được câu hỏi "sao tôi không thấy lệnh X" bằng một lần tra.

| # | Nguyên tắc | Thể hiện trên UI |
|---|---|---|
| P1 | **Test ngay tại chỗ** | Form command và workflow đều có *Test panel* cố định bên phải. Chạy thử được cả khi chưa lưu (dùng bản nháp) |
| P2 | **Form tự dẫn đường** | Chọn workflow xong thì các dòng input map tự hiện đúng các biến của workflow, biến bắt buộc có dấu *. Không bao giờ bắt admin gõ tay tên biến |
| P3 | **Thấy được phụ thuộc** | Mỗi workflow, feature và secret có cột "Đang được dùng bởi" (workflow liệt kê cả command lẫn agent). Xoá hay tắt thì hiện trước những gì sẽ bị ảnh hưởng |
| P4 | **An toàn mặc định** | Secret chỉ ghi, không đọc lại được. Hành động nguy hiểm (xoá, khoá user, khoá tenant, thu hồi entitlement) phải xác nhận. Rời trang khi chưa lưu thì được cảnh báo |
| P8 | **Quyền giải thích được** | Mọi chỗ hiện "ai dùng được" đều kèm lý do (qua feature nào, group nào). Tenant admin không bao giờ phải đoán vì sao một user không thấy lệnh |
| P9 | **Chỉ thấy tenant của mình** | Tenant admin chỉ thấy dữ liệu tenant mình; menu ẩn hẳn các mục không có quyền (không hiện rồi khoá) |
| P5 | **Thay đổi có hiệu lực ngay và rõ ràng** | Lưu thành công thì toast ghi "Đã áp dụng · v42". Topbar luôn hiện `config_version` hiện tại |
| P6 | **Nhanh cho người dùng thạo** | Command palette `Ctrl`+`K`, `Ctrl`+`S` để lưu, `Ctrl`+`Enter` để chạy test, bảng lọc được bằng bàn phím |
| P7 | **Lỗi nói tiếng người** | Hiện lỗi Dify hay provider nguyên văn trong khối "Chi tiết", kèm một câu tóm tắt và việc cần làm tiếp |

=======================================================

## 2. Người dùng

- **Platform admin** (`platform_admin`, tenant `platform`): Người vận hành nền tảng. Việc chính: thêm/sửa command và feature, onboard tenant, cấp entitlement, đặt quota, xem chi phí mọi tenant. Tần suất vài lần mỗi tuần.

- **Builder**: Dev tạo workflow trên Dify bằng Claude session, thường có role `platform_admin`. Việc chính: khai báo workflow vào catalog (kể cả chưa biết dùng ở đâu), import/export yaml. Gắn workflow cho agent làm ở Agent Studio. Dùng nhiều phím tắt.

- **Tenant admin** (`tenant_admin`): Quản trị của một công ty khách hàng, thường không rành kỹ thuật. Việc chính: tạo user, tạo group, cấp feature và agent cho group, theo dõi quota. Chỉ thấy tenant của mình, không vào Agent Studio.

- **Member**: Chỉ thấy màn hình đăng nhập và đổi mật khẩu. Đăng nhập xong được chuyển về Chat App (không vào được Admin UI).

=======================================================

## 3. Kiến trúc thông tin (sitemap)

```
Admin
├─ Tổng quan                         /
├─ CHỨC NĂNG
│  ├─ Features *                     /features          · /features/new · /features/:id
│  ├─ Commands *                     /commands          · /commands/new · /commands/:id
│  └─ Workflows *                    /workflows         · /workflows/new· /workflows/:id  (dùng bởi command, agent; lọc Chưa gắn)
├─ TRUY CẬP
│  ├─ Tenants *                      /tenants           · /tenants/:id (entitlement, quota, slot subscription)
│  ├─ Users                          /users             (drawer + tab Quyền hiệu lực)
│  ├─ Groups                         /groups            · /groups/:id (thành viên, feature, agent)
│  └─ Phân quyền                     /access            (ma trận feature × group, Kiểm tra quyền)
├─ BẢO MẬT
│  ├─ Secrets *                      /secrets           (drawer)
│  └─ Cài đặt đăng nhập *            /auth-settings     (chính sách mật khẩu, 2FA)
├─ HỆ THỐNG
│  ├─ Chi phí & quota                /usage             (theo tenant × feature × tháng)
│  ├─ Nhật ký thay đổi (Audit)       /audit             · /audit/:id (diff)
│  └─ Import / Export *              /transfer
└─ (ngoài khung) Đăng nhập /login · Đổi mật khẩu /change-password

* chỉ platform_admin. tenant_admin thấy: Tổng quan, TRUY CẬP (Tenants ẩn), Chi phí & quota, Nhật ký — tất cả giới hạn trong tenant của mình.
```

**Thứ tự menu theo tần suất dùng:** với platform admin, Commands và Features dùng nhiều nhất; Workflows chủ yếu do Builder dùng. Với tenant admin, Users và Groups dùng nhiều nhất. Agent, model và vận hành nằm ở Agent Studio.

| Mẫu chỉnh sửa | Dùng cho | Lý do |
|---|---|---|
| **Trang riêng** (list → editor toàn trang, có Test panel) | Command, Workflow | Nhiều trường, cần không gian cho Test panel |
| **Trang riêng có tab** (Thông tin · Thành viên / Command · Cấp quyền) | Feature, Tenant, Group | Mỗi thực thể có nhiều danh sách con |
| **Drawer bên phải** (list giữ nguyên phía sau) | Secret, User | Ít trường, thao tác nhanh, không mất ngữ cảnh danh sách |

=======================================================

## 4. Khung ứng dụng (app shell)

[[WF admin/ui-admin.html#1]]

*Hình 4.1: khung ứng dụng. Nút "⇄ Agent Studio" (chỉ `platform_admin`) chuyển sang UI của Agent Hub, dùng chung phiên đăng nhập.*

| Vùng | Đặc tả |
|---|---|
| Sidebar | Rộng 240px, thu gọn còn 64px (chỉ icon) bằng nút hoặc `[`. Nhớ trạng thái thu gọn trong localStorage. Mỗi mục có số lượng bản ghi đang bật. Chỉ hiện các mục role hiện tại có quyền |
| Topbar | Breadcrumb ở trái. Ô tìm kiếm (mở command palette). Badge tên tenant (với `tenant_admin`) hoặc "Nền tảng" (với `platform_admin`). Badge `config vN`, hover thì hiện "cập nhật lúc HH:MM bởi X". Banner vàng khi tenant đã dùng ≥ 80% quota tháng. Avatar mở menu: đổi mật khẩu, 2FA, đăng xuất |
| Bộ lọc tenant | Với `platform_admin`, các trang Users, Groups, Phân quyền, Chi phí & quota và Nhật ký có ô chọn tenant ở đầu trang (lưu trên URL `?tenant=`). `tenant_admin` không có ô này |
| Nội dung | Rộng tối đa 1280px, padding 24px. Header trang gồm tiêu đề, mô tả ngắn một dòng, và nút hành động chính ở phải |
| Thanh lưu (editor) | Dính đáy màn hình trong trang editor. Bên trái là trạng thái ("Chưa lưu thay đổi" hoặc "Đã lưu · v42"), bên phải là [Huỷ] [Lưu] |
| Command palette | Tìm theo tên command, workflow, user. Có các lệnh nhanh: "Tạo command", "Đi tới Secrets"… |

=======================================================

## 5. Design tokens

### Màu

- **primary**<br>#4f46e5 · nút chính, link
- **success**<br>#047857 · Bật, ok
- **warning**<br>#b45309 · cooldown, busy
- **danger**<br>#dc2626 · lỗi, xoá
- **muted**<br>#5f6368 · text phụ, Tắt
- **bg / surface**<br>#f7f7f5 / #ffffff

Có dark mode, tự đổi theo hệ điều hành và cho chuyển tay trong menu avatar. Token màu giống bộ đang dùng trong tài liệu này (`styles.css`).

| Token | Giá trị |
|---|---|
| Font | System UI (Segoe UI trên Windows). Mono: Cascadia Mono / Consolas, dùng cho tên command, key, id, JSON |
| Cỡ chữ | 12 (caption) · 13 (bảng, nhãn) · 14 (body) · 16 (tiêu đề card) · 20 (tiêu đề trang) |
| Khoảng cách | Lưới 4px: 4 · 8 · 12 · 16 · 24 · 32 |
| Bo góc | 6px (input, nút) · 8px (card, bảng) · 12px (modal) · 999px (badge, chip) |
| Mật độ bảng | Hàng cao 40px (mặc định) hoặc 32px (chế độ gọn, bật trong menu avatar) |
| Chuyển động | Drawer và modal 150ms ease-out. Tắt khi người dùng bật `prefers-reduced-motion` |

### Trạng thái chuẩn (dùng thống nhất toàn app)

`Bật` `Tắt` `Beta` `Chưa gắn` `Đã khoá` `ok` `busy` `cooldown đến 14:30` `logged_out` `error` `sync` `async` `80% quota` `Vượt quota`

=======================================================

## 6. Thư viện thành phần

| Thành phần | Hành vi |
|---|---|
| **DataTable** | Ô tìm kiếm tức thời (lọc phía client khi < 500 dòng). Filter chip (Tất cả / Bật / Tắt, cộng filter riêng từng trang). Sort theo cột. Click hàng thì mở editor. Cuối hàng có menu `⋯`: Nhân bản, Bật/Tắt, Xoá. Toggle bật/tắt ngay trên hàng, có Hoàn tác trong toast 5 giây |
| **StatusBadge** | Theo bảng trạng thái chuẩn. Hover thì có tooltip giải thích (ví dụ "Hết quota, tự thử lại lúc 14:30") |
| **RefPicker** | Combobox chọn workflow, feature, group, user hoặc secret. Mỗi option có tên, key (mono) và mô tả một dòng. Cuối danh sách có "+ Tạo mới…", mở drawer tạo nhanh rồi tự chọn luôn bản vừa tạo. Bản đang tắt hiện mờ kèm nhãn "Tắt" |
| **SecretField** | Hiện `•••• 7f3a` (last4) cùng nút [Thay giá trị]. Bấm vào thì mở ô nhập kiểu password, có nút hiện/ẩn chỉ cho lúc đang gõ. Không bao giờ tự điền giá trị cũ. Chưa có secret thì hiện ô nhập ngay |
| **ArgsEditor** | Danh sách tham số của command, kéo để đổi thứ tự. Mỗi dòng: tên, mô tả, mặc định, fallback (`$selection`…), cờ *rest* (nuốt phần còn lại, chỉ tham số cuối được bật). Phía trên có dòng xem trước cú pháp: `/dich <lang=vi> <text…>` |
| **InputMapper** | Mỗi input của workflow là một dòng: *tên biến + kiểu + dấu ** → *nguồn* (select: tham số, `$selection`, `$page.url`, `$page.text`, `$attachment`, `$user.id`, `$tenant.id`, Giá trị cố định) → *giá trị/mặc định*. Input bắt buộc chưa map thì viền đỏ. Workflow đổi schema thì hiện banner "Workflow đã thay đổi input, kiểm tra lại" |
| **SchemaEditor** | Bảng input của workflow: tên, kiểu (text/number/boolean/select/file), bắt buộc, **mô tả (bắt buộc)**, options (khi kiểu là select). Nút [Lấy từ Dify] điền tự động. Có tab "JSON" để sửa raw, và tab "Model thấy gì" hiện đúng tên tool, mô tả và JSON schema mà agent sẽ nhận |
| **TestPanel** | Cố định bên phải trong editor. Form tự sinh từ args. Có các ô giả lập context: đoạn bôi đen, URL trang, file đính kèm, và ô "Chạy với tư cách user…" để kiểm tra quyền. Nút [▶ Chạy thử] (`Ctrl`+`Enter`). Kết quả có 3 tab: *Kết quả* (render markdown) · *Raw* (JSON) · *Trace*. Header kết quả có thời gian chạy, provider và token. Nhớ 5 lần test gần nhất (theo phiên) |
| **TraceViewer** | Dòng thời gian các step: icon theo loại (delegate / workflow / model / tool), nhãn, thời gian, provider. Bấm vào step thì xem input/output. Step dự phòng có badge cam "fallback: quota" |
| **DependencyList** | Danh sách "Đang được dùng bởi" dạng link (command ở Admin, agent ở Agent Studio). Dùng trong editor và trong hộp xác nhận xoá |
| **GrantMatrix** | Bảng feature (hàng) × group (cột), mỗi ô là checkbox. Ô bị khoá kèm tooltip khi feature chưa được entitlement cho tenant. Có "Chọn cả hàng/cột". Lưu một lần cho mọi thay đổi, toast "Đã cấp 3, thu hồi 1" |
| **AccessExplainer** | Chọn một user → danh sách feature, command và agent user thấy được. Mỗi dòng có lý do: "qua feature Kế toán · group Kế toán". Command không thấy được thì bấm "Vì sao không?" để xem tầng nào chặn (feature tắt / chưa entitlement / chưa cấp) |
| **QuotaBar** | Thanh ngang "đã dùng / giới hạn" theo run, token hoặc USD. Màu trung tính dưới 80%, vàng từ 80%, cam khi vượt (kèm chữ "Vượt 12%", không chỉ dựa vào màu). Không giới hạn thì hiện "Không giới hạn" và chỉ ghi số đã dùng |
| **ConfirmDialog** | Ba mức. *Nhẹ* (tắt): chỉ cần toast có Hoàn tác. *Vừa* (khoá user, thu hồi grant): modal có [Huỷ] [Xác nhận]. *Nặng* (xoá, khoá tenant, thu hồi entitlement): modal bắt gõ lại key để xác nhận, kèm DependencyList hoặc số user bị ảnh hưởng |
| **DiffViewer** | So sánh trước/sau theo từng trường (không phải diff text thô). Trường secret chỉ hiện "đã thay đổi" |
| **Toast** | Hiện ở góc dưới phải. Thành công tự ẩn sau 4 giây. Lỗi phải bấm mới đóng. Có thể kèm nút [Hoàn tác] hoặc [Xem] |
| **UnsavedGuard** | Có thay đổi chưa lưu thì chặn điều hướng bằng modal "Bỏ thay đổi?", và chặn cả việc đóng tab (beforeunload) |

=======================================================

## 7. Màn hình chi tiết

7.1

### 7.1 Đăng nhập & đổi mật khẩu

[[WF admin/ui-admin.html#2]]

- Form gồm **Mã công ty**, Username, Mật khẩu. Mã công ty nhớ trong localStorage cho lần sau, và điền sẵn nếu mở từ link `/login?tenant=acme`.
- Thông báo lỗi **không** nói rõ sai mã công ty, username hay mật khẩu. **Không** hiện số lần thử còn lại (tránh lộ username có tồn tại). Bị khoá tạm thì ghi "Tạm khoá đến 14:45".
- Nút Đăng nhập chuyển sang trạng thái loading và bị khoá trong lúc gửi, để không gửi hai lần. `Enter` để gửi.
- Nếu `must_change_password` thì chuyển sang màn "Đặt mật khẩu mới": gồm mật khẩu mới, nhập lại, và gợi ý độ mạnh (tối thiểu 10 ký tự). Không bỏ qua được.
- Admin đã bật 2FA thì sau mật khẩu có bước nhập mã TOTP 6 số.
- `member` đăng nhập thành công ở đây thì thấy thông báo "Tài khoản của bạn dùng Chat App", kèm link sang Chat App.
- Access token hết hạn giữa chừng thì âm thầm refresh. Refresh thất bại thì hiện modal đăng nhập lại *ngay trên trang hiện tại*, giữ nguyên dữ liệu form đang nhập.

7.2

### 7.2 Tổng quan

Nội dung khác nhau theo role:

| Role | Nội dung |
|---|---|
| `platform_admin` | KPI: Tenants active · Commands đang bật · Workflows (số "Chưa gắn") · Users active · Số run 24 giờ (lấy từ Hub). Card "Tenant sắp/đã vượt quota". Card "Command lỗi nhiều nhất 24 giờ" (top 5, click để mở editor). Card "Agent Studio": link và trạng thái tóm tắt ("1 provider cần xử lý"). Card "Thay đổi gần đây" |
| `tenant_admin` | KPI: Users active · Groups · Số run tháng này · QuotaBar của tenant. Card "Người dùng mới chưa đăng nhập". Card "Thay đổi gần đây" của tenant |

7.3

### 7.3 Commands — danh sách

[[WF admin/ui-admin.html#3]]

- Tên command có dấu `/` ở trước và dùng font mono. Alias hiện nhỏ, màu phụ, ngay cạnh.
- Cột **Feature** liệt kê các feature chứa command (chip, bấm để mở feature). Filter theo feature.
- Nếu workflow của command đang tắt thì hiện badge `Tắt` ở cột Workflow, và toggle của command bị khoá kèm tooltip "Bật workflow invoice trước".
- Filter và từ khoá tìm kiếm được lưu trên URL (`?q=&status=&feature=`) để chia sẻ link được.
- Trạng thái rỗng: "Chưa có command nào. Command giúp người dùng gọi workflow bằng một lệnh ngắn như `/dich`." kèm nút [+ Tạo command đầu tiên]. Nếu chưa có workflow nào thì nút chuyển thành [Khai báo workflow trước].

7.4

### 7.4 Command — editor (màn hình quan trọng nhất)

[[WF admin/ui-admin.html#4]]

*Ghi chú M2 ([CR-014](../../CHANGE-REQUESTS.md)): editor là **trang riêng** (`/commands/new`, `/commands/:id`); chưa có Test panel "Chạy thử", "Chạy với tư cách user…" và "Lịch sử" (Test = M5, Lịch sử = M4); tab "Ai dùng được" chỉ phần tenant ([CR-013](../../CHANGE-REQUESTS.md)).*

*Hình 7.4: form chia 5 bước theo thứ tự admin suy nghĩ (đặt tên → chọn workflow → người dùng gõ gì → đưa vào đâu → hiển thị ra sao), cộng ô Feature ở bước ①. Test panel bên phải luôn hiện.*

| Tương tác | Hành vi |
|---|---|
| Gõ tên | Tự đổi sang chữ thường và bỏ dấu (gõ "Dịch" thành `dich`). Kiểm tra trùng tên và alias ngay khi rời ô: "`/dich` đã được dùng bởi command khác" |
| Chọn feature | Multi-select, mặc định `core`. Bỏ hết feature thì báo "Command phải thuộc ít nhất một feature" |
| Chọn workflow | Tự sinh bước ④ theo input schema. Nếu một input trùng tên với tham số (`text` và `text`) thì tự map sẵn. Đổi sang workflow khác thì giữ các map còn hợp lệ và báo những map bị bỏ |
| Thêm tham số | Dòng xem trước cú pháp cập nhật ngay. Tham số vừa có tên thì xuất hiện luôn trong select nguồn ở bước ④ |
| Chạy thử | Gửi *bản đang sửa* (chưa cần lưu) sang Hub. Hiện spinner, có nút [Dừng]. Lỗi hiện một dòng tóm tắt, bên dưới là "Chi tiết từ Dify" (thu gọn được). Chọn "Chạy với tư cách user…" thì Hub kiểm tra cả quyền của user đó |
| Lưu | Validate toàn form. Có lỗi thì cuộn tới lỗi đầu tiên và focus vào đó. Lưu thành công thì toast "Đã lưu và áp dụng · v43 · Chat App thấy sau vài giây" |
| Chưa từng test mà lưu | Vẫn cho lưu, nhưng hiện gợi ý (không chặn): "Bạn chưa chạy thử bản này" |
| Tab "Ai dùng được" | AccessExplainer theo chiều ngược: tenant và group thấy command này, số user, kèm lý do |
| Nhân bản | Mở editor mới với tên `dich-copy`, trạng thái Tắt, cùng feature |
| Lịch sử | Mở drawer liệt kê audit của riêng command này, kèm diff và nút Khôi phục |

7.5

> ℹ️ **7.5 Agents** nằm ở [Agent Studio](../agent-hub/ui-agent-studio.md). Agent chọn workflow từ catalog ở mục 7.6.

7.6

### 7.6 Workflows (catalog dùng chung)

[[WF admin/ui-admin.html#5]]

- *Ghi chú M2 ([CR-014](../../CHANGE-REQUESTS.md), [CR-012](../../CHANGE-REQUESTS.md)): form workflow là trang riêng (`/workflows/new`, `/workflows/:id`); chưa có "Kiểm tra kết nối" và "Lấy từ Dify"; bước 2 của hướng dẫn rỗng đọc "Chọn secret, khai báo input, viết mô tả".*
- Workflow là **catalog dùng chung** cho command (Admin) và agent (Agent Studio). Tạo sẵn mà chưa gắn vào đâu là hợp lệ: danh sách hiện badge `Chưa gắn` và có filter chip "Chưa gắn" để dọn dẹp.
- Cột **Đang được dùng bởi**: số command và số agent, hover thì liệt kê, bấm agent thì mở Agent Studio.
- **Mô tả workflow** (20–400 ký tự) và **mô tả từng tham số** là bắt buộc, vì agent dùng nguyên văn làm tool. Gợi ý dưới ô: "Viết như đang dặn một người mới: dùng khi nào, không dùng khi nào." Tab "Model thấy gì" hiện đúng tên tool và JSON schema.
- **Kiểm tra kết nối** nhờ Hub gọi Dify để lấy thông tin app. Kết quả hiện ngay cạnh nút: "✓ Kết nối được · app 'Translate'" hoặc "✗ Key không hợp lệ (401)".
- **Lấy từ Dify** (COULD) điền schema tự động, rồi hiện diff với schema hiện tại trước khi áp dụng. Nếu schema đổi làm hỏng các command hoặc agent đang dùng thì liệt kê từng nơi bị ảnh hưởng.
- Xoá hoặc tắt workflow đang được dùng thì bị chặn, kèm DependencyList (command và agent).
- Nút "Tạo command từ workflow này" mở Command editor với workflow đã chọn sẵn. Gắn cho agent thì làm ở Agent Studio.
- Trạng thái rỗng của catalog hướng dẫn luồng làm việc: "Tạo workflow trên Dify (bằng Claude session) → dán app key vào đây → khai báo input và mô tả."

7.7

> ℹ️ **7.7 Models** (provider, profile) nằm ở [Agent Studio](../agent-hub/ui-agent-studio.md).

7.8

### 7.8 Secrets

[[WF admin/ui-admin.html#6]]

- Chỉ `platform_admin`. Không có hành động "xem giá trị" ở bất cứ đâu. Không có nút copy giá trị.
- Xoá secret đang được dùng thì bị chặn, kèm DependencyList.
- Tên secret viết HOA_GẠCH_DƯỚI và tự chuẩn hoá khi gõ.

7.9

### 7.9 Users

[[WF admin/ui-admin.html#7]]

- `tenant_admin` chỉ thấy user của tenant mình. `platform_admin` chọn tenant ở đầu trang.
- Bảng có cột Group (chip) và filter theo group. Drawer tạo user có ô chọn group ngay khi tạo.
- Tab **Quyền hiệu lực** trong drawer: AccessExplainer của user đó (feature, command, agent thấy được và lý do).
- Mật khẩu tạm được sinh ngẫu nhiên và **chỉ hiện một lần**, lúc tạo hoặc reset. Sau khi đóng drawer thì không xem lại được. Toast nhắc: "Đã copy mật khẩu tạm, hãy gửi cho người dùng qua kênh riêng." Kèm mã công ty để người dùng biết đăng nhập vào đâu.
- Menu `⋯` gồm: Sửa, Reset mật khẩu, Khoá/Mở khoá, Đăng xuất mọi thiết bị.
- Khoá user dùng modal mức vừa: "Khoá **cuong.le**? Người này bị đăng xuất khỏi mọi thiết bị trong tối đa 15 phút."
- Hàng của chính mình có nhãn "(bạn)". Menu của hàng này không có Khoá và không có Hạ role.
- Role chọn được: `tenant_admin` chỉ gán `member` hoặc `tenant_admin`. `platform_admin` chỉ tồn tại trong tenant `platform`.

7.10

### 7.10 Nhật ký thay đổi (Audit)

[[WF admin/ui-admin.html#8]]

- `tenant_admin` chỉ thấy thay đổi trong tenant mình (user, group, grant). `platform_admin` thấy tất cả, lọc theo tenant.
- Khôi phục **không** ghi đè lịch sử mà tạo một phiên bản mới (v44 = nội dung của v42), sau khi xác nhận bằng modal.
- Thay đổi secret chỉ ghi "đã thay giá trị", không có diff.

7.11

### 7.11 Import / Export

- Chỉ `platform_admin`.
- **Export:** chọn loại (checkbox: workflows, commands, features, tenants, groups, grants) rồi tải file `config-v43.yaml`. Secret chỉ export tên. Cấu hình agent export ở Agent Studio.
- **Import:** kéo-thả file yaml → hệ thống parse và validate → hiện *bản xem trước* 3 nhóm: `Thêm 3` `Sửa 2` `Không đổi 10`, bấm vào từng mục để xem diff → [Áp dụng]. Không bao giờ xoá những thực thể không có trong file (v1).
- Nếu file tham chiếu secret chưa tồn tại thì hiện danh sách "Cần tạo secret" với ô nhập ngay tại chỗ. Chưa nhập đủ thì không áp dụng được.

7.12

### 7.12 Features

- Chỉ `platform_admin`. Danh sách: tên, key, trạng thái (`Bật` `Tắt` `Beta`), số command, số tenant được entitlement. Feature `core` có nhãn "Mặc định", không xoá và không tắt được.
- Editor có 3 tab:
  - *Thông tin*: key, tên và mô tả VI/EN, icon, trạng thái.
  - *Commands*: danh sách command trong feature, thêm bằng RefPicker, bỏ bằng ✕. Command sắp không còn feature nào thì cảnh báo "`/tr-nhanh` sẽ không thuộc feature nào và biến khỏi menu".
  - *Tenant*: bảng tenant được entitlement, nút [+ Cấp cho tenant], thu hồi dùng ConfirmDialog mức nặng kèm số user đang dùng.
- Tắt feature (kill switch) dùng ConfirmDialog mức vừa: "Tắt **Kế toán**? 3 command biến khỏi menu của 120 người trong vài giây. Run đang chạy vẫn chạy xong."

7.13

### 7.13 Tenants

- Chỉ `platform_admin`. Danh sách: mã công ty, tên, số user, QuotaBar tháng này, trạng thái.
- Tạo tenant: mã công ty (chữ thường, số, `-`), tên, rồi tạo luôn `tenant_admin` đầu tiên (mật khẩu tạm chỉ hiện một lần).
- Trang chi tiết có các tab: *Thông tin* (tên, trạng thái, giới hạn slot subscription, để trống = không giới hạn) · *Feature* (entitlement) · *Agent* (entitlement agent, link sang Agent Studio) · *Quota* (theo run, token, USD; chung hoặc theo feature; để trống = không giới hạn) · *Users* (link sang trang Users đã lọc).
- Khoá tenant dùng ConfirmDialog mức nặng (gõ lại mã công ty): "Mọi user của **acme** (120 người) bị đăng xuất và không đăng nhập được."

7.14

### 7.14 Groups

- Danh sách group của tenant: tên, số thành viên, số feature, số agent được cấp.
- Trang group có 3 tab:
  - *Thành viên*: thêm bằng RefPicker hoặc dán danh sách username (mỗi dòng một người); username không tồn tại được liệt kê để sửa.
  - *Feature*: danh sách feature được cấp, chỉ chọn được trong số feature tenant đã được entitlement.
  - *Agent*: danh sách agent được cấp, chỉ chọn được trong số agent tenant đã được entitlement.
- Group `beta-testers` được tạo sẵn cho mỗi tenant, có nhãn giải thích "Thấy các feature đang Beta".

7.15

### 7.15 Phân quyền

- Tab *Ma trận*: GrantMatrix feature × group của tenant. Tenant nhiều group thì cột cuộn ngang, cột đầu cố định.
- Tab *Kiểm tra quyền*: AccessExplainer. Nhập username → kết quả kèm lý do. Đây là nơi trả lời "sao tôi không thấy lệnh X".

7.16

### 7.16 Chi phí & quota

- Hàng KPI: Số run · Token · Số thu (`billable_usd`) tháng này, kèm delta so với tháng trước. `platform_admin` có thêm tile Chi phí thật (`cost_usd`) và Biên (thu − chi).
- QuotaBar cho từng quota của tenant. Không đặt quota thì hiện "Không giới hạn".
- Biểu đồ cột theo ngày (số thu), bảng top feature và top user tốn nhất, export CSV theo bộ lọc.
- `platform_admin` có bảng xếp hạng tenant theo số thu và mức dùng quota. Quy tắc biểu đồ theo [UI Vận hành](../agent-hub/ui-operations.md) mục 7.
- Vượt quota không chặn: dòng có badge `Vượt quota` và phần vượt được tô vân chéo trong biểu đồ.

=======================================================

## 8. Luồng thao tác chính

### F1. Đưa một workflow mới vào sử dụng (luồng quan trọng nhất)

```
Claude session tạo workflow trên Dify, lấy app key
  → Workflows › + Khai báo workflow
      dán key → [Kiểm tra kết nối] ✓ → [Lấy từ Dify] điền schema (hoặc nhập tay) → Lưu
  → trong trang workflow bấm "Tạo command từ workflow này"
      (mở Command editor, workflow đã chọn sẵn, input map tự điền)
  → đặt tên /xxx, chọn feature (mặc định core), thêm tham số, map các input còn thiếu
  → Test panel: [▶ Chạy thử] ✓
  → Lưu (mặc định Bật) → toast "Đã áp dụng · v44"
  → user có quyền với feature đó thấy /xxx trong menu sau ≤ 5 giây
```

Chỉ tiêu: ≤ 3 phút và ≤ 25 thao tác click/gõ khi workflow có 2–3 input.

Workflow cũng có thể chỉ khai báo và **để đó** (badge `Chưa gắn`), sau này mới tạo command hoặc gắn cho agent. *Gắn workflow cho agent và xử lý provider: xem Agent Studio.*

### F2. Onboard một công ty khách hàng

```
Tenants › + Tạo tenant: mã công ty "acme", tên → tạo tenant_admin đầu tiên (mật khẩu tạm hiện 1 lần)
  → tab Feature: cấp các feature theo gói đã bán (core có sẵn)
  → tab Agent: cấp agent (Agent Studio)   → tab Quota: để trống = không giới hạn
  → gửi mã công ty + username + mật khẩu tạm cho khách qua kênh riêng
```

### F3. Tenant admin mở chức năng cho một phòng ban

```
Groups › + Tạo group "Kế toán" → tab Thành viên: dán danh sách username
  → tab Feature: chọn "Kế toán" → tab Agent: chọn "Trợ lý hoá đơn" → Lưu
  → thành viên thấy /kiemtra-hoadon và được Coordinator giao cho agent sau ≤ 5 giây
```

Chỉ tiêu: ≤ 2 phút.

### F4. "Sao tôi không thấy lệnh X?"

```
Phân quyền › Kiểm tra quyền › nhập username → tìm /kiemtra-hoadon → [Vì sao không?]
  → "Feature Kế toán chưa được cấp cho bạn hay group nào của bạn" → [Cấp cho group…]
```

### F5. Thay key (rotate)

```
Secrets › chọn secret → [Thay giá trị] → dán key mới → Lưu
  → toast có nút [Kiểm tra các workflow dùng secret này] → chạy thử nhanh từng cái
```

### F6. Nhân viên nghỉ việc

```
Users › tìm user › ⋯ Khoá → modal xác nhận → Khoá
  → token bị thu hồi, trạng thái "Đã khoá", có ghi audit
```

### F7. Tenant vượt quota

```
Hub đếm mức dùng → đạt 80%: email + banner vàng cho tenant_admin
  → đạt 100%: vẫn chạy, email + banner cam "Đang vượt quota, phần vượt được tính phí"
  → Chi phí & quota: xem feature nào tốn nhất → liên hệ platform admin nâng quota nếu cần
```

=======================================================

## 9. Trạng thái, validation, thông báo

### Trạng thái màn hình

| Trạng thái | Thiết kế |
|---|---|
| Đang tải | Skeleton theo đúng hình dạng bảng hoặc form. Không dùng spinner che cả trang. Quá 10 giây thì hiện "Vẫn đang tải…" kèm nút [Thử lại] |
| Rỗng | Icon, một câu giải thích *thực thể này dùng để làm gì*, và nút tạo mới. Rỗng do bộ lọc thì hiện "Không có kết quả cho 'abc'" kèm nút [Xoá bộ lọc] |
| Lỗi tải | Hiện một banner trong vùng nội dung: "Không tải được dữ liệu (mã). [Thử lại]". Sidebar và topbar vẫn dùng được |
| Đang lưu | Nút Lưu chuyển thành spinner và bị khoá. Form chưa bị khoá (sửa tiếp được, nhưng phần sửa thêm sẽ thành thay đổi mới) |
| Xung đột | Người khác đã lưu bản mới hơn (so theo version). Modal: "an vừa sửa command này lúc 10:42. [Xem khác biệt] [Ghi đè] [Tải bản mới]" |
| Mất kết nối | Banner vàng dính trên cùng: "Mất kết nối, thay đổi chưa được lưu". Nút Lưu bị khoá cho đến khi có mạng lại |

### Validation (hiện khi rời ô và khi bấm Lưu)

| Trường | Luật | Câu báo lỗi |
|---|---|---|
| Tên command | `^[a-z0-9-]{2,32}$`, không trùng tên hoặc alias khác | "Chỉ dùng chữ thường không dấu, số, dấu -" · "/dich đã được dùng bởi command khác" |
| Input map | Mọi input bắt buộc đều có nguồn | "Input bắt buộc chưa được map" |
| Tham số rest | Chỉ tham số cuối được bật | "Chỉ tham số cuối cùng mới được nhận phần còn lại" |
| Feature của command | ≥ 1 feature | "Command phải thuộc ít nhất một feature" |
| Mô tả workflow | 20–400 ký tự | "Mô tả quá ngắn, agent sẽ khó biết khi nào dùng workflow này" |
| Mô tả tham số workflow | Bắt buộc cho mọi tham số | "Thiếu mô tả cho tham số {tên}" |
| Timeout | 5–3600 giây. Sync thì ≤ 120 | "Command sync tối đa 120 giây, hãy chuyển sang Async" |
| Mã công ty | `^[a-z0-9-]{2,32}$`, không trùng | "Mã công ty đã được dùng" |
| Key feature, key group | `^[a-z0-9-]{2,32}$`, không trùng (group: trong tenant) | "Key đã được dùng" |
| Quota | Số nguyên dương hoặc để trống (không giới hạn) | "Nhập số lớn hơn 0 hoặc để trống" |
| Mật khẩu | ≥ 10 ký tự, khác mật khẩu cũ | "Mật khẩu cần tối thiểu 10 ký tự" |

### Toast chuẩn

| Tình huống | Nội dung |
|---|---|
| Lưu | "Đã lưu và áp dụng · v43" |
| Bật/Tắt nhanh | "Đã tắt /dich · [Hoàn tác]" |
| Xoá | "Đã xoá /tr-nhanh" |
| Lỗi lưu | "Không lưu được: {lý do}" (không tự ẩn) |
| Test lỗi | Không dùng toast. Lỗi hiện ngay trong Test panel |
| Cấp quyền | "Đã cấp Kế toán cho 2 group · có hiệu lực sau vài giây" |
| Thu hồi entitlement | "Đã thu hồi Kế toán của acme · [Hoàn tác]" |

=======================================================

## 10. Phím tắt

| Phím | Tác dụng | Phạm vi |
|---|---|---|
| `Ctrl`+`K` | Command palette | Toàn app |
| `/` | Focus ô tìm của bảng | Trang danh sách |
| `N` | Tạo mới | Trang danh sách |
| `Ctrl`+`S` | Lưu | Editor |
| `Ctrl`+`Enter` | Chạy thử | Editor có Test panel |
| `Esc` | Đóng drawer hoặc modal (hỏi lại nếu có thay đổi chưa lưu) | Toàn app |
| `[` | Thu gọn/mở sidebar | Toàn app |
| `?` | Hiện bảng phím tắt | Toàn app |

=======================================================

## 11. Responsive & accessibility

| Kích thước | Hành vi |
|---|---|
| ≥ 1280px (chính) | Bố cục đầy đủ. Editor chia 2 cột (form ~58%, Test ~42%) |
| 1024–1279px | Sidebar tự thu gọn còn icon. Editor vẫn 2 cột |
| 768–1023px | Test panel chuyển thành tab "Chạy thử" nằm cạnh tab "Cấu hình". Drawer chiếm 100% chiều rộng |
| < 768px (điện thoại) | Hỗ trợ *tác vụ khẩn*: xem Tổng quan và mức dùng quota, bật/tắt command hoặc feature, khoá user hoặc tenant. Editor phức tạp hiện gợi ý "Mở trên máy tính để chỉnh sửa đầy đủ", nhưng vẫn cho sửa được. Bảng chuyển thành danh sách thẻ |

- Đi hết mọi thao tác được bằng bàn phím, focus ring luôn nhìn thấy (2px màu primary). Drawer và modal giữ focus bên trong, đóng thì trả focus về nút đã mở nó.
- Tương phản chữ ≥ 4.5:1 ở cả hai theme. Trạng thái không chỉ phân biệt bằng màu mà luôn có chữ trong badge.
- Toggle có nhãn cho trình đọc màn hình ("Bật command /dich"). Lỗi form gắn vào ô bằng `aria-describedby`, và ô đầu tiên có lỗi được focus khi Lưu thất bại.
- Kết quả Test cập nhật qua vùng `aria-live="polite"`.

=======================================================

## 12. Câu chữ (microcopy) — dùng thống nhất

| Dùng (VI) | EN | Không dùng | Ghi chú |
|---|---|---|---|
| Bật / Tắt | Enabled / Disabled | Enable / Disable, Kích hoạt | Cho mọi thực thể |
| Chạy thử | Test, Kiểm thử | Tên nút. Trong tài liệu kỹ thuật vẫn gọi là "Test panel" |
| Lưu | Lưu & publish, Submit | Vì lưu là áp dụng ngay |
| Thay giá trị | Replace value | Sửa secret, Xem secret | Chỉ dành cho secret |
| Đang được dùng bởi | Used by | References, Liên kết |  |
| Khoá / Mở khoá | Lock / Unlock | Vô hiệu hoá, Ban | Cho user và tenant |
| Cấp / Thu hồi | Grant / Revoke | Phân, Gán quyền, Xoá quyền | Cho entitlement và grant |
| Mã công ty | Company code | Tenant ID, Mã tenant | Trên màn đăng nhập. Trong tài liệu kỹ thuật vẫn gọi là tenant key |
| Chưa gắn | Unused | Mồ côi, Rác | Badge của workflow chưa được command hay agent nào dùng |
| Dự phòng | Fallback | Fallback (trong UI) | Badge trong Trace được phép ghi "fallback" vì là thuật ngữ kỹ thuật |
| Command, Agent, Workflow, Feature, Tenant, Group, Provider, Profile | Command, Agent, Workflow, Feature, Tenant, Group, Provider, Profile | Lệnh, Tác tử, Luồng… | Giữ nguyên tiếng Anh, vì đội đã quen và khớp với tài liệu BA |

=======================================================

## 13. Truy vết yêu cầu & câu hỏi mở

| Màn hình | Đáp ứng |
|---|---|
| 7.1 Đăng nhập | ADM-FR-01, 02, 03, 06, 07, 08 |
| 7.3–7.4 Commands | ADM-FR-20 → 24 · ADM-BR-01, 02, 06, 10 |
| 7.6 Workflows | ADM-FR-10 → 15 · ADM-BR-13 |
| 7.8 Secrets | ADM-FR-50 · ADM-BR-04, 14 |
| 7.9 Users | ADM-FR-04, 05, 63 · ADM-BR-05, 08, 09 |
| 7.10 Audit | ADM-FR-51, 52, 53 |
| 7.11 Import/Export | ADM-FR-54 |
| 7.12 Features | ADM-FR-30, 31, 33, 34 · ADM-BR-10, 12 |
| 7.13 Tenants | ADM-FR-60, 61, 40 |
| 7.14 Groups | ADM-FR-62, 32, 37 |
| 7.15 Phân quyền | ADM-FR-35, 36 · ADM-BR-11 |
| 7.16 Chi phí & quota | ADM-FR-40, 41, 42 |

> ✅ **Đã chốt và cập nhật vào BA Admin:** (1) chạy thử bằng *bản chưa lưu* (ADM-FR-23); (2) phát hiện xung đột khi hai admin cùng sửa bằng trường `version` (ADM-FR-55, AC-A07).

### Câu hỏi mở

1. ~~Chỉ tiếng Việt hay song ngữ?~~ Đã chốt: **song ngữ VI/EN** (mục 15).
2. ~~Có trang chi phí v1 không?~~ Đã chốt: **có**, chi phí vận hành chi tiết nằm trong Agent Studio ([UI Vận hành](../agent-hub/ui-operations.md)); chi phí & quota theo tenant nằm ở Admin (mục 7.16).
3. ~~Thư viện UI nào?~~ Đã chốt: **shadcn/ui** (mục 14).
4. ~~Hai điểm bổ sung BA?~~ Đã chốt: có (ADM-FR-23, ADM-FR-55).
5. ~~Role builder riêng?~~ Không. v0.4 có 3 role: `platform_admin` (Admin UI đầy đủ + Agent Studio), `tenant_admin` (phần của tenant mình), `member`.
6. ~~Workflow chỉ dùng cho command?~~ Đã chốt v0.4: catalog dùng chung cho command và agent, tạo sẵn để đó được.
7. Có cần wireframe riêng cho các màn mới 7.12–7.16 không, hay dùng lại mẫu DataTable + trang có tab?

## 14. Công nghệ UI: shadcn/ui

Dùng shadcn/ui (Radix + Tailwind), copy component vào repo (`components/ui`). Token màu ở mục 5 được khai báo thành CSS variable của theme shadcn (`--primary`, `--destructive`…), light và dark.

| Thành phần trong tài liệu này | shadcn / thư viện đi kèm |
|---|---|
| App shell, sidebar thu gọn | `Sidebar` (SidebarProvider, collapsible="icon") |
| Command palette, RefPicker (combobox) | `Command` (cmdk) + `Popover` |
| DataTable | `Table` + **TanStack Table** (sort, filter, row selection), `DropdownMenu` cho menu ⋯ |
| Drawer (secret, user, provider) | `Sheet` (side="right") |
| ConfirmDialog nhẹ, vừa, nặng | Toast có Hoàn tác, `AlertDialog`, `AlertDialog` kèm `Input` gõ lại key |
| Form, validation | `Form` + **react-hook-form** + **zod** (dùng chung schema với API) |
| Toggle bật/tắt · chip lựa chọn · badge | `Switch` · `ToggleGroup` · `Badge` (thêm các variant ok/warn/err/off/info) |
| Tabs của Test panel | `Tabs` |
| ArgsEditor (kéo-thả) | **dnd-kit** (sortable) |
| Soạn prompt, JSON schema | `Textarea`. Tab JSON dùng **CodeMirror** (nhẹ hơn Monaco) |
| Toast | `Sonner` |
| Skeleton, Tooltip, ScrollArea, Separator, Breadcrumb | Các component cùng tên |

## 15. Song ngữ VI/EN

- **Mặc định là VI.** Đổi ngôn ngữ trong menu avatar. Lựa chọn lưu vào `users.locale`, dùng chung cho Admin, Chat và Extension.
- **Chuỗi giao diện** tổ chức theo key trong `messages/vi.json` và `messages/en.json` (next-intl hoặc i18next). CI chặn merge nếu thiếu key ở một trong hai file.
- **Nội dung cấu hình mà user cuối nhìn thấy** nhập được hai bản: Trên form, các trường này có tab nhỏ `VI` `EN` ngay trên ô nhập. Ô EN để trống thì tự dùng bản VI, và list hiện icon "EN thiếu" để admin bổ sung sau.
  - mô tả command, mô tả tham số;
  - tên hiển thị agent, nhãn step;
  - mô tả workflow (nếu hiện cho user);
  - tên và mô tả feature, tên group.
- **Không cần hai bản:** key, tên command, system prompt, mô tả agent cho Coordinator (Coordinator đọc được cả hai thứ tiếng).
- **Độ dài chữ:** bản EN thường dài hơn khoảng 20–30%. Nút và nhãn không dùng chiều rộng cố định. Kiểm tra lại cả hai ngôn ngữ ở khổ 1024px.
- **Định dạng:** dùng `Intl` theo locale cho ngày, giờ, số và tiền. Thời gian tương đối ("5 phút trước" / "5 min ago") cũng theo locale.
- **Ảnh hưởng tới BA Admin:** thêm `users.locale`, và đổi các trường mô tả hoặc hiển thị thành jsonb `{vi, en}`.
