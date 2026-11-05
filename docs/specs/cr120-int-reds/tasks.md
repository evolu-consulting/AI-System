---
id: cr120-int-reds
lát: cr120-int-reds
cr: CR-120
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Run int đầy đủ CR-120 (gd0 1d195a82): 4184 xanh, 24 đỏ (22 mới). Phân loại từng file (a = lỗi sản phẩm, b = test còn khẳng định hành vi cũ, c = môi trường/có sẵn ở base 74569ac7), sửa, chạy lại đúng các file đó MỘT lượt.

## Làm
| File | Lớp | Nguyên nhân → sửa |
|---|---|---|
| packages/db hub-h2c, hub-h3a, hub-h3b int | a | Chạy lại 0068 sau 0091: tên `process_slot_assignments` giờ là VIEW ⇒ `CREATE INDEX`/`ENABLE RLS`/policy/`GRANT` trên view lỗi ("cannot create index on relation"). Sửa `migrations-hub/0068_process_library.sql`: phần của bảng gán cũ chỉ chạy khi tên đó còn là bảng (`relkind='r'`). Không đổi gì với DB mới/đã áp (journal đã áp thì không chạy lại). |
| packages/db hub-h4b2, hub-k1 int | c (đỏ cả ở base 74569ac7: 0071 đã nới CHECK `entity`, chạy lại 0029/0030 đặt về danh sách hẹp) | Sửa `0029_k1_kh.sql`, `0030_h4b2_models.sql`: chỉ (re)đặt CHECK `hub_audit_log_entity_check` khi chưa có giá trị mới nhất của chính migration đó (cùng kiểu guard của 0071). Khẳng định của test giữ nguyên. |
| tests/acceptance/H1/db.int A48 | c (môi trường) | Xanh ở base (cache mẫu DB lạnh), đỏ khi mẫu nạp từ cache evotest: pg_dump/pg_restore làm phẳng `AND` lồng của CHECK (BETWEEN) ⇒ chuỗi `pg_get_constraintdef` khác dù cùng ngữ nghĩa. Test so CHECK theo chuỗi bỏ ngoặc/khoảng trắng; các loại ràng buộc khác so nguyên văn. |
| contracts approval-engine-slot.int (5 ca) | b | CR-120 gói thêm bước "Xác nhận hợp đồng" (`withConfirmStep`, nhóm `contracts-editor`) đầu lượt ⇒ tenant test phải có Group này (thiếu ⇒ lượt kẹt `FLOW_GROUP_MISSING:contracts-editor,…`) và danh sách Group duyệt có thêm bước đầu. Test tạo Group `contracts-editor` và kỳ vọng `[editor, …]`. |
| tests/acceptance/esign-flow int (2 ca) | b | Liên kết chuông HĐ đổi sang `/contracts/c/<id>` (CR-119 p2). Test lọc theo link mới. |
| tests/acceptance/W1B/send.int, my-activity/isolation.int, HD4/remind.int (2 ca), HD4/locks.int | b | Cùng lý do: link HĐ `/contracts/c/<id>`. HD4/locks: ca đua + mồ côi hết giờ 30 s là hệ quả dây chuyền của ca đầu (khoá giữ mở khi `expect` lỗi); đỏ cả ở base. |
| tests/acceptance/H2b/orchestrator-tenant.int A65 | chưa rõ | Xanh ở base; ở HEAD `server.ts` thoát mã 1 lúc khởi động. Test nay in stdout/stderr của server khi thoát sớm để chẩn đoán (xem Quyết định). |

## Không làm / Chạm
Không đụng đường dẫn DLC. Không đổi mã sản phẩm ngoài 3 migration hub cũ (chỉ thêm guard chạy lại).

## Test tối thiểu
`deploy/evotest/run-tests.ps1 -Step int -Filter "<các file trên>"`.

## Quyết định trong lúc làm
Tranh chấp test → đã chốt (mỗi test sửa một dòng):
- approval-engine-slot.int: kỳ vọng thêm bước xác nhận `contracts-editor` đầu lượt (hành vi CR-120 `withConfirmStep`).
- esign-flow.int: link chuông `/contracts/c/<id>` (CR-119 p2).
- W1B/send.int: link thông báo hẹn nhắc `/contracts/c/<id>`.
- my-activity/isolation.int: link hoạt động `/contracts/c/<id>`.
- HD4/remind.int, HD4/locks.int: link nhắc hạn `/contracts/c/<id>`.
- H1/db.int A48: so CHECK không phụ thuộc ngoặc (dump/restore cache), không đổi kiểm nào khác.
- H2b/orchestrator-tenant.int: chỉ thêm chẩn đoán (in log server khi thoát sớm), không đổi khẳng định.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa test theo hành vi đã chốt của CR-119/CR-120 + guard chạy lại cho 3 migration hub cũ; DB mới và DB đã áp không đổi)

## Việc còn lại
