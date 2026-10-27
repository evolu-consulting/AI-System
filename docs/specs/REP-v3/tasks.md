---
id: REP-v3
lát: B1 (backend)
cr: CR-101b (Intake 2026-10-27 R21, R23, R55–R57, R61, R63, R71 API; Câu 2)
làn: đầy đủ (đường nóng perf, đổi điểm khách; Opus)
migration: 0059_rep_v3 (journal idx 55, when 1799300000000) — CHỈ nếu cần (lịch sử điểm/cờ); bảng V2-E còn
phụ thuộc: DOC-model đã merge (đọc `rep.sql`/`partners-data.repo` đã có điều kiện `doc_type`). Không chờ DOC-deals/UI. Dự kiến chạy song song với DOC-deals.
---
# REP-v3 — Uy tín theo BA v2.0 §5.1 (bật lại V2-E)

## Plan (ngắn)
Đảo CR-097a lần hai (người dùng chốt Câu 2: BA v2.0 thắng). Bật lại V2-E làm điểm hiện hành: vai × nhóm SP, TỐT 85 / KHÁ 70, độ cũ bậc thang 100/50/20% (24/12/12 tháng), sao 20% (≤ 50%, lệch > 25 bắt lý do, TB lượt mới nhất mỗi người), tự thêm ≤ 8 tiêu chí/ô, Loại việc, chốt hằng tháng, lịch sử điểm (biểu đồ 3/6/12 tháng + đường ngưỡng). HD8 thành chỉ đọc. **Giữ** cờ đỏ U2 (`no_delivery`, `fraud`, tách khỏi điểm) và nhãn MỚI · tạm tính (<3 việc). **Bỏ** chỉnh tay ±10 (BA không có).
**Bật sau khi xem trước:** viết lệnh/endpoint xem trước "N đối tác đổi mức" (HD8 hiện hành vs V2-E mới, chỉ đọc, không ghi). Công tắc đặt qua cờ cấu hình (mặc định TẮT khi merge); điều phối báo người dùng số xem trước TRƯỚC khi bật trên prod.

## Làm
| # | Việc |
|---|---|
| 1 | Bỏ 410 ở `/reputation` ghi (ratings, jobs, config cells/settings/job-types) và `PUT /partners/ratings`; bật lại `rep-*.rules.ts`, `score_ratings`, `score_locks`, vòng chốt tháng nền; HD8 `scoring*.rules.ts` chỉ đọc; `PUT /scoring/:role` ⇒ 410 |
| 2 | Điểm hiện hành đọc từ engine V2-E (theo cờ `REPUTATION_ENGINE=v2e|hd8`); `supplierScores`, gợi ý đối tác, Tổng quan TQ-04 (CHÚ Ý hoặc giảm ≥ 3 điểm/3 tháng) đọc cùng nguồn |
| 3 | Lịch sử điểm theo tháng từ `score_locks` (không migration nếu đủ; nếu không: 0059) |
| 4 | Bỏ chỉnh tay ±10 (HD7 `ledger` giữ chỉ đọc) |
| 5 | Xem trước "N đối tác đổi mức" (script `scripts/rep-preview.ts` hoặc `GET /reputation/preview`, set-based, số câu cố định) |
| 6 | Perf: `rep` đọc lô p95 theo ngưỡng V2-E cũ; đo trước → sau, báo số thật |
| 7 | Nguồn Cần xử lý "Đánh giá đối tác" bật lại (hàm riêng trong `todo.repo.ts`, thêm SAU DOC-legal) |

## Không làm
UI (REP-v3-ui), hộp xác nhận mốc (MS-impact), xoá HD8 hay `score_ratings` cũ, đổi cờ đỏ.

## Chạm (lát khác KHÔNG sửa)
`H/domain/rep-*.rules.ts`, `scoring*.rules.ts` (chuyển chỉ đọc), `partners.routes.ts`, `reputation.routes.ts`, `rep.sql`, `partners-data.repo.ts` (chờ DOC-model đã sửa điều kiện), `overview.repo` (chỉ TQ-04), nguồn mới trong `todo.repo.ts` (sau DOC-legal), `scripts/rep-preview.ts`; test `tests/acceptance/HD8/*`, `V2-E/*`, `U1/*` (đổi lại). DOC-* KHÔNG chạm các file này sau DOC-model.

## Test tối thiểu
Unit rules (bảng §5.1 đã có V2-E, chỉ chỉnh); một int đường chính (ghi sao → điểm đổi; chốt tháng → lịch sử); một test chéo tenant bảng V2-E (đã có, chạy lại); perf lô theo ngưỡng cũ; preview đếm đúng trên fixture. Không chạy e2e.

## Việc còn lại
- [ ] 1–7; gửi số xem trước cho điều phối.
