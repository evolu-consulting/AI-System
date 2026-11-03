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
- `apps/admin-api/src/modules/app-roles/cr116-compile.bench.perf.int.test.ts` — C4 `compileRoles` set-based vs từng vai.
- Số đo + kết luận ghi ở mục "Số đo" dưới đây; số máy đọc `results/*.json` (schema baseline probe).

## Không làm / Chạm
Không sửa mã sản phẩm, migration, test khoá (`tests/acceptance/**`). Không chạm DLC. Chỉ 2 file bench + docs lát.

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
Chưa đo: `count(*)` + RLS từng hàng (tổng ước lượng / bảng đếm tăng dần), HD3 quét, ETag GET approval, plan cache /sourcing, Bun.sql.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ đo).

## Việc còn lại
Xem dòng "Chưa đo" ở mục Số đo.
