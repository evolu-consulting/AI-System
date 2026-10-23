---
id: K1-lock
cr: CR-097 (đợt 1)
items: R5, R12, R13, R17, X2, X3, decision 1 (R8/R19 phía API); R47 mã HD-FR-100 (khoá), HD-FR-104 (mở lại)
lane: đầy đủ (quyền, audit, dữ liệu khách) — test khoá/quyền viết TRƯỚC code
migration: 0048_k1_contract_lock (journal when 1797700000000)
---
# K1 — Khoá cứng sau xác nhận + owner mở lại có log

## Plan (đã làm)
- [x] Unit `domain/lock.rules.test.ts` + int `tests/acceptance/K1/lock.int.test.ts` viết trước (6 ca: bật duyệt finalize ⇒ khoá; tắt duyệt "Lưu" ⇒ khoá; PATCH khoá ⇒ 409; reopen editor 403 / thiếu lý do 400 / owner ⇒ Chờ duyệt + log + lượt mới, lần 2 ⇒ 409, duyệt lại ⇒ khoá lại; chéo tenant 404; nhập tay 410).
- [x] Migration 0048: cột `locked_at`, `locked_by`; backfill; trigger `contracts_k1_lock`.
- [x] `lock.rules.ts` (thuần) + PATCH fields / PUT commission ⇒ 409 `CONTRACT_LOCKED`; bỏ D3-13 (sửa ⇒ tự mở lại duyệt).
- [x] `POST /pack/contracts/contracts/:id/reopen` (owner = quyền `admin` gói).
- [x] `POST /contracts/manual` ⇒ 410 `MANUAL_CONTRACT_DISABLED` (usecase `createManual` giữ, cờ `manualEnabled` cho G1).
- [x] DTO: ListRow `locked`; Detail `locked_at`, `locked_by`, `has_document`.

## Quyết định trong lúc làm
- **K1-01 khoá ở DB (trigger) thay vì từng đường code:** bất biến "trạng thái đã xác nhận (active/expiring/expired/renewed/terminated) ⇒ `locked_at` có giá trị". Trigger BEFORE INSERT/UPDATE `WHEN (NEW.locked_at IS NULL AND status ∈ đã xác nhận)` lấp `locked_at = coalesce(confirmed_at, now())`, `locked_by = confirmed_by`. Bao mọi đường: "Lưu" khi tắt duyệt (`review.repo` → `active`), finalize máy duyệt (`approval.repo`), contract-flow engine (S2/S5), CKS, import NitiGroup. "Xác nhận" = nhóm `CONFIRMED_STATUSES` + cờ khoá (R13 mặc định b, không thêm trạng thái).
- **K1-02 backfill:** HĐ đã xác nhận hiện có ⇒ `locked_at = coalesce(confirmed_at, updated_at)`, `locked_by = confirmed_by` (import cũ có thể null). Một câu UPDATE, cột cộng thêm — dữ liệu NitiGroup đọc như cũ, hành xử như đã khoá.
- **K1-03 trường sửa được khi khoá:** trong 23 trường chỉ `notice_days` (số ngày báo trước, nuôi nhắc hạn HD4). Mọi trường khác (số, tên, bên/MST, ngày, giá trị/VAT, điều khoản) ⇒ 409 cho mọi người kể cả owner; lẫn trường vận hành + pháp lý ⇒ 409 cả lượt. Hoa hồng (`PUT /commission`) = điều khoản tiền ⇒ khoá.
- **K1-04 vẫn sửa được khi khoá (vận hành, endpoint riêng, không đổi):** người phụ trách `PUT /contracts/:id/owner`; đã xử lý `POST /contracts/:id/handled`; tóm tắt AI; mốc/sổ: `POST /contracts/:id/milestones`, `PATCH|DELETE /milestones/:id`, `PUT /contracts/:id/schedule`, `POST /obligations/:id/settle|postpone|remind`, `POST /partner-events` (ghi việc với đối tác), void; gắn SP dòng hàng `PUT /contracts/:id/items/:itemId/product`, `POST /contracts/:id/product-links`; gắn HĐ gốc `PATCH /contracts/:id/parent` (tổ chức, không phải nội dung văn bản); xoá HĐ (owner, V2-M — K2 xét X5).
- **K1-05 reopen:** MỘT câu CTE: khoá hàng → (tenant bật duyệt + chưa có lượt sống) mở lượt `level1` do owner bắt đầu → `status = needs_review`, bỏ `locked_*` + `confirmed_*`, gắn `run_id` mới, version+1 → event `reopened {reason, from_status, run_id}` (+ `approval_started {reopened:true}`) trong `contract_events` (lịch sử HĐ, `GET /contracts/:id/history`). Tắt duyệt ⇒ không mở lượt, editor "Xác nhận" lại. Lý do 1…500 ký tự (trim). Không khoá ⇒ 409 `CONTRACT_NOT_LOCKED`.
- **K1-06 X3 (Lưu nháp / Xác nhận và khoá):** API giữ nguyên hình: tắt duyệt ⇒ `POST /contracts/:id/review` = Xác nhận (khoá ngay); bật duyệt ⇒ `review` = lưu nháp, khoá khi duyệt xong. Nút "Lưu nháp" riêng khi tắt duyệt (không chuyển trạng thái) để K3 quyết (dùng `PATCH /fields` cho nháp).
- **K1-07 nhập tay:** chặn cho mọi tenant (không cờ môi trường). `has_document = file_id is not null` (HĐ nhập tay cũ + HĐ dán chữ không tệp ⇒ false).

## K2 / K3 cần biết
- Endpoint mới: `POST /pack/contracts/contracts/:id/reopen` body `{reason: string 1..500}` ⇒ 200 `{id, status:"needs_review", version, locked:false}`; 400 thiếu lý do; 403 không phải owner; 404 không thấy / tenant khác; 409 `CONTRACT_NOT_LOCKED`. Schema `ReopenRequestSchema`/`ReopenResponseSchema`, mã `LOCK_ERRORS` (`@ai/contracts` `pack-contracts/lock.ts`).
- Lỗi: `PATCH /contracts/:id/fields`, `PUT /contracts/:id/commission` ⇒ 409 `CONTRACT_LOCKED` khi khoá; `POST /contracts/manual` ⇒ 410 `MANUAL_CONTRACT_DISABLED`.
- DTO: `ContractListRow.locked: boolean` (ListRow 20 khoá); `ContractDetail.locked`, `locked_at: ISO|null`, `locked_by: uuid|null`, `has_document: boolean`.
- K2: phiên bản mới (v n+1) tải lên phải ra `needs_review` (không khoá); xác nhận v n+1 tự khoá qua trigger. Trigger không đụng `superseded` (K2 thêm cột riêng).
- K3: banner "Đã xác nhận — đã khoá" theo `locked`; link "Mở lại…" chỉ khi `/me.actions` có `admin`; nhãn "Chưa có văn bản" theo `has_document=false`; bỏ nút "Thêm thủ công"; e2e `v2f-form`, `hd2-flow` (gọi `/contracts/manual`) và `e2e/contracts-web/dataset-contract.ts` (fixture detail thiếu `locked*`/`has_document`) cần sửa ở K3. Script UAT `docs/uat/cr095/scripts/*` còn gọi nhập tay.

## Tranh chấp test / đổi theo CR-097 (qc trong lát, đã relock `tests/.lock`)
| File | Đổi |
|---|---|
| `tests/acceptance/HD3/guard.int.test.ts` | 2 ca D3-13 (sửa ⇒ mở lại duyệt) ⇒ 1 ca: HĐ Đã duyệt sửa ⇒ 409 `CONTRACT_LOCKED`, không event |
| `tests/acceptance/HD3/reverify.int.test.ts` | "mở lại không mồ côi" chuyển từ PATCH (D3-13) sang owner `POST /reopen` (lỗi giữa chừng ⇒ rollback) |
| `tests/acceptance/HD1/patch.int.test.ts`, `hops.int.test.ts`, `perf/rw.perf.int.test.ts` | HĐ được PATCH đổi sang `needs_review` (HĐ active bị khoá) |
| `tests/acceptance/HD1/list.int.test.ts`, `HD5/hd5.int.test.ts` | ListRow 19 ⇒ 20 khoá (`locked`) |
| `tests/acceptance/GAP-A1/manage.int.test.ts` | sửa hoa hồng trên HĐ chưa khoá; thêm: HĐ active ⇒ 409 `CONTRACT_LOCKED` |
| `tests/acceptance/HD2/manual.int.test.ts` | HD-FR-26 ngừng: mọi người ghi ⇒ 410, viewer 403 |
| `tests/acceptance/V2-F/manual-items.int.test.ts` | nhập tay gắn SP ⇒ 410 |
| `tests/acceptance/V2-A/_support/v2a.ts`, `money.int.test.ts` | helper `manual` dựng HĐ chờ xác nhận + `POST /review` (cùng luật mốc/hoa hồng); HD-09 sửa sau lưu ⇒ 409; thân nhập tay ⇒ 410 |
| `tests/acceptance/V2-G/review.int.test.ts` | ca "dòng gắn SP" dựng bằng `seedReview` + `PUT …/product` thay nhập tay |

## Kết quả
- Unit gói contracts: 836 pass. Int đã chạy (`test:int:par`): K1 (6) + 15 file bị ảnh hưởng (HD1 patch/hops/list/rls/detail/columns, HD5, HD3 guard/reverify/flow, HD2 extract/manual, HD7, V2-A, V2-F, V2-G review/ai-read, GAP-A1, P-d wait-def) — xanh. Perf `rw.perf` không chạy (không thuộc lát).
- Còn lại: e2e + `test:all` cuối đợt; K3 UI; review + security gộp cuối đợt.
