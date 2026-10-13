# Readiness — H4b1-secrets

## Lần 1 · 2026-10-13 · spec-readiness · **NOT READY** (0 Chặn, 3 Cao, 15 Thấp)

Phạm vi: spec, plan, plan-frontend, tasks, test-plan. Không có câu hỏi mới cho người dùng; mọi mặc định dưới đây đã được chấp nhận (Luật 2b) và **đã áp trong commit `docs(h4b-1): áp mặc định readiness lần 1`**.

| # | Mức | Vấn đề → cách xử lý đã áp | Nơi sửa |
|---|---|---|---|
| 1 | Cao | E04 đòi 0 `textbox "Tên"` ⇒ Sheet thay hiện tên bằng chữ thường (`<p>`/`<dd>`), không input | plan-frontend D7, §3 Sheet |
| 2 | Cao | Hub boot fatal ở `test:int` cũ vì thiếu biến ⇒ `keys:dev` thêm `HUB_SECRETS_KEY` vào mọi `.env.test-*.local` thiếu (không ghi đè); Lệnh xong T5a thêm `keys:dev` + hồi quy `test:int` | plan §0/§4, tasks T5a |
| 3 | Cao | `.env.production.example` + cảnh báo mất khoá + PRODUCTION-NOTES thuộc T5a | plan file list, tasks T5a, PRODUCTION-NOTES |
| 7 | Thấp | "Toàn nền tảng" ⇒ bỏ hẳn khoá `tenant_id` | plan-frontend D6 |
| 8 | Thấp | Sau lưu footer chỉ [Đóng]; ô Giá trị/Tên khoá tới khi đóng | plan-frontend D9, §3 |
| 9 | Thấp | `q` ILIKE escape `\ % _` | plan §4 list |
| 10 | Thấp | `updated_by` JOIN `admin.users.username`, không có ⇒ null | spec §3, plan |
| 11 | Thấp | Giữ D8; nếu A44/A45 thấy `admin.*` bị lọc ⇒ `withHubScope(system)` riêng + ghi quyết định | plan D8 |
| 12 | Thấp | Lệnh xong T4 dùng `bun --env-file=.env.local --config=bunfig.int.toml test …hub-h4b1.int.test.ts` | tasks T4 |
| 13 | Thấp | Spec §8 trỏ `bun run done:h4b1` | spec §8 |
| 14 | Thấp | `status: plan`, bỏ câu "chỉ khung" | spec frontmatter, mở đầu |
| 15 | Thấp | Spec §1: 3 tab; tạo chỉ provider + kh | spec §1 |
| 16 | Thấp | test-plan G4, G5 đánh dấu đã đóng | test-plan §8 |
| 17 | Thấp | "Secret không khôi phục từ audit" (HUB-FR-69) | spec §2 |
| 18 | Thấp | 2 việc chuyển sang K1 (`usedByMany` + `knowledge_hub`; `work/<job_id>/`) | K1 spec §7/§8 (K1-AC09) |
| BA | Thấp | HUB-BR-15 (secret theo tenant), HUB-FR-68 + ui-agent-studio (3 loại secret) | ba-agent-hub, ui-agent-studio |

Kết luận sau khi áp: chưa chạy lại spec-readiness (T3 chạy lần 2, sau khi qc xong E14/badge/Phạm vi tenant ở test-plan §7).

## Lần 2 · 2026-10-13 · spec-readiness · **NOT READY** (0 Chặn, 6 Cao, 5 Thấp)

Không có câu hỏi mới; mặc định đã chấp nhận (Luật 2b) và đã áp trong commit `docs(h4b-1): áp mặc định readiness lần 2`. qc sửa e2e cho #4, #5.

| # | Xử lý đã áp | Nơi sửa |
|---|---|---|
| 1 | T5a Lệnh xong: chỉ chấp nhận đỏ ở `tests/acceptance/H4b1/*.int.test.ts` trừ `boot.int.test.ts` (A110–A115 phải xanh) | tasks T5a |
| 2 | Sau lưu `Giá trị`/`Tên` dùng `disabled`, còn trong DOM, value rỗng | plan-frontend D9 |
| 3 | `showCloseButton={!saved}` | plan-frontend D10 |
| 4 | e2e đóng Sheet trước khi kiểm dòng bảng/toast; không đổi `modal` (qc sửa) | plan-frontend ghi chú |
| 5 | Ghi đè xác nhận hai bước như H4a | plan-frontend D8 |
| 6 | Option `Phạm vi` = `tenant.name` | plan-frontend §5 |
| 7-11 | Spec §5 "Tenant (tab nguồn, KnowledgeHub)"; §2 AAD trỏ Q2; test-plan dòng 3; Q7 K1 chỉ khoá tenant; D9 `Phạm vi` disabled sau lưu | spec, test-plan, plan-frontend |

## Lần 3 — 2026-10-13 · NOT READY (0 Chặn, 4 Cao, 3 Thấp) · không câu hỏi mới
- Mặc định đã áp (điều phối): D4 `form.reset()` chỉ `onSuccess`/đóng Sheet, mutation `gcTime: 0` + `mutation.reset()` + unit test MutationCache không còn `value` (#2, #3); bỏ `bun test tests/acceptance/H4b1` khỏi Lệnh xong T5a (#4); Xoá 204 → đóng ConfirmDialog + toast + invalidate (#5); [Ghi đè] thành công áp D9 (#6).
- qc: E07 bấm "Đóng" trong `alertdialog` rồi mới kiểm dòng (#1); E09 `toContainText("Acme Corp")` (#7).

## Lần 4 — 2026-10-13 · **READY** (0 Chặn, 0 Cao, 4 Thấp) · không câu hỏi mới
- Thấp đã áp: mọi phản hồi DELETE đóng ConfirmDialog trước (#1); `mutation.reset()` trong `onSettled` (#2); `saved` là state cục bộ (#3); đường dẫn unit test MutationCache + `bun test apps/studio-web/src/features/secrets` vào Lệnh xong T6 (#4).
