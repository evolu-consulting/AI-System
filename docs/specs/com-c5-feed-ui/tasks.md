# com-c5-feed-ui — App web Community: bảng tin và bài (CR-102)

Đọc: `docs/current/community/nghiep-vu.md` §3–5; `hien-thi.md`; UI: mockup Community của người dùng (**chờ ảnh**; tới khi có, bám thiết kế `apps/contracts-web`: cùng đăng nhập/bảng màu/component).
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
