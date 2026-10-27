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

## Quyết định trong lúc làm (2026-10-27)
- **Cờ** `REPUTATION_ENGINE` (env, đọc MỖI yêu cầu — đổi không cần dựng lại module): `v2e` bật; vắng/lạ ⇒ `hd8` (fail-closed). Cờ quyết định TOÀN BỘ: tắt = y hệt U1 (V2-E ghi 410, HD8 lưu được, ±10 còn, vòng chốt không chốt); bật = BA v2.0 (V2-E ghi mở, `PUT /scoring/:role` 410 `SCORING_READ_ONLY`, `POST /partner-events` `manual_adjust` 410 `ADJUST_REMOVED`, vòng chốt chạy). `PUT /partners/ratings` 410 ở cả hai (HD8 không còn chấm tay).
- Nguồn chung `rep-current.mount.ts` (`supplierScores`, `scoreOf` gợi ý V2-C, `switchPreview`); không import `partners.mount`/`reputation.mount` (tránh vòng). V2-E: bên trả HH là vai riêng (R23); HD8: như Khách (U1 Q3). Mức V2-E `new` ⇒ band null ở gợi ý.
- **Xem trước** `GET /reputation/switch-preview` (chỉ quản lý `admin`, cả hai trạng thái cờ, KHÔNG ghi): HD8 hai vai từ MỘT lượt đọc (`partners.usecase.byRole`, 3 câu) ∥ V2-E bảng (3 câu) ⇒ `{engine,total,changed,partners,moves,items}`; HD8 chưa đủ việc ⇒ `new`; bên trả HH V2-E so với Khách HD8; chạy dưới RLS người gọi (quản lý thấy cả tenant).
- **Cờ đỏ U2 giữ** trên bảng V2-E: `GET /reputation/partners` thêm `red_flag` (+ `red_flags` khi có), câu cờ riêng chạy SONG SONG (chỉ mục một phần `partner_events_severe_idx`), khoảng 12 tháng (≡ `window_months` mặc định HD8 U2 dùng), không đổi điểm/mức. Chi tiết `/partner` chưa gắn cờ (UI lấy từ dòng bảng).
- **TQ-04** `GET /reputation/attention`: CHÚ Ý ∨ cờ đỏ ∨ giảm ≥ 3 điểm so với điểm vai đã chốt kỳ (tháng hiện tại − 3) trong `score_locks`; cờ đỏ lên đầu. `GET /reputation/config` trả thêm `engine`.
- **Không migration** (bảng V2-E + `score_locks` đủ cho lịch sử) ⇒ không dùng 0059.
- **Test khoá đổi** (buộc, do +1 tx cờ đỏ): `V2-E/sqlcount.int.test.ts` bảng điểm 6 ⇒ 8 câu; `V2-E/perf/reputation.perf.int.test.ts` 6 ⇒ 8 câu + đo câu cờ. Đã `test:lock:write`. Test U1/HD8/V2-E 410 cũ giữ nguyên (đúng khi cờ tắt).
- **Perf (đo thật, 1.000 đối tác × 3 vai, cùng máy):** `GET /reputation/partners` p95 trước 106,3 ms → sau 100,7 / 103,5 ms (hai lần); câu cờ đỏ p95 2,4 ms song song; JSON 624 → 674 KB. Ngưỡng 100 ms **chưa đạt cả trước khi sửa** (câu "gom việc" p95 72–74 ms chiếm phần lớn; nợ có sẵn, không do REP-v3).
- Mục 7 (todo "Đánh giá đối tác") **chưa làm**: DOC-legal chưa merge (tasks yêu cầu thêm SAU DOC-legal).

## Việc còn lại
- [x] 1 (theo cờ) · [x] 2 (`supplierScores`, gợi ý, TQ-04 API) · [x] 3 (không migration) · [x] 4 (theo cờ) · [x] 5 (`/reputation/switch-preview`) · [~] 6 (đo xong, ngưỡng 100 ms chưa đạt — có sẵn trước lát)
- [ ] 7 nguồn Cần xử lý "Đánh giá đối tác" — sau DOC-legal.
- [ ] Điều phối: gọi `GET /pack/contracts/reputation/switch-preview` (quản lý) trên prod, báo người dùng `changed`/`partners` TRƯỚC khi đặt `REPUTATION_ENGINE=v2e`.
- [ ] Web (REP-v3-ui) chuyển Tổng quan khối đối tác sang `/reputation/attention` và bảng đối tác sang `/reputation/partners` khi `config.engine = v2e`.
