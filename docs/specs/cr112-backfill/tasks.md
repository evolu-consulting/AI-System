---
id: cr112-backfill
lát: cr112-backfill
cr: CR-112
fr: ADM-FR-80, ADM-FR-81, ADM-FR-83 · ADM-BR-17
làn: đầy đủ
migration: admin 0031_app_roles_backfill.sql (when 1801210000000)
phụ thuộc: cr112-app-roles (S1)
---
## Plan (ngắn)
CLI chuẩn hoá vai cho dữ liệu khách có sẵn, dùng lại `compileRoles` (S1): mỗi tenant một tx — tạo hàng vai mặc định từ Group vai
(`admin.app_roles_backfill(tenant)`), thêm mã gói thiếu / gỡ mã gói thừa CHỈ trên Group của vai, Group vai tuỳ biến nhận agent trợ
lý như Group mặc định cùng mức, báo cáo. Dry-run = cùng đường rồi ROLLBACK. Đóng 3 lỗ S1: importer tạo vai, chặn xoá Group vai qua
`/admin/groups`, agent cho vai tuỳ biến.

## Làm
- [x] Migration admin 0031: `admin.app_roles_backfill(p_tenant uuid)` (SETOF id, chỉ owner) + `admin.app_roles_grant_agents(tenant, roles, actor)` (SECURITY DEFINER, EXECUTE cho admin_api; chép grant agent trợ lý gói từ Group mặc định cùng gói+mức; bump `hub.config_meta` khi có chèn).
- [x] `app-roles.backfill.ts` + CLI `app-roles-backfill.cli.ts`, script `bun run admin:roles-backfill [--tenant <key>] [--actor <uuid>] [--apply] [--out file.json]`.
- [x] `app-roles.agents.ts`: `createRole` và đổi mức vai tuỳ biến cấp agent trợ lý (audit + NOTIFY `hub_config_changed`).
- [x] `deleteGroup` (`/admin/groups/:id`): Group vai mặc định ⇒ 409 `DEFAULT_ROLE_PROTECTED`; Group vai tuỳ biến ⇒ 409 `ROLE_GROUP_MANAGED` (contract `APP_ROLE_ERRORS`).
- [x] Importer identity (`import.store.ts` `packForNew`) ghi 3 vai mặc định (`insertDefaultRolesFor`, một câu cho cả lô). Onboard dùng `enablePack` — đã có vai.
- [x] H1 `db.int.test.ts` A48: danh sách khoá index hub do migration gói tạo (`review_tasks_decided_by_idx`, CR-109 pack_contracts 0070 — cố ý, perf người duyệt) loại khỏi so sánh DB full ↔ DB stub (stub không chạy migration gói). Relock.

## Chạy trên prod (sohoptac2) — chỉ sau khi người dùng xác nhận
1. Deploy bản có migration admin 0031 (setup/migrate như thường).
2. Dry-run (không ghi gì), lưu báo cáo JSON:
   `docker compose -p sohoptac2 run --rm -T tool apps/admin-api/src/modules/app-roles/app-roles-backfill.cli.ts > roles-dry.json`
   (thêm `--tenant <key>` để xem một công ty). stderr = tóm tắt: vai sẽ tạo, grant thêm/gỡ theo vai, số người, "quyền ngoài vai", vai vượt trần.
3. Gửi báo cáo cho người dùng; chỉ khi người dùng xác nhận: chạy lại cùng lệnh thêm `--apply` (có thể `--actor <uuid platform admin>` để audit ghi người làm; vắng = hệ thống).
4. Chạy dry-run lần nữa ⇒ totals = 0 (idempotent).

## Không làm / Chạm
Không UI. Không thu hồi grant gói trên Group không phải vai (`pb-*`… chỉ báo "quyền ngoài vai"). Không đổi `packs.grant_agents`. Không chạy gì trên prod.

## Test tối thiểu
- int `apps/admin-api/src/modules/app-roles/app-roles.backfill.int.test.ts` (dry-run/apply/idempotent/audit; xoá Group vai 409; vai tuỳ biến nhận agent).
- int `apps/admin-api/src/modules/identity-import/import.roles.int.test.ts` (import tạo vai).
- Hồi quy đã chạy: app-roles service int, groups service int, H1 db.int, M3 db-schema/groups, R1 search-definer, N5 import, ADM-NFR-06, lock-order.

## Quyết định trong lúc làm
- Dry-run chạy CÙNG đường ghi trong tx rồi ROLLBACK (báo cáo đúng y như apply), sink sự kiện/audit bỏ ⇒ không audit, không NOTIFY, không bump.
- Backfill theo tenant cần hàm có tham số ⇒ thêm overload `app_roles_backfill(uuid)` ở 0031 (không đổi hàm 0030). CLI chạy bằng DATABASE_URL owner (như `s2-app-urls.ts`) vì hàm chỉ owner gọi được.
- Agent cho vai tuỳ biến = chép grant agent trợ lý gói (`packs.pack_agents`) đang có trên Group vai mặc định cùng gói + mức (Group mặc định bị thu hồi agent ⇒ vai tuỳ biến cũng không nhận). Chỉ thêm, không gỡ khi hạ mức.
- Audit: vai tạo bởi backfill = `create`/`group` (`summary.op = role.backfill`); grant = `grantAudit` sẵn có; grant agent = `update`/`group` (`summary.op = role.agent_grant`) — không thêm enum audit.
- Xoá Group vai tuỳ biến qua `/admin/groups` bị chặn (`ROLE_GROUP_MANAGED`) để luôn qua `DELETE /admin/app-roles/:id` (kiểm còn người).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED admin/ghi-chu.md
#### Yêu cầu: Chuẩn hoá vai cho dữ liệu có sẵn (backfill dry-run/apply)
CLI `admin:roles-backfill` mặc định chạy thử: báo cáo theo công ty/gói/vai (vai sẽ tạo, mã gói thêm/gỡ trên Group của vai, số người, Group ngoài vai có mã gói, vai vượt trần) và không ghi gì. `--apply` ghi mỗi công ty một transaction, audit từng thay đổi, NOTIFY; Group không phải vai giữ nguyên; chạy lại không đổi gì.
- Kịch bản: khi chạy thử trên công ty lệch chuẩn thì DB không đổi và báo cáo liệt kê đúng thêm/gỡ, Group phòng ban ở mục quyền ngoài vai [test: apps/admin-api/src/modules/app-roles/app-roles.backfill.int.test.ts » ADM-FR-83 · dry-run không ghi, apply sửa tenant lệch, giữ Group phòng ban, audit mỗi thay đổi, lần 2 không đổi]
- Kịch bản: khi apply thì viewer mất mã admin thừa, editor có lại write, Group phòng ban giữ grant, audit đúng số thay đổi; apply lần 2 không đổi gì [test: apps/admin-api/src/modules/app-roles/app-roles.backfill.int.test.ts » ADM-FR-83 · dry-run không ghi, apply sửa tenant lệch, giữ Group phòng ban, audit mỗi thay đổi, lần 2 không đổi]

#### Yêu cầu: Group của vai do vai quản
Xoá Group của vai mặc định qua mục Nhóm ⇒ 409 `DEFAULT_ROLE_PROTECTED`; Group của vai tuỳ biến ⇒ 409 `ROLE_GROUP_MANAGED` (xoá qua vai). Vai tuỳ biến nhận trợ lý AI của gói như Group vai mặc định cùng mức. Import người dùng từ mgmt-app tạo luôn 3 vai mặc định.
- Kịch bản: khi xoá Group vai qua /admin/groups thì 409 và Group còn nguyên; vai tuỳ biến mới có grant agent trợ lý [test: apps/admin-api/src/modules/app-roles/app-roles.backfill.int.test.ts » ADM-FR-80 · xoá Group vai qua /admin/groups ⇒ 409 DEFAULT_ROLE_PROTECTED / ROLE_GROUP_MANAGED, vai tuỳ biến mới nhận agent]
- Kịch bản: khi import tạo công ty mới thì có 3 vai mặc định trỏ Group vai contracts [test: apps/admin-api/src/modules/identity-import/import.roles.int.test.ts » ADM-FR-81 · import tenant mới ⇒ 3 vai mặc định (viewer/editor/owner) trỏ Group vai contracts]

## Việc còn lại
- Chạy trên prod: dry-run → người dùng xác nhận → `--apply` (mục "Chạy trên prod").
- UI (S5): hiện lỗi `ROLE_GROUP_MANAGED` ở mục Nhóm (i18n) — lát UI.
- Seed fixtures demo tạo Group vai bằng SQL: có thể gọi `bun run admin:roles-backfill --apply` sau seed.
