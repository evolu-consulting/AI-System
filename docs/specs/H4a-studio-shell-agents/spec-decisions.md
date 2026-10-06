# H4a — Quyết định và kết luận

Quyết định trước Gate, U1–U4, Q1–Q10 và quyết định trong lúc làm: [`spec.md` §9](spec.md); tranh chấp test: [`spec.md` §10](spec.md). File này chỉ giữ kết luận mốc (I3), để `spec.md` không vượt trần 25 KB.

## Kết luận H4a (docs-architect, I3, 2026-10-07)

**Tóm tắt:** app mới `apps/studio-web` (base `/studio`, dev `:3200`; khung, đăng nhập + TOTP, guard `platform_admin`, trang không quyền, badge `hub config vN`, banner mất mạng, menu "Sắp có") + `/studio/api/*` trong `hub-api` (`me`, 5 catalog chỉ đọc không lộ secret, CRUD agent + bật/tắt, Orchestrator mặc định + theo tenant). Mọi ghi qua `withConfigWrite`: khoá `config_meta` → `version` (409 `VERSION_CONFLICT{current, updated_at}`) → ghi → bump `hub_config_version` → `hub.audit_log` → NOTIFY, một transaction. Migration `0010_h4a_studio` (`hub_rw` ghi `agents`/`agent_workflows`/`orchestrator_settings`, `audit_log.tenant_id` nullable, index `runs`/`run_steps` theo `agent_id`). Hub phục vụ bản build ở `/studio` khi có `HUB_STUDIO_DIST`. Contract `@ai/contracts/studio`.

**Nghiệm thu:** `done:h4a` (I1 `79e0131`, 2026-10-07) — 19 bước chặn xanh (int ~23 phút, Python Runtime, stack H1–H3a, contract chat, `e2e:studio`, `check:bundle` studio-web, lock, trace, `check:size`, depcruise). Bước báo cáo `test:perf` đỏ (ADM-FR-53 ≤ 5 ms khi máy bận — không chặn, TECH-DEBT #27/#56). Sau sửa review: unit studio-web 95/95, int H4a 135/135, `e2e:studio` 19/19.

**Review:** vòng 1 — BE 1 Blocker (VERSION_CONFLICT Orchestrator thiếu `updated_at`) + 7 Minor, sửa `878d134`; FE 5 Major (INVALID_REFERENCE gắn trường theo `details.field`; JSON thô sai chặn Lưu; 403 giữa phiên ⇒ xoá cache + `/forbidden`; vắng `PUBLIC_ADMIN_WEB_URL` ⇒ ẩn link Admin; tách thư mục con agents ≤ 10 file) + 10 Minor, sửa `1ce8ac5`, `0cb76ee`. Vòng 2 APPROVED (`a0d28c9`), còn Minor (chuyển TECH-DEBT).

**Tranh chấp test (3, code sai 0):** A122 H3b lỗi thời theo D1 (`104715d`); E06/E13 selector `hasText` mơ hồ (`c3a1680`); E04 cấu hình e2e thiếu `PUBLIC_ADMIN_WEB_URL` (`bfd0bfd`). Chi tiết: `spec.md` §10.

**Chỉ số:** readiness 2 lần (lần 1 NOT READY, lần 2 READY) · tranh chấp test 3 (test sai/cấu hình thiếu 3, code sai 0) · review vòng 1: BE 1 Blocker, FE 5 Major / vòng 2: 0 · commit sửa sau review 4 (`878d134`, `1ce8ac5`, `0cb76ee`, `bfd0bfd`) · token chưa đo.

**I2 (kiểm tay UI) chưa làm** — người dùng chọn đóng I3 trước; chờ người dùng mở Studio (dev `:3200` hoặc `HUB_STUDIO_DIST`, đăng nhập `platform_admin`, sửa agent + Orchestrator). Kết quả I2 ghi thêm vào file này; lỗi phát hiện ⇒ sửa theo task mới, không mở lại mốc.

**Điểm mở:**
1. Nợ review chưa sửa: TECH-DEBT #77–#88 (BE: số câu SQL mỗi ghi, test đồng thời Studio, `agents.service.ts` 344 dòng, catalog `tenants` không LIMIT SQL, role theo JWT; FE: sidebar dưới `lg`, lý do khoá Switch, nháp TenantSheet, lazy component nặng, SessionWatcher, ô JSON). #76 (copy shadcn ba app) từ F1.
2. Prod chưa có reverse proxy `/auth` cùng origin Hub ⇒ tải lại trang = đăng nhập lại (U4) tới khi có proxy hoặc CR-044.
3. CR-impact Admin (CR-044, bổ sung ở I3): nút "⇄ Agent Studio" + `PUBLIC_STUDIO_URL`; Admin › Workflows là đích link `PUBLIC_ADMIN_WEB_URL/workflows`; Nhật ký Admin chưa hiện `hub.audit_log` (CR-043) — nay gồm cả bản ghi Studio (`tenant_id` null). Chat: không đổi contract (menu `@` đọc agent qua `GET /agents`, đổi từ Studio có hiệu lực theo `hub_config_version`).
4. CR-045 (2): ui-agent-studio §13 đã áp ở I3 (key, `timeout_s`, Orchestrator `agentic-cli`, `max_steps` 1–20, `history_n` 1–50).
5. H4b kế tiếp (Models/Secrets/Quyền agent); H3c vẫn tạm dừng.

**Mục chờ `docs/PRODUCTION-NOTES.md`** (file đang được phiên khác sửa dở — thêm khi sạch):
- Reverse proxy `/auth` → admin-api cùng origin Hub (U4, plan-frontend D4); `PUBLIC_AUTH_URL` khác origin ⇒ chỉ access token, không refresh.
- `HUB_STUDIO_DIST` = đường dẫn tuyệt đối tới `apps/studio-web/dist` (thiếu `index.html` ⇒ log `studio-dist-missing`, không mount); build studio-web với `PUBLIC_ADMIN_WEB_URL` (vắng ⇒ ẩn link Admin) và `PUBLIC_CHAT_WEB_URL` (vắng ⇒ ẩn nút "Về Chat").
- `HUB_CORS_ORIGINS` chỉ cần origin Studio khi Studio không cùng origin Hub (prod cùng origin ⇒ không cần).
- Migration 0010: `runs_agent_idx`/`run_steps_agent_idx` trên prod tạo `CREATE INDEX CONCURRENTLY` thủ công (plan D4, như K12 H3b).
- Không chạy `hub:seed` trên DB đã sửa bằng Studio (seed đè không audit; plan R-K3; TD #72).
- Role đọc từ JWT: hạ quyền `platform_admin` chỉ có hiệu lực ở Studio khi token hết hạn (TD #88) — rút ngắn TTL access token hoặc thu hồi phiên khi hạ quyền.
