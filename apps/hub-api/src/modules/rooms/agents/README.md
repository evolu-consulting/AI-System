# rooms/agents — HUB-FR-101, HUB-BR-21, HUB-BR-22 (X2b)

Agent trong phòng chat. Spec: `docs/specs/X2b-room-agents` (plan §1 D1–D16, §4.2, §5, §7).

| File | Vai trò |
|---|---|
| `room-agent.rules.ts` | luật thuần (route tag, quyền trả lời, placement, ngữ cảnh, bản công khai tin agent, D14) |
| `room-run.service.ts` · `room-run.tx.ts` · `room-context.repo.ts` | gọi agent từ tin phòng: 1 tx `user` của người gửi (khoá `rooms` → `createRunTx` C1 → tin gọi), sau COMMIT `launch` |
| `room-post.ts` · `room-post.repo.ts` | `RoomRunPoster`: đăng tin agent ở tx2 scope `system` qua definer `hub.room_post_agent_message` (hook `onClosed` + reconcile 5 s) |
| `room-post.view.ts` · `agent-msg.sql.ts` | tin agent theo người xem (D3) — dùng chung cho timeline và `room.message` |
| `room-run-events.ts` | `room.run_started` / `room.run_waiting` / `room.run_finished` + `room.message` theo người nhận |

Luật đăng tin (B5):
- Gọi SAU khi run dừng (tx1 C1 đã COMMIT): `SseWriter.finish` và `CancelService` gọi `onClosed(runId)` đồng bộ; poster chạy async, lỗi chỉ log. Sweeper/lease không gọi hook ⇒ vòng `reconcile` (5 s, `runs_room_unposted_idx`, ≤ 20 run/lượt) bù.
- Definer idempotent theo `runs.room_posted_at`: `reason` = `posted` (đăng + phát `room.message`, `room.unread`, `room.run_waiting?`, `room.run_finished`) · `skipped` (R17: phòng xoá / người gọi rời ⇒ chỉ `room.run_finished {message_id: null}`) · `already` (đã đăng / run còn `running` ⇒ **không phát gì**). Kết quả trễ sau huỷ bị bỏ (run đã đăng "đã huỷ").
- `p_meta`: `run_status`, `wait_kind`, `ask` (chỉ khi `wait_kind = need_input`, nếu không CHECK 23514), `step_count`, `run_ms`.
- D3: bản riêng `side_effect` (nội dung + câu hỏi có tham số) chỉ tới người gọi; người khác nhận câu chung, `ask = {kind}`. Timeline lấy bản riêng qua JOIN `runs → messages` dưới scope user (RLS chỉ trả cho người gọi).
- Thứ tự khoá tx2: `rooms` → `runs` → `room_members` → `room_messages` (không chu trình với đường gọi, plan §5).

File đính kèm (X2b-2, `docs/specs/X2b2-room-attachments` plan §6.2–§6.3; SQL/luật ở `attachments/room-files*`):
- Tin gọi agent có `attachment_ids`: `writeTrigger` INSERT tin gọi → gắn file (thiếu ⇒ 404, ROLLBACK cả run) → file-set run = file của tin gọi + cửa sổ ngữ cảnh (timeline ≤ 20, thread ≤ 50, gồm tin agent có `out/` cũ, D9) → `runs.attachment_ids` → `launch(p, files)`. Run phòng **không** dùng `attachFiles` H2c (`createRunTx`: `p.room ⇒ []`, D10). Khoá thêm sau `room_messages`: `attachments` → `runs`.
- `out/` (D11): `SseWriter.finish` không gắn output khi run thuộc phòng; `room-post.ts` gắn output vào tin agent (`room_message_id = answer_message_id`) trong cùng tx2 chỉ khi `status=finished` ∧ definer trả `posted` (`shouldBindRoomOutputs`); ref có ở cả bản công khai và bản người gọi. Lỗi/huỷ/`skipped`/`already` ⇒ không gắn ⇒ sweeper R27 dọn sau 24 giờ.
- Phòng xoá ⇒ đọc file 404 ngay (RLS thành viên); nội dung xoá bởi sweeper (b2) `attachments/sweeper.ts`.

Seed dev (B7, `bun run hub:dev`): `tools/hub-dev/src/fixture-agents.ts` (chạy SAU `hub:seed`, cần agent `assistant` để lấy profile) tạo agent `hoadon`, `trello` + entitlement tenant `evolu`; idempotent. Người dùng (mật khẩu dev chung):

| Vai | evolu | hoadon | trello | Ghi chú |
|---|---|---|---|---|
| A | `julian.bui` | có | có | chủ nhóm "Evolu team" |
| B | `thomas.tran` | **không** | có | AC17: menu "@" không có `hoadon`; tag tay `@hoadon` bị từ chối |
| C | `vio.ngo` | có | không | thấy `hoadon` ⇒ ca "người thứ ba gọi được" |

(e2e `_x2b-stack.ts` dùng tenant `acme` test với `lan`=A, `thu`=B, `an`=C — cùng sơ đồ quyền.) Fixture phòng X2a (`fixture-rooms.ts`) đã có nhóm "Evolu team" đủ 3 người trên.
