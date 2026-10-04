# Agent Studio — Đặc tả UI/UX (Agent Hub)

UI riêng của Agent Hub: cấu hình agent, Orchestrator, chọn workflow làm tool, model và provider, cấp agent cho tenant; thử nghiệm bằng Playground; vận hành

`v0.4 · draft` · `2026-10-01` · `shadcn/ui · song ngữ VI/EN` · `Đáp ứng HUB-FR-60 → 73, 77, 78, 84`

## 1. Vai trò & nguyên tắc

**Agent Studio** là nơi `platform_admin` thiết kế cách hệ thống *suy nghĩ và hành động*: có những agent nào, mỗi agent dùng model gì và được dùng workflow nào, Orchestrator chọn agent ra sao, tenant nào được dùng agent nào. Studio được Hub phục vụ tại `/studio`, dùng chung design system (shadcn) và chung phiên đăng nhập với Admin UI. Chỉ `platform_admin` vào được. `tenant_admin` cấp agent cho group trong Admin (trang Groups), không vào Studio.

| # | Nguyên tắc | Thể hiện |
|---|---|---|
| S1 | **Thấy điều LLM thấy** | Mô tả agent, tool (lấy từ workflow) và prompt của Orchestrator đều có nút "Xem như model thấy", hiện đúng phần text và JSON schema sẽ gửi cho model. Chất lượng định tuyến phụ thuộc gần như hoàn toàn vào phần này |
| S2 | **Thử trước khi tin** | Workflow có nút Chạy thử. Agent có Test panel. Orchestrator có Dry-run định tuyến. Toàn hệ thống có Playground. Tất cả đều chạy được trên *bản nháp* chưa lưu |
| S3 | **Trạng thái thật ngay tại chỗ** | Chỗ nào chọn provider hay profile là chỗ đó hiện trạng thái sống (ok/cooldown/logged_out) và ghi "lúc này sẽ chạy bằng …" |
| S4 | **Workflow ở Admin, agent ở Studio** | Workflow là catalog dùng chung của Admin: Studio chỉ *chọn*, không tạo, không đặt tên, không viết lại mô tả. Không có ô nào tham chiếu command. Mọi cấu hình còn lại của agent thuộc Studio |
| S5 | **Cùng ngôn ngữ thiết kế với Admin** | Dùng lại khung, DataTable, SecretField, TestPanel, ConfirmDialog, audit và phím tắt của [UI/UX Admin](../admin/ui-admin.md) (mục 4–6, 9–12, 14–15). Tài liệu này chỉ đặc tả phần riêng |

## 2. Kiến trúc thông tin

```
Agent Studio  (/studio · role=platform_admin)
├─ Tổng quan                          /studio
├─ CẤU HÌNH AGENT
│  ├─ Agents                          /studio/agents        · /new · /:id
│  ├─ Orchestrator                     /studio/orchestrator   (một trang, singleton)
│  ├─ Tools                           /studio/tools         · /:workflow_id  (catalog workflow của Admin, chỉ đọc)
│  ├─ Models                          /studio/models?tab=providers|profiles|prices
│  └─ Secrets                         /studio/secrets       (drawer)
├─ TRUY CẬP
│  └─ Quyền agent                     /studio/access        (entitlement agent × tenant)
├─ THỬ NGHIỆM
│  └─ Playground                      /studio/playground
├─ VẬN HÀNH                           (đặc tả: ui-operations.html)
│  ├─ Runs · Chi phí & usage · Jobs & Worker
└─ HỆ THỐNG
   ├─ Nhật ký thay đổi                /studio/audit
   └─ Import / Export                 /studio/transfer
```

Menu xếp theo thứ tự thiết kế một agent: chọn workflow ở *Tools* → gắn vào *Agents* → chỉnh *Orchestrator* → cấp cho tenant ở *Quyền agent* → thử ở *Playground*. Trên menu, Agents đứng đầu vì được mở nhiều nhất.

> ✅ **Canvas đã duyệt hướng (2026-10-04):** 6 artboard ở [`canvas/`](canvas/README.md) (Agents, Agent editor, Orchestrator, Models, Quyền agent, Playground) — đầu vào mốc H4.

## 3. Khung ứng dụng

[[WF agent-hub/ui-agent-studio.html#1]]

*Hình 3.1: khung giống Admin UI, khác ở logo "✦ Agent Studio" và màu nhấn của logo, để admin biết mình đang ở app nào. Badge ở Runs là số run đang chạy, badge ở Models là số provider cần xử lý.*

- **Nút chuyển app "⇄ Admin"** ở topbar, dùng chung phiên (JWT). Chưa đăng nhập thì Studio chuyển sang trang đăng nhập (gọi `Admin /auth/login`) rồi quay lại `/studio`.
- User không phải `platform_admin` mở `/studio` thì thấy trang "Bạn không có quyền vào Agent Studio" kèm nút về Chat App. Nút "⇄ Agent Studio" trong Admin chỉ hiện cho `platform_admin`.
- Badge `hub config vN` là version riêng của cấu hình Hub, tách khỏi `config vN` của Admin.

## 4. Tổng quan

[[WF agent-hub/ui-agent-studio.html#2]]

- Card **Cần chú ý** gom mọi thứ cần xử lý: provider hỏng, agent lỗi nhiều, workflow được gắn không kết nối được, agent đang bật nhưng chưa cấp cho tenant nào. Không có gì thì hiện "✓ Mọi thứ ổn".
- Card **Định tuyến** cho biết Orchestrator chọn agent có hợp lý không. Tỉ lệ "hỏi lại" cao là dấu hiệu mô tả agent chưa rõ. Click một dòng thì mở Runs đã lọc theo agent đó.

## 5. Agents

### 5.1 Danh sách

[[WF agent-hub/ui-agent-studio.html#3]]

- Cột **Profile · đang chạy bằng** hiện bước của profile sẽ được dùng *ngay lúc này*. Bước đó là dự phòng thì badge màu cam.
- Cột **Workflow** là số workflow được gắn. Cột **Tenant** là số tenant có entitlement. Bằng 0 thì badge "Chưa cấp": không user nào dùng được agent này. Click thì mở Quyền agent đã lọc theo agent.
- Cột **24 giờ** gồm số run và tỉ lệ lỗi (lấy từ Vận hành). Lỗi ≥ 10% thì có badge cảnh báo. Click vào thì mở Runs đã lọc theo agent.
- Menu `⋯` có: Nhân bản, Thử trong Playground, Cấp cho tenant…, Bật/Tắt, Xoá.

### 5.2 Editor

[[WF agent-hub/ui-agent-studio.html#4]]

| Tương tác | Hành vi |
|---|---|
| Đổi runtime | Bước ② và ③ thay đổi theo runtime: <br>• `llm`: profile, prompt, workflow được gắn.<br>• `dify-workflow`: chọn đúng một workflow loại `workflow` từ catalog, không có profile. Agent là lớp mỏng quanh workflow.<br>• `dify-agent`: chọn một workflow loại `agent` từ catalog.<br>• `agentic-cli`: như hình. Trường không còn áp dụng thì ẩn đi nhưng giữ giá trị đến khi lưu |
| Chọn workflow | Ô ③ mở picker catalog: tìm theo key/tên, lọc loại app, mỗi dòng có mô tả và nút "Xem như model thấy". Chỉ hiện workflow đang bật. Không có ô đặt tên hay viết mô tả |
| Xem như Orchestrator thấy | Popover hiện đúng đoạn Orchestrator nhận về agent này: `- dev-helper: Dùng khi…`, kèm danh sách các agent khác để admin so sánh xem mô tả có bị trùng ý không |
| Chọn Bash | Cảnh báo inline và bắt tick "Tôi hiểu agent chạy được lệnh hệ thống trên máy Worker" |
| Chạy thử | Gọi thẳng agent (bỏ qua Orchestrator) bằng bản nháp. Mặc định mở tab Trace. Đổi được profile cho lượt thử mà không lưu |
| Lưu agent mới | Lưu xong mà agent chưa cấp cho tenant nào thì toast nhắc "Chưa tenant nào dùng được agent này" kèm nút [Cấp cho tenant…] |
| Tắt agent | Toast có Hoàn tác, kèm nhắc: "Orchestrator sẽ không còn chọn agent này. Các yêu cầu tương tự sẽ được chat tự trả lời" |

## 6. Orchestrator

[[WF agent-hub/ui-agent-studio.html#5]]

- **Orchestrator là một agent được chọn** (CR-020; thay cho "trang singleton riêng"). Trang `/studio/orchestrator` chọn agent làm Orchestrator + `max_steps`, ngân sách, `history_n`, `on_no_match`. Agent đó hiện trong danh sách Agents kèm badge "Orchestrator", không tắt/xoá được khi đang được chọn (HUB-BR-08); đổi bằng chọn agent khác hoặc nút [Đặt làm Orchestrator] ở editor agent. Đổi Orchestrator = thay đổi định tuyến → chạy bộ câu kiểm thử (bên dưới). Orchestrator không nằm trong danh sách delegate; chạy CLI thì không tool, không MCP.
- **Orchestrator theo tenant** (CR-032, mốc H4): trang có thêm danh sách **"Orchestrator theo tenant"** (tenant · agent · max_steps · cập nhật · [Sửa] [Xoá]) và nút [+ Thêm cho tenant…]. Dòng đầu luôn là **Mặc định (toàn hệ thống)**, không xoá được. Form bản tenant có đúng các trường của bản mặc định (agent, `max_steps`, ngân sách, `history_n`, `on_no_match`) + công tắc "Kế thừa bộ câu kiểm thử chung". Xoá bản tenant thì tenant quay về mặc định (có xác nhận). Chỉ `platform_admin`; `tenant_admin` không thấy. Hub chọn bản riêng của tenant trước, không có thì mặc định (HUB-FR-62, HUB-BR-08).
- **Runtime mặc định `llm`/model rẻ** (CR-025: mọi tin đều qua Orchestrator). Chọn agent runtime `agentic-cli` làm Orchestrator thì hiện cảnh báo: "Chậm: mỗi quyết định khởi động CLI vài giây và chiếm slot subscription".
- **Agent Orchestrator nhìn thấy:** trang này và Dry-run dùng toàn bộ agent đang bật. Khi chạy thật, mỗi user chỉ đưa cho Orchestrator các agent user đó được dùng (HUB-FR-77). Muốn xem theo một user thì dùng Playground với "Chạy như user".
- **Phát hiện mô tả trùng ý:** khi hai agent có mô tả quá giống nhau thì hiện badge cảnh báo. Có thể so bằng embedding, hoặc đơn giản là so trùng từ khoá ở v1.
- **Bộ câu kiểm thử định tuyến** (MUST, HUB-FR-73): tab "Kiểm thử" ngay trong trang Orchestrator, gồm bảng các câu (nội dung, agent mong đợi, kết quả lần chạy gần nhất). Thêm câu bằng tay, hoặc từ nút [+ Lưu làm câu kiểm thử] ở Dry-run, Playground và Runs. Bộ câu chạy với toàn bộ agent, không lọc theo quyền. Bộ câu gắn theo Orchestrator: bản mặc định dùng bộ chung, bản của tenant có bộ riêng (tab Kiểm thử hiện theo bản đang mở). Mỗi câu chạy 3 lần lấy đa số (HUB-FR-73, CR-034).
- **Tự chạy khi lưu:** bấm Lưu ở Orchestrator, hoặc lưu/bật/tắt/xoá một agent, thì nút Lưu chuyển thành "Đang kiểm thử định tuyến… 6/9" (mỗi câu chạy 3 lần lấy đa số, các câu chạy song song, tối đa khoảng 60 giây). Kết quả:
  - `✓ 8/9 (baseline 9/9, sai số cho phép 1 câu)`: lưu, và toast ghi "Đã lưu · định tuyến 9/9".
  - `✕ 7/9 (thấp hơn baseline 9/9 quá 1 câu)`: **không lưu**. Mở modal liệt kê từng câu sai (mong đợi → thực tế, kèm lý do Orchestrator đưa ra). Có các nút [Sửa tiếp], [Chỉnh câu kiểm thử…] và [Lưu đè…] (nhập lý do bắt buộc, ghi audit). Chỉnh hay xoá câu kiểm thử phải ghi lý do, và việc đó được đưa vào audit.
- Bộ câu rỗng thì không chặn, nhưng hiện gợi ý "Thêm vài câu kiểm thử để tránh làm hỏng định tuyến". Mỗi lần kiểm thử đều gọi model thật, nên chi phí được tính vào Vận hành với nhãn `routing-test`.

## 7. Tools (chọn workflow từ catalog Admin)

Tool của agent là một **workflow trong catalog dùng chung của Admin**. Studio không tạo tool và không viết mô tả cho model. Hub dùng luôn tên (sinh từ key workflow), mô tả và mô tả tham số của workflow làm tool. Vì vậy mô tả "khi nào dùng" và mô tả từng tham số được viết một lần, khi tạo workflow ở Admin (bắt buộc).

[[WF agent-hub/ui-agent-studio.html#6]]

- **Trang Tools là catalog chỉ đọc:** bảng workflow của Admin (key, tên tool, loại app, mô tả, agent đang dùng). Bộ lọc: loại app, "Đã gắn cho agent" / "Chưa gắn". Chọn một dòng thì bên phải hiện chi tiết.
- **Xem như model thấy:** JSON tool đúng như model nhận (tên, mô tả, JSON schema với mô tả tham số), lấy từ workflow. Không sửa được tại đây.
- **Chạy thử:** nhập input mẫu và chạy workflow qua Hub, xem kết quả và thời gian. Dùng để kiểm tra trước khi gắn cho agent.
- **Gắn cho agent:** nút [Gắn cho agent… ▾] ngay ở trang này, hoặc chọn trong bước ③ của Agent editor. Cả hai đều ghi vào `hub.agent_workflows`.
- **Sửa ở Admin ↗:** muốn đổi mô tả, tham số, app-key hay tắt workflow thì mở trang workflow đó trong Admin. Sửa xong, Studio thấy bản mới trong ≤ 5 giây. Admin chặn xoá hay tắt workflow đang được agent dùng.
- **Chỉ qua Dify** (HUB-BR-12): catalog chỉ gồm app Dify. Muốn agent gọi hệ thống nội bộ thì tạo một workflow Dify có HTTP node (bằng Claude session), rồi thêm vào catalog ở Admin.
- Tham số kiểu `file` được Hub tự nối với file đính kèm của run. Model chỉ truyền tham chiếu, không truyền nội dung file.

## 8. Models — Providers, Profiles, Đơn giá

[[WF agent-hub/ui-agent-studio.html#7]]

| Tab | Nội dung |
|---|---|
| Providers | Bảng: key, loại (`API` / `Subscription`), hãng, trạng thái sống, slot đang dùng/tổng, cooldown đến. Sửa trong Sheet. Loại API có SecretField và [Kiểm tra key]. Loại subscription có `max_concurrency`, hướng dẫn đăng nhập CLI (lấy từ runbook Worker) và [Kiểm tra lại]. Subscription dùng chung cho mọi tenant; giới hạn slot theo tenant đặt ở Admin (`tenants.max_concurrent_sub`) |
| Profiles | Danh sách profile bên trái, StepsEditor kéo-thả bên phải. Dòng tóm tắt luôn nói *lúc này* profile sẽ chạy bằng bước nào. Profile toàn subscription (không có bước API) thì cảnh báo |
| Đơn giá | Bảng `price_book`: provider, model, giá bán vào/ra (USD / 1 triệu token), hiệu lực từ. Thêm dòng mới thay vì sửa dòng cũ, để báo cáo cũ không đổi. Model đang được dùng mà chưa có đơn giá thì badge "Chưa có giá" (token vẫn được ghi, tính sau) |

## 9. Quyền agent

Agent có hai tầng quyền, giống feature. Studio làm tầng đầu: **entitlement** (tenant nào được có agent nào). Tầng sau là **grant** (group/user nào trong tenant được dùng): `tenant_admin` làm ở Admin › Groups. Studio chỉ xem grant.

[[WF agent-hub/ui-agent-studio.html#8]]

- **Ma trận agent × tenant:** mỗi ô là một công tắc entitlement. Ô đang bật hiện số grant trong tenant (ví dụ "2 group"). Lọc theo agent hoặc tenant. Tenant `platform` là một cột như mọi tenant khác.
- **Click một ô** thì mở drawer: ngày cấp, người cấp, và danh sách grant trong tenant đó (group/user, do ai cấp). Drawer chỉ xem grant, có dòng nhắc "Grant do tenant_admin cấp trong Admin › Groups".
- **Thu hồi entitlement:** ConfirmDialog ghi rõ "N grant trong tenant `acme` sẽ mất hiệu lực. Grant được giữ lại và tự có hiệu lực khi cấp lại". Hiệu lực ≤ 5 giây, run đang chạy vẫn xong.
- Mọi thay đổi ghi audit và tăng `hub config vN`. Không chạy bộ câu kiểm thử định tuyến (bộ câu luôn dùng toàn bộ agent).
- Cột agent đang tắt hiện mờ: entitlement vẫn giữ nhưng không ai dùng được cho tới khi bật lại.

## 10. Playground

[[WF agent-hub/ui-agent-studio.html#9]]

- Dùng lại chính component chat của Chat App (`packages/ui-chat`), nên thấy đúng những gì người dùng cuối thấy. Bên phải có thêm trace.
- **Đích:** toàn hệ thống (qua Orchestrator) hoặc một agent cụ thể.
- **Dùng bản nháp chưa lưu:** áp các thay đổi chưa lưu của agent, workflow được gắn và Orchestrator vào lượt thử, để thử trước khi áp dụng cho mọi người.
- **Chạy như user**: mặc định là chính admin. Chọn tenant rồi chọn user. Lượt thử áp đúng quyền command và agent của user đó: Orchestrator chỉ thấy agent user được dùng, và "Một agent ▾" chỉ liệt kê các agent đó. Chỉ dùng để tái hiện ngữ cảnh (không truy cập được dữ liệu riêng của người khác) và có ghi audit.
- Run trong Playground được gắn nhãn `playground` trong Runs, tính chi phí riêng (không tính vào quota hay số thu của tenant) và không tính vào thống kê định tuyến.

## 11. Secrets, Nhật ký, Import/Export

Giống hệt mẫu của Admin ([UI/UX Admin](../admin/ui-admin.md#s7), mục 7.8, 7.10, 7.11), chỉ khác phạm vi:

- **Secrets:** chỉ API key của provider. Mã hoá bằng `HUB_SECRETS_KEY`. Chỉ ghi, không đọc lại. App-key của workflow là secret của Admin.
- **Nhật ký:** thay đổi của agent, workflow được gắn, Orchestrator, entitlement agent, provider, profile, đơn giá và secret, có diff và khôi phục. Có thêm các sự kiện `view_trace` (kèm tenant) và `playground_run_as`.
- **Import/Export:** file `hub-config-v18.yaml` gồm agents (kèm key các workflow được gắn), orchestrator, providers, profiles. `platform_admin` dùng file này để Claude session sinh hoặc sửa cấu hình agent hàng loạt, rồi import có xem diff. Key workflow không có trong catalog Admin thì import báo lỗi dòng đó.

## 12. Luồng thao tác chính

### F1. Tạo agent mới từ một workflow Dify

```
Claude session tạo workflow trên Dify → lấy app key
  → Admin › Workflows › + Tạo: dán key → [Lấy từ Dify]
      viết mô tả "khi nào dùng" + mô tả từng tham số (bắt buộc) → Lưu (nhãn "Chưa gắn")
  → Studio › Tools: tìm workflow vừa tạo → [Xem như model thấy] → [▶ Chạy thử] ✓
  → Agents › + Tạo agent: key, mô tả "Dùng khi… Không dùng khi…"
      runtime llm + profile, ③ chọn workflow từ catalog → [▶ Chạy thử] ✓ → Lưu
  → Orchestrator › Dry-run 2–3 câu ví dụ → thấy chọn đúng agent mới → lưu các câu đó làm câu kiểm thử
  → Quyền agent: bật entitlement cho các tenant cần dùng
      (tenant_admin của từng tenant cấp cho group ở Admin › Groups)
  → Playground: chạy như một user đã được cấp → thử end-to-end → xong
```

### F2. Orchestrator chọn sai agent

```
Tổng quan: tỉ lệ "hỏi lại" tăng, hoặc user báo sai
  → Runs › lọc run đó › xem bước Orchestrator (lý do chọn)
  → sửa mô tả agent (hoặc prompt Orchestrator) → Dry-run câu đó
  → [+ Lưu làm câu kiểm thử] cho câu bị sai → Lưu (bộ kiểm thử tự chạy, chặn nếu tỉ lệ đúng giảm)
```

Nếu model chọn sai *tool* (không phải agent) thì sửa mô tả workflow ở Admin.

### F3. Provider hết phiên đăng nhập

```
Badge ở Models / Cần chú ý: "gemini-sub logged_out"
  → [Hướng dẫn] mở Sheet runbook (SSH vào Worker, chạy lệnh login, có nút copy)
  → [Kiểm tra lại] → ok. Trong lúc chờ, các profile tự dự phòng sang API
```

### F4. Đổi model cho cả nhóm agent

```
Models › Profiles › smart › kéo anthropic-api lên đầu hoặc đổi model id → Lưu
  → mọi agent dùng "smart" đổi theo ngay, không phải sửa từng agent
```

### F5. Mở agent cho một tenant mới

```
Admin › Tenants: tạo tenant "acme" (entitlement feature, quota, slot subscription)
  → Studio › Quyền agent: lọc tenant acme → bật hoadon, chat
  → tenant_admin của acme: Admin › Groups › ke-toan › cấp hoadon
  → user trong ke-toan chat "kiểm tra hoá đơn…" → Orchestrator chọn được hoadon
```

## 13. Validation & trạng thái

| Trường | Luật | Câu báo lỗi |
|---|---|---|
| Key agent | `^[a-z0-9-]{2,32}$`, không trùng | "Key đã được dùng bởi agent khác" |
| Mô tả agent | 20–400 ký tự | "Mô tả quá ngắn, model sẽ khó chọn đúng" |
| Workflow gắn cho agent | Có trong catalog, đang bật, tên sinh từ key hợp lệ `^[a-z][a-z0-9_]{2,40}$`, có mô tả và mô tả tham số | "Workflow thiếu mô tả hoặc đang tắt. Sửa ở Admin trước khi gắn" |
| Agent runtime `llm` | Phải có profile | "Chọn model profile" |
| Agent runtime `dify-workflow` | Đúng một workflow loại `workflow` | "Chọn workflow cho agent" |
| Profile | ≥ 1 bước, bước cuối không có điều kiện chuyển | "Profile cần ít nhất 1 bước" |
| Xoá profile, provider, secret | Không được xoá khi đang được dùng | Hộp xác nhận hiện danh sách "Được dùng bởi" |
| Gỡ workflow khỏi agent | Được phép. Nếu là workflow duy nhất của agent `dify-workflow`/`dify-agent` thì phải chọn workflow khác trước | "Agent cần một workflow" |
| Thu hồi entitlement | Được phép, bắt xác nhận | Hộp xác nhận nêu số grant sẽ mất hiệu lực |
| Đơn giá | Giá ≥ 0, `effective_from` không trùng với dòng khác của cùng provider + model | "Đã có đơn giá hiệu lực từ ngày này" |
| Orchestrator | Phải chọn một agent đang bật có profile hợp lệ (CR-020), max_steps từ 1 đến 10 | "Số bước tối đa từ 1 đến 10" |

Trạng thái đang tải, rỗng, lỗi, xung đột và mất kết nối dùng chung quy ước với Admin (UI/UX Admin, mục 9). Riêng trang rỗng:

- **Agents rỗng:** "Chưa có agent nào. Orchestrator sẽ tự trả lời mọi câu hỏi." kèm nút [+ Tạo agent đầu tiên].
- **Tools rỗng:** "Catalog chưa có workflow nào. Workflow được tạo ở Admin." kèm nút [Mở Admin › Workflows ↗].
- **Quyền agent rỗng:** "Chưa cấp agent cho tenant nào. User chỉ chat được với Orchestrator." 

## 14. Truy vết & câu hỏi mở

| Màn hình | Đáp ứng |
|---|---|
| 5 Agents | HUB-FR-60, 61 · HUB-BR-09 |
| 6 Orchestrator | HUB-FR-62, 63, 73 · HUB-BR-08, 13 |
| 7 Tools | HUB-FR-64, 65 · HUB-BR-09, 10, 11, 12 |
| 8 Models | HUB-FR-66, 67, 84 |
| 9 Quyền agent | HUB-FR-77, 78 · HUB-BR-17 |
| 10 Playground | HUB-FR-70 |
| 11 Secrets / Nhật ký / Import-Export | HUB-FR-68, 69, 71 |
| Khung, đăng nhập | HUB-FR-72 |

### Đã chốt

- Chỉ `platform_admin` vào Agent Studio. Không có role `builder` riêng. `tenant_admin` không vào Studio.
- Studio cấp agent cho tenant (entitlement). `tenant_admin` cấp agent cho group/user trong Admin › Groups.
- Tool của agent là workflow trong catalog Admin. Studio chỉ chọn, không tạo tool và không viết mô tả cho model.
- Bộ câu kiểm thử định tuyến tự chạy mỗi lần lưu thay đổi định tuyến, chạy với toàn bộ agent, và chặn lưu nếu tỉ lệ đúng giảm.
- Tool chỉ đi qua Dify, không có loại `http`.

### Câu hỏi mở

1. `platform_admin` có cần cấp grant (group/user) thay `tenant_admin` ngay trong Studio không? Tạm: không, Studio chỉ xem grant.
2. Tab Đơn giá đặt ở Models (tạm chọn) hay ở Vận hành › Chi phí?
3. Workflow dùng làm tool không có sync/async và timeout riêng. Tạm: gọi đồng bộ, timeout theo agent (xem câu hỏi mở 7 của BA Agent Hub).
