# X2a · Test plan bổ sung — security review vòng 2 (`review-security-2.md`)

Test khoá: `tests/acceptance/X2a/rv2-security.int.test.ts` (role `hub_api` + GUC, mỗi probe một transaction, COMMIT thật) và ca D18 sửa ở `db-rls.int.test.ts`. Migration đích: `0013_x2a_rooms_seq_integrity.sql`.

| ID | Kỳ vọng | Nguồn | Đỏ ở HEAD (trước 0013) |
|---|---|---|---|
| RV2-N1a | thành viên gọi `room_next_seq` rồi COMMIT không chèn tin ⇒ COMMIT lỗi, `last_seq` giữ | N1 | đỏ: COMMIT ok, `last_seq` 2→3 |
| RV2-N1b | gọi 3 lần rồi COMMIT không tin ⇒ lỗi, `last_seq` giữ, 0 tin | N1 | đỏ: ok, `last_seq` 2→5 |
| RV2-N1c | `room_next_seq` → INSERT tin cùng seq → COMMIT ⇒ ok, `last_seq`+1 | N1 | xanh (hồi quy) |
| RV2-N1d | gửi API tuần tự: seq 1,2,3,4 liền, `last_seq`=4 | N1 · AC07 | xanh (hồi quy) |
| RV2-N2a | INSERT tin `created_at`=2001-01-01 ⇒ từ chối hoặc lưu ≥ `created_at` tin trước | N2 · P07 | đỏ: lưu 2001 |
| RV2-N2b | `created_at`=2099 ⇒ từ chối hoặc lưu ≤ now()+1 phút | N2 | đỏ: lưu 2099 |
| RV2-N2c (×3) | tin `sender_type='user'` có `run_id` / `flow_id` / `trigger_message_id` ≠ NULL ⇒ từ chối, không có hàng | N2 | đỏ: INSERT ok (3 hàng) |
| RV2-N2d | tin user `created_at`=now(), cột agent NULL ⇒ ok | N2 | xanh (hồi quy) |
| RV2-N4a | D18 (`db-rls`): chạy lại MỌI `00NN_x2a_*.sql` theo thứ tự, 7 policy, rồi `is_tenant_user` khoá/ngưng=false, `hub_rw` không có UPDATE `rooms.last_seq` | N4a | xanh (đã sửa để không hạ cấp; bản cũ chỉ chạy 0011) |
| RV2-N4b | `room_members` có đúng 1 policy UPDATE permissive (`room_members_update`) | N4b | xanh (hồi quy, chặn thêm policy thứ hai) |

## Đỏ đúng lý do · nhật ký (QC, 2026-10-08, DB qc riêng)
Chạy trên HEAD trước khi `0013` xuất hiện: N1a, N1b, N2a, N2b, N2c×3 đỏ ở `expect` (trạng thái sai: COMMIT ok / `created_at` 2001 / hàng được lưu), 0 ca đỏ do dựng dữ liệu. (Lần đầu N1d đỏ do sai body `client_msg_id`, đã sửa dùng `say`.) Sau khi có `0013` (working tree): `rv2-security` 11/11 xanh, `db-rls` 18/18 xanh.
