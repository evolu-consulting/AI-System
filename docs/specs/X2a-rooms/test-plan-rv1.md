# X2a · test-plan vòng review 1 (security-1 #1 #3 #4 #5 #8 · review-1 #3 #4 #5)

File: `tests/acceptance/X2a/rv1-security.int.test.ts` (23 ca, khoá). `test-plan.md` đã ~30 KB nên tách file này. Role `hub_api` + `SET LOCAL ROLE hub_rw` + GUC như `withHubScope`; kiểm hành vi (trạng thái DB sau thao tác), không phụ thuộc tên hàm nội bộ. Ca cũ sửa: `db-rls` D15 (đặt `last_seq=10` bằng owner trước khi chèn seq 10, vì policy mới chỉ nhận `seq = last_seq`).

| ID | Kỳ vọng | Nguồn | Đỏ ở 0011 (baseline) |
|---|---|---|---|
| RV1-S01 | thành viên thường đổi tên / xoá mềm phòng ⇒ không đổi | sec #1 | đỏ: name="Hoa đổi", deleted_at đặt |
| RV1-S02 | không ai (cả chủ) UPDATE trực tiếp `last_seq`/`last_activity_at` | sec #1 #3 | đỏ: last_seq 3→7 |
| RV1-S03 | thành viên thường hạ role chủ / đổi `joined_at` ⇒ không đổi | sec #1 | đỏ: role owner→member, joined_at đổi |
| RV1-S04 | thành viên thường đặt `left_at` người khác ⇒ không đổi | sec #1 | đỏ: left_at đặt |
| RV1-S05 | thành viên thường sửa `last_read_seq`/`hidden_at` người khác ⇒ không đổi | sec #1 | đỏ: last_read_seq 3→0 |
| RV1-S06 | thành viên thường xoá `left_at` người đã bị bớt ⇒ vẫn rời | sec #1 | đỏ: left_at = null |
| RV1-S07 | người đã rời không tự xoá `left_at` | sec #1 | xanh (hồi quy; hàng không thấy được) |
| RV1-S08 | chủ đổi tên / bớt người khác / xoá mềm ⇒ có hiệu lực | sec #1 | xanh (hồi quy) |
| RV1-S09 | thành viên thường tự rời (`left_at` mình) ⇒ ok, chỉ hàng mình | sec #1 | xanh (hồi quy) |
| RV1-S10 | tự tăng `last_read_seq` ok; giảm ⇒ giữ nguyên (đơn điệu) | sec #1 | đỏ: giảm 2→1 được |
| RV1-S11 | `last_read_seq` 99 > `last_seq` 3 ⇒ bị từ chối | sec #1 | đỏ: ghi 99 |
| RV1-S12 | tự đặt/bỏ `hidden_at` (DM) ok | sec #1 | xanh (hồi quy) |
| RV1-S13 | INSERT tin `seq` 9999 / `last_seq+5` ⇒ từ chối, không có hàng | sec #3 | đỏ: `INSERT` ok, 2 hàng |
| RV1-S14 | gửi API 6 tuần tự + 6 song song ⇒ seq liền 1…12 | sec #3 · AC07 | xanh ở baseline DB-only (app mới cần 0012) |
| RV1-S15 | phá phòng qua SQL (seq 9999, last_seq 9998) rồi gửi API ⇒ 201 seq kế | sec #1 #3 | đỏ: 500 (23505) |
| RV1-S16 | `room_fanout(G)` do thành viên gọi: `total` người khác không chứa phòng họ có, người gọi không ở | sec #4 | đỏ: total người khác = 35 > 2 |
| RV1-S17 | `hub.is_tenant_user`: khoá/ngưng ⇒ false; cùng tenant ⇒ true; tenant khác ⇒ false | sec #8 | đỏ: khoá/ngưng = true |
| RV1-S18 | chủ INSERT `room_members` cho user khoá/ngưng ⇒ 42501; hợp lệ ⇒ ok | sec #8 | đỏ: "ok" |
| RV1-S19 | `create_room` DM tới khoá/ngưng ⇒ P0002 | sec #8 | xanh (hồi quy) |
| RV1-H01 | `POST /rooms/:id/read` người vừa bị bớt / vừa rời ⇒ 404 `ROOM_NOT_FOUND`, `last_read_seq` giữ | review #5 · sec #5 | xanh (đường không đua; đường đua không tất định ⇒ không test) |
| RV1-H02 | xoá phòng song song gửi (12 vòng) ⇒ không tin có `created_at` > `left_at` | review #3 | xác suất (đua); gửi phải 201/404, xoá 204 |
| RV1-H03 | ẩn DM song song gửi (16 vòng) ⇒ không tin mới hơn `hidden_at` mà DM vẫn ẩn (R07) | review #4 | xác suất (đua) |
| RV1-H04 | chủ thêm lại người đã bị bớt qua API ⇒ 200, người đó thấy phòng | sec #1 | xanh (đường hợp lệ sau siết) |

Ghi chú: H02/H03 là test đua, đỏ khi lỗi xuất hiện còn xanh khi đúng (không bao giờ đỏ giả); không tất định nên không đảm bảo đỏ ở mỗi lần chạy với code cũ. Đua "read vs bớt" (review #5) và "ẩn vs gửi" cần điểm đồng bộ trong server nên chỉ phủ xác suất.

## Đỏ đúng lý do · nhật ký (QC RV1, 2026-10-08, DB qc riêng)
Baseline đo bằng DB dựng từ migrations HEAD (tới 0011) + preload thay `runHubMigrations`; ca DB đỏ ở `expect` (trạng thái sai), 0 ca đỏ do dựng dữ liệu. Ca HTTP baseline không đo được vì app working-tree đã gọi hàm 0012. Sau 0012 + sửa app của backend-lead: 23/23 xanh; `db-rls` 18, `concurrency` 7, `members` 13, `rooms` 13, `messages` 11, `isolation` 15 xanh.
