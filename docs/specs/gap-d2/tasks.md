# GAP-D2 — Đối tác: thêm công ty, nhiều liên hệ, huỷ việc, điểm theo mốc, xu hướng (làn nhanh; #23 #24 #25 #15 #27)

Migration **0044** (journal `when` 1797200000000): bảng `contracts.partner_contacts` (RLS FORCE tenant + M1 như `partner_notes`, backfill
từ `companies.phone/contact_person`) + cột `partner_event_voids.reason`.

| # | Việc | Làm |
|---|------|-----|
| 23 | Thêm công ty (Đối tác) | Nút "Thêm công ty" ⇒ hộp nhập MST ⇒ `POST /companies {tax_id}` (chỉ MST ra Cục Thuế); 503 ⇒ mời nhập tên rồi lưu trước; "Tra lại" ⇒ `POST /companies/refresh`. Không route mới. |
| 24 | Nhiều người liên hệ | `GET/PUT /partners/contacts` (PUT thay cả danh sách, ≤ 20, MỘT câu SQL; xoá cột điện thoại/liên hệ đơn cũ trên danh bạ). Hồ sơ đầu trang = người đầu tiên (rơi về giá trị cũ khi chưa có). "Phụ trách bên mình" = chữ tự do. |
| 25 | Huỷ việc có lý do | `POST /partner-events/:id/void {reason?}` lưu `partner_event_voids.reason`; UI: hộp nhập lý do bắt buộc ở "Đã ghi gần đây" và nút Huỷ trên việc ghi tay ở danh sách việc góp điểm của tiêu chí. |
| 15 | Điểm theo mốc | Hiển thị (không route): `milestonePoints` (mockup `msDelta`) cạnh mốc đã xác nhận trên dòng thời gian. |
| 27 | Xu hướng + cảnh báo | Hiển thị (không route): đường 6 tháng + luật `alertsOf` (điểm tụt ≥ 10; tỷ lệ trễ 30 ngày ≥ 50% và cao hơn 90 ngày trước ≥ 30 điểm, ≥ 3 mốc; lỗi của mình không tính). |

## Quyết định trong lúc làm
- Intake C10 từng ghi "không làm cảnh báo bất thường"; người dùng yêu cầu #27 ở gap list nên làm, luật đặt ngưỡng ở `lib/alerts.ts` (đổi một chỗ).
- Điểm mốc chỉ để xem: số thật vẫn do engine uy tín máy chủ tính (không đổi engine).
- `reason` ở API là tuỳ chọn (thân `{}` cũ vẫn nhận); màn hình bắt buộc nhập.

## Test
unit: `partners/lib/gap-d2.test.ts`, `contract-milestones/lib/points.test.ts`; int: `tests/acceptance/GAP-D2/gap-d2.int.test.ts`
(contacts + void/lý do + chặn chéo tenant); e2e (chưa chạy): `e2e/contracts-web/gap-d2.cw.ts`; `hd78-partners.cw.ts` sửa theo hộp lý do.
