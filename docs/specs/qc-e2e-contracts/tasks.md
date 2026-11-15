# qc-e2e-contracts — QC phân loại e2e đỏ cuối đợt CR-146..152 (việc `contracts-web` + `cr127`)

Nguồn: log evotest `.data/evotest/20261114-133224-8576-e2e` (commit 016f0e5d5). Chỉ sửa `e2e/**`, `tests/.lock`, docs. Không sửa code sản phẩm.
Cách làm: tái hiện cục bộ từng ca (`bun run e2e:contracts <tệp>`, mock `page.route`), đọc error-context, đối chiếu Delta của CR-135/138/146/149/151/152; ảnh baseline Linux chụp lại bằng evotest `-Capture cw`, chỉ chép 11 cảnh đổi (các cảnh khác khớp từng byte).

## Phân loại (a = test cũ theo hành vi đã chốt · b = lỗi sản phẩm · c = chập chờn/môi trường)
| Ca | Loại | Việc đã làm / bằng chứng |
|---|---|---|
| scenes.cw ×11 (shell-light/dark/sidebar-collapsed/account-menu, s05-review-light/dark/mobile, s05-failed-light, v2f-detail-light/dark/mobile) | a | Lệch chữ do UI đổi có chủ ý: nav «Sơ đồ tổ chức» (CR-139/142), bỏ nút «Huỷ» + dòng «Bản nháp chỉ bạn thấy…» (CR-135 Q2 + fix-uat2-quick), bỏ gợi ý «Số cũ có ký tự đặc biệt…» (CR-135 Q3), thêm nút «Hồ sơ» cạnh «Xem hợp đồng gốc» (cr135c-file-record). Diff từng từ khớp đúng bốn thay đổi này. Chụp lại 11 cảnh (json + png) bằng evotest `-Capture cw`; 53 json còn lại giống hệt |
| approval-current ×2 | a | `GET /approval-flow` nay trả `{items:[…]}` (CR-146a, `ApprovalFlowListSchema`) ⇒ mock bọc `{items:[FLOW]}` |
| esign-flow | a | Cùng nguyên nhân: mock `{items:[FLOW]}` |
| esign-anchor, esign-multi | a | Cài đặt ký số chuyển sang tab «Kết nối» (CR-138b/CR-146) ⇒ bấm «Kết nối» thay «Quy trình duyệt»; mock approval-flow `{items:[]}` |
| v2l-settings ×2, rep3-engine «hd8 · không phải quản lý», «v2e · không phải chủ sở hữu» | a | CR-138 Q6: không phải chủ sở hữu chỉ thấy mục «Quy trình duyệt», ẩn «Công ty», «Điểm uy tín»… ⇒ ca viết lại thành «không có mục Điểm uy tín / ô cấu hình / nút Lưu» (vẫn kiểm chỉ-xem, không yếu đi) |
| rep3-engine «v2e · Cài đặt» (chủ sở hữu) | a | CR-152c thêm 3 ô điểm uy tín (Nhượng quyền ×2, Hợp tác) ⇒ mock `cells` thiếu khoá làm trang vỡ «Something went wrong!»; bổ sung 3 khoá, tên ca «8 ô» |
| cr120-intake-flow | a | CR-135 Q2 đưa «Lưu nháp»/«Huỷ» vào «Thao tác ▾»; UAT (dc8d257f0) bỏ `draft-hint` ⇒ kiểm nút chính «Gửi duyệt», `act-saveDraft` trong menu, `draft-hint` vắng |
| v2g-review ×5 | a | Cùng CR-135 Q2: bấm «Lưu nháp»/«Huỷ» qua `head-actions-menu` → `act-saveDraft`/`act-cancel`; CR-135 Q3: số HĐ giữ nguyên văn ⇒ thân POST /review không còn `fields.number` khi chưa sửa |
| doc-frame ×2 | a | CR-135 Q12: nhãn chữ `doc-type-tag` thành icon `doc-type-icon` (aria-label = tên loại) |
| hd2-flow (Xem hợp đồng gốc) | a | CR-149: hộp «Xem» dùng pdf.js (không còn `<iframe>`), tệp giả `%PDF-1.4` không đọc được ⇒ dùng PDF tối thiểu hợp lệ, kiểm `pdf-page` |
| org-visibility | a | CR-151: hộp tìm người thêm ô «Tìm theo tên» thứ hai + nút người trùng nhãn ⇒ khoanh vùng `person-search`; bỏ quản lý qua nút «—» trong hộp (không còn `<select>`) |
| v2i-partners (DT-06) | a | CR-151d mục 12: `GET /partners/contracts` trả trang `{items, next_offset}` ⇒ mock theo trang |
| cr127 (không có tên ca) · dựng stack | a | Stack không dựng được nên không chạy ca nào. Lỗi 1: `PUT /process-defs → 422 PROVIDER_NOT_ENABLED` (CR-146b: «Ký qua» phải là nhà cung cấp đang BẬT của công ty nhận) ⇒ thêm `enableEsign(b)` cho công ty nhận cặp j08. Lỗi 2 (lộ ra sau đó): `422 TOOL_INVALID stages.1.executor.args.contract_id` vì quy trình Nhận HĐ không khai đầu vào `contract_id` ⇒ khai `inputs: CONTRACT_INPUT`. Sau sửa: stack dựng được, 31 ca xanh |
| cr127 · j16 «Người khác không thấy Xoá hợp đồng» | chưa chắc (nghi a) | Đỏ: `getByRole('button',{name:/^Thao tác/})` còn 1 (mong 0). Nghi test cũ: CR-135 luôn hiện «Thao tác ▾», chỉ mục «Xoá» ẩn (Delta cr135a). Chưa sửa (hết lượt chạy) |
| cr127 · j18/j19 tin nhắn | chưa chắc (nghi c/a) | j18: `conv-row` chưa đánh dấu chưa-đọc (`aria-*` = false). j19: huy hiệu «2», mong «1» — nghi dư tin chưa đọc từ j18 (cùng stack, chạy nối tiếp) hoặc CR-148 đổi cách đếm. Cần xem trace |
| cr127 · j20 danh bạ «thẻ người» | chưa chắc (nghi a/b) | Đỏ: `person-tip` không hiện khi rê chuột (CR-148 thẻ người rê chuột, theo lô). Cần xem trace: test chờ sai chỗ hay thẻ không bật |
| cr127 · j01 quản trị nền tảng soạn quy trình | chưa chắc | Đỏ: predicate `expect.poll` quá 60 s (true mong đợi, nhận false). Cần xem trace |
| cr127 · cr150-two-companies «B duyệt nội bộ» | chưa chắc (nghi a) | Đỏ: không thấy `[data-approval=approve],[data-approval=pass]`. Nghi do cặp d5a→d5b nay có bước Ký sau «Giám đốc nhận duyệt» (đã cảnh báo ở tasks qc-batch-146-152) hoặc nút nằm trong menu Thao tác |

Tổng: ca a = 31 contracts-web + stack cr127 (2 lỗi dựng); chưa chắc = 6 ca cr127 (j01, j16, j18, j19, j20, cr150) — mới chạy lần đầu vì stack trước đó không dựng được. Lỗi sản phẩm (b) xác nhận: 0.

## Kết quả chạy lại
- Lượt 1 (`contracts-web cr127`, -Wave): contracts-web **208 pass / 0 fail** (trước: 176 pass / 32 fail); cr127 đỏ khi dựng stack (TOOL_INVALID contract_id).
- Lượt 2 (`cr127`): stack dựng được, **31 pass / 6 fail** (j01, j16, j18, j19, j20, cr150) — log `.data/evotest/20261114-141242-30504-e2e`. Hết 2 lượt ⇒ chưa phân loại tiếp.
- Còn lại cho lượt sau: mở trace 6 ca trên, xếp a/b/c; sửa test nếu a.

## Quyết định trong lúc làm
- Ca người-không-chủ-sở-hữu: viết lại theo Q6 thay vì xoá (vẫn có ca khẳng định không có mục/ô sửa/nút Lưu).
- `approval-current` còn ghi ảnh minh hoạ vào `F:/workspace/evolu-platform/.data/cr108` (có sẵn từ CR-108): cục bộ Windows không có ổ F nên ca này chỉ xanh trên evotest (Linux tạo thư mục tương đối).
- Chạy lại bằng `-Wave`: lệnh không có `-Wave` bị chốt `MAX_E2E_SPECS=60` (job `contracts-web cr127` = 128 spec).

## Delta (so với docs/current)
Không thay đổi hành vi (lý do: QC e2e)

Trạng thái gộp: chưa gộp
