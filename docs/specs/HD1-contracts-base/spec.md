---
id: HD1-contracts-base
title: Nền dữ liệu hợp đồng (gói contracts)
milestone: GĐ1 · Luồng B (app mẫu mgmt-app)
cr: CR-094
status: done             # Đóng 2026-10-19 (ket-luan.md); facets p95 chờ đo staging
requirements: [HD-FR-01, HD-FR-02, HD-FR-03, HD-FR-04, HD-FR-05, HD-FR-06, HD-FR-07, HD-FR-08, HD-NFR-01, HD-NFR-02, HD-NFR-03, HD-NFR-04]
design: [docs/platform/intake-hd.md#kế-hoạch-lát, docs/specs/N1-pack-frame/spec.md, docs/adr/0016-postgres-source-of-truth.md]
owner: backend-lead
---

# HD1 · Nền dữ liệu hợp đồng

Dựng trên [N1](../N1-pack-frame/spec.md) (khoá gói `contracts`, module `hub-api` — [D-01](spec-decisions.md)). Nguồn: [intake-hd](../../platform/intake-hd.md) lát HD1. `R/` = `reference/mgmt-app-contracts/`. Quyết định: chỉ ở [`spec-decisions.md`](spec-decisions.md).

## 1. Phạm vi
| Làm | Không làm (lát nào) |
|---|---|
| Bảng `contracts`, `contract_items`, `contract_categories`, `contract_reminders`, `contract_events` (+ outbox N1) | Trích trường AI, `verify.py`, tra MST, nhập tay (HD2) |
| API danh sách/lọc, chi tiết, sửa trường, tải lên, lấy file | Flow duyệt, "Đã duyệt"/"Bị từ chối" (HD3) |
| Luật giữ giá trị sửa tay khi trích lại (hàm domain) | Trạng thái theo ngày, tính `action_deadline`, vòng nhắc (HD4) |
| Quyền owner/editor/viewer (N1 PK-FR-05) | UI `contracts-web` + màn danh sách/chi tiết, CRUD loại hàng, phụ lục, áp giá (HD5, D-02) |
| Perf danh sách 10.000 HĐ/tenant | Trợ lý (HD6), lịch thanh toán (HD7), điểm đối tác (HD8), CKS (HD9), chuyển dữ liệu (HD10), nạp OpenSearch |

## 2. Nghiệp vụ
| Mã | Điều kiện chính xác | Nguồn |
|---|---|---|
| HD-FR-01 | `contracts`: id, tenant_id, `kind` ∈ `contract`/`appendix`, `parent_id` (FK kép tự trỏ, chỉ khi `appendix`), title, `type` ∈ `purchase service framework principle`, `direction` ∈ `sale purchase` hoặc null, `status`, error, `owner_user_id` (phụ trách), created_by, created_at, updated_at, `version` (khoá lạc quan), confirmed_at/by, `fields` jsonb, file (id hàng file gói, N1 PK-FR-06), `source_text`, `clauses` jsonb, `warnings` jsonb, `action_deadline` date null, `handled` jsonb null, `run_id` uuid null (run Hub, không FK chéo schema) | `R/api/app/contracts/store.py:14-27`, `fields.py:16`, `remind.py:86-90` |
| HD-FR-02 | `fields` = đúng **23 khoá** `FIELD_KINDS`, mỗi khoá `{value, quote, verified, edited}`; `value` đúng kiểu (`text`/`enum`/`date` ISO/`bool`/`int`/`float`). Khoá thiếu đọc ra rỗng `{null,"",false,false}`, không lỗi; khoá lạ ⇒ 422 `FIELD_UNKNOWN` | `fields.py:3-11`, `store.py:24, 30-35` |
| HD-FR-03 | `status` ∈ `extracting extract_failed needs_review active expiring expired renewed terminated` (+ `rejected`, Q1). `handled.outcome` ∈ `renewed not_renewed negotiating replaced`. HD1 chỉ đặt `extracting` khi tải lên; chuyển khác do HD2–HD4 | `fields.py:19-21` |
| HD-FR-04 | `contract_items`: id, tenant_id, contract_id (FK kép), thứ tự, 11 trường `ITEM_KINDS` (code, name, spec, unit, qty, unit_price, vat_rate, moq, lead_time_days, valid_from, valid_to), `category_id` null (FK kép `contract_categories`). `contract_categories`: id, tenant_id, name ≤ 40, UNIQUE (tenant_id, lower(name)); CRUD + AI xếp loại = HD5 | `fields.py:12-15`, `categories.py:18-44`, `web/src/api/board.ts:13, 24` |
| HD-FR-05 | `contract_reminders`: tenant_id, contract_id (FK kép), `deadline` date, `milestone` int (ngày còn lại), `user_id`, sent_at, channel; **UNIQUE (contract_id, deadline, milestone, user_id)** = khoá idempotency (đổi hạn ⇒ khoá mới). HD1 chỉ bảng; ghi = HD4 | `remind.py:63-65` |
| HD-FR-06 | `contract_events`: id, tenant_id, contract_id (FK kép), `type` (`uploaded`, `field_edited`, … thêm cuối), actor_user_id null (null = hệ thống), at, data jsonb (với `field_edited`: khoá + giá trị cũ/mới). Ghi **cùng tx** với thay đổi + outbox N1 | `store.py:25` (`history`) |
| HD-FR-07 | **API** (đường dẫn do plan; quyền N1): `GET` danh sách (viewer) — lọc `category` (HĐ có ≥ 1 hàng thuộc loại), `owner`, `signer` (khớp không phân biệt hoa/thường/dấu, bỏ dấu cách thừa, trên `supplier_representative`/`buyer_representative`), `status[]`…; phân trang `page`/`page_size`, sắp `sort`/`dir`; trả hàng tóm tắt (cột màn danh sách) + `total` — tham số, mặc định, giới hạn: [plan §1](plan.md) (D-03). `GET` chi tiết (viewer): HĐ + items + 50 event mới nhất. `PATCH` trường (editor): `{version, fields:{khoá: value}}` ⇒ đặt `edited=true`, ghi event; `version` lệch ⇒ 409 `CONTRACT_STALE`. `GET` file (viewer) ⇒ 302 link FileBox 10' | `web/src/pages/contracts/ContractsPage.tsx:15-17`, `ContractPage.tsx:21` |
| HD-FR-08 | **Tải lên** (editor): PDF/DOCX/JPEG/PNG (kiểm magic bytes, không tin đuôi) ⇒ sai `FILE_TYPE` 415; > 20 MB ⇒ 413 `FILE_TOO_LARGE`; tenant đã 30 tệp trong ngày (múi giờ tenant `TenantState.timezone`, mặc định `Asia/Ho_Chi_Minh`, D-16) ⇒ 429 `UPLOAD_QUOTA`; toàn hệ thống 300/ngày ⇒ 429 (Q3). Lưu FileBox `org` tenant, DOCX ⇒ `source_text` (N1 PK-FR-07, lỗi ⇒ `status=extract_failed` + error), tạo HĐ `extracting` + event `uploaded`, gọi port `ExtractionStarter` (HD1: không làm gì; HD2 nối) | `R/api/app/settings.py:84-86` |
| HD-BR-01 | **Giữ giá trị sửa tay khi trích lại**: hàm domain `mergeFields(old, new)` ⇒ mỗi khoá lấy `old` nếu `old.edited`, ngược lại `new`. HD2 dùng; HD1 có unit test | `R/api/app/contracts/ingest.py:63-65` |
| HD-BR-02 | Mọi thành viên có quyền gói thấy mọi HĐ của tenant (Q2); chuỗi quản lý chỉ dùng cho nhắc (HD4) | ADR-0018 §2 |
| HD-BR-03 | **Không port** cách đọc cả tenant vào bộ nhớ rồi lọc (`store.py:50-64`): lọc, sắp, phân trang ở SQL qua index | Luật 4c, intake "Rủi ro" |

## 3. Contract
[plan §1–§2](plan.md): `packages/contracts/src/pack-contracts/`, 7 route `/pack/contracts/contracts…` + `/me` (N1), mã lỗi, phân trang `page/page_size/total` (D-03).

## 4. Dữ liệu
[plan §3](plan.md): `migrations-pack-contracts/0001_init.sql`, 5 bảng + cột sinh lọc (D-07), index từng bộ lọc; đếm tải lên theo ngày bằng Redis (D-06).

## 5. UI
Không có (HD5, D-02).

## 6. Hiệu năng (Luật 4c)
Dữ liệu đo: 3 tenant × 10.000 HĐ, mỗi HĐ 5 items, 20 event; 50 loại hàng/tenant.
| Mã | Ngưỡng | Đo |
|---|---|---|
| HD-NFR-01 | Danh sách: p95 ≤ 50 ms mọi tổ hợp lọc (kể cả không lọc, trang cuối `page=500`), số câu SQL **cố định ≤ 2** (không phụ thuộc số hàng/trang), không quét tuần tự bảng `contracts` | `*.perf.int.test.ts` + đếm câu + `EXPLAIN` |
| HD-NFR-02 | Chi tiết p95 ≤ 30 ms, ≤ 3 câu; PATCH trường p95 ≤ 30 ms, 1 tx, số câu cố định (đọc khoá + cập nhật + event + outbox) | như trên |
| HD-NFR-03 | Tải lên (trừ thời gian mạng FileBox, DOCX theo PK-NFR-02): kiểm quota 1 pipeline Redis (4 lệnh), ghi 1 tx 3 câu | đếm câu |
| HD-NFR-04 | Mọi route: 0 HTTP nội bộ (N1 PK-BR-01); cách ly 2 tenant mọi bảng 0 hàng lộ | int RLS |

## 7. Phụ thuộc & giả lập
FileBox mock (FB1) · DOCX mẫu `R/samples/HD-bao-bi-Minh-Phat.docx` · seed perf sinh bằng một câu `INSERT … SELECT generate_series` (không vòng lặp).

## 8. Tiêu chí nghiệm thu
| AC | Given / When / Then | Mã |
|---|---|---|
| HD-AC01 | Tenant A có HĐ; user tenant B gọi chi tiết/sửa/file bằng id của A ⇒ 404; danh sách B không chứa HĐ của A | NFR-04 |
| HD-AC02 | Item tenant B trỏ HĐ tenant A ⇒ lỗi FK kép | FR-04 |
| HD-AC03 | Lọc `category_id`=X ⇒ chỉ HĐ có ≥ 1 item loại X; kết hợp `status[]`+`owner_user_id` ⇒ giao các điều kiện | FR-07 |
| HD-AC04 | `signer`=" nguyễn văn  a " khớp `buyer_representative`="Nguyễn Văn A" | FR-07 |
| HD-AC05 | 120 HĐ, `page_size`=50 ⇒ `page=1..3` có 50/50/20, `total`=120, không trùng, không sót; trang 4 rỗng | FR-07 |
| HD-AC06 | PATCH `total_value` ⇒ `edited=true`, event `field_edited` có cũ/mới, 1 hàng outbox; `version` cũ ⇒ 409 `CONTRACT_STALE` | FR-06, FR-07 |
| HD-AC07 | PATCH khoá lạ / sai kiểu (`notice_days`="abc") ⇒ 422 | FR-02 |
| HD-AC08 | `mergeFields`: old `{number:{edited:true,value:"A"}}`, new `{number:{value:"B"}}` ⇒ "A"; khoá không edited ⇒ lấy new | BR-01 |
| HD-AC09 | Viewer gọi PATCH/tải lên ⇒ 403 `PACK_FORBIDDEN`; editor được | FR-07, FR-08 |
| HD-AC10 | Tải 21 MB ⇒ 413; tệp `.pdf` nội dung EXE ⇒ 415; tệp thứ 31 trong ngày của tenant ⇒ 429; tenant khác vẫn tải được | FR-08 |
| HD-AC11 | Tải DOCX mẫu ⇒ HĐ `extracting`, `source_text` có tiêu đề điều khoản, event `uploaded`, file `org=t_<tenant>`; DOCX hỏng ⇒ `extract_failed` | FR-08 |
| HD-AC12 | HĐ cũ thiếu khoá `buyer_representative` trong `fields` ⇒ chi tiết trả rỗng, không lỗi | FR-02 |
| HD-AC13 | Chèn 2 hàng `contract_reminders` cùng (HĐ, hạn, mốc, user) ⇒ hàng 2 bị UNIQUE chặn; khác hạn ⇒ được | FR-05 |
| HD-AC14 | Perf HD-NFR-01/02 đạt trên dữ liệu đo; báo số thật | NFR-01, 02 |

## 9. Câu hỏi mở (mỗi câu có mặc định)
| # | Câu | Mặc định đề xuất |
|---|---|---|
| Q1 | Thêm `rejected` (intake câu 4) ngay HD1 hay HD3? | Ngay HD1 (thêm cuối enum) để HD3 không dựng lại CHECK |
| Q2 | Viewer thấy mọi HĐ tenant hay theo chuỗi quản lý? | Mọi HĐ tenant (HD-BR-02) |
| Q3 | Giữ trần toàn hệ thống 300 tệp/ngày (`settings.py:86`)? | Giữ, cấu hình env; lỗi 429 cùng mã |
| Q4 | Trường lọc trong `fields` jsonb hay cột riêng? | Plan chọn (cột sinh/biểu thức index) miễn đạt HD-NFR-01 |
| Q5 | Xoá HĐ trong HD1? | Không — HD5 (cần dọn reminder/event/outbox/FileBox) |
| Q6 | Ảnh: định dạng nào? | JPEG, PNG; HEIC/WebP ngoài phạm vi |
| Q7 | Keyset (`next_cursor`) hay `page/page_size/total` (S03 cần tổng + trang số)? | `page/total` (D-03); AC05 đổi theo |
| Q8 | Danh bạ thành viên gói (tên người phụ trách) làm ở đâu? | HD5 làm, code ở `packs/kit` (N1 spec:26) |

Q1–Q8 đóng: D-04…D-09 (Q1–Q6), D-03 (Q7), N1 (Q8).

## 10. Quyết định
[`spec-decisions.md`](spec-decisions.md).

## 11. Tranh chấp test
- T10 · `upload.int.test.ts:94` kỳ vọng FileBox POST trả `200`, nhưng FB giả `FB1/_fbfake.ts` trả `201` cho `POST /files` ⇒ đỏ dù code đúng (org/auth khớp). Đề xuất qc: kỳ vọng `201`. **ĐÃ XỬ (qc 2026-10-19, d8098aa0; review m-12):** phiên chính quyết: test kiểm hành vi Hub (upload OK, hàng `files` + HĐ + event đúng), không kiểm mã thô của FileBox; `upload.int.test.ts` nay chỉ yêu cầu FileBox POST trả 2xx (thật 200, giả 201), khớp `filebox.client.ts:48` (client nhận mọi 2xx). Không sửa `_fbfake.ts`, không sửa `apps/**`.
- T10 · `upload.int.test.ts:244` (`noNew`) và `:416` kỳ vọng `c.fb.ids()` rỗng, nhưng `fb.reset()` (`_fbfake.ts:235`) không xoá `files` ⇒ còn tệp hợp lệ của ca trước trong cùng file. Chạy riêng (`-t "PARENT|ghi DB lỗi"`, từng ca) xanh. Đề xuất qc: so `ids()` trước/sau, hoặc `reset()` xoá `files`. **ĐÃ XỬ (qc 2026-10-19):** thêm `fb.wipe()` vào `_fbfake.ts`, `arrange()` (HD1 `_support/hd1.ts`) gọi sau `reset()` — `reset()` giữ nguyên cho FB1.
