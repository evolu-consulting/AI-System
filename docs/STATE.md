# STATE — trạng thái hiện tại

Cập nhật: 2026-10-04 · Người cập nhật: docs-architect (đóng M4)

## Đang ở đâu
- **M4 xong** (2026-10-04, trên `main`, KHÔNG push): **admin app hoàn tất mọi phần không cần Hub** (M5 cần Agent Hub). Nghiệm thu và review: `docs/specs/M4-ops/spec-decisions.md` "Kết luận nghiệm thu và review". Spec `status: done`. Chưa chạy lại e2e toàn bộ (máy thiếu bộ nhớ); check/typecheck/bun test đang đỏ chỉ do code dở của phiên Chat.
- **Mốc H1 (phiên Hub/Worker, 2026-10-04):** spec `docs/specs/H1-hub-core/spec.md` (`status: draft`, 82 mã yêu cầu, 26 luật H1-R, 12 AC kỹ thuật `HUB-H1-AC`, 10 câu hỏi mở có mặc định) + `tasks.md` khung; ROADMAP thêm H1–H4. Kế tiếp (2026-10-04): **readiness lần 1 = NOT READY → đang sửa**; người dùng chấp nhận toàn bộ mặc định #1–#33 và câu 1 = **"chưa"** (chưa chuẩn bị WSL2/đăng nhập `claude`) ⇒ task **W0** chờ người dùng, spike PY-02 + smoke CLI thật `blocked`, AC-02 dời I2 cuối H1. Quyết định chuyển `docs/specs/H1-hub-core/spec-decisions.md`; CR-030/031 sửa chữ BA/ADR. Plan/tasks/test-plan do phiên khác sửa; sau đó chạy lại spec-readiness → Gate (ADR-0008/0009 Proposed).
- **CR-028 / ADR-0007** (2026-10-04, phiên Hub/Worker): Hub giữ TypeScript; Worker thành **Agent Runtime Python** (`apps/agent-runtime`) chạy mọi agent `llm`/`agentic-cli`/`python`. Hàng đợi Postgres `SKIP LOCKED` (bỏ Redis queue, slot đếm trong DB), sự kiện run qua Redis Streams, contract zod → JSON Schema → pydantic, manifest `hub.agent_types`. Đã sửa ba-agent-hub, ba-worker, architecture (gồm mâu thuẫn CR-019) — chỉ design, html chưa sinh lại (TECH-DEBT #32). Chat/Admin không đổi.
- **CR-032/033/034** (2026-10-04, phiên Hub, Intake đã chốt): Orchestrator mặc định + riêng theo tenant (HUB-FR-62, BR-08; H2 runtime, H4 UI); gọi thẳng `@agent` + `GET /agents` (HUB-FR-91/92, BR-18, `AGENT_NOT_FOUND`; H2); review business: đính kèm file MUST H2, chặn cứng quota (HUB-FR-93, H3), `max_concurrent_runs` (HUB-FR-94), xác nhận `side_effect` (HUB-FR-95), kiểm thử định tuyến 3 lần/câu + sai số 1 + lưu đè, container sandbox bắt buộc trước tenant thật. H1 không đổi phạm vi. Phiên Chat/Admin áp dụng khi combine: contract `GET /agents`, mã lỗi, menu `@`, tên agent khi tag; `tenant_quotas.hard_block`, `workflows.side_effect` (xem CHANGE-REQUESTS).
- **CR-025/026** (2026-10-04, Intake Nhanh): Orchestrator định tuyến mọi tin (kể cả trong flow), kết quả agent có cấu trúc (HUB-FR-27/28/29, AC-H14/15), runtime mặc định `llm`; đổi tên thuật ngữ cũ → Orchestrator toàn docs + i18n. Chỉ sửa design; html chưa sinh lại (TECH-DEBT #32). C1 contract không đổi.
- **C1 xong** (2026-10-04, với mock; spec `status: done`, kết luận `docs/specs/C1-chat-ui/spec.md` §11): QV xanh (contract 62/62, e2e 41/41, acceptance 39/39, 36/36 CHAT-AC), review 2 vòng APPROVED; TECH-DEBT #40/#41 đã sửa (`f750b2c`); test contract gắn mã HUB-FR-40..45 → `trace --check` xanh (`04d7d03`). Luồng Chat **không còn việc dở**; chờ: (1) người dùng chạy thử Chat với mock (`bun run mocks` + `apps/chat-web` `bun run dev`, `acme`/`minh`/`dev-password-1`); (2) H1 có `apps/hub-api` → đặt `HUB_URL`/`AUTH_URL`, chạy `HUB_URL=… bun run test:contract:chat` (62 ca = cam kết tuân thủ), rồi mở Chat.
- **M4 bắt đầu** (2026-10-03): spec `docs/specs/M4-ops/spec.md` (`status: draft`, 12 mã yêu cầu, 17 luật M4-R, 14 AC bổ sung, 14 câu hỏi mở có mặc định) + `tasks.md` khung. Kế tiếp: plan BE ∥ FE, ADR-0004 (thư viện mới), test-plan, readiness, Gate.
- **M3 xong** (2026-10-03, trên `main`, KHÔNG push). Nghiệm thu xanh: `bun test` 963/963, `test:int` 885/885, e2e 159/159, i18n, build, `check:bundle` (JS đầu ~121,6 KB, chunk lớn nhất ~26,7 KB), lock, `trace --check`, `check:size --all`, `depcruise --all` 0 vi phạm, `check:fn --all`. Sau Minor vòng 2: unit 179/179, ma trận int 21/21, e2e liên quan 43/43. Review: vòng 1 CHANGES REQUESTED (BE 2 Major, FE 1 Major; đã sửa), vòng 2 APPROVED. Kết luận: `docs/specs/M3-permissions/spec.md` §9. Spec `status: done`.
- Người dùng 2026-10-03: hiệu năng không chặn mốc (`bun run test:perf`, TECH-DEBT #27); viết lại policy RLS dạng InitPlan chờ duyệt (#28). Ưu tiên: hoàn tất admin app (M4) rồi người dùng test service. Repo chỉ local, không push.
- M0, M1, M2 xong. Thiết kế v0.4 xong (`design/`); canvas 18 artboard. Khung quy trình xong (`CLAUDE.md`, `WORKFLOW.md`, 7 agent, Luật 2b).

## Việc kế tiếp (phiên mới: làm ngay, KHÔNG hỏi — Luật 2b)
A. **Sau M4:** (1) người dùng test service admin; (2) chạy lại e2e toàn bộ khi đủ bộ nhớ; (3) M5 khi có Hub; (4) TECH-DEBT nổi bật: #27/#28 (perf, RLS InitPlan — cần duyệt), #34 (`hub_ro` trên `admin.tenants`), #35 (mã lỗi riêng cho trần import).
0. **Phiên Hub:** CONVENTIONS §9 (Python) và spec H1 đã xong (draft). Làm tiếp: plan BE (TS) ∥ plan Python (`plan.md`, `plan-runtime.md`), qc test-plan, spec-readiness, Gate (Luật 2b), rồi BUILD theo `docs/specs/H1-hub-core/tasks.md`.
1. ~~M4 Chi phí & vận hành~~ (xong 2026-10-04) theo `docs/ROADMAP.md` (Quota + cảnh báo, Chi phí & quota, Audit + khôi phục, Tổng quan, Import/Export, 2FA; ADM-FR-40–42, 51, 52, 54, 08; AC-A12 phía Admin; Import/Export và 2FA cần artboard trước Gate). Vòng: docs-architect tách spec `M4-…` → plan BE ∥ FE → qc test-plan → spec-readiness → tự duyệt Gate (Luật 2b) → qc khoá test (đỏ đúng lý do) → BUILD một task mỗi lần gọi → Lệnh xong M4 (không gồm `test:perf`) → reviewer ≤ 2 vòng → docs → bật service và hướng dẫn người dùng test toàn bộ admin app. Trên `main`, KHÔNG push.
2. Canvas: đổi `#7A7390` → `#736C89` (FE-R1, AA) khi chạm lại canvas.

## Token (đo bằng `token-report.py`, xem WORKFLOW "Đo token mỗi mốc")
- Mốc chuẩn M0–M3 (trước 2026-10-03, quy trình cũ): ≈ $756 quy đổi giá API · đọc lại cache 69% · backend-lead 38%, điều phối 23%, frontend-lead 15%, qc 13% · lần chạy lớn nhất 347 lượt / context 775K (backend-lead PLAN M3).
- M3-đóng (nghiệm thu + review, quy trình mới, từ 2026-10-03): ≈ $21,4 tổng · cache 63% · lần chạy agent lớn nhất 155K context / 50 lượt (mục tiêu ≤ 200K / 80 đạt) · điều phối 219K.
- Chỉ số chất lượng M3: readiness 3 lần · tranh chấp test 8 (test sai 7 + TC-6 sửa kèm, code sai 0) · review vòng 1: BE 2 Major, FE 1 Major; vòng 2: 0 Major · commit sửa sau review 10.
- M4 (2026-10-03 → 04, `--since 2026-10-03`, 3 phiên, 86 lượt chạy; gồm cả việc nhỏ của phiên khác): ≈ $211 · đọc lại cache 70% · backend-lead opus 36% ($75,7 / 25 lần), điều phối 24% ($51,7, 259 lượt, context max 614K), qc opus 13%, frontend-lead 14% (opus+sonnet), reviewer 6% · lần chạy agent lớn nhất BE T8 import 224K / 106 lượt, qc Q2d 239K (vượt mục tiêu 200K); điều phối vượt xa (614K).
- Chỉ số chất lượng M4: readiness 4 lần · tranh chấp test ~16 (test sai 16, code sai 0) · review vòng 1: BE 1 Major, FE 1 Major; vòng 2: 2 Major (do bản sửa) · commit sửa sau review ~8.
- Chỉ số chất lượng C1: readiness 2 lần · tranh chấp test 1 (test sai 1) · review vòng 1: 2 Major / vòng 2: 0 · commit sửa sau review 6
- Từ 2026-10-03: model theo rủi ro + một task mỗi lần gọi. Mục tiêu: cache < 40%, không lần chạy > 200K context / > 80 lượt.

## TECH-DEBT đáng chú ý (`docs/TECH-DEBT.md`)
- #13 `withScope` retry 40P01/40001: mail, HTTP phải đặt sau commit (NOTIFY M3 đã làm đúng).
- #27 đo hiệu năng tách sang `bun run test:perf`, đánh giá trên môi trường ổn định trước production; #28 policy RLS InitPlan chờ người dùng duyệt (hard stop cách ly tenant).
- #16 xoay khoá `SECRET_MASTER_KEY` chưa có (mất khoá = mất mọi secret, xem PRODUCTION-NOTES).
- #17 mỗi agent/worktree cần DB test riêng (e2e và test:int đụng nhau trên `ai_system_test`).
- #18 chưa có kiểm tự động độ dài hàm ≤ 50 dòng; #22 lệnh xong task FE thiếu `depcruise --all`.
- #20 chưa ghi audit (M4); #15 hàng `hub.agent_workflows` có thể mồ côi; #19 thư mục quá 10 file.
- #8 refresh token hết hạn chưa dọn; #10 nghiệm thu dùng `--all`; từ nay không sửa migration đã commit.

## Bài học cho mốc sau
- Lệnh xong của **mọi** task FE và BE phải chạy `depcruise --all` và đo độ dài hàm (hàm ≤ 50 dòng, ≤ 4 tham số).
- Bản sửa perf phải kiểm lại **thứ tự khoá** (POST/PATCH dùng chung một thứ tự, có ca tất định xen kẽ); khoá ngầm của unique index cũng tạo vòng chờ.
- Không dùng chung staging giữa các agent (migration M2 lọt vào commit i18n `878c90b`); mỗi agent một worktree/DB test.
- Nhiều phiên cùng `main`: luôn `git add -N <file mới>` + `git commit -o <đường dẫn>` (index có file phiên khác đã staged); test đỏ của mốc dở phải gate (vd `C1_STRICT=1`) để không làm đỏ `bun test`/`typecheck` của phiên khác.
- e2e song song nhiều agent: đổi cổng (`CHAT_E2E_HUB_PORT`/`CHAT_E2E_WEB_PORT`) + `--output` riêng, tắt server mồ côi bằng `taskkill`; mock `/__mock/*` là trạng thái chung.

## Độ phủ design (artboard)
18 artboard trong `docs/design/canvas/` (Login, Main, Sidebar, TenantOverview, TenantCreate, TenantQuota, Users, Groups, Access, Commands, Workflows, Secrets, Usage, Audit, ChangePassword, Enable2FA, ImportPreview, States). Màn chưa có artboard: xem `docs/specs/_design/admin-missing-screens.md`.

## Câu hỏi đang chờ người dùng
Điểm thiết kế Hub/Worker đã thảo luận 2026-10-04:
- (a) ~~architecture ghi "subscription là đường chính" mâu thuẫn CR-019~~ Đã sửa (CR-028).
- (b) ~~H1 chạy Agent SDK trong Hub vs "Hub không chạy CLI"~~ Đã chốt (CR-028/ADR-0007): interface `AgentRunner`, v1 = job + Redis Stream; Agent Runtime Python chạy CLI.
- (c) ~~Queue Postgres~~ Đã chốt (CR-028/ADR-0007): `SKIP LOCKED`, slot đếm trong DB.
- (d) ~~Redis Streams cho sự kiện run~~ Đã chốt (CR-028/ADR-0007).
- (e) ~~Worker Windows hay Linux?~~ Chốt CR-029: Windows + WSL2 Ubuntu (WRK-NFR-06, WRK-BR-07). Còn mở: bật sandbox Claude Code mặc định hay chỉ hook
- (f) Cookie refresh khi chat-web khác origin với admin-api.

## Bị chặn
- (không)
