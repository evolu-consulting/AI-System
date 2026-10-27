---
id: V2-E
title: Uy tín v2 (engine §5.1 + Loại việc + chốt tháng) — backend/API
lane: đầy đủ (đường nóng perf, RLS bảng mới, thay test HD8)
source: docs/platform/ba-v2/intake.md (V2-E, C1, §4 Q1) · BA v2 §5.1, §6 · DT-02/03/04 · CD-02..05 · HD-06
---

> **CR-101b (2026-10-27):** V2-E được **bật lại làm điểm hiện hành** (đảo CR-097a/U1: mở lại ghi, bỏ 410) bởi [`REP-v3`](../REP-v3/tasks.md). Chỉ đọc cho tới khi REP-v3 merge và người dùng xem số "N đối tác đổi mức".
# V2-E — tasks

## Plan (đã làm)
| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | Migration `0028_v2e_reputation.sql` (when 1795500000000): `contracts.product_group`, cột sinh `partner_key`, `rep_cell`; `obligations.rep_cell` (trigger giữ đúng); `partner_events.grp/job_type` + type `job` + vai `commission_payer`; bảng `score_configs_v2`, `score_ratings` (chỉ thêm), `score_locks` + `score_lock_runs` (chỉ vòng nền ghi) + RLS M1 | đầy đủ | xong |
| 2 | Engine thuần `rep-score/rep-config/rep-normalise/rep-board.rules.ts`: việc → tiêu chí (bậc thang 100/50/20%) → dữ liệu (bỏ tiêu chí trống) → cuối (1−s)·dữ liệu + s·sao×20; mức 85/70, MỚI < 3 việc; điểm vai BQ theo giá trị nhóm; 5 ô mặc định BA; ≤ 8 tiêu chí tự thêm (3 kiểu) | đầy đủ | xong |
| 3 | API `/reputation`: `GET partners`, `GET partner` (DT-02 từng việc), `GET history` (3/6/12 th + điểm hiện tại), `GET/POST ratings` (lý do khi lệch > `reason_gap`), `POST jobs` (HD-06), `GET config`, `PUT config/cells/:g/:r|settings|job-types` (quản lý), `POST config/preview` (thử tính, không ghi) | đầy đủ | xong |
| 4 | Vòng chốt tháng (`contracts-rep-lock`, cùng cờ worker vòng quá hạn): điền lùi 12 kỳ, kỳ đã chốt không tính lại | đầy đủ | xong |
| 5 | HD8 chỉ đọc: `PUT /scoring/:role`, `PUT /partners/ratings` ⇒ 410 `SCORING_READ_ONLY` (sau 403/400); qc gỡ `HD8/agg-parity`, sửa AC02/AC03 — lý do CR-096 Q1 | đầy đủ | xong |
| 6 | Test: unit `rep-score.rules.test.ts`; int `tests/acceptance/V2-E` (công thức, cấu hình, sao, việc, chốt tháng, M1 org, RLS chỉ thêm, 410, SQL cố định); perf `V2-E/perf` | đầy đủ | xong |

## Quyết định trong lúc làm
- Nhóm SP của HĐ: cột `product_group` (service|goods, null ⇒ hàng hoá); Giới thiệu luôn `referral`. V2-B/V2-F điền từ danh mục SP — chưa nối.
- Job score: mốc `owner = partner`, đã xác nhận, loại giao/thu tiền/serial/hoa hồng; chỉ `fault = partner` trừ `late_per_day` (mặc định 2)/ngày. Mốc việc của mình chỉ là "giao dịch" (mẫu số tiêu chí đếm việc xấu).
- Tiêu chí kiểu `jobs` = BQ điểm loại việc gắn tiêu chí; `bad_count` = 100 − mức trừ × (việc xấu / 10 giao dịch); `manual` = sao × 20.
- Độ cũ theo ngày: tuổi < m tháng ⟺ ngày > hôm nay − m tháng (SQL và TS cùng luật).
- Điểm hiện tại tính khi đọc (đổi cấu hình chỉ đổi điểm hiện tại); kỳ chốt lấy cấu hình lúc chốt, lần đầu điền lùi 12 kỳ theo cấu hình hiện tại.
- `GET /partners` cũ (HD8) giữ cho UI hiện tại tới V2-I; bảng điểm v2 = `GET /reputation/partners`. Sắp tên theo mã ký tự (UI tự sắp).
- Perf: `rep_cell` chép sẵn lên mốc (trigger) để câu chấm không nối 3.000 HĐ; 3 tx (cấu hình ‖ rồi gom việc ‖ HĐ+sao+danh bạ song song) = 6 câu cố định.

## Kết quả đo (evotest, 1.000 đối tác × 3 vai, 15.000 mốc, sau ANALYZE)
- `GET /reputation/partners`: p95 313 → 76,9 ms (p50 63,4); `?role=customer` p95 72,2; `/reputation/partner` p95 19,4. 6 câu SQL không đổi theo cỡ.

## Việc còn lại
- V2-I: UI chuyển sang `/reputation`; V2-L: UI cấu hình. V2-B/V2-F: điền `product_group` từ danh mục SP.
- Huỷ việc `job` qua `/partner-events/:id/void` chưa mở (loại việc không trong danh sách ghi tay HD7).
- "Khi nào nhắc đánh giá" (CD-05) chưa lưu — để V2-K (Cần xử lý).
- Nợ quy ước (như module hiện có): factory use case > 50 dòng, application import type từ adapters/@ai/contracts (depcruise báo).
