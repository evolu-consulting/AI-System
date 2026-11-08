# hang cho duyet bai

Cập nhật: 2026-11-08 · Nguồn: CR-125.

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Bài không kẹt "đang kiểm tra" khi flow không mở được lượt (nguồn: cr125-ux-s5-community-queue)
Cờ FLOW_TRIGGERS bật mà sự kiện `post.created` chốt không mở được lượt (chưa gán flow, thiếu nhóm duyệt, hết lượt thử) ⇒ bài chuyển ngay sang người duyệt với lý do "AI chưa kiểm được — chuyển người duyệt"; lượt AI treo quá 60 giây cũng vào hàng chờ.
- Kịch bản: sự kiện không mở được lượt ⇒ bài `mod_screen = error`, hàng chờ có Duyệt/Ẩn, gọi lại không đổi [test: apps/hub-api/src/modules/packs/community-flow-events.int.test.ts » UX-S5 · cờ bật, sự kiện chốt mà không mở được lượt ⇒ bài sang người duyệt NGAY (không kẹt 'đang kiểm tra'), duyệt/ẩn được]
- Kịch bản: lý do hiển thị cho quản trị và tác giả [test: apps/workspace-web/src/modules/community/domain/flows.test.ts » UX-S5 · tác giả: AI chưa kiểm được ⇒ nói rõ lý do chuyển người duyệt và biết còn bài chờ]

#### Yêu cầu: Quản trị Community có hàng "Bài chờ duyệt" (Duyệt / Ẩn) và tác giả thấy trạng thái bài (nguồn: cr125-ux-s5-community-queue)
Menu quản trị có "Bài chờ duyệt" kèm số bài chờ; mở bài ⇒ Duyệt (hiện) hoặc Ẩn kèm lý do; tác giả thấy "Đang chờ duyệt", "Đã đăng", "Đã ẩn — lý do".
- Kịch bản: đăng → quản trị Duyệt → bài hiện, tác giả thấy "Đã đăng" [test: e2e/community-web/flows.queue.cs.ts » 1 · đăng ⇒ Đang chờ duyệt ⇒ quản trị Duyệt ở Bài chờ duyệt ⇒ bài hiện, tác giả thấy Đã đăng]
- Kịch bản: đăng → quản trị Ẩn kèm lý do → bài không lên bảng tin, tác giả thấy "Đã ẩn — lý do" [test: e2e/community-web/flows.queue.cs.ts » 2 · đăng ⇒ quản trị Ẩn kèm lý do ⇒ bài không lên bảng tin, tác giả thấy Đã ẩn — lý do]

#### Yêu cầu: Gợi ý hàng hoá trong khung đăng bài ghi rõ là gợi ý mẫu (nguồn: cr125-ux-s5-community-queue)
Danh sách gợi ý của chủ quản ghi "Gợi ý mẫu (chưa phải sản phẩm của công ty)" để không bị hiểu là dữ liệu công ty khác.
- Kịch bản: nhãn ô gợi ý [test: thủ công — nhãn i18n, kiểm bằng ảnh chụp UAT cuối CR-125]

