# delivery-opts — đợt giao theo % + cho phép giao vượt tồn (Làn nhanh; kho = làn đầy đủ phần tồn âm)

Nguồn: lỗi người dùng "xác nhận đợt giao báo STOCK_INSUFFICIENT". Hai tuỳ chọn đã đồng ý.

## Plan
1. **Đợt giao theo %**: `obligations.delivery_pct numeric(5,2)` (migration 0053). Xác nhận mốc không có bảng SL ⇒ SL dòng = làm tròn(% × SL HĐ) (SL nguyên làm tròn đơn vị, lẻ giữ 4 số lẻ), tối đa phần còn lại; đợt cuối (Σ % các đợt đã xác nhận + % này ≥ 100) lấy phần còn lại. Ưu tiên: bảng SL người dùng sửa > % > SL chung cũ > phần còn lại. % và SL chung không đi cùng (422). Luật thuần `splitByPct` (`domain/delivery.rules.ts`).
2. **Giao vượt tồn**: `approval_settings.allow_negative_stock` (mặc định false), đặt qua `PUT /company` (`allow_negative_stock` tuỳ chọn, nhật ký `approval_settings_audit`). `applyDelivery` lập kế hoạch như cũ; chỉ khi `stock_insufficient` mới đọc cài đặt (cùng tx, sau khi khoá thành phần) ⇒ bật thì lập lại với `allowNegative`. Một luật cho HĐ và G1.
3. Tồn âm: xuất lấy phần tồn dương theo lô/BQ, phần vượt = tồn âm, giá vốn theo BQ, giá trị tồn giữ ≥ 0 (= 0 khi tồn ≤ 0); nhập khi tồn âm bù phần thiếu trước (lô `remaining` = phần dư). Sổ `stock_moves.overdrawn` + `DeliveryOutcome.overdrawn` + ghi chú "giao vượt tồn N".
4. UI: ô "Giao theo %" ở hộp mốc; hộp xác nhận mốc giao có bảng "Giao đợt này" tính sẵn, sửa được (PATCH items rồi settle), cảnh báo thiếu kho (`/stock/check`), toast sau khi giao vượt tồn; công tắc ở Cài đặt › Công ty (mục "Kho & giao hàng"). i18n vi/en.

## Quyết định trong lúc làm
- Công tắc đặt ở mục Công ty (cùng cờ duyệt, cùng PUT) chứ không ở "Điểm kinh doanh" (mục đó là chấm điểm SP).
- Migration 0053 nới `product_components_qty_ck` (bỏ `on_hand >= 0`) và `stock_moves_num_ck` (bỏ `on_hand_after >= 0`); giữ giá trị ≥ 0.
- Không thêm tổng % ≤ 100 khi lưu mốc; đợt vượt được chặn bởi phần còn lại.
- Chưa xử lý đảo kho (xoá HĐ/huỷ giao dịch) cho dòng đã giao vượt tồn: đảo xuất trả lô mới theo giá trị đã xuất — kiểm khi UAT.

## Việc còn lại
- [ ] Chạy int `tests/acceptance/delivery-opts` + e2e `e2e/contracts-web/delivery-opts.cw.ts` (cuối đợt; lát này chỉ viết).
- [ ] Kiểm tay đảo kho sau giao vượt tồn; kiểm migration 0053 trên DB có dữ liệu.
- [ ] qc ghi lock test mới.

## Truy vết
Test: `domain/delivery-opts.rules.test.ts`, `contract-milestones/lib/delivery-lines.test.ts`, int + e2e như trên.
