# X2b · test-plan vòng review 1 (security-1 Minor #1–#6)

File: `tests/acceptance/X2b/security-rv1.int.test.ts` (11 ca, khoá; tái dùng `_x2b.ts`). Lưới DB: role `hub_api` + `SET LOCAL ROLE hub_rw` + GUC như `withHubScope` (`asUser` X2a). Kiểm hành vi (trạng thái DB / HTTP sau thao tác), không phụ thuộc tên hàm nội bộ.

| ID | Kỳ vọng | Nguồn | Đỏ ở `2859a26` (trước sửa) |
|---|---|---|---|
| RV1-S1a | lan (scope user) sửa run phòng R của mình: `status=finished`, `flow_id` = base flow thread T2 phòng khác, `agent_id=trello` ⇒ sau reconcile không tin agent nào gắn T2 / phòng khác | sec #1 | đỏ: tin agent đăng với `flow_id` = T2 (wrongPlace 1, inOther 1) |
| RV1-S1b | lan sửa `answer_message_id` = tin C1 riêng của hoa ⇒ nội dung riêng không vào `room_messages` / timeline của tam, không chiếm id tin của hoa | sec #1 | đỏ: leak 1, timeline tam chứa nội dung riêng |
| RV1-S1c | lan sửa `answer_message_id` + `flow_id` sang tin/flow tenant beta ⇒ không đăng gì | sec #1 (tenant) | xanh (hồi quy: lọc tenant đã có) |
| RV1-S2 (rời) | A tag → chờ `side_effect` → A rời → được thêm lại → xác nhận bằng `answer_run_id` cũ ⇒ 404/409, không `X-Run-Id`, không run mới, xác nhận không `pending`/`confirmed`/`consumed` | sec #3 · R17 · Q8 | đỏ: 201 + run mới, xác nhận `confirmed` |
| RV1-S2 (bị bớt) | như trên, chủ bớt A rồi thêm lại | sec #3 · R17 · Q8 | đỏ: 201 + run mới, xác nhận `confirmed` |
| RV1-S3 | PATCH/DELETE/POST messages (có/không `flow_id`)/GET flows/messages với id hội thoại nền ⇒ 404; hàng hội thoại + đếm run/tin không đổi | sec #5 · D2 | xanh (hồi quy; lưới `touchConversation` chỉ đo được qua HTTP) |
| RV1-S3 (flow) | hội thoại C1 của mình + `flow_id` = flow nền phòng ⇒ không 201, không run mới trên flow nền | sec #5 · D2 | xanh (hồi quy) |
| RV1-S4 | scope system gọi thẳng `room_post_agent_message(run hoadon, sender=trello, …)` ⇒ bị từ chối (gồm 42883 nếu bỏ `p_sender`) hoặc `sender_id` = agent của run; không có tin sender giả | sec #6 | đỏ: tin agent `sender_id = trello` |
| RV1-S5a | cuc (ngoài phòng) gắn run C1 của mình vào phòng (UPDATE `room_id` scope user) ⇒ không hiện trong `room_run_states` (hoa, SQL) và `active_runs` (`GET /rooms/:id`) | sec #2 | đỏ: states 1, active 1 |
| RV1-S5b | người gọi có `left_at` (run chưa kịp huỷ, run `running`) ⇒ `room_run_states` của hoa không trả run đó | sec #2 | đỏ: shown 1 |
| RV1-M4 | A mất quyền hoadon, gửi `@orchestrator đồng ý` trong thread ⇒ xác nhận run 1 không `consumed`, không job hoadon cho run khác | sec #4 | xanh (hồi quy, reviewer xác nhận không thực thi được) |

Ghi chú: S1a/S1b chờ vòng reconcile (5 s, tối đa 9 s) — khi đã sửa, tx2 bỏ qua/báo lỗi thì ca vẫn xanh (chỉ xét không có tin sai chỗ / nội dung riêng). S2 chấp nhận 404 hoặc 409 (spec Q8/R17: lượt chờ đã huỷ khi rời). S4 không ràng buộc cách sửa (bỏ tham số hay đối chiếu).

## Đỏ đúng lý do · nhật ký (QC RV1, 2026-10-08, DB `ai_system_qc_test`)
Code `2859a26`: 8 đỏ / 3 xanh. Mọi ca đỏ ở `expect` (trạng thái sai như bảng), 0 ca đỏ do dựng dữ liệu (đã sửa fixture S5a: run `orchestrated` không `agent_id` — `runs_direct_ck`). Xanh: S1c, S3 ×2, M4 (hồi quy).
