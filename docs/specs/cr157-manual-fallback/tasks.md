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

## CR-157b (làm tiếp sau soát Opus)
| # | Việc | Xong |
|---|---|---|
| M1 | «Trích lại» ở lượt duyệt (`approval.repo.ts` markQ) xoá `reconciled_*` | [x] |
| M3 | Lưu sửa trường HĐ manual (PATCH trường; `/review` khi trường đổi) xoá `reconciled_*` ⇒ tích lại | [x] |
| M2 | Đọc lại bằng AI GIỮ `entry_source = manual` (điều phối chốt) | [x] |
| M4 | Sửa comment `submit.usecase.ts`, `manual-entry.rules.ts` (Lưu nháp không bị chặn) | [x] |
| M5 | `setReconciled` + `reconcileTx` chỉ khi `extract_state = ready` (409 `MANUAL_NOT_ALLOWED`) | [x] |
| UI | Gửi duyệt / «Xác nhận & lưu» tắt khi chưa tích (hoặc có sửa chưa lưu); tệp gốc cạnh form (desktop 2 cột, `ManualSide` dùng `Viewer` CR-149; mobile giữ nút xem) | [x] |
| Q1 | `POST /contracts/:id/replace-file` (`createReplaceFile`: dùng lại kiểm tệp/quota/FileBox/đổi chữ của tải lên; người tạo ∪ phụ trách; DRAFT + failed) + nút «Tải tệp khác» | [x] |
| Q4 | Gợi ý theo từng trường khi AI đọc lại HĐ manual | chưa (xem Việc còn lại) |

### Quyết định trong lúc làm (b)
- M2: đọc lại bằng AI không đổi `entry_source` (HĐ vẫn «nhập tay», phải đối chiếu lại vì `reconciled_*` bị xoá).
- M3 ở `/review`: chỉ xoá khi `fields` đổi so với DB (`is distinct from`), để «Xác nhận & lưu» ngay sau khi tích không tự xoá tích.
- Q1: thay tệp = một câu CTE (khoá HĐ → `files` → UPDATE `file_id`/`source_text`/`extract_state`/`error`, xoá `reconciled_*`, version +1 → event `file_replaced`); sau commit `starter.start` như tải lên (`flow: false`, không phát `contract.uploaded`). Tệp cũ giữ trong `files` (lịch sử). Quota tải lên tính như một lượt tải.
- Form có sửa chưa lưu ⇒ ô tích bị khoá + nút tắt (vì lưu sửa xoá tích): người dùng Lưu nháp rồi tích lại.
- Cột tệp gốc cạnh form vẫn dựng (CSS ẩn) trên điện thoại ⇒ có thể tải tệp thừa; chấp nhận, ghi nợ nếu thấy chậm.

## Việc còn lại
- Q4 gợi ý theo từng trường (AI đọc lại HĐ manual, người dùng bấm «Dùng» hoặc bỏ qua): chưa làm (cần lưu kết quả AI riêng + UI từng ô); hiện ô đã sửa được giữ, ô trống được AI điền.
- Test `/review` đổi trường xoá đối chiếu chưa có int riêng (chỉ PATCH trường); logic cùng mẫu SQL.

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
- Kịch bản: khi HĐ nhập tay đã đối chiếu mà người dùng sửa trường rồi lưu thì xoá đối chiếu, phải tích lại [test: apps/hub-api/src/modules/packs/contracts/adapters/manual-entry-b.int.test.ts » sửa trường HĐ manual đã đối chiếu ⇒ xoá đối chiếu]
- Kịch bản: khi bấm Trích lại lúc HĐ đang ở lượt duyệt thì xoá đối chiếu [test: apps/hub-api/src/modules/packs/contracts/adapters/manual-entry-b.int.test.ts » Trích lại khi HĐ đang ở lượt duyệt ⇒ xoá reconciled_by và reconciled_at]
- Kịch bản: khi AI đang đọc hoặc đọc lỗi thì không đối chiếu được [test: apps/hub-api/src/modules/packs/contracts/adapters/manual-entry-b.int.test.ts » extract_state khác ready (đang đọc hoặc lỗi) ⇒ MANUAL_NOT_ALLOWED]
- Kịch bản: khi HĐ nháp đọc lỗi thì người tạo hoặc người được giao tải tệp khác, AI đọc lại và bỏ đối chiếu [test: apps/hub-api/src/modules/packs/contracts/adapters/manual-entry-b.int.test.ts » DRAFT + failed, người được giao (không phải người tạo) ⇒ thay tệp]
- Kịch bản: khi người ngoài hoặc công ty khác gọi thay tệp thì bị từ chối hoặc không thấy hợp đồng [test: apps/hub-api/src/modules/packs/contracts/adapters/manual-entry-b.int.test.ts » người ngoài ⇒ FORBIDDEN, tenant khác ⇒ NOT_FOUND]
- Kịch bản: khi hợp đồng đang đọc, đã đọc xong hoặc không còn nháp thì không thay tệp được [test: apps/hub-api/src/modules/packs/contracts/adapters/manual-entry-b.int.test.ts » sai trạng thái (đang đọc, đã đọc xong, không còn nháp) ⇒ REPLACE_NOT_ALLOWED]
- Kịch bản: khi nhập tay chưa tích đối chiếu thì nút Xác nhận và lưu tắt, tích xong thì bật [test: e2e/contracts-web/cr157-manual-fallback.cw.ts » Nhập tay chưa đối chiếu: nút Xác nhận và lưu tắt]
- Kịch bản: khi nhập tay trên màn rộng thì tệp gốc hiện cạnh form [test: e2e/contracts-web/cr157-manual-fallback.cw.ts » Nhập tay trên màn rộng: tệp gốc hiện cạnh form]
- Kịch bản: khi đọc lỗi thì bấm Tải tệp khác gửi tệp để thay [test: e2e/contracts-web/cr157-manual-fallback.cw.ts » Đọc lỗi: Tải tệp khác gửi tệp tới replace-file]
