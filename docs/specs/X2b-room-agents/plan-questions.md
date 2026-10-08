# Phụ lục plan X2b · Trả lời FE, câu hỏi, Q9

Tách từ [`plan.md`](plan.md) §12–§14 (2026-10-08 lần 2) để giữ trần 30 KB. Quyết định D*, mục §* trỏ về `plan.md`.

## 12. Trả lời `plan-frontend.md` §10
| # FE | Chốt BE |
|---|---|
| 1 | Body giữ `RoomMessage`; run qua `X-Run-Id`/`X-Flow-Id` + `room.run_started` (D11). `AGENT_NOT_FOUND.details` chỉ `{suggestions}` (schema H2b strict, không thêm `tag`; FE lấy tag từ ô nhập) |
| 2 | Có: `placement`, `agent`, `caller`, `flow{message_count,last_active_at}`, `ask`, `steps{count,ms}`. Trạng thái tên **`run_status`** `finished\|failed\|cancelled` (không `status: ok`) |
| 3 | Có (D3 + §7): người khác `ask: {kind}` |
| 4 | Có: `GET /rooms/:id` `active_runs` (§2.2), `status running\|waiting` + `wait_kind` |
| 5 | Có, hằng riêng `ME_STREAM_RUN_EVENTS` + `parseMeStreamRunEvent` (D10); `run_finished` thêm `flow_id`, `message_id` |
| 6 | Có; thread lạ 404 `NOT_FOUND`. **Đổi theo chốt lần 2**: bỏ `flow.can_reply`; mọi thành viên gửi vào thread (`flow_id`), không tag ⇒ tin người↔người (201, không `X-Run-Id`); tag trong thread ⇒ run người tag (thiếu quyền 404 `AGENT_NOT_FOUND`); trả lời ask/xác nhận = `answer_run_id`, chỉ người tag, khác 403 `NOT_RUN_CALLER` |
| 7 | Sang X2b-2 (D16) |
| 8 | `NOT_RUN_CALLER` ở `CHAT_ROOM_AGENT_ERRORS` (không `CHAT_ROOM_ERRORS`, D9); huỷ chỉ người gọi (RLS `runs`) |

## 13. Câu hỏi
### 13.1 Mặc định spec §9 mà plan dựa vào
Q1 → §2.3, §7 · Q2 → D15 · Q3 → không limit mới · Q4 → D5, §3 bước 6–7 · Q5 → D3, `agentMessageView`, `askForViewer` · Q6 → §6 · **Q6/Q7 chốt lần 2** → D12, D13, §6, `answerAccess`, `roomContext`, `placementOf` · Q8 → §5, `shouldPost` · Q9 → D16, §14 · Q10 → D8 · Q11 → list `flow_id` mọi thành viên, trace chỉ người gọi · Q12 → D4, D5.
### 13.2 Câu hỏi mới (mức Thường, có mặc định — không chặn Gate)
| Q | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| Q13 | Tin trong flow (`placement=flow`) có tính chưa đọc? | **Có** (mọi tin phòng có `seq`; bộ đếm X2a O(1)). FE hiện "n tin trong luồng" để giải thích |
| Q14 | File `out/` agent tạo trong run phòng? | X2b: không hiện trong phòng (gắn tin riêng ở hội thoại nền, sweeper dọn như C1); hiện cho cả phòng ở X2b-2 |
| Q15 | `@orchestrator` là tag dành riêng chỉ trong phòng? | **Có** (D8). Agent có key `orchestrator` (nếu có) bị che trong phòng → TECH-DEBT: Studio cấm key này |

## 14. Q9 — tách X2b-2 (người dùng chốt 2026-10-08)
| Hạng mục | Ước lượng |
|---|---|
| Migration: `attachments.room_message_id/room_id`, FK, CHECK `attachments_bound_ck` (đòi `conversation_id`), RLS đọc cho **thành viên** (hiện chỉ chủ file) qua definer | ~120 dòng SQL, rủi ro cao |
| `POST /rooms/:id/messages` nhận `attachment_ids` (bind, hạn mức, 404 `ATTACHMENT_NOT_FOUND`), `GET /attachments/:id/content` cho thành viên, sweeper (rời/xoá phòng), `RoomMessage.attachments`, file vào run (R09) + `out/` lên phòng (Q14) | ~450 dòng TS, 2 task cao |
| FE F5 + e2e + test cách ly file (AC11) | ~300 dòng + test |
Tổng ≈ 40% BE + 1 task FE + bề mặt rò file mới ⇒ > 1/3 mốc. **Đề xuất:** X2b-2 = đính kèm phòng (FR-44 trong phòng, R09 đầy đủ, AC11, Q14). Ở X2b: AC11 rút còn "gửi `attachment_ids` vào tin phòng → 400; run phòng `runs.attachment_ids = {}`" (qc chỉnh test-plan). Cần điều phối báo người dùng (Luật 2b).
