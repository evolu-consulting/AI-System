# cr157-manual-fallback — CR-157 («Nhập tay» = dự phòng khi AI đọc lỗi/hết giờ, nhập ngay trên HĐ đó, có xác nhận đối chiếu)

## Plan
Nút «Nhập tay» ở khối «Không đọc được hợp đồng này» không còn dẫn sang `/contracts/c/new` (route tạo trống đã 410 từ CR-097). Bấm ⇒ `POST /contracts/:id/manual-entry`: HĐ DRAFT + `extract_state = failed` ⇒ `entry_source = manual`, `extract_state = ready` (form sửa được, ô trống), tệp gốc giữ nguyên để đối chiếu.
Người nhập tích «Tôi đã đối chiếu với tệp gốc» ⇒ `PUT /contracts/:id/reconcile {reconciled}` (không đổi `version`, để form đang mở không bị 409). Lưu («Xác nhận & lưu») / Gửi duyệt HĐ manual chưa có `reconciled_at` ⇒ 422 `RECONCILE_REQUIRED` (chặn trong `precheck` của `submitInTx` — một chỗ cho cả hai đường).

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Migration 0114: `entry_source`, `reconciled_by`, `reconciled_at` + CHECK | `packages/db/migrations-pack-contracts/0114_cr157_manual_entry.sql`, `meta/_journal.json` | [x] |
| 2 | Luật thuần `canStartManual` / `needsReconcile` / `canReconcile` | `domain/manual-entry.rules.ts` (+ test) | [x] |
| 3 | API `manual-entry`, `reconcile`; chặn `RECONCILE_REQUIRED` ở Gửi + Xác nhận & lưu; đọc lại AI xoá xác nhận cũ | `adapters/manual-entry.routes.ts`, `application/manual-entry.usecase.ts`, `submissions.repo.ts`, `submit.usecase.ts`, `extraction.repo.ts` | [x] |
| 4 | Contract: `entry_source`/`reconciled` (danh sách, chỉ khi manual), `reconciled_by/at` (chi tiết, chỉ khi manual), mã lỗi | `packages/contracts/src/pack-contracts/{manual-entry,list,detail,submit}.ts`, `contracts.repo.ts`, `contracts.mapper.ts` | [x] |
| 5 | UI: nút «Nhập tay» gọi API; `ManualBanner` (nhãn + ô tích + nút xem tệp gốc); nhãn ở danh sách; i18n vi/en | `contract-review/components/{ReviewParts,ManualBanner,ContractBody}.tsx`, `ContractCells.tsx`, `packages/i18n/locales/contracts/*.json` | [x] |
| 6 | Test | `manual-entry.rules.test.ts`, `manual-entry.int.test.ts`, `manual-entry.test.ts`, `e2e/contracts-web/cr157-manual-fallback.cw.ts` (viết, chưa chạy) | [x] |

## Quyết định trong lúc làm
- Xác nhận đối chiếu = endpoint riêng `PUT /reconcile` (không nhét `reconciled` vào payload Lưu/Gửi): có hai đường Gửi (`/submit`, `/review`) nên một cổng ở `precheck` + một endpoint đơn giản hơn hai payload.
- Chỉ người tạo ∪ người phụ trách (người gọi) xác nhận; `reconciled_by` = người gọi. Bỏ tích ⇒ xoá cả hai cột.
- «Lưu nháp» (PATCH trường) không bị chặn — chỉ Lưu/Gửi duyệt (chuyển trạng thái) cần đối chiếu.
- AI đọc lại HĐ manual (Q4): `POST /extract` giữ nguyên; xoá `reconciled_*` (dữ liệu có thể đổi ⇒ phải đối chiếu lại). Ô người đã sửa được giữ (khoá `edited` của HD2).
- Danh sách/chi tiết chỉ thêm khoá khi HĐ manual ⇒ bộ khoá HĐ do AI đọc không đổi (test khoá cũ giữ xanh).
- Tên «đối chiếu bởi X» tra ở web qua `useMemberNames` (API chỉ trả id).

## Việc còn lại
- Q1 «Tải tệp khác» (thay tệp rồi AI đọc lại): chưa có route thay tệp của HĐ DRAFT (chỉ xoá + tải mới) ⇒ cần route mới, > 10 phút ⇒ không làm.
- Q4 gợi ý theo từng trường (AI đọc lại, người dùng chọn giữ/thay): chưa có so sánh; hiện ô đã sửa được giữ, ô trống được AI điền.
- «Hiện tệp gốc cạnh form»: hiện bằng nút «Xem file gốc» mở khung xem sẵn có (CR-149), chưa dàn hai cột.
- Nút Lưu/Gửi chưa tắt khi chưa tích (máy chủ chặn 422, màn hiện câu rõ); có thể tắt nút ở lượt sau.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Lý do không đọc được hợp đồng
- Kịch bản: khi AI đọc lỗi hoặc hết giờ thì bấm Nhập tay chuyển chính hợp đồng đó sang nhập tay với ô trống, tệp gốc giữ để đối chiếu [test: apps/hub-api/src/modules/packs/contracts/adapters/manual-entry.int.test.ts » DRAFT + failed, người được giao (không phải người tạo) ⇒ manual + ready]
- Kịch bản: khi AI đang đọc thì không chuyển nhập tay được [test: apps/hub-api/src/modules/packs/contracts/adapters/manual-entry.int.test.ts » AI đang đọc ⇒ busy, không đổi gì]
- Kịch bản: khi AI đã đọc xong hoặc hợp đồng không còn nháp thì không chuyển nhập tay được [test: apps/hub-api/src/modules/packs/contracts/adapters/manual-entry.int.test.ts » AI đọc xong (ready) hoặc HĐ không còn DRAFT ⇒ MANUAL_NOT_ALLOWED]
- Kịch bản: khi người ngoài hoặc công ty khác gọi thì bị từ chối hoặc không thấy hợp đồng [test: apps/hub-api/src/modules/packs/contracts/adapters/manual-entry.int.test.ts » người ngoài ⇒ forbidden, tenant khác không thấy ⇒ not_found]
- Kịch bản: khi hợp đồng nhập tay chưa tích đã đối chiếu thì Gửi duyệt bị chặn RECONCILE_REQUIRED [test: apps/hub-api/src/modules/packs/contracts/adapters/manual-entry.int.test.ts » chưa đối chiếu ⇒ Gửi bị chặn RECONCILE_REQUIRED, HĐ giữ DRAFT]
- Kịch bản: khi người được giao tích đã đối chiếu thì lưu người đối chiếu và Gửi duyệt được [test: apps/hub-api/src/modules/packs/contracts/adapters/manual-entry.int.test.ts » đã đối chiếu ⇒ lưu reconciled_by = người gọi (người được giao) và Gửi được, bỏ tích ⇒ lại bị chặn]
- Kịch bản: khi hợp đồng do AI đọc thì không có đối chiếu, người ngoài không đối chiếu được [test: apps/hub-api/src/modules/packs/contracts/adapters/manual-entry.int.test.ts » reconcile: HĐ do AI đọc ⇒ NOT_MANUAL, người ngoài ⇒ forbidden, tenant khác ⇒ not_found]
- Kịch bản: khi hợp đồng nhập tay chưa đối chiếu thì luật chặn Lưu và Gửi duyệt [test: apps/hub-api/src/modules/packs/contracts/domain/manual-entry.rules.test.ts » manual chưa đối chiếu ⇒ chặn]
- Kịch bản: khi đọc lỗi thì Nhập tay là nút trên chính hợp đồng và hiện nhãn Nhập tay cần đối chiếu [test: e2e/contracts-web/cr157-manual-fallback.cw.ts » Đọc lỗi: Nhập tay là nút trên chính HĐ]
- Kịch bản: khi tích ô đã đối chiếu với tệp gốc thì ghi xác nhận [test: e2e/contracts-web/cr157-manual-fallback.cw.ts » Nhập tay chưa đối chiếu: tích ô]
- Kịch bản: khi đã đối chiếu thì nhãn nêu người đối chiếu và người duyệt chỉ thấy nhãn [test: e2e/contracts-web/cr157-manual-fallback.cw.ts » Nhập tay đã đối chiếu: nhãn có tên người đối chiếu]
- Kịch bản: khi hợp đồng đã đối chiếu thì nhãn nêu tên người đối chiếu, chưa đối chiếu thì nêu cần đối chiếu [test: apps/workspace-web/src/features/contract-review/lib/manual-entry.test.ts » đã đối chiếu có tên ⇒ bởi X]
