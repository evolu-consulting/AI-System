---
id: REP-v3-ui
lát: B2 (UI)
cr: CR-101b (Intake 2026-10-27 R56, R57, R68, R71, R74, R55)
làn: nhanh (Sonnet)
migration: không
phụ thuộc: REP-v3 đã merge (API). Không phụ thuộc đợt A UI.
---
# REP-v3-ui — Đối tác, Cài đặt uy tín 5 ô, Tổng quan

## Plan (ngắn)
Đối tác: biểu đồ điểm 3/6/12 tháng có đường ngưỡng TỐT/KHÁ; chấm 1–5 sao từng tiêu chí (lý do khi lệch > 25); bấm tiêu chí xem từng việc góp điểm và các bước ra điểm; nhãn MỚI · tạm tính và cờ đỏ giữ. Cài đặt: 5 ô nhóm × vai, mỗi ô 3 tab Tiêu chí · Thời gian · Loại việc; Mức & đánh giá; thử tính; chấm cam mục đã đổi (thay `ScoringPane` HD8 hai tab). Tổng quan TQ-04 (đối tác CHÚ Ý hoặc giảm ≥ 3 điểm/3 tháng) và nguồn Cần xử lý "Đánh giá đối tác".

## Làm
| # | Việc |
|---|---|
| 1 | `features/partners*`: biểu đồ lịch sử, ô sao, danh sách việc theo tiêu chí |
| 2 | `features/settings/components/ScoringPane.tsx` → 5 ô × 3 tab (tách thành file nhỏ ≤ 200 dòng) |
| 3 | Overview TQ-04 + todo "Đánh giá đối tác" (hiển thị; nguồn ở backend REP-v3) |
| 4 | Gỡ hint "chỉ đọc/410" của U3; unit lib; e2e `v2i-partners`, `v2l-settings`, `overview` viết lại (không chạy) |

## Không làm
Engine, API, hộp xác nhận mốc, danh sách chứng từ.

## Chạm
`W/features/partners/**`, `settings/components/ScoringPane*` + `settings/lib/scoring*`, `overview/**` (TQ-04), `locales/contracts/rep3.*.json`. Không chung file với DOC-ui-list/ui-frame (khác thư mục; `contract-detail`, `contracts-list`, `contract-form`, `nav.ts` KHÔNG chạm).

## Test tối thiểu
Unit lib thuần (chuẩn hoá sao, ô → thân API, nhóm màu ngưỡng); e2e viết không chạy.

## Quyết định trong lúc làm (2026-10-27)
- **Phạm vi theo cờ, không thay HD8**: UI đọc `engine` từ `GET /reputation/config` (`useEngine`, lỗi tải ⇒ `hd8` như máy chủ fail-closed). `hd8` giữ nguyên U3 (`/partners`, `/scoring/:role`); `v2e` bật nhánh BA v2.0. Khôi phục các thành phần V2-I/V2-L đã gỡ ở CR-097a (`git f68179df~1`) thành file riêng `*V2E`/`rep-*` thay vì sửa chồng lên HD8.
- **Đối tác**: danh sách đọc `/reputation/partners` (vai × nhóm SP, thêm vai Bên trả hoa hồng, lọc vai riêng), quy đổi về `ScoreRow` chung (`fromRep`: MỚI có điểm ⇒ «MỚI · tạm tính»; cờ đỏ tách khỏi điểm, giữ nguyên). Chi tiết v2e: bảng Góp + các bước + biểu đồ 3/6/12 tháng có đường TỐT 85/KHÁ 70 (lịch sử chốt tháng) + tab sao; FlagPanel (cờ đỏ) giữ ở cả hai engine. `range` lên URL.
- **Cài đặt › Điểm uy tín**: v2e = 5 ô × 3 tab + Mức & đánh giá + thử tính (`ScoringV2EPane`, lưu riêng từng phần đã đổi, không nằm trong bản nháp chung); HD8 hai tab theo vai. Ẩn cấu hình điểm HD8 và chỉnh tay ±10 khi v2e (máy chủ trả 410). Tab của ô khoá khi không phải chủ sở hữu (cùng hành vi cũ).
- **Xem trước «N đối tác đổi mức»** (`GET /reputation/switch-preview`): chỉ `owner` thấy (quyền `admin` ở máy chủ), hiện ở đầu Điểm uy tín cả hai engine, chỉ đọc; ghi chú rõ bật cờ `REPUTATION_ENGINE` là việc quản trị hệ thống.
- **Tổng quan**: v2e ⇒ khối «Cần chú ý» TQ-04 từ `/reputation/attention` (lý do CHÚ Ý · cờ đỏ · giảm ≥ 3 điểm, `before`/`drop`); hd8 ⇒ khối cũ. Nguồn Cần xử lý «Đánh giá đối tác» UI đã hiển thị (`rating`/`rating_quarter`); backend REP-v3 mục 7 chưa làm nên chưa có dòng.
- **i18n**: `rep3.{vi,en}.json` là phần thứ 21, GỘP SÂU vào `pv2`/`settings` (các khoá V2 đã gỡ khôi phục) + nhánh mới `contracts.rep3.*` (`contracts-locales.ts`).
- Contract: `RepConfigOut` thêm `engine` (kiểu, backend đã trả). Không sửa nav/contracts-list/contract-form/contract-detail.
- Test: unit `partner-v2e`, `rep-data`, `partner-score` (quy đổi V2-E, TQ-04), `partner-v2` (URL/vai); e2e `rep3-engine.cw.ts` (hd8 + v2e: Đối tác, Cài đặt, Tổng quan) chạy xanh 11/11. `v2i-partners`/`v2l-settings`/`overview` HD8 cũ KHÔNG chạy lại trong lát (chạy một lần cuối đợt).
## Việc còn lại
- [x] 1–3 (theo cờ engine)  ·  [x] 4 (unit lib + e2e hd8/v2e)
- [ ] Cuối đợt: chạy 2i-partners, 2l-settings, overview cũ cùng bộ e2e.
