---
id: cr140-purchase
cr: CR-140 (Q14, Q15)
lane: Sonnet (seed/dữ liệu demo qua API admin; không đụng RLS/quyền/máy trạng thái; KHÔNG sửa engine) · không UI
---
# CR-140 · «Quy trình mua hàng» 11 bước cho tenant `demo`

## Plan ngắn
| Phần | Làm |
|---|---|
| Dữ liệu/luật thuần | `tools/scripts/src/seed-purchase-flow.data.ts`: 4 quy trình = cha «Mua hàng» + A «Chọn nhà cung cấp và ngân sách» (bước 1–5) + B «Hợp đồng» (6–7) + C «Nhận hàng và thanh toán» (8–11). Người duyệt/làm theo sơ đồ tổ chức demo (mã nhóm `pb-*` + 4 nhóm vai) — không tạo nhóm trùng phòng ban. |
| Dựng | `bun run demo:purchase` (`seed-purchase-flow.ts`): đăng nhập `platform`/`admin`, `POST /tenants/:tid/company-flows` → `PUT /process-defs/:id` → `POST …/company-flows/apply` (đúng đường màn Quy trình); con trước, cha sau (cha cần mã con). Idempotent (cùng tên ⇒ ghi đè + áp dụng lại); từ chối production/DB ngoài localhost. Gắn vào `scripts/dev-up.ps1 -SeedDemo` sau `demo:org`. |
| Chạy thử | `bun run demo:purchase --trial` (`seed-purchase-flow.trial.ts`): Cường gửi phiếu → từng người làm/duyệt qua `/me/review-tasks` (`/review-tasks/:id/form` · `/decision`, kèm ý kiến + tệp vì bước duyệt đòi `opinion_plus`). |
| UAT | `docs/specs/uat-2026-11-12/UAT.md` mục «H. Quy trình mua hàng» (H1–H15, theo người thật). |
| Perf | Không (script seed dev). |

## Quyết định trong lúc làm
| # | Quyết định | Lý do |
|---|---|---|
| 1 | Con A/B/C và cha dùng `trigger` = luật không bao giờ đúng (`contract.submitted` + `total_value < -1`) | Như mẫu Thư viện CR-125: bản xuất bản bắt buộc có «Bắt đầu khi», nhưng quy trình chỉ mở bằng phiếu (cha) / làm lượt con ⇒ không tranh quyền duyệt HĐ. |
| 2 | Cha khai `inputs: [du_toan: number]`; con khai đầu vào riêng (`A_INPUTS`…) | Node «Nếu» chỉ đọc đầu vào đã khai (`IF_INVALID` nếu thiếu). |
| 3 | B có thêm bước làm việc «Pháp chế soạn hợp đồng» (số HĐ + tải bản thảo) trước «Tạo HĐ từ hồ sơ»; tên/đối tác/giá trị lấy từ phần A qua `input_map` | Tệp `file_ref` chỉ gắn vào lượt của bước điền (`process_run_files`); lượt con kế thừa tệp CHỈ từ lượt cha ⇒ tệp PO của A không đến được B (xem Khoảng trống 1). Ô tệp tên `file_id` vì kiểm cạnh `FLOW_EDGE_MISSING` so theo tên đầu vào của node. |
| 4 | Không có node Ký số trong B (demo chưa cấu hình nhà cung cấp ký số); công ty bật ký số thì thêm cụm Ký số + Chờ ký trước «Kết thúc» | Theo brief: nhánh bỏ ký số có ghi chú. |
| 5 | Trưởng phòng đề xuất = `approver_mode: starter_head`; Giám đốc/TP Mua hàng/TP Kho/KT trưởng = `head_only` + `need: head` | CR-139a/139c; trưởng phòng là nguồn duy nhất, không nhóm trùng. |
| 6 | Bước 11 ghi trên bước «Thanh toán, hạch toán» (ngày chi + chứng từ) + KT trưởng duyệt; không có node «Xác nhận mốc» | Khoảng trống 3. |

## Chạy thử API (demo, 2026-11-13)
Lượt LỚN: Cường đề xuất **600 triệu** ⇒ A → B → C, lượt cha `done` (25 việc). Lượt NHỎ **15 triệu** ⇒ A → bỏ B → C, lượt cha `done` (20 việc).

| # | Bước | Người nhận việc | Kết quả |
|---|---|---|---|
| 1 | Phiếu yêu cầu mua hàng | `cuong.le` (NV Kinh doanh) | gửi 600 triệu |
| 2 | 1 Trưởng phòng đề xuất duyệt | `binh.tran` (trưởng phòng của Cường) | Đạt |
| 3–4 | 2 Báo giá → TP Mua hàng duyệt | `phuc.do` (điền + duyệt; Tùng cũng nhận được việc điền) | đã điền · Đạt |
| 5 | 3 So sánh giá, NCC đề xuất | `tung.mai` | đã điền |
| 6–7 | 3 Duyệt song song Mua hàng + Tài chính | `giang.vu` (Tài chính), `phuc.do` (Mua hàng) | Đạt · Đạt (đủ 2 mới đi tiếp) |
| 8 | 4 KT quản trị lập phương án ngân sách | `giang.vu` | đã điền |
| 9 | 4 Giám đốc duyệt ngân sách (> 500 triệu) | `demo-owner` | Đạt (lượt nhỏ: `phuc.do` duyệt, không lên Giám đốc) |
| 10–11 | 5 Tạo PO → TP Mua hàng duyệt | `phuc.do` | đã điền · Đạt |
| 12 | 6 Pháp chế soạn hợp đồng (chỉ lượt lớn) | `huy.dang` | đã điền ⇒ HĐ nháp «Máy chủ lưu trữ (lớn)» được tạo ở Sổ Hợp Tác |
| 13–15 | 6 Duyệt song song Pháp chế + Kế toán + Mua hàng | `phuc.do`, `giang.vu`, `huy.dang` | Đạt ×3 |
| 16 | 7 Giám đốc duyệt hợp đồng | `demo-owner` | Đạt |
| 17–18 | 8 Nhận hàng, nghiệm thu → TP Kho duyệt | `khoa.bui` | đã điền · Đạt |
| 19–20 | 9 KT mua hàng kiểm hoá đơn → KT trưởng duyệt | `ha.ly` → `em.hoang` | đã điền · Đạt |
| 21–23 | 10 Đề nghị thanh toán → duyệt song song KT trưởng + Giám đốc | `ha.ly`; `hung.dinh`, `demo-owner` | đã điền · Đạt ×2 |
| 24–25 | 11 Thanh toán, hạch toán → KT trưởng duyệt | `hung.dinh` (Thủ quỹ) → `em.hoang` | đã điền · Đạt ⇒ lượt cha «Đã xong» |

## Khoảng trống engine (KHÔNG sửa trong lát này — chuyển điều phối)
1. **Tệp không đi từ lượt con A sang lượt con B.** `apps/hub-api/src/modules/attachments/run-links.ts` `inheritRunFiles` (≈dòng 44–56): lượt con chỉ kế thừa tệp đã liên kết với lượt CHA; tệp `file_ref` do bước của A điền chỉ gắn vào lượt A ⇒ `contracts-create-from-step` ở B báo `CONTRACT_STEP_FILE_MISSING` (đã gặp khi thử: lượt B `needs_decision` `tool_failed`). Cách tránh: B có bước soạn riêng (QĐ 3). Cách sửa gốc: khi lượt con xong, liên kết tệp của nó lên lượt cha (hoặc `input_map` nhận id tệp từ `phan-N:sub_<ô tệp>` và kế thừa).
2. **Duyệt song song không giới hạn trưởng phòng.** `apps/hub-api/src/modules/processes/gates/parallel-open.ts` (≈dòng 44, `insertTask … userIds: []`) và `packages/contracts/src/hub-admin/process-approve.ts` `ParallelGroupSchema` (≈dòng 46, chỉ `group_key/label`): mỗi nhóm là CẢ phòng, không có `head_only`. Hệ quả thấy khi thử: «TP Mua hàng» duyệt song song có thể do Tùng (NV) bấm; «Kế toán trưởng» duyệt song song (hợp đồng, thanh toán) do Giang/Hùng bấm được (thử: `giang.vu` và `hung.dinh` đã duyệt thay Kế toán trưởng). Dựng gần nhất = nhóm phòng; sửa gốc = thêm `head_only` cho từng nhóm của `parallel`.
3. **«Xác nhận mốc» `pay` chỉ chạy trong quy trình mở bởi `milestone.due`.** `packages/contracts/src/modules/contracts/milestone-confirm/node.ts` (việc nhóm do engine mở khi lượt `milestone.due`; `apps/hub-api/src/modules/processes/adapters/milestone-task.repo.ts`): đặt node trong lượt mua hàng sẽ chờ `milestone.confirmed` không bao giờ tới. Bước 11 vì vậy chỉ ghi ngày chi + chứng từ trên bước; HĐ nháp tạo ở B không có mốc thanh toán nào được xác nhận. Cần: cách tạo mốc `pay` cho HĐ của lượt + mở việc xác nhận mốc từ bước của lượt.
4. **Ký số trong B** chưa dựng (demo chưa bật ký số); node Ký số đòi PDF + nhóm người ký id công ty (G11/G12 của CR-125).
5. **Việc nhận được rộng:** bước «làm việc» giao cho cả phòng (Phúc cũng điền báo giá/PO; «Kế toán thanh toán» là nhóm Hà). Không có «nhận việc theo vai trong phòng» ngoài nhóm vai.

## Test
- Unit `tools/scripts/src/seed-purchase-flow.data.test.ts` (7 ca): số bước, mã nhóm ∈ demo.yaml + nhóm vai, rẽ nhánh 500 triệu / 20 triệu, 3 điểm duyệt song song, nối bước, tệp HĐ.
- Int: không thêm (script gọi API stack đang chạy, chưa có khuôn seed-int cho luồng này); thay bằng chạy thử thật `demo:purchase --trial` (bảng trên). tsc `tools/scripts` + biome sạch.

## Việc còn lại
- Điều phối quyết Khoảng trống 1–3 (CR sau; đề xuất sửa `inheritRunFiles` + `head_only` cho `parallel` trước).
- Q15 (PO theo mẫu) vẫn ở hàng chờ: v1 bước 5 là phiếu + tải tệp.
- e2e hành trình (UI) không viết trong lát này (không UI); chạy trình duyệt UAT theo mục H.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED tools/demo-purchase.md
#### Yêu cầu: Quy trình mua hàng mẫu cho công ty demo
`bun run demo:purchase` dựng cho công ty `demo` quy trình «Mua hàng» (1 cha + 3 con) bằng đường API admin nền tảng: Phiếu yêu cầu → A (trưởng phòng đề xuất, báo giá, so sánh, ngân sách, PO) → nếu dự toán từ 20 triệu thì B (hợp đồng) → C (nhận hàng, hoá đơn, thanh toán); trên 500 triệu thì Giám đốc duyệt ngân sách, còn lại trưởng phòng Mua hàng; người duyệt/làm theo phòng ban của công ty mẫu; chạy lại không đổi gì; từ chối production.
- Kịch bản: số bước, mã nhóm hợp lệ, ngưỡng 500 triệu / 20 triệu, duyệt song song, nối bước [test: tools/scripts/src/seed-purchase-flow.data.test.ts » mỗi con có đủ bước theo bảng 11 dòng (A 1–5, B 6–7, C 8–11)]
- Kịch bản: nhóm chỉ lấy từ phòng ban demo và nhóm vai, không nhóm trùng [test: tools/scripts/src/seed-purchase-flow.data.test.ts » mã nhóm chỉ lấy từ phòng ban của demo.yaml + nhóm vai (không nhóm trùng phòng ban)]
- Kịch bản: cha rẽ nhánh theo dự toán, tệp HĐ lấy từ bước soạn của chính lượt B [test: tools/scripts/src/seed-purchase-flow.data.test.ts » cha: phiếu → A → Nếu ≥ 20 triệu (B, không thì bỏ) → C → Đã xong / Không mua]
