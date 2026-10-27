---
id: DOC-deals
lát: A2 (backend + chuyển dữ liệu)
cr: CR-101 (Intake 2026-10-27 R1, R5–R10, R37, R40 API; X1–X3; Câu 1, 3, 4, 7, 12)
làn: đầy đủ (tiền/kho, chuyển dữ liệu khách thật; Opus)
migration: 0056_doc_deals (journal idx 52, when 1799000000000)
phụ thuộc: DOC-model đã merge
---
# DOC-deals — Giao dịch hợp nhất vào chứng từ + nâng thành HĐ

## Plan (ngắn)
Giao dịch = hàng `contracts` với `doc_type='deal'` (file không bắt buộc, có `source`). Dùng chung mốc/kho/điểm/xoá/danh sách. Lưu là có hiệu lực, sửa trực tiếp, máy ghi lịch sử (không bắt lý do). Nâng thành HĐ = đổi `doc_type` → `contract` + gắn file ký + số HĐ, giữ id/mốc/kho/điểm, khoá ngay (K1). Bảng G1 `transactions*` thành chỉ đọc sau khi chuyển.

## Số liệu prod (điều phối đọc 2026-10-27)
`transactions`: demo 2, tenant khác 0. `contracts` kind=contract: demo 17 (`file_id` null 16, có file 1), titi-group-company 3 (null 2, có 1), nitigroup 0. Phụ lục (`parent_id`) 0.
**Lưu ý:** `file_id` null KHÔNG chắc là "HĐ nhập tay không file" (file có thể nằm ở bảng phiên bản/nơi khác). Script dry-run phải xác định đúng tập "không có file" theo NGUỒN THẬT (file_id, bảng phiên bản/tài liệu, `source`/K3 nhãn "Chưa có văn bản") rồi mới chuyển; mơ hồ ⇒ không chuyển, báo.

## Làm
| # | Việc | Ghi chú |
|---|---|---|
| 1 | 0056: `contracts.source` (invoice\|verbal\|message\|quote\|other), `file_id` cho phép null với `deal` (CHECK: `contract`/`framework` vẫn bắt buộc file hoặc nhãn K3), `deal` ∈ {buy,sell,referral}; `contract_edit_log` (ai, khi nào, trường, cũ→mới); `obligations.transaction_id`/`stock_moves.transaction_id` trỏ lại `contract_id` trong cùng tx; bỏ CHECK "đúng một trong contract_id/transaction_id" cho hàng chuyển; bảng G1 chỉ đọc (trigger chặn ghi) | giữ cột cũ để đối chiếu |
| 2 | Script `scripts/migrate-transactions-to-contracts.ts`: `--dry-run` (mặc định) in đếm: giao dịch cần chuyển, dòng, nghĩa vụ, `stock_moves`, HĐ nhập tay không file (theo nguồn thật, kèm danh sách id); `--apply` chạy trong một transaction mỗi tenant, giữ id, lặp lại vô hại (idempotent), kết thúc in đếm trước = sau | Opus; set-based, số câu SQL cố định |
| 3 | Chuyển hàng G1: nháp → giao dịch chưa xác nhận mốc; đã ghi sổ → mốc thanh toán + đợt giao đã xác nhận (kho không chạy lại, không đảo); huỷ → giữ trạng thái huỷ; `partner_event_voids` giữ | D2–D7 của GD-transactions bị thay |
| 4 | HĐ nhập tay cũ không có file → `deal` (nguồn "Khác", giữ id/mốc/kho); nâng lại khi có file ký (Câu 7). **Chỉ sau khi người dùng xem số dry-run**; mơ hồ ⇒ giữ nguyên | CHỜ số thật |
| 5 | Mốc mặc định giao dịch như HĐ cùng hướng (giao hàng + thu/trả; Giới thiệu: nhận hoa hồng); kho chạy khi xác nhận mốc giao; ô "Đã giao / đã thanh toán ngay" tự xác nhận mốc khi lưu (Câu 4) | tái dùng `delivery-opts` (vượt tồn chung) |
| 6 | API: `POST /contracts` nhận `doc_type='deal'` + `source` + file tuỳ chọn; `PATCH` sửa trực tiếp (ghi `contract_edit_log`); `POST /contracts/:id/promote` (file ký + số HĐ bắt buộc); xoá deal = luồng V2-M (xem trước, đảo kho, chỉ owner) | Câu 3, X2/X3 |
| 7 | `/pack/contracts/transactions*` giữ làm lớp tương thích đọc (GET) → map sang `contracts`; ghi ⇒ 410 `USE_CONTRACTS` | G2 UI cũ gỡ ở DOC-ui-list |
| 8 | Đối tác tự tạo/nhận vai theo hướng (V2-C) áp cho giao dịch; HĐ NT làm cha: cùng đối tác + hướng (DOC-model) | R40 |

## Không làm
Cảnh báo pháp lý/ngưỡng (DOC-legal), mọi UI, lọc/nav, xoá bảng G1, HD9.

## Chạm (lát khác KHÔNG sửa)
MG `0056_doc_deals.sql`; `scripts/migrate-transactions-to-contracts.ts`; `H/domain/transactions.rules.ts` (đóng băng, chỉ tái dùng luật sang `deal.rules.ts`); `H/application/transactions*` (thành lớp tương thích), `create-contract*` (chỉ phần `deal`, sau DOC-model), `promote-contract.usecase.ts` (mới), `delete-contract*`, `stock.repo.ts`, `products.mount.ts` (route transactions), `tests/acceptance/GD/*`.

## Test tối thiểu
Unit `deal.rules.test.ts`; int đường chính: tạo deal → xác nhận mốc giao (kho đổi) → sửa trực tiếp (có log) → nâng thành HĐ (id/mốc/kho giữ) → xoá (kho đảo); int script: dry-run đếm đúng + apply idempotent (chạy 2 lần, số hàng không đổi); một test chéo tenant cho `contract_edit_log`; GD int cũ viết lại hoặc xoá. Không chạy e2e.

## Quyết định trong lúc làm (2026-10-27)
- **Script** ở `tools/scripts/src/migrate-transactions-to-contracts.ts` (+ `migrate-transactions.rules.ts`; chỗ của mọi script dữ liệu, như `d1-backfill`), không ở `scripts/`. `--tenant <khoá>` (lặp) | `--all`; mặc định CHẠY THỬ trong giao dịch `READ ONLY` (an toàn cho prod chỉ đọc); `--apply` = MỘT transaction cho mọi tenant đã chọn, 8 câu ghi theo tập + 2 câu đo (số câu cố định), cuối tx đo lại: kế hoạch phải rỗng + số ghi = số kế hoạch, lệch ⇒ huỷ. Idempotent nhờ `not exists`/`contract_id is null`/id mốc tất định `md5('g1-delivery:'||id)`.
- **Ánh xạ G1**: nháp ⇒ `active` + mốc giao + mốc tiền MỞ (tiền trống ⇒ 5.4a chia từ giá trị); đã ghi sổ ⇒ `active` + nghĩa vụ G1 trỏ lại `contract_id` (giữ `transaction_id`) + mốc giao ĐÃ XÁC NHẬN (ngày phát sinh) gắn dòng kho G1 (`milestone_id`) + `milestone_items.delivered` = SL dòng — kho không chạy lại; đã huỷ ⇒ `rejected` (loại khỏi số liệu như HĐ bị từ chối; `contracts` không có trạng thái "huỷ"), nghĩa vụ huỷ + kho đảo giữ. Dòng hàng GIỮ id (`stock_moves.contract_item_id`). Nguồn = `other`. Ghi chú/người giữ/lô/HĐ liên kết G1/lý do huỷ ⇒ event `migrated_from_transaction` (HĐ liên kết G1 không thành `frame_root_id` — HĐ NT là khái niệm khác). Trùng id chứng từ khác / không rõ người tạo ⇒ không chuyển, báo.
- **Câu 7** chỉ BÁO: tập "chắc chắn" = HĐ kinh tế hiện hành mà cả chuỗi không `file_id`, không `source_text`, không file ký số (`esign_envelopes.signed_file_id`), không event `uploaded`, CÓ event `created_manual`; còn lại có `file_id` trống ⇒ "mơ hồ" kèm lý do (`source_text`/`esign_file`/`upload_event`/`no_manual_event`). Không có cờ chuyển (chờ người dùng xem số; dữ liệu demo seed thẳng DB không có `created_manual` ⇒ sẽ ra "mơ hồ").
- **0056**: CHECK file bắt buộc cho `contract`/`framework` KHÔNG đặt ở DB (HĐ nhập tay cũ không file trên prod + nhãn K3 suy khi đọc; NITI import). Thay bằng trigger nâng (`deal → contract` phải có `file_id` + số, `EK422 PROMOTE_NEEDS_FILE|NUMBER`) + API (tạo HĐ nhập tay vẫn 410). K1: trigger khoá bỏ qua `doc_type = 'deal'`; nâng đổi `doc_type` ⇒ K1 khoá trong CÙNG câu. `contract_edit_log` không FK sang `contracts` (D9-02, như obligations/esign), RLS: thấy khi thấy chứng từ; ghi bằng trigger AFTER UPDATE (mọi đường sửa, kể cả nâng) — `fields.<khoá>` so `value` + cột chứng từ. G1 chỉ đọc = thu quyền ghi `contracts_rw` + trigger `EG410 USE_CONTRACTS` (bỏ qua khi phiên đặt `contracts.g1_legacy_write = on`, chỉ cho test dựng dữ liệu cũ). Bộ RLS gói: 3 bảng G1 vào `v2IgnoreTables`, thêm `contract_edit_log`.
- **API**: tạo = `POST /contracts/deals` (JSON; không gộp vào `POST /contracts` multipart để không rẽ nhánh theo content-type) — trường như nhập tay + `deal` bắt buộc + `source` + `settled_now`; luôn `active` (bỏ qua cờ duyệt), event `created_deal`. File khi tạo: chưa nhận (gắn file = nâng). `settled_now` (Câu 4) = xác nhận lần lượt mốc mặc định qua lệnh `settle` của sổ (giao trước ⇒ kho + vượt tồn chung delivery-opts); lỗi ⇒ giao dịch vẫn lưu, trả `settle_error`, mốc còn lại mở. Sửa trực tiếp = `PATCH /contracts/:id/fields` sẵn có (deal không khoá). Lịch sử = `GET /contracts/:id/edit-log`. Nâng = `POST /contracts/:id/promote` multipart (`file` + `number`): FileBox → một CTE (khoá hàng + files + UPDATE + event `promoted`), không AI đọc lại; không phải giao dịch hiện hành ⇒ 409 `NOT_A_DEAL`. Xoá = `DELETE /contracts/:id` V2-M sẵn có (kho đảo theo `contract_id`). Đối tác/vai (V2-C) tự theo trigger `contracts_v2c_roles_*` vì giao dịch là hàng `contracts`.
- **Tương thích `/transactions`**: GET đọc chứng từ `deal` (Mua/Bán, bản hiện hành) theo hình DTO G1 (`rejected` ⇒ `cancelled`, còn lại `posted`, `rev` 0, `events` rỗng, `contract_id` lọc theo `frame_root_id`); POST/PATCH/PUT/DELETE ⇒ 410 `USE_CONTRACTS`. Code ghi G1 (`transactions.repo/usecase/ports/routes`) xoá; `transactions.rules.ts` giữ (đóng băng); `stock.repo.ts::reverseTransactionStock` còn nhưng không ai gọi. GD int cũ xoá (thay bằng `tests/acceptance/DOC-deals/*`).

## Việc còn lại
- [x] 1–3, 5–8 (backend). Test: `tests/acceptance/DOC-deals/{migrate,deals}.int.test.ts`, unit `deal.rules.test.ts`, `migrate-transactions.rules.test.ts`.
- [ ] 4 (Câu 7): chuyển HĐ nhập tay không file ⇒ giao dịch — CHỜ người dùng xem số dry-run prod; chưa có cờ ghi.
- [ ] Prod: chạy dry-run `--tenant demo --tenant titi-group-company` (chỉ đọc) gửi số cho điều phối trước `--apply` (hard stop dữ liệu khách). DB local: 0 giao dịch G1, 0 HĐ không file.
- [ ] UI (DOC-ui-list / DOC-ui-frame): form giao dịch → `POST /contracts/deals` (`source`, `settled_now`, hiển thị `settle_error`); nút "Nâng thành hợp đồng" → multipart `/promote`; Diễn biến đọc `/edit-log`; gỡ G2 (`apps/contracts-web/src/features/transactions/*`, route `/transactions*` chuyển hướng) — e2e `e2e/contracts-web/transactions.cw.ts` sẽ đỏ (ghi 410) tới khi gỡ.
- [ ] Review cuối đợt: trigger `contract_edit_log` chạy SECURITY INVOKER — vai nền khác `contracts_rw` (vd `contracts_job`) sửa trường giao dịch sẽ thiếu quyền INSERT (hiện không có đường nào như vậy).

## Sửa sau review cuối đợt (doc-deals-fix, 2026-10-27)
- (1) Nâng khi tenant BẬT duyệt ⇒ HĐ về `needs_review` (không khoá) + mở lượt duyệt cấp 1 bằng `startApproval` của nhập tay (engine nếu công ty có entitlement, máy cũ nếu không); TẮT ⇒ `confirmed_*` = người nâng ⇒ K1 khoá ngay, `locked_by` = người nâng. Không đổi trigger 0056 (đủ bằng câu UPDATE). Phản hồi `/promote` thêm `status`, `locked` thành boolean.
- (2) Seed demo: giao dịch = 2 chứng từ `deal` (mốc mở + đã giao), bỏ ghi bảng G1; `V2-O/seed-demo` 17 → 19 HĐ.
- (3) Nâng: kiểm thấy-được + là giao dịch hiện hành TRƯỚC FileBox; trừ hạn mức tải lên/ngày (dùng chung `takeQuota`), hoàn khi không nâng được.
- (4) Tải lên multipart `doc_type=deal` ⇒ 400 `DEAL_USE_DEALS_ENDPOINT`.
- (5) "Đã giao / đã thanh toán ngay" dùng `ledgerDeps` chung với route sổ ⇒ `repDelta` (cờ v2e) lưu như xác nhận thường.
- (6a) KHÔNG đổi: gắn HĐ NT lên HĐ đã khoá là chủ ý của DOC-model (R30 "gắn chứng từ có sẵn" — chứng từ có sẵn thường đã xác nhận; test DOC-model khoá con trước khi gắn); liên kết khung là quan hệ tổ chức, không phải trường pháp lý K1.
- (6b) KHÔNG phải lỗi: xoá V2-M giao dịch đã huỷ chuyển từ G1 chỉ đảo dòng `delivery` chưa có dòng đảo ⇒ kho giữ số ròng (int tái hiện xanh).
- K4 (CR-101a): tải lên `kind=appendix` ⇒ 410 `USE_VERSIONS` trước quota/FileBox (`upload-contract.usecase.ts`); HD1 upload int ca phụ lục viết lại.