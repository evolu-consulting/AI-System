# Demo sdlc qua engine thật (2026-10-11)

Quy trình `sdlc` (bản acme, 8 stage) chạy qua engine THẬT (`HUB_PROCESS_ENGINE=on`) + runtime `fake-cli`. Mục đích: chứng minh engine, cổng kiểm người thật và cross-stage handoff. Tag: HUB-FR-106, HUB-FR-115.

## Thứ tự ảnh
1. `01-lan-run-start.png` — lan bắt đầu run.
2. `02-lan-intake-waiting-review.png` — Intake (agent) xong, chờ review.
3. `03-hoa-review-card.png` — hoa (nhóm ke-toan) thấy thẻ duyệt.
4. `04-hoa-after-dat.png` — hoa bấm "Đạt".
5. `05-lan-spec-done.png` — Spec (agent) done.
6. `06-lan-plan-running.png` — PLAN (team) đang chạy.

## Bug đã sửa
Blob output stage không ghi vào kho ⇒ stage kế fetch 404. Fix `d0ff044a` + `e0c82bd3`, test `473ecc93` (OUTBLOB-1/2).

## Bug còn lại (stage nhóm, P-b) — xem `docs/TECH-DEBT.md`
- #133: member thứ 2 của team fetch attachment ⇒ 401 (không có trong `payload.attachments`).
- #134: ghi lỗi job team vi phạm `runs_error_code_ck` ⇒ handler crash, run kẹt `running`.
