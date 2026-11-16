---
id: cr178-m1-ui
lát: cr178-m1-ui
cr: CR-178
làn: nhanh
migration: không
phụ thuộc: cr178-api
---
# cr178-m1-ui — M1 giao diện «Tin nhắn»: danh sách một kiểu + khung chat mới

Nguồn: `docs/CHANGE-REQUESTS.md` CR-178; mockup đã duyệt mục ①–⑧; hành vi cũ `docs/current/pack-contracts/tin-nhan.md` mục 5.
Chỉ đổi gói `packages/messages-web` (+ chuỗi i18n); không đổi API/hub-api/migration. Không làm: tìm nội dung tin, Ảnh & tệp, xem trước, emoji, dán ảnh (lát sau).

## Plan (ngắn)
Luật thuần mới ở `lib/` (có unit) → thanh 3 tab + dòng danh sách → khung chat (nhóm tin, vạch chưa đọc, nút nổi, «Đã xem» avatar, «⋯») → ô soạn 2 tầng → «Nhắn tin mới» 2 tab.

## Làm
- [x] 1. Danh sách MỘT kiểu (gần đây): `ListTabs` «Tất cả · Chưa đọc (n) · Đối tác ▾» thay hàng chip; «Chưa đọc» gọi `unread=true`; bỏ danh bạ phòng ban khỏi danh sách
- [x] 2. Nhãn công ty (Badge `warn` của kit) ở dòng danh sách + đầu khung chat; avatar công ty vuông (kit Avatar)
- [x] 3. «Nhắn tin mới»: tab «Công ty mình» (theo phòng ban, nhiều người ⇒ nhóm, «Tên nhóm» ≥ 2, ≤ 50) / «Đối tác» (chọn công ty, 1 người); chip ở «Tới:»
- [x] 4. Khung chat: gộp tin cùng người, giờ dưới tin cuối nhóm, vạch «Tin chưa đọc», nút «↓ n tin mới», «Đã xem» bằng avatar (≤ 3 + «+N»)
- [x] 5. «⋯» trên tin (Sao chép · Thu hồi) + giữ tay ~0,5 giây trên cảm ứng
- [x] 6. «Bảng tin <Công ty>» ở đầu khung chat cuộc `partner`; bỏ nút ở đầu danh sách
- [x] 7. Ô soạn: chữ trên, hàng nút cố định ở đáy, cao ≤ ~6 dòng (chừa chỗ emoji cho M2)
- [x] 8. i18n vi + en (`contracts.messages.*`, khoá mới: tabAll, tabUnread, tabPartner, unreadDivider, newBelow, msgMore, copy, copied, toLabel, tabOwn…)
- [x] Test: `packages/messages-web/src/lib/cr178.test.ts`; e2e đã sửa (CHƯA chạy): j18, j19, j20, cr161, cr169, smoke-journey

## Không làm / Chạm
Chạm: `packages/messages-web/src/**`, `packages/i18n/locales/contracts/messages.{vi,en}.json`, `e2e/{cr127,cr161,cr169,smoke-journey}`. Không chạm `apps/workspace-web/src/features/shell/**`, `packages/web-kit/src/ui/kit/**`, `tools/scripts`.
Gỡ khỏi UI: `CompanyFilter.tsx`, `DirectorySections.tsx`. `lib/directory.ts`/`collapse.ts`/`company-filter.ts` còn (test cũ còn xanh) nhưng không còn nơi dùng ⇒ dọn ở lát sau (ghi TECH-DEBT nếu cần).

## Test tối thiểu
`bun test packages/messages-web` · `tsc --noEmit` cho messages-web, workspace-web, chat-web · biome file sửa.

## Quyết định trong lúc làm
- `?company=` id đối tác ⇒ tab «Đối tác» đã chọn công ty đó; `own`/rỗng/công ty mình ⇒ «Tất cả» (danh sách gần đây; mặc định CR-172 «công ty mình = danh bạ» không còn).
- Tab «Đối tác» chưa chọn công ty thì bấm chỉ mở menu (API không có «mọi đối tác»); chọn xong tab hiện tên công ty.
- Số trên tab «Chưa đọc» = tổng chưa đọc của người dùng (`GET /messages/unread`, cùng số với menu), không đếm theo trang.
- Gộp tin: cùng người, cách ≤ 5 phút (hằng `GROUP_GAP_MS`); vạch «Tin chưa đọc» luôn mở nhóm mới; vạch tính một lần theo mốc đọc lúc mở cuộc.
- Mở cuộc có tin chưa đọc ⇒ cuộn tới vạch; không có ⇒ xuống đáy. Đang cuộn lên mà có tin của người khác ⇒ không kéo xuống, hiện «↓ n tin mới».
- «Thu hồi» vẫn qua `confirmDialog` của app (hộp xác nhận kiểu lệnh, danger) — giữ cách hỏi lại hiện hành thay vì nối `AlertDialog` kit vào host.
- Menu «⋯» dùng DropdownMenu kit cho cả máy tính và cảm ứng (giữ tay mở cùng menu), chưa làm Sheet riêng.
- «Đối tác» trong «Nhắn tin mới»: chọn công ty bằng ô chọn rồi chọn người (không gom mọi công ty trong một cây) để mỗi lần chỉ tải một công ty.
- Dòng danh sách dùng kit `Avatar`; thẻ người rê chuột (`PersonTip`) giữ nguyên cho 1-1 nội bộ.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tin-nhan.md

#### Yêu cầu: Màn «Tin nhắn» toàn màn, menu có số chưa đọc
«Tin nhắn» (sau «Yêu cầu») có số đỏ tổng chưa đọc. Danh sách MỘT kiểu: cuộc gần đây, mới nhất trước, tải dần; cuộc chưa đọc in đậm kèm số (đến 99, «99+»). Thanh lọc 3 tab «Tất cả · Chưa đọc (n) · Đối tác ▾»: «Chưa đọc» gọi `unread=true` (số n = tổng chưa đọc); «Đối tác» mở menu công ty đã kết nối, chọn xong chỉ hiện cuộc với công ty đó. Cuộc `partner` có nhãn công ty (cam) cạnh tên và avatar công ty vuông; người avatar tròn. Ô tìm lọc người/nhóm theo tên không dấu. Danh bạ theo phòng ban và «Bảng tin» không còn ở danh sách.
- Kịch bản: tab Tất cả/Chưa đọc/Đối tác ⇒ bộ lọc gửi lên API đúng (Chưa đọc ⇒ unread; Đối tác chọn công ty ⇒ company) [test: packages/messages-web/src/lib/cr178.test.ts » CR-178 · tab danh sách]
- Kịch bản: `?company=` đối tác ⇒ tab Đối tác; own/rỗng ⇒ Tất cả [test: packages/messages-web/src/lib/cr178.test.ts » ?company= đối tác ⇒ tab Đối tác]
- Kịch bản: người được giao (không phải người tạo) thấy cuộc ở «Chưa đọc», mở thì hết [test: e2e/cr127/j18-tin-nhan.spec.ts » A nhắn B: B thấy chưa đọc, mở thì hết, A thấy «Đã xem»]
- Kịch bản: nhãn công ty đối tác ở dòng danh sách và đầu khung chat [test: e2e/cr169/tin-nhan-cong-ty.spec.ts » CR169-J2]
- Kịch bản: lọc đối tác + tìm theo tên không dấu [test: e2e/cr169/tin-nhan-cong-ty.spec.ts » CR169-J3]

#### Yêu cầu: «Nhắn tin mới» tạo 1-1 hoặc nhóm
Hộp có 2 tab. «Công ty mình»: danh bạ theo phòng ban («Chưa có phòng» cuối), chọn 1 người ⇒ nhắn riêng, từ 2 ⇒ «Tên nhóm» bắt buộc + «Tạo nhóm», tối đa 50 người (chọn quá ⇒ báo nhóm đầy). «Đối tác»: chọn công ty đã kết nối rồi 1 người ⇒ nhắn riêng; nhóm chỉ nội bộ. Người đã chọn hiện thành chip ở ô «Tới:» (bấm × để bỏ); đổi tab ⇒ bỏ chọn. Lỗi API hiện câu theo mã.
- Kịch bản: chọn nhiều/bấm lại bỏ/tối đa 49; đối tác chỉ một người, chọn người khác thì thay [test: packages/messages-web/src/lib/cr178.test.ts » CR-178 · hộp «Nhắn tin mới»]
- Kịch bản: «Tên nhóm» bắt buộc khi ≥ 2; 1 ⇒ direct, ≥ 2 ⇒ group, đối tác ⇒ partner; gom phòng ban A→Z [test: packages/messages-web/src/lib/cr178.test.ts » kế hoạch tạo: 1 người ⇒ direct, ≥ 2 ⇒ group, đối tác ⇒ partner, chưa chọn ⇒ none]
- Kịch bản: nhân viên chọn theo phòng ban, chip «Tới:», nhắn riêng; chọn 2 ⇒ «Tên nhóm»; tab Đối tác không có nhóm [test: e2e/cr127/j20-tin-nhan-danh-ba.spec.ts » «Nhắn tin mới»: chọn ≥ 2 người ⇒ «Tên nhóm» bắt buộc]

#### Yêu cầu: Khung chat — theo ngày, gửi, thu hồi, «Đã xem», quyền theo vai
Tin theo ngày, tải thêm theo trang; tin đang gửi mờ, lỗi bấm gửi lại. Tin liên tiếp cùng người (cách ≤ 5 phút) gộp thành nhóm: avatar + tên một lần (nhóm chat), giờ hiện dưới tin cuối của nhóm (không cần rê chuột). Vạch «Tin chưa đọc» ở tin đầu của người khác sau mốc đọc lúc mở cuộc; mở cuộc có tin chưa đọc ⇒ cuộn tới vạch. Đang cuộn lên mà có tin mới của người khác ⇒ không kéo xuống, hiện nút «↓ n tin mới». «Đã xem» là avatar nhỏ của người đã đọc tới tin cuối của mình (nhóm: tối đa 3 + «+N»). Nút «⋯» trên tin (rê chuột/focus; giữ tay trên điện thoại): «Sao chép» (kèm toast «Đã sao chép») cho tin còn chữ; «Thu hồi» chỉ tin của mình, vẫn hỏi lại vì người khác mất nội dung. Cuộc `partner` có nhãn công ty và nút «Bảng tin <Công ty>» ở đầu khung chat; cuộc chỉ đọc thay ô soạn bằng câu giải thích. Chỉ chủ nhóm đổi tên/thêm/bớt, mọi thành viên rời. Ô soạn: chữ ở trên, hàng nút cố định ở đáy (đính kèm trái, Gửi phải), cao tối đa ~6 dòng rồi cuộn.
- Kịch bản: cùng người ≤ 5 phút ⇒ một nhóm, giờ ở tin cuối; đổi người/quá 5 phút/vạch ⇒ tách nhóm [test: packages/messages-web/src/lib/cr178.test.ts » CR-178 · gộp tin liên tiếp cùng người]
- Kịch bản: vạch «Tin chưa đọc» đúng mốc; đã đọc hết ⇒ không vạch [test: packages/messages-web/src/lib/cr178.test.ts » CR-178 · vạch «Tin chưa đọc» và «n tin mới»]
- Kịch bản: đếm «n tin mới» chỉ tin của người khác chưa thu hồi [test: packages/messages-web/src/lib/cr178.test.ts » đếm tin mới của người khác sau mốc đã thấy (bỏ tin mình, tin thu hồi)]
- Kịch bản: «Đã xem» chỉ người khác đã đọc tới tin cuối của mình [test: packages/messages-web/src/lib/cr178.test.ts » CR-178 · «Đã xem» bằng avatar]
- Kịch bản: người nhận chỉ có «Sao chép», người gửi có thêm «Thu hồi»; tin thu hồi không có thao tác [test: packages/messages-web/src/lib/cr178.test.ts » CR-178 · «⋯» trên tin: quyền hiện Sao chép / Thu hồi]
- Kịch bản: giờ dưới tin cuối, «Đã xem» avatar, «⋯» Sao chép/Thu hồi theo vai (người nhận khác người gửi) [test: e2e/cr127/j18-tin-nhan.spec.ts » A nhắn B: B thấy chưa đọc, mở thì hết, A thấy «Đã xem»]
- Kịch bản: Hà (người nhận) chỉ có «Sao chép», Vy thu hồi qua «⋯» ⇒ hai bên chỉ còn «Tin nhắn đã được thu hồi» [test: e2e/cr169/tin-nhan-cong-ty.spec.ts » CR169-J4]
- Kịch bản: «Bảng tin <Công ty>» ở đầu khung chat cuộc đối tác [test: e2e/cr169/tin-nhan-cong-ty.spec.ts » CR169-J5]
- Kịch bản: nút Gửi và Đính kèm cùng một hàng ở đáy ô soạn, dưới ô chữ [test: e2e/cr169/tin-nhan-cong-ty.spec.ts » CR172-J1]

## Việc còn lại
- Chạy e2e cuối đợt (điều phối): j18, j19, j20, cr161, cr169, smoke-journey.
- Dọn code chết sau M1: `lib/directory.ts` (`buildDirectory`), `lib/collapse.ts`, `lib/company-filter.ts` (`planChips`) cùng test cũ.
- Thiếu ở kit (làm tạm trong messages-web): ô chọn (`<select>` thường trong «Nhắn tin mới»), nút/ô tìm của danh sách vẫn dùng class `btn`/input riêng; chưa có Sheet cho menu «⋯» trên cảm ứng.
- Soát UI góc người dùng thật (G4) chưa làm: không chạy dev server/Playwright ở máy này.
