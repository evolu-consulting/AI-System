# Tin nhắn trong Sổ Hợp Tác (CR-132)

Tin nhắn là khái niệm riêng của gói Sổ Hợp Tác, tách hẳn chat-web (không dùng chung dữ liệu/phòng X2a). Schema + RLS: `MG` 0107/0108; code: `H/messages/`, web `W/features/messages/`. Nguồn: lát cr132-m1/m3/m4/m5/w2/w3, fix-msg-web, sec-fix-1112 (gộp 2026-11-12, đợt cr132). Thông báo tin nhắn **không** vào chuông chung, không email/push.

## 1. Cách ly (RLS) — m1
#### Yêu cầu: Chỉ công ty và thành viên của hội thoại thấy tin
Hội thoại, thành viên, tin, tệp chỉ đọc/ghi được bởi nhân viên nội bộ đúng công ty và đúng thành viên. Công ty khác, đồng nghiệp ngoài hội thoại, user đối tác (external) không thấy/ghi gì, kể cả khi có hàng thành viên. Quản trị công ty không có quyền đọc tin người khác.
- Kịch bản: công ty khác không thấy/ghi [test: apps/hub-api/src/modules/packs/contracts/messages/messages-rls.int.test.ts » chặn đọc/ghi chéo công ty]
- Kịch bản: đồng nghiệp ngoài hội thoại không thấy, không tự thêm, không thu hồi/xoá tin người khác [test: apps/hub-api/src/modules/packs/contracts/messages/messages-rls.int.test.ts » NGOÀI hội thoại]
- Kịch bản: user ngoài không thấy và không gửi được [test: apps/hub-api/src/modules/packs/contracts/messages/messages-rls.int.test.ts » user ngoài (external)]

#### Yêu cầu: Tạo/rời/xoá theo luật thành viên
Mỗi cặp nhân viên một 1-1 duy nhất; nhóm có tên 1–80 ký tự, tối đa 50 người; tin ≤ 4000 ký tự. Người tạo chèn lô thành viên đầu; đã rời/bị bớt thì không tự vào lại. Người cuối rời ⇒ hội thoại và tệp bị xoá.
- Kịch bản: tạo, chèn lô đầu, gửi; người tạo đã rời không tự chèn lại [test: apps/hub-api/src/modules/packs/contracts/messages/messages-rls.int.test.ts » tạo hội thoại]
- Kịch bản: người cuối rời ⇒ xoá, tệp đánh dấu xoá [test: apps/hub-api/src/modules/packs/contracts/messages/messages-rls.int.test.ts » người cuối rời]
- Kịch bản: ràng buộc dạng (khoá cặp 1-1, tên nhóm, trùng cặp, tin quá dài) [test: apps/hub-api/src/modules/packs/contracts/messages/messages-rls.int.test.ts » ràng buộc dạng]

#### Yêu cầu: Chủ nhóm, rời nhóm, đã đọc, đã xem
Chỉ chủ nhóm đổi tên/thêm/bớt; ai cũng tự rời; 1-1 cố định. Chủ rời ⇒ người vào sớm nhất thành chủ. Mốc đã đọc chỉ tiến, không vượt tin cuối; «Đã xem» theo mốc đọc của thành viên khác.
- Kịch bản: nextOwner, quyền nhóm, clampRead [test: apps/hub-api/src/modules/packs/contracts/messages/domain/messages.rules.test.ts » nextOwner; apps/hub-api/src/modules/packs/contracts/messages/domain/messages.rules.test.ts » quyền nhóm; apps/hub-api/src/modules/packs/contracts/messages/domain/messages.rules.test.ts » clampRead]
- Kịch bản: contract zod kiểm chặt ở biên [test: packages/contracts/src/pack-contracts/messages.test.ts » CreateConversationRequest; packages/contracts/src/pack-contracts/messages.test.ts » MeStreamMsgEvent]

## 2. API — m3
#### Yêu cầu: Nhắn 1-1 và nhóm qua API riêng của công ty
Tạo 1-1 (mở lại ra cùng hội thoại) hoặc nhóm (người tạo là chủ), gửi tin (gửi lặp cùng mã chỉ một tin), xem tin theo trang, đánh dấu đã đọc, tổng chưa đọc. Lỗi trả mã để UI dịch; người ngoài/công ty khác chỉ thấy «không tìm thấy».
- Kịch bản: hai nhân viên mở 1-1 ra cùng hội thoại [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » 1-1: tạo]
- Kịch bản: tạo nhóm, người tạo là chủ, thành viên không hợp lệ bị từ chối [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » nhóm: người tạo là chủ]
- Kịch bản: gửi lặp cùng mã không tăng seq; danh sách có chưa đọc và tin cuối [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » gửi tin: tăng seq]
- Kịch bản: đã đọc ⇒ chưa đọc về 0, mốc không lùi/vượt [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » danh sách tin theo seq]
- Kịch bản: người kia của 1-1 bị khoá ⇒ gửi bị chặn `MSG_PEER_INACTIVE` [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » MSG_PEER_INACTIVE]
- Kịch bản: người ngoài/công ty khác nhận cùng mã không tìm thấy [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » mọi thao tác trên hội thoại của người khác]

#### Yêu cầu: Thu hồi, đổi tên, thêm/bớt thành viên, rời nhóm
Người gửi thu hồi tin mình mọi lúc (nội dung và tệp biến mất, không tính chưa đọc). Chỉ chủ nhóm đổi tên/thêm/bớt; người mới không đỏ cả lịch sử cũ.
- Kịch bản: thu hồi [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » thu hồi]
- Kịch bản: đổi tên / thêm người [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » đổi tên / thêm người]
- Kịch bản: bớt người, chủ rời, người cuối rời [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » bớt người]

#### Yêu cầu: Nhanh với 200 hội thoại, 100.000 tin
Danh sách 30 hội thoại ≤ 50 ms (một câu SQL), tổng chưa đọc ≤ 20 ms; số câu SQL cố định.
- Kịch bản: chưa đọc tổng [test: apps/hub-api/src/modules/packs/contracts/messages/messages.perf.int.test.ts » chưa đọc tổng]
- Kịch bản: danh sách 30 hội thoại [test: apps/hub-api/src/modules/packs/contracts/messages/messages.perf.int.test.ts » danh sách 30 hội thoại]
- Kịch bản: con trỏ và xem trước [test: apps/hub-api/src/modules/packs/contracts/messages/application/messages.view.test.ts » con trỏ danh sách hội thoại]

## 3. Realtime — m4
#### Yêu cầu: Tin tới tức thì cho đúng thành viên
Tin mới, thu hồi, đã đọc, đổi thành viên/tên nhóm đẩy qua `/me/stream` tới thành viên (cả tab khác của người gửi); người ngoài không nhận; công ty tắt Chat AI vẫn nhận; gửi lặp không phát lại; đã đọc không tiến thì không phát. Phía web: [web/luong-thoi-gian-thuc.md](../web/luong-thoi-gian-thuc.md).
- Kịch bản: A gửi ⇒ B và tab khác của A nhận, người ngoài không [test: apps/hub-api/src/modules/packs/contracts/messages/messages-stream.int.test.ts » A gửi]
- Kịch bản: đọc ⇒ msg.read; thu hồi; thêm rồi bớt C [test: apps/hub-api/src/modules/packs/contracts/messages/messages-stream.int.test.ts » đọc ⇒ msg.read]
- Kịch bản: chọn người nhận khử trùng, đúng contract [test: apps/hub-api/src/modules/packs/contracts/messages/domain/messages.events.test.ts » mọi thành viên]
- Kịch bản: tắt Chat AI vẫn nhận [test: apps/hub-api/src/modules/chat-gate/chat-gate.rules.test.ts » stream]

## 4. Tệp — m5, sec-fix-1112
#### Yêu cầu: Tệp trong tin nhắn chỉ thành viên tải được
Tải tệp (danh sách chung, ≤ 20 MB) vào hội thoại rồi gửi kèm (≤ 10 tệp). Chỉ thành viên xem/tải; ngoài hội thoại và công ty khác không tải được, kể cả qua đường tải chung của SHT. Tệp hợp đồng tải như cũ.
- Kịch bản: thành viên tải lên, đuôi lạ/quá dung lượng bị từ chối trước khi lưu [test: apps/hub-api/src/modules/packs/contracts/messages/messages-files.int.test.ts » thành viên tải lên]
- Kịch bản: ngoài hội thoại/công ty khác qua đường chung ⇒ không link, không thấy hàng [test: apps/hub-api/src/modules/packs/contracts/messages/messages-files.int.test.ts » đường tải CHUNG]
- Kịch bản: tệp HĐ vẫn tải được trong công ty [test: apps/hub-api/src/modules/packs/contracts/messages/messages-files.int.test.ts » tệp HĐ]

#### Yêu cầu: Thu hồi tin hoặc xoá hội thoại thì gỡ tệp khỏi kho
- Kịch bản: thu hồi tin có tệp ⇒ đánh dấu xoá và gỡ byte; người cuối rời ⇒ gỡ byte còn lại [test: apps/hub-api/src/modules/packs/contracts/messages/messages-files.int.test.ts » thu hồi tin có tệp]

#### Yêu cầu: Không gắn tệp hợp đồng vào tin nhắn
Tệp gắn vào hội thoại phải do chính người gửi tải lên và chưa là tệp hợp đồng (chính/phiên bản, tệp kèm HĐ, bản đã ký).
- Kịch bản: gắn tệp chính/tệp kèm HĐ ⇒ 42501; tệp mới tải qua tin nhắn gắn được [test: apps/hub-api/src/modules/packs/contracts/messages/messages-attach-guard.int.test.ts » tệp chính HĐ / tệp kèm HĐ]

## 5. Giao diện — w2, w3, fix-msg-web
#### Yêu cầu: Màn «Tin nhắn» toàn màn, menu có số chưa đọc
«Tin nhắn» (sau «Yêu cầu») có số đỏ tổng chưa đọc; hội thoại chưa đọc in đậm kèm số (hiện đúng đến 99, «99+» khi nhiều hơn; server đếm tối đa 100), lên đầu khi có tin mới; tìm theo tên không phân biệt hoa/dấu; nói rõ đang tải/lỗi («Thử lại»)/rỗng. Xem trước một dòng ≤ 120 ký tự Unicode (không cắt đôi emoji), giống server và khi nhận tin mới. Thu hồi tin chưa đọc thì số cập nhật.
- Kịch bản: tin mới của người khác ⇒ lên đầu, tăng chưa đọc (kẹp 99), tin mình/đang xem không tăng [test: apps/workspace-web/src/features/messages/lib/messages-lib.test.ts » msg.new của người khác]
- Kịch bản: lọc theo tên [test: apps/workspace-web/src/features/messages/lib/messages-lib.test.ts » lọc theo tên]
- Kịch bản: menu «Tin nhắn» sau «Yêu cầu» [test: apps/workspace-web/src/shell/nav.test.ts » đủ 7 + 2 mục]
- Kịch bản: A nhắn B ⇒ B thấy số, mở thì hết, A thấy «Đã xem» [test: e2e/cr127/j18-tin-nhan.spec.ts » A nhắn B]
- Kịch bản: nhãn 99+, thu hồi tin chưa đọc [test: apps/workspace-web/src/features/messages/lib/messages-fix.test.ts » thu hồi tin chưa đọc]
- Kịch bản: xem trước không cắt đôi emoji [test: apps/workspace-web/src/features/messages/lib/messages-fix.test.ts » xem trước dùng chung]
- Kịch bản: mở hội thoại khác trước khi cái cũ dọn vẫn không cộng nhầm [test: apps/workspace-web/src/features/messages/lib/messages-fix.test.ts » đang xem theo id]
- Kịch bản: tên người gửi có sẵn thì không tải lại danh sách [test: apps/workspace-web/src/features/messages/lib/messages-fix.test.ts » tên người gửi từ dữ liệu sẵn có]

#### Yêu cầu: «Nhắn tin mới» tạo 1-1 hoặc nhóm
Chọn 1 người ⇒ nhắn riêng; từ 2 ⇒ «Tên nhóm» bắt buộc + «Tạo nhóm»; tối đa 50 người. Lỗi API hiện câu theo mã, nói cách khắc phục.
- Kịch bản: chế độ chưa chọn/riêng/nhóm, vượt 49 ⇒ nhóm đầy [test: apps/workspace-web/src/features/messages/lib/messages-lib.test.ts » chọn người]

#### Yêu cầu: Khung chat — theo ngày, gửi, thu hồi, «Đã xem», quyền theo vai
Tin theo ngày (Hôm nay/Hôm qua/ngày), tải thêm theo trang; tin đang gửi mờ, lỗi bấm gửi lại; chỉ người gửi thu hồi; chỉ chủ nhóm đổi tên/thêm/bớt (người khác thấy lý do), mọi thành viên rời; 1-1 với người đã khoá ⇒ khoá ô gửi kèm lý do; bị bỏ khỏi nhóm ⇒ «Bạn không còn trong cuộc trò chuyện này.».
- Kịch bản: gộp trang tăng dần seq, không trùng [test: apps/workspace-web/src/features/messages/lib/messages-lib.test.ts » msg.new thêm vào trang mới nhất]
- Kịch bản: thu hồi ⇒ rỗng + đánh dấu [test: apps/workspace-web/src/features/messages/lib/messages-lib.test.ts » thu hồi ⇒ rỗng]
- Kịch bản: «Đã xem» [test: apps/workspace-web/src/features/messages/lib/messages-lib.test.ts » «Đã xem»]
- Kịch bản: quyền hiện nút [test: apps/workspace-web/src/features/messages/lib/messages-lib.test.ts » quyền hiện nút]

#### Yêu cầu: Tin nhắn trong khoang trợ lý
Khoang phải có tab «Trợ lý AI» và «Tin nhắn»; chọn hội thoại ⇒ khung chat thay chỗ, nút ‹ quay về danh sách không đóng khoang; khoang nhớ hội thoại đang mở. Nút mở khoang, tab Tin nhắn, mục «Tin nhắn» thanh dưới điện thoại cùng hiện số chưa đọc (>99 ⇒ 99+, 0 ⇒ ẩn).
- Kịch bản: DockTabs số/99+/0, nút thu gọn chỉ ở tab Tin nhắn [test: apps/workspace-web/src/features/shell/components/dock-tabs.test.tsx » DockTabs]
- Kịch bản: A gửi chữ + PDF ⇒ B thấy chấm «1», mở thì mất, A thấy «Đã xem» [test: e2e/cr127/j19-tin-nhan-khoang.spec.ts » Khoang: A gửi chữ + PDF]

#### Yêu cầu: Đính kèm tệp vào tin nhắn
Nút ghim chọn tệp (≤ 20 MB, ≤ 10 tệp/tin), tải lên ngay thành chip gỡ được; tin chỉ có tệp vẫn gửi được. Ảnh hiện thu nhỏ bấm mở lớn; tệp khác là thẻ tên + dung lượng. Sai định dạng/quá lớn báo câu nêu loại nhận được.
- Kịch bản: đuôi lạ, tệp rỗng, > 20 MB bị từ chối trước khi tải [test: apps/workspace-web/src/features/messages/lib/files.test.ts » tệp đính kèm]

## Còn lại
- Chiều ngược: gắn tệp tin nhắn làm tệp kèm HĐ (`contract_files`) — chưa kiểm luồng thêm tệp kèm có nhận `file_id` sẵn có không. TECH-DEBT #265: tệp tin nhắn mồ côi.
