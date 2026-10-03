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
| Chat & Extension | — | `design/chat-app/ui-chat-extension.md` · use case C1 `design/chat-app/usecases-chat.md` (UC-01…08, CHAT-AC) · canvas `design/chat-app/canvas/` (5 artboard, xem README) |
| Design đã duyệt (Gate M0) | Canvas: https://claude.ai/artifact/FTSiKuF9ax5DkMBVKMdHDB · bản sao nguồn `design/canvas/` | 18 artboard Admin · token `design/canvas/tokens-map.md` |

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
| `../apps/admin-web/README.md`, `../apps/admin-web/src/features/{auth,shell,tenants,users,secrets,workflows,commands,features}/README.md` | App web và feature: FR, file vào, bẫy |
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
| `C1-chat-ui` | Chat UI (`apps/chat-web`) + contract Chat↔Hub + mock Hub chat + bộ test contract dùng chung (flow, Consultant; CR-018…022) | C1 | draft (2026-10-03, chờ plan BE ∥ FE) |
| `H1-hub-core` | Hub lõi `apps/hub-api` (JWT, hội thoại/flow/SSE, Orchestrator, `AgentRunner`) + Agent Runtime Python tối thiểu (`claude-sub`, sandbox, queue) + schema `hub` + contract zod→pydantic; Hub thật pass test contract chat (HUB-FR-01–03, 20–29, 40–45, 74–77, 83, 86, 88–90; WRK-FR-01–05, 10–15, 17, 20, 23–25) | H1 | draft (2026-10-04, chờ plan BE ∥ Python) |
