# qc-e2e-community-journey — phân loại e2e đỏ cuối đợt CR-146..152 (community-web, community-web-stack, journey-approval)

Log nguồn: `.data/evotest/20261114-133224-8576-e2e`. a = test lệch hành vi đã chốt (đã sửa test) · b = lỗi sản phẩm (không sửa) · c = chập chờn/môi trường.

## Delta
Không thay đổi hành vi (lý do: QC e2e)
Trạng thái gộp: chưa gộp

## Bảng ca
| # | Ca | a/b/c | Việc / bằng chứng |
|---|---|---|---|
| 1 | cr147-feed «bài có 3 bình luận…» | a | Mock community ở trong bộ nhớ ⇒ `page.reload()` làm mất bài vừa đăng (timeout chờ `[data-post-id=p101]`). Đổi sang bài seed `p1` (3 bình luận), bỏ reload. |
| 2 | cr147-feed «nút thu gọn cùng hàng…» | b | Chủ quản có ô «Gợi ý mẫu» ⇒ hàng `.ctop` tràn, nút thu gọn xuống dòng 2 (lệch 45 px = 36 + 10 − 1; ảnh trace: nút `^` nằm dưới hàng nút loại bài). Nghi `apps/workspace-web/src/modules/community/ui/styles/feed.css:73-85` (`.ctop` flex-wrap + `.prefillsel` flex 1 1 200px) + `styles/extras.css:107` (`.composer-collapse`). Không sửa; test giữ nguyên. |
| 3 | feed.cm.ts «đối tác: bài của NCC bị che…» | b | Sau khi đổi nhân vật (rev đổi, cùng query) bảng tin giữ lại 7 bài của chủ quản dù tab đếm 4: bài «Chữ ký số HSM» (audience người mua) vẫn hiện cho NCC. Nghi `apps/workspace-web/src/modules/community/application/useFeed.ts:33-40` (`mergeFirstPage`: `tail = old.items.slice(fresh.items.length)` giữ bài cũ ngoài trang đầu kể cả khi trang đầu đã là trọn danh sách, không còn `nextCursor`). Cùng lỗi làm bài mới bị ẩn/lưu trữ còn nằm lại ở đuôi. Test giữ nguyên. |
| 4 | settings.cm.ts «Admin: hai nhóm…» | a | Persona mock «Chỉ xem» không phải chủ sở hữu ⇒ CR-138 Q6 chỉ cho mục «Quy trình duyệt» + «Thông báo» (chụp màn hình: nav chỉ 2 mục). Test đổi: co/rep/biz/scout/sign phải KHÔNG có; bấm flow + feed. (Mất phủ 4 mục chủ sở hữu ở mock; phủ ở e2e contracts-web.) |
| 5 | shell.cm.ts «đúng 7 link» | a | CR-139 thêm «Sơ đồ tổ chức» (`/contracts/org`) ⇒ 8 link. Cập nhật `SHT_PATHS`, đếm theo độ dài. |
| 6 | cr145-post-mention P1 | a (chưa xác nhận) | Lượt 2 đỏ vì regex class (`` thành ký tự điều khiển) → đã sửa `toHaveClass("on")`; CHƯA chạy lại (hết lượt, tối đa 2).  Viết chưa chạy: sau khi mở ô soạn, `.ctype.note` (nút ô thu gọn) biến mất; loại chọn nằm ở `.seg button[data-type=note]` class `on`. Sửa assert; chọn người theo tên công ty (`hasText: Cơ sở Tân Phát`) thay `.first()`. |
| 7 | cr147b-people P1 | a + b (nghi) | (a) selector `me-avatar` theo thẻ. (b) sau sửa, chọn ảnh vẫn hiện alert «Chưa lưu được ảnh, thử lại» (ảnh bìa cá nhân P2/P3 thì xanh) ⇒ nghi lưu avatar lỗi: `apps/workspace-web/src/modules/community/ui/MyProfile.tsx:41-48` (`save('avatar')`) hoặc API hồ sơ người (hub 0142/0144, avatar ≤150 KB). Test giữ nguyên. `PersonAvatar` dùng CÙNG `data-testid="me-avatar"` cho chữ cái đầu (`span`) và ảnh (`img`), không có hậu tố `-initials/-img`. Chọn theo thẻ. |
| 8 | cr123-u6-run-card | a | (lượt 2) hết lỗi 422 nhưng đỏ tiếp ở `esign-panel` đếm 4 nút (≠2): thẻ nay thêm khối «Tải lên bản đã ký» (chọn tệp + «Tải lên») ⇒ bỏ đếm cứng, thay bằng kiểm «Tải lên» bị khoá; phần sau (Ký ngay → Đã ký) CHƯA chạy lại. CR-146b: lưu node Ký kiểm «Ký qua» đang bật của chính công ty (`PROVIDER_NOT_ENABLED`, 422 ở `createCompanyFlow`). Bật Ký thử TRƯỚC khi dựng quy trình; tắt khi tải HĐ `.md`, bật lại trước khi gửi duyệt. |
| 9 | cr125-form-step-card (job journey + fsc) | a | CR-140/127 Z9: bước «cùng duyệt» cấm `after.group_id` riêng (`PARALLEL_RULE_INVALID` tại `stages.5.after.parallel.rule`). Fixture `withGroupIds` bỏ việc gán nhóm đầu vào `group_id`, đặt `null`. |
| 10 | cr125-purchase-full «2 · Phần 1→2→3» | b (nghi) | Phần 2 kẹt ở bước idx 5 `waiting_timer`: `hub.process_timers` có hẹn `wait_until` đến +7 ngày, trong khi mẫu Phần 2 (`tools/demo/purchase-templates.def.ts:165`) bước này chỉ là duyệt «Giám đốc…» — không có node chờ. Lượt cha `waiting_timer` vì con chưa xong. Chưa khoanh được file:dòng (nghi nhánh duyệt/ủy quyền hoặc node mới thêm sau CR-146 chen `core.wait-until`). Lượt 2 vẫn đỏ y hệt. Không sửa test; cần dev xem `[dump] timers` trong `out.log` của job. |
| 11 | flows.menu.cs.ts, contracts-web ×32, cr127 | ngoài phạm vi | Không phân loại ở lát này. |

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: QC sửa e2e theo hành vi đã chốt + relock; lỗi sản phẩm ghi ở bảng, giao lát fix-e2e-community / fix-purchase-timer)
