# X2b · Security review agent trong phòng — vòng 2

## Kết luận: PASS (APPROVED, 2 Minor) · Spec: X2b-room-agents · Vòng: 2 · Reviewer: bảo mật (Opus, riêng — plan §11)

Sáu Minor vòng 1 (`review-security-1.md`) đã được sửa hoặc thu hẹp đúng hướng. Bản sửa không làm hỏng đường ghi `hub.runs` nào
đang có (column grant phủ đủ mọi UPDATE trong code). Không có Blocker/Major. Còn 2 Minor **lưới** (chỉ khai thác được khi đã có
SQL ở quyền `hub_rw`, scope user): ghi TECH-DEBT, không chặn mốc.

## Phạm vi
Commit `1fd3a1a`, `dc6121c`, `2c4c8d0` (từ `2fc8de6`). Đã đọc: `0015_x2b_rv1_room_post_trust.sql` (toàn bộ) · diff
`rooms/agents/{room-post,room-post.repo,room-run.service}.ts`, `runs/close/cancel.{repo,service}.ts`,
`runs/{runs.repo,create-run}.ts`, `runs/sse/sse-writer.ts`, `tools/scripts/src/done-x2b.ts` · `test-plan-rv1.md` (11 ca khoá).
Ngữ cảnh: `members.repo.ts:23-30` (`joined_at` khi thêm lại), `room-context.repo.ts`, mọi chỗ ghi `hub.runs`.
Không chạy int/e2e (điều phối đang chạy `done:x2b`). `config.service` (single-flight) không thuộc phạm vi bảo mật: chưa xem.

## Lệnh đã chạy
| Lệnh | Kết quả |
|---|---|
| `psql` `information_schema.column_privileges` `hub.runs` / `hub_rw` | UPDATE chỉ còn `status, last_seq, error_code, error_message, error_hint, owner, lease_until, finished_at, attachment_ids, room_id`; vẫn có INSERT/SELECT/DELETE toàn bảng ✓ khớp 0015 |
| `psql` grant `hub.runs` các role khác | chỉ `ai` (chủ) + `hub_rw`; `agent_runtime` **không** có quyền trên `hub.runs` |
| `psql` `pg_proc` `room_post_agent_message`, `room_run_states` | `prosecdef=t`, `search_path=pg_catalog, pg_temp`, ACL `ai=X, hub_rw=X` (không PUBLIC); thân hàm trên DB dev khớp 0015 |
| `psql` ràng buộc `hub.runs` / `hub.messages` | `runs.agent_id` **không FK**; `hub.messages` `hub_rw` SIUD, policy chỉ đòi `user_id`/`tenant_id` = GUC |
| `grep` mọi UPDATE `hub.runs` (`apps`, `packages`, `tools`, `.ts`/`.py`, trừ test/migration) | 6 chỗ: `setRunRoom` (`room_id`), `closeRun`, `finishRun`, `setFinalSeq`, `renewLeases`, `attachment_ids` — đều trong danh sách cột; `FOR SHARE` (`dify-agent`, `runner`, `workflow-job`) chỉ cần UPDATE một cột ✓; `apps/agent-runtime/src` không truy cập `hub.runs`/`hub.messages` |
| `bun tools/scripts/src/check-fn.ts --files <11 file .ts đổi>` | `check:fn OK (11 file)` |

## Kiểm các mục vòng 1
| # v1 | Kết quả | Bằng chứng |
|---|---|---|
| 1 (definer tin cột `runs`) | ✓ thu hẹp | Bỏ UPDATE `flow_id/answer_message_id/user_message_id/agent_id/conversation_id/room_posted_at`. Definer suy thread từ flow nền thuộc hội thoại nền `(phòng, runs.user_id)`; tin gọi = tin `user` của chính `runs.user_id` trong phòng với `flow_id` = thread; tin trả lời = `hub.messages` `assistant` có `run_id = p_run`, `user_id`, `flow_id` khớp. Kịch bản v1 (gắn tin C1 của người khác / thread phòng khác / tenant khác) bị chặn: `pm.user_id = v_run.user_id` + `c.room_id = v_room`. Lệch ⇒ `skipped` + `room_posted_at` (không lặp vòng bù). `runOutcome` lọc cùng điều kiện ⇒ `threadId` null ⇒ `postTx` gọi definer chắc chắn `skipped`, `events: []` (không phát SSE). Còn lại: M1 |
| 2 (`running` không kiểm thành viên) | ✓ | Nhánh `running` đòi flow nền thuộc hội thoại nền **của đúng phòng** + thành viên hiện tại + `started_at >= joined_at` |
| 3 (lượt chờ sống qua rời/thêm lại) | ✓ (2 lớp) | `declineRoomConfirms` (system) đặt `declined` mọi xác nhận `pending` trên flow nền của (phòng[, user]) sau vòng huỷ; `room_run_states` cả hai nhánh `started_at >= joined_at`, và `addMembers` đặt lại `joined_at = date_trunc('ms', now())` khi thêm lại (cùng độ phân giải với `runs.started_at`) |
| 4 (D15 đường khác) | ✓ hồi quy | Không đổi luồng tiêu thụ xác nhận; D15 cancel lỗi nay không 500 sau COMMIT: writer cục bộ kết thúc `CANCELLED`, lỗi chỉ log (`safeErrorFields`, không lộ chi tiết) |
| 5 (`touchConversation`) | ✓ | `createRunTx` lọc `room_id IS NULL` (C1) / `IS NOT NULL` (`p.input.room = true` chỉ đặt trong `writeRun` của phòng) ⇒ đường `runs.start` mới quên `conversations.get` vẫn không chạy C1 trên hội thoại nền |
| 6 (`p_sender`) | ✓ | Giữ chữ ký 4 tham số (deploy cuốn chiếu), thân hàm không đọc `p_sender`; app truyền `null::uuid`; sender = `coalesce(runs.agent_id, flows.agent_id, orchestrator_tenant_id, tenant_id)` (xem M1) |

**`room_id` còn UPDATE được — đã kiểm chứng nhận định backend-lead:** user (kể cả ngoài phòng) gắn `room_id` phòng R cho run C1
của mình ⇒ (a) `onClosed` (`finishRun` RETURNING `room_id`) / reconcile ⇒ `runOutcome.threadId` null (hội thoại C1 có
`room_id` NULL) ⇒ definer `skipped`, không tin, không sự kiện; (b) `room_run_states` không hiện (join `conversations.room_id =
p_room`; nhánh `waiting` cần tin agent do definer ghi); (c) `cancelRoomRuns` của R chỉ huỷ run của chính kẻ gắn. Đặt `room_id`
của run phòng thật sang NULL/phòng khác ⇒ run không bị huỷ khi rời và không bao giờ được đăng — chỉ hại chính mình, không lộ dữ
liệu (ngữ cảnh đã nạp lúc tạo run khi còn là thành viên). Không có lỗ mới.

**Không hỏng chức năng:** mọi UPDATE `hub.runs` ở scope user/system (cùng role `hub_rw`) chỉ đụng cột được cấp; `room_posted_at`
chỉ ghi trong definer (chủ `ai`); trigger/`FOR SHARE` không cần thêm quyền; Runtime Python dùng role `agent_runtime`, không đụng
`hub.runs`.

## Lỗi
| # | Mức | Nhóm | file:dòng | Vấn đề + kịch bản | Cách sửa đề xuất | Giao cho |
|---|---|---|---|---|---|---|
| M1 | Minor | 3 (lưới, giả danh agent) | `0015_x2b_rv1_room_post_trust.sql:79` (sender), `:48-51`; `room-post.repo.ts:83,93` | INSERT `hub.runs` + SIUD `hub.messages` vẫn mở ở scope user, và `runs.agent_id` không FK. Thành viên A của phòng R (có SQL ở `hub_rw`, scope user của mình) INSERT run `status='finished'`, `room_id=R`, `flow_id` = flow nền thật của A, `user_message_id` = một tin của A trong thread, `agent_id` = **bất kỳ uuid** (agent A không có AU, agent tenant khác), cùng một `hub.messages` `assistant` nội dung tuỳ ý ⇒ reconcile đăng tin "của agent X" vào R. Bị giới hạn: chỉ phòng A là thành viên, chỉ thread A có tin, tenant của A; không đọc được dữ liệu người khác. `runOutcome` join `hub.agents` không lọc `tenant_id` ⇒ tên agent tenant khác có thể hiện trong sự kiện SSE (cần biết uuid). Nội dung `hub.messages` vốn ghi được ở scope user nên lớp này không thể là ranh giới tin cậy | Definer: sender chỉ nhận `agent_id` có trong `hub.agents` cùng `tenant_id` (else `skipped`); `runOutcome`: `a.tenant_id = r.tenant_id`. TECH-DEBT: tạo run phòng / tin `assistant` qua definer, rồi REVOKE INSERT `hub.runs` (và INSERT/UPDATE `hub.messages` role `assistant`) khỏi scope user | backend-lead |
| M2 | Minor | 3 (lưới, phòng thủ chiều sâu) | `0015_x2b_rv1_room_post_trust.sql:15-16`; `room-run.tx.ts:49`; `cancel.service.ts:49,110` | Giữ UPDATE `room_id` chỉ để `setRunRoom` chạy sau `createRunTx`. Đã kiểm vô hại về lộ dữ liệu (xem trên). Phụ: INSERT run `running` gắn `room_id` = R hàng loạt (> `ROOM_CANCEL_MAX = 500`, sắp xếp theo `flow_id`) có thể đẩy run thật của R ra khỏi lượt huỷ khi xoá phòng ⇒ run đó chạy tới hết (tốn quota chủ run), nhưng definer vẫn `skipped` (phòng đã xoá) — không lộ | Ghi `room_id` ngay trong `insertRun` (cùng tx, đã có `lockFor`) rồi bỏ `room_id` khỏi GRANT UPDATE; `cancelRoomRuns` lặp tới hết thay vì một lượt `limit` | backend-lead |

## Rubric (phần bảo mật, vòng 2)
1 ✓ · 2 ✓ (R17/Q8 lượt chờ huỷ 2 lớp; D15 cancel lỗi không 500) · 3 ✓ (M1, M2 Minor — lưới) · 4 ✓ (0015 chỉ REVOKE/GRANT +
`CREATE OR REPLACE`, không phá dữ liệu, chạy lại được; không sửa 0014) · 5 — · 6 ✓ (11 ca `security-rv1.int` khoá đúng #1–#6;
không chạy ở vòng này) · 7 ✓ (`check:fn` 11 file OK) · 8 — · 9 ✓ (mã `security-1 #n` trong commit + header migration)
