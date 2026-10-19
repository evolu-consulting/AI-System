# HD4 · tasks

| # | Task | Làn | Trạng thái |
|---|---|---|---|
| T1 | spec + plan ngắn | đầy đủ | [x] |
| T2 | readiness 1 vòng (`readiness.md`) | đầy đủ | [x] |
| T3 | Test trước: role `contracts_job`, vòng nhắc (idempotent, múi giờ, 2 tenant), perf lô 100 | đầy đủ | [x] |
| T4 | Migration 0003 (remind_at, trigger, `contracts_job`) | đầy đủ | [x] |
| T5 | Domain `deadline.rules.ts` + unit | đầy đủ | [x] |
| T6 | Vòng nhắc (repo claim/apply, use case drain, mount + loop) | đầy đủ | [x] |
| T7 | API `POST /handled` + contract zod + int | đầy đủ | [x] |
| T8 | UI `DeadlinePanel` trên S05 + unit + e2e | nhanh | [x] |
| T9 | Cổng lát `test:affected` + perf thật | — | [~] perf chưa đạt ca xấu nhất (xem dưới) |

## Tranh chấp test
- HD1 khoá "19 ListRow keys" (`tests/acceptance/HD1/columns.int.test.ts`) kỳ vọng `action_deadline = null`; HD4-FR-01 (trigger DB) nay tính `end_date − notice_days` cho mọi HĐ ⇒ đỏ. **ĐÃ XỬ:** người dùng chốt 2026-10-19 sửa test khoá theo hành vi HD4 (`action_deadline = end_date − notice_days`); HD5 sửa + relock, HD4 không đụng test khoá.
## Kết quả cổng lát (2026-10-19, máy dev Windows, 3 lát khác chạy song song, CPU 80–100 %)
- Int HD4 (job-role, remind, handled) + HD1/HD2/N1 + RLS suite chạy riêng: 498 pass / 3 fail — 3 ca không thuộc HD4: `approval_settings_audit` chưa khai RLS (HD3 chưa commit), HD1 PATCH version/event (patch-fields HD3 đang sửa, chưa commit).
- `test:affected --base=f4af4b7a`: migration đổi ⇒ kéo gần hết bộ; typecheck ✓; typecheck:tests: 2 lỗi kiểu HD4 đã sửa; lock: chỉ UNLOCKED file test mới HD4 (chờ qc ghi lock); check/unit/int/e2e đỏ ở phần lát khác + timeout do tải (2 lượt int chồng nhau). e2e contracts-web: `hd4-deadline` 2/2, S05 so mgmt-app 3/3 xanh.
- Perf HD4-NFR-01 (10.000 HĐ tới hạn, mọi HĐ đổi trạng thái + gửi nhắc trong cùng lô = ca xấu nhất): 5 câu/lô, 0 Seq Scan. p95 lô 100: 129,6 ms (bản đầu) → 61,1 ms (trigger WHEN + nhớ atLocal) → 67,4 ms sau ANALYZE / 108,0 ms trước ANALYZE (bảng lịch, máy tải nặng). Lô không đổi trạng thái (thường ngày): 25–29 ms. **Chưa đạt 50 ms ở ca xấu nhất**: UPDATE 100 hàng `contracts` (đổi trạng thái) tính lại mọi cột sinh HD1 (~18–20 ms/lô). Cần đo lại trên máy yên / staging.