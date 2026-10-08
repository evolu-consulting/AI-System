# Test plan · X2b-room-agents (qc, chế độ WRITE — chưa LOCK)

Nguồn: spec `d5f39da` (X2b-R01…R20, AC01…AC17, thread chung lần 2), plan BE §2, §3, §6, §8, §11; plan-frontend-e2e. Không Dify thật, không `claude-sub`: Runtime = `ScriptRuntime` H1 (provider `fake-cli`, test claim `hub.jobs` + XADD). `tests/.lock` **chưa ghi** (khoá sau Gate, task QC1).

## 1. Hạ tầng
| Thứ | Nội dung |
|---|---|
| `tests/acceptance/X2b/_x2b.ts` | `setupX2a` + `insertHubConfig` (H1) + quyền X2b; hub-api thật in-process (deps X2a `pingMs/instanceId` + `jobMaxWaitS` + `maxConcurrentRuns: 2`) |
| Người | A = `lan` (`hoadon`, `trello`) · B = `hoa` (chỉ `trello`, bỏ grant `hoadon` H1) · C = `cuc` (`hoadon`; ngoài phòng ở AC10, thành viên ở thread) · E = `tam` |
| Agent | `hoadon` (H1, + entitlement acme, tên "Hoá đơn") · `trello` mới `a2bb…051` (agentic-cli, profile fake) |
| Cột mới 0014 | đọc qua `to_jsonb(row)->>'room_id'` ⇒ trước B1 truy vấn trả rỗng, ca đỏ ở `expect` không ở `PostgresError` |
| `_modules.ts` | nạp động `room-agent.rules.ts` (vắng ⇒ `{}`) + `@ai/contracts/chat` |

## 2. Luật thuần + contract (`tests/acceptance/X2b/rules/`)
| Mã | FR/R/AC | File | Dữ liệu | Kỳ vọng |
|---|---|---|---|---|
| route ×5 | R02, R03, R11, AC01/03/04/05 | `room-agent-rules.test.ts` | "nhờ @hoadon…", "@@hoadon", "/dich", "@hoadon @trello", "@orchestrator @hoadon", `{answerRunId}` | plain / agents tags / orchestrator onlyKeys / `answer` không parse tag |
| canTriggerRun | R01, AC12 | ″ | user/agent × activeMember | chỉ user + thành viên |
| answerAccess | R11 | ″ | run null/khác thread/không chờ/người khác | not_found trước not_caller |
| placementOf | R13, D12 | ″ | timeline, mở thread, trong thread, tin agent | main/flow |
| roomContext ×5 | R07, R08, AC09, AC10, AC17 | ″ | 30 tin; cắt triggerSeq; luân phiên role; thread 60 (+25 main); dòng lệch phòng/thread | 20 dòng; 20 main + 50 thread; bỏ lệch; gộp `\n` |
| agentMessageView ×4 | R10, R12, R16 | ″ | finished/need_input/side_effect `PARAM-SECRET-77`/failed "QUOTA… lan" | câu chung, không lộ |
| askForViewer ×2 | R12, AC05/06 | ″ | caller/không | người khác chỉ `{kind}` |
| shouldPost, callerReadAfterPost, confirmStillAllowed | R17, R19, Q2 | ″ | bảng biên | như plan §8 |
| K1–K2 | R11, D9 | `contracts-x2b.test.ts` | | `CHAT_ROOM_AGENT_ERRORS={NOT_RUN_CALLER:403}`, không lẫn khối cũ |
| K3–K6 | §2.2 | ″ | hằng, `RoomMessage` tin agent, Send (+`flow_id`, `answer_run_id` cần `flow_id`, `attachment_ids` ⇒ fail), `RoomActiveRun` | strict |
| K7 | R18 | ″ | 3 sự kiện run | `parseMeStreamRunEvent`; lạ/khoá thừa ⇒ null |
| K8 | D9/D10 | ″ | | X2a giữ 8 mã / 8 sự kiện (xanh trước code — bảo toàn) |

## 3. Acceptance int (`tests/acceptance/X2b/*.int.test.ts`)
| Mã | AC/R | File | Dữ liệu | Kỳ vọng |
|---|---|---|---|---|
| I01 | AC01 | `invoke` | A "@hoadon kiểm tra" | 201 tin gọi + `X-Run-Id`/`X-Flow-Id`; 1 run user_id=A, room_id |
| I02 | AC01, R10 | ″ | Runtime trả "HD-12 hợp lệ." | A, B thấy tin agent (`agent`, `caller` A, `trigger_message_id`, `run_status`) |
| I03 | AC07 | ″ | | usage_logs A > 0, B = 0 |
| I04 | R10 | ″ | đang chạy | `active_runs` running, caller A |
| I05–I07 | AC02, R04, AC14 | ″ | B "@hoadon"; "@khongco"; thu hồi grant A | 404 `AGENT_NOT_FOUND` cùng dạng, 0 run, tin không lưu |
| I08 | AC03 | ″ | không tag / giữa câu / "@@" | 201, 0 run (+ đối chứng tag hợp lệ ⇒ 1 run) |
| I09 | AC04 | ″ | hai tag | 1 run |
| I10 | AC12 | ″ | agent trả "@hoadon kiểm tra lại" | vẫn 1 run, 1 tin agent |
| I11 | AC08 | ″ | A 2 run đang chạy | 429 + `Retry-After: 5`, không lưu; B `@trello` chạy |
| I12 | R16 | ″ | job lỗi "LEAK-ERR-91" | tin agent failed, không lộ |
| I20–I21 | AC09, R08 | `context` | 30 tin; tin sau tin gọi; tin agent trước | 20 dòng 11…30; cắt; assistant |
| I22 | AC10 | ″ | "PHONG-KHAC-SECRET-31", tin C1 riêng `R.msgU1` | không trong history/prompt |
| I23 | AC10 | ″ | C ngoài phòng gọi | 404 `ROOM_NOT_FOUND`, 0 run (**xanh trước code**: hồi quy X2a) |
| I24 | AC10 | ″ | B, C gọi `/runs/:id/events|cancel|trace` | 404 cả 3 |
| I25 | AC10 | ″ | C đọc phòng | 404 |
| I26 | AC10, D2 | ″ | shim `runs.conversation_id` | không trong `/conversations`, 404 GET/POST |
| I27–I28 | AC11 | ″ | `attachment_ids` | 400 (**xanh trước code**: strict X2a); job không `attachments` |
| I30–I33 | AC05 | `wait` | need_input "Số hoá đơn nào?" | ask need_input; `active_runs` waiting; B `answer_run_id` ⇒ 403, không run; A ⇒ 201 run user_id=A |
| I34–I37 | AC06, R12 | ″ | `tool_confirmations` pending (SQL) + "Xác nhận tạo thẻ PARAM-SECRET-77" | B/E: ask `{kind}` và không chứa tham số; A có; B ⇒ 403, xác nhận vẫn pending; run lạ ⇒ 404 `NOT_FOUND` |
| I40 | AC17, R13 | `thread` | B "ok" trong T | 201, 0 run, `placement=flow`; A, C thấy qua `?flow_id`; không ở timeline |
| I41 | AC17 | ″ | B "@hoadon" trong T | 404, không lưu |
| I42 | AC17, R05, R07 | ″ | C "@hoadon tiếp"; tin A, B, timeline trước gốc, phòng riêng C | run user_id=C; history có tên + tin A/B/timeline, không phòng khác; usage C |
| I43 | AC17, R11 | ″ | lượt C chờ side_effect | A ⇒ 403; C (không tag) ⇒ 201 run C |
| I44 | AC17 | ″ | T 60 tin | history đúng 50 dòng t9…t58 |
| I45 | AC10 | ″ | `flow_id` phòng khác / lạ; `answer_run_id` thiếu `flow_id` | 404 `NOT_FOUND`; 400 |

## 4. Đỏ đúng lý do (DB `ai_system_qc_test`, 2026-10-08, code trước B1)
| File | Tổng | Đỏ đúng lý do | Xanh trước code (chủ ý) | Chỗ đỏ |
|---|---|---|---|---|
| rules/room-agent-rules | 22 | 22 | 0 | `expect(typeof fn)` |
| rules/contracts-x2b | 8 | 7 | 1 (K8) | `expect` export vắng |
| invoke.int | 12 | 12 | 0 | `invoke` `X-Run-Id` / 201≠404 |
| context.int | 9 | 7 | 2 (I23, I27) | `invoke` `X-Run-Id` |
| wait.int | 8 | 8 | 0 | `invoke` |
| thread.int | 6 | 6 | 0 | `invoke` (mở thread) |
| **Tổng** | **65** | **62/62** | 3 | không ca nào đỏ ở `PostgresError`/`TypeError` fixture |

Lệnh: `HUB_TEST_DATABASE_URL=<qc> bun --env-file=.env.test-qc.local --config=bunfig.int.toml test --timeout 30000 tests/acceptance/X2b`; `bun test tests/acceptance/X2b/rules`. `bun run typecheck` sạch cho `tests/acceptance/X2b`.

## 5. Chưa viết (bàn giao lần gọi kế)
| Mục | AC/R | Ghi chú |
|---|---|---|
| `realtime.int.test.ts` | AC16, R18, R19 | 2 instance; B nhận `room.run_started/finished` qua `parseMeStreamRunEvent`, `room.run_waiting{caller_id}`; unread B +2, A 0; C ngoài phòng không nhận (sentinel); lỗi 429 của A không phát |
| `lifecycle.int.test.ts` | R17, Q8, Q2/D15 | B chủ; A rời / bị bớt / phòng xoá giữa run ⇒ run `cancelled`, 0 tin agent; xác nhận khi agent bị thu hồi ⇒ "đã huỷ" |
| `db.int.test.ts` | B1 | CHECK `room_messages_user_ck/agent_ck`, unique `(run_id)`, definer scope `system` ⇒ 42501, RV2-N2c giữ |
| e2e `e2e/chat/x2b-*.x2b.ts` | AC13, 15, 16, 05, 06, 08, 17 (E-A1…A11) | cần stack: `_x2a-stack` + seed agent/quyền A/B/C + Runtime giả (test claim `hub.jobs`, Redis DB 14) — **Cần bổ sung (backend-lead B7):** fixture dev C có `hoadon`; xác nhận nhãn plan-frontend-e2e theo thread lần 2 (bỏ `can_reply`, "Xem flow") |
| R20 / AC-H07 | R20 | hồi quy bằng bộ C1/H1 hiện có (`tests/acceptance/C1`, `H1`) trong `done:x2b` |

## 6. Ghi chú / mơ hồ
- `done:x2b`: qc không được sửa `package.json`/`tools/scripts` ⇒ **đề xuất** (backend-lead/điều phối): `"done:x2b": "bun --env-file=.env.local tools/scripts/src/done-x2b.ts"` theo mẫu `done-x2a.ts`: typecheck, `test:lock:verify`, `bun test tests/acceptance/X2b/rules`, int `tests/acceptance/X2b tests/acceptance/X2a tests/acceptance/H1 tests/acceptance/C1`, `bunx playwright test -c e2e/chat/playwright.x2b.config.ts`, `e2e:chat:x2a`.
- `side_effect` dựng bằng `tool_confirmations` pending (SQL) trước khi Runtime trả kết quả — giả định poster đọc pending của run (plan §5 "Đăng tin agent"). `workflow_id` giả (không FK). Nếu B5 cần workflow thật ⇒ ghi Tranh chấp.
- Nội dung tin gọi của người khác trong ngữ cảnh: test chỉ đòi dòng kết thúc bằng nội dung và có tiền tố tên (plan §6 `"<display_name>: …"`).
- I05 "AGENT_NOT_FOUND cùng dạng": so `status`, `code`, tập khoá `error` (không so `suggestions`).

## 7. Int realtime / lifecycle / db (qc lần 2, 2026-10-08 — thêm vào §5, chưa LOCK)
| Mã | AC/R | File | Dữ liệu | Kỳ vọng |
|---|---|---|---|---|
| I50–I51 | AC16, R18 | `realtime` | B nối hub2 (`qc-x2b-2`), A gọi qua hub1; Runtime "HD-12 hợp lệ." | B nhận `room.run_started {room_id, flow_id = X-Flow-Id, agent.key hoadon, caller A, trigger_message_id}` rồi `room.message` tin agent + `room.run_finished {finished, message_id = tin agent}`; `parseMeStreamRunEvent` ≠ null |
| I52 | R18 | ″ | E thành viên (hub1), C ngoài phòng (hub2) | E nhận run_started/finished; C 0 sự kiện của phòng (sentinel X2a) |
| I53 | R18, AC08 | ″ | A 2 run, lần 3 ⇒ 429 | B đúng 2 `run_started`, không `room.message` "việc 3" (sentinel) |
| I54 | R19, D14 | ″ | sau tin agent | `room.unread` cuối: B 2 (tin gọi + agent), A 0; `GET /rooms` khớp |
| I55 | R18 | ″ | need_input | B `room.run_waiting {caller_id A, kind need_input, flow_id}` hợp lệ |
| I56 | R12, AC06 | ″ | `tool_confirmations` pending + "PARAM-SECRET-77" | B, E `run_waiting {side_effect}`; raw mọi sự kiện B/E không chứa tham số; `room.message` của A có |
| I57 | R11, R18 | ″ | B `answer_run_id` của A ⇒ 403 | B chỉ thấy 1 `run_started` (run gốc) |
| I60–I62 | R17, Q8 | `lifecycle` | phòng B chủ, A gọi, job đã claim; A rời / B bớt A / B xoá phòng; Runtime trả kết quả trễ | run `cancelled`, 0 tin agent của run; (bớt) E nhận `run_finished {cancelled, message_id: null}` |
| I63 | R17 (đối chứng) | ″ | E rời giữa run | run A chạy nốt, tin agent `finished` |
| I64 | AC14, Q2 | ″ | thu hồi grant `hoadon` của A khi run chạy | run chạy nốt `finished` |
| I65 | D15, Q2 | ″ | side_effect pending, thu hồi, A "Đồng ý" + `answer_run_id` | 201 + `X-Run-Id`; run mới `cancelled`; `tool_confirmations` ⇒ `declined`; tin agent `run_status cancelled` |
| I66 | D15 (đối chứng) | ″ | còn quyền, A xác nhận | 201; run mới có job cho Runtime |
| I70 | §4.1 | `db` | `pg_constraint` | có `room_messages_{user,agent,flow,ask}_ck`, `runs_room_posted_ck`; bỏ `room_messages_user_no_agent_ck` |
| I71 ×5 | §4.1 | ″ | tin agent thiếu `sender_id/run_id/flow_id/trigger_message_id/run_status` (owner) | 23514 |
| I72 | §4.1 | ″ | 2 tin agent cùng `run_id` | ok, 23505 (`room_messages_run_uq`) |
| I73 ×7 | §4.1 | ″ | tin user có `run_id/trigger/run_status/wait_kind/ask/step_count/run_ms` | 23514 (2 ca `run_id`/`trigger` **xanh trước code**: CHECK X2a cũ) |
| I74–I76 | §4.1 | ″ | user + `flow_id` + `placement flow`; `placement flow` không `flow_id` / `'x'`; `ask`+`side_effect`, `run_status running`, `wait_kind` lạ, `step_count -1`; `runs.room_posted_at` khi `room_id` NULL | ok; 23514 |
| I77 | §4.2, §11 | ″ | `pg_proc` 4 hàm | `prosecdef`, `search_path=` trong `proconfig`, `hub_rw` EXECUTE, không PUBLIC |
| I78 | §4.2 | ″ | `room_post_agent_message`, `room_fanout_sys` ở scope `user` (hub_rw) | 42501 |
| I79 | §4.2 | ″ | `is_room_thread(phòng, uuid ngẫu nhiên / flow riêng H1)` | false |
| I80–I83 | AC17, AC10 | ″ | thread qua API; hoa (không `hoadon`) chèn `flow_id` thread ⇒ ok + `is_room_thread` true; cuc ngoài phòng ⇒ từ chối, 0 hàng; flow ngẫu nhiên / `R.flow2` ⇒ từ chối (**xanh trước code**, hồi quy RV2-N2c); thread phòng khác ⇒ từ chối | |
| I84 | AC10 | ″ | RLS hub_rw | cuc: 0 tin agent / 0 tin phòng / 0 run; tam: 1 tin agent, 0 run của lan |

### 7.1 Đỏ đúng lý do (DB `ai_system_qc_test`, 2026-10-08, code trước B1)
| File | Tổng | Đỏ đúng lý do | Xanh trước code (chủ ý) | Chỗ đỏ |
|---|---|---|---|---|
| realtime.int | 8 | 8 | 0 | `invoke` `X-Run-Id` (`toMatch`) |
| lifecycle.int | 7 | 7 | 0 | `invoke` `X-Run-Id` |
| db.int | 26 | 23 | 3 (I73 `run_id`, `trigger_message_id`; I82 flow lạ) | `expect` — probe trả 42703 (cột 0014 vắng) / hàm vắng / constraint vắng; ca thread đỏ ở `invoke` |
| **Tổng mới** | **41** | **38/38** | 3 | không ca nào đỏ ở `PostgresError`/`TypeError` fixture (`seedRoom`, `beforeAll` chạy sạch) |
Tổng X2b: 106 test (65 + 41), đỏ đúng lý do 100/100, xanh chủ ý 6.

### 7.2 Giả định (có thể thành Tranh chấp)
- I60–I62: "đang chạy" = job đã claim; kết quả Runtime về sau huỷ bị bỏ qua (`rt.agent` lỗi được nuốt). Không đòi usage (Q8) vì Runtime giả không ghi usage trước huỷ.
- I61: người nhận `run_finished {message_id: null}` khi bớt A gồm E (thành viên hiện tại) — theo plan §2.3.
- I65 (D15): mã HTTP xác nhận khi mất quyền = 201 + `X-Run-Id` (plan D15 "vẫn lưu tin + tạo run rồi kết thúc ngay"), `tool_confirmations.status = 'declined'`, tin agent `run_status = 'cancelled'`.
- I54: chưa đọc B = 2 (tin gọi của A + tin agent), đọc qua `room.unread` cuối cùng + `GET /rooms`.
- I80: chèn tin thread trực tiếp DB với `placement:'flow'`; is_room_thread không kiểm thành viên (lớp thành viên là policy insert).
