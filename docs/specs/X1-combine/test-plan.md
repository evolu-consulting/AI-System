# Test plan · X1-combine

qc · 2026-10-07 · nguồn: spec §2, §5, §8; `plan.md` §0 K1–K11, §2, §5, §7; `plan-frontend.md` §1–§3. Không chép BA/contract — trỏ mục. Trạng thái: **WRITE (chỉ plan)**, chưa viết test, chưa chạy "đỏ đúng lý do".

## 0. Nguyên tắc
| # | Luật test |
|---|---|
| P1 | Test tự động **chỉ** Dify mock (`tools/mocks/src/dify.ts` / `startDify()`); không đọc `.env` auto-pilot, không đặt `DIFY_SEED_ENV_FILE` tới file thật (X1-R03). Key giả sinh **lúc chạy** vào thư mục tạm (`"app-" + "QCFAKE".repeat(4)`), không commit chuỗi giống key (AC18 tự bắt) |
| P2 | Smoke Dify thật = **kiểm tay** (§6), cờ `DIFY_LIVE=1`, ≤ 1 lời gọi/app, tuần tự, không retry; không bao giờ gọi `/console/api`, không sửa/publish flow (X1-R01, R02) |
| P3 | DB: qc dùng `bun run db:test:create qc`; e2e dùng DB test (`*_test`), không DB dev |
| P4 | Tên test bắt đầu bằng mã (`X1-AC11 · …`, `ADM-FR-23 · …`); dữ liệu cố định; chờ theo điều kiện, không `sleep`; không `skip`/`only` |
| P5 | Ba bộ e2e mới tách đuôi để không lẫn với config gốc (`testDir ./e2e` bắt `*.spec.ts`): `*.chat.ts` (config chat), `*.x1.ts` (`e2e/x1/playwright.config.ts`), `*.combine.ts` (`e2e/combine/playwright.config.ts`). Cổng riêng: x1 = admin-api 3011, admin-web 3010, Hub stub 4030; combine = admin-api 3021, hub-api 4040, Dify mock 4048, chat-web 3120, admin-web 3020 |
| P6 | Build admin-web phụ thuộc env build-time (`PUBLIC_*`) và dùng chung `dist` ⇒ các bộ e2e admin chạy **tuần tự**, mỗi config tự build; `reuseExistingServer:false` cho preview của x1/combine |
| P7 | Hàm chưa có (rules, `missingAdminColumns`, seed) nạp bằng `await import()` trong test (mẫu `_modules.ts` M4) ⇒ đỏ ở `expect`/import từng ca, không làm đổ cả file |

## 1. QC1a — sửa test ĐÃ KHOÁ (xong **trước B1**, plan §7 QA–QC, rủi ro R1)
Grep đã chạy: `workflow_flags`, `side_effect`, `main: 9`, `__drizzle_migrations`, `Chưa khả dụng`, `Chạy thử`, `Consultant`, `WorkflowSchema`, `AUDIT_FIELDS`, `workflowEl` trên `tests/` + `e2e/`.

| # | File:dòng | Hiện tại | Sửa thành | Đỏ/xanh trước B1 |
|---|---|---|---|---|
| L01 | `tests/acceptance/H2a/_h2a.ts:414` (dùng chung H2a int, H2a/H2b stack qua `_stack.ts`: S01 `confirm.stack`, S05 `confirm-tag.stack`; H2b `confirm-tag.int` A90–A92) | `insert into hub.workflow_flags (trello)` | helper mới `markSideEffect(sql, workflowId)` (export ở `_h2a.ts`): cột `admin.workflows.side_effect` có ⇒ `update admin.workflows set side_effect = true where id = …`; chưa có ⇒ insert `workflow_flags` như cũ. Gọi cho `WF.trello` | xanh cả trước/sau B1 và sau B3 (không đổ `beforeAll` khi chưa có cột) |
| L02 | `tests/acceptance/H2a/confirm.int.test.ts:63` | insert flags `WF.checkInvoice` | `markSideEffect(sql, WF.checkInvoice)` | xanh |
| L03 | `tests/acceptance/H2c/mcp-file.int.test.ts:37` | insert flags `WF3.anhTuyChon` | `markSideEffect(sql, WF3.anhTuyChon)` (import từ `../H2a/_h2a`) | xanh |
| L04 | `H2a/confirm.int.test.ts:260-300` (A67) | `expect(col.n).toBe(0)`; `add column`/`drop column` | viết lại: "HUB-FR-95 · A67 · cột `admin.workflows.side_effect` quyết: trello `true` ⇒ confirm; `update … false` (owner) + `catalogChange` ⇒ gọi thẳng Dify mock; khôi phục `true` trong `finally`". Kiểm `col.n = 1`, không `alter table` | đỏ đúng lý do tới B1 (`col.n` 0 ≠ 1) |
| L05 | `tests/acceptance/ADM-NFR-06/migrate.int.test.ts:53,152,170` (+ chú thích dòng 17 thêm `0009_x1_workflow_side_effect`) | `{main: 9, …}` | `{main: 10, …}` | đỏ tới B1 |
| L06 | `tests/acceptance/H1/db.int.test.ts:123,128` | `{main: 9, dev: 3}` (tên + expect) | `{main: 10, dev: 3}` | đỏ tới B1 |
| L07 | `tests/acceptance/M1/db-schema.int.test.ts:69,70,284,287` | `main:9` | `main:10` | đỏ tới B1 |
| L08 | `tests/acceptance/M2/db-schema.int.test.ts:143,144,462,465` | `main:9` | `main:10` | đỏ tới B1 |
| L09 | `tests/acceptance/M3/db-schema.int.test.ts:100,101,104,439,441` | `main:9`; "9 hàng `__drizzle_migrations`" `n=9` | `10`; `n=10` | đỏ tới B1 |

Test khoá phải sửa **trước F4/F5** (không có trong plan §7 — phát hiện bằng grep; root e2e build admin-web **không** có `PUBLIC_HUB_URL`/`PUBLIC_STUDIO_URL`):
| # | File:dòng | Hiện tại | Sửa thành |
|---|---|---|---|
| L10 | `e2e/groups-editor.spec.ts:104-115` (ADM-FR-62) | tab Agent "Chưa khả dụng", không gọi API agent | tab Agent: "Chưa cấu hình địa chỉ Hub (PUBLIC_HUB_URL)." và không request nào tới `/agent-grants`; `?tab=` vẫn ghi URL |
| L11 | `e2e/access-check.spec.ts:34-48` (ADM-FR-36) | Agent "Chưa khả dụng" | phần Agent hiện trạng thái "Hub chưa cấu hình" (§2.3 plan-frontend), không gọi Hub; phần feature/command giữ nguyên |
| L12 | `e2e/access-user-tab.spec.ts:20-28` | idem drawer user | idem |
| L13 | `e2e/commands.spec.ts:102-107` | "M2 không làm FR-23: không có nút Chạy thử/Test" | đổi thành ADM-FR-23: editor command **có** `button "Chạy thử"`; menu ⋯ vẫn không có "Lịch sử" |

Phải **giữ xanh, không sửa** (đã soát, plan khẳng định tương thích): `H2a/seed.int.test.ts` A94/A95 (seed vẫn ghi `workflow_flags`, X1-R09) · `M4/rules/audit-snapshot.rules.test.ts` (chỉ so khoá trong input) · `M4/rules/transfer.test.ts`, `M4/import-*.int` (import file thiếu `side_effect` ⇒ không diff, plan §2.1) · `M3/groups.int.test.ts:71-131` `agent_count` 0 (B4, không có grant) · `M2/*` parse `WorkflowSchema` từ server · `M4/rules/contracts-cd.test.ts:137` `API_ERRORS` = 48 (K4) · `C1/no-hub-url`, `C1/i18n-chat` (vi = en khoá) · e2e chat "Consultant" khi không có `responder` (`send.chat.ts:45`, `flow.chat.ts:24`, `states.chat.ts:121`) · `e2e/studio/agents.studio.ts:145` (nút "Chạy thử" Studio vẫn disabled).

Lệnh xong QC1a: `bun --env-file=.env.local --config=bunfig.int.toml test --timeout 30000 ./tests/acceptance/H2a ./tests/acceptance/H2b ./tests/acceptance/H2c 2>&1 | tail -40` (xanh trừ A67) + ADM-NFR-06/H1/M1–M3 db đỏ **chỉ** ở `{main:10}` + `bun run test:lock:write && bun run test:lock:verify`.

## 2. Ma trận X1-AC (QC1b)
Loại: U = unit/rules (`bun test`), I = int (`test:int`, DB qc), C = contract chat, E = e2e, S = stack/script, T = tay.

| AC | Loại | File dự kiến | Dữ liệu | Kỳ vọng |
|---|---|---|---|---|
| AC01 | E | `e2e/chat/x1-commands.chat.ts` | mock Hub chat (`tools/mocks`) + `page.route("**/commands")` trả `CommandMenuResponseSchema.parse` của 3 lệnh `translate` (alias `dich`, args `lang`, `text` rest), `summary`, `reply`; ca rỗng `{items:[]}`; ca 500 | gõ `/` ⇒ `listbox "Lệnh"` 3 `option`; `/tr` lọc 1; `/dich` hiện "(alias /translate)"; ↓↑ vòng; Enter ⇒ ô = `/translate ` (không gửi request messages); Esc đóng; rỗng "Bạn chưa được cấp lệnh nào"; lỗi "Không tải được danh sách lệnh" + "Thử lại" gọi lại 1 lần; 403 = rỗng |
| AC02 | E | idem | `page.route` POST `**/conversations/*/messages` ⇒ 404 `CMD_NOT_FOUND` `{name:"tranlate",suggestions:["translate","trello"]}`; 422 `CMD_MISSING_ARG` `{name:"translate",missing:["text"],invalid:[]}` | `alert` "Không có lệnh /tranlate." + "Ý bạn là:" + `button "/translate"` (bấm ⇒ ô đổi tên lệnh, focus); `alert` "Lệnh /translate thiếu: text."; gõ `//x` ⇒ menu không mở, body gửi `content:"//x"` nguyên văn (D3) |
| AC03 | U + C | `tests/acceptance/X1/rules/send-request.test.ts` (`buildSendRequest` export từ `apps/chat-web/src/features/run/lib/send-request.rules.ts`, plan-frontend §1.1b); `tests/contract/chat/x1-context.contract.test.ts` | `{content:"x", context:{selection:"a",page_url:"https://a.test/p",page_text:"t"}}`; trường rỗng | U: bỏ trường rỗng, giữ thứ tự `attachment_ids`; C: POST messages có `context` hợp lệ ⇒ **200 `text/event-stream`** như C1 (E12 trả SSE, không phải 202), stream tới sự kiện cuối; `page_url` không http(s), trường rỗng, quá giới hạn, khoá lạ ⇒ 400 `VALIDATION_ERROR` JSON |
| AC04 | E | `e2e/chat/x1-agents.chat.ts` | `page.route("**/agents")` 2 agent `dify-chatbot` ("Chatbot (Dify)"), `trello`; POST messages 404 `AGENT_NOT_FOUND` `{tag:"dify-chatbot2",suggestions:["dify-chatbot"]}`; SSE (`page.route` `**/runs/*/events`) `run.started` có `responder:{key:"dify-chatbot",name:"Chatbot (Dify)"}` … `run.finished` | `@` ⇒ `listbox "Agent"`; `@@x` không mở menu, gửi nguyên văn; `alert` "Không tìm thấy agent @dify-chatbot2." + `button "@dify-chatbot"`; tin `@dify-chatbot` chỉ tag ⇒ "Hãy nhập nội dung sau @dify-chatbot."; nhãn trả lời = "Chatbot (Dify)" thay "Consultant" |
| AC05 | E | idem | POST messages 429 `TOO_MANY_RUNS`, header `Retry-After: 3`; ca header sai `abc` | `alert` "… Thử lại sau 3 giây."; `button "Gửi"` disabled, đếm 3→0 rồi enabled + alert ẩn; không tự gửi lại (đếm request = 1); header sai ⇒ 5 giây (`TOO_MANY_RUNS_RETRY_AFTER_S`) |
| AC06 | U | `tests/acceptance/X1/rules/delta.test.ts` (`applyDelta(state: RunState, delta)` export từ `features/run/lib/delta.rules.ts`, plan-frontend §1.1b) | 500 `step.delta` ≤ 40 ký tự, step mở, không `step.finished` | nội dung = nối đủ 500 phần, đúng thứ tự; hiển thị trước `step.finished` |
| AC07 | E + U | `e2e/chat/x1-attachments.chat.ts`; `tests/acceptance/X1/rules/attach-validate.test.ts` | tệp tạo lúc chạy: `a.txt` 1 KB, `b.pdf` 1 KB, `x.exe`, rỗng 0 B, tên 201 ký tự, 11 tệp, (U) cỡ 20 MiB + 1; `page.route` POST `**/attachments` ⇒ 201 `AttachmentSchema`, ca 413 `ATTACHMENT_TOO_LARGE`, 507/409 `ATTACHMENT_QUOTA_EXCEEDED`; lịch sử có `Message.attachments` 1 `available:false` | request upload: thân thô (không JSON), `X-Filename` = `encodeURIComponent(tên)`, `Content-Type` theo đuôi; `list "Tệp đính kèm"` > `listitem`; `button "Xoá a.txt"`; `x.exe` chip lỗi "Loại tệp không được hỗ trợ." không gọi upload; 11 tệp ⇒ toast "Tối đa 10 tệp mỗi tin."; Gửi disabled khi đang tải; body gửi `attachment_ids` đúng thứ tự; `list "Tệp trong tin"` có `button "Tải a.txt"` tải bằng fetch có `Authorization` (bắt request), mục xám `aria-disabled="true"`; câu EN đủ (đổi locale) |
| AC08 | E (×2) | `e2e/chat/x1-confirm.chat.ts` (mock); `e2e/combine/x1-side-effect.combine.ts` (Hub thật + Dify mock) | mock: SSE `ask` `choices:["Đồng ý","Huỷ"]`; combine: workflow `mock-send` (§4) | mock: `region "Consultant cần thêm thông tin"` > 2 nút; bấm "Đồng ý" gửi đúng `"Đồng ý"`. combine: admin bật `switch "Cần xác nhận trước khi chạy"` cho `mock-send` ⇒ trong ≤ 10 s chat `/mock-send xin chào` ⇒ AskCard; "Huỷ" ⇒ Dify mock 0 lời gọi; lần 2 "Đồng ý" ⇒ đúng 1 lời gọi, kết quả `MOCK_TEXT` |
| AC09 | E | `e2e/chat/x1-proxy.chat.ts` | `request` Playwright (không qua `page.route`) tới chat-web preview | `GET /commands`, `/agents`, `/attachments/x/content` trả từ mock Hub (JSON/`content-type` không phải `text/html` của SPA fallback; 401 khi thiếu Bearer) |
| AC10 | I + U | `tests/acceptance/X1/workflow-side-effect.int.test.ts`; `tests/acceptance/X1/rules/transfer-side-effect.test.ts` | fixture M2 (`translate`, `report-tax`); file export v1 không có trường | POST không gửi ⇒ `side_effect:false`; POST `true` ⇒ GET `true`; PATCH (API M2 dùng PATCH, plan ghi PUT) đổi ⇒ `version+1`, `config_version+1`; PATCH vắng trường ⇒ giữ; audit `after.side_effect`; restore snapshot cũ thiếu trường ⇒ giữ giá trị hiện tại; export luôn có `side_effect`; import tạo mới vắng ⇒ false; import cập nhật vắng ⇒ không diff; có + khác ⇒ diff field `side_effect`; `has_column_privilege('hub_ro', …, 'SELECT')` = true; migration `0009_x1_workflow_side_effect.sql` đúng 1 câu `ADD COLUMN … DEFAULT false NOT NULL` |
| AC10 | E | `e2e/x1/workflows-side-effect.x1.ts` | `translate` | `switch "Cần xác nhận trước khi chạy"` lưu được, tải lại vẫn bật; `columnheader "Xác nhận"`, ô "Hỏi xác nhận" |
| AC11 | U | `tests/acceptance/X1/rules/command-test.rules.test.ts` | bảng `testRunPrecheck`, `mapHubTestRun` (plan §2.2) | bước 3–6 theo thứ tự trượt đầu tiên; 8a–8f: 200 nguyên văn · 200 sai schema ⇒ 502 · 400 chuyển `details` đổi path `actor_user_id`→`run_as_user_id` · 422/409 giữ mã · 401/503 ⇒ 503 `HUB_NOT_CONFIGURED` · `network`/`timeout`/500 ⇒ 502 `HUB_UNAVAILABLE`; output không chứa header/token |
| AC11 | I | `tests/acceptance/X1/command-test.int.test.ts` | admin-api thật (`createApp` + DB qc) + Hub stub `Bun.serve` ghi request; `HUB_INTERNAL_TOKEN` = 48 ký tự sinh lúc chạy; workflow `translate` (false), `report-tax` đặt `side_effect=true` | binh (tenant_admin) ⇒ 403 trước parse; body sai ⇒ 400 không echo `text`; vắng `ADMIN_HUB_URL` ⇒ 503; workflow lạ ⇒ 400 `INVALID_REFERENCE{field:"workflow_id"}`; `report-tax` không cờ ⇒ 409 `SIDE_EFFECT_CONFIRM_REQUIRED{workflow_id}`, có cờ ⇒ gọi Hub; `run_as_user_id` lạ ⇒ 400; stub nhận `Authorization: Bearer <token>`, body `actor_user_id` = jwt.sub / run_as; 8a–8f qua stub (stub đổi chế độ); Hub chết (cổng đóng) ⇒ 502; client abort ⇒ stub thấy huỷ; **quét** mọi response + log admin-api (bắt stdout) không chứa token (thô/base64/hex, `leakForms`); `API_ERRORS` vẫn 48 |
| AC11 | S | `tests/acceptance/X1/bundle-secret.test.ts` | `apps/admin-web/dist` sau build với `HUB_INTERNAL_TOKEN` đặt trong env | dist không chứa giá trị token, không chứa chuỗi `HUB_INTERNAL_TOKEN` |
| AC11 | E | `e2e/x1/command-test.x1.ts` | Hub stub 4030 (`e2e/x1/_hub-stub.ts`: `/internal/test-run` theo chế độ, `/agent-grants*`, `/health`, `/__stub/mode`); lệnh `dich` (M2); lệnh **chưa lưu** (form mới) | `button "Chạy thử"` với lệnh chưa lưu **chạy được** (BL1); `textbox "Nội dung sau lệnh"`; kết quả "{ms} ms · …", `tab "Kết quả"/"Raw"/"Các bước"`; `ok:false` ⇒ `alert` + "Chi tiết từ Dify"; stub chậm ⇒ `button "Dừng"` huỷ; stub 502 ⇒ "Hub không phản hồi…"; workflow `side_effect` ⇒ hộp "Workflow này có tác dụng phụ thật…" ⇒ Đồng ý gửi lại `confirm_side_effect:true`; `combobox "Chạy với tư cách user…"` chọn `lan` ⇒ body `run_as_user_id` = id lan; không request nào của trình duyệt chứa token |
| AC12 | E | `e2e/x1/groups-agent.x1.ts` | stub: `GET /agent-grants?subject_type=group&subject_id=<ke-toan>` 2 agent (`dify-chatbot` có grant, `trello` không, `runnable:false`); POST/DELETE ghi nhận; chế độ lỗi `NOT_ENTITLED`, `AGENT_NOT_GRANTABLE`, 500; effective `lan` | `tab "Agent"` bảng; `switch "Cấp Trello cho Kế toán"` bật ⇒ POST 1 lần + toast "Đã cấp …"; tắt ⇒ DELETE (204) + toast "Đã thu hồi …"; lỗi ⇒ hoàn trạng thái + câu §2.3; badge "Chưa chạy được"; Kiểm tra quyền + drawer user: `heading "Agent"` có "Qua group Kế toán", "Chưa được cấp"; platform_admin truyền `tenant_id`, binh không |
| AC12 | I | `tests/acceptance/X1/group-agent-count.int.test.ts` | DB qc có `hub.agent_grants`: group `ke-toan` 2 grant (2 agent khác nhau) | list + detail `agent_count` = 2; group khác 0; role không có quyền `hub.agent_grants` ⇒ 0 (ADM-FR-37) |
| AC13 | E | `e2e/x1/studio-link.x1.ts` (`PUBLIC_STUDIO_URL=http://localhost:3200/studio/`); `e2e/x1-studio-link.spec.ts` (root, vắng env) | platform_admin (`SEED_ADMIN_USERNAME`), binh | x1: platform thấy `link "Agent Studio"` href đúng; binh không thấy; màn 600px chỉ icon, vẫn tên "Agent Studio". root: platform **không** thấy (vắng env). member không vào được admin-web (M1, đã có) |
| AC14 | I | `tests/acceptance/X1/cors.int.test.ts` | admin-api `createApp` với `CORS_ORIGINS` 3 origin; hub-api app với `HUB_CORS_ORIGINS` 3 origin; mặc định env Hub | `OPTIONS` từ 3000/3100/3200 ⇒ `access-control-allow-origin` = origin, `allow-credentials: true` (admin); `http://evil.test` ⇒ không có header; Hub mặc định (không env) chỉ 3100 (X1-R12) |
| AC15 | I | `tests/acceptance/X1/schema-check.int.test.ts` | DB qc; owner `alter table admin.workflows drop column side_effect` trong ca, `finally` add lại `default false` + đặt lại cờ fixture | `missingAdminColumns(db)` có cột ⇒ `[]`; thiếu ⇒ `["admin.workflows.side_effect"]`; spawn `bun apps/hub-api/src/server.ts` (env test) khi thiếu cột ⇒ exit 1 ≤ 20 s, stderr/stdout có `admin-schema-missing` + tên cột; có cột ⇒ hub-api lên `/health` 200. (`GET /commands` strict không có `side_effect` ⇒ "cờ theo cột" phía Hub do A67 `H2a/confirm.int` phủ, L04) |
| AC16 | I | `tests/acceptance/X1/seed-dify.int.test.ts` | thư mục tạm: `.env` giả (`DIFY_API_URL=http://127.0.0.1:<dify mock>/v1`, 5 secret `DIFY_KEY_*` giả, thêm `DIFY_CONSOLE_PASSWORD`, `DIFY_AGENT_API_KEY` giả); admin-api thật (DB qc) hoặc stub ghi request; Hub stub `/agent-grants` | `--dry-run` (mặc định): 0 request ghi (POST/PUT/DELETE), in tạo/cập nhật/giữ nguyên + tên app/loại/input map; `--apply` lần 1 tạo secret `DIFY_KEY_*` (tên đúng K6), 5 workflow `dify-*` (gồm `dify-chatbot` `app_type=agent`) `side_effect=false`, 4 command, feature/group `dify-demo` (lan), grant; lần 2 = 0 POST/PUT (idempotent); `--rotate-secrets` ⇒ PUT secret; không DELETE nào; Dify mock **0** lời gọi; quét stdout/stderr/log/dump DB (trừ ciphertext) không chứa key thô/base64/base64url/hex, không in độ dài/tiền tố; biến console không bao giờ được đọc (đặt giá trị bẫy, quét không thấy). bước 8 (Hub seed CLI) trỏ DB qc qua `DATABASE_URL` truyền cho script (§8 mục 5) |
| AC16 | U | `tests/acceptance/X1/rules/seed-dify.rules.test.ts` | chuỗi env giả | `parseSeedEnv` chỉ lấy `DIFY_API_URL` + `ENV_KEY[app]`; `buildSeedPlan`/`formatPlan` không chứa key; `workflowPatch`/`commandPatch` = null khi giống, chỉ trường khác; `SEED_APPS` đúng 5; `ENV_KEY` đúng map plan §5.2; input map đúng §5.3 (`translate`: args `[lang default "vi", text rest fallback selection]`) |
| AC17 | U | idem | thiếu `DIFY_SEED_ENV_FILE`; thiếu `DIFY_KEY_TRANSLATE`; `--apps foo` | `parseSeedEnv` ⇒ `{ok:false, missing:["DIFY_KEY_TRANSLATE"]}`; `parseSeedArgs` ⇒ `error` nêu "foo"; CLI exit 1 **trước** đăng nhập (stub admin 0 request), stderr chỉ tên biến |
| AC18 | S | `tests/acceptance/X1/static-scan.test.ts` | `git ls-files` toàn repo | không chuỗi khớp `app-[A-Za-z0-9]{20,}` (trừ allowlist rỗng); `apps/**`, `packages/**`, `tools/**`, `tests/**`, `e2e/**` không chứa `/console/api` (regex ghép chuỗi trong test, tránh tự khớp; `docs/**` được nhắc luật); `tools/scripts/src/seed-dify-live*.ts` không chứa `auto-pilot`/`evoluconsulting` (không mặc định đường dẫn), không `process.env[...] =`, không `dotenv` |
| AC19 | S + T | backend: `tools/scripts/src/combine.test.ts`; qc: kiểm tay I2 | — | (backend) env dựng đúng §3, token sinh 48 ký tự cho cả 2 tiến trình, thứ tự dừng ngược; (tay) 5 tiến trình `/health`/`GET /` 200 + `dify-mock` `GET :5001` có phản hồi (không đòi 200), Ctrl+C dừng sạch. Hàm thuần khoá: `tools/scripts/src/combine.rules.ts` `buildCombineEnv(base, opts)`, `stopOrder(started)` (plan-stack.md, kiểu `ProcName`); `combine.test.ts` import từ đó |
| AC20 | S + T | `tests/acceptance/X1/smoke-skip.test.ts`; script tay `tests/smoke/X1/dify-live.ts` | không `DIFY_LIVE` | spawn script ⇒ exit 0, in "bỏ qua (vắng DIFY_LIVE=1)", 0 kết nối mạng (HUB url trỏ cổng đóng, không lỗi); kiểm tĩnh script: không vòng retry, `--apps` tuần tự, 1 lần/app (§6) |

## 3. FR → test
| FR | Test (mục 2) |
|---|---|
| ADM-FR-10 / HUB-FR-95 (cột `side_effect`) | AC10, AC15, AC08, L01–L04 |
| ADM-FR-21 (input map) | AC16 rules (map §5.3 theo `InputMapEntrySchema`, K5); AC08 combine `/mock-send` (arg rest) |
| ADM-FR-23 (Test command) | AC11 (U, I, S, E); L13 |
| ADM-FR-37 (group ↔ agent) | AC12 (E, I `agent_count`); L10 |
| ADM-FR-36 (quyền hiệu lực agent) | AC12 E; L11, L12 |
| HUB-FR-10 `GET /commands` | AC01, AC09, AC15 |
| HUB-FR-11 / 12 (parse, thiếu arg) | AC02, AC08 combine |
| HUB-FR-44 (upload) | AC07, AC09 |
| HUB-FR-51 (`/internal/test-run`) | AC11 I + combine `x1-test-run.combine.ts` (§4) |
| HUB-FR-72 (Studio chỉ platform) | AC13 |
| HUB-FR-78 / 79 (grant, kiểm tra quyền) | AC12 |
| HUB-FR-91 / 92 (`@agent`, `GET /agents`) | AC04 |
| HUB-FR-94 (429) | AC05 |
| CHAT-AC-01…36 | giữ: `bun run e2e:chat` bộ C1 + `test:contract:chat` 41 ca (X1-R06) |
| X1-R01..R05, R14 | AC16–AC18, AC20, §6 |
| X1-R09 | L01–L04, AC15 |
| X1-R11, R12 | AC13, AC14 |

## 4. e2e combine (Hub thật + Dify mock, không Runtime)
Config `e2e/combine/playwright.config.ts`, webServer: `bun e2e/combine/_prepare.ts` (reset DB test, migrate Admin + Hub, fixture M1/M2 + dữ liệu dưới) → admin-api 3021 (`ADMIN_HUB_URL=http://localhost:4040`, token test 48 ký tự sinh trong config) → Dify mock 4048 → hub-api 4040 (`HUB_DEV_RUNTIME` không dùng; `HUB_CORS_ORIGINS` 3120, 3020) → chat-web preview 3120 (`HUB_URL`, `AUTH_URL`) → admin-web preview 3020 (`PUBLIC_HUB_URL=http://localhost:4040`).

| Dữ liệu (`_prepare.ts`, SQL owner vào DB test) | Giá trị |
|---|---|
| secret | `DIFY_MOCK_KEY` (giá trị sinh lúc chạy, mã hoá bằng `SECRET_MASTER_KEY` test) |
| workflow | `mock-send` (`workflow`, `base_url` Dify mock, input `text` bắt buộc, `side_effect=false` ban đầu); `mock-dich` (`side_effect=false`) |
| command | `/mock-send` (arg `text` rest ⇒ `text`), `/mock-dich` (`lang` default `vi`, `text` rest) |
| feature/grant | feature `x1-demo` (2 lệnh) entitlement acme, grant group `ke-toan` (có `lan`) |
| Hub | `insertHubConfig` (H1) + provider `dify` |

| File | Kịch bản (spec §7) | Kỳ vọng |
|---|---|---|
| `x1-side-effect.combine.ts` | S7 (AC08) | như AC08 combine |
| `x1-commands.combine.ts` | S4 mock | `lan` gõ `/` thấy `/mock-send`, `/mock-dich`; `an` (không trong `ke-toan`) không thấy; `/mock-dich en hi` ⇒ kết quả mock; `/mock-dic` ⇒ gợi ý `/mock-dich`; `/mock-send` thiếu arg ⇒ alert |
| `x1-test-run.combine.ts` | S8 mock | admin platform: editor `/mock-dich` sửa nháp (chưa lưu) ⇒ "Chạy thử" ⇒ 200, Dify mock nhận đúng 1 lời gọi với input nháp; DB không đổi (`config_version` giữ nguyên) |

## 5. Lệnh `done:x1` (`tools/scripts/src/done-x1.ts`, I1, mẫu `done-h4a`)
| # | Bước | Lệnh |
|---|---|---|
| 1 | typecheck | `bun run typecheck` |
| 2 | unit + rules | `bun test` (gồm `tests/acceptance/X1/rules`, `static-scan`, `smoke-skip`, `bundle-secret` sau bước 10) |
| 3 | int | `bun run test:int` (H1–H4a, M1–M4, ADM-NFR-06, X1) |
| 4 | stack bị ảnh hưởng L01 | `bun run test:h2a:stack` + `bun run test:h2b:stack` (S01, S05) |
| 5 | contract chat | `bun run test:contract:chat` (41 + X1) |
| 6 | e2e chat | `bun run e2e:chat` (C1 + `x1-*.chat.ts`) |
| 7 | e2e admin gốc | `bunx playwright test` (gồm L10–L13, `x1-studio-link.spec.ts`) |
| 8 | e2e x1 | `bunx playwright test -c e2e/x1/playwright.config.ts` |
| 9 | e2e combine | `bunx playwright test -c e2e/combine/playwright.config.ts` |
| 10 | build + bundle | `bun run --filter @ai/chat-web build && … check:bundle`; idem admin-web |
| 11 | e2e studio (hồi quy CORS/nút) | `bun run e2e:studio` |
| 12 | i18n · trace · lock | `bun run i18n:check` · `bun run trace --check` · `bun run test:lock:verify` |
Không có: Dify thật, WSL, `claude-sub`, `test:perf` (X1-R15). Bước 6–9, 11 tuần tự (P6).

## 6. Smoke Dify thật (tay, I2 — người dùng bấm)
Điều kiện: `combine:dev` đang chạy, người dùng đã `bun run seed:dify -- --apply` (key do người dùng trỏ). Lệnh: `DIFY_LIVE=1 bun --env-file=.env.local tests/smoke/X1/dify-live.ts --apps translate[,…]`.
| App | Cách gọi (qua Hub, service API) | Số lời gọi | Kỳ vọng |
|---|---|---|---|
| translate | lan: `/translate en Xin chào` | 1 | `run.finished` có chữ, không lỗi |
| gmail-summary | `/summary <email mẫu cố định trong script>` | 1 | có tóm tắt |
| email-reply | `/reply <email mẫu>` | 1 | có nháp |
| screenshot-ask | upload ảnh PNG mẫu nhỏ (sinh trong script) + `/ask-image` | 1 (+1 upload `/v1/files/upload` do Hub) | có mô tả |
| chatbot | `@dify-chatbot Xin chào` (cần Runtime WSL `dify`) | 1 | có trả lời |
Đếm: bộ đếm trong chính script (mỗi app đúng 1 lần, không retry, không đọc DB), in số lời gọi, **fail nếu > 1**. Không retry, không song song, không gọi `/console/api`, không `/parameters`/`/info`. Agent không tự chạy khi người dùng chưa bảo (Q8).

## 7. Đỏ đúng lý do (điền khi WRITE xong)
| Nhóm | Số ca | Đỏ đúng lý do / tổng | Ghi chú |
|---|---|---|---|
| QC1a L01–L13 | — | — | |
| QC1b X1 · đợt 1 (rules/unit, tĩnh, smoke) `3a08d81` | 57 | 50/50 đỏ đúng lý do ("Cannot find module" file sản phẩm chưa có, hoặc expect thiếu `side_effect`); 7 xanh = chặn hồi quy (bundle-secret, static key/console, smoke-skip ×2, transfer export/diff đã đúng ở mức rules) | allowlist key AC18 = `tests/acceptance/H3b/_h3b-trace.ts` (key giả cài sẵn trong test đã khoá) |
| QC1b X1 · đợt 2 phần 2 (int + contract) | 50 | 29/29 đỏ đúng lý do; 21 xanh (chi tiết dưới) | chạy 2026-10-07 trên DB qc `ai_system_qc_test` + Hub DB riêng `ai_system_qcx1hub_test` (`HUB_TEST_DATABASE_URL`) + Redis DB 14; working tree có thay đổi **chưa commit của B1** (`packages/db` 0009, `contracts/workflows`, `admin-api/workflows*`) ⇒ int chạy trên code dở |
| ↳ AC10 `workflow-side-effect.int` | 12 | 0 đỏ; 12 xanh **trên code dở B1** | cột + API + audit + restore + export/import đã có trong working tree B1; HEAD (chưa B1) sẽ đỏ ở `side_effect` undefined/thiếu cột. Xác nhận lại khi B1 commit |
| ↳ AC11 `command-test.int` | 18 | 16/16 đỏ: route `POST /admin/commands/test` chưa có ⇒ 404 ở `expect` status | 2 xanh chặn hồi quy: binh 403 (router `requireRole` sẵn), `API_ERRORS` = 48. Giả định: admin-api đọc `ADMIN_HUB_URL`/`HUB_INTERNAL_TOKEN` từ env (plan §2.2) — test chạy tiến trình thật nên không phụ thuộc tên khoá deps của `createApp`. Cổng 3095/3098/3099 |
| ↳ AC12 `group-agent-count.int` | 4 | 3/3 đỏ: `agent_count` 0 ≠ 2 (B4 chưa có) | 1 xanh: mất quyền SELECT ⇒ 0 (đúng cả trước B4) |
| ↳ AC14 `cors.int` | 4 | 0 đỏ; 4 xanh | K8: không đổi code (env đã tách dấu phẩy) ⇒ chặn hồi quy. Cổng admin 3097, Hub 4051/4052; Hub cần `insertFixture`+`insertHubConfig` H1 (thiếu orchestrator ⇒ thoát `orchestrator-invalid`) |
| ↳ AC15 `schema-check.int` | 4 | 3/3 đỏ: `Cannot find module …/config/schema-check.ts`; server thiếu cột vẫn chạy (exit null ≠ 1) | 1 xanh: có cột ⇒ `/health` 200. Cổng 4053 |
| ↳ AC16/AC17 `seed-dify.int` | 9 | 7/7 đỏ: `Module not found tools/scripts/src/seed-dify-live.ts` (exit 1 ≠ 0; output thiếu tên biến) | 2 xanh (rỗng nghĩa tới S1): Dify stub 0 lời gọi, quét rò. Setup: `createM2Env` + `runHubMigrations` cùng DB qc (bước 8 qua `DATABASE_URL`). Cổng 3096 |
| ↳ AC03 `tests/contract/chat/x1-context.contract` | 3 | 0 đỏ; 3 xanh trên mock | `SendMessageRequestSchema.context` đã có từ H2a ⇒ chặn hồi quy (Hub thật: chạy với `HUB_URL`) |
| QC1b X1 · đợt 3 phần 3 (e2e chat/x1/combine/gốc) | 54 | 50/50 đỏ đúng lý do (UI/proxy/route chưa có: `expect` không thấy listbox "Lệnh"/"Agent", `button "Đính kèm tệp"`, `switch`, `tab` Agent, `link "Agent Studio"`, `textbox "Nội dung sau lệnh"`, `/commands` trả `text/html` SPA); 4 xanh = chặn hồi quy (chat `//x` gửi nguyên văn, chat AskCard chip gửi đúng chữ, x1 binh không thấy "Agent Studio", root vắng env không thấy "Agent Studio") | chạy 2026-10-07, mỗi bộ riêng, `--output` riêng (`C:/tmp-qc-x1-*`). **Chat 29** (`e2e/chat/x1-*.chat.ts`: commands 7, agents 6, attachments 9, confirm 1, proxy 6): 27 đỏ + 2 xanh. **x1 20** (`e2e/x1/*.x1.ts`: command-test 7, groups-agent 8, studio-link 3, workflows-side-effect 2): 19 đỏ + 1 xanh. **combine 4** (`e2e/combine/*.combine.ts`: commands 2, side-effect 1, test-run 1): 4 đỏ; stack Hub thật + Dify mock dựng được (lệnh `/mock-dich en hi` chạy tới Dify mock, đã kiểm). **Gốc 1** (`e2e/x1-studio-link.spec.ts`): xanh. Giới hạn: ca "ask choices Đồng ý/Huỷ" nhánh mock KHÔNG vá được SSE ⇒ chip Đồng ý/Huỷ chỉ kiểm ở combine (AC08); AC09 so với mock Hub chỉ khẳng định "không phải HTML SPA" (mock chưa có route thật) |

### 7.1 Tranh chấp test (VERIFY, 2026-10-07) — T1–T5: test sai, đã sửa test + lock
| # | Test | Phán quyết | Sửa |
|---|---|---|---|
| T1 | `e2e/chat/x1-attachments.chat.ts` "attachment_ids đúng thứ tự chọn" | **Test sai**: mock `routeUpload` gán `id = ids[seen.length-1]` SAU `delay` ⇒ 2 upload song song (hợp lệ, ≤ 3 đồng thời CR-040/plan-frontend §1.6) cùng nhận id B ⇒ `[B,B]` | id gán khi nhận request (trước delay), lưu vào `seen`; kỳ vọng `attachment_ids` = id của a.txt rồi b.pdf (thứ tự chọn, không phụ thuộc thứ tự request) + 2 id khác nhau |
| T2 | cùng file, "lịch sử: list 'Tệp trong tin'" | **Test sai**: chỉ vá E11 `GET /messages`, nhưng luồng chính hiển thị từ E10 `flows[].preview` (FlowBlock); E11 chỉ khi mở khung flow (plan-frontend §1.6 "FlowBlock, FlowMessages") | vá thêm E10 `GET /conversations/:id/flows` (`items[0].preview.question.attachments`), giữ vá E11 |
| T3 | `tests/acceptance/X1/static-scan.test.ts` (AC18 R01) | **Test sai**: file khoá `tests/acceptance/X1/seed-dify.int.test.ts` có chuỗi console API nguyên văn trong tên ca ⇒ test tự vi phạm luật quét | đổi tên ca thành "…console API)"; phạm vi quét giữ nguyên (vẫn chặn apps/packages/tools/tests/e2e) |
| T4 | `e2e/x1/_hub-stub.ts` hằng `GROUP` (F5, ADM-FR-37) | **Test sai**: `GroupRefSchema.name` là `LocalizedText {vi, en?}` (contracts/groups.ts), stub dùng chuỗi ⇒ `AgentGrantListResponseSchema.parse` ném ⇒ 500 | `name: { vi: "Kế toán" }`; không còn chỗ tương tự trong `e2e/x1/**` |
| T5 | `e2e/x1/workflows-side-effect.x1.ts:22`, `e2e/combine/x1-side-effect.combine.ts:28` (F4, ADM-FR-10) | **Test sai**: chờ `method() === "PUT"` nhưng route admin-api là `PATCH /admin/workflows/:id` (workflows.routes.ts:40; AC10 đã ghi "API M2 dùng PATCH") | đổi thành `"PATCH"` ở cả 2 file; `workflows-side-effect` 2/2 xanh |

## 8. Cần bổ sung — đã chốt (điều phối chốt 2026-10-07 theo Luật 2; spec §10)
| # | Lỗ hổng | Chốt |
|---|---|---|
| 1 | Test command vai trò | [x] chỉ `platform_admin`; binh ⇒ 403; nhãn "Chạy thử" |
| 2 | "Lưu lệnh một lần" | [x] bỏ khoá (plan-frontend §2.2); chạy thử lệnh chưa lưu |
| 3 | "Chạy với tư cách user… kiểm tra quyền" | [x] ngoài X1 (K9, TECH-DEBT #89); chỉ khẳng định `actor_user_id` |
| 4 | Mock Hub chat thiếu route | [x] e2e chat dùng `page.route` (`/commands`, `/agents`, `/attachments`, `responder`, 429), không sửa `tools/mocks`; AC09 chỉ cần route mock trả không-HTML |
| 5 | Seed bước 8 DB | [x] `DATABASE_URL`/env DB của hub-api (plan S1); AC16 trỏ DB qc qua env |
| 6 | Smoke AC20 | [x] `tests/smoke/X1/dify-live.ts` do qc viết; bộ đếm trong script |
| 7 | Export thuần AC03/06/07 | [x] plan-frontend §1.1b (`*.rules.ts`) |
| 8 | S7 `side_effect` | [x] bật cờ `mock-send` trong Admin, không qua seed yaml |
