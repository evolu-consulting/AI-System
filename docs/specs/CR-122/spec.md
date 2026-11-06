---
id: CR-122
requirements: FLOW2-FR-01..24, FLOW2-NFR-01..05 (§1–§2)
design: ../../platform/flow-model.md
adr: ../../adr/0038-flow-trigger-model.md
trạng thái: Đã chốt mô hình 2026-11-06, chờ readiness (chưa code)
---
# CR-122 · Mô hình flow chuẩn (trigger theo sự kiện)

Nguồn duy nhất: [`docs/platform/flow-model.md`](../../platform/flow-model.md) (đã chốt 2026-11-06). Spec này chỉ đánh mã yêu cầu + nghiệm thu + chuyển đổi, **không thêm quyết định**. Thay ADR-0035/0036, sửa ADR-0030 §3 ([ADR-0038](../../adr/0038-flow-trigger-model.md)). Lát: [tasks.md](tasks.md).

## 1. Yêu cầu chức năng

| Mã | Yêu cầu | Nguồn |
|---|---|---|
| FLOW2-FR-01 | Một định dạng `FlowDef` (key, name, app, owner, trigger, stages[], source, version) cho Thư viện, bản công ty, mẫu chạy thử; `stages` giữ định dạng engine + `next_step`, `outcome`; bỏ `slot_body` và `Flow` riêng contracts | A |
| FLOW2-FR-02 | Mỗi flow đúng một node Bắt đầu khi và ≥ 1 node Kết thúc, ≤ 20 bước; mỗi app có nhiều flow | A |
| FLOW2-FR-03 | Flow chạy khi Bật cho công ty **và** sự kiện app khớp (sự kiện + điều kiện trên dữ kiện); Bật/Tắt theo từng công ty | A |
| FLOW2-FR-04 | Vòng đời Nháp → vN bất biến → Bật; lượt chạy chụp snapshot lúc bắt đầu, sửa/xuất bản không đổi lượt đang chạy | A |
| FLOW2-FR-05 | `company_flows` (tenant, flow, `enabled`, `replaced_by`, `position`) là nguồn duy nhất; hai loại dòng: Được gán (chỉ xem, chạy bản Thư viện mới nhất) và Bản công ty | A |
| FLOW2-FR-06 | Clone "Sao chép để sửa": bản công ty cùng định dạng, ghi "Sao từ <tên> · vN"; bấm lần hai mở bản sao đã có; mã phòng ban → Group của công ty, thiếu phòng ⇒ lỗi nêu phòng + cách sửa | A |
| FLOW2-FR-07 | Xuất bản lần đầu bản sao ⇒ bản sao Bật + gốc tự Tắt (`replaced_by`, lý do hiển thị) trong một transaction; không bao giờ cùng Bật | A |
| FLOW2-FR-08 | "Quay về bản gốc": bật gốc, tắt bản sao (giữ để dùng lại), lý do "đã quay về bản gốc" | A |
| FLOW2-FR-09 | Quyền: platform_admin tạo/sửa/xuất bản/tắt Thư viện + gán; tenant_admin chỉ xem flow được gán, sao chép, sửa/xuất bản/xoá bản công ty, bật/tắt + xếp thứ tự công ty mình; member chỉ xem trạng thái + làm việc được giao (H4: tenant_admin xuất bản không cần platform duyệt, kiểm khi xuất bản giữ nguyên, platform xem nhật ký) | A, H4 |
| FLOW2-FR-10 | Node Bắt đầu khi (sự kiện + điều kiện); node Duyệt độc lập (phòng/người, trưởng phòng, hạn, nhắc, chuyển cấp, loại trừ người gửi, nút Duyệt/Từ chối/Trả lại) | B |
| FLOW2-FR-11 | Node Điền thông tin, Chia nhánh/Gộp (≤ 3 nhánh), Chờ, Thông báo, Agent, Ghi giá trị: giữ hành vi engine hiện có, hiện thành node | B |
| FLOW2-FR-12 | Node Nếu: AND/OR lồng 1 cấp, ≤ 6 vế/cấp, nguồn `fact` (đọc giá trị hiện tại qua `FactsReader`, một câu SQL) hoặc đầu ra bước trước; `next_step` để hai nhánh gộp; ghi nhánh đã đi + giá trị đã đọc vào lịch sử | B, D4 |
| FLOW2-FR-13 | Node Công cụ: chọn workflow Dify / tool MCP / tool của app trong catalog **đã bật cho công ty**; đầu ra là trường khai báo của tool | B (bổ sung 2026-11-06) |
| FLOW2-FR-14 | Node Ký số = node app: gọi tool gói gửi ký, chờ `esign.completed\|declined` có hạn; nhiều nhà cung cấp chọn được; đầu ra Đã ký / Từ chối ký rẽ được; esign không còn chạy ngoài engine | B, D5 |
| FLOW2-FR-15 | Node Kết thúc có `outcome` do app khai; tới Kết thúc gọi `OutcomeHandler` trong tx (khoá HĐ, gắn SP, idempotent). Không còn node hệ thống ẩn (`route`, `finalize`, `withConfirmStep`). Trả lại = Kết thúc · Trả lại (H3) | B, D6, H3 |
| FLOW2-FR-16 | Trình sửa chỉ cho thêm node app khai trong manifest; một control dựng điều kiện dùng cho Bắt đầu khi và Nếu | B, E |
| FLOW2-FR-17 | App khai `events[] = {key, label, facts[], outcomes[], required, decides}`; `check:app-events` đỏ khi app không có sự kiện hoặc sự kiện `required` thiếu flow mặc định trong Thư viện | C |
| FLOW2-FR-18 | Danh mục sự kiện ban đầu: contracts (`contract.submitted` required+decides, `contract.uploaded`, `contract.approved`), community (`post.created`, `partner.join_requested`, `report.created`) theo bảng mục C của flow-model | C |
| FLOW2-FR-19 | App ghi `{event, ref, facts, event_id, actor}` vào hàng đợi sự kiện **cùng transaction** với thay đổi bản ghi; bộ điều phối đọc sau commit, khớp, mở lượt; lượt nhận `ref` + dữ kiện lúc sự kiện | C |
| FLOW2-FR-20 | Khớp nhiều flow (H1): chạy tất cả; sự kiện `decides` chỉ flow khớp đầu tiên theo `position`, flow khác ghi lịch sử "Không chạy: <flow X> khớp trước"; cảnh báo khi flow trên không điều kiện; sự kiện `required` luôn có ≥ 1 flow Bật không điều kiện (chặn tắt kèm câu sửa); không flow khớp sự kiện không bắt buộc ⇒ ghi "không có quy trình", không lỗi | C |
| FLOW2-FR-21 | Nếu đọc dữ kiện hiện tại mỗi lần rẽ; trường trống ⇒ nhánh Sai + lịch sử "chưa có dữ liệu"; tới Kết thúc · Đã duyệt mà giá trị đổi khiến đường đi khác ⇒ dừng "Cần xử lý: giá trị HĐ đổi sau khi rẽ" để quản trị chọn chạy lại từ node Nếu (H2) | C, H2 |
| FLOW2-FR-22 | UI: một trình sửa (canvas mặc định, danh sách bước là chế độ phụ nhớ theo người dùng), bảng node theo manifest app, đầu trang tên · app · "Sao từ … · vN" · trạng thái · Xuất bản · Xem trước; một danh sách flow công ty (nhóm theo app; tên · Bắt đầu khi · nguồn · Đang bật/Đang tắt + lý do · thứ tự kéo thả · Mở/Sao chép để sửa/Bật-Tắt/Quay về bản gốc); FlowPanel trên bản ghi "Đang chạy: … " hoặc "Không có quy trình nào khớp — <cách sửa>"; `FlowRuntime` tra theo `ref`, bỏ `:slot` khỏi route | E, D7 |
| FLOW2-FR-23 | Gỡ UI/code cũ: tab "Việc", Luật định tuyến, hàng Mặc định, Gán/Đổi theo việc, `SlotRouting`/`RoutingRules`/`TenantProcessSlots`, editor Form theo khe + `SLOT_SHAPE_UNSUPPORTED`, `FlowWhenEditor` (thay bằng node Nếu), Cài đặt › Quy trình duyệt cũ contracts, mọi chữ "khe" | E, F |
| FLOW2-FR-24 | Bản Thư viện có bản mới khi công ty dùng bản sao: chỉ báo "Thư viện có v(N+1)" + Xem khác biệt, không ghi đè (H5) | H5 |
| FLOW2-FR-25 | (người dùng 2026-11-06) Bảng node = node lõi + **node của module tính năng có sẵn**: mỗi app/module khai `nodes[]` trong manifest (nhãn vi/en, nhóm, executor sẵn có `notify`/`wait_until`/`wait_for`/`tool`… + cấu hình đặt sẵn + khoá tính năng). Ví dụ: Gửi email (notify kênh email), Thông báo chuông (notify bell), Hẹn giờ (wait_until), Chờ khoảng (wait_for), Ký số (contracts), Hiện bài (community). Trình sửa chỉ hiện node của tính năng **đang bật cho công ty** (danh mục tính năng CR-111); node không còn bật ⇒ flow báo lỗi rõ "Tính năng <x> đã tắt" khi lưu/chạy. Không executor mới cho node module | — |
| FLOW2-FR-27 | (người dùng 2026-11-06) Tải hợp đồng lên nhận mọi định dạng thường gặp và AI tự đọc: PDF có chữ, **PDF scan (trang là ảnh)**, nhiều ảnh chụp trang (JPG/PNG/WEBP/HEIC) ⇒ ghép thành một PDF lưu trữ, DOCX. Đọc trọn tệp ≤ 50 trang (cấu hình được); tệp > 50 trang ⇒ vẫn lưu nhưng KHÔNG tự đọc, báo rõ "vượt giới hạn 50 trang" + Nhập tay / tải bản ngắn hơn. Không đọc được ⇒ nói rõ lý do + "Nhập tay", không im lặng. HĐ tải lên đã ký ⇒ sự kiện "Khi tải lên hợp đồng" (`contract.uploaded`), không bắt chạy lại duyệt/ký | — |
| FLOW2-FR-26 | (người dùng 2026-11-06) Nối 2 node lệch giao diện: mỗi node khai `inputs`/`outputs` (tên, kiểu, bắt buộc). Khi nối, trình sửa **tự kiểm tất định** (không AI): thiếu trường bắt buộc / sai kiểu ⇒ cạnh vàng + "Bước sau cần <x>, bước trước không có". Nút **"Gợi ý cầu nối"** gọi AI qua Agent Hub ⇒ đề xuất chèn node **Ghi giá trị** (`set`) map trường (vd `contract.value` → `amount`, đổi kiểu/định dạng), kèm câu giải thích; người dùng xem trước rồi Nhận/Bỏ — AI không tự lưu. Không khớp được ⇒ AI nói rõ vì sao. Lưu flow vẫn chặn khi còn thiếu trường bắt buộc. Canvas là chế độ mặc định ⇒ gợi ý cầu nối làm **ngay trên canvas** (bấm cạnh vàng → ô gợi ý → node mờ xem trước → Nhận/Bỏ) | — |

## 2. Yêu cầu phi chức năng

| Mã | Yêu cầu |
|---|---|
| FLOW2-NFR-01 (perf) | Chọn các flow đang bật khớp một sự kiện = **một câu SQL**, p95 ≤ 5 ms (như `resolveSlot`, CR-120 §9); bộ điều phối theo lô, số câu SQL mỗi lô cố định, `FOR UPDATE SKIP LOCKED`; `FactsReader` của Nếu một câu SQL. Test `*.perf.int.test.ts` + đếm câu SQL. |
| FLOW2-NFR-02 (idempotent) | Khoá lượt `(tenant, event_id)` duy nhất; chạy lại / hai Hub ⇒ vẫn một lượt. Int 2 Hub. |
| FLOW2-NFR-03 (snapshot) | Lượt cũ chụp snapshot; engine vẫn chạy snapshot cũ (`after.branch`, `contracts-route`, `contracts-finalize`) tới khi lượt cũ cuối đóng. |
| FLOW2-NFR-04 (RLS) | Mọi bảng mới (`company_flows`, hàng đợi sự kiện) có RLS tenant + một test chặn đọc chéo tenant. |
| FLOW2-NFR-05 (nhất quán) | Một nguồn (D6): backfill + chuyển mọi chỗ đọc + gỡ cũ; check ops-watch phát hiện lệch / cấu hình nửa vời (D7). |

## 3. Nghiệm thu (AC) — e2e hành trình thật (D5) trên prod, công ty Demo

Chạy MỘT lần ở lát Q1; dữ liệu tạo đúng đường platform/khách làm, không bật sẵn trong seed.

**G1 · Hợp đồng Demo đi hết**
1. platform_admin tạo flow Thư viện "Duyệt HĐ Demo": Bắt đầu khi *Khi gửi duyệt HĐ* → Nếu *Giá trị HĐ > 100 triệu* → Đúng: Duyệt (Pháp chế) / Sai: Duyệt (Kế toán) → Gộp → Ký số (người ký: Giám đốc, đối tác ký) → Thông báo (người tạo) → Kết thúc · Đã duyệt. Xuất bản v1, gán cho Demo.
   *Thấy:* canvas đúng 7 node có nhánh Đúng/Sai gộp lại; danh sách Demo có dòng "Duyệt HĐ Demo · Được gán từ Thư viện · Khi gửi duyệt HĐ · Đang bật".
2. Nhân viên tạo HĐ 150 triệu, bấm Gửi duyệt. *Thấy:* HĐ "Chờ Pháp chế duyệt"; FlowPanel ghi bước + người chờ.
3. Pháp chế duyệt ⇒ HĐ "Chờ ký"; ký xong (sandbox) ⇒ HĐ "Đang hiệu lực", người tạo nhận chuông. *Thấy:* lịch sử lượt: Nếu đọc "150.000.000 > 100.000.000 · Đúng", Kế toán "bỏ qua", mỗi bước có giờ và người.

**G2 · Tenant admin clone flow được gán và dùng thay**
1. (Từ G1: platform_admin đã gán "Duyệt HĐ Demo" cho Demo.) Nhân viên gửi HĐ A 150 triệu (dừng ở Pháp chế).
2. tenant_admin Demo mở dòng "Duyệt HĐ Demo · Được gán từ Thư viện" (chỉ xem, canvas) → Sao chép để sửa. *Thấy:* nháp "Bản công ty · sao từ Duyệt HĐ Demo v1"; bản gốc vẫn Đang bật.
3. Đổi người duyệt nhánh Đúng sang phòng Giám đốc; thêm Nếu *Loại HĐ = Mua hàng* trên nhánh Sai (Đúng: thêm Duyệt Mua hàng) → Xuất bản. *Thấy:* bản công ty "Đang bật"; dòng gốc "Đang tắt · đã thay bằng bản công ty".
4. Gửi HĐ B 150 triệu. *Thấy:* B chờ Giám đốc (chỉ một lượt, bản gốc không chạy); A vẫn chờ Pháp chế (lượt cũ giữ bản cũ, lịch sử ghi "Duyệt HĐ Demo v1"). Công ty khác không đổi.
5. Bấm Quay về bản gốc. *Thấy:* dòng gốc Đang bật, bản công ty "Đang tắt · đã quay về bản gốc"; HĐ C mới chờ Pháp chế.

**G3 · Community duyệt bài**
1. tenant_admin bật flow Thư viện "Duyệt bài đối tác": Bắt đầu khi *Khi đăng bài · Người đăng là đối tác* → Agent kiểm bài → Nếu *bị gắn cờ* → Đúng: Duyệt (Quản trị community, nhắc 24 giờ) → Kết thúc Hiện bài / Ẩn bài; Sai: Kết thúc · Hiện bài.
2. Đối tác đăng bài có nội dung bị gắn cờ. *Thấy:* đối tác thấy "Bài đang chờ duyệt"; thành viên khác chưa thấy bài.
3. Quản trị duyệt. *Thấy:* bài hiện trên bảng tin; người đăng nhận chuông; nhân viên nội bộ đăng bài ⇒ không có lượt nào (trigger không khớp), bài hiện ngay.

## 4. Chuyển đổi (mục F)

| Bỏ | Thay bằng |
|---|---|
| `process_slots`, `process_routings`, `process_routing_rules`, `process_tenant_defs`, view `process_slot_assignments` | `FlowDef.trigger` + `company_flows` |
| `slot_body`, `SlotSpec`, `FlowSlotAdapter`, `compileSlotStages`, editor Form | `stages` là nguồn thật; cổng `FactsReader` + `OutcomeHandler` + danh mục node/sự kiện của app |
| `Flow`/`FlowCond`/`FlowWhen` riêng contracts, `approval-engine*.usecase`, `approval-flow.*` (~30 file), `withConfirmStep` | node Nếu, Duyệt, Ký số, Kết thúc; Trả lại = Kết thúc · Trả lại |
| `AppSlotDecl`, `check:app-slots`, `ensureSlotDefaults`, ops `flow-coverage` theo khe | `events[]`, `check:app-events`, cấp phát flow mặc định khi bật app, ops "sự kiện bắt buộc × công ty bật app thiếu flow không điều kiện = 0" |

**Backfill prod** (2 công ty contracts; một migration theo tập; chạy lại vô hại; int "công ty cũ thấy dữ liệu"):
1. Mỗi def Thư viện có khe ⇒ `FlowDef` cùng key: `trigger.event` theo khe (`contracts.approval` → `contract.submitted`…); `when` từng bước ⇒ node Nếu trước bước đó; bước Ký số ⇒ node Ký số; `route`/`finalize` ⇒ Kết thúc · Đã duyệt / Từ chối. Xuất bản v+1, ghi audit.
2. Mỗi (công ty × khe): luật `is_default` ⇒ dòng `company_flows` "được gán" (Bật, cuối danh sách); luật có điều kiện ⇒ bản công ty mang điều kiện ở trigger, Bật, theo `priority`; bản riêng đã sao (cr121-c Q9) ⇒ dòng bản công ty Bật + dòng gốc Tắt `replaced_by`.
3. 28 `process_runs` đang có: không đụng, chạy nốt theo snapshot (engine giữ tool cũ).
4. Kiểm sau backfill: mỗi công ty mô phỏng 4 HĐ mẫu (≥/< ngưỡng × mua/bán) ⇒ đường đi mới = đường đi cũ.

**Cờ `FLOW_TRIGGERS` theo công ty:** tắt ⇒ đường khe cũ mở lượt, bộ điều phối chỉ ghi "lẽ ra chạy flow X" (bóng) và ops so lệch. Bật Demo trước; G1–G3 xanh trên prod ⇒ bật NiTi ⇒ một bản phát hành sau, khi 0 lượt cũ còn mở, gỡ code + bảng cũ (D6, lát R1). Deploy chỉ khi người dùng xác nhận.

## 5. Quyết định đã chốt (2026-11-06, theo mặc định)

| # | Quyết định |
|---|---|
| H1 | Nhiều flow bật khớp cùng sự kiện: chạy tất cả; sự kiện `decides` chỉ flow khớp đầu tiên, flow khác ghi lý do không chạy |
| H2 | Nếu đọc giá trị hiện tại mỗi lần rẽ; Kết thúc · Đã duyệt mà đường đi đổi ⇒ dừng "Cần xử lý" cho quản trị chọn chạy lại từ node Nếu; trường trống ⇒ nhánh Sai, lịch sử nói rõ |
| H3 | Trả lại = kết thúc lượt (HĐ về Nháp, gửi lại mở lượt mới); bỏ `withConfirmStep` |
| H4 | tenant_admin xuất bản bản công ty không cần platform duyệt; kiểm khi xuất bản giữ nguyên, platform xem nhật ký |
| H5 | Thư viện có bản mới: chỉ báo + Xem khác biệt, không ghi đè |
| H6 | Thứ tự bật: Demo trước, NiTi sau, gỡ đường cũ sau một bản phát hành khi 0 lượt cũ mở |
| Công cụ | Node **Công cụ**: mỗi workflow Dify / tool MCP / tool app trong catalog đã bật cho công ty là một node chọn được; đầu ra là trường khai báo của tool |

## 6. Câu hỏi mở (mặc định, không tự chốt thêm)

| # | Chỗ thiếu trong flow-model | Mặc định đề xuất |
|---|---|---|
| Q1 | Node Công cụ chưa nói cách ánh xạ đầu vào (biến dữ kiện / đầu ra bước trước → tham số tool) và xử lý lỗi/hết giờ | Dùng đúng cơ chế đầu vào/retry/timeout của `tool` hiện có (`flow-engine.md` §9); đầu vào chọn từ dữ kiện hoặc đầu ra bước trước bằng cùng control chọn biến của node Thông báo |
| Q2 | Sự kiện `contract.uploaded`/`contract.approved`/community: `decides` và `required` chưa ghi từng sự kiện | Chỉ `contract.submitted` required+decides; `post.created` decides=true khi flow cần duyệt (theo H1); còn lại false |
| Q3 | Sự kiện hàng đợi bị kẹt/lỗi bộ điều phối: retry bao nhiêu lần, cảnh báo ở đâu | Dùng khuôn timer retry của engine; ops-watch báo sự kiện chưa xử lý > N phút (N do ops chọn, mặc định 5) |
| Q4 | Xoá bản công ty đang Bật thì gốc có bật lại không | Chặn xoá khi đang Bật và còn lượt mở; xoá = như Quay về bản gốc rồi xoá |

## 7. Ngoài phạm vi

- **DLC của Rowan**: không sửa, không chạy test DLC; chỉ giữ một cổng đọc `dlc.*` (chữ ký `resolveSlot`) + hàng khe DLC tới khi Rowan chuyển; `dlc:check` xanh mỗi lát. Khe chỉ còn bên trong DLC.
- Cập nhật tự động bản sao theo bản Thư viện mới (H5: chỉ báo).
- Đổi engine ngoài phần cộng thêm của flow-model mục D.

## 8. Tài liệu phải cập nhật khi CR-122 xong (đang mâu thuẫn; KHÔNG sửa bây giờ)

| Tài liệu | Mâu thuẫn |
|---|---|
| `CLAUDE.md` Luật GỐC 2 ("khe flow") | Đổi "khe flow" → "sự kiện + manifest `events[]`". **Điều phối sửa cùng người dùng**, docs-architect không sửa |
| `docs/specs/CR-120/spec.md` §2, §3 | `AppSlotDecl`, `check:app-slots`, gán một nguồn bằng luật `is_default` |
| `docs/specs/cr121-c` R4, R8, Q8, Q9 | luật định tuyến "xét từ trên xuống", hàng Mặc định, Gán/Đổi theo việc, sao chép theo khe |
| `docs/specs/cr121-d` (d0–d6) | `slot_body`, editor Form theo khe, `when` trên bước (R4 ≤ 20 bước giữ) |
| `docs/adr/0030-contract-approval-on-engine.md` §3 | bước hệ thống route/finalize/confirm → node Duyệt/Kết thúc (§6 giữ) |
| `docs/current/engine/thu-vien-quy-trinh.md` | khe, gán, luật định tuyến, snapshot theo khe |
| `docs/current/sht/duyet-ky-so.md` | duyệt/ký chạy ngoài flow; esign thành node Ký số; `withConfirmStep` |

Cũng gộp Delta vào `docs/current/**` cuối đợt (Việc 2b) và cập nhật `docs/INDEX.md` (dòng spec CR-122, ADR-0038).
