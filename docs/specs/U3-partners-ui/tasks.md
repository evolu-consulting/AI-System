# U3 · UI Đối tác + Cấu hình (CR-097 đợt 3 · CR-097a) — làn nhanh

> **CR-101b (2026-10-27) — ĐẢO MỘT PHẦN:** biểu đồ điểm, ô sao, bấm tiêu chí xem việc, Cài đặt 5 ô × 3 tab, TQ-04, nguồn "Đánh giá đối tác" quay lại — xem [`REP-v3-ui`](../REP-v3-ui/tasks.md). Các quyết định "bỏ biểu đồ V2-E", "bỏ Đánh giá đối tác", `ScoringPane` hai tab dưới đây hết hiệu lực khi REP-v3-ui xong. Lịch sử giữ nguyên.

Nguồn: intake `2026-10-23-ba-hop-dong-doi-tac.md` R44–R46, overview "đối tác cần xem lại"; việc U1/U2 để lại. Chỉ web + một mục backend (todo).

## Plan
- **Đọc:** danh sách/chi tiết/Tổng quan đọc engine HD8: `GET /partners?role=customer|supplier` (hai lần, gộp một dòng mỗi đối tác; cờ đỏ chỉ có ở
  danh sách theo vai) + `GET /partners/score` (bảng tiêu chí, lý do). Mọi chỗ ghi `/reputation/*` (410) bỏ; còn đọc `/reputation/mine` (dải "Uy tín của mình").
- **Huy hiệu:** TỐT/KHÁ/CHÚ Ý theo `band`; `provisional` ⇒ "MỚI · tạm tính" + `provisional_score`; 0 việc ⇒ "–". Cờ đỏ (`red_flags`: Không giao / Gian lận) tách khỏi điểm.
- **Cờ đỏ:** khối ở tab Tổng quan: "Báo cờ đỏ" (quyền ghi, lý do bắt buộc) = `POST /partner-events`; "Gỡ cờ" (chỉ `owner`, lý do bắt buộc) = `POST /partner-events/:id/void`.
- **Cấu hình:** Cài đặt › "Điểm uy tín" = `ScoringPane` (tab Khách hàng / Nhà cung cấp): bật/tắt + trọng số (tổng 100), mức Tốt/Khá, số việc tối thiểu, khoảng tính,
  hệ số gần đây, chỉnh tay ±10; xem trước "N đối tác đổi mức" (`/scoring/:role/preview`); Lưu = `PUT /scoring/:role` (version + lịch sử, hiện lịch sử). Lưu riêng từng vai, không theo nút Lưu chung.
- **Tổng quan:** "Đối tác cần xem lại" = có cờ đỏ (lên đầu) hoặc CHÚ Ý (BA không nói điểm thấp khác ⇒ chỉ band `watch`); "Giao dịch nhiều nhất" cũng đọc `/partners`.
- **Backend (mục 4):** bỏ việc "Đánh giá đối tác" (`rating`, `rating_quarter`) khỏi `todo.repo.ts` (không còn đọc `score_ratings`).

## Việc
- [x] `partners/api.ts`, hook `use-partner-scores`, lib thuần `partner-score.ts` (badge, cờ, gộp vai, cần xem lại, top, kiểm cách tính).
- [x] Danh sách (lọc "Có cờ đỏ"), chi tiết (huy hiệu, cờ, bảng `/partners/score`), `FlagPanel`, tab "Sổ việc & ghi chú" (bỏ sao/biểu đồ V2-E).
- [x] Cài đặt: `ScoringPane` thay `RepPane`+5 ô; `SettingsData` chỉ còn công ty + điểm kinh doanh.
- [x] Tổng quan; ledger: `voidable` cờ đỏ chỉ owner, `SEVERE_REASON` (`LEDGER_ERRORS` + `ledger.*.json`), nhãn `no_delivery`/`fraud`.
- [x] i18n vi/en; todo.repo.ts; test V2-K todo sửa (bỏ ca rating) — **viết, chưa chạy**.
- [x] Unit: `partner-score.test.ts` (mới), `partner-v2.test.ts`, `settings-lib.test.ts`, `overview.test.ts` cập nhật.
- [x] e2e viết, không chạy: `v2i-partners` (viết lại: MỚI, cờ đỏ, báo/gỡ cờ, quyền), `v2l-settings` (scoring), `overview` (cờ đỏ), `gap-d2`/`scenes`/dataset (`/partners`).

## Quyết định
- Không tên lại route `/settings/scoring` (vẫn chuyển hướng về Đối tác). Biểu đồ/xu hướng/cảnh báo bất thường V2-E bỏ (không có lịch sử điểm HD8 ở API).
- "Cảnh báo bất thường" + huỷ việc ở bảng tiêu chí bỏ cùng V2-E; huỷ có lý do còn ở sổ việc (`PartnerLog`) và gỡ cờ.
- Tiêu chí chấm tay còn trong cấu hình cũ ⇒ UI báo "đã đóng, hãy tắt" (server 422 R41), không tự tắt.

## Còn lại
- qc relock `tests/.lock` (V2-K todo int, e2e); chụp lại baseline `p02-partners-*`, `overview-*`; chạy e2e + int một lần cuối đợt.
- Test int V2-C/HD8/NITI/I1 còn nhắc `rating` (không chạm trong U3). Xoá hẳn `/reputation` đọc (`MineBanner`) khi bỏ V2-E.
