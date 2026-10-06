# Gate H4a — Studio: khung app, đăng nhập, Agents, Orchestrator

Ngày: 2026-10-06 · Trạng thái: **ĐÃ DUYỆT 2026-10-06 — Tự duyệt theo Luật 2b** · Readiness: READY (`H4a-studio-shell-agents/readiness.md`, 2 lần; còn N3–N6 mức Trung/Thấp)

**Vì sao tự duyệt:** spec-readiness lần 2 READY, 17/18 lỗ hổng lần 1 đã đóng (L3 → N6, áp ở I3 theo CR-045). Người dùng đã chốt U1–U4 ngày 2026-10-06: U1 chấp nhận mọi mặc định Q1–Q9, QB2–QB7, QF1–QF3, G1–G13; U2 chỉ `agentic-cli` làm Orchestrator; U3 cho F1 chỉ THÊM export `./studio-locales` + nhánh `studio/` vào `i18n-check.ts`; U4 chấp nhận reverse proxy `/auth` ở prod. Không câu hỏi mới, không ADR, không thư viện mới, không hard stop. Thứ tự mốc: người dùng chọn H4 trước H3c (H3c vẫn tạm dừng).

## 1. Phạm vi (`H4a-studio-shell-agents/spec.md`)
- App mới `apps/studio-web` (Rsbuild + React + Tailwind + shadcn, base `/studio`, dev cổng 3200); Hub serve build qua `HUB_STUDIO_DIST`.
- Chỉ `platform_admin` (kể cả bước TOTP); role khác → trang không có quyền.
- `/studio/api` trong `apps/hub-api/modules/studio`: `me`; agents (list ≤ 200 + `truncated`, tạo, sửa, bật/tắt, xoá có điều kiện — có lịch sử chỉ Tắt); Orchestrator mặc định + theo tenant (chỉ `agentic-cli`, `ORCHESTRATOR_RUNTIMES`); đọc agent-types/model-profiles/providers (không secret)/workflows/tenants.
- Mọi ghi: một transaction `withConfigWrite` (khoá `config_meta` → hàng đích → `version` → ghi → bump `hub_config_version` → audit → NOTIFY).
- Không làm: Models/Secrets/entitlement (H4b), Tools/Dry-run/bộ câu kiểm thử/Playground (H4c), Nhật ký/Import-Export/Đơn giá (H4d), H3c.

## 2. Dữ liệu / contract
- Migration `0010_h4a_studio.sql`: GRANT ghi `agents`, `agent_workflows`, `orchestrator_settings` cho `hub_rw`; `agents.profile_id` NULL được (CHECK với `llm`/`agentic-cli`); `audit_log.tenant_id` NULL được (cấu hình toàn hệ thống); index `runs`/`run_steps` theo `agent_id`. Không bảng mới, không đổi dữ liệu cũ.
- Contract mới `@ai/contracts/studio` + `STUDIO_ERRORS`. Chat/Admin contract không đổi.
- File chung (U3): chỉ thêm export `packages/i18n/package.json` + nhánh `i18n-check.ts`.

## 3. Test (`test-plan.md`)
154 ca: unit luật thuần + contract 44, int 91 (6 file), e2e studio 19. Đỏ đúng lý do (route/module/app chưa có); 3 ca xanh sẵn (A64, A70, A72). Phủ 7/7 FR MUST.

## 4. Rủi ro
- R-K2: kiểm lịch sử agent phải chạy scope system (ca A45).
- R-K3: chạy lại `hub:seed` đè thay đổi từ Studio không audit → PRODUCTION-NOTES ở I3.
- Đăng xuất Studio đăng xuất luôn Admin cùng host (cookie `ai_rt` chung).
- Prod cần reverse proxy `/auth` (U4) → PRODUCTION-NOTES ở I3; CR-044 cho phiên Admin.
- Còn mở (sửa trong BUILD): N3 frontend-lead thêm 4 nhãn e2e vào plan-frontend §6; N4 qc sửa test-plan §4 Q10 → đã chốt (U3); N5 spec §3 `Me` theo `MeSchema`; N6 ui §13 ở I3. N1, N2, N7 điều phối đã sửa khi ghi Gate.

## 5. Thứ tự BUILD
Theo `H4a-studio-shell-agents/tasks.md`: qc LOCK → B1 ∥ B2 ∥ F1 → B3 → B4 → B5 ∥ B6 ; F2 (sau B3) → F3 (sau B4) → F4 → F5 ∥ F6 (sau B6) → I1 `done:h4a` → review ≤ 2 vòng → I2 kiểm tay → I3 docs. Trên `main`, không push.
