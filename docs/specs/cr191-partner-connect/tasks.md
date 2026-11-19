---
id: cr191-partner-connect
lát: cr191-partner-connect
cr: CR-191
làn: đầy đủ
migration: hub 0168 + 0170 · pack-contracts 0129
phụ thuộc: cr187-pw-and-discover, cr191-feed-merge-rls
---
## Plan (ngắn)
BR-191-9/10/11. Máy chủ: cài đặt «Ai được tìm và mời đối tác mới» (`contracts.connect_settings`, vắng = `admin`) thay ràng buộc cứng «Toàn quyền» của `hub.cc_invite`; `cc_search` mở rộng theo quyền; `cc_decline` (lý do), `cc_withdraw`, `cc_company_page`. Web: SHT › Đối tác gom «Yêu cầu kết nối» · «Lời mời đã gửi» · cài đặt (+ thẻ công tắc «cho tìm thấy» đã có) và trang công ty trong hộp tìm.

## Làm
- [x] hub 0168 + contracts 0129 (chỉ thêm), journal.
- [x] Route `/pack/contracts/connect`: `GET settings`, `PUT settings` (quản trị), `GET companies/:id`, `DELETE invites/:id` (thu hồi), `decline` nhận `reason`; xem/tìm/mời đi guard `read` + DB quyết định theo cài đặt (mời không được ⇒ 403 + lý do).
- [x] Web: `ConnectRequestsPanel` (yêu cầu, lời mời đã gửi, cài đặt, khoá + lý do cho vai khác), `CompanyPageDialog`, `ConnectSearchDialog` (nhãn «chỉ tìm đối tác đã kết nối», «Xem trang công ty»), `ConnectedPanel` cho mọi vai xem.
- [x] int quyền (N2) + unit use case; sửa `e2e/cr161/ket-noi-cong-ty.spec.ts` (J2, J6) + e2e mới CR191-J1.
- [x] Người dùng chốt «quản trị» = quản trị Sổ Hợp Tác cho MỌI khối: thẻ «cho tìm thấy» đi qua `GET/PUT /pack/contracts/connect/listing` (hub 0170 `cc_listing`/`cc_set_listed`, DEFINER kiểm Toàn quyền + tên pháp lý + MST, audit cùng tx); API admin cũ giữ cho quản trị nền tảng.
- [ ] «Yêu cầu tham gia» của Community chuyển về SHT › Đối tác (Q4) — xem «Việc còn lại».

## Không làm / Chạm
Không đụng `posts_visible`/`feed_connected`; không đổi ảnh bìa CR-192 (chỉ đọc `contracts.company_settings.cover`); không báo bên mời khi bị từ chối (Q3 CR-161).

## Test tối thiểu
`connect.routes.int.test.ts` (evotest int, 32 pass cùng `connected-posts.int.test.ts`), `connect.usecase.test.ts`; e2e `ket-noi-cong-ty.spec.ts` viết, KHÔNG chạy trong lát.

## Quyết định trong lúc làm
- Người dùng chốt (thay quyết định trước của điều phối): «quản trị» ở MỌI khối SHT › Đối tác, kể cả thẻ «Cho công ty khác tìm thấy công ty mình» = người có quyền quản trị Sổ Hợp Tác của chính công ty (guard `admin`, Toàn quyền), KHÔNG dùng `tenant_admin`. Thẻ cũ đọc/ghi qua route gói contracts; vai khác thấy công tắc khoá + lý do. Hệ quả: `tenant_admin` không có quyền SHT thì 403; thẻ không còn ẩn với vai khác.
- Đổi cờ qua hub 0170 không bắn sự kiện `changed` của admin-api (chỉ tăng `version`/`updated_at`/`updated_by`); không có cache nào đọc cờ này ngoài `hub.cc_*` (đọc bảng mỗi lần).
- «Mọi nhân viên» = mọi người nội bộ đang dùng của công ty và có quyền xem gói (route `read`); DB kiểm lại ở `cc_can_invite`.
- Người không có quyền tìm: vẫn thấy công ty ĐÃ kết nối (kể cả không bật «cho tìm thấy»), không thấy gì khác.
- Từ chối lưu `connect_decline_reason` nhưng bên mời KHÔNG được báo/xem (giữ Q3 CR-161). Thu hồi xoá dòng nếu dòng chỉ sinh từ lời mời, còn thư giữ ở hộp thư thì chỉ gỡ phần kết nối.
- Trang công ty chưa có «giới thiệu» và «ngành»: không có nguồn dữ liệu nào (không cột nào trong admin/contracts) và chưa có màn sửa ⇒ không bịa cột; chỉ bìa, tên, MST, xác minh, địa chỉ. Bìa đọc từ `contracts.company_settings.cover`, không đọc được (RLS) ⇒ dải màu mặc định.
- `InviteBanner` còn dùng ở Hộp thư đối tác (từ chối không lý do); trang Đối tác dùng khối mới.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/ket-noi-doi-tac.md
#### Yêu cầu: Ai được tìm và mời đối tác mới
Cài đặt công ty (người Toàn quyền Sổ Hợp Tác đổi được) có hai mức: «Chỉ quản trị công ty» (mặc định) và «Mọi nhân viên». Người có quyền tìm được cả công ty chưa kết nối đã bật «cho tìm thấy», mở trang công ty (bìa, tên, MST, nơi; không có bài) và «Mời kết nối» kèm lời nhắn; người khác chỉ tìm đối tác đã kết nối. Chỉ quản trị đổi cài đặt.
- Kịch bản: khi cài đặt là «Chỉ quản trị công ty» thì nhân viên chỉ tìm thấy đối tác đã kết nối và mời bị 403 [test: apps/hub-api/src/modules/packs/contracts/connect/connect.routes.int.test.ts » mặc định «Chỉ quản trị công ty»: Vy (nhân viên) xem được cài đặt + đối tác đã kết nối, KHÔNG tìm thấy công ty chưa kết nối, KHÔNG mời được (403 + 0 dòng đổi)]
- Kịch bản: khi quản trị chọn «Mọi nhân viên» thì nhân viên tìm và mời được, nhưng thu hồi và đổi cài đặt vẫn chỉ quản trị [test: apps/hub-api/src/modules/packs/contracts/connect/connect.routes.int.test.ts » «Mọi nhân viên» cho Vy tìm + mời, thu hồi và đổi cài đặt vẫn chỉ quản trị, Tiên thu hồi ⇒ dòng mất, đổi lại «Chỉ quản trị» ⇒ Vy lại 403]
- Kịch bản: khi một công ty đổi cài đặt thì công ty khác không bị ảnh hưởng [test: apps/hub-api/src/modules/packs/contracts/connect/connect.routes.int.test.ts » cài đặt của công ty này không đổi công ty khác (A «Mọi nhân viên» không cho nhân viên B mời)]
- Kịch bản: khi mở trang công ty thì chỉ công ty đã kết nối hoặc đã bật «cho tìm thấy» (người được phép) mở được [test: apps/hub-api/src/modules/packs/contracts/connect/connect.routes.int.test.ts » trang công ty: Vy chỉ mở công ty đã kết nối, Tiên mở cả công ty bật «cho tìm thấy», công ty tắt «cho tìm thấy» ⇒ 404 với cả hai]
- Kịch bản: khi quản trị đổi cài đặt thì nhân viên thấy hộp tìm đổi theo [test: e2e/cr161/ket-noi-cong-ty.spec.ts » CR191-J1 · Tiên (quản trị) đổi «Ai được tìm và mời đối tác mới» sang «Mọi nhân viên» ⇒ Vy (nhân viên) được tìm và mời, đổi lại ⇒ Vy hết được]

#### Yêu cầu: Yêu cầu kết nối và lời mời đã gửi
Trang Đối tác có «Yêu cầu kết nối» (Đồng ý / Từ chối kèm lý do ≤ 300) và «Lời mời đã gửi» (Thu hồi). Chỉ quản trị công ty bấm được; vai khác thấy nút khoá kèm lý do và máy chủ trả 403. Đồng ý ⇒ bài họ vào bảng tin ngay (đã có qua `cc_connected_ids`).
- Kịch bản: khi quản trị công ty nhận từ chối kèm lý do thì lý do được lưu, quá 300 ký tự bị 400 [test: apps/hub-api/src/modules/packs/contracts/connect/connect.routes.int.test.ts » từ chối kèm lý do (Hùng, quản trị H, không phải người mời): lưu lý do, lý do > 300 ⇒ 400]
- Kịch bản: khi nhân viên bấm mời, đồng ý, từ chối, thu hồi, ngắt hoặc đổi cài đặt thì 403 và không đổi dữ liệu [test: apps/hub-api/src/modules/packs/contracts/connect/connect.routes.int.test.ts » nhân viên (Vy) mời, đồng ý, từ chối, thu hồi, ngắt, đổi cài đặt ⇒ 403 PACK_FORBIDDEN, không đổi dòng nào]
- Kịch bản: khi nhân viên mở trang Đối tác thì thấy đối tác đã kết nối, cài đặt và nút ghi bị khoá kèm lý do [test: e2e/cr161/ket-noi-cong-ty.spec.ts » CR161-J6 · CR-191: Vy (nhân viên NitiGroup) xem được đối tác đã kết nối nhưng mọi nút ghi bị khoá kèm lý do, 403 ở máy chủ]
- Kịch bản: khi người Toàn quyền khác người mời nhận lời mời thì thấy trong «Yêu cầu kết nối» và Đồng ý được [test: e2e/cr161/ket-noi-cong-ty.spec.ts » CR161-J2 · Dung (Preschool, Toàn quyền, không phải người mời) thấy chuông + băng lời mời kèm lời nhắn, bấm Đồng ý]

#### Yêu cầu: Công tắc «Cho công ty khác tìm thấy công ty mình» do quản trị Sổ Hợp Tác đổi
Người có quyền quản trị Sổ Hợp Tác của chính công ty bật/tắt công tắc (cần tên pháp lý + MST khi bật); vai khác thấy công tắc khoá kèm lý do; người chỉ có vai quản trị công ty nhưng không thuộc nhóm Toàn quyền Sổ Hợp Tác bị 403. Sửa nghĩa so với BR-187-5 (trước đây `tenant_admin`).
- Kịch bản: khi quản trị Sổ Hợp Tác tắt rồi bật thì cờ đổi, có audit, nhân viên bị 403 và cờ không đổi [test: apps/hub-api/src/modules/packs/contracts/connect/connect.routes.int.test.ts » Tiên (quản trị SHT) tắt/bật được, version tăng, có audit, Vy (nhân viên) xem được nhưng PUT ⇒ 403 + không đổi]
- Kịch bản: khi người không thuộc nhóm Toàn quyền Sổ Hợp Tác hoặc công ty thiếu MST thì không bật được [test: apps/hub-api/src/modules/packs/contracts/connect/connect.routes.int.test.ts » người chỉ có vai quản trị công ty (tenant_admin) mà không thuộc nhóm Toàn quyền Sổ Hợp Tác ⇒ 403, không bật được khi thiếu MST (422)]
- Kịch bản: khi đủ hồ sơ thì công tắc bật được, thiếu MST thì khoá kèm lý do, vai khác thì khoá kèm lý do [test: apps/workspace-web/src/features/partners/lib/discoverable.test.ts » quản trị Sổ Hợp Tác + đủ tên pháp lý + MST ⇒ bật được]
- Kịch bản: khi nhân viên mở trang Đối tác thì thấy công tắc khoá [test: e2e/contracts-web/cr187-discover.cw.ts » vai khác (nhân viên) thấy công tắc khoá kèm lý do]

## Việc còn lại
- «Yêu cầu tham gia» (Q4): `modules/community/ui/flows/JoinRequests.tsx` dựa vào ngữ cảnh `useApp` của module Community, chưa nhúng được vào trang Đối tác mà không dựng lại ngữ cảnh; cần một lát riêng (nhúng + chuyển hướng `route join` + sửa e2e community liên quan). Chưa làm.
- Giới thiệu/ngành của công ty trên trang công ty: chưa có nguồn dữ liệu (cần CR hồ sơ công ty).
- Chưa chạy e2e (điều phối chạy cuối đợt); chưa soát UI góc người dùng (G4).
