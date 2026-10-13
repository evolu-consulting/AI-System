# Readiness · P-c-autofix (P-c1)

## Lần 1 · 2026-10-13 · NOT READY (17 lỗ hổng)
Đầu vào: spec/plan/plan-frontend/tasks/test-plan tại `c1bde551`. Áp xong 2026-10-14 (backend-lead, commit `docs(pc): áp readiness lần 1`).

| # | Mức | Lỗ hổng | Trả lời / mặc định áp | Nơi sửa |
|---|---|---|---|---|
| 1 | Chặn | Quyền đọc file diff/log qua `/attachments/:id/content` (luật X2b2 chỉ cho chủ/phòng ⇒ người duyệt/admin 404) | **Người dùng trả lời 2026-10-13: "Mở theo quyền xem run"** — file của `autofix_results` đọc được khi `runAccess(viewer, run) ≠ null` (gồm `task`); `platform_admin` dùng `tenant_id` như `/process-runs/:id/outputs`; file khác giữ luật cũ. Task B5 (cao) | spec PC-R14, §3; plan §2 (index), §6.6; tasks B5 |
| 2 | Cao | spec §8 trống ("chờ qc") | Trỏ test-plan §3–§7 + `done:pc` | spec §8 |
| 3 | Cao | Thứ tự xử lý kết quả job mơ hồ (token / container / timeout) | Ngân sách token P-a trước (F12); `container` ⇒ `sandbox_unavailable`; lỗi job khác/thiếu báo cáo ⇒ `autofix_check_failed` (H05) | spec PC-R10; plan §1 bước 9, §4, §6.3, Edge; ADR #3 |
| 4 | Cao | `RunFile` không có ở chat contracts | `AutofixFileSchema = {id, name, mime, size}` strict | spec §3; plan §3.4; tasks B1 |
| 5 | Cao | Env chưa có mặc định; ADR tmpfs 512 ≠ plan 256 | Bảng env spec §7; TMP 256 (sửa ADR); `.env.example` vào R1 | spec §7; plan §5.10; ADR #3; tasks R1 |
| 6 | Cao | FE dùng `fetchAttachmentBlob` không tồn tại | chat `fetchAttachmentContent` (`attachments/api.ts:20`); admin thêm `fetchAttachmentContent` ở `features/processes/api.ts` kèm `tenant_id` | plan-frontend FC4, §1.2, §2; tasks F1 |
| 7 | Thường | Đường dẫn e2e sai trong tasks F4 | `bunx playwright test -c e2e/P-c/playwright.pc.config.ts` | tasks F4 |
| 8 | Thường | Lệnh xong R1/R2 chạy cả thư mục (đỏ vì phần sau) | R1/R2 chỉ `tests/acceptance/pc/test_pc_rules.py`; R3 cả thư mục | tasks R1–R3 |
| 9 | Thường | Diff/log có tính hạn mức file tenant? | Không tính | spec PC-R16; plan §6.2 |
| 10 | Thường | ADR `ws_edit{old,new}` ≠ plan | `old_string/new_string` như plan §5.5 | ADR "Cơ chế tool" |
| 11 | Cao | Mã lỗi `use_current` cho `autofix_*` | 409 `PROCESS_RUN_STATE`, run giữ `needs_decision` | spec PC-R10, §3; plan §3.4, §6.6 |
| 12 | Cao | Ai quyết `autofix_*` | Người bắt đầu hoặc admin (`canDecide`; không vào `REVIEW_GROUP_REASONS`) | spec PC-R10; plan §4, §6.6 |
| 13 | Thường | Lệnh xong B4/B5 chung chung | Chép lệnh int test-plan §7 bước 3 theo file | tasks B4, B5 (+ B6 `defs`) |
| 14 | Thường | Dockerfile chưa ghim | Node 22 LTS, bun = `packageManager` gốc, `bookworm-slim` ghim digest | plan §5.10; ADR #5; tasks R4 |
| 15 | Thường | Seed `fixbug-apply` chưa có nguyên văn | Đường dẫn `apps/hub-api/seed/processes.yaml` + prompt agent/instruction/launcher nguyên văn; thêm template `fixbug-evolu` (V08 đòi) | plan §6.1; spec §4; tasks B6 |
| 16 | Thường | BA lệch Q2/Q3/B2 (HUB-FR-126, HUB-BR-32/33, WRK-FR-28) | Task D3: docs-architect đồng bộ BA | tasks D3 |
| 17 | Thường | Chữ "chờ Q1/Q4", "chờ qc"; ADR còn Proposed | Dọn; ADR-0011 **Accepted** (người dùng duyệt Q4/Q6/Q7 2026-10-13); spec `draft` → chờ readiness lần 2 | spec, plan, spec-decisions, ADR-0011 |

Test khoá: #1 (T01/T02 dùng `/attachments/:id/content`, A + người duyệt 200, beta 404), #4 (C15/C16 `diff_file: null`, F04 dùng `.id/.name`), #11 (F06 kiểm `≥ 400` + giữ `needs_decision`) **khớp sẵn — không cần qc sửa**. V08 đòi template `fixbug-evolu` đã seed ⇒ thêm vào B6 (không đổi test).

Kế tiếp: chạy lại spec-readiness (lần 2).

## Lần 2 · 2026-10-14 · NOT READY (10 lỗ hổng, không Chặn) — đã áp
| # | Lỗ hổng | Mặc định áp | Nơi sửa |
|---|---|---|---|
| 1 | `decisionOptionsFor` trùng tên hàm core `task.rules.ts:60` | Hàm riêng `autofixDecisionOptions(reason)`; core trả sớm khi `autofix_*`, giữ chỗ gọi | plan §4, §6.5; tasks B5, T3b (H06 đổi tên) |
| 2 | PC-R16 mơ hồ | Không gọi kiểm hạn mức; `quotaUsed` không đổi; qc thêm 1 ca | spec PC-R16; plan §6.2; tasks T3b |
| 3 | Kích thước spec/plan sát trần | Giữ dưới trần | spec, plan |
| 4 | `canCancel` vs `canDecide` | Thống nhất `canDecide` | spec PC-R10 |
| 5 | plan §6.4 lặp prompt | Trỏ §6.1 | plan §6.4 |
| 6 | Thiếu chữ ký `basePatchOf` | Thêm; `apply_patch` gần nhất ⇒ `null` | plan §4 |
| 7 | Nhãn FE lệch | "Thêm 1 lần làm lại / Huỷ lượt chạy" | plan-frontend §1.3 |
| 8 | Câu điều kiện Q5 sót | Xoá | spec §1, §7 |
| 9 | Quyền đọc attachment gộp B5 | Tách B5b (cao, Opus) | tasks B5, B5b |
| 10 | Thứ tự PC-R15/PC-R16 | Đổi | spec §2 |
+ ADR-0011 #3: thêm `du` sau pha cài (plan §5.2).

Kế tiếp: T3b (qc mở khoá có chủ đích), rồi readiness lần 3.
