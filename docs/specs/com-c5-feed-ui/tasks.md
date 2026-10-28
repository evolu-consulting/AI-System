# com-c5-feed-ui — App web Community: bảng tin và bài (CR-102)

Đọc: `docs/current/community/nghiep-vu.md` §3–5; `hien-thi.md`; UI: **bám đúng mockup** `docs/design/community/mockup-main.dc.html` (người dùng 2026-10-28: "làm lại UI như mockup"; nguồn https://claude.ai/artifact/NoueMJ9vMPSos621T3jbHt, board "Community · Bảng tin, Hồ sơ, Cài đặt", 1440×1200). Ngôn ngữ thiết kế: Roboto; nền `#f4f4f9`, thẻ `#fff`, viền `#e5e5ec`, chữ `#0f1020`/`#6b6c80`, nhấn chàm `#4f46e5` (hover `#4338ca`, nền nhạt `#eef2ff`), đỏ `#c81e1e`/`#fde8e8`, cam `#8a4306`/`#fdf0df`, xanh `#05603f`; thanh trên 60px (logo "S Sổ Hợp Tác · Community", ô tìm bo tròn, Bảng tin / chuông / cài đặt / avatar), bảng tin một cột giữa, ô soạn "Điền sẵn từ Sổ Hợp Tác", thẻ bài có menu ⋯ (Sửa / Lưu trữ / Xoá + xác nhận đỏ), thông báo dạng thả xuống, nút nổi "Hỏi trợ lý giá" mở khung chat có nguồn, Cài đặt chọn màu chủ đạo (Chàm, Xanh dương, Xanh ngọc, Xanh lá, Cam). Template `{{…}}` trong file là ô dữ liệu của canvas (mở bằng trình duyệt sẽ thấy khung, không có dữ liệu).
| Lát | Làn | Model | Migration | Phụ thuộc |
|---|---|---|---|---|
| C5 | Nhanh | Sonnet | — | C3 |

## Phạm vi
App mới `apps/community-web` (Rsbuild + React + Tailwind, Câu 6; build + `check:bundle` trong lát). Màn: bảng tin (chủ quản = cung cầu tổng hợp; đối tác = bài chủ quản chia sẻ + bài mình), tạo/sửa (nhãn "đã sửa") / lưu trữ / bỏ lưu trữ / đánh dấu xong / xoá (xác nhận) / ẩn bài đối tác, form theo loại bài (trường bắt buộc), chọn người xem (D2), ≤ 10 ảnh + 2 video (Filebox), lọc chữ thường (loại, nhóm hàng, khu vực, khoảng giá, người đăng) + tìm tên SP, trang công ty (chủ quản: Bài của tôi + nút mở SHT sang contracts-web; đối tác: hồ sơ + bài), tự hết hạn 30 ngày + hỏi trước 3 ngày (vòng nền theo mẫu `esign-sweep`, theo tập, không sleep). COULD: gợi ý cập nhật bài cũ khi đăng trùng.

## Xong khi
Unit logic thuần (hạn, lọc). Một int mỗi endpoint mới (đường chính). e2e **viết, không chạy**. Typecheck + build + check:bundle của community-web.

## Quyết định trong lúc làm
<!-- agent điền; chốt Chưa rõ nghiep-vu #5 (SSO sang contracts-web) -->

## Delta (so với docs/current)
Gộp vào `current/community/nghiep-vu.md` §4–5 cuối đợt.
