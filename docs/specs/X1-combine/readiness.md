# Readiness · X1-combine

## Lần 1 — 2026-10-07 — NOT READY (1 Chặn, 4 Cao, 2 Trung, 4 Thấp); đã áp mặc định toàn bộ, chờ lần 2

Điều phối chốt 2026-10-07 (readiness lần 1): mọi mục áp mặc định đề xuất.

| # | Mức | Mục | Đã áp |
|---|---|---|---|
| 1 | Chặn | AC16: 5 workflow (gồm `dify-chatbot` agent), 5 secret `DIFY_KEY_*`, 4 command | test-plan AC16 |
| 2 | Cao | Endpoint Test: `POST /admin/commands/test`, `run_as_user_id`, `ms` | spec §3, tasks F4, plan-frontend D8 |
| 3 | Cao | Rủi ro B4, F4, F5, F6, ST1 = `cao` | tasks |
| 4 | Cao | Câu chữ VI/EN Test panel + hộp xác nhận side_effect | `plan-frontend-copy.md`, plan-frontend §2.2 |
| 5 | Cao | ST1 bật Dify mock (:5001); S7 tạo `mock-send` qua Admin | plan §6, spec §7, tasks ST1/D1 |
| 6 | Trung | Ghi plan K5–K7 vào spec §10; sửa §4, §6, Q2, Q4 | spec |
| 7 | Trung | `combine.rules.ts`: `buildCombineEnv`, `stopOrder` | plan §6, test-plan AC19, tasks ST1 |
| 8 | Thấp | Xoá "Cần bổ sung" sót (AC03, AC06, AC16, AC19) | test-plan |
| 9 | Thấp | Tên file theo §1.1b; kiểu `state` của `applyDelta` | plan-frontend |
| 10 | Thấp | effective-access khi chạy với tư cách user: không làm ở X1 | plan §8 |
| 11 | Thấp | spec §8 `done:x1` trỏ test-plan §5 | spec |

## Lần 2 — 2026-10-07 — NOT READY (1 Cao, 2 Thấp); 11 mục lần 1 đã khép
| # | Mức | Việc | Đã áp |
|---|---|---|---|
| 1 | Cao | Kiểu `ProcName`/`base`/`opts.mock`; thứ tự bật; AC19 | `plan-stack.md` (tách plan §6): `ProcName`, `START_ORDER`, chữ ký; 2b sau 2 |
| 2 | Thấp | plan-frontend §5 BL1 lệch | "Đã chốt: plan §8 BL1" |
| 3 | Thấp | plan.md sát trần | Tách §6 → `plan-stack.md` |

## Lần 3 — 2026-10-07 — NOT READY (1 Cao, 2 Thấp); 3 mục lần 2 đã khép
| # | Mức | Việc | Đã áp |
|---|---|---|---|
| 1 | Cao | Env/`started` nối với `startHubDev()` | plan-stack "Nối với `startHubDev`" |
| 2 | Thấp | AC19 dify-mock không đòi 200 | test-plan AC19 |
| 3 | Thấp | Thiếu mục Lần 2 | Thêm mục Lần 2 |
