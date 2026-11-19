---
id: cr190-msg-list-ui
lát: cr190-msg-list-ui
cr: CR-190
làn: nhanh
migration: không
phụ thuộc: cr190-msg-prefs-api, cr190-msg-directory-api, cr190-msg-chat-ui
---
## Plan (ngắn)
Cột trái trang Tin nhắn (BR-190-2..6, 8, bản mẫu phương án A): ô tìm (người, nhóm, công ty) · «Tất cả / Chưa đọc (n)» thay hàng tab cũ · danh bạ nhóm mở/thu theo thứ tự cố định do máy chủ trả (từng công ty đối tác A→Z, «Nhóm chat», «Nội bộ»), đầu nhóm có tên (cắt «…» + tooltip), tổng người, số chưa đọc; nhóm có chưa đọc mở sẵn, còn lại thu, nhớ trên máy (localStorage); 15 dòng/nhóm + «Xem thêm (n)»; dòng có avatar, tên, chức vụ, tin cuối hoặc «Chưa có tin nhắn» (không giờ), số chưa đọc, ghim; «⋯» (rê chuột; điện thoại giữ lâu) Ghim / Đánh dấu chưa đọc-đã đọc; bấm người chưa nhắn ⇒ mở cuộc rồi khung chat hiện màn chào; gửi/nhận ⇒ dòng lên đầu nhóm, chỉ dòng đó chuyển động (tắt khi giảm chuyển động); đổi «Chưa đọc» giữ dữ liệu cũ làm mờ.

## Làm
- [x] `lib/directory.ts` viết lại: `compareRows` (ghim → tin mới nhất → chưa nhắn A→Z), `patchConversation`/`applyNewToDir`/`clearUnreadInDir`/`applyDeletedToDir`/`applyPrefsToDir`, `appendPage`, `remaining`, `bodyStatus`; `lib/dir-rows.ts` (`dirRowView`, `convToRow`); `lib/collapse.ts` sang localStorage dạng `{nhóm: mở?}` + `isOpen` (mặc định theo chưa đọc).
- [x] Hook `use-directory.ts` (`useDirectory` giữ dữ liệu cũ khi đổi chữ tìm, `useLoadMoreGroup`, `useRowActions`); `api.ts`: `fetchDirectory`, `fetchDirectoryMore`, `setPinned`, `setMarkedUnread`, khoá `msgKeys.dir/dirAll`; realtime (`msg-realtime.ts`) + gửi/đọc (`use-chat.ts`) áp vào cùng cache danh bạ qua `patchDirs` (`list-cache.ts`).
- [x] Giao diện: `ConversationPane` (nối dữ liệu), `ConversationList` (bố cục), `ListFilter`, `DirectoryView`, `DirGroup`, `ConversationRow` (+`RowMenu`), `UnreadList`; gỡ `ListTabs`, `PeopleSearch`, `ListSection`, `lib/list-view.ts`.
- [x] i18n vi + en: `dirChat`, `dirInternal`, `dirEmpty`, `dirMore`, `noMessageYet`, `pin(ned)`, `unpin`, `markRead`, `markUnread`, `rowMore`, ô tìm «Tìm người, nhóm, công ty».
- [x] Sửa test khoá theo spec mới: `cr178.test.ts` (bỏ «tab danh sách», `list-view` gỡ), `directory.test.ts` (viết lại, giữ ca thẻ người theo lô), `e2e/cr127/j18-tin-nhan`, `j20-tin-nhan-danh-ba`, nhãn ô tìm ở `j18-tim-tin-nhan`, `cr169/tin-nhan-cong-ty`, `smoke-journey`, `_kit/two-companies`.

## Không làm / Chạm
Không làm: khung chat phải (lát `cr190-msg-chat-ui`), API (đã có ở `cr190-msg-directory-api` / `cr190-msg-prefs-api`), luật ai được nhắn ai, «Xem thêm» e2e (cần > 15 người/nhóm — đã có int/perf API + unit).
Chạm: `packages/messages-web/src/{api.ts,icons.tsx,components/*,hooks/*,lib/*}`, i18n `contracts/messages.{vi,en}.json`, e2e `cr127/j18-*`, `cr127/j20-*`, `cr190/danh-sach-trai.spec.ts` (mới) và nhãn ô tìm ở 3 file e2e khác.

## Test tối thiểu
unit `lib/directory.test.ts`, `lib/collapse.test.ts`, `lib/rows.test.ts` (thêm dòng danh bạ), `lib/cr178.test.ts`; e2e `e2e/cr190/danh-sach-trai.spec.ts` (viết, chưa chạy — điều phối chạy cuối đợt); `tsc` messages-web.

## Quyết định trong lúc làm
- «Chưa đọc» dùng lại `GET /messages/conversations?unread=true` (đã gồm cuộc chỉ có cờ), vì `/messages/directory` chưa có bộ lọc chưa đọc; đổi tab giữ thân cũ làm mờ tới khi bản mới về.
- Cache danh bạ ở khoá `["messages","dir",q]` (không dưới `msgKeys.list`, hình dữ liệu khác). Tin tới/gửi/đọc/ghim áp cục bộ rồi chỉ tải lại khi không thấy dòng (người vừa mở cuộc); tải lại sẽ đặt lại «Xem thêm» đã mở.
- Có chữ tìm ⇒ mọi nhóm còn dòng khớp tự mở (không ghi đè lựa chọn đã nhớ); tìm ≥ 2 ký tự vẫn có tab «Tin nhắn» (CR-178) cạnh «Người» (= danh bạ lọc).
- «⋯» chỉ có ở dòng đã có cuộc (người chưa nhắn không có gì để ghim/đánh dấu). «Đánh dấu đã đọc» = `POST …/read` tới tin cuối (xoá luôn cờ), cuộc chỉ có cờ ⇒ `PUT …/mark-unread {unread:false}`.
- Tên file `lib/rows.ts` (ghép tin tạm/thật của khung chat) giữ nguyên; luật dòng danh bạ ở `lib/dir-rows.ts`, test nằm ở `rows.test.ts` theo brief.
- `?company=` (nút «Nhắn tin» ở trang đối tác) ⇒ mở sẵn nhóm công ty đó thay cho tab «Đối tác ▾».
- `lib/row-view.ts` (+test) giữ lại vì `docs/current` còn dẫn tới; không còn component dùng ⇒ gỡ khi gộp Delta vào `docs/current`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tin-nhan-giao-dien.md
#### Yêu cầu: Màn «Tin nhắn» toàn màn, menu có số chưa đọc
Cột trái là danh bạ nhóm, không còn danh sách «cuộc gần đây» một kiểu và tab «Đối tác ▾». Ô tìm (người, nhóm, công ty; không dấu) · «Tất cả» / «Chưa đọc (n)». Nhóm theo thứ tự cố định: từng công ty đối tác A→Z, «Nhóm chat», «Nội bộ»; đầu nhóm có tên (cắt «…» + tooltip), tổng người, số chưa đọc. Nhóm có chưa đọc mở sẵn, còn lại thu; mở/thu nhớ trên máy (localStorage). Mỗi nhóm 15 dòng + «Xem thêm (n)». Dòng: avatar, tên, chức vụ, tin cuối hoặc «Chưa có tin nhắn» (người chưa từng nhắn, không giờ), số chưa đọc, biểu tượng ghim; sắp ghim → tin mới nhất → chưa nhắn A→Z. «⋯» trên dòng (máy tính khi rê chuột; điện thoại giữ lâu): Ghim/Bỏ ghim, Đánh dấu chưa đọc/đã đọc. Bấm người chưa nhắn ⇒ mở cuộc, khung chat hiện màn chào. Tin gửi/nhận ⇒ dòng lên đầu nhóm, chỉ dòng đó chuyển động (không chuyển động khi người dùng chọn giảm chuyển động). Đổi sang «Chưa đọc» mà dữ liệu mới chưa về ⇒ giữ dữ liệu cũ, làm mờ. Cột trái tự cuộn; trang toàn màn không cuộn.
- Kịch bản: khi sắp xếp dòng thì ghim, tin mới nhất, chưa nhắn theo tên [test: packages/messages-web/src/lib/directory.test.ts » ghim → tin mới nhất → chưa từng nhắn theo tên A→Z, ghim vẫn theo tin mới nhất]
- Kịch bản: khi người khác gửi tin thì dòng lên đầu nhóm và chỉ nhóm đó đổi [test: packages/messages-web/src/lib/directory.test.ts » người khác gửi: lên đầu, chưa đọc +1, xem trước mới, tổng nhóm +1]
- Kịch bản: khi ghim hoặc bỏ ghim thì dòng lên đầu nhóm hoặc về chỗ theo tin [test: packages/messages-web/src/lib/directory.test.ts » ghim ⇒ lên đầu nhóm, bỏ ghim ⇒ về chỗ theo tin]
- Kịch bản: khi đánh dấu chưa đọc cuộc đã đọc thì hiện 1 và nhóm cộng 1 [test: packages/messages-web/src/lib/directory.test.ts » đánh dấu chưa đọc cuộc đã đọc ⇒ hiện 1 và nhóm +1 (max(thật, cờ))]
- Kịch bản: khi bấm «Xem thêm (n)» thì n là số còn lại và trang kế nối vào đúng nhóm [test: packages/messages-web/src/lib/directory.test.ts » nối trang kế vào cuối nhóm, bỏ dòng trùng, đổi con trỏ, nhóm khác giữ nguyên]
- Kịch bản: khi đổi tab mà dữ liệu mới chưa về thì giữ dữ liệu cũ [test: packages/messages-web/src/lib/directory.test.ts » chưa có danh bạ: chờ hoặc lỗi, có danh bạ cũ ⇒ vẫn hiện (làm mờ), lỗi chỉ khi tab Chưa đọc lỗi]
- Kịch bản: khi chưa chọn mở/thu thì nhóm có chưa đọc mở sẵn, còn lại thu [test: packages/messages-web/src/lib/collapse.test.ts » chưa chọn: có chưa đọc ⇒ mở, không ⇒ thu]
- Kịch bản: khi người dùng mở/thu thì nhớ trên máy, không nhớ được cũng không lỗi [test: packages/messages-web/src/lib/collapse.test.ts » ghi rồi đọc lại, setOpen không sửa bản cũ]
- Kịch bản: khi bộ nhớ trình duyệt bị chặn thì không ném lỗi [test: packages/messages-web/src/lib/collapse.test.ts » không truy cập được (chế độ riêng tư) ⇒ không ném lỗi]
- Kịch bản: khi người chưa từng nhắn thì dòng không giờ, không chưa đọc, không «⋯» [test: packages/messages-web/src/lib/rows.test.ts » người chưa từng nhắn: không giờ, không chưa đọc, không «⋯»]
- Kịch bản: khi đã nhắn thì dòng có giờ, ghim, chưa đọc «99+» [test: packages/messages-web/src/lib/rows.test.ts » đã nhắn: giờ, ghim, chưa đọc kẹp «99+», công ty chỉ hiện khi được yêu cầu]
- Kịch bản: khi người được giao (không phải người tạo) nhận tin thì dòng người gửi đứng đầu nhóm «Nội bộ» có số chưa đọc, «⋯» đánh dấu và ghim [test: e2e/cr190/danh-sach-trai.spec.ts » tin tới ⇒ dòng của người gửi lên đầu nhóm, «Chưa đọc» có số, «⋯» đánh dấu đã đọc/chưa đọc và Ghim]
- Kịch bản: khi tải lại trang thì nhóm mở/thu giữ nguyên, tìm lọc đúng, người chưa nhắn bấm là mở cuộc có màn chào [test: e2e/cr190/danh-sach-trai.spec.ts » nhóm mở/thu nhớ sau khi tải lại, tìm lọc đúng, người chưa nhắn bấm là mở cuộc có màn chào]
- Kịch bản: khi người được giao nhận tin thì thấy chưa đọc ở nhóm, mở thì hết, nhóm «Nội bộ» cuối [test: e2e/cr127/j18-tin-nhan.spec.ts » A nhắn B: B thấy chưa đọc, mở thì hết, A thấy «Đã xem»]
- Kịch bản: khi nhân viên mở trang thì «Nội bộ» là nhóm cuối, không còn tab «Đối tác» [test: e2e/cr127/j20-tin-nhan-danh-ba.spec.ts » Danh sách một kiểu]

### REMOVED pack-contracts/tin-nhan-giao-dien.md
#### Yêu cầu: Thanh lọc «Tất cả · Chưa đọc · Đối tác ▾»
Lý do: CR-190 bỏ hàng tab cũ; công ty đối tác thành nhóm trong danh bạ, `lib/list-view.ts` và `ListTabs` đã gỡ, ca «CR-178 · tab danh sách» trong `cr178.test.ts` bỏ theo. Các e2e `cr161/ket-noi-cong-ty`, `cr169/tin-nhan-cong-ty` (CR169-J3), `smoke-journey` còn dùng `tab-partner` cần viết lại theo nhóm đối tác (xem Việc còn lại).

## Việc còn lại
- e2e chưa chạy (điều phối chạy cuối đợt).
- e2e khoá còn dùng tab «Đối tác ▾» (`tab-partner`, `partner-menu`, `partner-item`) sẽ đỏ: `e2e/cr161/ket-noi-cong-ty.spec.ts` (dòng 46, 106-107, 187), `e2e/cr169/tin-nhan-cong-ty.spec.ts` (46-52, 364), `e2e/smoke-journey/smoke-journey.smoke.ts` (504-510) ⇒ đổi sang mở nhóm công ty (`data-group="partner:<id>"`, `dir-group-head`). Ngoài phạm vi brief (chỉ j18/j20).
- Gỡ `lib/row-view.ts` + `row-view.test.ts` khi gộp Delta vào `docs/current` (dòng «Dòng 2 là công ty · chức vụ» đang dẫn tới).
