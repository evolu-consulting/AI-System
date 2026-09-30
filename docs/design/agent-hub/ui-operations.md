# Vận hành — Đặc tả UI/UX (Agent Hub + Worker)

Màn hình quan sát và điều khiển runtime: run và trace, chi phí và usage, job và worker, subscription pool. Là một mục của [Agent Studio](ui-agent-studio.md), UI riêng của Agent Hub.

`v0.4 · draft` · `2026-10-01` · `shadcn/ui · song ngữ VI/EN`

## 1. Vị trí

Theo v0.3, Agent Hub có UI riêng là **Agent Studio**. Mục **Vận hành** là một phần của Studio, vì Hub sở hữu toàn bộ dữ liệu runtime (`hub.*`) và cấu hình agent. Worker không có UI: trạng thái của Worker hiện trong Vận hành.

Từ v0.4, hệ thống phục vụ nhiều **tenant** (công ty khách hàng). Vận hành nhìn toàn hệ thống và lọc được theo tenant. Chỉ `platform_admin` vào được.

| Service | Người dùng cuối (member) | Người vận hành (platform_admin) |
|---|---|---|
| **Agent Hub** | [Chat App & Extension](../chat-app/ui-chat-extension.md) | [Agent Studio](ui-agent-studio.md): cấu hình agent, cộng với Vận hành (tài liệu này) |
| **Worker** | Không có. Member chỉ thấy tiến độ job trong Chat | Agent Studio › Vận hành › Jobs & Worker |

> ℹ️ **tenant_admin** không vào Studio. Họ xem chi phí và quota của tenant mình ở màn **Chi phí & quota** của Admin (`/usage`, xem [UI/UX Admin](../admin/ui-admin.md)). Màn đó không có nội dung chat.

## 2. Sitemap & nguồn dữ liệu

```
Agent Studio sidebar
├─ Tổng quan
├─ CẤU HÌNH AGENT   Agents · Coordinator · Tools · Models · Secrets
├─ THỬ NGHIỆM       Playground
├─ VẬN HÀNH   ◀── tài liệu này
│  ├─ Runs                    /studio/ops/runs          · /studio/ops/runs/:id
│  ├─ Chi phí & usage         /studio/ops/usage
│  └─ Jobs & Worker           /studio/ops/jobs?tab=queue|workers|pool
└─ HỆ THỐNG         Nhật ký thay đổi · Import/Export
```

> ℹ️ **Nguồn dữ liệu:** Studio được Hub phục vụ ở `/studio` (cùng origin), nên gọi thẳng API của Hub bằng JWT của `platform_admin`. Không cần CORS.

| Endpoint Hub (mới hoặc mở rộng) | Dùng cho |
|---|---|
| `GET /admin/runs?from&to&tenant&user&kind&status&agent&provider&billing&q&cursor` | Danh sách run |
| `GET /admin/runs/:id` (kèm steps, jobs, usage) | Trace chi tiết |
| `POST /admin/runs/:id/cancel` | Huỷ run đang chạy |
| `GET /admin/usage?from&to&tenant&group_by=day\|tenant\|feature\|provider\|agent\|user\|billing` | Dashboard chi phí. Trả cả `cost_usd` và `billable_usd` |
| `GET /admin/jobs?status&type&tenant` · `POST /admin/jobs/:id/retry\|cancel` | Hàng đợi |
| `GET /admin/workers` | Worker và heartbeat |
| `GET /admin/providers/state` · `POST /admin/providers/:key/probe` | Subscription pool (theo provider) |
| `GET /admin/providers/tenant-slots` | Slot subscription theo tenant: đang chạy, đang chờ, giới hạn `max_concurrent_sub` |

## 3. Runs — danh sách

[[WF agent-hub/ui-operations.html#1]]

- **Live**: bật thì tự thêm run mới vào đầu bảng (poll 5 giây) và cập nhật trạng thái các run đang chạy. Tự dừng Live khi admin đang cuộn xuống hoặc đang lọc theo khoảng thời gian trong quá khứ.
- Filter **Tenant** đứng đầu hàng filter, mặc định "Tất cả tenant". Cột *Tenant* hiện key của tenant (vd. `acme`).
- Cột *Chi phí* là `cost_usd` (chi phí thật). Run chạy bằng subscription có chi phí $0, kèm nhãn sub. Tooltip ghi rõ provider và `billing`.
- Cột *Thu* là `billable_usd` (số thu của tenant). Run subscription vẫn có số thu, vì tính theo token × đơn giá bán. Chưa có đơn giá trong `price_book` thì hiện "chưa định giá".
- Run nằm trong phần vượt quota tháng của tenant có nhãn overage cạnh số thu. Run vẫn chạy bình thường.
- Cột *Yêu cầu* chỉ hiện 60 ký tự đầu. Command hiện bằng font mono. Nội dung đầy đủ xem trong trace.
- Trạng thái dùng icon cộng chữ (✓ ok · ⟳ running · ✕ mã lỗi · ⊘ cancelled), không chỉ dựa vào màu.
- Click một hàng thì mở trang trace. Filter lưu trên URL để gửi link cho người khác.
- Phân trang bằng cursor ("Tải thêm"). Mặc định xem 24 giờ gần nhất.

## 4. Run — trace chi tiết

[[WF agent-hub/ui-operations.html#2]]

*Hình 4.1: dòng thời gian dạng waterfall, dùng một trục thời gian chung. Step dự phòng được tô vân chéo (không chỉ khác màu) và có nhãn lý do.*

- Waterfall lồng theo cấp: Coordinator → agent → step con. Click một hàng thì panel bên phải hiện Input/Output/Raw. Input đã được che secret (hiện `••••`).
- Hover một đoạn trên thanh thì tooltip hiện: tên step, bắt đầu và kết thúc (ms tính từ lúc run bắt đầu), provider, token.
- Run đang chạy thì trace cập nhật trực tiếp qua SSE `/runs/:id/events`, header có nút [Huỷ run] (modal xác nhận mức vừa).
- Run lỗi thì hiện khối lỗi ngay đầu trang, gồm mã lỗi, thông điệp, gợi ý, và link tới step gây lỗi.
- **Mở trong Playground**: mở Playground của Studio với câu hỏi và file đã điền sẵn, để tái hiện lỗi.
- Dữ liệu input/output quá 30 ngày đã bị xoá (theo HUB-NFR-05). Khi đó panel ghi "Nội dung đã hết hạn lưu trữ, chỉ còn metadata".

## 5. Chi phí & usage

[[WF agent-hub/ui-operations.html#3]]

*Hình 5.1: một hàng KPI, một biểu đồ cột chồng theo ngày (một trục, chỉ đơn vị $), hai biểu đồ phụ và bảng theo tenant. Màu gắn cố định theo provider, không đổi khi lọc.*

**Hai con số tiền.** Mọi chỗ trong mục này tách rõ:

- `cost_usd`: chi phí thật hệ thống phải trả cho provider API. Subscription = 0.
- `billable_usd`: số thu của tenant = token vào/ra × đơn giá bán trong `hub.price_book`. Tính cho cả API và subscription.

| Khối | Câu hỏi nó trả lời | Dạng | Đặc tả |
|---|---|---|---|
| KPI row | Tháng này tốn bao nhiêu, thu bao nhiêu, tăng hay giảm? | 6 stat tile: Chi phí thật · Số thu · Tổng token · Tỉ lệ qua subscription · Số run · Tỉ lệ lỗi | Giá trị kèm delta so với kỳ trước cùng độ dài. Tile chi phí có sparkline. Delta dùng chữ (▲▼) và màu chữ trung tính. Không tô xanh hay đỏ, vì chi phí tăng chưa chắc là xấu |
| Chi phí theo ngày | Tiền đi vào provider nào, ngày nào tăng vọt? | Cột chồng (stacked bar) | Chỉ tính `cost_usd` (tức chi phí API). Tối đa 4 provider có tên, phần còn lại gộp vào "Khác" (xám). Hover theo từng cột thì tooltip liệt kê từng provider và tổng. Có legend |
| Token theo cách tính phí | Đang tận dụng subscription tốt chưa? | Thanh 100% (2 phần) | Ghi tỉ lệ và số tuyệt đối ngay trên nhãn. Kết hợp với KPI "Tỉ lệ qua subscription" |
| Theo tenant / feature / agent / user / command | Ai hoặc cái gì tốn nhất? | Thanh ngang xếp hạng, 1 màu | Top 5 rồi đến "Khác (n)". Nhãn giá trị luôn hiện. Bộ chip đổi chiều phân tích. Công tắc đổi số đo giữa Chi phí thật và Số thu. Click một thanh thì áp filter đó cho toàn trang |
| Bảng theo tenant | Tenant nào tốn, thu được bao nhiêu? | Bảng | Cột: tenant, số run, token, chi phí thật, số thu, phần overage. Sắp theo số thu. Click một hàng thì lọc cả trang theo tenant đó |
| Xem dạng bảng | Cần số chính xác, cần copy | Bảng | Mỗi biểu đồ có một bảng tương đương. Export CSV theo filter hiện tại |

> ℹ️ **Cách tính chi phí:** `cost_usd` lấy từ `usage_logs` (Hub ước tính theo bảng giá của từng provider và model). Tooltip của KPI ghi "Ước tính theo bảng giá niêm yết, có thể lệch với hoá đơn thật". `billable_usd` tính theo đơn giá của `hub.price_book` có hiệu lực lúc chạy. Run chưa có đơn giá vẫn đếm token, số thu hiện "chưa định giá" và không cộng vào KPI Số thu.

- Filter **Tenant** áp dụng cho cả trang. Chọn một tenant thì KPI có thêm dòng nhỏ về quota tháng (vd. "68% quota token"), lấy từ `admin.tenant_quotas`. Tenant không đặt quota (mặc định) thì ghi "Không giới hạn".
- Dify workflow không có metadata token thì chỉ đếm số run và thời gian, không vào biểu đồ token.

## 6. Jobs & Worker

[[WF agent-hub/ui-operations.html#4]]

- **Subscription pool** là tab mặc định khi có provider không ổn. Slot vẽ thành các ô vuông, kèm chữ "1/2" để không phải đếm ô.
- **Cooldown** hiện đồng hồ đếm ngược, kèm giờ reset tuyệt đối trong ngoặc.
- **Slot theo tenant**: tab pool có thêm bảng "Slot subscription theo tenant" dưới bảng provider. Cột: tenant, đang chạy, đang chờ, giới hạn (`tenants.max_concurrent_sub`; null hiện "∞ không giới hạn"). Tenant chạm giới hạn thì có nhãn "đủ slot": job mới của tenant đó chờ hoặc dự phòng sang API (theo Worker), tenant khác không bị ảnh hưởng.
- Giới hạn slot sửa ở Admin › Tenants (`/tenants/:id`). Ở đây chỉ xem, có link [Sửa trong Admin].
- **Hướng dẫn đăng nhập** mở một Sheet chứa runbook cho CLI đó (lấy từ tài liệu Worker, mục 8): các bước SSH, lệnh cần chạy (có nút copy), rồi nút [Kiểm tra lại] để gọi probe.
- **Chạy lại** chỉ có với `workflow.async`. Với `agent.cli`, nút bị khoá kèm tooltip "Agent có thể đã làm dở việc, hãy gửi lại yêu cầu từ Chat" (theo WRK-BR-04).
- Tab Hàng đợi lọc được theo trạng thái và tenant. Click job id thì mở trace của run cha, nhảy đúng tới step đó.

## 7. Quy tắc biểu đồ (áp dụng cho toàn bộ mục Vận hành)

| Quy tắc | Chi tiết |
|---|---|
| Màu gắn theo thực thể | Mỗi provider API có một slot cố định: anthropic-api → slot 1 (xanh dương), openai-api → 2 (cam), gemini-api → 3 (ngọc), openrouter → 4 (vàng), ollama → 5 (hồng). "Khác" luôn là xám. Lọc bớt provider thì các provider còn lại *không đổi màu* |
| Bảng màu | Dùng bảng categorical đã kiểm định (8 slot, có bản riêng cho light và dark), theo thứ tự cố định, không xoay vòng. Hơn 4 series thì gộp vào "Khác". Màu trạng thái (good/warning/serious/critical) dành riêng cho trạng thái, không dùng làm màu series |
| Một trục | Không dùng biểu đồ hai trục. Chi phí ($) và token là hai biểu đồ riêng |
| Nét vẽ | Cột có đầu bo 4px, các đoạn trong cột chồng cách nhau 2px. Lưới nhạt dạng nét đứt. Nhãn và giá trị dùng màu chữ, không dùng màu series |
| Hover | Mọi biểu đồ đều có tooltip. Cột chồng hover theo cả cột. Vùng hover lớn hơn chính cái cột |
| Không chỉ dựa vào màu | Luôn có legend khi ≥ 2 series. Trạng thái luôn có icon và chữ. Bước dự phòng có vân chéo. Mọi biểu đồ có chế độ xem bảng |
| Bộ lọc | Đặt trên một hàng phía trên biểu đồ, áp dụng cho cả trang, lưu trên URL |
| Thư viện | shadcn/ui **Chart** (dựa trên Recharts). Màu khai báo bằng CSS variable trong `ChartConfig`, có bộ riêng cho dark theme |

## 8. Trạng thái, quyền, riêng tư

- **Quyền:** chỉ `platform_admin`. Hub kiểm tra role trên mọi `/admin/*`. `tenant_admin` và member không vào được Studio.
- **Riêng tư:** `platform_admin` đọc được nội dung chat của mọi tenant trong trace. `tenant_admin` không xem nội dung, chỉ xem chi phí ở Admin. Chat App có dòng thông báo cố định trong phần Cài đặt: "Quản trị nền tảng có thể xem nội dung để hỗ trợ và gỡ lỗi". Mỗi lần mở trace *của người khác* được ghi audit (`view_trace`), kèm `tenant_id` của run.
- **Rỗng:** Runs rỗng thì ghi "Chưa có run nào trong khoảng này", kèm nút [Mở rộng thời gian]. Usage rỗng thì ẩn biểu đồ và hiện tile "Chưa có dữ liệu".
- **Mất kết nối tới Hub:** Studio hiện banner "Mất kết nối, dữ liệu có thể đã cũ" và tự thử lại.
- **Song ngữ:** toàn bộ nhãn đều theo ngôn ngữ đang chọn. Số, tiền và ngày định dạng theo locale (`vi-VN`: 3.812 · 12/09. `en`: 3,812 · Sep 12). Mã lỗi (`TIMEOUT`…) giữ nguyên.

## 9. Ảnh hưởng tới tài liệu BA

| Tài liệu | Cần bổ sung |
|---|---|
| BA Agent Hub | Các endpoint ở mục 2 (đặt dưới `/studio/api/ops/*`), có filter `tenant`. `usage_logs` có `tenant_id`, `feature_id`, `billing`, `cost_usd`, `billable_usd`, `overage`. Bảng `hub.price_book`. Audit sự kiện `view_trace` kèm `tenant_id` (có thể ghi vào `admin.audit_log` qua một bảng trong schema hub) |
| BA Worker | Bảng `hub.workers` (id, host, loại job nhận, heartbeat_at, số job đang chạy). Endpoint probe theo yêu cầu. Bộ đếm slot subscription theo tenant, để endpoint `tenant-slots` đọc |
| BA Admin | `tenants.max_concurrent_sub` sửa ở màn Tenants. Màn Chi phí & quota (cho `tenant_admin`) dùng chung nguồn `usage_logs` |

## 10. Câu hỏi mở

1. Màn Chi phí & quota của Admin có hiện `cost_usd` cho `tenant_admin` không? Spec chỉ nói `platform_admin` thấy cả hai số. Tạm giả định `tenant_admin` chỉ thấy số thu và quota.
2. Run "chưa định giá": khi thêm đơn giá sau thì tính lại cho run cũ, hay chỉ áp cho run mới? Tạm chọn: tính lại khi chốt báo cáo tháng.
3. Vận hành có cần export CSV theo tenant để lập hoá đơn, hay dùng export của Admin?
