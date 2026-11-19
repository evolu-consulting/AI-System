# Brief chung — bản mẫu UI đợt CR-187..192 (2026-11-19)

Nguồn ý: phản hồi UAT 19/11 (R1..R34) — tóm tắt từng ý ở brief riêng của bạn. Đây là BẢN MẪU (đồ bỏ đi) để người dùng (giám đốc) xem trước khi code.

## Kỹ thuật
- MỘT file HTML tự chứa, < 300 KB, không gọi mạng ngoài trừ (tuỳ chọn) Google Fonts stylesheet. JS thuần inline, không React/CDN.
- Màu/bo góc/chữ: chép giá trị từ `packages/web-kit/src/styles/tokens.css` + `packages/web-kit/src/ui/kit/tokens.css` vào `:root` (sáng) và `[data-theme=dark]` (tối). Có nút chuyển Sáng/Tối trên đầu trang (ý R33: chữ chìm ở tối — bản mẫu phải đạt tương phản AA ở cả hai).
- Có nút chuyển khung Máy tính / Điện thoại (390px) — mỗi màn phải xem được cả hai.
- Theo luật UI hiện có: `packages/web-kit/src/ui/kit/RULES.md` (đọc). Vùng bấm ≥ 44px trên điện thoại. Icon đứng một mình có tooltip.
- Áp HAI LUẬT MỚI (người dùng đã OK):
  - Cuộn: mỗi trục một vùng cuộn, không lồng; trang toàn màn khoá trang, chỉ khung con cuộn; giữ chỗ thanh cuộn (`scrollbar-gutter: stable`).
  - Chống nháy: đổi tab/lọc giữ dữ liệu cũ làm mờ tới khi có mới; số đếm không về 0; trạng thái chọn chỉ đổi màu/nền, không đổi độ đậm/padding/viền; ảnh có `aspect-ratio`.
- Dữ liệu giả, tên người Việt giả (không dùng tên người thật trong repo), công ty giả. Nhãn tiếng Việt nghiệp vụ, ít chữ, không từ kỹ thuật (tenant, RLS, id, endpoint…).
- Bấm được: tab, dropdown, hộp thoại, chọn/bỏ chọn — đủ để người dùng cảm được luồng.
- Thanh trên cùng: danh sách màn (mục lục) để nhảy; mỗi màn có tiêu đề + 1 dòng «Điểm cần bạn xem».
- Cuối trang: khối «Câu hỏi cần chốt» — mỗi câu có các lựa chọn (radio), lựa chọn mặc định ghi «(đề xuất)». Nút «Chép góp ý» chép tóm tắt các lựa chọn + ô ghi chú mỗi màn vào clipboard (để người dùng dán vào chat).
- Trong `<head>`: `<title>` 2–4 chữ, `<meta name="viewport">`, body có nền rõ.

## Không làm
Không sửa code sản phẩm, không commit, không chạy test, không publish. Chỉ ghi file HTML của bạn (đường dẫn trong brief riêng). Đọc code hiện tại chỉ để hiểu màn đang trông thế nào (≤ 15 lần đọc).

## Xong khi
File HTML mở được, không lỗi console (kiểm bằng mắt đọc lại code), tất cả màn trong brief riêng có mặt. Giới hạn: ~25 phút, ≤ 40 lần gọi công cụ.

## Báo cáo (≤ 6 dòng)
Đường dẫn file · số màn · danh sách câu hỏi (id + mặc định) · chỗ tự quyết · chỗ chưa làm.
