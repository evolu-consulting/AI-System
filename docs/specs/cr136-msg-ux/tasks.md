---
id: cr136-msg-ux
lát: cr136-msg-ux (CR-136 · Tin nhắn: gửi không chớp, giờ/thao tác dạng lớp phủ, tin lỗi «Gửi lại», kiểm tải tệp)
cr: CR-136
làn: nhanh
migration: không
phụ thuộc: cr132-w3
---
## Plan (ngắn)
| # | Việc | Sửa |
|---|---|---|
| 1 | gửi tin bị chớp | nguyên nhân: tin đang gửi vẽ ở danh sách riêng (khoá `clientId`, mờ 60%) rồi bị XOÁ và dựng lại ở danh sách tin thật (khoá `seq`). `lib/rows.ts` `mergeRows`: MỘT dòng cho mỗi tin, khoá = `client_id` cả trước/sau khi xác nhận, tin đang gửi nằm cùng nhóm ngày hôm nay ⇒ React giữ phần tử, độ mờ chuyển mượt `transition-opacity 300ms`; tin thật tới trước kết quả POST (`msg.new`) ⇒ bỏ bản tạm cùng `client_id` |
| 2 | hover mới hiện giờ + thao tác | `Tools`: lớp phủ tuyệt đối ở góc bubble (`absolute -top-3`), hiện khi rê chuột, `focus-within` (bàn phím: nút Thu hồi focus được), chạm vào tin (cảm ứng); không chiếm chỗ ⇒ chữ tin không xê dịch |
| 3 | Q11 tin lỗi | tin lỗi GIỮ nguyên trong hàng (viền đỏ) + dòng «Chưa gửi được.» + nút «Gửi lại» (`msg-retry`, cùng client_id ⇒ server không tạo trùng); toast lỗi chuẩn (`toast(…, "late")`, tự tắt do toast chung — không timer riêng); danh sách cuộn xuống để thấy nút |
| 4 | tải tệp trong tin | kiểm thật trên stack (dev server worktree :3310, `demo-owner`): bấm thẻ tệp ⇒ sự kiện tải xuống, tên tệp đúng; ảnh thu nhỏ vẫn hiện |
| – | trợ lý AI | `Messages.tsx`/`use-assistant-chat`: khoá theo chỉ số + vá tin cuối tại chỗ (`patchLast`) ⇒ không remount, không chớp; không đổi |

## Quyết định trong lúc làm
- Giờ không còn luôn hiện cạnh tin (theo yêu cầu): chỉ trong lớp phủ khi hover/focus/chạm.
- Câu lỗi «Chưa gửi được. Bấm để gửi lại.» ⇒ «Chưa gửi được.» + nút «Gửi lại» (nút thật, role button, thay cho cả bubble là nút).
- Khung bong bóng chung Tin nhắn ↔ trợ lý: không gộp (hai kiểu tin khác nhau: người↔người có hàng chờ/thu hồi/đã xem; trợ lý là dòng stream) — áp từng nơi.

## Test
unit: `messages/lib/rows.test.ts` (ghép theo client_id, cùng nhóm ngày, bỏ bản tạm khi đã có tin thật, trạng thái sent/sending/failed). Đã chạy: workspace-web 886 xanh, tsc, biome, `i18n:check`, `build` + `check:bundle` OK (js 145.1 KB). Ảnh: `…\uat-shots\out4\cr136-1-hover-hien-thao-tac-va-gio.png`, `cr136-2-tin-loi-co-gui-lai.png`.

## Việc còn lại
e2e `cr132-messages*.cw.ts` có thể chờ chữ «Chưa gửi được. Bấm để gửi lại.» (qc kiểm); dữ liệu thử CR-136 còn trong hội thoại demo (tenant demo).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
### ADDED pack-contracts/tin-nhan-gui-muot.md
#### Yêu cầu: Gửi tin không nháy, giờ và thao tác hiện khi rê chuột, tin lỗi gửi lại được (nguồn: CR-136)
Tin đang gửi, gửi lỗi và đã gửi là cùng một khung tin (không bị xoá rồi vẽ lại khi server xác nhận). Giờ và nút Thu hồi chỉ hiện khi rê chuột, khi bàn phím đặt vào tin hoặc khi chạm vào tin, và không làm chữ xê dịch. Tin gửi lỗi vẫn nằm đó kèm nút «Gửi lại».
- Kịch bản: khi server xác nhận tin thì tin giữ cùng khoá và cùng nhóm ngày nên không bị dựng lại [test: apps/workspace-web/src/features/messages/lib/rows.test.ts » khoá tin tạm]
- Kịch bản: khi tin thật đến trước kết quả gửi thì không hiện hai lần [test: apps/workspace-web/src/features/messages/lib/rows.test.ts » tin tạm đã có bản thật]
- Kịch bản: khi gửi lỗi thì tin ở trạng thái lỗi và giữ nguyên nội dung để gửi lại [test: apps/workspace-web/src/features/messages/lib/rows.test.ts » stateOf]
