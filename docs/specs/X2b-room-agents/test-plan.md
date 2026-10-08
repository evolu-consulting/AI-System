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
