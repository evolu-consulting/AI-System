# Mô hình Flow chuẩn (đích) — nền cho các CR sau

Trạng thái: **Đề xuất 2026-11-06**, chờ người dùng chốt mục H. Không code. Thay thế mô hình "khe + luật định tuyến" (ADR-0035, ADR-0036) khi được chốt ⇒ cần ADR mới.
Nguồn ý người dùng: CR-120 ("flow là xương sống mọi app; flow động"), chat 2026-11-06 (trigger theo sự kiện, nhất quán, If/else, tenant admin sửa được), Luật GỐC 1–3 (`CLAUDE.md:18-22`).

Từ vựng (một khái niệm = một tên): **Quy trình** (UI) = **Flow** (code) · **Node** = một ô trên sơ đồ · **Sự kiện** = việc xảy ra trong app làm flow chạy · **Dữ kiện** (code `facts`) = các trường nghiệp vụ của bản ghi mà flow đọc được · **Lượt chạy** = run · **Thư viện** = flow của platform · **Bản công ty** = flow do công ty sở hữu.

---

## A. Mô hình

**Flow** = một sơ đồ node bắt đầu bằng đúng **một node Bắt đầu khi (trigger)** và kết thúc ở ≥ 1 **node Kết thúc**. Sự kiện app khớp trigger ⇒ mở một lượt chạy. Flow dài ngắn tuỳ ý (≤ 20 bước, như cr121-d R4).

**Một định dạng: `FlowDef`** — cùng một kiểu cho flow Thư viện, bản công ty, mẫu chạy thử; một trình sửa, một engine.

| Trường | Ý nghĩa |
|---|---|
| `key`, `name`, `app` | định danh, tên nghiệp vụ, app sở hữu (`contracts`, `community`…) |
| `owner` | `library` (tenant_id null) hoặc `company` (tenant_id) |
| `trigger` | `{event, when?}` — sự kiện trong danh mục của app + điều kiện trên dữ kiện (mục C) |
| `stages[]` | **định dạng stage hiện có của engine** (`step`, `executor`, `after`) + 2 trường mới: `next_step` (nhánh đi tiếp tới bước gộp), `outcome` cho node Kết thúc |
| `source` | chỉ bản công ty: `{flow_key, version}` bản Thư viện đã sao (giữ `source_ref` + `source_rel_version` hiện có) |
| `version` | số bản xuất bản; nháp không có số |

Giữ `stages` làm định dạng duy nhất vì engine đã chạy nó, canvas đã vẽ nó (nhánh, song song, gộp) [brief: hub-processes.ts:135; `docs/current/engine/flow-engine.md` §1–3]. Bỏ `slot_body` và `Flow` riêng của contracts.

**Vòng đời**

```
Nháp ──Xuất bản──► vN (bất biến) ──Bật cho công ty──► Đang bật (lượt mới dùng bản xuất bản mới nhất)
  ▲                    │                                    │
  └──── sửa tiếp ◄─────┘                        Tắt ⇒ "Đang tắt · <lý do>"
Lượt chạy luôn chụp snapshot bản lúc bắt đầu ⇒ sửa/xuất bản không đổi lượt đang chạy [ADR-0017 bài 5; flow-engine.md §1]
```

**Danh sách flow của công ty** (`company_flows`: tenant, flow, `enabled`, `position`) là **nguồn duy nhất** cho "công ty chạy flow nào". Một dòng trỏ tới flow Thư viện (chỉ xem, theo bản Thư viện mới nhất — như hành vi gán hiện nay, `thu-vien-quy-trinh.md` "Nháp, xuất bản") hoặc tới bản công ty (sửa được). Thay cho `process_tenant_defs` + `process_routings` + `process_routing_rules` + `process_slots`.

**Sao chép** (giữ quyết định cr121-c Q1/Q9): flow Thư viện mở chỉ xem + nút "Sao chép cho công ty này" ⇒ tạo bản công ty **cùng định dạng**, ghi "Sao từ <tên> · vN", **thay đúng dòng** đang trỏ bản Thư viện đó (giữ vị trí), một transaction, bấm lần hai trả bản đã có. Mã phòng ban trong bản Thư viện đổi thành Group của công ty lúc sao (giữ luật hiện có "mã Group → id theo tenant"); thiếu phòng ⇒ lỗi nói rõ phòng nào + cách sửa.

**Ai sửa gì**

| Vai | Thư viện | Bản công ty | Danh sách flow công ty | Lượt chạy |
|---|---|---|---|---|
| platform_admin | tạo, sửa, xuất bản, tắt | của mọi công ty | mọi công ty | xem, huỷ, mở lại |
| tenant_admin | chỉ xem + Sao chép | của công ty mình: sửa, xuất bản, xoá | công ty mình: bật/tắt, xếp thứ tự | công ty mình |
| member | — | — | — | xem trạng thái + làm việc được giao (duyệt, form) trên bản ghi |

---

## B. Node — mọi việc engine làm đều là node nhìn thấy trên canvas

| Node (nhãn UI) | Dùng khi | Cấu hình chính | Đầu ra | Engine hôm nay |
|---|---|---|---|---|
| **Bắt đầu khi** | luôn là node đầu, đúng 1 | sự kiện, điều kiện trên dữ kiện | dữ kiện vào lượt chạy | **mới** (C) |
| **Duyệt** | người/phòng quyết | phòng ban hoặc người cụ thể, chỉ trưởng phòng, hạn, nhắc mỗi N giờ, chuyển cấp, loại trừ người gửi, nút cho phép (Duyệt/Từ chối/Trả lại) | `decision`, người quyết, góp ý | gate `after: review` [CR-120 §5] — **thêm loại node độc lập** thay cặp `contracts-route` + gate |
| **Điền thông tin** | người điền form ở một bước | người làm, ≤ 20 trường, hạn/nhắc | giá trị form | `form` [ADR-0035 §1, CR-118] |
| **Nếu** (If) | rẽ theo dữ liệu | AND/OR lồng 1 cấp, ≤ 6 vế/cấp, nguồn: **dữ kiện bản ghi** hoặc đầu ra bước trước; nhánh Đúng/Sai; bước gộp | nhánh đã đi + giá trị đã đọc (ghi vào lịch sử) | `if` [flow-engine.md §3] — **thêm nguồn `fact` + bước gộp** |
| **Chia nhánh / Gộp** | việc làm song song | ≤ 3 nhánh mỗi bước | gộp khi mọi nhánh xong | có (cùng `step`) [flow-engine.md §1] |
| **Chờ** | chờ ngày / khoảng / sự kiện | đến ngày (trường ngày ± N), N giờ, hoặc sự kiện + hạn | hết giờ / sự kiện tới | `wait_until`, `wait_for`, `wait_event` [brief; CR-120 §5 G3–G4] |
| **Thông báo** | báo người/phòng | người nhận, mẫu nội dung có biến dữ kiện | đã gửi | `notify` [lát cr121-d6, d6b] |
| **Agent** | AI làm việc (soạn, đọc, kiểm) | agent, đầu vào, trường đầu ra | trường khai báo | `agent`/`team` |
| **Công cụ** | gọi workflow Dify / tool MCP / tool của app | công cụ trong catalog đã bật cho công ty | trường khai báo | `tool` [flow-engine.md §9] |
| **Ký số** | gửi ký và chờ kết quả | nhà cung cấp (nhiều, chọn được), người ký công ty, đối tác ký, thứ tự, hạn/nhắc | `Đã ký` / `Từ chối ký` (rẽ được) | **mới: node app** = tool gói + chờ sự kiện ký [CR-120 §5 G6] |
| **Ghi giá trị** | gán trường cho bước sau | ≤ 20 cặp khoá–giá trị | trường | `set` [flow-engine.md §4] |
| **Kết thúc** | điểm cuối mỗi nhánh | kết quả do app khai (vd HĐ: Đã duyệt / Từ chối / Trả lại) + câu "app sẽ làm gì" | kết quả lượt | **mới** — thay `contracts-finalize` ẩn |

Luật chung: trình sửa chỉ cho thêm node mà app khai trong manifest (giữ cr121-d R1 "danh mục node"); node app (Ký số, Chốt HĐ…) do app cung cấp phần chạy qua cổng gói. Không còn node hệ thống bị khoá/ẩn (`route`, `finalize`, `withConfirmStep`): việc "chốt HĐ, khoá, gắn SP" là hành động của app khi lượt tới **Kết thúc · Đã duyệt**, ghi rõ trên node đó.

---

## C. Trigger

**App khai sự kiện trong manifest** (thay `AppSlotDecl` của CR-120 §2): `events[] = {key, label, facts[{key,label,type}], outcomes[{key,label,effect}], required}`. `check:app-events` (thay `check:app-slots`) đỏ khi app không có sự kiện nào hoặc sự kiện `required` không có flow mặc định trong Thư viện. App mới = manifest + sự kiện + cổng dữ kiện + cổng kết quả.

| App | Sự kiện (nhãn trên node Bắt đầu khi) | Dữ kiện | Kết quả | required |
|---|---|---|---|---|
| contracts | `contract.submitted` · Khi gửi duyệt HĐ | Giá trị HĐ, Loại HĐ, Phòng ban người tạo, Đối tác mới [cr121-d R1] | Đã duyệt (HĐ hiệu lực + khoá) · Từ chối · Trả lại (về Nháp) | có |
| contracts | `contract.uploaded` · Khi tải HĐ lên (thay khe `contracts.intake`, nay chưa mở lượt nào [brief]) | Loại tệp, người tải | Đã nhận · Huỷ | không |
| contracts | `contract.approved` · Khi HĐ được duyệt | như trên | Xong | không |
| community | `post.created` · Khi đăng bài | Loại bài, Người đăng là đối tác | Hiện bài · Ẩn bài | không |
| community | `partner.join_requested` · Khi có đối tác xin tham gia | Tên công ty, email | Nhận · Từ chối | không |
| community | `report.created` · Khi có báo cáo vi phạm | Loại, mức | Ẩn · Giữ · Cảnh báo | không |

(Ba sự kiện community thay 3 khe `post-moderation`, `partner-join`, `report` [CR-120 §6].)

**Dữ kiện vào lượt chạy:** app ghi sự kiện `{event, ref, facts, event_id, actor}` vào hàng đợi sự kiện **cùng transaction** với thay đổi bản ghi. Lượt chạy nhận `ref` + dữ kiện lúc sự kiện (dùng cho điều kiện trigger và hiển thị). Node **Nếu** đọc **giá trị hiện tại** qua cổng dữ kiện của app mỗi lần rẽ và ghi lại giá trị đã đọc — giữ quyết định cr121-d ("rẽ theo giá trị HIỆN TẠI", hồi quy nếu đọc input cũ). Trường trống ⇒ Nếu đi nhánh Sai và lịch sử ghi "chưa có dữ liệu" (nói rõ lý do; xem H2).

**Nhiều flow cùng khớp một sự kiện — đề xuất: chạy MỘT, flow khớp đầu tiên theo thứ tự trong danh sách của công ty.** Lý do: sự kiện như "gửi duyệt" điều khiển trạng thái bản ghi; hai lượt song song cho ra hai kết quả mâu thuẫn. Người dùng đã quen "xét từ trên xuống, khớp đầu tiên" (cr121-c R4). Sự kiện `required` phải có ≥ 1 flow đang bật **không điều kiện** (lưới cuối); tắt/xoá flow đó bị chặn kèm câu sửa. Muốn làm thêm việc phụ (thông báo…) ⇒ thêm node vào chính flow đó, hoặc dùng sự kiện khác (`contract.approved`). Xem H1.

**Idempotent:** khoá lượt = `(tenant, event_id)` duy nhất (vd `contract.submitted:<id>:<lần gửi>`); bộ điều phối đọc hàng đợi sau commit (`FOR UPDATE SKIP LOCKED`), khớp, mở lượt; chạy lại/hai Hub ⇒ vẫn một lượt (cùng cách `client_msg_id` đã đạt ở ADR-0017 bài 2). Không flow nào khớp sự kiện không bắt buộc ⇒ ghi "không có quy trình" vào lịch sử bản ghi, không lỗi.

---

## D. Engine — tái dùng và phải thêm

| Giữ nguyên (brief) | Thêm / đổi (cộng thêm vào engine, Opus) |
|---|---|
| registry node, FlowRuntime, `process_runs` / `stage_runs` / `review_tasks`, snapshot lúc bắt đầu, timer + retry, nhắc/chuyển cấp, canvas `@ai/flow-canvas`, Thư viện + xuất bản + quay lại, sao chép (`source_ref`, `source_rel_version`), mã Group → id, tool của gói, FlowPanel + `FlowView` | 1. `trigger` trên `FlowDef`; hàng đợi sự kiện + bộ điều phối + khoá `(tenant, event_id)` |
| | 2. `company_flows` (bật, thứ tự) + chọn flow khớp đầu tiên — một câu SQL, p95 ≤ 5 ms như `resolveSlot` [CR-120 §9] |
| | 3. Node **Duyệt** độc lập (thay `contracts-route` + gate) |
| | 4. Nếu: nguồn `fact` qua cổng `FactsReader` của app (đọc hiện tại, một câu SQL, như `flow-facts.repo` cr121-d R3) + `next_step` để hai nhánh gộp lại (nay If chỉ nhảy tới, nhánh Đúng chảy tiếp vào nhánh Sai [flow-engine.md §3]) |
| | 5. Node **Ký số** = node app: gọi tool gói gửi ký, chờ sự kiện `esign.completed|declined` có hạn; phần gửi/đồng bộ nhiều nhà cung cấp của gói giữ nguyên [duyet-ky-so.md §4b] — esign không còn chạy ngoài engine |
| | 6. Node **Kết thúc** có `outcome` ⇒ gọi cổng `OutcomeHandler` của app trong tx (làm việc của `contracts-finalize`: khoá HĐ, gắn SP, idempotent [ADR-0030 §6]) |
| | 7. `FlowRuntime` tra theo `ref` (bỏ `:slot` khỏi route `/pack/:k/flow/:slot/:ref`) |

Engine vẫn chạy được snapshot cũ (`after.branch`, `contracts-route`, `contracts-finalize`) tới khi lượt cũ cuối cùng đóng.

---

## E. Nhất quán UI

- **Một trình sửa** (admin-web, dùng cho cả platform_admin và tenant_admin): **canvas mặc định**, "Danh sách bước" là chế độ phụ, nhớ theo người dùng (giữ cr121-c Q11). Bảng node bên trái chỉ gồm node app khai. Điều kiện của **Bắt đầu khi** và **Nếu** dùng **một** control dựng điều kiện (control của cr121-d R6, đổi chỗ gắn từ bước sang node). Đầu trang: tên · app · "Sao từ … · vN" · trạng thái · nút Xuất bản (hoặc lỗi + cách sửa) · Xem trước bằng bản ghi mẫu (tô đường đi).
- **Một danh sách flow của công ty** (Công ty › Quy trình; tenant_admin thấy đúng màn này cho công ty mình): nhóm theo app; mỗi dòng = tên · **Bắt đầu khi** (vd "Khi gửi duyệt HĐ · giá trị > 100 triệu") · nguồn ("Thư viện · chỉ xem" / "Bản công ty · sao từ … v1") · trạng thái **Đang bật / Đang tắt + lý do** · thứ tự (kéo thả, câu dẫn "Cùng một sự kiện: chạy quy trình khớp đầu tiên"). Nút: Mở · Sao chép · Bật/Tắt.
- **Trên bản ghi** (HĐ, bài): FlowPanel hiện "Đang chạy: <tên flow> · bước <x> · chờ <ai>" hoặc "Không có quy trình nào khớp — <cách sửa>".
- **Gỡ:** tab/cột "Việc", "Luật định tuyến", hàng "Mặc định", "Thêm luật", nút Gán/Đổi theo việc (cr121-c R4), `SlotRouting`/`RoutingRules`/`TenantProcessSlots`, editor Form theo khe + lỗi `SLOT_SHAPE_UNSUPPORTED`, vùng "Chỉ chạy khi" trên từng bước (`FlowWhenEditor` — thay bằng node Nếu), Cài đặt › Quy trình duyệt cũ của contracts, khe community 3 bước cố định, mọi chữ "khe" (đã cấm ở Luật GỐC 3).

---

## F. Chuyển đổi

| Bỏ | Thay bằng |
|---|---|
| `process_slots`, `process_routings`, `process_routing_rules`, `process_tenant_defs`, view `process_slot_assignments` | `FlowDef.trigger` + `company_flows` |
| `slot_body`, `SlotSpec`, `FlowSlotAdapter`, `compileSlotStages`, editor Form | `stages` là nguồn thật; cổng `FactsReader` + `OutcomeHandler` + danh mục node/sự kiện của app |
| `Flow`/`FlowCond`/`FlowWhen` riêng contracts, `approval-engine*.usecase`, `approval-flow.*` (~30 file), `withConfirmStep` | node Nếu, Duyệt, Ký số, Kết thúc; "Trả lại" = Kết thúc · Trả lại (H3) |
| `AppSlotDecl`, `check:app-slots`, `ensureSlotDefaults`, ops `flow-coverage` theo khe | `events[]`, `check:app-events`, cấp phát flow mặc định khi bật app, ops "sự kiện bắt buộc × công ty bật app thiếu flow không điều kiện = 0" |

**Backfill prod (2 công ty contracts, một migration theo tập, chạy lại vô hại, int "công ty cũ thấy dữ liệu"):**
1. Mỗi def Thư viện có khe ⇒ `FlowDef` cùng key: `trigger.event` theo khe (`contracts.approval` → `contract.submitted`…); `when` từng bước ⇒ node Nếu trước bước đó; bước Ký số ⇒ node Ký số; `route`/`finalize` ⇒ Kết thúc · Đã duyệt / Từ chối. Xuất bản v+1, ghi audit.
2. Mỗi (công ty × khe): luật có điều kiện ⇒ dòng `company_flows` (bản công ty mang điều kiện ở trigger) theo `priority`; luật `is_default` ⇒ dòng cuối không điều kiện.
3. 28 `process_runs` đang có: **không đụng**, chạy nốt theo snapshot (engine giữ tool cũ).
4. Kiểm sau backfill: với mỗi công ty, mô phỏng 4 HĐ mẫu (≥/< ngưỡng × mua/bán) ⇒ đường đi mới = đường đi cũ.

**Chạy song song sau cờ `FLOW_TRIGGERS` theo công ty:** tắt ⇒ đường khe cũ mở lượt, bộ điều phối chỉ ghi "lẽ ra chạy flow X" (bóng) và ops so lệch; bật Demo trước, đủ 3 kịch bản G xanh trên prod ⇒ bật công ty còn lại ⇒ một bản phát hành sau, khi 0 lượt cũ còn mở, gỡ code + bảng cũ (D6). Deploy chỉ khi người dùng xác nhận.

**DLC (của Rowan):** không đụng. DLC đang đọc sơ đồ theo khe `dlc.*` [`docs/platform/dlc-engine-handoff.md` §1]. Giữ một cổng đọc chỉ cho `dlc.*` (cùng chữ ký `resolveSlot`) + hàng khe DLC tới khi Rowan chuyển; `dlc:check` xanh mỗi lát. Khe chỉ còn bên trong DLC, không có trong mô hình/UI chung.

---

## G. Ba kịch bản nghiệm thu (thành e2e trên prod, công ty Demo)

**G1 · Hợp đồng Demo đi hết**
1. platform_admin tạo flow Thư viện "Duyệt HĐ Demo": Bắt đầu khi *Khi gửi duyệt HĐ* → Nếu *Giá trị HĐ > 100 triệu* → Đúng: Duyệt (Pháp chế) / Sai: Duyệt (Kế toán) → Gộp → Ký số (người ký: Giám đốc, đối tác ký) → Thông báo (người tạo) → Kết thúc · Đã duyệt. Xuất bản v1, bật cho Demo.
   *Thấy:* canvas đúng 7 node có nhánh Đúng/Sai gộp lại; danh sách Demo có dòng "Khi gửi duyệt HĐ · Đang bật".
2. Nhân viên tạo HĐ 150 triệu, bấm Gửi duyệt. *Thấy:* HĐ "Chờ Pháp chế duyệt"; FlowPanel ghi bước + người chờ.
3. Pháp chế duyệt ⇒ HĐ "Chờ ký"; ký xong (sandbox) ⇒ HĐ "Đang hiệu lực", người tạo nhận chuông. *Thấy:* lịch sử lượt: Nếu đọc "150.000.000 > 100.000.000 · Đúng", Kế toán "bỏ qua", mỗi bước có giờ và người.

**G2 · Tenant admin sửa bản công ty**
1. Nhân viên gửi HĐ A 150 triệu (dừng ở Pháp chế).
2. tenant_admin Demo mở dòng flow (chỉ xem) → Sao chép cho công ty này. *Thấy:* "Đã sao chép và gán cho công ty này", dòng đổi thành "Bản công ty · sao từ Duyệt HĐ Demo v1", cùng vị trí.
3. Đổi người duyệt nhánh Đúng sang phòng Giám đốc; thêm Nếu *Loại HĐ = Mua hàng* trên nhánh Sai (Đúng: thêm Duyệt Mua hàng) → Xuất bản. *Thấy:* "Sẵn sàng xuất bản" rồi v2 (bản công ty).
4. Gửi HĐ B 150 triệu. *Thấy:* B chờ Giám đốc; A vẫn chờ Pháp chế (lượt cũ giữ bản cũ, lịch sử ghi "Duyệt HĐ Demo v1"). Công ty khác không đổi.

**G3 · Community duyệt bài**
1. tenant_admin bật flow Thư viện "Duyệt bài đối tác": Bắt đầu khi *Khi đăng bài · Người đăng là đối tác* → Agent kiểm bài → Nếu *bị gắn cờ* → Đúng: Duyệt (Quản trị community, nhắc 24 giờ) → Kết thúc Hiện bài / Ẩn bài; Sai: Kết thúc · Hiện bài.
2. Đối tác đăng bài có nội dung bị gắn cờ. *Thấy:* đối tác thấy "Bài đang chờ duyệt"; thành viên khác chưa thấy bài.
3. Quản trị duyệt. *Thấy:* bài hiện trên bảng tin; người đăng nhận chuông; nhân viên nội bộ đăng bài ⇒ không có lượt nào (trigger không khớp), bài hiện ngay.

---

## H. Câu hỏi cần chốt (kèm mặc định đề xuất)

1. **Nhiều flow khớp một sự kiện:** chạy một (khớp đầu tiên theo thứ tự) hay chạy hết? — *Mặc định: một*, vì sự kiện điều khiển trạng thái bản ghi; việc phụ đặt trong cùng flow hoặc dùng sự kiện khác.
2. **Nếu đọc dữ kiện lúc nào:** giá trị hiện tại mỗi lần rẽ, và khi tới Kết thúc · Đã duyệt mà giá trị đã đổi khiến đường đi khác ⇒ dừng "Cần xử lý: giá trị HĐ đổi sau khi rẽ" để quản trị chọn chạy lại từ node Nếu? — *Mặc định: có* (giữ cr121-d + an toàn của finalize ADR-0030 §6). Trường trống ⇒ nhánh Sai — *mặc định có*, khác "trống ⇒ bước vẫn chạy" của cr121-d R2; lịch sử ghi rõ.
3. **Trả lại:** kết thúc lượt (HĐ về Nháp, gửi lại mở lượt mới) thay vì quay về bước soạn trong cùng lượt? — *Mặc định: kết thúc lượt*; bỏ được bước ẩn `withConfirmStep`, lịch sử mỗi lần gửi tách rõ.
4. **tenant_admin xuất bản bản công ty** không cần platform duyệt? — *Mặc định: có* (người dùng yêu cầu tenant admin tự sửa); kiểm khi xuất bản giữ nguyên, platform xem được nhật ký.
5. **Bản Thư viện có bản mới** khi công ty đang dùng bản sao: tự cập nhật hay chỉ báo? — *Mặc định: chỉ báo* "Thư viện có v(N+1)" + nút Xem khác biệt; không ghi đè sửa của công ty.
6. **Thứ tự bật:** Demo trước, NiTi sau, gỡ đường cũ sau một bản phát hành khi 0 lượt cũ còn mở? — *Mặc định: có*.

---

## I. Ước lượng lát (3 đợt, ≤ 4 agent cùng lúc)

| Lát | Model | Nội dung |
|---|---|---|
| F0 contract | Opus medium | `FlowDef` + `trigger`, manifest `events[]`, cổng `FactsReader`/`OutcomeHandler`, ADR mới (thay 0035/0036) |
| E1 trigger | Opus medium | hàng đợi sự kiện, bộ điều phối, khoá `(tenant, event_id)`, `company_flows`, khớp đầu tiên + perf |
| E2 node | Opus medium | Duyệt độc lập, Nếu đọc `fact` + `next_step` gộp, Kết thúc `outcome` |
| E3 ký số | Opus medium + Sonnet high | node app chờ sự kiện ký; adapter contracts |
| A1 contracts / A2 community | Sonnet high + Opus low soát | phát sự kiện cùng tx, dữ kiện, kết quả; gỡ `withConfirmStep` |
| U1 trình sửa / U2 danh sách công ty | Sonnet | node Bắt đầu khi + Nếu dùng một control, bảng node theo app; danh sách + trạng thái + lý do; gỡ UI khe |
| M1 backfill + cờ bóng | Sonnet high + Opus low soát | migration theo tập, mô phỏng đường đi, ops so lệch |
| Q1 e2e G1–G3 / R1 gỡ cũ | Sonnet | e2e prod một lần cuối đợt; gỡ code + bảng sau cutover |

Đợt 1: F0 → (E1, E2, U1 song song). Đợt 2: E3, A1, A2, U2, M1. Đợt 3: Q1, cutover Demo → NiTi, R1. Khoảng 11 lát, ~5 phần Opus.
