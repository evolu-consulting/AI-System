# com-c11-anti-leak — Chặn lộ qua ảnh, đăng lại, nhật ký xuất

Đọc: `docs/current/community/nghiep-vu.md` §7; `lib/ai-client` (ADR-0029, usage + trần tenant).
| Lát | Làn | Model | Migration | Phụ thuộc |
|---|---|---|---|---|
| C11 | Nhanh | Sonnet | community **0004** | C5 |

## Phạm vi
(1) AI kiểm ảnh NCC (logo, tên, SĐT in trên ảnh) qua AI client chung; cảnh báo cho chủ quản trước khi dùng ảnh trong bài mình (cảnh báo, không chặn). (2) "Đăng lại dưới tên mình": bài mới của chủ quản, nội dung chuẩn hoá, không tên người đăng gốc, giá do chủ quản đặt; thay cho chia sẻ/chuyển tiếp nguyên bài (không có chức năng chia sẻ nguyên bài). (3) Nhật ký xuất (bảng community 0004): chưa có route xuất nên chỉ cung cấp hàm ghi nhật ký để dùng khi thêm xuất. Không gọi mạng/AI trong vòng lặp từng ảnh nếu có lô.

## Xong khi
Unit (chuẩn hoá nội dung đăng lại: bỏ tên/SĐT/ảnh gốc); một int đường chính mỗi endpoint; một test chặn đọc chéo tenant cho bảng nhật ký. AI client dùng mock trong test.

## Quyết định trong lúc làm
<!-- agent điền -->

## Delta (so với docs/current)
Gộp vào `current/community/nghiep-vu.md` §7 cuối đợt.
