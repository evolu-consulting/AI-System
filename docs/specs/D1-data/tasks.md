# D1 · Dữ liệu NitiGroup + demo (CR-097 đợt 3) — làn nhanh (script chạy tay, không đổi schema)

Nguồn: intake `2026-10-23-ba-hop-dong-doi-tac.md` dòng 78/80/96/114. Không migration, không UI. NitiGroup đã xoá sạch dữ liệu nghiệp vụ ⇒ các lệnh phải chạy đúng cả khi rỗng.

## Việc (xong)
- [x] `tools/scripts/src/d1-backfill.ts` (+ `.rules.ts`): MỘT tx, 3 câu UPDATE theo tập, `--tenant` bắt buộc (một tenant), `--dry-run` = chạy thật rồi huỷ. Việc: `root_id` thiếu, HĐ gốc `version_no/root_id` lệch, HĐ đã xác nhận thiếu `locked_at` (chỉ HĐ gốc — bản v≥2 sẽ kích cutover K2). Nhãn "Chưa có văn bản" = `file_id` null là **suy khi đọc** (`has_document`) ⇒ chỉ đếm, không ghi. Đo `score_ratings` + `partner_events.rating` trước/sau, lệch ⇒ huỷ tx (sao đã nhập chỉ đọc).
- [x] `tools/scripts/src/d1-preview.ts` (+ `.rules.ts`): CHỈ ĐỌC (tx read only). Điểm mới = đúng đường `/partners` (`partnerData` + `partnersOf` + cấu hình đã lưu/mặc định, mọi đối tác); mức cũ = `score_locks.level` kỳ mới nhất (V2-E). In "N đối tác đổi mức" + từng đối tác. `--today`, `--json`.
- [x] Demo (`seed-demo-v2.d1.ts`, nối vào `seedDemo`, cùng tx, id ổn định, chỉ `demo`): chuỗi phiên bản (c6 v1 bị thay bởi v2, khoá sẵn), Giao dịch nháp + đã ghi sổ (+ nghĩa vụ thu lẻ), Khách lẻ "MỚI · tạm tính" (2 khoản thu < min_events 3), Tân Phát cờ đỏ (`no_delivery` có lý do). HĐ khoá/"Chưa có văn bản" đã có sẵn (K1 khoá khi chèn; chỉ c1 có tệp). Luồng duyệt mặc định = suy khi đọc (`approval_flows` trống ⇒ `is_default`), không cần dữ liệu. `hub seed` (setup.sh) không đổi.
- [x] Test: unit `d1-backfill.rules.test.ts` (cờ, bất biến, báo cáo, luật đổi mức), `seed-demo-v2.d1.test.ts`; int `tests/acceptance/D1/backfill.int.test.ts` — **viết, chưa chạy** (2 lần ⇒ cùng kết quả, không chạm tenant khác, dry-run không ghi). Cần qc relock `tests/.lock`.

## Thứ tự chạy trên server (sau khi deploy bản có K1/K2/G1/U1/U2 và `setup.sh` đã migrate)
`dc` = `docker compose -p sohoptac2 run --rm -T tool` (trong `/opt/...sohoptac2`).
1. **Backup**: `./backup.sh` (kiểm file dump mới + dung lượng).
2. **Dry-run backfill**: `dc tools/scripts/src/d1-backfill.ts --tenant nitigroup --dry-run` — mong đợi mọi "đổi 0 hàng" nếu dữ liệu đã xoá; số khác 0 thì đọc kỹ trước khi chạy thật.
3. **Preview đổi mức**: `dc tools/scripts/src/d1-preview.ts --tenant nitigroup` — in "N đối tác đổi mức"; báo khách trước nếu N > 0. Ghi lại kết quả.
4. **Chạy thật**: `dc tools/scripts/src/d1-backfill.ts --tenant nitigroup`; chạy lại lần 2 phải ra 0 hàng đổi.
5. **Demo** (chỉ khi cần nạp lại): `dc tools/scripts/src/seed-demo-v2.ts --tenant demo` (thử) rồi thêm `--apply`.

## Rủi ro / ghi chú
- Migration 0052 (U2) viết lại `partner_events_type_ck` **thiếu `'job'`** (V2-E, 0028) ⇒ `ADD CONSTRAINT` sẽ **vỡ** nếu bảng còn dòng `job` (demo có; NitiGroup đã xoá nên qua). Cần sửa 0052 (thêm `'job'`) TRƯỚC khi deploy lên môi trường còn dữ liệu job. Seed demo tự bỏ việc ghi tay nếu ràng buộc thiếu `job`.
- Mức cũ lấy từ ô (nhóm) nhiều việc nhất của kỳ chốt mới nhất — xấp xỉ mức khách thấy ở V2-E; preview là cảnh báo, không phải cam kết. `--today` mặc định theo múi VN.
- Backfill cần vai siêu người dùng (`DATABASE_URL` của tool); chỉ một tenant mỗi lần chạy.
