---
id: tool-tenant-purge
lát: tool-tenant-purge
cr:
làn: đầy đủ (tenant/xoá dữ liệu khách)
migration: không
phụ thuộc:
---
## Plan (ngắn)
Công cụ vận hành `tools/scripts/src/tenant-purge.ts --tenant <uuid|key|tên> [--apply --confirm "<tên>"]` xoá SẠCH một tenant.
- Tập xoá tìm tự động: mọi bảng (r/p, không phải partition) có cột `tenant_id` ở mọi schema (admin, hub, contracts, community,
  knowledge, dlc, packs…) + allowlist `EXTRA_TABLES` (bảng không có `tenant_id`, vị từ tường minh) + hàng `admin.tenants`.
- Thứ tự xoá theo `pg_constraint` (con trước cha); vòng FK: bỏ FK cascade/set null, rồi đặt NULL FK nullable, rồi hoãn FK deferrable;
  còn vòng ⇒ FAIL.
- Chốt chặn: tenant platform (key `platform` hoặc có `platform_admin`), tên/uuid khớp >1, `--apply` thiếu/sai `--confirm`, bảng lạ
  (FK cascade/restrict từ bảng ngoài tập xoá, hoặc cột tên *tenant* ở bảng ngoài tập xoá) chưa khai, `tenant_id` không phải uuid,
  bảng `tenant_id` không có trong thứ tự, dữ liệu ngoài tenant (hoặc bảng chung `GUARDED_TABLES`) trỏ vào dữ liệu tenant.
- MỘT transaction (một database): tắt tạm trigger người dùng chạy khi DELETE (append-only audit, guard read-only…) bằng DDL trong
  transaction, xoá, bật lại, kiểm còn 0 hàng, bump `config_version`/`profile_version`/`hub_config_version` + `pg_notify`
  (`config_changed`/`profile_changed`/`hub_config_changed`, gửi lúc commit), ghi 1 hàng `admin.audit_log` platform (tenant_id NULL,
  entity tenant, action delete, summary: operator, số hàng theo bảng, số file).
- FileBox SAU commit: id từ cột file của tenant (`*file_id`, `storage_key fb/…`) + liệt kê org `t_<tenant>`; id còn được dữ liệu khác
  dùng ⇒ giữ; còn sót ⇒ in + ghi file trạng thái (`$HOME/tenant-purge-<uuid>.json`); chạy lại khi tenant đã mất ⇒ chỉ dọn file.
- Chạy thử mặc định (transaction `read only`), in số hàng theo bảng.

## Làm
- [x] `tenant-purge.rules.ts` (thuần) + `tenant-purge.db.ts` (catalog/kế hoạch/đếm/chặn) + `tenant-purge.apply.ts` (transaction)
  + `tenant-purge.files.ts` (FileBox) + `tenant-purge.ts` (CLI, `DATABASE_URL` owner như `s2-app-urls.ts`).
- [x] unit `tenant-purge.rules.test.ts`; int `tenant-purge.int.test.ts` (evotest).

## Không làm / Chạm
- Không migration, không sửa module đóng băng, không chạy với prod (điều phối chạy). Không seed/test đường dẫn DLC (dlc.* được xoá
  theo cơ chế chung, không có test riêng).

## Test tối thiểu
- `bun test tools/scripts/src/tenant-purge.rules.test.ts` (7 pass);
  `deploy/evotest/run-tests.ps1 -Step int -Filter tools/scripts/src/tenant-purge.int.test.ts` (5 pass).

## Quyết định trong lúc làm
- Xoá cả hàng `admin.audit_log`/`hub.audit_log` của tenant (append-only ⇒ tắt trigger trong transaction); dấu vết còn ở hàng audit
  platform mới.
- `hub.process_def_releases` (không có tenant_id) ⇒ `EXTRA_TABLES` theo `process_defs.tenant_id`; `hub.providers`,
  `hub.kh_connections`, `hub.process_slots` là bảng chung ⇒ `GUARDED_TABLES` (không xoá, trỏ vào dữ liệu tenant ⇒ FAIL).
- Khớp `--tenant` theo uuid, `key` hoặc `name` chính xác; `--confirm` phải đúng `name`.
- Nhận diện platform: `key = 'platform'` hoặc tenant có user `platform_admin` (bảng tenants không có cột kind).
- Tắt trigger bằng `ALTER TABLE … DISABLE TRIGGER` (khoá ACCESS EXCLUSIVE tới commit, `lock_timeout 15s`) — không dùng
  `session_replication_role` (sẽ tắt cả FK).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED admin/tenant-user.md
#### Yêu cầu: Xoá sạch tenant bằng công cụ vận hành
Người vận hành xoá toàn bộ dữ liệu của một tenant (mọi bảng có tenant_id ở mọi schema, bảng allowlist, hàng tenant, file FileBox)
bằng `tenant-purge.ts`; mặc định chạy thử, `--apply` cần `--confirm` đúng tên; tenant platform và bảng lạ chưa khai bị từ chối;
một transaction, cache bỏ tenant qua bump + NOTIFY, audit platform ghi người/lúc/tenant/số hàng.
- Kịch bản: khi chạy không có --apply thì in số hàng theo bảng và không xoá gì [test: tools/scripts/src/tenant-purge.int.test.ts » chạy thử: in số hàng theo bảng, không xoá gì (DB + FileBox)]
- Kịch bản: khi chọn tenant platform hoặc --confirm sai thì từ chối [test: tools/scripts/src/tenant-purge.int.test.ts » từ chối tenant platform và --confirm sai]
- Kịch bản: khi có bảng lạ tham chiếu dữ liệu tenant chưa khai thì kế hoạch FAIL [test: tools/scripts/src/tenant-purge.int.test.ts » bảng lạ tham chiếu dữ liệu tenant (FK hoặc cột *tenant*) ⇒ kế hoạch FAIL]
- Kịch bản: khi --apply thì tenant còn 0 hàng ở mọi bảng tenant_id, tenant khác y nguyên, có audit platform, file FileBox bị xoá [test: tools/scripts/src/tenant-purge.int.test.ts » --apply: A còn 0 hàng ở mọi bảng tenant_id, B y nguyên, audit platform + config_version tăng, FileBox của A bị xoá]
- Kịch bản: khi chạy lại sau khi tenant đã mất thì chỉ dọn FileBox, không lỗi [test: tools/scripts/src/tenant-purge.int.test.ts » chạy lại khi tenant đã mất ⇒ chỉ dọn FileBox (idempotent), không lỗi]
- Kịch bản: khi tên trùng nhiều tenant thì từ chối [test: tools/scripts/src/tenant-purge.rules.test.ts » tên trùng hoặc tenant platform (key/platform_admin) ⇒ từ chối]

## Việc còn lại
- Chạy trên prod (điều phối): chạy thử trước, đọc danh sách bảng/số hàng, rồi `--apply --confirm`. Nên chạy lúc vắng (khoá
  ACCESS EXCLUSIVE ngắn trên các bảng có trigger DELETE). FileBox cần `FILEBOX_URL`/`FILEBOX_TOKEN` trong `.env` (có sẵn).
- Kế hoạch trên DB prod có thể gặp bảng lạ chưa có trong DB test (FAIL có danh sách) ⇒ thêm vào `EXTRA_TABLES`/`GUARDED_TABLES`.
