---
id: cr191-cross-person-card
lát: cr191-cross-person-card
cr: CR-191
làn: đầy đủ
migration: hub 0171
phụ thuộc: cr191-feed-merge-rls
---
## Plan (ngắn)
Thẻ người CHÉO công ty (BR-191-13): hàm DEFINER `hub.cc_person_cards(uuid[])` (≤ 50 id) chỉ trả họ tên, chức vụ, ảnh, tên công ty cho người nội bộ thuộc công ty ĐÃ KẾT NỐI (`hub.cc_connected_ids()`); `GET /people?ids=` nối thêm vào cùng MỘT câu (UNION ALL). Web dùng ảnh thật: tác giả bài bảng tin, danh sách người trang Tin nhắn (danh sách + đầu khung chat đã dùng thẻ), thẻ phòng sơ đồ tổ chức.

## Làm
- [x] Hub `0171_cr191_cc_person_cards` (DEFINER, GRANT chỉ `hub_rw`, journal idx sau 0170) — người gọi lấy từ GUC; người gọi external ⇒ rỗng; không raise cho id ngoài phạm vi.
- [x] `people.repo.cardsOf`: nối `hub.cc_person_cards` (một câu); người gọi external theo token ⇒ không nối. Contract `PersonCard.company_name?` (chỉ thẻ chéo).
- [x] Contract `PostView.authorUserId?` (chỉ người xem nội bộ) + `views.postView`.
- [x] Web: `community/application/use-people-cards.ts` + `Feed` → `PostCard avatar`; danh bạ Tin nhắn (`DirGroup`/`ConversationRow`, đầu khung chat) đã nhận `card.avatar` từ `usePersonCards` ⇒ tự có ảnh chéo công ty (không sửa code); sơ đồ tổ chức `OrgChartBody` → `OrgChartPerson.avatar` (trưởng phòng + hàng avatar).

## Không làm / Chạm
- Không làm: «@» (`MentionPicker`, chưa nối ảnh); ảnh tác giả bài ĐỐI TÁC (`feed_connected` chưa trả `author_user_id` — cần migration pack-community, xem Việc còn lại); bình luận chéo.
- Chạm: `packages/db/migrations-hub/0171*`, `apps/hub-api/src/modules/people/*`, `packages/contracts/src/{people,pack-community/post}.ts`, `…/community/adapters/views.ts`, web (community Feed/PostCard, workspace-web org-chart, flow-canvas OrgChart).

## Test tối thiểu
- int `apps/hub-api/src/modules/people/people-cross.int.test.ts` (evotest); `people.int.test.ts` không đổi (vẫn xanh).
- unit `…/community/adapters/views.author-id.test.ts`.

## Quyết định trong lúc làm
- Đổi số giao: hub 0171, `when` 1806904600000 (điều phối đổi từ 0169).
- Người ngoài phạm vi ⇒ bỏ qua (không raise); chỉ lỗi 42501 khi chưa đặt người xem (hub scope `system`).
- Chỉ người nội bộ của công ty kết nối (`kind <> 'external'`); không lọc `active` (bài cũ của người đã nghỉ vẫn có tên/ảnh như đường nội bộ).
- Tên công ty = `legal_name` rồi `name` (như danh bạ Tin nhắn). Người cùng công ty: không có `company_name` (luật cũ giữ nguyên).
- `authorUserId` chỉ gắn khi người xem là chủ quản (`a.org === null`) để đối tác cộng đồng không nhận mã nhân viên.
- Sơ đồ tổ chức: thẻ người tối đa 50/lần ⇒ ưu tiên trưởng phòng, rồi 5 nhân viên đầu mỗi phòng.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED hub/the-nguoi-cheo-cong-ty.md
#### Yêu cầu: Thẻ người công ty đã kết nối chỉ gồm tên, chức vụ, ảnh, công ty
Người nội bộ xem được họ tên, chức vụ, ảnh đại diện và tên công ty của nhân viên công ty ĐÃ KẾT NỐI (hai chiều, không chặn); không có email, điện thoại hay thông tin khác. Công ty chưa kết nối, đã ngắt, một chiều, bị chặn, người dùng ngoài của công ty đó hoặc mã lạ đều bị bỏ qua, không báo lỗi. Người gọi là người dùng ngoài không nhận thẻ chéo công ty.
- Kịch bản: khi công ty đã kết nối thì thẻ có ảnh, tên, chức vụ, tên công ty [test: apps/hub-api/src/modules/people/people-cross.int.test.ts » người công ty ĐÃ KẾT NỐI ⇒ có ảnh, họ tên, chức vụ, tên công ty (ưu tiên tên pháp lý), N2 · người xem không phải chủ ảnh]
- Kịch bản: khi công ty chưa kết nối, một chiều, người ngoài hoặc mã lạ thì bị bỏ qua [test: apps/hub-api/src/modules/people/people-cross.int.test.ts » công ty chưa kết nối / một chiều / người dùng ngoài của công ty kết nối / id lạ ⇒ bỏ qua, không lỗi, không lộ]
- Kịch bản: khi người cùng công ty thì giữ luật cũ, không có tên công ty [test: apps/hub-api/src/modules/people/people-cross.int.test.ts » người cùng công ty vẫn theo luật cũ (không có company_name), người ngoài của chính mình vẫn thấy]
- Kịch bản: khi ngắt hoặc chặn kết nối thì mất ngay, nối lại thì hiện lại [test: apps/hub-api/src/modules/people/people-cross.int.test.ts » ngắt kết nối hoặc bị chặn ⇒ mất ngay, nối lại ⇒ hiện lại (không cache)]
- Kịch bản: khi người gọi là người dùng ngoài thì không có thẻ chéo công ty [test: apps/hub-api/src/modules/people/people-cross.int.test.ts » người gọi là người dùng ngoài (token hoặc DB) ⇒ không có thẻ chéo công ty]
- Kịch bản: khi đọc thẻ chéo công ty thì không có email hoặc điện thoại [test: apps/hub-api/src/modules/people/people-cross.int.test.ts » chỉ trả họ tên, chức vụ, ảnh, tên công ty — KHÔNG email/điện thoại/cột khác]
- Kịch bản: khi đọc lô 50 người thì chỉ một câu SQL [test: apps/hub-api/src/modules/people/people-cross.int.test.ts » perf · MỘT câu SQL cho cả lô 50 id, p95 in số thật]

### ADDED community/ma-nguoi-dang.md
#### Yêu cầu: Bài có mã người đăng cho người xem nội bộ để hiện ảnh thật
Bài trên bảng tin có mã người đăng khi người xem là nhân viên chủ quản; đối tác cộng đồng không nhận mã này.
- Kịch bản: khi người xem nội bộ thì bài có mã người đăng, đối tác cộng đồng thì không [test: apps/hub-api/src/modules/packs/community/adapters/views.author-id.test.ts » người xem nội bộ nhận mã người đăng, đối tác cộng đồng không nhận]

## Việc còn lại
- Ảnh tác giả bài ĐỐI TÁC trên bảng tin: `community.feed_connected` (community 0026) chưa trả `author_user_id` ⇒ cần migration pack-community mới (DROP/CREATE hàm thêm cột) + `ConnectedRow`/`connectedView` gắn `authorUserId` (web đã nối sẵn, chỉ cần dữ liệu). Cần điều phối giao số (gộp với lát `cr191-cross-comment` nếu cùng đụng hàm). Bình luận chéo cùng cách.
- «@» (`MentionPicker`) chưa hiện ảnh: nối `usePeopleCards` (community) vào danh sách khi có thời gian.
- Sơ đồ tổ chức dạng danh sách điện thoại (`org-member-cards`) chưa nối ảnh.
- e2e: điều phối chạy cuối đợt (chưa viết e2e riêng cho lát này).
