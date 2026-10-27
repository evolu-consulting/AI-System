# Sổ Hợp Tác · Đối tác và điểm uy tín

Cập nhật: 2026-10-27 · Gộp từ: HD8/U1/U2/U3 (CR-097, 097a), V2-E/V2-I/V2-L, REP-v3, REP-v3-ui, MS-impact (CR-101b).

## 1. Hai engine điểm, chọn bằng cờ `REPUTATION_ENGINE`
Env đọc **mỗi yêu cầu** (đổi không cần dựng lại module). `v2e` ⇒ engine V2-E (BA v2.0 §5.1); vắng/lạ ⇒ `hd8` (fail-closed). Cờ quyết định **toàn bộ** hành vi bên dưới. Mặc định khi merge: `hd8`. Trạng thái prod: xem "Chưa rõ".
Code chung: `H/rep-current.mount.ts` (`supplierScores`, `scoreOf` cho gợi ý V2-C, `switchPreview`), `H/domain/rep-current.rules.ts`. `GET /reputation/config` trả `engine`. Điểm hiện hành đọc cùng một nguồn cho: bảng đối tác, `supplierScores`, gợi ý đối tác, Tổng quan TQ-04.

### 1a. HD8 (cờ tắt, mặc định)
- 2 vai (Khách hàng, Nhà cung cấp); bên trả hoa hồng tính như Khách hàng. Ngưỡng mặc định TỐT ≥ 80 / KHÁ ≥ 60, `min_events` = 3, tăng trọng số gần đây (`recency_boost`, 3 tháng; "recency ×2"). Cấu hình: `PUT /scoring/:role`, xem trước `POST /scoring/:role/preview`, lịch sử `GET /scoring/:role/history`.
- Chỉnh tay ±10 (`POST /partner-events` `manual_adjust`, lý do bắt buộc) **còn**. `PUT /partners/ratings` ⇒ 410 (HD8 không còn chấm tay). V2-E ghi (`/reputation` ratings, jobs, config) ⇒ 410. Vòng chốt tháng không chốt.
- Dưới `min_events` có việc: điểm tạm "MỚI · tạm tính"; 0 việc: "– · Chưa đủ dữ liệu".
- Code: `H/domain/scoring*.rules.ts`, `H/adapters/partners.routes.ts`, `partners-data.repo.ts`, `W/features/partners/**` (U3), `W/features/settings/components/ScoringPane.tsx`.

### 1b. V2-E (cờ `v2e`)
- Điểm theo **vai × nhóm SP** (service, goods, referral; vai gồm Khách, NCC, **Bên trả hoa hồng riêng**). Mức TỐT ≥ 85 / KHÁ ≥ 70. Độ cũ bậc thang 100/50/20% (24/12/12 tháng). Sao 20% (≤ 50%; lệch > 25 bắt lý do; trung bình lượt mới nhất mỗi người). Tự thêm ≤ 8 tiêu chí/ô. Loại việc. **Chốt hằng tháng** (`score_locks`, vòng nền `rep-lock-sweep`). Lịch sử điểm theo tháng từ `score_locks`.
- `PUT /scoring/:role` ⇒ 410 `SCORING_READ_ONLY`; `POST /partner-events` `manual_adjust` ⇒ 410 `ADJUST_REMOVED` (bỏ ±10; sổ HD7 `ledger` chỉ đọc). `PUT /partners/ratings` ⇒ 410 ở cả hai engine.
- API `/reputation/*` (`H/adapters/reputation.routes.ts`): `partners`, `partner`, `mine`, `history`, `ratings` (GET/POST), `jobs`, `config` (+ `config/preview`, `config/cells/:group/:role`, `config/settings`, `config/job-types`), `attention`, `switch-preview`. Ghi cần `write`.
- Mức `new` (chưa đủ việc) ⇒ band null ở gợi ý. Nhãn MỚI · tạm tính (< 3 việc) giữ.
- UI theo cờ (`useEngine` đọc `config.engine`; lỗi tải ⇒ `hd8`): Đối tác đọc `/reputation/partners`; chi tiết: bảng Góp + các bước ra điểm + biểu đồ 3/6/12 tháng có đường TỐT 85 / KHÁ 70 + tab sao. Cài đặt › Điểm uy tín = **5 ô nhóm × vai × 3 tab** (Tiêu chí · Thời gian · Loại việc) + Mức & đánh giá + thử tính (`ScoringV2EPane`, lưu riêng từng phần; chấm cam mục đã đổi). Ẩn cấu hình HD8 và ±10.
- Code: `H/domain/rep-*.rules.ts`, `H/adapters/rep.sql.ts`, `rep.repo.ts`, `H/application/reputation*.usecase.ts`, `W/features/partners/**` (`*V2E`, `rep-*`), `W/features/settings/components/{ScoringV2EPane,RepPane,CritTab,TimeTab,TypesTab,ScoringHistory}.tsx`; locale `rep3.*.json`.

## 2. Cờ đỏ (U2, giữ ở cả hai engine)
- Hai loại sự kiện nghiêm trọng `no_delivery`, `fraud` (migration 0052). **Tách khỏi điểm**: không tính vào `counted`/điểm/mức. Cờ cấp đối tác = còn dòng nghiêm trọng chưa huỷ trong 12 tháng (≡ `window_months` mặc định), cộng mọi vai; hiện bất kể `min_events`.
- Ghi: `POST /partner-events` `type=no_delivery|fraud`, quyền `write`, `note` bắt buộc (422 `SEVERE_REASON`). Gỡ: `POST /partner-events/:id/void` chỉ `admin` (403 `PACK_FORBIDDEN`), `reason` bắt buộc; vết `partner_event_voids` + nhật ký `event_voided`.
- V2-E: `GET /reputation/partners` thêm `red_flag`/`red_flags[{type,n}]` (câu riêng chạy song song, chỉ mục `partner_events_severe_idx`). Chi tiết `/partner` chưa gắn cờ (UI lấy từ dòng bảng).
- Code: `H/domain/scoring-agg.rules.ts`, `H/domain/scoring.rules.ts` (`SEVERE_TYPES`), `W/features/partners/**` (FlagPanel).

## 3. Tổng quan TQ-04 và nguồn "Đánh giá đối tác"
- `GET /reputation/attention` (V2-E): CHÚ Ý ∨ cờ đỏ ∨ giảm ≥ 3 điểm so với điểm vai đã chốt (tháng hiện tại − 3) trong `score_locks`; cờ đỏ lên đầu. HD8: khối "Cần chú ý" cũ.
- Nguồn Cần xử lý "Đánh giá đối tác" (`rating` sau HĐ, `rating_quarter` sau quý; `ratingSources` trong `H/adapters/todo.repo.ts`) chỉ bật khi `v2e`; `hd8` tắt.

## 4. Xem trước chuyển engine
`GET /reputation/switch-preview` (chỉ quản lý `admin`; chạy được ở cả hai trạng thái cờ; **không ghi**): so HD8 hiện hành với V2-E ⇒ `{engine,total,changed,partners,moves,items}` ("N đối tác đổi mức"). Bên trả hoa hồng V2-E so với Khách HD8; HD8 chưa đủ việc ⇒ `new`. UI: chỉ `owner` thấy ở đầu Điểm uy tín (`SwitchPreview.tsx`); ghi chú bật `REPUTATION_ENGINE` là việc quản trị hệ thống. Quy trình: gọi preview trên prod, báo người dùng `changed`/`partners` **trước** khi đặt cờ.

## 5. Điểm trong luồng mốc
Xem trước/lưu delta điểm khi xác nhận mốc: `mot-moc-kho-cong-no.md` §5.

## Chưa rõ
1. Giá trị `REPUTATION_ENGINE` đang đặt trên prod, và đã có ai chạy `switch-preview` trên prod chưa: REP-v3 ghi việc điều phối còn mở.
2. Ngưỡng perf `GET /reputation/partners` 100 ms (1.000 đối tác × 3 vai) **chưa đạt** ngay cả trước REP-v3: đo 106,3 → 100,7/103,5 ms; nợ có sẵn (câu "gom việc" p95 72–74 ms).
3. E2E cũ HD8 (`v2i-partners`, `v2l-settings`, `overview`) chưa chạy lại sau thay đổi cờ (chờ e2e cuối đợt).
4. Chi tiết `/partner` (V2-E) chưa kèm cờ đỏ.
