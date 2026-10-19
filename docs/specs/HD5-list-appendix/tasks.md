# Tasks · HD5-list-appendix

Làn: **nhanh** cho FE/danh sách/danh bạ; phần **giá phụ lục** tính ở tầng đọc (không đổi `total_value`, không ghi `valid_to`) nên không chạm tiền ⇒ vẫn làn nhanh (xem D-HD5-01). Mã: `HD-FR-51…46` (HD5, cùng khuôn HD1/HD2: nối tiếp). Đường dẫn: `M` = `apps/hub-api/src/modules/packs/contracts`, `C` = `packages/contracts/src/pack-contracts`, `T` = `tests/acceptance/HD5`.

## Plan (≤ 1 trang)

Nguồn: `docs/platform/intake-hd.md:52` (HD5), mgmt-app `web/src/pages/contracts/ContractsPage.tsx`, `api/app/contracts/{link,project}.py` (phụ lục + áp giá). HD1 đã có schema `kind`/`parent_id`, `contract_items.valid_from/valid_to`, ListQuery đủ bộ lọc + facets ⇒ **không cần migration, không bảng mới** (⇒ không `defineRlsSuite`; RLS/FK kép sẵn của HD1 phủ `parent_id`).

| Mã | Nội dung | Ghi chú |
|---|---|---|
| HD-FR-51 | S03 `/contracts`: bộ lọc theo cột (loại hàng, mua/bán, bên bán, bên mua, phụ trách, người ký, trạng thái, giá trị) + cột chọn được + tìm kiếm + phân trang **phía server** (`useTable` chế độ server, tuỳ chọn lọc lấy từ facets), thẻ trên điện thoại, tải lên + "Nhập tay" | dữ liệu = `GET /contracts` + `/contracts/facets` (HD1) |
| HD-FR-52 | Danh bạ `GET /pack/contracts/members` → `{items:[{id,name}]}` (người dùng active cùng tenant; tên phụ trách) | `packs/kit` (N1 Q8), đọc `admin.users` cột `hub_ro` như `directory` |
| HD-FR-53 | Loại hàng: `GET/POST /pack/contracts/categories` (POST cần `write`; trùng tên ⇒ 409) | bảng HD1 `contract_categories` |
| HD-FR-54 | Phụ lục gắn HĐ gốc: `PATCH /contracts/:id/parent {version, parent_id\|null}` (chọn tay; khoá lạc quan; cha phải là `contract` cùng tenant; HĐ đang có phụ lục không thành phụ lục) + `GET /contracts/:id/parent-suggestions` (gợi ý theo số HĐ nêu trong văn bản, rồi cùng nhà cung cấp/hai bên) + chi tiết có `parent`, `appendices`; danh sách trả `parents` (tiêu đề HĐ gốc cho hàng phụ lục trong trang) | không đổi `ContractListRow` (19 khoá khoá bởi test HD1) |
| HD-FR-55 | Áp giá phụ lục: `GET /contracts/:id/prices` — dòng hàng của HĐ gốc + của phụ lục, dòng phụ lục thay dòng gốc cùng sản phẩm từ `effective_date` của phụ lục (dòng cũ hết hạn ngày trước đó); thuần ở `domain/appendix-pricing.rules.ts` | tính khi đọc, không ghi `valid_to` (D-HD5-01) |
| HD-FR-56 | Visual clone S03: e2e `e2e:contracts` thêm cảnh S03 sáng/tối/mobile so với mgmt-app | baseline `e2e/contracts-web/baseline/win32` |

Perf (Luật 4c): danh sách giữ 2 câu và p95 ≤ 50 ms (thêm `parents` là một cột `json_agg` trong CÙNG câu, tra PK); facets không đổi; chi tiết thêm 2 sub-select theo PK/`contracts_parent_idx`. Đo trước/sau, không Seq Scan.

## Quyết định trong lúc làm
| # | Quyết định |
|---|---|
| D-HD5-01 | Áp giá phụ lục **tính khi đọc** (hàm thuần), không sửa `contract_items.valid_to`/`total_value`. mgmt-app ghi `valid_to` lên dòng cũ (Neo4j); ở đây `valid_*` do người nhập/AI trích giữ nguyên, bảng giá "hiệu lực" là chiếu. Hệ quả: tổng tiền HĐ không đổi ⇒ không rủi ro tiền; HD7/HD8 dùng chung hàm. |
| D-HD5-02 | Gợi ý HĐ gốc là heuristic (số HĐ nêu trong 4.000 ký tự đầu văn bản + cùng bên bán/mua), không LLM/RAG (mgmt-app dùng LLM + RAG) — ghi nợ cho HD6. |
| D-HD5-03 | Xoá HĐ (nút thùng rác owner của mgmt-app, D-08 HD1) **chưa làm**: cần cấp `DELETE`, dọn FileBox, chặn HĐ có phụ lục — mất dữ liệu ⇒ hard stop, để lát riêng. |
| D-HD5-04 | Panel góp ý S14 (Q-F5) không thuộc phạm vi giao HD5 lần này. |

## Tasks
| # | Task | Rủi ro | Trạng thái |
|---|---|---|---|
| T1 | Contract zod (list `parents`, detail `parent`/`appendices`, parent/suggestions/prices/categories/members) | thường | [x] |
| T2 | BE: members (kit) + categories + `parents` trong danh sách + detail | thường | [x] |
| T3 | BE: gắn HĐ gốc + gợi ý + áp giá (domain thuần + repo + route) + test | thường | [x] |
| T4 | Perf trước/sau (list/facets/detail) | cao (đường nóng) | [x] |
| T5 | FE: S03 danh sách + phụ lục trên S05 | thường | [x] |
| T6 | e2e: cảnh S03 + baseline + hành vi | thường | [x] |
| T7 | Cổng lát: `test:affected`, `test:all` một lần | — | [x] test:affected (coordinator chạy test:all ở cổng đợt) |

## Kết quả
- Perf sau ANALYZE (10.000 HĐ/tenant + 70.000 nền, n=200): danh sách không lọc p95 23,2 ms · kind=appendix 10,8 · trang cuối 23,1 · chi tiết HĐ gốc 2,8 / phụ lục 2,0 (≤ 30) · giá 2,1 · gợi ý 4,4; 2 câu SQL (gợi ý 3), không Seq Scan. HD1 ghi 23,9–26,6 cho danh sách ⇒ không tệ đi. Số 	rước đo lúc máy tải nặng (facets, không đổi, 308 ms) không dùng được; facets không đổi.
- Parity S03: un run e2e:contracts — 3 cảnh S03 (sáng/tối/mobile) chữ 0 lệch, khung ≤ 2 px, ảnh ≤ 0,5 %.
- Mở: xoá HĐ (D-HD5-03), panel góp ý S14, gợi ý bằng LLM/RAG (D-HD5-02), 	oday của giá theo UTC (chưa theo múi tenant), baseline S05 đang đổi do HD3, qc relock e2e/tests mới.

## Tranh chấp test (đã xử lý, vòng sửa review 1b36c8d9)
Người dùng chốt 2026-10-19: "Đồng ý cập nhật 2 test khoá HD1 theo hành vi mới: danh sách có thêm trường parents (HD5), và action_deadline = end_date − notice_days thay vì null (HD4). qc ghi lại và khoá lại."

| Test khoá (`tests/acceptance/HD1/list.int.test.ts`) | Cũ | Mới | Vì sao |
|---|---|---|---|
| "chưa có HĐ ⇒ 200 {…}" | `{ items: [], total: 0, page: 1, page_size: 20 }` | thêm `parents: []` | HD5 thêm trường cộng thêm `parents` vào `ListResponse` (không đổi `ListRow` 19 khoá) |
| "HĐ 1: 19 khoá ListRow, giá trị đúng" | `action_deadline: null` | `action_deadline: "2027-03-31"` | HD4 (trigger `hd4_schedule`) tính hạn = `end_date − notice_days`; HĐ mẫu end 2027-03-31, không có notice ⇒ 0 ngày. Không phải thay đổi của HD5 |

qc đọc lại hai thay đổi (đúng AC, không khớp theo lỗi code) và khoá lại `tests/.lock` cho: HD1 `list.int.test.ts`, HD5 `hd5.int.test.ts`, `hd5.perf.int.test.ts`, e2e `scenes.cw.ts`, `hd5-list.cw.ts`, `dataset-list.ts`, 6 baseline S03.

## Vòng sửa review (1b36c8d9)
- Trung 2 (vòng/phụ lục của phụ lục khi đồng thời): `lockForParent` khoá CẢ hai hàng theo thứ tự id (một câu `FOR UPDATE`) rồi mới đọc loại cha/phụ lục con ở câu sau; test đồng thời A→B ∥ B→A và C→A ∥ A→B (8 vòng mỗi ca) — đỏ khi bỏ khoá, xanh khi có.
- Trung 3 (`as_of`): mặc định theo múi tenant (`uploadDay` + `TenantState.timezone`, cùng ngày lịch HD4); test đổi múi Kiritimati/Pago_Pago.
- Trung 4 (layout shell): chạy lại parity s03, s05, s08, s10, s11 (prices/cks/customer của HD9) + hành vi HD5: đều xanh (port riêng). `/partners` chưa có cảnh (HD8). Sửa kèm: HD3 bỏ ẩn `btn-primary` nên "+ Thêm hợp đồng" hiện ở S03 hub — thêm `HIDE` theo input file ẩn đứng trước nút (cả hai phía).
- Thấp 5: thuộc HD4, đã xử lý qua quyết định người dùng ở trên. Thấp 6: chấp nhận (chỉ hiển thị, không phép tính tiền).
- Mở: `today` của giá giờ theo múi tenant (hết nợ UTC).