# INDEX — bản đồ tài liệu

Đọc file này trước, rồi mở **đúng một** thứ cần. Không đọc cả `docs/design/` khi chỉ cần một feature.

## Luật & quy trình
| File | Dùng khi |
|---|---|
| `../CLAUDE.md` | Luật làm việc (nạp mỗi phiên) |
| `WORKFLOW.md` | Vòng một mốc, đội agent, Gate, khoá test |
| `CONVENTIONS.md` | Chuẩn code, cấu trúc, giới hạn, format |
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
| `adr/` | Architecture Decision Records (`0001-stack.md`…) |
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
| `X2b2-room-attachments` | Đính kèm file trong phòng: gắn file vào tin phòng, thành viên xem/tải, agent tag chỉ thấy file của phòng (HUB-FR-44, 101; HUB-BR-21, 22; X2b2-R01…R22, X2b2-AC01…AC16) · `tasks.md`, `readiness.md`, `spec-decisions.md` (mặc định readiness lần 1) · draft (2026-10-12) |
| `P-process-engine` | Process Engine (Quy trình động): stage + gate duyệt, hỏi lại + nhờ người khác, "Chờ tôi kiểm", DM hệ thống "Quy trình", menu `!`, `/runs/:id` + token, nhóm agent; mốc spike/P-a/P-b/P-c (HUB-FR-104…119; HUB-BR-23…28; AC-H28…H35; CHAT-AC-51…58; ADM-FR-65…67; CR-056…058) · `tasks.md` (P-a chi tiết), `readiness.md` · mockup https://claude.ai/artifact/JHGS9iTLVyytdYwXJJ6eLW | P | P-a done (2026-10-11); P-b/P-c chưa |
| `P-b-sources` | P-b · Nguồn tham chiếu chỉ đọc (CR-060): `sources`, ghim phiên bản, snapshot lọc ở Runtime, MANIFEST + `## Nguồn tham chiếu`, đầu vào quy trình + `!key`, câu hỏi bắt buộc; gộp sửa lỗi team-stage TECH-DEBT #133/#134 (HUB-FR-120…125; WRK-FR-27; ADM-FR-68/69; HUB-BR-29…31; AC-H36/H37) · `spec.md` (§9 D1–D11 đã chốt) | P | **done** 2026-10-12 (Gate [`P-b-sources-gate.md`](specs/P-b-sources-gate.md); `done:pb` 16/16, "Kết luận P-b" cuối spec) |
| `P-b2-canvas` | P-b2 · Canvas quy trình (`@xyflow/react`) + bước song song + quay lại ≤ 3 vòng + `## Bàn giao`/resume (HUB-FR-104/106/113/118/136; HUB-BR-38; ADM-FR-71; CHAT-AC-59/60; CR-063/064) · `spec.md` (§9 Q1–Q8 + Gate), `spec-decisions.md` (Gate người dùng G-1…G-7 + mặc định readiness), `plan.md`, `plan-frontend.md` (+ `-i18n`), `tasks.md`, `tasks-frontend.md`, `test-plan.md` (+ `test-plan-cases.md`), `readiness.md` · mockup https://claude.ai/artifact/WN9JVza1m4XA57LKQrtTDY (Part B) | P | Gate người dùng duyệt 2026-10-12 (ADR-0013 Accepted); chờ T2 (qc) + readiness lần 2 |
| `P-c-autofix` | P-c · Luồng tự-sửa (CR-061): workspace ghi-được + exec trong container + PR sau duyệt (HUB-FR-119, 126…130; HUB-BR-32…34; WRK-FR-28) · `spec.md` **chỉ khung** (§9 8 quyết định, §10 điểm mở) | P | draft — chưa tới BUILD; chặn bởi H4b + ADR-0011 |
| `X1-combine` | Combine Chat + Admin + Hub + Studio, đóng M5, seed Dify thật (ADM-FR-21, 23, 37; HUB-FR liên quan; X1-R01…R16, X1-AC01…AC20) · `tasks.md`, `spec-decisions.md` (Kết luận X1), `plan-frontend-copy.md`, `readiness.md` | X1 | done (2026-10-07) |
