# U1 · Uy tín theo BA (CR-097 đợt 2 · CR-097a) — làn đầy đủ

> **CR-101b (2026-10-27) — ĐẢO LẦN HAI:** uy tín quay lại BA v2.0 §5.1 (V2-E bật lại, HD8 chỉ đọc, sao + Loại việc + chốt tháng trở lại, bỏ chỉnh tay ±10, giữ cờ đỏ U2) — xem [`REP-v3`](../REP-v3/tasks.md). Các mục "410 / V2-E chỉ đọc / bỏ sao" dưới đây hết hiệu lực khi REP-v3 bật. Lịch sử giữ nguyên.

Nguồn: `docs/intake/2026-10-23-ba-hop-dong-doi-tac.md` R33–R38, R40, R41, R43, X6; HD8 spec. Không migration (U2 thêm 0052).

## Plan
Điểm hiện hành = engine HD8 (`scoring*.rules.ts`, 2 vai, 80/60, ×2 trong 3 tháng, ±10, min_events→null). Tính khi đọc từ sổ
`partner_events` ⇒ mọi sự kiện đối tác (giao, trả, nhắc, hẹn, khiếu nại, chỉnh tay) tự vào điểm; 3 câu đọc cố định mỗi lô
(HD8-NFR-01, không đổi, perf test HD8 giữ nguyên). V2-E (`rep-*`, `/reputation`, `score_ratings`, `score_locks`) đóng băng, chỉ đọc.

## Việc
- [x] `PUT /scoring/:role` bật lại (quản lý lưu ⇒ version+1, lịch sử, ảnh chụp điểm); tiêu chí tự chấm ⇒ 422 (R41).
- [x] `PUT /partners/ratings` giữ 410 `SCORING_READ_ONLY` (R41, không ô sao/chấm tay); đọc ratings cũ vẫn chạy.
- [x] `/reputation` ghi (ratings, jobs, config cells/settings/job-types) ⇒ 410 `REPUTATION_READ_ONLY` sau guard 403/400; GET giữ.
- [x] Vòng chốt tháng V2-E không chạy nền (`createRepLock` giữ cho test).
- [x] `supplierScores` (tab NCC & giá) và gợi ý đối tác: lấy điểm HD8; vai bên trả hoa hồng tính như Khách (Q3); điểm null ⇒ `new`.
- [x] Test: unit `scoring-ba.rules.test.ts` (bảng R34–R38, R43; xanh); int HD8 `scoring` (AC02/AC03 viết lại) + `agg-parity`
  dựng lại; int V2-E đổi sang chỉ đọc — **viết, chưa chạy** (Luật 0b). Cần qc relock `tests/.lock`.

## Quyết định trong lúc làm
- Bỏ sao = chấm tay HD8 cũng đóng (R41); chỉnh tay ±10 vẫn qua sổ (HD7 `ledger`), không đổi.
- Sao đã nhập (`score_ratings`) giữ nguyên, không còn tính vào điểm.
- Không thêm cột/migration; "MỚI · tạm tính" (`provisional`) và cờ đỏ để U2.

## Còn lại cho lát sau
- U2: `provisional` + `no_delivery`/`fraud` (0052) trong engine/`partners` DTO.
- U3: UI Đối tác + Cấu hình chuyển sang `/partners`, `/scoring/:role` (đang gọi `/reputation/*` ghi ⇒ 410); e2e `v2i-partners`,
  `v2l-settings`, `overview` (khối đối tác); todo "Đánh giá đối tác" (`todo.repo.ts` đọc `score_ratings`) nên bỏ.
