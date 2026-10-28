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
- C11a (dịch vụ kiểm ảnh, thuần/độc lập backend): cổng `ImageLeakChecker.check(image, ctx)` ở `community/application`; adapter model `createModelImageLeakChecker` + `VisionTransport` mỏng; adapter giả `fakeImageLeakChecker`.
- `lib/ai-client` hiện CHỈ nhận `prompt: string` (chưa có ảnh) nên transport thật chưa nối: việc còn lại của C11b = thêm đường ảnh vào `ModelRequest`/provider (Anthropic content block image) qua cửa chung (trần tenant + usage), chọn model có thị giác từ cấu hình tính năng (không khoá trong code). Đến lúc đó `transport=null` ⇒ mọi ảnh `unknown`.
- Trạng thái: clean (model đáp ổn, không thấy gì) / suspect (có dấu hiệu) / unknown (hết giờ, không model, đầu ra hỏng — không bao giờ chặn). Model trả JSON {text, logos, companies}; chữ OCR đi qua `scanContacts` (xác định, confidence 1); logo/tên công ty = phán đoán model, chỉ tính khi confidence >= 0.5.
- `buildRepostDraft`: nội dung qua `stripContacts`; không mang người đăng gốc (kiểu nguồn không có trường này); giá `null`; ảnh `suspect` mặc định `included=false`, kèm `hasSuspectImages` cho UI cảnh báo.

## Delta (so với docs/current)
Gộp vào `current/community/nghiep-vu.md` §7 cuối đợt.
