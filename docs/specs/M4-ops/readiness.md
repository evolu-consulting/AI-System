# Readiness · M4-ops

## Lần 1 · 2026-10-03 · NOT READY
- Kết quả: **5 Chặn, 10 Cao, 11 Trung bình, 13 Thấp** (39 mục). Mọi mục có mặc định đề xuất.
- Người dùng (2026-10-03): chấp nhận toàn bộ mặc định (spec §9 Q0–Q13, plan-cd Q-D1, Q-C2) + 3 câu trả lời: **Q7** khôi phục chỉ command/workflow/feature/group/quota, chỉ `platform_admin`; **Q10** admin tắt 2FA hộ **giữ phiên** (không thu hồi); **D4** mật khẩu đúng chưa qua TOTP không reset bộ đếm. ADR-0005 Accepted.
- Đã áp:
  - backend-lead (spec, plan, plan-contract, plan-rules, plan-cd, tasks): #1, 2, 6, 7, 8, 9, 10 (plan-rules), 11 (phần contract: không thêm trường, TECH-DEBT #30), 14, 15, 16, 17, 18, 20, 21, 23, 25, 26, 27, 28, 30, 33, 34, 35, 39.
  - frontend-lead (`plan-frontend.md`): #11, 12, 13, 19, 22, 24, 29, 31, 37.
  - qc (`test-plan*.md`): #3, 4, 5, 32, 36, 38 + ca theo quyết định backend (#10 R15: `input_schema` chứa `password` **không** ném; #2 PUT no-op; #6 evaluate không await; #14 `run_id` NULL; #20 Enable không tính bộ đếm; #21 import quota null → `SCHEMA`; #23 pct tenant = max).
- Bước kế: chạy lại spec-readiness (lần 2).

## Lần 2 · 2026-10-03 · NOT READY
0 Chặn, 4 Cao, 3 Trung bình, 13 Thấp · mọi mục có mặc định, không câu hỏi người dùng · đã áp cả 20. Từ nay mỗi lần lưu bảng.

| # | Mức | Vị trí | Việc đã làm |
|---|---|---|---|
| 1 | — | test-plan R20 | Chỉ kiểm 3 mã A+B bằng `toMatchObject`; đếm 48 chuyển `rules/contracts-cd.test.ts` (xanh T7) |
| 2 | — | tasks T1c | Ghi đỏ dự kiến K1–K4 tới T9a, file khác phải xanh |
| 3 | — | test-plan AL5 | Gửi lại bằng `NOTIFY quota_threshold {tenant_id}` |
| 4 | — | plan-frontend câu audit | Tách `totpOff` / `totpOffSelf` (actor_id = entity_id) |
| 5 | — | plan-frontend audit.entity | Liệt kê 12 `AUDIT_ENTITIES`, ánh xạ `user_totp`→`twofa`, `config`→`config`, trong `lib/audit-sentence.ts` |
| 6 | — | plan-frontend câu audit | `audit.sentence.import` thay `config` |
| 7 | — | tasks T0b, T7 | Sửa `common.test.ts` lên 39 / 48 mã, union status thêm 413 |
| 8 | — | plan-cd §11 | Bảng task thay bằng trỏ `tasks.md` |
| 9 | — | plan-frontend §12 | Bảng task thay bằng trỏ `tasks.md` |
| 10 | — | plan-frontend §5, plan-cd §4.2 | Regex mã dự phòng cùng `BACKUP_ALPHABET` `[2-9a-hjkmnp-z]` |
| 11 | — | test-plan ghi chú | "(Q10)"→"(readiness lần 1 #2)"; "plan §6"→"plan §7" |
| 12 | — | test-plan | Xoá "Cần bổ sung", trỏ `plan-rules §A1` |
| 13 | — | plan §4.2 audit.rules | Ca khoá cấm cấp 1 = assert phòng thủ, không test |
| 14 | — | test-plan "Xanh" | Thêm rules/contracts T0b; quotas.rules T3; usage.rules T5; audit-snapshot T1; audit.rules T2 |
| 15 | — | tasks FE0a, FE3 | Thêm `e2e/conflict-users e2e/conflict-tenants`; `e2e/auth` |
| 16 | — | tasks Q2 | Cột Đọc liệt kê 5 file test-plan |
| 17 | — | plan-frontend §3, §5 | Bỏ câu điều kiện thừa; `top_users`, `restorable` luôn có |
| 18 | — | spec, ADR-0005 | Xoá câu về bỏ/giữ `recharts` ở Gate |
| 19 | — | test-plan-cd | "không sửa vì 2FA; A+B sửa K10" |
| 20 | — | readiness.md | Bảng này |

## Lần 3 · 2026-10-03 · NOT READY → đã áp (điều phối)
3 Cao, 3 Thấp; mọi mục có mặc định, không câu hỏi người dùng.

| # | Mức | Vị trí | Đã làm |
|---|---|---|---|
| 1 | Cao | test-plan R20/K5/§tổng ↔ test-plan-cd D-K04/§9 | Đếm 48 `API_ERRORS` duy nhất ở D-K04 (`contracts-cd`, T7); sửa mọi câu trỏ |
| 2 | Cao | tasks T7 ↔ test-plan-cd D-K01…03 | D-K01…03 tách sang `rules/contracts-totp.test.ts` (xanh T9d, thêm vào lệnh xong T9d); `contracts-cd` giữ C-K01…03 + D-K04 |
| 3 | Cao | plan-frontend `audit.sentence.import` | Nguyên văn ms:522 VI/EN |
| 4 | Thấp | plan-cd D9, spec §7, plan-frontend D1 | "bỏ `recharts` (ADR-0005)", 151 KB gzip |
| 5 | Thấp | plan-frontend §7 lọc Loại | 11 mục (ms:489 + Entitlement, 2FA; không `config`); nhãn `config` "Cấu hình"/"Configuration" |
| 6 | Thấp | spec.md 25 486/25 600 B | Ghi nhận: lần sửa spec tới chuyển §9 sang `spec-decisions.md` |
