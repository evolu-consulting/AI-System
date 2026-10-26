# U2 · Cờ đỏ + "MỚI · tạm tính" (CR-097 đợt 3) — làn đầy đủ (loại sự kiện mới, migration)

Nguồn: intake `2026-10-23-ba-hop-dong-doi-tac.md` R36, R39 (Câu 4, Câu 6 mặc định), UT-FR-10/12/13. Việc U1 để lại.

## Plan
- **Migration 0052** (`0052_u2_red_flag.sql`, journal idx 47, when 1798100000000 — G1 chưa merge nên 0051 chưa có trong journal; chỉnh idx khi merge):
  nới `partner_events_type_ck` thêm `no_delivery`, `fraud`; CHECK ghi cờ phải có `note`; chỉ mục một phần `partner_events_severe_idx`.
  Không cột mới, không bảng mới (loại nghiêm trọng = hằng `SEVERE_TYPES`; "severity" suy từ loại).
- **Engine:** `Agg.severe` (đếm dòng nghiêm trọng chưa huỷ trong khoảng tính, cả đường SQL `addGroup` lẫn `aggregate`); hai loại KHÔNG tính vào
  `counted`/điểm. `ScoreOut.provisional` + `provisional_score`: 1…min_events−1 việc (có tiêu chí tính được) ⇒ `score` null + điểm tạm;
  0 việc ⇒ không tạm ("– · Chưa đủ dữ liệu"); ≥ min_events ⇒ điểm thường. Ngưỡng = `rules.min_events` của vai.
- **Cờ đỏ (R39):** cờ cấp ĐỐI TÁC = còn dòng nghiêm trọng chưa huỷ trong `window_months` của vai, cộng mọi vai đã đọc; hiện bất kể min_events.
- **API (không route mới):** `POST /partner-events` nhận `type` `no_delivery`|`fraud` (quyền `write`, `note` = lý do bắt buộc, không thì 422
  `SEVERE_REASON`). Gỡ cờ = `POST /partner-events/:id/void` với dòng nghiêm trọng: chỉ `admin` (403 `PACK_FORBIDDEN`), `reason` bắt buộc
  (422 `SEVERE_REASON`); vết = `partner_event_voids` (by/at/reason) + nhật ký `event_voided`.
- **DTO** (`@ai/contracts` `PartnerRow`, đều optional): `provisional`, `provisional_score`, `red_flag`, `red_flags[{type,n}]`; có ở `/partners`
  và `/partners/score`. `MANUAL_EVENT_TYPES` + `SEVERE_EVENT_TYPES`, mã lỗi `SEVERE_REASON`.

## Test
- Unit `domain/scoring-u2.rules.test.ts` (xanh): provisional 0/1/2/3 việc, cờ không đổi điểm/event_count, `aggregate` ≡ `addGroup`, cộng hai vai.
- Int `tests/acceptance/U2/redflag.int.test.ts` — **viết, chưa chạy** (Luật 0b): provisional, ghi/gỡ cờ + quyền + lý do, chéo tenant. Cần qc relock `tests/.lock`.

## Quyết định / giới hạn
- Dùng lại sổ + bảng huỷ có sẵn (không bảng cờ riêng): RLS/M1 của `partner_events` áp nguyên, không thêm bảng ⇒ không thêm test RLS mới ngoài ca chéo tenant.
- Danh sách chỉ một vai (`?role=`) chỉ thấy cờ của vai đó (Luật 4c: không đọc sổ vai khác); `role=all` thấy cờ cả hai vai.
- Cờ không "hết hạn" riêng: ra khỏi `window_months` thì tự tắt; muốn gỡ sớm = huỷ dòng.

## Cho U3 (UI)
- Hồ sơ/danh sách đối tác: huy hiệu "MỚI · tạm tính" + `provisional_score` khi `provisional`; cờ đỏ + `red_flags` (nhãn Không giao / Gian lận).
- Nút "Báo cờ đỏ" (ô lý do bắt buộc) cho editor; nút "Gỡ cờ" (lý do) chỉ admin; thêm `SEVERE_REASON` vào i18n `ledger.*.json` + `LEDGER_ERRORS` web.
- Overview "đối tác cần xem lại" lọc theo `red_flag`.