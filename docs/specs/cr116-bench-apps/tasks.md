---
id: cr116-bench-apps
lát: cr116-bench-apps
cr: CR-116
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Pha 1 CR-116 cho admin-api + hub-api gói contracts: (1) chạy bộ perf có sẵn trong phạm vi trên evotest để XẾP HẠNG ứng viên;
(2) viết harness A/B trên CÙNG dữ liệu (cỡ prod + cỡ lớn), so kết quả bằng nhau, đo p50/p95/số câu SQL, `-Step perf -Exclusive`;
(3) kết luận "đã tối ưu" / "đổi được" từng ứng viên. Không đổi mã sản phẩm.

## Làm
- `apps/hub-api/src/modules/packs/contracts/adapters/cr116-list.bench.perf.int.test.ts` — C1 dạng policy RLS cây quản lý
  (`= ANY` / `IN (unnest)` / `EXISTS`), C2 ORDER BY CASE vs tĩnh vs CTE không materialize, C3 OFFSET vs keyset; đếm SQL list/detail.
  Biến thể policy áp bằng `ALTER POLICY` trong tx rồi ROLLBACK (DB test clone), biến thể câu = văn bản thật của `contractsRepo().list`.
- `apps/admin-api/src/modules/app-roles/cr116-compile.bench.perf.int.test.ts` — C4 `compileRoles` set-based vs từng vai vs MERGE.
- Vòng 2: `cr116-bench.harness.ts` (harness chung) + `cr116-list2.bench.perf.int.test.ts` — C9 plan /sourcing, C6 total, C5b tìm tách nhánh, C8 plan cache, C7 driver + cắt kết nối.
- Số đo + kết luận ghi ở mục "Số đo" dưới đây; số máy đọc `results/*.json` (schema baseline probe).

## Không làm / Chạm
Không sửa mã sản phẩm, migration, test khoá (`tests/acceptance/**`). Không chạm DLC. Chỉ file bench `cr116-*` + docs lát.

## Test tối thiểu
Chỉ 2 file bench trên evotest `-Step perf -Exclusive -Filter <file>`; mỗi biến thể assert kết quả bằng biến thể hiện tại.

## Quyết định trong lúc làm
- 3 vòng xen kẽ A/B/C TRONG một lượt chạy (cùng dữ liệu, cùng kết nối) thay vì 3 lượt evotest riêng — loại nhiễu giữa lượt seed.
- File bench đặt cạnh mã (không dưới `tests/acceptance/**` đang khoá).

## Số đo (evotest `-Exclusive`, PG 16.15; 3 vòng xen kẽ; JSON: `results/*.json`)
Xếp hạng (profile bộ perf có sẵn, slot thường): danh sách HĐ HD1 p50 41–50/p95 59–75 ms (đỏ 17/20 tổ hợp) > facets p95 60–67 > quét HD3
lô 100 p95 75 > M1D org p50 34–37 (editor thấy 33 HĐ vẫn 34 ms) > W1 my-work p95 51 > GET approval p95 31,5 > /sourcing (Planning 3,7 s
lần đầu). admin-api xanh hết. SQL/request: list 2, detail 2.
| ứng viên | biến thể | 2k p50/p95 | 50k p50/p95 | bằng · RLS chéo tenant | kết luận |
|---|---|---|---|---|---|
| C1 RLS cây (V) | A `=ANY` hiện tại / B `IN unnest` / C `EXISTS` | 22,7/25,6 · 27,2/30,0 · 22,7/25,9 | 50,7/55,7 · 49,2/53,5 · 44,4/48,8 | ✓ ✓ | đã tối ưu (C −12 % chỉ ở 50k) |
| C2 ORDER BY (O) | A CASE+mat / B tĩnh / C tĩnh+not mat | 19,2/21,0 · 19,1/20,6 · 21,7/24,4 | 59,8/65,7 · 57,2/63,2 · 41,7/46,0 | ✓ ✓ | đã tối ưu (C −30 % chỉ 50k-O, +13 % 2k, 0 % với V) |
| C3 trang cuối (O) | A OFFSET / B keyset | 4,5/5,6 · 3,7/4,7 | 35,6/38,0 · 3,7/4,8 (buf 1580→36, temp 210→0) | ✓ ✓ | câu trang đổi được ở 50k, −17 % ở 2k; list thật đầu/cuối 60/68 ms ⇒ `count(*)` mới là nút thắt |
| C4 compileRoles | A ON CONFLICT 3 SQL / B từng vai 3N / C MERGE 3 | 3,6/4,4 · 12,8/17,8 · 3,1/4,4 | (1000 vai) 238/269 · 1615/3404 · 185/222 | ✓, 2 tx đồng thời + lỗi giữa tx ✓ | đã tối ưu (MERGE PG16 không RETURNING ⇒ mất dữ liệu audit) |
| C5 tìm `LIKE %q%` | A hiện tại / B + GIN trgm | 18,0/20,6 · 18,2/21,2 | 39,3/42,7 · 39,4/43,0 | ✓ ✓ | không đổi được: vị từ `($like is null or …)` chặn dùng index trgm |
Phát hiện phụ: `pg_terminate_backend` giữa tx làm postgres.js 3.4.9 crash `socket.write` ⇒ chèn lỗi bằng lỗi câu lệnh.

### Vòng 2 (`cr116-list2.bench.perf.int.test.ts` + `cr116-bench.harness.ts`; 2 lượt `-Exclusive`, số dưới = lượt 2)
| ứng viên | biến thể | 2k p50/p95 | 50k p50/p95 | bằng · RLS | kết luận / đổi gì với người dùng |
|---|---|---|---|---|---|
| C9 /sourcing plan | visibleIds · fingerprint · list: Planning vs Execution | plan 3–14 ms, exec 3–8 | plan 3–15 ms, exec 37–66 | — | **3,7 s KHÔNG tái hiện** (param/literal/nestloop off đều ≤ 15 ms) ⇒ là hiện tượng riêng bước EXPLAIN của test W1, không phải đường app. Kết nối lạnh +17–25 ms câu đầu (catalog cache) |
| C6 total (O) | A count chính xác / B trần 1.000+ / C có-trang-sau / D ước lượng EXPLAIN / E bảng đếm | 18,9/21,7 · 20,8/23,6 · 20,6/23,5 · 24,3/28,5 · 17,5/19,9 | 59,2/63,6 · 21,4/24,2 · 20,8/23,3 · 24,3/27,3 · 17,3/20,5 | trang ✓ · ✓ | **B đổi được ở 50k (−64 %) nhưng +10 % ở 2k** ⇒ không đạt luật cả hai cỡ. Người dùng thấy "1.000+" thay số chính xác khi > 1.000. D sai số lớn (ước 37.535 vs thật 50.000 / 1.516 vs 2.000). E đúng chỉ khi thấy cả tenant + không lọc |
| C6 total (V, thấy 426 / 10.186) | như trên | 23,1/26,9 · 25,9/28,6 · 22,5/25,1 · 26,3/29,1 · 18,9/23,4 | 50,3/56,6 · 27,5/31,7 · 23,0/26,3 · 26,3/29,9 · 18,8/20,9 | trang ✓ · ✓ | E **SAI nghĩa** (báo 2.000/50.000 = số cả tenant cho người chỉ thấy 426/10.186 ⇒ lộ số lượng) — loại |
| C5b tìm | A `($q is null or like)` / B tách nhánh / C tách nhánh + GIN trgm / D A + GIN | ≈ 17,7–18,7 mọi biến thể | q=777: 39,0–39,6 · q="hd 1": 43,9–44,6 mọi biến thể | ✓ ✓ | **không đổi được dưới RLS**: EXPLAIN C vẫn Bitmap theo tenant, `like` nằm trong Filter cùng vị từ RLS — `~~` không LEAKPROOF ⇒ security barrier không cho dùng làm điều kiện index trước policy. Cần hàm SECURITY DEFINER lọc id (rủi ro bảo mật, chưa đo) |
| C8 plan cache list | A auto (custom plan) / B force_generic_plan | 22,0/24,0 · 78,2/85,0 (V) | 50,6/54,7 · 113,8/123,2 (V); O 59,3 · 131,3 | ✓ ✓ | đã tối ưu — generic plan chậm 2–4×. Lưu ý: mỗi lượt list tốn ~12–14 ms lập kế hoạch (≈ 55 % p50 ở 2k) — ứng viên pha sau: giảm độ phức tạp câu |
| C7 driver list (V, 50k) | postgres.js 3.4.9 / Bun.SQL 1.3.14 | — | 50,3/54,3 · 49,5/53,7 | ✓ | ngang nhau (−2 %) ⇒ không đổi driver vì tốc độ |
**Tin cậy khi cắt kết nối giữa tx** (`pg_terminate_backend` chính tiến trình, chạy trước khi đổi role): postgres.js 3.4.9 ném `TypeError: null is not
an object (socket.write)` (không phải lỗi PG có mã ⇒ lớp retry 40P01/40001 không nhận ra); **Bun.SQL 1.3.14 treo không trả lỗi ≥ 600 s** (test
timeout) ⇒ tệ hơn. postgres.js 4.0.0 đã phát hành — chưa thử (cần cài dep riêng cho bench). Rủi ro reliable: ghi TECH-DEBT khi merge.
Chưa làm: (4) HD3 quét lô 100, (5) ETag/304 GET approval — hết thời gian.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ đo).

## Việc còn lại
Xem dòng "Chưa đo" ở mục Số đo.
