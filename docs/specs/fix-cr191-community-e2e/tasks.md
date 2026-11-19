---
id: fix-cr191-community-e2e
lát: fix-cr191-community-e2e
cr: CR-191
làn: nhanh
migration: không
phụ thuộc: cr191-cross-comment
---
## Plan (ngắn)
Sửa lỗi e2e cuối đợt trong vùng bình luận chéo: seed demo gọi `comments.add` theo chữ ký cũ ⇒ `postState(undefined)` ⇒ SQL vỡ, sập webServer job community-web-stack; bài «Đối tác» còn «Báo cáo»; e2e CR191-C2 bấm đóng luồng đã mở sẵn.

## Làm
- [x] `tools/scripts/src/seed-community-demo.apply.ts`: gọi `comments.add(uow, a, { postId, … })` (chữ ký mới của lát cr191-cross-comment). Gốc: lát trước chỉ `tsc` gói hub-api, không `tools/scripts`.
- [x] `post-write.repo.ts` `postState`: id không phải UUID ⇒ null, không chạy SQL (chặn tầng rẻ).
- [x] Web: `canReportPost` (domain) — bài công ty đã kết nối không có «Báo cáo».
- [x] e2e: `binh-luan-cheo-cr191.spec.ts` mở luồng chỉ khi chưa mở (lỗi test: bài có bình luận đã mở sẵn); `cr191-feed-ui.cm.ts` thêm kỳ vọng không Báo cáo/Sửa/Xoá.

## Không làm / Chạm
- Không đổi máy chủ cho tên công ty bình luận chéo: đã trả đúng (int khẳng định chặt hơn); đỏ e2e do test bấm đóng luồng.

## Test tối thiểu
- unit `post-write.repo.test.ts`, `feed-source.test.ts`; int `cross-comment.int.test.ts`, `tools/scripts/src/seed-community-demo.int.test.ts`; `tsc` hub-api, workspace-web, tools/scripts.

## Quyết định trong lúc làm
- «Báo cáo» bài công ty kết nối bỏ hẳn (kiểm duyệt thuộc công ty đăng); bình luận giữ (BR-191-12).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Bài của công ty đã kết nối không có «Báo cáo»
Bài «Đối tác» (công ty đã kết nối) chỉ có bình luận; không có Báo cáo, Sửa, Xoá.
- Kịch bản: khi xem bài công ty đã kết nối thì không có «Báo cáo» [test: apps/workspace-web/src/modules/community/domain/feed-source.test.ts » bài công ty đã kết nối ⇒ không «Báo cáo» (kiểm duyệt thuộc công ty đăng), bài đối tác cộng đồng ⇒ có, bài công ty mình ⇒ không]
- Kịch bản: khi mã bài không hợp lệ thì không chạy câu SQL vỡ [test: apps/hub-api/src/modules/packs/community/adapters/post-write.repo.test.ts » id không phải UUID (undefined / chuỗi rỗng / chữ) ⇒ null, không gọi SQL]

## Việc còn lại
- e2e chưa chạy lại (điều phối).
