# Tasks · P-process-engine

Mỗi task: một commit `[FR]`, diff ≈ ≤ 400 dòng. Tick khi lệnh "xong" xanh. `blocked` kèm lý do → báo cáo cuối. **Khung do docs-architect** (2026-10-09); backend-lead/frontend-lead chốt task chi tiết ở PLAN và điền lại cột `Đọc`/`File`. P-a chi tiết; spike, P-b, P-c chỉ khung.

## Spike P (trước P-a)
| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| S1 | Nhóm agent BA thật trên `claude-sub`: so 3 chế độ (trưởng nhóm lập kế hoạch / tuần tự / MCP lai), đo token, thời gian, số lần gọi, chất lượng output theo template; đề xuất chế độ mặc định + giới hạn | backend-lead | thường | spec §1, §2.1, §9 Q4/Q6/Q7; BA-H §6.10 FR-114–116 | `docs/specs/P-process-engine/spike.md` | X2b-2 xong | báo cáo ≤ 1 trang bảng số | [ ] |

## P-a
| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| P1 | PLAN BE: contract (chat chỉ thêm + `hub-admin` quy trình), migration bảng §4, máy trạng thái run/stage, review_tasks + grant người ngoài phòng, tài khoản hệ thống "Quy trình", giới hạn §2.1, token (M1–M6 chốt hoặc hỏi) | backend-lead | cao | spec §1–4, §9, §10; BA-H §6.10, §8, §9; X2b plan §1–§8 | `plan.md` | S1 | plan ≤ 30 KB | [ ] |
| P2 | PLAN FE: chat-web (⑥ menu `!`, ④ thẻ run + flow pane, ⑤ Chờ tôi kiểm + DM + `/runs/:id`, ⑦ AskCard + nhờ người khác, ⑧ token), admin-web (① ② tối thiểu, run + token), câu chữ VI/EN | frontend-lead | thường | spec §0, §5; usecases-chat UC-12; ui-admin §7.17; mockup board ①②④–⑧ | `plan-frontend.md` | P1 | plan-frontend ≤ 25 KB | [ ] |
| Q1 | test-plan: AC-H28…H34, CHAT-AC-51…58, ADM-FR-65–67; ma trận cách ly người ngoài phòng; `done:pa` | qc | cao | spec §2, §8; plan §…; plan-frontend §… | `test-plan.md` | P1, P2 | test-plan ghi | [ ] |
| R1 | spec-readiness → READY | spec-readiness | - | | `readiness.md` | Q1 | READY | [ ] |
| G | Gate (Luật 2b nếu chỉ dùng mặc định đã chấp nhận) | điều phối | - | | `docs/specs/P-a-gate.md` | R1 | gate ghi | [ ] |
| QC1 | Test khoá (int máy trạng thái, quyền, cách ly, giới hạn, token; e2e chat/admin); `test:lock:write` | qc | cao | test-plan | `tests/acceptance/P-a/**`, `e2e/**` | G | đỏ đúng lý do | [ ] |
| B1 | Migration bảng quy trình + RLS + `runs.process_run_id/stage_run_id` [HUB-FR-104, 106, BR-25] | backend-lead | cao | plan §… | `packages/db/**` | QC1 | int B1 | [ ] |
| B2 | Contract + mã lỗi (`PROCESS_NOT_FOUND`, `TOO_MANY_PROCESS_RUNS`, `FEEDBACK_REQUIRED`, `REVIEW_TASK_CLOSED`, `FORWARD_*`) + mock Hub [HUB-FR-105, 107, 111] | backend-lead | thường | plan §… | `packages/contracts/**` | B1 | `bun test` contracts | [ ] |
| B3 | `process_defs` CRUD (tenant_admin, `withConfigWrite`) + 2 mẫu seed + chép mẫu [HUB-FR-104, ADM-FR-65] | backend-lead | cao | plan §… | `apps/hub-api/src/modules/processes/**` | B2 | int B3 | [ ] |
| B4 | Bắt đầu run: `!key` (phòng + Hỏi AI), `POST /process-runs`, chốt phiên bản, giới hạn đồng thời [HUB-FR-105, BR-27, 28] | backend-lead | cao | plan §… | ″ | B3 | int B4 | [ ] |
| B5 | Stage runner: job/team-run (nhóm seed), kiểm template, kiểm lại quyền mỗi stage, giới hạn + "Cần người quyết", ngân sách token [HUB-FR-106, 114, 115, 116, BR-23, 24, 26] | backend-lead | cao | plan §… | ″ + `apps/agent-runtime/**` (nếu cần) | B4 | int B5 | [ ] |
| B6 | Gate duyệt + Hành động thật + hỏi lại + nhờ người khác + `review_tasks` API [HUB-FR-107, 109, 110, 111] | backend-lead | cao | plan §… | ″ | B5 | int B6 | [ ] |
| B7 | Báo việc: `/me/review-tasks`, DM hệ thống "Quy trình", sự kiện `/me/stream`, grant người ngoài phòng + audit xem [HUB-FR-112, 113, BR-25] | backend-lead | cao | plan §…; X2a spec-isolation | ″ + `modules/rooms/**` | B6 | int B7 | [ ] |
| B8 | Token: `GET /process-runs/:id/usage` (run/stage/team-run/lần gọi) [HUB-FR-117] + seed dev + `done-pa.ts` | backend-lead | thường | plan §… | ″, `tools/scripts/src/done-pa.ts` | B7 | int B8 | [ ] |
| F1 | chat-web: menu `!` + nút "▶ Quy trình" (⑥) [CHAT-AC-51] | frontend-lead | thường | plan-frontend §… | `apps/chat-web/src/features/{composer,processes}/**` | B2 | `bun test` composer | [ ] |
| F2 | chat-web: thẻ run trong phòng + flow pane duyệt (④) [CHAT-AC-52, 53] | frontend-lead | cao | plan-frontend §… | `features/{rooms,processes}/**` | F1, B6 | `bun test` processes | [ ] |
| F3 | chat-web: "Chờ tôi kiểm" + DM "Quy trình" + `/runs/:id` có giới hạn xem (⑤) [CHAT-AC-54–56] | frontend-lead | cao | plan-frontend §… | `features/{shell,processes,rooms}/**` | F2, B7 | `bun test` processes | [ ] |
| F4 | chat-web: AskCard + "Nhờ người khác trả lời" (⑦) + bảng token (⑧) [CHAT-AC-57, 58] | frontend-lead | thường | plan-frontend §… | `features/{answer,processes}/**` | F3, B8 | `bun test` processes | [ ] |
| F5 | admin-web: nav "Quy trình" (cả tenant_admin), danh sách + mẫu (①), editor tối thiểu (②), run + token [ADM-FR-65–67] | frontend-lead | thường | ui-admin §7.17; plan-frontend §… | `apps/admin-web/src/features/processes/**` | B3, B8 | `bun test` processes · e2e admin | [ ] |
| F6 | Đóng FE: README, TECH-DEBT, a11y, `check:bundle`, e2e P-a | frontend-lead | thường | plan-frontend §… | README features | F1–F5 | `bunx playwright test P-a` | [ ] |
| RV1 | Review vòng 1 + **security review** (cách ly người ngoài phòng, grant task, quota người bắt đầu) | reviewer + security | cao | spec §10 K1 | `review-1.md`, `review-security-1.md` | B8, F6 | APPROVED + security đạt | [ ] |
| RV2 | Review vòng 2 (nếu cần), `done:pa`, UAT `qc-uat` | reviewer + qc + qc-uat | cao | review-1 | evidence | RV1 | `bun run done:pa` | [ ] |

## P-b (khung — sau H4b)
| # | Task | Agent | Rủi ro | Phụ thuộc | Trạng thái |
|---|---|---|---|---|---|
| Pb1 | Editor quy trình đầy đủ ①② (luật tự duyệt HUB-FR-108, tự quay lại HUB-FR-118) | BE + FE | cao | P-a | [ ] |
| Pb2 | Agent Forge "Nhóm agent" ③: CRUD, thành viên, giới hạn, bật cho công ty (`platform_admin`) [HUB-FR-114, AC-H35] | BE + FE | cao | P-a, kết quả spike | [ ] |
| Pb3 | Tab Usage nhóm + tổng theo kỳ ở Evolu Control [HUB-FR-117 vế nhóm] | BE + FE | thường | Pb2 | [ ] |

## P-c (khung — cần H4b Secrets)
| # | Task | Agent | Rủi ro | Phụ thuộc | Trạng thái |
|---|---|---|---|---|---|
| Pc1 | Workspace code chung + PR thật cho SDLC [HUB-FR-119] | BE | cao | H4b, P-b | [ ] |
