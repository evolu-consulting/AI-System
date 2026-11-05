---
id: perf-v2g-save
lát: perf-v2g-save
cr: CR-118 (perf)
làn: đầy đủ (đường nóng có ngưỡng perf; trigger DB)
migration: pack-contracts 0074_v2g_save_cell (journal `when` 1803200000000)
phụ thuộc:
---
## Plan (ngắn)
Mục tiêu: "Lưu" màn xác nhận 200 dòng + 50 mốc p95 ≤ 250 ms (`tests/acceptance/V2-G/perf/review.perf.int.test.ts`). Đo trước: p50 227,5 · p95 252,4 ms (evotest, 1 slot).
Đo từng câu (EXPLAIN ANALYZE + thời gian thật): câu CTE dòng+mốc ~150 ms = lập kế hoạch ~89 ms (policy RLS `obligations_visible` / `contract_items_visible` bung lồng nhau theo MỖI lần nhắc bảng) + thực thi ~60 ms (trigger hàng `obligations_v2e_cell` ~30 ms/50 mốc, `obligations_doc_frame` ~18, `v2j1_ins/upd` ~29).
Cắt: (1) bỏ CTE `unk` (thừa: `upd !== asked` đã bắt dòng lạ) · (2) CTE ghi dòng/mốc tự điền `rep_cell` từ `k` + bỏ `returning` của `ins` (đếm từ đầu vào) · (3) migration 0074: `obligations_v2e_cell` hàng chỉ khi `rep_cell` NULL + trigger CÂU đối chiếu 1 lần · (4) `v2j1_fill_group` thoát sớm khi không dòng (mới/cũ) nào có SP.

## Làm
- [x] review.repo.ts: bỏ `unk`; `k.rep_cell` → `mi.rep_cell`; `ins` không `returning`
- [x] 0074_v2g_save_cell.sql + journal
- [x] Delta + số đo

## Không làm / Chạm
- `obligations_doc_frame` (R44: bỏ qua mốc tự sinh của HĐ nguyên tắc ⇒ phải là trigger hàng BEFORE, trả NULL để bỏ hàng; còn ~18 ms mỗi lượt lạnh) giữ nguyên — không đổi ngữ nghĩa.
- `contracts_hd7_schedule` (trigger đổi trạng thái → mốc mặc định) giữ nguyên.
- Không sửa test đã khoá.

## Test tối thiểu
- tests/acceptance/V2-G/perf/review.perf.int.test.ts (perf: p95 ≤ 250 ms)
- tests/acceptance/V2-G/perf.int.test.ts (đếm số câu SQL cố định) + V2-G/review.int.test.ts, V2-E (ô uy tín của mốc), V2-A/HD7 (mốc, ledger)

## Quyết định trong lúc làm
- Thử `plan_cache_mode=force_generic_plan` trong tx Lưu: KHÔNG có tác dụng ở test này — mỗi lượt perf gọi `arrangeV2a` ⇒ `TRUNCATE` bảng gói ⇒ mọi plan đã cache (kể cả SPI trong trigger) bị huỷ, câu CTE luôn lập kế hoạch lại (~89 ms) và trigger plpgsql lập lại SPI (lạnh). Đã gỡ khỏi mã. (Ngoài test, plan cache hoạt động bình thường; số đo "lạnh" là mức xấu nhất.)
- `rep_cell` của mốc: trigger CÂU dùng bảng chuyển tiếp thay vì bỏ hẳn kiểm — giữ bất biến "rep_cell mốc = ô của HĐ/giao dịch" kể cả khi người ghi đưa giá trị sai. Nhánh giao dịch (`contract_id` null) chỉ lập kế hoạch khi có hàng như vậy.
- `v2j1_fill_group`: thêm bảng chuyển tiếp CŨ cho trigger UPDATE để dòng bỏ SP vẫn tính lại (hành vi như trước); chèn dòng không SP thoát sớm.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: tối ưu hiệu năng — cùng kết quả lưu, cùng `rep_cell`/`product_group` cuối cùng, cùng mã lỗi; chỉ đổi cách tính: CTE tự điền `rep_cell`, trigger hàng → trigger câu, bỏ CTE thừa).

## Kết quả (evotest, 1 slot, 2 lượt sau sửa)
Trước: p50 227,5 · p95 252,4 ms (FAIL). Sau: p50 180,4 · p95 198,1 ms; lượt 2: p50 173,6 · p95 206,9 ms (PASS). Int V2-G+V2-E+V2-A+HD7: 92 pass / 0 fail (gồm đếm số câu SQL).

## Việc còn lại
- Chạy -Exclusive perf cuối đợt (điều phối) để lấy số khi máy yên; cân nhắc sửa `arrangeV2a`→`truncateAll` trong vòng đo (qc) để đo đúng trạng thái plan cache ấm.
