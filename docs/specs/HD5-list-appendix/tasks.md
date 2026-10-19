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
| T1 | Contract zod (list `parents`, detail `parent`/`appendices`, parent/suggestions/prices/categories/members) | thường | [ ] |
| T2 | BE: members (kit) + categories + `parents` trong danh sách + detail | thường | [ ] |
| T3 | BE: gắn HĐ gốc + gợi ý + áp giá (domain thuần + repo + route) + test | thường | [ ] |
| T4 | Perf trước/sau (list/facets/detail) | cao (đường nóng) | [ ] |
| T5 | FE: S03 danh sách + phụ lục trên S05 | thường | [ ] |
| T6 | e2e: cảnh S03 + baseline + hành vi | thường | [ ] |
| T7 | Cổng lát: `test:affected`, `test:all` một lần | — | [ ] |
