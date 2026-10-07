# Evidence test tay X1 — S1–S10 qua Chrome CDP (2026-10-07)

Chrome riêng (CDP :9333, profile tạm) + Playwright `connectOverCDP`, stack `combine:dev` + Runtime WSL `claude-sub,dify`. Kịch bản: `docs/guides/combine-test.md`.

**Tổng: 44 bước — PASS 38 · FAIL 3 · BLOCKED 3.** Dify thật: translate 1, chatbot 1, summary 1, reply 1, ask-image 0 (không tới Dify vì upload lỗi; không gọi lại). Không gọi console Dify, không sửa flow.

## Kết quả

| S | Bước | Kỳ vọng | KQ | Ghi chú | Ảnh |
|---|---|---|---|---|---|
| S1 | login-chat | lan/acme vào Chat, thấy composer | **PASS** |  | [S1-login-chat.png](S1-login-chat.png) |
| S1 | khoa-denied | khoa bị từ chối | **PASS** | thông báo:  | [S1-khoa-denied.png](S1-khoa-denied.png) |
| S1 | login-admin | platform/admin vào Admin, thấy Tổng quan | **PASS** |  | [S1-login-admin.png](S1-login-admin.png) |
| S1 | login-studio | platform_admin vào Studio | **PASS** | http://localhost:3200/studio/agents | [S1-login-studio.png](S1-login-studio.png) |
| S1 | studio-lan-denied | lan (member) vào Studio bị từ chối/không quyền | **PASS** | url=http://localhost:3200/studio/forbidden msg=✦ Agent Studio Bạn không có quyền vào Agent Studio Agent Studio chỉ dành cho quản trị nền tảng (platform_admin). Về Chat Đăng xuất | [S1-studio-lan-denied.png](S1-studio-lan-denied.png) |
| S2 | group-agent-tab | Group dify-demo, tab Agent: dify-chatbot đã cấp | **PASS** | Cấp Trợ lý cho Dify demo=false; Cấp Chatbot (Dify) cho Dify demo=true url=http://localhost:3000/groups/01a113a7-0aae-7000-98ae-2b29a830761c?tab=agents | [S2-group-agent-tab.png](S2-group-agent-tab.png) |
| S2 | effective-access-lan | Kiểm tra quyền lan: phần Agent có dify-chatbot qua group dify-demo | **PASS** | Agent Trợ lý assistant Qua group Beta testers Chatbot (Dify) dify-chatbot Qua group Dify demo | [S2-effective-access-lan.png](S2-effective-access-lan.png) |
| S3 | ask-orchestrator | Câu trả lời chảy dần qua Orchestrator, có nội dung | **FAIL** | trả lời không có '2': Chào bạn, 1+1 bằng mấy? \| Consultant \| ✓ 1 bước · 30,3s | [S3-answer.png](S3-answer.png) |
| S3 | cancel | Tin thứ hai bấm Dừng ⇒ dừng sinh, nút Gửi mở lại | **PASS** | sau huỷ: Hãy viết một bài luận 500 chữ về lịch sử Hà Nội. Consultant Đã dừng Chạy lại Copy phút này Trả lời tiếp | [S3-cancel.png](S3-cancel.png) |
| S3 | reload-history | Tải lại trang, lịch sử còn | **PASS** |  | [S3-reload-history.png](S3-reload-history.png) |
| S4 | slash-menu | Gõ / ⇒ menu Lệnh có translate/summary/reply/ask-image | **PASS** | /ask-image[question…] Hỏi về ảnh đính kèm qua Dify ; /reply[text…] Soạn trả lời email qua Dify ; /summary[text…] Tóm tắt email qua Dify ; /translate[lang][text…] Dịch văn bản qua Dify | [S4-slash-menu.png](S4-slash-menu.png) |
| S4 | not-found | /abcxyz ⇒ CMD_NOT_FOUND + gợi ý | **PASS** | Không có lệnh /abcxyz. | [S4-not-found.png](S4-not-found.png) |
| S4 | missing-arg | /translate en (thiếu text) gửi bằng nút Gửi ⇒ báo thiếu | **PASS** | Lệnh /translate thiếu: text. | [S4-missing-arg.png](S4-missing-arg.png) |
| S4 | double-slash | //abc gửi nguyên chữ /abc | **PASS** | đã gửi; log: /abc Consultant Đang phân tích yêu cầu… Copy phút này Trả lời tiếp | [S4-double-slash.png](S4-double-slash.png) |
| S4 | translate-real | /translate en Xin chào các bạn ⇒ Dify thật trả bản dịch | **PASS** | /translate en Xin chào các bạn Consultant Hello everyone ✓ 1 bước · 4,6s Copy phút này Trả lời tiếp | [S4-translate-real.png](S4-translate-real.png) |
| S4 | not-found-suggest | /tranlate (gõ sai gần đúng) ⇒ CMD_NOT_FOUND kèm gợi ý | **PASS** | Không có lệnh /tranlate. Ý bạn là: /translate | [S4-not-found-suggest.png](S4-not-found-suggest.png) |
| S5 | at-menu | Gõ @ ⇒ menu Agent có dify-chatbot | **PASS** | Trợ lý@assistant Trợ lý chung — trả lời câu hỏi, soạn thảo và tóm tắt văn bản theo yêu cầu. ; Chatbot (Dify)@dify-chatbot Trò chuyện với chatbot Dify thật (app agent dify-chatbot) cho bản demo X1. | [S5-at-menu.png](S5-at-menu.png) |
| S5 | agent-not-found | @khongco hi ⇒ AGENT_NOT_FOUND | **PASS** | Không tìm thấy agent @khongco. | [S5-agent-not-found.png](S5-agent-not-found.png) |
| S5 | double-at | @@abc gửi nguyên chữ @abc | **PASS** | @abc Consultant Đang phân tích yêu cầu… Copy phút này Trả lời tiếp | [S5-double-at.png](S5-double-at.png) |
| S5 | dify-chatbot-real | @dify-chatbot Giới thiệu ngắn về bạn ⇒ người trả lời là agent Chatbot (Dify), có nội dung | **PASS** | @dify-chatbot Giới thiệu ngắn về bạn Chatbot (Dify) Mình là trợ lý Trello cho board GameCenter. Mình hỗ trợ tra cứu, tóm tắt, di chuyển ticket, thêm comment, tạo mới/tinh chỉnh card và hướng dẫn quy trình luân chuyển việc trên board. Các thao tác đều | [S5-dify-chatbot-real.png](S5-dify-chatbot-real.png) |
| S6 | bad-type | Đính kèm .exe ⇒ báo lỗi loại tệp tiếng Việt, không có chip | **PASS** | exe Loại tệp không được hỗ trợ. | [S6-bad-type.png](S6-bad-type.png) |
| S6 | txt-chip | Đính kèm qa-note.txt ⇒ chip hiện tên file | **FAIL** | Chip hiện tên qa-note.txt nhưng kèm lỗi 'Không tải lên được. Thử lại.' — POST /attachments → 500 INTERNAL_ERROR | [S6-txt-chip.png](S6-txt-chip.png) |
| S6 | txt-send | Gửi câu hỏi kèm file ⇒ tin có file, được xử lý | **FAIL** | tin không có file; Tóm tắt file đính kèm trong 1 câu. Consultant ✓ 1 bước · 30,3s Hệ thống đang quá tải AI tạm hết lượt dùng. Hãy thử lại sau ít phút. Thử lại Báo admin ALL_PROVIDERS_EXHAUSTED · run 64c85c7a-5224-4eb8-a | [S6-txt-send.png](S6-txt-send.png) |
| S6 | ask-image-real | /ask-image Ảnh này có gì? + PNG ⇒ Dify thật trả lời theo ảnh | **BLOCKED** | Ảnh không upload được (500) ⇒ Hub chặn CMD_MISSING_ARG 'Lệnh /ask-image thiếu: image.' — KHÔNG gọi Dify | [S6-ask-image-real.png](S6-ask-image-real.png) |
| S10 | summary-real | /summary <email> ⇒ Dify thật trả nội dung | **PASS** |  Consultant 📌 TÓM TẮT EMAIL: Người gửi: Lan -> Người nhận: Minh Thời gian: Ngày hôm nay 📑 Nội Dung Chính Xác nhận đã nhận đơn hàng số 1234 gồm 50 thùng giấy A4. Hàng sẽ giao vào thứ Sáu tuần này tại kho Bình Dương. Yêu cầu xác nhận người nhận hàng và số điện thoại liên hệ. ⚡ Hành Động Cần Làm Anh  | [S10-summary-real.png](S10-summary-real.png) |
| S10 | reply-real | /reply <email> ⇒ Dify thật trả nội dung | **PASS** |  Consultant Chào chị Lan, Cảm ơn chị đã xác nhận đơn hàng số 1234. Tôi xin xác nhận người nhận hàng là anh Nguyễn Văn An, số điện thoại liên hệ là 0901234567. Nếu cần thêm thông tin gì, chị hãy cho tôi biết. Cảm ơn chị. Trân trọng, [Tên của bạn] ✓ 1 bước · 2,6s Copy phút này Trả lời tiếp | [S10-reply-real.png](S10-reply-real.png) |
| S8 | secret-create | Tạo secret QA_MOCK_KEY (giá trị mock ≥8 ký tự; không chụp form) | **PASS** | mk-ok (5 ký tự) bị chặn bởi luật 8–2048 ký tự ⇒ dùng khoá mock tương đương kịch bản ok |  |
| S8 | workflow-create | Tạo workflow qa-mock-send (base_url mock, secret QA_MOCK_KEY, bật Cần xác nhận) | **PASS** | url=http://localhost:3000/workflows/01a113da-ed64-7000-9d51-b325f9923d79 |  |
| S8 | workflow-list-badge | Danh sách Workflows: qa-mock-send có badge Hỏi xác nhận | **PASS** | QA mock send qa-mock-send workflow Chưa gắn Hỏi xác nhận Bật  | [S8-workflows-list.png](S8-workflows-list.png) |
| S8 | command-draft | Bản nháp /qa-send gắn qa-mock-send, tham số text (nuốt phần còn lại) | **PASS** |  |  |
| S8 | test-run-confirm | Chạy thử ⇒ hộp xác nhận (side_effect) ⇒ Vẫn chạy ⇒ có kết quả + thời gian | **PASS** | dialog: Workflow này có tác dụng phụ thật (gửi/ghi dữ liệu). Vẫn chạy thử? Huỷ Vẫn chạy \|\| kết quả: lưu. Không ghi gì vào cấu hình. Nội dung sau lệnh Đoạn bôi đen URL trang Chạy với tư cách user… Để trống = chạy với tư cách bạn. Chạy thử 10 ms · 20+0 token Kết quả Raw Các bước Xin chào, đây là mock. | [S8-test-run-result.png](S8-test-run-result.png) |
| S8 | command-save | Lưu /qa-send (feature mặc định Cơ bản) | **PASS** | url=http://localhost:3000/commands/01a113db-91df-7000-86d3-c79a63f35517 | [S8-command-saved.png](S8-command-saved.png) |
| S7 | direct-command | lan gõ /qa-send xin chào ⇒ chạy thẳng, không thẻ Đồng ý/Huỷ, ra kết quả mock | **PASS** | menu /qa: /qa-send<text…> QA: gửi lời chào thử (Dify mock) | [S7-direct-command.png](S7-direct-command.png) |
| S7 | studio-clone-qa-sender | Studio: nhân bản assistant → qa-sender, gắn workflow qa-mock-send, bật, lưu | **PASS** | url=http://localhost:3200/studio/agents/2111a4a7-3302-4004-878f-1b80c2a90c09  Chưa tenant nào dùng được agent này. Đã lưu agent · hub config v37 | [S7-studio-qa-sender-saved.png](S7-studio-qa-sender-saved.png) |
| S7 | admin-grant-qa-sender | Admin group dify-demo tab Agent: cấp qa-sender | **BLOCKED** | Group dify-demo tab Agent không liệt kê qa-sender (chưa entitlement tenant) ⇒ không test được thẻ Đồng ý/Huỷ | [S7-admin-grant-qa-sender.png](S7-admin-grant-qa-sender.png) |
| S7 | tenant-entitle-qa-sender | Admin tenant acme tab Agent: mở qa-sender cho tenant | **BLOCKED** | Admin › Tenant acme › tab Agent: 'Chưa khả dụng — Cấp agent cho tenant làm ở Agent Studio'; Studio nút 'Quản lý quyền agent' disabled 'Sắp có (H4b)' | [S7-tenant-entitle-qa-sender.png](S7-tenant-entitle-qa-sender.png) |
| S9 | admin-studio-link | Admin (platform_admin) thấy nút ⇄ Agent Studio, bấm mở Studio | **PASS** | nhãn="Agent Studio" cùng tab → http://localhost:3200/studio/agents (cần đăng nhập lại: false) | [S9-studio-agents.png](S9-studio-agents.png) |
| S9 | edit-desc | Sửa mô tả dify-chatbot thêm ' (QA)', lưu | **PASS** | Đã lưu agent · hub config v38 | [S9-studio-edit-desc.png](S9-studio-edit-desc.png) |
| S9 | studio-disable-qa-sender | Tắt agent qa-sender (dọn dữ liệu QA, không cấp được tenant) | **PASS** | aria-checked=false |  |
| S9 | chat-at-menu-updated | Chat tải lại, menu @ thấy mô tả mới có (QA) | **PASS** | Chatbot (Dify)@dify-chatbot Trò chuyện với chatbot Dify thật (app agent dify-chatbot) cho bản demo X1. (QA) | [S9-chat-at-menu-QA.png](S9-chat-at-menu-QA.png) |
| S9 | revert-desc | Hoàn tác mô tả dify-chatbot về như cũ | **PASS** |  | [S9-studio-reverted.png](S9-studio-reverted.png) |
| S-hoa | slash-menu-hoa | hoa (không thuộc dify-demo) gõ / ⇒ không có lệnh Dify | **PASS** | /qa-send<text…> QA: gửi lời chào thử (Dify mock) | [S-hoa-slash-menu.png](S-hoa-slash-menu.png) |
| S-hoa | at-menu-hoa | hoa gõ @ ⇒ không có dify-chatbot | **PASS** | (không có listbox) | [S-hoa-at-menu.png](S-hoa-at-menu.png) |
| Dọn | disable-qa-send | Tắt command /qa-send (QA) để không lộ cho mọi user core | **PASS** | aria-checked=false |  |

## Lỗi tìm thấy và chẩn đoán

1. **Chat qua Orchestrator luôn lỗi `ALL_PROVIDERS_EXHAUSTED` (~30 s)** — S3. Nguyên nhân (điều phối kiểm code): `combine:dev` chạy `hub:seed` với profile mặc định `fake-1`, không đặt `HUB_SEED_PROFILE=claude-sub-1` như runbook `hub-dev.md` ⇒ agent `assistant`/Orchestrator trỏ provider giả không có Runtime phục vụ. `@dify-chatbot` (provider `dify`) vẫn chạy. Lỗi cấu hình `combine:dev`, không phải code Hub.
2. **Đính kèm file 500 `INTERNAL_ERROR`** — S6 (chặn luôn `/ask-image`). Nghi `combine:dev` gọi `startHubDev` mà thư mục đính kèm (`HUB_ATTACH_DIR`) không được tạo/truyền như `hub:dev` (`hubApiEnv` cần `attachDir`). Cần đọc log Hub để xác nhận.
3. **`HUB_PUBLIC_INTERNAL_URL` truyền vào bị ghi đè** — `hubApiEnv` (dev.ts) luôn đặt theo topo hub-dev ⇒ với WSL NAT, MCP URL cho agent là `localhost` ⇒ đường agent gọi tool (S7 Đồng ý/Huỷ) sẽ không tới Hub. 
4. **Không cấp được agent mới cho tenant** — Admin › Tenant › tab Agent bảo làm ở Studio, Studio báo "Sắp có (H4b)" ⇒ agent `qa-sender` tạo ở Studio không đến được user ⇒ S7 phần agent gọi tool BLOCKED. Thiếu chức năng (H4b), không phải hồi quy.
5. **Guide sai: secret `mk-ok` bị Admin từ chối** (yêu cầu 8–2048 ký tự). Tester dùng khoá mock dài hơn.
6. Minor: tin bị từ chối (`/abcxyz`, `@khongco hi`…) vẫn tạo hội thoại rỗng ở sidebar.

## Dữ liệu QA còn lại
Secret `QA_MOCK_KEY`, workflow `qa-mock-send` (còn); command `/qa-send`, agent `qa-sender` (đã tắt). Mô tả `dify-chatbot` đã hoàn tác.

## Retest sau sửa combine:dev (2026-10-07)

Môi trường: stack `combine:dev` khởi động lại bởi điều phối (seed `claude-sub-1` cho `orchestrator`/`assistant` — đã kiểm DB `hub.agents.profile_id` → `claude-sub-1`; Hub có thư mục đính kèm; Runtime WSL `AGENT_RT_HUB_URL=http://172.26.0.1:4000`). Chrome CDP riêng :9333, playwright `connectOverCDP`, script `.data/cdp-test/r3.ts`, `r6.ts`, `r4.ts` (kết quả thô `.data/cdp-test/retest.json`).

| Bước | Kỳ vọng | KQ | Ghi chú | Ảnh |
|---|---|---|---|---|
| R-S3 | "Chào bạn, 1+1 bằng mấy?" chảy qua Orchestrator, không `ALL_PROVIDERS_EXHAUSTED` | **FAIL** | Vẫn `ALL_PROVIDERS_EXHAUSTED` (run `15398e98…`, hỏng sau ~80 ms ⇒ không có stream, không chụp được ảnh "đang chảy"). Nguyên nhân mới: `hub.provider_state` `claude-sub` = `logged_out`, `last_error = probe timed out` (16+ lỗi liên tiếp). Runtime WSL đang chạy probe (`agent_runtime.runtimes.cli.probe.child --provider=claude-sub` → `claude_agent_sdk/_bundled/claude`) nhưng hết thời gian chờ; `~/.claude/.credentials.json` của user `worker` có tồn tại | [R-S3-answer.png](R-S3-answer.png) |
| R-S6 txt-chip | Đính kèm qa-note.txt ⇒ chip, không lỗi tải lên | **PASS** | `qa-note.txt 80 B`, POST /attachments 201 (lỗi 500 lượt trước đã hết) | [R-S6-txt-chip.png](R-S6-txt-chip.png) |
| R-S6 txt-send | "Tóm tắt file này" kèm file ⇒ tin có chip, có trả lời | **FAIL** | Gửi được, tin người dùng có chip `qa-note.txt 80 B`; trả lời lỗi `ALL_PROVIDERS_EXHAUSTED` (cùng nguyên nhân R-S3) | [R-S6-txt-send.png](R-S6-txt-send.png) |
| R-S6 txt-reopen | Mở lại hội thoại ⇒ chip file còn trong tin | **PASS** | `/c/515afa24-…` chip `qa-note.txt 80 B` | [R-S6-txt-reopen.png](R-S6-txt-reopen.png) |
| R-S6 ask-image | `/ask-image Ảnh này có gì?` + PNG ⇒ Dify thật trả lời theo ảnh | **PASS** | Gọi Dify THẬT 1 lần: "Ảnh này hiển thị một màn hình đăng nhập với thông báo 'Tài khoản đang bị khóa. Liên hệ quản trị viên công ty.' … trường 'Mật khẩu' và nút 'Đăng nhập'" ✓ 1 bước · 4,4s | [R-S6-ask-image-pending.png](R-S6-ask-image-pending.png), [R-S6-ask-image-real.png](R-S6-ask-image-real.png) |
| R-TAG a | `@assistant Bạn là ai? Trả lời 1 câu.` ⇒ người trả lời là agent `assistant` (không phải Consultant), run direct | **PASS (định tuyến)** / trả lời lỗi | Nhãn người trả lời "Trợ lý"; DB run `kind=direct`, `responder_key=assistant`, `agent=assistant`. Nội dung trả lời lỗi `ALL_PROVIDERS_EXHAUSTED` (claude-sub logged_out) | [R-TAG-a-direct-assistant.png](R-TAG-a-direct-assistant.png) |
| R-TAG b | Gõ `@ass` → bàn phím chọn → thêm nội dung ⇒ đúng agent | **PASS (định tuyến)** / trả lời lỗi | Menu lọc còn `Trợ lý @assistant`; Enter chèn `@assistant ` vào composer; gửi "Bạn tên gì?" ⇒ run `direct`, responder `assistant`; trả lời lỗi như trên | [R-TAG-b-menu.png](R-TAG-b-menu.png), [R-TAG-b-keyboard-pick.png](R-TAG-b-keyboard-pick.png) |
| R-TAG c | `@assistant @dify-chatbot Xin chào` ⇒ Orchestrator chỉ chọn trong nhóm tag | **BLOCKED** | Run `kind=orchestrated` (đúng: nhiều tag ⇒ qua Orchestrator), nhưng Orchestrator (claude-sub) hỏng ngay `ALL_PROVIDERS_EXHAUSTED`, `responder_key` rỗng, nhãn "Consultant" ⇒ chưa kiểm được việc chọn trong nhóm. Dify chatbot KHÔNG được gọi (0 lần) | [R-TAG-c-multi-tag.png](R-TAG-c-multi-tag.png) |
| R-TAG d1 | `@qa-sender hi` (agent đã tắt) ⇒ AGENT_NOT_FOUND, không tạo run | **PASS** | "Không tìm thấy agent @qa-sender."; `hub.runs` +0. Không có dòng gợi ý (không agent nào gần tên) | [R-TAG-d-disabled-qa-sender.png](R-TAG-d-disabled-qa-sender.png) |
| R-TAG d2 | `@khongco hi` ⇒ AGENT_NOT_FOUND, không tạo run | **PASS** | "Không tìm thấy agent @khongco."; runs +0; không gợi ý | [R-TAG-d-unknown-khongco.png](R-TAG-d-unknown-khongco.png) |
| R-TAG e | `@assistant` + Enter ⇒ báo cần nhập nội dung | **PASS** | "Hãy nhập nội dung sau @assistant."; composer giữ nguyên; runs +0 | [R-TAG-e-tag-no-content.png](R-TAG-e-tag-no-content.png) |
| R-TAG f1 | hoa gõ `@` ⇒ menu không có `dify-chatbot` | **PASS** | Không hiện listbox Agent nào (hoa không có agent gắn tag được) | [R-TAG-f-hoa-at-menu.png](R-TAG-f-hoa-at-menu.png) |
| R-TAG f2 | hoa `@dify-chatbot hi` ⇒ AGENT_NOT_FOUND | **PASS** | "Không tìm thấy agent @dify-chatbot."; runs +0 | [R-TAG-f-hoa-dify-chatbot.png](R-TAG-f-hoa-dify-chatbot.png) |

**Số lần gọi Dify thật thêm trong retest: 1** (`/ask-image` ×1). Dify chatbot: 0 (bước c hỏng ở Orchestrator trước khi định tuyến). Không mở console Dify, không sửa flow.

### Lỗi còn lại / mới
1. **Provider `claude-sub` `logged_out` — "probe timed out"** (chặn R-S3, R-S6 txt-send, trả lời ở R-TAG a/b, R-TAG c). Sửa seed profile đã đúng; nay Runtime WSL không probe được Claude subscription (probe child chạy CLI bundled của `claude_agent_sdk` và quá thời gian). Cần kiểm: `claude -p hi` dưới user `worker` trong WSL (token hết hạn / cần đăng nhập lại / mạng), hoặc timeout probe quá ngắn khi khởi động lạnh.
2. UX: khi provider `logged_out`, Chat vẫn hiện "Hệ thống đang quá tải — AI tạm hết lượt dùng" ⇒ thông báo gây hiểu nhầm (nguyên nhân thật là chưa đăng nhập/probe lỗi).
3. Đã hết: lỗi 500 đính kèm (R-S6 txt-chip/reopen PASS, `/ask-image` chạy thật).
