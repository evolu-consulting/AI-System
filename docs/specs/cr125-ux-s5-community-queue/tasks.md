---
id: cr125-ux-s5-community-queue
lát: cr125-ux-s5-community-queue
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
UX-S5 (C4, H9) của `docs/specs/CR-125/ux-review-ceo.md`: bài Community kẹt "Hệ thống đang kiểm tra" > 3 phút, quản trị không có hàng chờ để demo
đăng → duyệt → hiện/ẩn.

**Nguyên nhân gốc (không đổi máy trạng thái run):** cờ `FLOW_TRIGGERS` bật ⇒ agent `screen` cũ KHÔNG chạy; bài mở lượt ở
`pending/mod_screen = running` và chỉ `OutcomeHandler.launched` (khi bộ điều phối mở được run) mới chuyển bài sang "chờ người duyệt".
Community KHÔNG có `OutcomeHandler.notLaunched` (hợp đồng có) ⇒ sự kiện `post.created` chốt mà không mở được lượt (chưa gán flow, thiếu nhóm
duyệt, hết lượt thử) thì bài đứng ở `running` mãi; chỉ còn luật "quá 2 phút" tính lúc đọc, màn tác giả không tự nạp lại và không nói lý do.
(Đường khe cũ: agent AI hỏng/vắng đã đi vào duyệt đúng, không kẹt.)

## Làm
1. `notLaunched` cho `post.created` (`flow-events.repo.ts` `markPostNotLaunched`, `flow-ports.ts`): bài `pending+running` ⇒ `mod_screen = error` ngay
   ⇒ hàng chờ có nút Duyệt/Ẩn. CAS, một câu, không đụng máy trạng thái run. Hạn "AI không trả lời" 2 phút → 60 giây (`SCREEN_STALE_MS`).
2. Lý do hiển thị (quy tắc 3): "AI chưa kiểm được — chuyển người duyệt" ở hàng chờ và ở màn tác giả (`domain/flows.ts` + i18n).
3. Hàng chờ quản trị = màn `Duyệt bài` có sẵn (một nguồn, `modQueue`/`navCounts`, không bảng mới) đổi tên "Bài chờ duyệt" (menu có số), nút Duyệt / **Ẩn**;
   tự nạp lại 10 giây khi còn bài "đang kiểm tra".
4. Tác giả thấy "Đang chờ duyệt" / "Đã đăng" / "Đã ẩn — lý do"; tự nạp lại 15 giây khi còn bài chờ.
5. H9: gợi ý "Hàng hoá" là danh sách mẫu cố định của module (`DEMO_PRODUCTS`, không phải dữ liệu công ty khác) ⇒ ghi rõ "Gợi ý mẫu (chưa phải sản phẩm của công ty)".

## Không làm / Chạm
Không chạm: contracts, admin-web, DLC, engine, migration. Chạm: hub-api community (flow-events.repo/flow-ports/flow.rules), workspace-web community
(flows.ts, ReviewQueue, profile sections), i18n community + contracts.nav.review, e2e community-web.

## Test tối thiểu
- unit: `flows.test.ts` (mapper lý do/trạng thái), `flow.rules.test.ts` (hạn stale theo hằng).
- int: `community-flow-events.int.test.ts` (notLaunched ⇒ hàng chờ có nút, tác giả thấy chờ người duyệt, Ẩn kèm lý do, CAS).
- e2e (evotest, foreground, -Dirty): `community-web-stack` (gồm `flows.cs.ts` cập nhật nhãn + mới `flows.queue.cs.ts`: đăng → quản trị Duyệt → hiện; đăng → Ẩn kèm lý do).

## Quyết định trong lúc làm
- Nút "Từ chối" của bài → "Ẩn" (khớp "Duyệt/Ẩn" của CEO); API/testid giữ nguyên (`reject`).
- Không thêm bảng/hàng đợi thứ hai: hàng chờ = `community.posts moderation = pending` (D6), số đếm menu từ `navCounts`.
- Perf: không chạm đường nóng (một câu UPDATE theo PK trong tx chốt lô của dispatcher, chỉ cho sự kiện lỗi).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/community/hang-cho-duyet-bai.md
#### Yêu cầu: Bài không kẹt "đang kiểm tra" khi flow không mở được lượt
Cờ FLOW_TRIGGERS bật mà sự kiện `post.created` chốt không mở được lượt (chưa gán flow, thiếu nhóm duyệt, hết lượt thử) ⇒ bài chuyển ngay sang người duyệt với lý do "AI chưa kiểm được — chuyển người duyệt"; lượt AI treo quá 60 giây cũng vào hàng chờ.
- Kịch bản: sự kiện không mở được lượt ⇒ bài `mod_screen = error`, hàng chờ có Duyệt/Ẩn, gọi lại không đổi [test: apps/hub-api/src/modules/packs/community-flow-events.int.test.ts » UX-S5 · cờ bật, sự kiện chốt mà không mở được lượt ⇒ bài sang người duyệt NGAY (không kẹt 'đang kiểm tra'), duyệt/ẩn được]
- Kịch bản: lý do hiển thị cho quản trị và tác giả [test: apps/workspace-web/src/modules/community/domain/flows.test.ts » UX-S5 · tác giả: AI chưa kiểm được ⇒ nói rõ lý do chuyển người duyệt và biết còn bài chờ]

#### Yêu cầu: Quản trị Community có hàng "Bài chờ duyệt" (Duyệt / Ẩn) và tác giả thấy trạng thái bài
Menu quản trị có "Bài chờ duyệt" kèm số bài chờ; mở bài ⇒ Duyệt (hiện) hoặc Ẩn kèm lý do; tác giả thấy "Đang chờ duyệt", "Đã đăng", "Đã ẩn — lý do".
- Kịch bản: đăng → quản trị Duyệt → bài hiện, tác giả thấy "Đã đăng" [test: e2e/community-web/flows.queue.cs.ts » 1 · đăng ⇒ Đang chờ duyệt ⇒ quản trị Duyệt ở Bài chờ duyệt ⇒ bài hiện, tác giả thấy Đã đăng]
- Kịch bản: đăng → quản trị Ẩn kèm lý do → bài không lên bảng tin, tác giả thấy "Đã ẩn — lý do" [test: e2e/community-web/flows.queue.cs.ts » 2 · đăng ⇒ quản trị Ẩn kèm lý do ⇒ bài không lên bảng tin, tác giả thấy Đã ẩn — lý do]

#### Yêu cầu: Gợi ý hàng hoá trong khung đăng bài ghi rõ là gợi ý mẫu
Danh sách gợi ý của chủ quản ghi "Gợi ý mẫu (chưa phải sản phẩm của công ty)" để không bị hiểu là dữ liệu công ty khác.
- Kịch bản: nhãn ô gợi ý [test: thủ công — nhãn i18n, kiểm bằng ảnh chụp UAT cuối CR-125]

## Việc còn lại
- Chạy e2e `community-web-stack` trên evotest (xem báo cáo lát).
- Tác giả vẫn thấy bài chờ duyệt trong Bảng tin của chính mình (kèm ghi chú trạng thái); tách khỏi "đã đăng" là việc sau nếu CEO vẫn muốn.
