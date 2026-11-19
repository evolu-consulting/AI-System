---
id: qc-cr187-e2e-fix2
lát: qc-cr187-e2e-fix2
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)

## Làm
Phân loại đỏ e2e cuối đợt CR-187..192 (lượt 2); sửa phần test sai so với spec mới. Chưa chạy lại e2e (điều phối chạy phần đỏ).
- `e2e/community-web/flows.queue.cs.ts`: ô soạn nay là hộp «Viết bài…» (CR-191) ⇒ mở qua `openComposer`, ô Hàng hoá = `goods-input`.
- `e2e/community-web/roles.cs.ts` + `_composer.ts` (`closeComposer`): hộp «Viết bài» là modal, ẩn phần còn lại khỏi cây trợ năng ⇒ đóng (Esc) trước khi thao tác bài.
- `e2e/community-web/cr129-mention.cs.ts` M3: «Ai thấy bài» bỏ «Theo nhóm hàng» (CR-191, mặc định Tất cả đối tác) ⇒ bỏ ca chọn nhóm hàng, thêm kiểm tuỳ chọn không còn.
- `e2e/cr189-admin-org-ui.spec.ts`: chờ hộp «Thành viên» đóng (lưu xong) trước khi đọc DB (đua).
- `e2e/cr169/tin-nhan-cong-ty.spec.ts` J2: CR-190 nhóm đối tác thu mặc định khi không có chưa đọc ⇒ mở nhóm trước khi chọn cuộc.
- `e2e/cr181/first-login-signature.spec.ts` CR-188: giám đốc chưa có chữ ký bị màn «Tạo chữ ký» chắn ⇒ tạo trước, kiểm phạm vi trong `sig-format`.

## Không làm / Chạm
Không sửa code sản phẩm. Chưa xử lý: cr192-crop C1 (avatar lệch y 18px), cr181 «Tự đặt theo» disabled (PDF «Không mở được tệp này») — nghi lỗi code, báo điều phối.

## Test tối thiểu
e2e đỏ nêu trên (chạy cuối đợt, điều phối).

## Quyết định trong lúc làm
Không dùng `slice:new` (chỉ sửa e2e + tasks, tiền lệ qc-dark-baseline) — sửa thẳng trên staging.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa e2e theo spec mới)

## Việc còn lại
C1 và cr181 prepareSignPlaces cần điều tra code.

## Lượt 3 (phân loại đỏ run 20261120-043552; chưa chạy lại — evotest cục bộ lỗi tar/khoá SSH)
- `cr127` chết 25 s «không rút được tên ca»: webServer `_cr127-stack.ts` ném `ReferenceError: bAdmin is not defined` (dòng 193). Commit aa6e0074c gỡ `const bAdmin` khi đổi `setDirectoryListed` ⇒ vẫn dùng ở `createGroupWith`. TEST SAI ⇒ trả lại `const bAdmin = await adminOf(b)`.
- `cr192-crop` C1 (18 px): lỗi nằm ở `a.x` của **nút bút** (dòng 82), không phải y/cuộn. Có ảnh ⇒ nút «Gỡ ảnh» hiện cạnh bút (CR-156, `profile.css:174 .imgpick` căn giữa cặp nút 30+6 px) ⇒ bút nhích 18 px — hành vi cũ, không do CR-192; so sánh bút trước (chưa ảnh) / sau (có ảnh) sai. TEST SAI ⇒ bút chỉ đo y + kích thước; avatar/bìa đo như cũ (toạ độ theo trang, chờ hồ sơ dựng xong trước khi đo).
- `cr169` J2 dòng 149: CR-190 đưa tên công ty lên đầu nhóm (`DirGroup.tsx:100 showCompany = kind==="chat"`), dòng trong nhóm đối tác không còn `conv-company-line`. TEST SAI ⇒ kiểm `dir-group-head` có tên công ty; `conv-company-line` kiểm ở tab «Chưa đọc» (`UnreadList` showCompany).
- `cr181` «Gửi lại link»: regex toast cũ «chưa gửi được link»; chữ thật `contracts.psign.link.noMail` = «Chưa gửi được thư mời ký…» (e2e không có thư) ⇒ TEST SAI ⇒ regex `Đã gửi lại link tới|Chưa gửi được thư mời ký`.
- `scenes-mobile` bang-tin-mobile: bỏ qua (điều phối chụp lại).
