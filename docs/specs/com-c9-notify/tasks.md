# com-c9-notify — Thông báo chuông 8 loại

Đọc: `docs/current/community/nghiep-vu.md` §10; chuông kit `notify.enqueue` (pack migration kit 0004).
| Lát | Làn | Model | Migration | Phụ thuộc |
|---|---|---|---|---|
| C9 | Nhanh | Sonnet | community **0003** | C5 (C7/C8 cho sự kiện giá/khớp) |

## Phạm vi
Bảng tuỳ chọn thông báo theo người × loại (community 0003, RLS theo user); 8 loại sự kiện theo bảng §10 (mặc định Bật, trừ digest 8:00 Tắt); bấm mở đúng chỗ (bài + luồng, hoặc form Lưu báo giá); chuông chỉ trong app (không Zalo/SMS/email); người nhận đối tác chỉ nhận loại hợp lệ và nội dung masked. "NCC sửa giá bài đã lưu": gửi cho chủ quản, **không** gửi gì cho NCC (R29). COULD: digest 8:00, nhắc "đối tác chưa đăng nhập 7 ngày" (vòng nền theo tập, đồng hồ giả trong test, không sleep).

## Xong khi
Unit (chọn người nhận theo loại/tuỳ chọn); một int đường chính; một test chặn đọc chéo tenant cho bảng mới. e2e viết không chạy.

## Quyết định trong lúc làm
<!-- agent điền -->

## Delta (so với docs/current)
Gộp vào `current/community/nghiep-vu.md` §10 cuối đợt.
