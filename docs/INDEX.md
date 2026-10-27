# INDEX — bản đồ tài liệu

Đọc file này trước, rồi mở **đúng một** thứ cần. Không đọc cả `docs/design/` khi chỉ cần một feature.

## Luật & quy trình
| File | Dùng khi |
|---|---|
| `../CLAUDE.md` | Luật làm việc (nạp mỗi phiên) |
| `WORKFLOW.md` | Vòng một mốc, đội agent, Gate, khoá test |
| `CONVENTIONS.md` | Chuẩn code, cấu trúc bốn lớp Clean Architecture (§2, ADR-0023), giới hạn, format, chuyển dần (§10) |
| `ROADMAP.md` | Mốc M0–M5, C1, H1–H4, FR thuộc mốc nào |
| `STATE.md` | Đang làm gì, việc kế tiếp (tự chèn đầu phiên bằng hook) |
| `CHANGE-REQUESTS.md` | Nhật ký thay đổi yêu cầu `CR-xxx` |

## Thiết kế (nguồn chân lý nghiệp vụ, v0.4) — `design/`
| Phạm vi | BA | UI/UX |
|---|---|---|
| Tổng thể | `design/architecture.md` | — |
| Admin (`ADM-*`) | `design/admin/ba-admin.md` | `design/admin/ui-admin.md` (wireframe trong `.html`) |
| Agent Hub (`HUB-*`) | `design/agent-hub/ba-agent-hub.md` | `design/agent-hub/ui-agent-studio.md`, `design/agent-hub/ui-operations.md` |
| Worker (`WRK-*`) | `design/worker/ba-worker.md` | — |
| Chat & Extension | — | `design/chat-app/ui-chat-extension.md` · use case C1 `design/chat-app/usecases-chat.md` (UC-01…12, CHAT-AC-01…58; UC-09…11 = X2, CR-047/048; UC-12 = Process Engine, CR-058) · canvas `design/chat-app/canvas/` (5 artboard, xem README) · canvas X2 `design/chat-app/canvas-x2/` (4 artboard DM/nhóm, README; agent qua menu `@`) |
| Design đã duyệt (Gate M0) | Canvas: https://claude.ai/artifact/FTSiKuF9ax5DkMBVKMdHDB · bản sao nguồn `design/canvas/` | 18 artboard Admin · token `design/canvas/tokens-map.md` (bảng màu indigo từ UI-1, CR-049) |

Bản `.html` trong `design/` hiện viết tay; sẽ sinh từ md (xem `TECH-DEBT.md`).

## Kiến trúc & quyết định
| File | Nội dung |
|---|---|
| `platform/` | Evolu Platform: `README.md` (quyết định đã chốt), `intake-hd.md` (phạm vi GĐ1: lõi N1–N7 ∥ app mẫu HD1–HD10, CR-094), `GD0-plan.md`, `spike-engine.md` |
| `adr/` | Architecture Decision Records (`0001-stack.md`…; danh sách: `adr/README.md`; kiến trúc code: `0023-clean-architecture.md`) |
| `PRODUCTION-NOTES.md` | Quyết định nhỏ, "đã thử & bỏ vì…", bẫy |
| `TECH-DEBT.md` | Nợ kỹ thuật ghi lại thay vì sửa lan |

## Code & truy vết
| File | Nội dung |
|---|---|
| `CODEMAP.md` | Module → file chính, hàm vào (tới M2) |
| `TRACE.md` | FR → spec → code → test (sinh bằng `bun run trace`) |
| `specs/<ID>/` | spec.md · plan.md · plan-frontend.md · tasks.md · test-plan.md · readiness.md |
| `specs/M0-gate.md`, `specs/M1-gate.md`, `specs/M2-gate.md` (M3: sau khi có plan) | Biên bản Gate (Luật 2b) |
| `specs/_design/admin-missing-screens.md` | Màn chưa có artboard (chuỗi, trạng thái) |
| `../packages/db/README.md` | Schema, migration, RLS, seed: file vào + bẫy |
| `../apps/admin-api/src/modules/{auth,tenants,users,health,secrets,workflows,commands,features}/README.md` | Module API: FR, file vào, bẫy |
| `../apps/chat-web/README.md`, `../apps/chat-web/src/features/{auth,shell,conversations,thread,composer,run,answer,flow-panel}/README.md`, `../tools/mocks/README.md` | Chat app, feature, mock Hub chat: FR, file vào, bẫy |
| `../apps/admin-web/README.md`, `../apps/admin-web/src/features/{auth,shell,tenants,users,secrets,workflows,commands,features}/README.md` | App web và feature: FR, file vào, bẫy |
| `specs/X2b-room-agents/manual-test-I2.md` | Hướng dẫn người dùng kiểm tay `@agent` trong phòng (X2b I2, tenant evolu A/B/C) |
| `guides/combine-test.md` | Hướng dẫn người dùng test tích hợp 3 app (S1–S10, seed Dify thật) |
| `guides/filebox-test.md` | Hướng dẫn người dùng config + test FileBox (đính kèm chat + output tiến trình) |
| `guides/autofix-pr-test.md` | Hướng dẫn config + test Autofix → PR GitHub thật (P-c2 S1): source+PAT, env, sandbox, chạy, sự cố |
| `guides/deploy.md` | Runbook deploy đầy đủ (staging/production): 5 tiến trình + 3 web tĩnh + PG16/Redis7 + reverse proxy; khoá/secret, migrate+role+seed, build, systemd, agent-runtime, TLS; phụ lục host EvoBuzz |
| `TECHNICAL.md` | Tổng quan kỹ thuật toàn hệ thống (kiến trúc, thành phần, stack, bảo mật/RLS, data model, agent runtime, tích hợp) |
| `specs/_template/` | Mẫu cho spec mới |
| `readiness/` | Báo cáo spec-readiness trước khi có spec (vd `2026-10-01-admin-m1-m4.md`) |

## Specs
| ID | Tên | Mốc | Trạng thái |
|---|---|---|---|
| `M0-bootstrap` | Khung repo, công cụ, hạ tầng dev | M0 | done (chờ merge) |
| `M1-foundation-identity` | DB admin + RLS + seed, Auth, Tenants, Users, App shell | M1 | done (2026-10-01) |
| `M2-catalog-command` | Secrets, Workflows, Commands (không Test), Features + entitlement | M2 | done (2026-10-02) |
| `M3-permissions` | Groups, Grants + ma trận, Kiểm tra quyền, NOTIFY `config_changed`, chống ghi đè (modal 409); dồn từ M2: vế ≤ 5 s AC-A03, FR-24 group/grant | M3 | draft (2026-10-02, Gate đã trả lời, chờ plan) |
| `M4-ops` | Quota + cảnh báo, Chi phí & quota, Tổng quan, Audit + khôi phục, Import/Export, 2FA (FR-40–42, 51, 52, 54, 08; AC-A12 phía Admin) | M4 | draft (2026-10-03, chờ plan BE ∥ FE) |
| `C1-chat-ui` | Chat UI (`apps/chat-web`) + contract Chat↔Hub + mock Hub chat + bộ test contract dùng chung (flow, Consultant; CR-018…022) | C1 | done (2026-10-04) |
| `H1-hub-core` | Hub lõi `apps/hub-api` (JWT, hội thoại/flow/SSE, Orchestrator, `AgentRunner`) + Agent Runtime Python tối thiểu (`claude-sub`, sandbox, queue) + schema `hub` + contract zod→pydantic; Hub thật pass test contract chat (HUB-FR-01–03, 20–29, 40–45, 74–77, 83, 86, 88–90; WRK-FR-01–05, 10–15, 17, 20, 23–25) | H1 | draft (2026-10-04, chờ plan BE ∥ Python; quyết định: `spec-decisions.md`) |
| `H2a-dify-command` | Command `/` + Command Runner → Dify (sync, `workflow.async`), agent `dify-*`, MCP `/mcp` (workflow làm tool), xác nhận `side_effect`, `/internal/test-run`; contract `@ai/contracts/chat-ext` | H2a | draft (2026-10-05) |
| `H2b-routing` | `@agent` + `GET /agents`, Orchestrator theo tenant, `TOO_MANY_RUNS`, `delta` từ Runtime, nợ H1 F3–F7 | H2b | done (2026-10-05) |
| `H2c-attachments` | Đính kèm file (`POST /attachments`, gắn tin, file cho agent CLI, Dify `/files/upload`, `out/`) | H2c | done (2026-10-05) |
| `H3a-subscription` | Subscription `claude-sub`: probe → `provider_state`, hết quota/bị giới hạn, lỗi rõ (WRK-FR-22, 15; CR-041) · `spec-ac.md`, `spec-decisions.md`, `tasks.md` | H3a | done (2026-10-06) |
| `H3b-agent-grants` | Quyền agent: `/agent-grants` + `/agent-grants/effective/:user_id` (Kiểm tra quyền phần agent, đóng M5 phần agent), `GET /runs/:id/trace` theo role + audit `view_trace` (HUB-FR-78, 79, 52, 87; HUB-BR-17; ADM-FR-37 vế Hub) · `spec-ac.md`, `spec-decisions.md`, `tasks.md` khung | H3b | draft (2026-10-06) |
| `H4a-studio-shell-agents` | Studio: khung `apps/studio-web` + đăng nhập `platform_admin` + `/studio/api` Agents & Orchestrator (mặc định/theo tenant) + ghi an toàn (audit, version, NOTIFY) (HUB-FR-72, 60, 61, 62, 64, 69, 90) · `plan.md`, `plan-frontend.md` (+ `-copy`), `test-plan.md`, `readiness.md`, `tasks.md`, `spec-decisions.md` ("Kết luận H4a") | H4a | done (2026-10-07; I2 kiểm tay chờ người dùng) |
| `X2a-rooms` | Chat user↔user: DM 1-1 + nhóm, RLS theo thành viên, `/me/stream` (Redis Streams), chưa đọc/đã đọc, `GET /directory`, UI phòng (HUB-FR-96…100, 102; HUB-BR-22; AC-H23–H25; CHAT-AC-37…45; X2a-R01…R24, X2a-AC01…AC16) · `spec-isolation.md` (realtime, ma trận cách ly, rủi ro), `spec-decisions.md` (quyết định + kết quả I2), `plan*.md` (BE/DB/FE, `plan-decisions.md`, `plan-frontend-tasks.md`), `test-plan*.md`, `review-*.md`, `tasks.md` | X2a | done (2026-10-08; I2 kiểm tay chờ người dùng — [`manual-test-I2.md`](specs/X2a-rooms/manual-test-I2.md)) |
| `X2b-room-agents` | Agent trong phòng: `@agent`/`@orchestrator` trong DM/nhóm, quyền + quota người gọi, menu `@` (HUB-FR-101, 103; HUB-BR-21; AC-H26, H27; CHAT-AC-46…50; X2b-R01…R20, X2b-AC01…AC16) · `spec-decisions.md` (Luật 2 + tranh chấp test), `plan*.md`, `test-plan*.md`, `review-*.md` · done (2026-10-08); đính kèm tách X2b-2 |
| `X2b2-room-attachments` | Đính kèm file trong phòng: gắn file vào tin phòng, thành viên xem/tải, agent tag chỉ thấy file của phòng (HUB-FR-44, 101; HUB-BR-21, 22; X2b2-R01…R22, X2b2-AC01…AC16) · `tasks.md`, `readiness.md`, `spec-decisions.md` (mặc định readiness lần 1) · `evidence/2026-10-13/REPORT.md` (UAT) · done (2026-10-13) |
| `P-process-engine` | Process Engine (Quy trình động): stage + gate duyệt, hỏi lại + nhờ người khác, "Chờ tôi kiểm", DM hệ thống "Quy trình", menu `!`, `/runs/:id` + token, nhóm agent; mốc spike/P-a/P-b/P-c (HUB-FR-104…119; HUB-BR-23…28; AC-H28…H35; CHAT-AC-51…58; ADM-FR-65…67; CR-056…058) · `tasks.md` (P-a chi tiết), `readiness.md` · mockup https://claude.ai/artifact/JHGS9iTLVyytdYwXJJ6eLW | P | P-a done (2026-10-11); P-b/P-c chưa |
| `P-b-sources` | P-b · Nguồn tham chiếu chỉ đọc (CR-060): `sources`, ghim phiên bản, snapshot lọc ở Runtime, MANIFEST + `## Nguồn tham chiếu`, đầu vào quy trình + `!key`, câu hỏi bắt buộc; gộp sửa lỗi team-stage TECH-DEBT #133/#134 (HUB-FR-120…125; WRK-FR-27; ADM-FR-68/69; HUB-BR-29…31; AC-H36/H37) · `spec.md` (§9 D1–D11 đã chốt) | P | **done** 2026-10-12 (Gate [`P-b-sources-gate.md`](specs/P-b-sources-gate.md); `done:pb` 16/16, "Kết luận P-b" cuối spec) |
| `P-b2-canvas` | P-b2 · Canvas quy trình (`@xyflow/react`) + bước song song + quay lại ≤ 3 vòng + `## Bàn giao`/resume (HUB-FR-104/106/113/118/136; HUB-BR-38; ADM-FR-71; CHAT-AC-59/60; CR-063/064) · `spec.md` (§9 Q1–Q8 + Gate), `spec-decisions.md` (Gate người dùng G-1…G-7 + mặc định readiness), `plan.md`, `plan-frontend.md` (+ `-i18n`), `tasks.md`, `tasks-frontend.md`, `test-plan.md` (+ `test-plan-cases.md`), `readiness.md` · mockup https://claude.ai/artifact/WN9JVza1m4XA57LKQrtTDY (Part B) | P | **done** 2026-10-13 ("Kết luận P-b2" trong `spec.md`) |
| `H4b1-secrets` | H4b-1 · Secrets của Hub chỉ ghi, AES-256-GCM `HUB_SECRETS_KEY`: `provider_api_key`, `source_credential` (CR-060), `kh_api_key` (ADR-0012 §1) (HUB-FR-68, 69; HUB-BR-30; AC-H4b1-01…08) · `spec.md`, `plan.md`, `plan-frontend.md`, `test-plan.md`, `tasks.md`, `readiness.md` | H4b-1 | done (2026-10-13) — UAT evolu Đạt |
| `H4b2-models` | H4b-2 · Models (provider, profile, `provider_state`, Kiểm tra key) + Quyền agent (entitlement agent × tenant) (HUB-FR-66, 67, 78, 77; HUB-BR-17; AC-H04, AC-H4b2-01…06) · `spec.md` `done` (kết luận cuối spec), `plan*.md`, `test-plan.md`, `tasks.md`, `evidence/2026-10-13/REPORT.md` |
| `K1-knowledgehub` | K1 · KnowledgeHub làm RAG ngoài (Hub proxy `/v1/{ns}`, ns = tenant) + quy trình mẫu AISDLC (HUB-FR-131…134, 137; HUB-BR-35…37, 40; CR-062/067/068/070) · `spec.md` `done`, `plan.md`, `plan-frontend.md`, `tasks.md`, `test-plan.md`, `readiness.md`, `spec-decisions.md`, `research-ai-sdlc.md`; Gate: [`specs/K1-gate.md`](specs/K1-gate.md) (ADR-0012 Accepted) |
| `P-c-autofix` | P-c · Luồng tự-sửa (CR-061/065): P-c1 diff-only — workspace ghi-được (bản sao snapshot) + exec trong container + kiểm diff Runtime + duyệt diff (HUB-FR-119, 126…128, 130; HUB-BR-32/33; WRK-FR-28/29); P-c2 xem `P-c2-pr` · `spec.md` + `spec-decisions.md` (§5–6 nhật ký, tranh chấp đã phân xử) + `spec-log-build.md` (Runtime/vá review) + `plan*.md` + `test-plan.md` + `tasks.md` + `evidence/` | P | done (2026-10-14) — P-c1 XONG (UAT vòng 2 Đạt); P-c2 chưa làm |
| `P-c2-pr` | P-c2 · Áp bản sửa: push nhánh `ai/<run>/<stage>` + PR bằng `source_credential`, `apply_mode` pr/auto_merge/branch_only, rebase, repo riêng, chỉ GitHub (HUB-FR-129, HUB-BR-34, WRK-FR-29) · `spec.md` + `spec-decisions.md` + `plan*.md` + `test-plan.md` + `tasks.md` + `readiness.md` | P | BUILD + D1 xong (2026-10-15); chờ D2 review, D3 UAT, S1 smoke GitHub thật |
| `DOC-model` · `DOC-deals` · `DOC-legal` · `DOC-ui-list` · `DOC-ui-frame` · `K4-reopen-version` · `REP-v3` · `REP-v3-ui` · `MS-impact` | CR-101 (BA Sổ Hợp Tác v2.0): 3 loại chứng từ, Giao dịch hợp nhất, cảnh báo pháp lý, danh sách gộp, mở lại/phiên bản, uy tín V2-E lần hai, tác động mốc thật — mỗi lát một `specs/<lát>/tasks.md`; Intake `intake/2026-10-27-sht-ba.md` |
| `FB1-filebox-attachments` | FB1 · Driver lưu đính kèm FileBox cho H2c + X2b-2 (v1 CORE-ONLY: org chung, `file_id`, `/content` inline + `/link` 302, key env `FILEBOX_TOKEN`, egress pin cert; hoãn secret-store/dispatcher/sweeper DELETE/UI) (HUB-FR-44, HUB-BR-29/30, HUB-FR-68/69) · `spec.md` + `spec-decisions.md` + `plan.md` + `plan-frontend.md` + `test-plan.md` + `spec-appendix.md` + `tasks.md` + `readiness.md` | FB | approved (Gate duyệt 2026-10-15, `specs/FB1-gate.md`) — đang BUILD qua mock; HS1 chờ người dùng |
| `P-d-durable` | P-d · Engine quy trình chạy bền (GĐ1 platform, ADR-0017): P-d1 thử lại theo loại lỗi, bảng hẹn giờ + `wait_until`, nhắc lặp + chuyển cấp, `ttl_days`; P-d2 stage `tool` (MCP) + rẽ nhánh (HUB-FR-143…147; HUB-BR-41…43; ADM-FR-72, 73; AC-H39…H47; AC-A14, A15; CR-083…087) · `spec.md` (chung + P-d1), `spec-d2.md` (P-d2), `spec-tz-tools.md` (múi giờ tenant + công tắc tool theo tenant, Admin), `spec-ca.md` (đặt code mới theo bốn lớp, tách file cũ khi chạm — ADR-0023, CR-090), `ket-luan-pd2.md` (kết luận P-d2), `spec-ac.md` (AC + test khoá bị ảnh hưởng), `spec-decisions.md` (D1–D15, A1–A12, Q1–Q7, B1–B7, trả lời readiness lần 1–2), `plan.md` + `plan-contract.md`, `plan-db.md`, `plan-domain.md`, `plan-d2.md`, `plan-addendum.md` (A1–A7, thay một phần plan-contract §6, plan-domain §4.6/§7, plan-d2 §4), `plan-frontend.md` + `plan-frontend-d2.md`, `plan-frontend-i18n.md`, `mockup/01–04`, `test-plan.md` + `test-plan-rules.md`, `test-plan-int.md`, `test-plan-d2.md`, `test-plan-e2e.md`, `test-plan-addendum.md`, `tasks.md`, `readiness.md`, `ket-luan-pd1.md` (đóng P-d1) | GĐ1 | draft (2026-10-17) — readiness lần 2 NOT READY, mục (a) đã áp; chờ readiness lần 3. Gate P-d1 cần ADR-0017 Accepted: người dùng chọn **chờ staging** (Redis thật + tải 10.000 run) |
| `N1-pack-frame` | N1 · Khung gói dùng chung (CR-094): schema riêng mỗi gói + RLS + FK kép tenant, role gói NOBYPASSRLS, migration gói, catalog mã quyền gói (owner/editor/viewer), FileBox `org` theo tenant, DOCX → text, outbox chỉ mục, module gói trong `hub-api` bốn lớp, không HTTP nội bộ trên đường nóng (PK-FR-01…10, PK-BR-01, PK-NFR-01…05) · `spec.md`, `spec-decisions.md` (D-01…D-03), `tasks.md` | GĐ1 | draft (2026-10-18) — chờ plan BE |
| `HD1-contracts-base` | HD1 · Nền dữ liệu hợp đồng trên N1: `contracts`, `contract_items`, `contract_categories`, `contract_reminders`, `contract_events`; API danh sách/lọc/chi tiết/sửa trường/tải lên; perf 10.000 HĐ/tenant p95 ≤ 50 ms (HD-FR-01…08, HD-BR-01…03, HD-NFR-01…04) · `spec.md`, `spec-decisions.md`, `tasks.md` | GĐ1 | draft (2026-10-18) — chờ plan BE (sau N1 T1) |
| `X1-combine` | Combine Chat + Admin + Hub + Studio, đóng M5, seed Dify thật (ADM-FR-21, 23, 37; HUB-FR liên quan; X1-R01…R16, X1-AC01…AC20) · `tasks.md`, `spec-decisions.md` (Kết luận X1), `plan-frontend-copy.md`, `readiness.md` | X1 | done (2026-10-07) |
