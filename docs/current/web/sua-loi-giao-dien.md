# Sửa lỗi giao diện workspace-web đợt 2026-11-12 (CR-130, CR-132)

Nguồn: fix-e2e-web, fix-uat-web (gộp 2026-11-12).

#### Yêu cầu: Đường cũ của Sổ Hợp Tác không dẫn tới «Không tìm thấy»
`/contracts/messages` là trang Tin nhắn. Đích cũ `/contracts/login|sso|privacy|terms` chuyển về trang cùng tên ở gốc, giữ query + hash.
- Kịch bản: `/contracts/login?sso=none#x` ⇒ `/login?sso=none#x` [test: apps/workspace-web/src/shared/kernel/legacy-routes.test.ts » route gốc của app]

#### Yêu cầu: Quy trình theo Bảng tin; đối tác không có trợ lý AI; thông báo nhắc tên mở đúng bình luận
«Bảng tin» là lựa chọn khi tạo quy trình công ty nếu công ty bật gói Sổ Hợp Tác + tính năng Bảng tin. User đối tác không thấy nút/khoang trợ lý. Bấm thông báo nhắc tên khi đang ở Bảng tin ⇒ mở bình luận và cuộn tới đúng bình luận.
- Kịch bản: bật/tắt add-on Bảng tin và gói SHT [test: apps/admin-web/src/features/tenants/flows/lib/flow-apps.test.ts » flowAppsOf]
- Kịch bản: đối tác ⇒ trợ lý ẩn [test: apps/workspace-web/src/features/assistant/lib/chat.rules.test.ts » assistantVisible]
- Kịch bản: `?post` + `?comment` đúng bài ⇒ mở bình luận [test: apps/workspace-web/src/modules/community/domain/search-hint.test.ts » opensCommentThread]
- Kịch bản: bản dựng thường không có cờ mock bật Bảng tin [test: apps/workspace-web/src/shell/mock-flag.test.ts » bản dựng thường]

#### Yêu cầu: Giao diện nói tiếng nghiệp vụ, không che nút
Trạng thái đầu của HĐ là «Nháp» (không hiện DRAFT); ảnh trong tin nhắn thu nhỏ, bấm mở lớn; nút nổi trợ lý không che ô soạn tin; thanh dưới điện thoại có nhãn vừa cột; Bảng tin chưa bật ⇒ nói rõ lý do (không tự chuyển trang); đối tác không gọi API Sổ Hợp Tác; chuông bình luận Bảng tin gọn: «{Tên} bình luận một bài đăng» (bài có tiêu đề: trích ≤ 60 ký tự, không lặp tên).
- Kịch bản: `/contracts/messages` ẩn nút nổi trợ lý [test: apps/workspace-web/src/features/shell/lib/shell-lib.test.ts » fabHiddenOn]
- Kịch bản: nội bộ vào `/community` khi chưa bật không bị chuyển; đối tác không quyền về trang chủ [test: apps/workspace-web/src/features/auth/lib/guard.test.ts » bouncesHome]
- Kịch bản: đối tác ⇒ gói SHT luôn tắt ở khung ứng dụng [test: apps/workspace-web/src/shell/packs-for.test.ts » packsFor]
- Kịch bản: chữ chuông gọn [test: apps/hub-api/src/modules/packs/community/domain/notify.rules.test.ts » chữ chuông gọn]
