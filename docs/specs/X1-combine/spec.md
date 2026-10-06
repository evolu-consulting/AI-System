---
id: X1-combine
title: Combine - tích hợp Chat + Admin + Agent Hub (+ Studio) và nối Dify thật
milestone: X1
status: draft            # draft → ready → approved → in-progress → done
requirements: [ADM-FR-21, ADM-FR-23, ADM-FR-37, HUB-FR-10, HUB-FR-11, HUB-FR-12, HUB-FR-44, HUB-FR-51, HUB-FR-72, HUB-FR-78, HUB-FR-79, HUB-FR-91, HUB-FR-92, HUB-FR-94, HUB-FR-95, CHAT-AC-01..36, X1-R01..R16, X1-AC01..AC20]
design: [docs/CHANGE-REQUESTS.md#CR-036, CR-038, CR-040, CR-043, CR-044, CR-046, docs/ROADMAP.md (M5), docs/guides/hub-dev.md ("Admin gọi Hub (H3b, R23)", "Studio dev (H4a)"), docs/specs/H2a-dify-command/smoke.md]
owner: backend-lead + frontend-lead + qc
---

# X1 Combine

Người dùng chốt 2026-10-07 (CR-046): combine làm **trong phiên Hub**, được phép sửa `apps/chat-web`, `apps/admin-web`, `apps/admin-api`, `packages/db` (migration Admin) **chỉ trong phạm vi mốc này**. Mục tiêu: người dùng test **toàn luồng nghiệp vụ** trên 3 app + Studio với Dify thật.

## 1. Phạm vi
**Làm** (6 nhóm, mỗi nhóm = một cụm task ở `tasks.md`):

| # | Nhóm | Nội dung | Nguồn |
|---|---|---|---|
| A | Chat áp CR | Menu `/` (`GET /commands`) + `context` + `CMD_*` + `//`; menu `@` (`GET /agents`) + `@@` + `responder` + `AGENT_NOT_FOUND` + 429 `TOO_MANY_RUNS`/`Retry-After` + delta dài; đính kèm file (`POST /attachments`, chip, `attachment_ids`, `Message.attachments`, `ATTACHMENT_*`); AskCard xác nhận `side_effect`; proxy dev `/agents`, `/commands`, `/attachments` | CR-036, 038, 040 |
| B | Admin áp CR (đóng M5) | Cột `admin.workflows.side_effect` (migration + API + toggle UI); nút Test command → `POST /internal/test-run` (ADM-FR-23); Groups tab Agent (ADM-FR-37); Quyền hiệu lực phần agent; mã lỗi `HUB_ADMIN_ERRORS`; nút "⇄ Agent Studio" (chỉ `platform_admin`); CORS admin-api cho `:3200` | CR-036, 043, 044 |
| C | Hub | Bỏ nhánh dự phòng `hub.workflow_flags` khi có cột (an toàn, X1-R09); `HUB_CORS_ORIGINS` = chat 3100 + admin 3000 + studio 3200 | CR-036, 043 |
| D | Seed Dify thật | `tools/scripts/src/seed-dify-live.ts` (§6) | CR-046, X1-R01..R05 |
| E | Stack + hướng dẫn | `bun run combine:dev` + `docs/guides/combine-test.md` theo kịch bản nghiệp vụ (§7) | - |
| F | Đóng mốc | `done:x1` (§8), review 2 vòng, I2 kiểm tay do người dùng | - |

**Không làm:** H3c (tạm dừng), H4b–d, màn Admin cấu hình `HUB_MAX_CONCURRENT_RUNS`/hạn mức file (CR-038/040: chưa cần), Nhật ký Admin đọc `hub.audit_log` (CR-043 Q-U3, hoãn), e2e Playwright chạy Dify thật (chỉ smoke tay `DIFY_LIVE=1`), sửa contract `@ai/contracts/*` (chỉ **dùng** cái có sẵn; cần đổi → `backend-lead`, ghi CR), TLS/production (PRODUCTION-NOTES).

## 2. Luật (X1-R)

### 2.1 Ràng buộc cứng Dify (người dùng đang chuẩn bị demo)
| Luật | Nội dung |
|---|---|
| X1-R01 | **Tuyệt đối không** sửa, publish, import, xoá app/flow Dify; **không** gọi console API Dify (`/console/api/*`, đăng nhập console). Chỉ gọi **service API** (`/v1/workflows/run`, `/v1/chat-messages`, `/v1/files/upload`) để CHẠY app có sẵn. Mã/test/script vi phạm = Blocker khi review |
| X1-R02 | Số lần gọi Dify thật tối thiểu: smoke **≤ 1 lần mỗi app được chọn** cho mỗi lần chạy, chỉ khi `DIFY_LIVE=1`; vắng cờ → bỏ qua, exit 0. Không retry tự động ở smoke; không vòng lặp, không chạy song song |
| X1-R03 | Test tự động (`bun test`, `test:int`, `e2e`, `done:x1`) dùng **Dify mock** (`tools/mocks`/mock Hub), không bao giờ chạm Dify thật, không đọc file `.env` của auto-pilot |
| X1-R04 | **Key không vào repo**: không commit, không chép vào docs/spec/test/log/fixture/`.env.local`. Seed đọc `DIFY_API_URL` và `DIFY_KEY_<APP>` từ file trỏ bởi `DIFY_SEED_ENV_FILE` (không có mặc định; ví dụ trỏ tới `.env` của `D:\AI\evoluconsulting\auto-pilot`) **lúc chạy**, ghi vào Admin secrets (AES-256-GCM, `SECRET_MASTER_KEY`) của **DB dev**, không in ra stdout/stderr/log (kể cả độ dài, tiền tố, hash). Agent/phiên làm docs **không** mở hay in file `.env` đó |
| X1-R05 | `DIFY_AGENT_API_KEY` (Trello) là placeholder: **bỏ qua**. Seed chỉ đụng app trong danh sách chọn (§6); mặc định `--dry-run` (in kế hoạch: tên app, loại, input, không có key); ghi thật cần `--apply` |

### 2.2 Luật tích hợp
| Luật | Nội dung |
|---|---|
| X1-R06 | Chat chỉ dùng contract `@ai/contracts/chat` + `chat/{commands,agents,attachments}` có sẵn; mã lỗi từ `CHAT_API_ERRORS`, `CHAT_COMMAND_ERRORS`, `CHAT_ROUTING_ERRORS`, `CHAT_ATTACHMENT_ERRORS` (không đặt mã trùng). C1 giữ nguyên: CHAT-AC-01…36 + `test:contract:chat` 41 ca vẫn xanh |
| X1-R07 | Chat tải file bằng `fetch` có `Authorization` (không `<a href>` trần); chip xám khi `available=false`; file agent tạo chỉ thấy khi tải lại lịch sử (CR-040 mục 4) |
| X1-R08 | Admin gọi Hub **thẳng** bằng JWT admin đang đăng nhập (CR-043 Q-K1): `PUBLIC_HUB_URL` (build-time, dev `http://localhost:4000`). Nút Test command gọi `POST /internal/test-run` **qua admin-api** (Bearer `HUB_INTERNAL_TOKEN` ≥ 32 ký tự là secret server, không xuống trình duyệt) |
| X1-R09 | Bỏ nhánh `hub.workflow_flags` **chỉ khi** cột `admin.workflows.side_effect` có ở mọi DB Hub chạy: Hub kiểm cột lúc khởi động, thiếu cột → **không khởi động** (log rõ) thay vì lùi về nhánh cũ; bảng `hub.workflow_flags` và ghi của seed yaml giữ nguyên tới khi có CR dọn. `done:h2a`/`h2b` int vẫn xanh. Không chắc → hoãn task, ghi TECH-DEBT, **không chặn** `done:x1` |
| X1-R10 | Migration Admin `side_effect`: `ADD COLUMN side_effect boolean NOT NULL DEFAULT false`; chạy bằng role chủ bảng; RLS không đổi; Import/Export (M4) đồng bộ cột; rà `hub.workflow_secret`/`hub.log_dify_usage` (CR-036) |
| X1-R11 | Nút "⇄ Agent Studio": chỉ `platform_admin`; URL từ `PUBLIC_STUDIO_URL` (vắng → ẩn); admin-api CORS thêm `http://localhost:3200` qua env (đã `credentials: true`), không sửa cứng |
| X1-R12 | CORS Hub dev gồm 3100, 3000, 3200; mặc định `env.ts` giữ chỉ chat-web (không mở ngầm); `combine:dev` đặt env tường minh |
| X1-R13 | Chat/Admin sửa theo CONVENTIONS (file ≤ 400 dòng, i18n VI/EN đủ, a11y như C1/M4, `check:bundle` không vượt ngưỡng; perf nới theo ưu tiên của người dùng) |
| X1-R14 | Seed idempotent: chạy lại không tạo trùng (khoá theo `key`/tên), cập nhật khi khác, **không bao giờ xoá**; secret chỉ ghi lại khi `--rotate-secrets` |
| X1-R15 | `done:x1` không phụ thuộc Dify thật/WSL/`claude-sub` (chỉ có ở smoke tay có cờ) |
| X1-R16 | Không sửa `docs/design/**`, không mở H3c/H4b. 4 file đang sửa dở của phiên khác (`apps/admin-web/rsbuild.config.ts`, `AppShell.tsx`, `apps/chat-web/rsbuild.config.ts`, `docs/PRODUCTION-NOTES.md`) chỉ đụng sau khi phiên đó commit (Q10) |

## 3. Contract (backend-lead)
Không thêm contract mới. Dùng: `@ai/contracts/chat` (+ `commands`, `agents`, `attachments`), `@ai/contracts/hub-admin` (`HUB_ADMIN_ERRORS`, `EffectiveAgent`), `@ai/contracts/studio` (seed agent `dify-chatbot` qua Studio API). **Chỉ thêm ở Admin:**

| Method | Path | Role | Request | Response | Lỗi |
|---|---|---|---|---|---|
| POST/PUT | `/admin/workflows` (đã có) | platform_admin / tenant_admin | thêm `side_effect?: boolean` (mặc định false) | thêm `side_effect` | như hiện có |
| POST | `/admin/commands/:id/test` (tên chốt ở PLAN) | tenant_admin, platform_admin | cấu hình nháp + tham số mẫu + `run_as?` (ADM-FR-23) | `{ok, output, duration_ms, error?}` | 403, 502 `HUB_UNAVAILABLE`, mã Hub chuyển tiếp |

Admin → Hub: `POST /internal/test-run` (Bearer `HUB_INTERNAL_TOKEN`), `GET/POST/DELETE /agent-grants`, `GET /agent-grants/effective/:user_id` (spec H3b §3).

## 4. Dữ liệu (backend-lead)
| Bảng | Cột | Kiểu | Null | Default | Ràng buộc | RLS |
|---|---|---|---|---|---|---|
| `admin.workflows` | `side_effect` | boolean | không | false | - | giữ nguyên |

Migration `packages/db/migrations/<n>_x1_workflow_side_effect.sql` + Drizzle. Seed Dify ghi `admin.secrets`, `admin.workflows`, `admin.commands`, grant command cho group (tên bảng chốt ở PLAN) và `hub.agents` (`dify-chatbot`) **qua API**, không SQL trực tiếp (X1-R14).

## 5. UI (frontend-lead)
Artboard: không có mới, dùng mẫu M3/M4 (Groups tab, AccessExplainer) và C1 (composer, AskCard); nút Test theo ui-admin Commands. Câu chữ VI/EN chốt ở `plan-frontend.md`.

| Màn / thành phần | Trạng thái cần có | Nhãn e2e |
|---|---|---|
| Chat composer: menu `/` và `@` | tải · rỗng · lỗi · không quyền; ↑↓ Enter Esc; `//`, `@@` escape | role `listbox`, `option` |
| Chat chip file | đang tải · lỗi · xoá · xám (`available=false`) · tối đa 10 · chặn sớm theo `ATTACH_ALLOWED`/20 MiB | role `list` "Tệp đính kèm" |
| Chat lỗi | `CMD_NOT_FOUND` + gợi ý ≤ 3, `CMD_MISSING_ARG`, `AGENT_NOT_FOUND`, `TOO_MANY_RUNS` (đếm ngược `Retry-After`), `ATTACHMENT_*` | role `alert` |
| Chat nhãn người trả lời | `responder.name` thay "Consultant" khi `@agent` | - |
| Admin Commands: toggle `side_effect` + nút Test | tải · rỗng · lỗi · không quyền · Hub không sẵn sàng | nút "Test command" |
| Admin Groups tab Agent; Quyền hiệu lực phần agent | thay "Chưa khả dụng" | tab "Agent" |
| Admin nút "⇄ Agent Studio" | chỉ `platform_admin`; vắng env → ẩn | link "Agent Studio" |

## 6. Seed Dify thật (nhóm D)
`bun run seed:dify -- [--apply] [--apps a,b] [--tenant acme] [--rotate-secrets]`. Luồng: đăng nhập admin-api (`platform_admin` dev) → đọc `DIFY_SEED_ENV_FILE` (chỉ `DIFY_API_URL` và `DIFY_KEY_*` của app được chọn) → mỗi app: upsert secret (`dify-<app>`), workflow (`app_type`, `base_url`, `secret_id`, input schema, `side_effect`), command (`/<tên>`, input map), grant cho group `dify-demo`; app Chat → agent `dify-chatbot` qua Studio API. Không in key; lỗi chỉ in tên khoá thiếu.

| App (auto-pilot) | Loại | Nối mặc định | Command / input map đề xuất |
|---|---|---|---|
| chatbot | chat | **có** | agent `dify-chatbot` (không command); Orchestrator chọn hoặc `@dify-chatbot` |
| translate | workflow | **có** | `/translate`: `text`=`$args.text` (phần còn lại của dòng), `target_lang`=`$args.lang` (mặc định `vi`) |
| gmail-summary | workflow | **có** | `/summary`: `subject`=`$args.subject` (mặc định "(không tiêu đề)"), `sender`=hằng "(dán từ chat)", `email_body`=`$args.text` (hoặc `$selection`) |
| email-reply | workflow | **có** | `/reply`: như gmail-summary; `side_effect=false` (chỉ soạn nháp) |
| screenshot-ask | workflow (ảnh) | **có** | `/ask-image`: `image`=`$attachment`, `question`=`$args.text` (kiểm CR-040 với Dify thật) |
| web-context | chat | không | cần ngữ cảnh trang (extension), hoãn |
| semantic-find | workflow | không | cần `passages` từ trang, hoãn |
| autofill / extract | workflow (ảnh) | không | dành cho extension, hoãn |

Tên bảng/cột và cú pháp `$args.*` theo spec H2a §3 và ADM-FR-21; PLAN xác nhận trước khi viết.

## 7. Stack và hướng dẫn (nhóm E)
`bun run combine:dev` (mở rộng `hub:dev`, `tools/hub-dev`): compose (Postgres, Redis, Mailpit) → migrate → admin-api `:3001` (CORS gồm 3000, 3100, 3200; `HUB_INTERNAL_TOKEN`) → hub-api `:4000` (`HUB_CORS_ORIGINS`) → chat-web `:3100`, admin-web `:3000`, studio-web `:3200` (proxy `/auth` → admin-api, `/studio/api` → Hub; chat-web thêm `/agents`, `/commands`, `/attachments` → Hub). Agent Runtime: `HUB_DEV_RUNTIME=none`; script **in lệnh** WSL `claude-sub` (hub-dev.md "Runtime trong WSL"), tự chạy qua `wsl.exe` khi `COMBINE_WSL=1`. Env: `AUTH_URL`→admin-api, `HUB_URL`→hub-api, `PUBLIC_HUB_URL`, `PUBLIC_STUDIO_URL`, `PUBLIC_ADMIN_WEB_URL`, `PUBLIC_CHAT_WEB_URL`.

`docs/guides/combine-test.md` (≤ 300 dòng), mỗi kịch bản: bước · kỳ vọng · app:

| # | Kịch bản | Dify |
|---|---|---|
| S1 | Đăng nhập 3 app (platform_admin, tenant_admin, member), đổi mật khẩu lần đầu | mock |
| S2 | Admin: tạo tenant, user, group; cấp feature, command, agent cho group; Quyền hiệu lực | mock |
| S3 | Chat thường (Orchestrator), huỷ, kết nối lại, 429 | `claude-sub` |
| S4 | `/lệnh` (menu, thiếu tham số, lệnh sai + gợi ý, `//`) | mock rồi **thật** (`/translate`) |
| S5 | `@agent`, `@@`, nhiều tag, tag sai | `claude-sub` |
| S6 | Đính kèm: hợp lệ, quá lớn, sai loại, chip xám; `/ask-image` | mock + 1 lần thật |
| S7 | Xác nhận `side_effect`: bật cờ ở Admin → Chat hỏi Đồng ý/Huỷ | mock |
| S8 | Admin Test command (không lưu) | mock + 1 lần thật |
| S9 | Studio: sửa agent/Orchestrator từ nút "⇄ Agent Studio"; Chat thấy menu `@` đổi | - |
| S10 | Dify thật (`DIFY_LIVE=1`): chatbot, translate, gmail-summary, email-reply, screenshot-ask, **mỗi app đúng 1 lần** | thật |

## 8. Tiêu chí nghiệm thu (qc)
CHAT-AC-01…36 (C1) giữ xanh. AC mới (Given/When/Then chi tiết ở `test-plan.md`):

| AC | Nội dung ngắn | Test |
|---|---|---|
| X1-AC01 | Chat gõ `/` → menu từ `GET /commands`, chỉ lệnh user được dùng; chọn + Enter điền composer | e2e chat (mock Hub) |
| X1-AC02 | `/abc` sai → `CMD_NOT_FOUND` + ≤ 3 gợi ý; thiếu tham số → `CMD_MISSING_ARG`; `//x` gửi chữ `/x` | e2e |
| X1-AC03 | `context` (`selection`, `page_url`, `page_text`) gửi kèm tin khi có | unit + contract |
| X1-AC04 | `@` → menu từ `GET /agents`; `@@x` gửi `@x`; tag sai → `AGENT_NOT_FOUND`; `responder.name` thay "Consultant" | e2e |
| X1-AC05 | 429 `TOO_MANY_RUNS` đếm ngược theo `Retry-After`; nút gửi mở lại khi hết | e2e |
| X1-AC06 | Delta dài (hàng trăm) nối mượt, không chờ `step.finished` | unit |
| X1-AC07 | Đính kèm: thân thô + `X-Filename`; chip; `attachment_ids`; `Message.attachments`; `ATTACHMENT_*` có câu VI/EN; chip xám khi `available=false` | e2e |
| X1-AC08 | AskCard `side_effect`: "Đồng ý" chạy, khác → huỷ (CR-036) | e2e |
| X1-AC09 | Proxy dev chat-web chuyển `/agents`, `/commands`, `/attachments` tới Hub | test cấu hình |
| X1-AC10 | Admin: cột `side_effect` lưu/đọc, mặc định false; Import/Export giữ cột | int + unit |
| X1-AC11 | Test command (ADM-FR-23): chạy bản nháp chưa lưu → kết quả/thời gian/lỗi; không lộ `HUB_INTERNAL_TOKEN` ra bundle/response; Hub tắt → 502 hiển thị được | int + e2e admin |
| X1-AC12 | Groups tab Agent cấp/thu hồi (idempotent 204); Quyền hiệu lực có phần agent; lỗi `HUB_ADMIN_ERRORS` có câu | e2e admin (Hub mock) |
| X1-AC13 | Nút "⇄ Agent Studio": thấy với `platform_admin`, không với `tenant_admin`/`member`; ẩn khi vắng `PUBLIC_STUDIO_URL` | e2e admin |
| X1-AC14 | Preflight CORS Hub/admin-api: origin 3000/3100/3200 được, origin lạ không | int |
| X1-AC15 | Hub khởi động thiếu cột `side_effect` → dừng + log rõ; có cột → `GET /commands` đúng cờ | int hub-api |
| X1-AC16 | Seed `--dry-run` không ghi, không in key; `--apply` idempotent (chạy 2 lần = như 1 lần); quét log/dump không lộ key (thô/base64/hex) | test với `.env` giả + Dify mock |
| X1-AC17 | Seed từ chối khi thiếu `DIFY_SEED_ENV_FILE` hoặc thiếu key app chọn → lỗi nêu tên khoá, không ghi dở | unit |
| X1-AC18 | Quét repo: không có chuỗi giống key Dify, không có lời gọi `/console/api` (X1-R01, R04) | test tĩnh |
| X1-AC19 | `combine:dev` dựng đủ 6 tiến trình, kiểm `/health`; Ctrl+C dừng đúng thứ đã bật | script test |
| X1-AC20 | Smoke `DIFY_LIVE=1`: mỗi app chọn đúng 1 lần gọi (đếm ở log Hub); vắng cờ → bỏ qua exit 0 | tay + test bỏ qua |

**Lệnh xong `done:x1`** (`tools/scripts/src/done-x1.ts`, mẫu `done-h4a`): `bun run typecheck` · `bun test` · `bun run test:int` · `bun run test:contract:chat` · `bun run e2e:chat` + e2e admin liên quan (M5) + e2e combine mock · `bun run i18n:check` · `bun run trace --check` · `check:bundle` chat-web và admin-web · `bun run test:lock:verify`. `test:perf` không chặn.

## 9. Câu hỏi mở (đều có mặc định; không trả lời = chấp nhận mặc định)
| Q | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| Q1 | Nối app Dify nào? | §6: chatbot, translate, gmail-summary, email-reply, screenshot-ask; hoãn web-context, semantic-find, autofill, extract |
| Q2 | Map input cho chat | §6 (`translate`: `text`=`$args.text`, `lang` mặc định `vi`; gmail-*: dán email vào `text`) |
| Q3 | `side_effect` các lệnh Dify thật | `false` cả 5; kịch bản S7 dùng workflow mock `mock-send` (không gọi Dify thật) |
| Q4 | Seed qua đường nào | API Admin + Studio API (có audit, đúng RLS), không SQL trực tiếp |
| Q5 | Tenant/group nhận lệnh Dify | tenant `acme`, group mới `dify-demo` (thành viên `lan`); `platform` không cấp |
| Q6 | Bỏ `hub.workflow_flags` | Hub dừng khi thiếu cột (X1-R09); bảng giữ; hoãn nếu int H2a/H2b đỏ |
| Q7 | Chạy Runtime | in lệnh WSL; `COMBINE_WSL=1` để tự chạy |
| Q8 | Smoke Dify thật | tay theo S10, `DIFY_LIVE=1`, đúng 1 lần/app; agent không tự chạy khi chưa được bảo |
| Q9 | DB dev | `ai_system` (compose) như `hub:dev`; không dùng DB test |
| Q10 | 4 file phiên khác đang sửa dở | làm BE, QC, seed, stack trước; FE chạm các file đó chờ phiên kia commit hoặc người dùng báo xong |

## 10. Quyết định
### Trước Gate (đã chốt với người dùng)
- [x] 2026-10-07: combine trong phiên Hub, được sửa Chat/Admin cho mốc này; ràng buộc Dify demo (X1-R01..R05); không đụng H3c, không làm H4b (CR-046).
### Trong lúc làm (agent tự quyết theo Luật 2)
- (chưa có)

## 11. Tranh chấp test
- (không)
