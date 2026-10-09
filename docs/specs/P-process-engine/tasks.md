# Tasks · P-process-engine

Mỗi task: một commit `[FR]`, diff ≈ ≤ 400 dòng. Tick khi lệnh "xong" xanh. `blocked` kèm lý do → báo cáo cuối. **Khung do docs-architect** (2026-10-09); backend-lead/frontend-lead chốt task chi tiết ở PLAN và điền lại cột `Đọc`/`File`. P-a chi tiết; spike, P-b, P-c chỉ khung.

## Spike P (trước P-a)
| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| S1 | Nhóm agent BA thật trên `claude-sub`: so 3 chế độ (trưởng nhóm lập kế hoạch / tuần tự / MCP lai), đo token, thời gian, số lần gọi, chất lượng output theo template; đề xuất chế độ mặc định + giới hạn | backend-lead | thường | spec §1, §2.1, §9 Q4/Q6/Q7; BA-H §6.10 FR-114–116 | `docs/specs/P-process-engine/spike.md` | — (người dùng 2026-10-10: làm trước X2b-2) | báo cáo ≤ 1 trang bảng số | [ ] |

## P-a

Làm theo `docs/WORKFLOW.md` "Làm song song nhiều session" (CR-059): **Bước 0** tuần tự trên `main` → **PF1–PF4** song song, mỗi feature một worktree + nhánh → merge lần lượt → **Đóng** trên `main`. Mã task cũ (B…, F…) giữ để truy vết; F1–F6 là task frontend, PF1–PF4 là feature.

### Bước 0 — khung chung (một session; nhánh `feat/pa-step0` hoặc thẳng `main`; merge vào `main` trước khi tạo nhánh PF; B2 = 0a, B1/B0/B3 = 0b)
| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| P1 | PLAN BE: contract (chat chỉ thêm + `hub-admin` quy trình), migration bảng §4, máy trạng thái run/stage, review_tasks + grant người ngoài phòng, tài khoản hệ thống "Quy trình", giới hạn §2.1, token (M1–M6 chốt hoặc hỏi). **Ghi rõ ranh giới file của PF1–PF4** | backend-lead | cao | spec §1–4, §9, §10; BA-H §6.10, §8, §9; X2b plan §1–§8 | `plan.md` | S1 | plan ≤ 30 KB | [ ] |
| P2 | PLAN FE: chat-web (⑥ menu `!`, ④ thẻ run + flow pane, ⑤ Chờ tôi kiểm + DM + `/runs/:id`, ⑦ AskCard + nhờ người khác, ⑧ token), admin-web (① ② tối thiểu, run + token), câu chữ VI/EN; thư mục theo feature | frontend-lead | thường | spec §0, §5; usecases-chat UC-12; ui-admin §7.17; mockup board ①②④–⑧ | `plan-frontend.md` | P1 | plan-frontend ≤ 25 KB | [ ] |
| Q1 | test-plan: AC-H28…H34, CHAT-AC-51…58, ADM-FR-65–67 **chia theo PF1–PF4**; ma trận cách ly người ngoài phòng; `done:pa` | qc | cao | spec §2, §8; plan; plan-frontend | `test-plan.md` | P1, P2 | test-plan ghi | [ ] |
| R1 | spec-readiness → READY (kiểm cả luật chạm nhau giữa các PF, vd ai được bấm gì) | spec-readiness | - | | `readiness.md` | Q1 | READY | [ ] |
| G | Gate (Luật 2b nếu chỉ dùng mặc định đã chấp nhận) | điều phối | - | | `docs/specs/P-a-gate.md` | R1 | gate ghi | [ ] |
| QC1 | Test khoá theo PF (`tests/acceptance/P-a/pf1…pf4/**`, `e2e/P-a/pf1…pf4`); `test:lock:write` | qc | cao | test-plan | `tests/acceptance/P-a/**`, `e2e/**` | G | đỏ đúng lý do | [ ] |
| B1 | Migration bảng quy trình + RLS + `runs.process_run_id/stage_run_id` [HUB-FR-104, 106, BR-25] | backend-lead | cao | plan | `packages/db/**` | QC1 | int B1 | [ ] |
| B2 | Contract + mã lỗi (`PROCESS_NOT_FOUND`, `TOO_MANY_PROCESS_RUNS`, `FEEDBACK_REQUIRED`, `REVIEW_TASK_CLOSED`, `FORWARD_*`) + mock/fixture Hub cho cả 4 PF [HUB-FR-105, 107, 111] | backend-lead | thường | plan | `packages/contracts/**`, fixture | B1 | `bun test` contracts | [ ] |
| B0 | Khung: module `processes/` chia file theo PF (`runs`, `gates`, `asks`, `notify`, `usage`) có stub; sửa sẵn điểm nóng (orchestrator tắt passthrough cho nhóm, móc quyền trả lời ở room-run); chat-web/admin-web thư mục theo PF + route/nav rỗng; i18n namespace `process` riêng; cờ `process_engine` (tắt) | backend-lead + frontend-lead | cao | plan, plan-frontend | khung các app | B2 | check + typecheck + test xanh | [ ] |
| B3 | `process_defs` CRUD (tenant_admin, `withConfigWrite`) + 2 mẫu seed + chép mẫu [HUB-FR-104, ADM-FR-65] | backend-lead | cao | plan | `modules/processes/defs*` | B0 | int B3 | [ ] |

### PF1 — Chạy quy trình + cổng kiểm trong phòng · nhánh `feat/pa-pf1-run-gate`
| # | Task | Agent | Rủi ro | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|
| B4 | Bắt đầu run: `!key` (phòng + Hỏi AI), `POST /process-runs`, chốt phiên bản, giới hạn đồng thời [HUB-FR-105, BR-27, 28] | backend-lead | cao | `processes/runs*` | B3 | int B4 | [ ] |
| B5 | Stage runner: job/team-run (nhóm seed), kiểm template, kiểm lại quyền mỗi stage, giới hạn + "Cần người quyết", ngân sách token [HUB-FR-106, 114, 115, 116, BR-23, 24, 26] | backend-lead | cao | `processes/runs*`, `agent-runtime/**` (nếu cần) | B4 | int B5 | [ ] |
| B6a | Cổng kiểm Đạt / Chưa đạt + góp ý + làm lại + Hành động thật [HUB-FR-107, 109] | backend-lead | cao | `processes/gates*` | B5 | int B6a | [ ] |
| F1 | chat-web: menu `!` + nút "▶ Quy trình" (⑥) [CHAT-AC-51] | frontend-lead | thường | `chat-web/features/processes/composer*` | B0 | `bun test` | [ ] |
| F2 | chat-web: thẻ run trong phòng + flow pane duyệt (④) [CHAT-AC-52, 53] | frontend-lead | cao | `chat-web/features/processes/run-block*` | F1 | `bun test` + e2e pf1 | [ ] |

### PF2 — Agent hỏi lại + nhờ người khác trả lời · nhánh `feat/pa-pf2-ask`
| # | Task | Agent | Rủi ro | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|
| B6b | Hỏi lại (gộp câu hỏi nhóm, ≤ 3/stage, "Chờ trả lời"), nhờ người khác (chuyển ≤ 3, ai trả lời trước khoá) [HUB-FR-110, 111] | backend-lead | cao | `processes/asks*` | B0 (fixture run) | int B6b | [ ] |
| F4a | chat-web: AskCard + "Nhờ người khác trả lời" (⑦) [CHAT-AC-57] | frontend-lead | thường | `chat-web/features/processes/ask*` | B0 | `bun test` + e2e pf2 | [ ] |

### PF3 — Người kiểm / người trả lời ngoài phòng · nhánh `feat/pa-pf3-outside`
| # | Task | Agent | Rủi ro | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|
| B7 | Báo việc: `/me/review-tasks`, DM hệ thống "Quy trình", sự kiện `/me/stream`, grant người ngoài phòng + audit xem [HUB-FR-112, 113, BR-25] | backend-lead | cao | `processes/notify*` + điểm móc `rooms` (đã có từ B0) | B0 (fixture review_tasks) | int B7 | [ ] |
| F3 | chat-web: "Chờ tôi kiểm" + DM "Quy trình" + `/runs/:id` có giới hạn xem (⑤) [CHAT-AC-54–56] | frontend-lead | cao | `chat-web/features/processes/inbox*`, `run-page*` | B0 | `bun test` + e2e pf3 | [ ] |

### PF4 — Token + Evolu Control · nhánh `feat/pa-pf4-usage-admin`
| # | Task | Agent | Rủi ro | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|
| B8 | Token: `GET /process-runs/:id/usage` (run/stage/team-run/lần gọi) [HUB-FR-117] + seed dev | backend-lead | thường | `processes/usage*` | B0 (fixture usage) | int B8 | [ ] |
| F4b | chat-web: tab Token trang `/runs/:id` (⑧) [CHAT-AC-58] | frontend-lead | thường | `chat-web/features/processes/usage*` | B0 | `bun test` + e2e pf4 | [ ] |
| F5 | admin-web: nav "Quy trình" (cả tenant_admin), danh sách + mẫu (①), editor tối thiểu (②), run + token [ADM-FR-65–67] | frontend-lead | thường | `admin-web/src/features/processes/**` | B3 | `bun test` + e2e admin pf4 | [ ] |

**Chia session (gợi ý):** S-A làm PF1 · S-B làm PF3 rồi PF2 · S-C làm PF4. PF2–PF4 bắt đầu ngay sau Bước 0, dựa trên fixture/mock của B2; dữ liệu thật đến khi PF1 vào `main`. **Thứ tự merge:** PF1 → PF3 → PF2 → PF4 (sau mỗi lần merge các nhánh còn lại rebase). Đủ nhánh → qc chạy e2e feature trên `main`.

### Đóng (trên `main`, sau khi đủ PF1–PF4)
| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| F6 | Đóng FE: README, TECH-DEBT, a11y, `check:bundle`, bật cờ `process_engine` cho dev, e2e P-a đủ | frontend-lead | thường | plan-frontend | README features | PF1–PF4 merge | `bunx playwright test P-a` | [ ] |
| RV1 | Review vòng 1 + **security review** (cách ly người ngoài phòng, grant task, quota người bắt đầu) | reviewer + security | cao | spec §10 K1 | `review-1.md`, `review-security-1.md` | F6 | APPROVED + security đạt | [ ] |
| RV2 | Review vòng 2 (nếu cần), `done:pa`, UAT `qc-uat` | reviewer + qc + qc-uat | cao | review-1 | evidence | RV1 | `bun run done:pa` | [ ] |

### Ghi chú bàn giao các nhánh
(Mỗi nhánh thêm một mục khi xin merge — mẫu ở `docs/WORKFLOW.md` "Làm song song nhiều session" §5.)

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
