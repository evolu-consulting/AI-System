# Readiness · X2b-room-agents

## Lần 1 · 2026-10-08 (spec `d5f39da`, plan BE `d5f39da`, FE `d1e492c`, test `6dffb0f`/`89a54cc`/`65f93f2`)

## Kết luận: NOT READY
Phạm vi đã kiểm: `docs/specs/X2b-room-agents/` · 9 file (spec, plan, plan-questions, plan-frontend, plan-frontend-i18n, plan-frontend-e2e, tasks, test-plan, test-plan-e2e) + CLAUDE.md, WORKFLOW (Kỷ luật token, Chính sách model), BA §6.9/§11 (Grep), usecases CHAT-AC-46…50, X2a spec R17/§5.3, code (mục dưới) · mã yêu cầu: HUB-FR-101, HUB-FR-103, HUB-BR-21, AC-H26, AC-H27, CHAT-AC-46…50, X2b-R01…R20, X2b-AC01…AC17

Mọi lỗ hổng Chặn/Cao dưới đây **tự xử được theo Luật 2** (nguồn: spec/BA/code hiện có) — **không có câu hỏi mới cho người dùng**. Sửa xong → chạy lại readiness (lần 2, chỉ diff).

## Lỗ hổng
| # | Mức | Mục | Vị trí (file:dòng hoặc mã) | Vấn đề | Mặc định đề xuất |
|---|-----|-----|----------------------------|--------|------------------|
| 1 | Chặn | H2 | spec.md:60, :75, :87 | Còn `<!-- backend-lead -->` ×2, `<!-- frontend-lead -->` (nội dung đã điền) — luật H2 coi là Chặn | Tự xử (điều phối/docs-architect): xoá 3 marker |
| 2 | Cao | F | spec.md:134; plan.md §16 (:181); tasks.md RV2 | Lệnh xong `bun run typecheck && bun test && bunx playwright test X2b` không chạy int (`bunfig.toml` bỏ `**/*.int.test.ts`) và không chạy e2e X2b (cấu hình gốc `testDir ./e2e`, e2e chat dùng `-c e2e/chat/playwright.x2b.config.ts`). `done:x2b`, `e2e:chat:x2b` chưa có trong `package.json`, không task nào sở hữu | Tự xử: B7 thêm `tools/scripts/src/done-x2b.ts` (mẫu `done-x2a.ts`, bước như test-plan §6) + script `done:x2b`, `e2e:chat:x2b` (test-plan-e2e §4) vào `package.json`; spec §8 + plan §16 Lệnh xong mốc = `bun run done:x2b`. Đề xuất "backend-lead thêm ở B7" **chấp nhận được** khi đã ghi vào cột File/Lệnh xong của B7 |
| 3 | Cao | D/F | spec.md:117 (AC02), CHAT-AC-49; plan D8; plan-frontend-e2e.md:37 (E-A10) | AC02 đòi "kèm gợi ý agent B dùng được", nhưng D8 dùng `suggestAgents` (Levenshtein ≤ max(2, len/3), `commands/suggest.rules.ts:24`): "hoadon" vs `trello` ⇒ `[]` ⇒ với dữ liệu AC không có gợi ý; E-A10 (plan) kỳ vọng "Ý bạn là" là sai; không test nào khẳng định `suggestions` ≠ rỗng | Tự xử (FR-101 "cùng Router… như FR-91"): AC02 viết lại "gợi ý = `details.suggestions` (≤ 3 key gần giống trong quyền B, như C1; dữ liệu AC ⇒ rỗng, không hiện 'Ý bạn là')"; qc thêm 1 ca int "B `@trelo x` → 404, `suggestions=["trello"]`, 0 run"; plan-frontend-e2e E-A10 bỏ "Ý bạn là" |
| 4 | Cao | J | plan.md:112 (`UserStreamWriter`), :175 (`ownedConversation`); tasks B4, F2 | Symbol không tồn tại: thật là `publishUserEvents` + `UserEvent` (`apps/hub-api/src/lib/user-stream.ts:14,26`), mà `UserEvent` chỉ nhận `MeStreamEvent` (8 sự kiện) ⇒ không chở được `ME_STREAM_RUN_EVENTS`; repo hội thoại có `findConversation`/`ownedBy`, không có `ownedConversation`. FE `features/realtime/me-stream-driver.ts:166` chỉ `parseMeStreamEvent` ⇒ bỏ khung run; file này không có trong F2 | Tự xử: plan §7/§15 sửa tên thật; B4 thêm `apps/hub-api/src/lib/user-stream.ts` (`UserEvent` ∪ `{userIds} & MeStreamRunEvent`); F2 thêm `features/realtime/me-stream-driver.ts` (thử `parseMeStreamRunEvent` khi `parseMeStreamEvent` null, vẫn ghi `lastEventId`) |
| 5 | Cao | E/B | plan-frontend.md:86; i18n:29 `roomAgent.cancelledNoPerm` | FE phải phân biệt "huỷ vì mất quyền" (D15) với Dừng/R17, nhưng `RoomMessage` chỉ có `run_status: cancelled`, không có lý do ⇒ không cài được | Tự xử (đơn giản nhất, không đổi contract, khớp Q2 "tin agent 'đã huỷ'"): mọi người thấy `roomAgent.cancelledOther` "Đã huỷ"; xoá `cancelledNoPerm` và hàng §4 tương ứng |
| 6 | Cao | J | plan-frontend-i18n.md:18, :20, :29 | Ô VI lẫn chú thích trong ngoặc ("{{name}} hỏi (người gửi **lượt đó**)", "… (người gửi lượt)", "… (chỉ người gửi lượt đó thấy)") — hai cách hiểu chuỗi nguyên văn | Tự xử: chuỗi VI = phần ngoài ngoặc (khớp plan-frontend-e2e §1 "<B> hỏi", "Chạy bằng quyền của <B>"); chú thích chuyển ra câu dưới bảng |
| 7 | Thấp | I | spec.md:131 (AC16 "chưa đọc +1"); plan-frontend-e2e.md:31 (E-A3 "+1") | Lệch chữ với test (B = 2) — **phán: test đúng**: X2a-R17 đếm mọi tin `sender_id ≠ user` ⇒ tin gọi của A (+1) + tin agent (+1, R19) khi B không mở phòng | AC16 + E-A3: "huy hiệu B tăng 1 cho tin agent (tổng 2 kể cả tin gọi); A không tăng" |
| 8 | Thấp | I | plan.md:21 (D14) ↔ spec R19 | D14 cho phép tin agent tính chưa đọc cho người gọi khi họ chưa đọc hết (lệch R19 ở biên) nhưng chưa ghi spec §10 | Ghi 1 dòng spec §10 "Trong lúc làm" |
| 9 | Thấp | B | plan §4.2 `room_post_agent_message` | Trả `posted=false` cho cả "đã đăng" và "R17 không đăng" ⇒ poster không biết có phát `run_finished{message_id:null}` hay không (lần đăng trùng phát thừa, FE vô hại) | Thêm cột `reason` (`posted\|already\|skipped`); chỉ phát `run_finished` khi khác `already` |
| 10 | Thấp | I | plan-frontend.md:20 (D11), §8 Q9, §9 F5; tasks.md cuối; spec.md:149 (Q11 "chỉ-đọc"); plan.md:3 ("AC01…AC16"); plan-frontend.md:34 (`canReply`) | Chữ cũ trước chốt: Q9 đã tách X2b-2 (không còn "chờ duyệt/có thể cắt"); Q11 bị Q7 lần 2/R13 thay (mọi thành viên nhắn được); AC17 đã có; `can_reply` đã bỏ | Sửa chữ theo chốt 2026-10-08 |
| 11 | Thấp | H | tasks.md P2, RV1, RV2; B5 | P2/RV2 cột `Đọc` trống; RV1 không có điều kiện xong; D15 (xử lý trong tx gọi `room-run.tx`) xếp ở B5 | RV1 Lệnh xong "APPROVED + security review đạt" (như X2a RV); RV2 `Đọc` = `review-1.md`, `review-security-1.md`; D15 chuyển B4 (hoặc ghi B5 sửa `room-run.tx.ts`) |
| 12 | Thấp | I | test-plan.md:10 vs test-plan-e2e.md §1, §4; test-plan §5 | Tên hiển thị `hoadon`: int "Hoá đơn", e2e = key; Redis DB e2e 13 (§1) vs 14 (test-plan §5); tên người int (hoa/cuc) ≠ e2e (thu/an) | Ghi rõ là fixture riêng từng bộ; B7 seed dev đặt tên theo e2e hoặc ghi chú; thống nhất Redis DB 13 |
| 13 | Thấp | J | plan-frontend-i18n.md:32 | `threadContextHint` chỉ nói "50 tin", thiếu "+ 20 tin timeline" (R07) | "Agent đọc được cả thread này (tối đa 50 tin gần nhất) và 20 tin trước đó của phòng." / EN tương ứng |
| 14 | Thấp | D | plan.md:23 (D16) | qc I28 đòi payload job **không có khoá** `attachments`; plan chỉ ghi `files = []` | Ghi D16: "payload không có khoá `attachments` (như `orchestrator.loop.ts:193` khi rỗng)" |
| 15 | Thấp | D | plan §5 hàng "Đăng tin agent"; test-plan §6 | Giả định qc (side_effect = `tool_confirmations` pending của run) chưa là câu hợp đồng | Ghi plan §5: `pendingConfirm = EXISTS tool_confirmations WHERE run_id = run AND status='pending'`; câu hỏi riêng = nội dung trả lời ở `hub.messages` |

## Phán các điểm qc nêu
1. **Chưa đọc B = 2**: test đúng (X2a-R17 + X2b-R19); spec AC16/E-A3 chỉnh chữ (#7).
2. **D15/I65** (201 + `X-Run-Id`, run mới `cancelled`, `tool_confirmations` `declined`, tin agent `cancelled`): **khớp Q2** ("kiểm lại quyền lúc xác nhận, thiếu → huỷ, tin agent 'đã huỷ'"); Q2 không quy định HTTP, D15 "vẫn lưu tin + tạo run" ⇒ 201 + header theo plan §3. Phần UI "huỷ vì mất quyền" không cài được → #5.
3. **R17/I61** (`run_finished {cancelled, message_id:null}`, kết quả trễ bỏ qua): **khớp** R17/Q8 + plan §2.3 (null = không đăng), §4.2 definer, §5 hàng Rời; người nhận = thành viên hiện tại (E). Lỗ nhỏ #9.
4. **side_effect dựng bằng SQL, `workflow_id` giả**: **không thành tranh chấp** — `tool_confirmations.workflow_id` NOT NULL nhưng không FK (`0002_h2a_dify.sql:90–102`), `decideConfirmations` (`runs/confirm.repo.ts`) chỉ chép vào step; FK `flow_id`/`run_id` buộc dùng flow nền thật (`runs.flow_id`). Ghi thành hợp đồng ở #15.
5. **"Key không tồn tại" ≡ "không có quyền"**: **không vượt spec** — X2b-R04 ghi "hai trường hợp như nhau, không lộ agent tồn tại". **Payload không `attachments`**: khớp D16 + code hiện có; ghi rõ ở #14.
6. **E-A10 không khẳng định `suggestions`**: test đúng (với B chỉ `trello`, `suggestAgents("hoadon")` = `[]`); lỗi nằm ở AC02/plan E-A10 → #3.
- **Security review trước `done:x2b`**: Đạt — tasks.md RV1 (reviewer + security, Opus) phụ thuộc B7/F6, RV2 (`done:x2b`) phụ thuộc RV1; ma trận plan §11; hard-stop spec §9.
- **Script `done:x2b`/`e2e:chat:x2b` để backend-lead thêm ở B7**: chấp nhận được, nhưng phải ghi vào B7 và sửa Lệnh xong spec/plan (#2).

## Mâu thuẫn giữa tài liệu
- spec AC16 / plan-frontend-e2e E-A3 "+1" ↔ test-plan I54, test-plan-e2e E-A3 "2" → đề xuất giữ: test (2), sửa chữ AC16.
- spec AC02/CHAT-AC-49 "kèm gợi ý" ↔ plan D8 (`suggestAgents` Levenshtein) + dữ liệu AC → giữ: D8 (FR-91), sửa AC02 + thêm ca typo.
- spec Q11 "chỉ-đọc" ↔ spec R13/Q7 lần 2 "mọi thành viên nhắn được" → giữ: Q7 lần 2.
- plan-frontend D11/F5 "chờ duyệt, có thể cắt" ↔ spec Q9 "[x] tách X2b-2" → giữ: spec.
- spec R19 "người gọi không tính" ↔ plan D14 (biên tính) → giữ D14, ghi spec §10.

## Câu hỏi cho người dùng (chỉ những gì KHÔNG có mặc định an toàn)
(không) — Q1–Q15, U1, U3, U4, Q7/Q6 lần 2, Q9 đã chốt; #1–#15 đều có mặc định từ spec/BA/code.

## Checklist
| Mục | Kết quả | Bằng chứng (file:dòng / mã) |
|-----|---------|-----------------------------|
| A Phạm vi | Đạt | spec §1 bảng Làm A–G + "Không làm" (spec.md:20–33); mã tồn tại BA:254 (FR-101), :256 (FR-103), :258 (BR-21), :485/:488 (AC-H26/27), usecases:183–187 |
| B Hợp đồng | Thiếu (#4, #9) | spec §3; plan §2.1–2.3, §3 thứ tự kiểm + mã/HTTP; `CHAT_ROOM_AGENT_ERRORS`; sự kiện `ME_STREAM_RUN_EVENTS` payload; thiếu đường phát thật cho sự kiện run |
| C Dữ liệu | Đạt | plan §4.1 (cột, CHECK, FK, index, unique), §4.2 (RLS, 4 definer, GRANT), migration `0014`, `_journal` idx 14; tenant: FK `(room_id, tenant_id)`, policy X2a |
| D Nghiệp vụ | Thiếu (#3, #5) | spec §2 R01–R20 điều kiện cụ thể; edge: thu hồi (Q2/D15), rời/xoá (R17/Q8), đồng thời (plan §15 hàng hai người tag), 429; con số 20/50/≤50/5 s/`Retry-After: 5` |
| E UI | Thiếu (#5, #6) | plan-frontend §4 trạng thái, i18n §1–3 VI/EN, e2e §1 role/nhãn; artboard Main/DM/Mobile tồn tại |
| F Kiểm chứng | Thiếu (#2, #3) | test-plan §2–§3, §7 (106 test, đỏ đúng lý do 100/100); test-plan-e2e §2 (11 ca đỏ đúng lý do); Lệnh xong mốc không chạy được |
| G Phụ thuộc | Đạt | spec §7 (LLM mock, không Dify), test-plan §1 `ScriptRuntime`/`fake-cli`, test-plan-e2e §1 Runtime giả; env mới: không; thư viện mới: không (plan-frontend D12) |
| H2 Vai trò | Mâu thuẫn (#1) | spec §3–§5 đã điền nhưng còn marker (spec.md:60/75/87); chữ ký thuần plan §8; mỗi FR MUST có test (FR-101: I01–I84; FR-103: E-A1/A2, K-tests) |
| H Task | Thiếu (#2, #11) | tasks.md: mọi task có `Rủi ro` (B1/B3–B6/F2–F4/QC1/RV cao; B2/B7/F1/F6 thường — đúng định nghĩa WORKFLOW:21), cột `Đọc` đủ cho task BUILD, File + Lệnh xong + phụ thuộc |
| I Nhất quán | Mâu thuẫn (#7, #8, #10, #12) | mục "Mâu thuẫn giữa tài liệu" |
| J Độ chính xác | Thiếu (#4, #6, #13) | Symbol đã Grep tồn tại: `routeMessage`, `MentionService`, `createRunTx` (runs/create-run.ts:122), `SseWriter`, `CancelService`, `room_next_seq`, `room_fanout`, `activeMemberIds`, `advanceRead`, `HISTORY_CONTENT_MAX`, `flowHistory`, `startRunLoops`, `pickOrchestrator`, `directOnSnapshot`, `useOpenFlow`, `NewMessagesPill`, `SendErrorNotice`, `ColdResumeNote`, `CancelledNote`; không tồn tại: `UserStreamWriter`, `ownedConversation` |

Trần kích thước (`wc -c`, 1 KB = 1024 B): spec 23 975 ≤ 25 600 · plan 29 704 ≤ 30 720 · plan-frontend 23 425 ≤ 25 600 · test-plan 13 903 ≤ 30 720 — Đạt (plan sát trần, sửa #4/#9/#14/#15 thì dời sang `plan-questions.md` nếu vượt).

## Quét từ mơ hồ
~60 kết quả · gần hết là "…" trong chuỗi UI nguyên văn/ví dụ dữ liệu, "có thể thành Tranh chấp" (mô tả), "nếu cần" kèm tiêu chí (Composer > 200 dòng; review ≤ 2 vòng) — vô hại · ghi thành lỗ hổng: plan-frontend.md:20/§8/§9 F5 "có thể cắt… chờ duyệt" (#10), tasks.md cuối "chờ người dùng" (#10).

## Chưa kiểm
- Nội dung artboard `canvas-x2/*.dc.html` (chỉ kiểm tồn tại; plan-frontend đã ghi chỗ spec thắng canvas).
- `docs/CODEMAP.md`/README module — kiểm thẳng symbol trong code thay vì CODEMAP.
- Thân file test `tests/acceptance/X2b/**`, `e2e/chat/x2b-*` — chỉ đọc I27/I28 (`context.int.test.ts:136–152`).
