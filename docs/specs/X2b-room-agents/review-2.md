## Kết luận: APPROVED · Spec: X2b-room-agents · Vòng: 2

Phạm vi: diff các commit sửa sau vòng 1 (`c5fd619`): FE `05c127a`; BE `1fd3a1a`, `dc6121c`, `2c4c8d0` (+ test khoá `2fc8de6` chỉ chạy qua `test:lock:verify`). Đối chiếu từng mục `review-1.md`. Phần bảo mật (0015, definer `room_post_agent_message`, `room_run_states`, `touchConversation` theo `room_id`) do security reviewer vòng 2 làm song song; ở đây chỉ xét chức năng. Không chạy int/e2e theo chỉ đạo (điều phối chạy `done:x2b`).

## Lệnh đã chạy
- `bun run typecheck` → 11/11 OK
- `check-fn.ts --files <13 file .ts/.tsx đổi c5fd619..2c4c8d0>` → OK · `check-size.ts --files <cùng tập + spec/plan>` → OK (công cụ không chấm `.md`; đo tay bên dưới)
- `bun test apps/hub-api/src/modules/{config,rooms,runs} apps/chat-web/src/features/rooms tools/scripts/src` → 268 pass, 0 fail
- `bun run depcruise --all` → không vi phạm (1697 module) · `bun run test:lock:verify` → OK (493 file)
- `wc -c` spec.md 32 002 B · plan.md 30 069 B
- **Không chạy** `lock-order`/`concurrency` int dù diff chạm khoá (`declineRoomConfirms` UPDATE `tool_confirmations` trong tx `system` riêng sau vòng huỷ; `finishRun` chỉ thêm cột RETURNING, không đổi khoá) ⇒ điều kiện: `done:x2b` (gồm int X2b + khoá) phải xanh.

## Đối chiếu Minor/Nit vòng 1
| # | Trạng thái | Ghi chú |
|---|---|---|
| 1 | Đã sửa | `use-room-runs.ts:36` selector trả chuỗi khoá (primitive) qua `useSyncExternalStore` ⇒ `RoomView` chỉ render lại khi tập run cần dọn đổi; effect phụ thuộc `[stale]`. `getSnapshot` tính lại mỗi render nên `pending` mới vẫn được dùng. |
| 2 | Đã sửa | `SseWriter.finish` gọi hook chỉ khi `finishRun` RETURNING `room_id` (`sse-writer.ts:211-212`); `CancelService.#announce` bỏ khi `target.roomId === null` (vắng ⇒ vẫn gọi, an toàn). |
| 3 | Đã sửa | `ConfigCache.poll` single-flight (1 chạy + 1 chờ; người gọi giữa chừng nhận vòng **chờ** ⇒ vẫn thấy COMMIT trước đó, giữ AC14) + unit test 10 lượt ⇒ 2 `readVersions`, 1 lần nạp. `#pollOnce` nuốt lỗi ⇒ vòng chờ không bị reject dây chuyền. |
| 4 | Đã sửa · nợ test | `#cancelDeclined` (`room-run.service.ts:209`): E15 lỗi ⇒ `writer.finish({kind:"failed",code:"CANCELLED"})` ⇒ `status=cancelled`, hook vẫn đăng "Đã huỷ"; không còn 500 sau khi tin đã vào phòng. Nếu E15 đã COMMIT rồi mới lỗi, `finishRun` trả null ⇒ vô hại. **Chưa có unit test nhánh lỗi** (xem #N2) và log không được nối (xem #N1). |
| 5 | Đã sửa · nợ test | Reconcile: lùi cấp số nhân trong bộ nhớ (10 s → trần 10 phút, Map ≤ 1000, loại khỏi truy vấn bằng `<> all(uuid[])`, mảng rỗng ⇒ `'{}'` đúng); `post` trả null ⇒ coi là lỗi. Run lệch phòng/thread ⇒ definer `skipped` + `room_posted_at` (dứt điểm, không lặp). Mất trạng thái lùi khi khởi động lại/khác instance — chấp nhận. **Chưa có unit test lùi** (#N2). |
| 6 | Đã sửa | Quyết định F4 ghi spec §10 (dòng 165) + TECH-DEBT #110. |
| 7 | Đã sửa (một phần) | TECH-DEBT #111 viết lại "đã xử lý", comment `AgentWait.tsx:20` trỏ đúng. Phần đề xuất "unit test AgentWait có `choices` từ server" chưa thấy test mới trong diff (`AgentBlock.test.tsx` có sẵn trường hợp `choices`) — chấp nhận. |
| 8 | Chưa sửa · có điều kiện | spec 32,0 KB / plan 30,1 KB > 25 KB. Điều kiện: docs-architect tách ở D1 (chuyển §10 "Trong lúc làm" + §12 sang `decisions.md`, tách plan BE/DB) **trước** khi đóng mốc. |
| 9 | **Chưa sửa** | `spec.md:5` vẫn `status: draft` — sửa cùng D1 (`in-progress` → `done` sau `done:x2b`). |
| 10 | Bỏ qua (chấp nhận) | Cần `started_at` trong payload `room.run_started` (đổi contract) — hợp lý để sau; nên ghi TECH-DEBT (#N2). |
| 11 | Chưa làm | Rất hiếm; nên ghi TECH-DEBT (#N2). |

## Lỗi mới / còn lại
| # | Mức | Nhóm | file:dòng | Vấn đề | Cách sửa đề xuất | Giao cho |
|---|---|---|---|---|---|---|
| N1 | Minor | 6/7 Vận hành | `apps/hub-api/src/app.ts:181` · `rooms/agents/room-run.service.ts:56,214,219` | `log` là tuỳ chọn trong `RoomRunDeps` nhưng `mountRoomAgents(x2a, { runs, prepareMention, config, cancel })` không truyền ⇒ `room-decline-cancel-failed` / `room-decline-finish-failed` (nhánh sửa #4) **bị nuốt im lặng** ở môi trường thật | Truyền `log: deps.log` ở `app.ts:181` (hoặc bỏ `?` để typecheck bắt) | backend-lead |
| N2 | Minor | 6 Test / 9 Truy vết | `docs/TECH-DEBT.md` | Nợ backend-lead báo (unit test nhánh lỗi D15 `#cancelDeclined`, unit test lùi reconcile `#fail`/`skip`), Nit #10, Nit #11 **chưa ghi** TECH-DEBT (mục cuối #113) | Thêm 1–2 dòng TECH-DEBT (#114…) kèm vị trí + cách xử lý; hoặc viết hai unit test (giả `cancel` ném; giả `post` ném 2 lần ⇒ `skip` chứa id, `until` tăng) | backend-lead (+ frontend-lead cho #10) |
| N3 | Nit | 4 Dữ liệu | `apps/hub-api/src/modules/runs/close/cancel.service.ts:122` | `declineRoomConfirms` chạy tx riêng **sau** vòng huỷ: nếu một lần huỷ trong vòng ném, xác nhận pending không được `declined`; với `userId` vắng (xoá phòng) decline mọi flow nền của phòng — đúng R17. Chỉ ghi để security/int xác nhận thứ tự khoá (`tool_confirmations` không qua khoá `flows`) | Không bắt buộc; nếu int khoá đỏ thì khoá `flows` trước như các đường E9 | backend-lead |

## Rubric
1 ✓ · 2 ✓ (N3, Nit #11) · 3 — (security reviewer vòng 2) · 4 ✓ · 5 ✓ (#1–#3 đã sửa) · 6 ✓ (N2: thiếu unit test hai nhánh sửa) · 7 ✓ (#8 điều kiện D1) · 8 ✓ · 9 ✓ (#9, N2)

Điều kiện APPROVED: `done:x2b` xanh (gồm int X2b/khoá); N1 sửa một dòng trước merge; N2 ghi TECH-DEBT; #8/#9 xử lý ở D1.
