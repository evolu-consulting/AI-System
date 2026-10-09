# Tasks · P-process-engine

Mỗi task: một commit `[FR]`, diff ≈ ≤ 400 dòng. Tick khi lệnh "xong" xanh. `blocked` kèm lý do → báo cáo cuối. **Khung do docs-architect** (2026-10-09); backend-lead/frontend-lead chốt task chi tiết ở PLAN và điền lại cột `Đọc`/`File`. P-a chi tiết; spike, P-b, P-c chỉ khung.

## Spike P (trước P-a)
| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| S1 | Nhóm agent BA thật trên `claude-sub`: so 3 chế độ (trưởng nhóm lập kế hoạch / tuần tự / MCP lai), đo token, thời gian, số lần gọi, chất lượng output theo template; đề xuất chế độ mặc định + giới hạn | backend-lead | thường | spec §1, §2.1, §9 Q4/Q6/Q7; BA-H §6.10 FR-114–116 | `docs/specs/P-process-engine/spike.md` | — (người dùng 2026-10-10: làm trước X2b-2) | báo cáo ≤ 1 trang bảng số | [x] |

## P-a

Làm theo `docs/WORKFLOW.md` "Làm song song nhiều session" (CR-059): **Bước 0** tuần tự trên `main` → **PF1–PF4** song song, mỗi feature một worktree + nhánh → merge lần lượt → **Đóng** trên `main`. Mã task cũ (B…, F…) giữ để truy vết; F1–F6 là task frontend, PF1–PF4 là feature. **Ranh giới file + điểm nóng Bước 0: [`plan.md`](plan.md) §8–§9** (backend-lead P1). Task cần sửa file ngoài cột `File` ⇒ dừng, báo session chính.

### Bước 0 — khung chung (một session; nhánh `feat/pa-step0` hoặc thẳng `main`; merge vào `main` trước khi tạo nhánh PF; B2 = 0a, B1/B0/B3 = 0b)
| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| P1 | PLAN BE: contract (chat chỉ thêm + `hub-admin` quy trình), migration bảng §4, máy trạng thái run/stage, review_tasks + grant người ngoài phòng, tài khoản hệ thống "Quy trình", giới hạn §2.1, token (M1–M6 chốt hoặc hỏi). **Ghi rõ ranh giới file của PF1–PF4** | backend-lead | cao | spec §1–4, §9, §10; BA-H §6.10, §8, §9; X2b plan §1–§8 | `plan.md` | S1 | plan ≤ 30 KB | [x] |
| P2 | PLAN FE: chat-web (⑥ menu `!`, ④ thẻ run + flow pane, ⑤ Chờ tôi kiểm + DM + `/runs/:id`, ⑦ AskCard + nhờ người khác, ⑧ token), admin-web (① ② tối thiểu, run + token), câu chữ VI/EN; thư mục theo feature | frontend-lead | thường | spec §0, §5; usecases-chat UC-12; ui-admin §7.17; mockup board ①②④–⑧ | `plan-frontend.md` | P1 | plan-frontend ≤ 25 KB | [ ] |
| Q1 | test-plan: AC-H28…H34, CHAT-AC-51…58, ADM-FR-65–67 **chia theo PF1–PF4**; ma trận cách ly người ngoài phòng; `done:pa` | qc | cao | spec §2, §8, §9 (Câu hỏi C1–C5); plan §3–§5, §8–§9; plan-contract §3–§9; plan-frontend | `test-plan.md` | P1, P2 | test-plan ghi | [ ] |
| R1 | spec-readiness → READY (kiểm cả luật chạm nhau giữa các PF, vd ai được bấm gì) | spec-readiness | - | | `readiness.md` | Q1 | READY | [ ] |
| G | Gate (Luật 2b nếu chỉ dùng mặc định đã chấp nhận) | điều phối | - | | `docs/specs/P-a-gate.md` | R1 | gate ghi | [ ] |
| QC1 | Test khoá theo PF (`tests/acceptance/P-a/pf1…pf4/**`, `e2e/P-a/pf1…pf4`); `test:lock:write` | qc | cao | test-plan | `tests/acceptance/P-a/**`, `e2e/**` | G | đỏ đúng lý do | [ ] |
| B1 | 0b · Migration `0019_pa_process_engine.sql` (11 bảng mới + cột null `runs`/`conversations`/`room_messages` + RLS + definer `is_process_trigger`/`process_run_viewer` + CHECK audit) + schema Drizzle [HUB-FR-104, 106, BR-25] | backend-lead | cao | plan §2, §10; X2b plan §4 (mẫu); `migrations-hub/0011`, `0014` | `packages/db/migrations-hub/0019_*.sql`, `meta/_journal.json`, `src/schema/hub-processes.ts`, `hub.ts`, `hub-rooms.ts`, `README.md` | QC1 | int B1 (migrate 2 lần, RLS tenant) | [ ] |
| B2 | 0a · Contract chat + hub-admin + mã lỗi + sự kiện `/me/stream` + fixture/mock cả 4 PF [HUB-FR-105, 107, 111, 112, 117] | backend-lead | thường | plan-contract §1–§6; plan §8 hàng 0a | `packages/contracts/src/chat/{processes,processes-errors,me-stream-process,index,rooms}.ts`, `hub-admin/{processes,index}.ts`, `tools/mocks/src/chat/processes/**` | B1 | `bun test packages/contracts` | [ ] |
| B0 | 0b · Khung `modules/processes/` (core có luật thuần dùng chung, ports, repo lõi; stub mỗi PF) + điểm nóng (app.ts mount + prefix, env cờ `HUB_PROCESS_ENGINE`, `create-run`/`runs.repo` cột process + preconfirm, `RunService.prepareProcess`, lọc C1 `process_run_id`, hook `!` ở sendMessage + `MessagesService.useProcesses`, `user-stream` + `parseFields`); FE: thư mục/route/nav rỗng + i18n `process` | backend-lead + frontend-lead | cao | plan §1 D1–D3, D15, §7, §8, §9; plan-contract §7 (core); plan-frontend | `apps/hub-api/src/modules/processes/{README.md,processes.mount.ts,core/**}` + stub PF; `app.ts`, `config/env.ts`, `runs/{create-run,runs.repo,runs.service,runs.routes}.ts`, `conversations/conversations.repo.ts`, `rooms/messages/messages.service.ts`, `rooms/room-messages.routes.ts`, `me-stream/user-stream-reader.ts`, `lib/user-stream.ts`; khung FE | B2 | check + typecheck + test xanh; test khoá H2b/X2a/X2b xanh (cờ off) | [ ] |
| B3 | 0c · `process_defs` CRUD + chép mẫu + run từ admin (qua `ProcessStartPort`), `GET /agent-teams`; seed 2 mẫu + nhóm `ba-team` + 4 agent BA + bản `hoa-don` cho tenant dev [HUB-FR-104, 114, ADM-FR-65] | backend-lead | cao | plan §2.1 (`process_defs`, `agent_teams*`), D17, §8 hàng 0c; plan-contract §6; `studio/studio-write.ts`; seed README | `modules/processes/defs/**`, `modules/seed/{seed.processes,seed,seed.schema}.ts`, `apps/hub-api/seed/{processes,agents}.yaml` | B0 | int B3 | [ ] |

### PF1 — Chạy quy trình + cổng kiểm trong phòng · nhánh `feat/pa-pf1-run-gate`
| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| B4 | Bắt đầu run: `!key` phòng + Hỏi AI + `POST /process-runs`, `GET /processes`, chốt snapshot, hội thoại nền, ≤ 5 run/tenant; `GET /process-runs` (mine/tenant) [HUB-FR-105, BR-27, 28] | backend-lead | cao | plan D1, D3, D13–D14, §3.1, §4 hàng 1, §7, §10; plan-contract §3 (PF1) | `processes/runs/{start.service,room-start,conversation-start,runs.repo,runs.routes}.ts` | B3 | int B4 | [ ] |
| B5 | Stage runner: `launcher` (kick + kiểm lại quyền mỗi stage), `stage-driver` (agent), `team-runner` (sequential/lead_plan/parallel_merge, ghép mục, tóm tắt 200 token), kiểm template, giới hạn + "Cần người quyết", ngân sách token, vòng quét queued/đối chiếu/hết hạn; `GET /process-runs/:id` + `/outputs/:oid` (full/task + audit view) [HUB-FR-106, 113, 114, 115, 116, BR-23–26] | backend-lead | cao | plan D1–D11, §3.2–3.3, §4, §5, §10; plan-contract §2, §7 (template/team); spike.md Khuyến nghị | `processes/runs/{launcher,stage-driver,team-runner,team.rules,template.rules,view.service,sweeps}.ts` | B4 | int B5 | [ ] |
| B6a | Cổng kiểm Đạt/Chưa đạt + góp ý + làm lại chọn lọc + Hành động thật (preconfirm) + `cancel`/`decide` [HUB-FR-107, 109, 115] | backend-lead | cao | plan D4, D8, §3.1, §3.4, §10; plan-contract §3 (decision/cancel/decide), §7 (gates) | `processes/gates/**` | B5 | int B6a | [ ] |
| F1 | chat-web: menu `!` + nút "▶ Quy trình" (⑥) [CHAT-AC-51] | frontend-lead | thường | plan-frontend; plan-contract §3 (`GET /processes`, `POST /process-runs`), §4 | `chat-web/features/processes/composer*` | B0 | `bun test` | [ ] |
| F2 | chat-web: thẻ run trong phòng + flow pane duyệt (④) [CHAT-AC-52, 53] | frontend-lead | cao | plan-frontend; plan-contract §2 `ProcessRunView`, §3, §5 | `chat-web/features/processes/run-block*` | F1 | `bun test` + e2e pf1 | [ ] |

### PF2 — Agent hỏi lại + nhờ người khác trả lời · nhánh `feat/pa-pf2-ask`
| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| B6b | Hỏi lại (need_input → task ask, gộp câu hỏi nhóm, ≤ 3/stage, "Chờ trả lời", job kết thúc), trả lời (đầu thắng ⇒ `kick`), nhờ người khác (≤ 3, cùng Group với review) [HUB-FR-110, 111] | backend-lead | cao | plan §3.2–3.4, §4, §10; plan-contract §3 (answer/forward), §7 (`forwardCheck`, `askExcerpt`, `mergeQuestions`) | `processes/asks/**` | B0 (fixture run `waiting_answer`, `kick` giả) | int B6b | [ ] |
| F4a | chat-web: AskCard + "Nhờ người khác trả lời" (⑦) [CHAT-AC-57] | frontend-lead | thường | plan-frontend; plan-contract §2 `TaskDetail`, §3 answer/forward, §4 | `chat-web/features/processes/ask*` | B0 | `bun test` + e2e pf2 | [ ] |

### PF3 — Người kiểm / người trả lời ngoài phòng · nhánh `feat/pa-pf3-outside`
| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| B7 | Báo việc: `ProcessNotifier` (notice + `review_task.*` + `process.notice`), `/me/review-tasks`, `/me/process-inbox*`, nhắc sau 1 ngày [HUB-FR-112, BR-25] | backend-lead | cao | plan D12, §4 hàng nhắc, §5, §11; plan-contract §3 (PF3), §5, §7 (notify) | `processes/notify/**` | B0 (fixture review_tasks) | int B7 | [ ] |
| F3 | chat-web: "Chờ tôi kiểm" + DM "Quy trình" + `/runs/:id` có giới hạn xem (⑤) [CHAT-AC-54–56] | frontend-lead | cao | plan-frontend; plan D12; plan-contract §2 (`access: task`), §3, §5 | `chat-web/features/processes/inbox*`, `run-page*` | B0 | `bun test` + e2e pf3 | [ ] |

### PF4 — Token + Evolu Control · nhánh `feat/pa-pf4-usage-admin`
| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| B8 | Token: `GET /process-runs/:id/usage` (run/stage/team-run/lần gọi; `summary` cho người xem task) + seed usage dev [HUB-FR-116, 117] | backend-lead | cao | plan §6, §11; plan-contract §2 (`ProcessRunUsage`), §7 (`buildUsage`) | `processes/usage/**` | B0 (fixture usage) | int B8 (khớp Σ usage_logs) | [ ] |
| F4b | chat-web: tab Token trang `/runs/:id` (⑧) [CHAT-AC-58] | frontend-lead | thường | plan-frontend; plan-contract §2 `ProcessRunUsage` | `chat-web/features/processes/usage*` | B0 | `bun test` + e2e pf4 | [ ] |
| F5 | admin-web: nav "Quy trình" (cả tenant_admin), danh sách + mẫu (①), editor tối thiểu (②), run + token [ADM-FR-65–67] | frontend-lead | thường | plan-frontend; plan-contract §6, §3 (`scope=tenant`, usage) | `admin-web/src/features/processes/**` | B3 | `bun test` + e2e admin pf4 | [ ] |

**Chia session (gợi ý):** S-A làm PF1 · S-B làm PF3 rồi PF2 · S-C làm PF4. PF2–PF4 bắt đầu ngay sau Bước 0, dựa trên fixture/mock của B2; dữ liệu thật đến khi PF1 vào `main`. **Thứ tự merge:** PF1 → PF3 → PF2 → PF4 (sau mỗi lần merge các nhánh còn lại rebase). Đủ nhánh → qc chạy e2e feature trên `main`.

### Đóng (trên `main`, sau khi đủ PF1–PF4)
| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| F6 | Đóng FE: README, TECH-DEBT, a11y, `check:bundle`, bật cờ `process_engine` cho dev, e2e P-a đủ | frontend-lead | thường | plan-frontend | README features | PF1–PF4 merge | `bunx playwright test P-a` | [ ] |
| RV1 | Review vòng 1 + **security review** (cách ly người ngoài phòng, grant task, quota người bắt đầu) | reviewer + security | cao | spec §10 K1; plan §5, §10; plan-contract §8 | `review-1.md`, `review-security-1.md` | F6 | APPROVED + security đạt | [ ] |
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
