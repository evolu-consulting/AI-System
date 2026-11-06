---
id: cr122-w2-int-db
lát: cr122-w2-int-db
cr: CR-122
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Xử lý 4 ca int đỏ mới của wave cuối CR-122 (DB): 2 test db cập nhật bảng/policy hub 0105/0106; 2 test acceptance (khoá qc) chỉ ghi đề xuất.

## Làm
- `packages/db/src/migrate-hub.int.test.ts`: thêm `flow_events`, `company_flows`, `tenant_flow_settings` vào `HUB_TABLES`.
- `packages/db/src/hub-rls.int.test.ts`: thêm policy `flow_events` (1), `company_flows` (1), `tenant_flow_settings` (2), chỉ `hub_rw`.

## Không làm / Chạm
Không sửa `tests/acceptance/**` (khoá qc). Không sửa migration/code sản phẩm.

## Test tối thiểu
`migrate-hub.int.test.ts`, `hub-rls.int.test.ts` xanh (evotest -Dirty).

## Quyết định trong lúc làm
- **N3-NFR-02 (đề xuất cho qc, isolation.int.test.ts:126-132):** đo SQL thật trên role `contracts_rw`: `USAGE` schema hub = true, `CREATE` = false; quyền bảng/cột/sequence trên MỌI đối tượng schema hub = rỗng; EXECUTE chỉ thêm `hub.emit_flow_event(uuid,text,text,text,jsonb,uuid)` (SECURITY DEFINER, tự kiểm `app.tenant_id` = tenant truyền vào, sai ⇒ 42501). Các hàm còn lại trong hub role gói thấy được là EXECUTE mặc định của PUBLIC (`hub.fold`, hàm trigger `usage_daily_*`, `hub.usage_app` không SECURITY DEFINER ⇒ không có quyền bảng thì không đọc được gì), vốn có từ trước, chỉ lộ ra do có USAGE. `pkdemo_rw` (gói không bắn sự kiện) vẫn `hub:false`. ⇒ An toàn, không sửa migration. Đề xuất test: `hub` = false cho `pkdemo`, = true cho `contracts`; thêm khẳng định `has_function_privilege(<k>_rw,'hub.emit_flow_event(uuid,text,text,text,jsonb,uuid)','EXECUTE')` và 0 quyền bảng hub (`has_table_privilege` SELECT/INSERT/UPDATE/DELETE = false cho mọi bảng hub); `adm` vẫn false.
- **HD-NFR-03 (đề xuất cho qc, hops.int.test.ts:195-216):** tải PDF thành công = 4 câu SQL, không phải 3. Câu thứ 4 là `select hub.emit_flow_event(... 'contract.uploaded' ...)` — A1 (FLOW2-FR-19) phát sự kiện CÙNG tx với hàng HĐ (cũng chạy ở chế độ bóng khi cờ tắt, trong savepoint nên savepoint không tính). Không thừa: đúng 1 câu cố định, không trong vòng lặp, không phụ thuộc số hàng; đã có 2 câu trước (set_config, CTE files+contracts+event) và outbox như cũ. p9 (đếm trang PDF) chạy trước tx, bằng bytes trong bộ nhớ, 0 SQL. Đề xuất ngưỡng mới: `sql: 4` (set_config, CTE, outbox, emit_flow_event) và sửa tiêu đề/comment "3 → 3+1 emit".

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ cập nhật test db cho bảng/policy hub 0105/0106 đã có; hai đề xuất sửa test acceptance gửi qc)

## Việc còn lại
- qc: áp 2 đề xuất ở "Quyết định" vào `tests/acceptance/N3/isolation.int.test.ts` và `tests/acceptance/HD1/hops.int.test.ts`, rồi `test:lock:write`.
