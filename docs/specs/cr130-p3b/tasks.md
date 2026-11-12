# CR-130 pha 3 · lát 2+3 — dữ liệu + seed: gỡ gói quyền `community`, add-on `contracts-community` (làn đầy đủ nhẹ: migration/quyền; Opus soát)

## Kế hoạch (đã làm)
| Việc | File chính |
|---|---|
| Migration community 0018: thêm feature add-on `contracts-community`; giữ entitlement công ty đang có Bảng tin; gỡ `community-read|write|admin` + Group vai (`app_roles pack='community'`, `community-owner|editor|viewer`) + grant/thành viên/quota/audit; `app_catalog.community.required_feature` ⇒ `contracts-community` | `packages/db/migrations-pack-community/0018_cr130_p3b_into_contracts.sql` |
| Migration hub 0139: nhãn nhóm duyệt của thân khe/mẫu `community-admin` ⇒ `contracts-admin` | `packages/db/migrations-hub/0139_cr130_slot_group_contracts.sql` |
| `partner_companies`: đã drop ở 0011 ⇒ KHÔNG còn policy `viewer_is_admin('community')` (không cần sửa SQL) | — |
| Code: nhãn nhóm khe + mẫu thư viện ⇒ `contracts-admin` (alias ⇒ `contracts-owner`); `ownerGroupIdsOf` (quyết thay mọi bước) dùng nhóm gói chủ của mặt; `feature(spec)` của gán khe = add-on của mặt | `flow-slots.rules.ts`, `flow-templates.community.ts`, `processes/triggers/flow-launch.ts`, `processes/library/library.service.ts` |
| Seed/onboarding: `seed.tenant-fixtures` chỉ Group contracts; `seed.cr125-config` bỏ app `community`; `seed-community-demo.{grant,dev-fixture,apply}` dùng nhóm contracts + `grantEntitlement(contracts-community)`; `demo-packs`/`hub-dev fixture` bật gói contracts + add-on (dev vẫn có Bảng tin); `app-catalog.seed` đòi `contracts-community`; `stg-seed` đổi log | `apps/hub-api/src/modules/seed/*`, `tools/scripts/src/seed-community-demo.*`, `tools/hub-dev/src/{fixture,demo-packs}.ts`, `apps/admin-api/.../app-catalog.seed.ts`, `deploy/stg-*/stg-seed.ts` |
| Test-kit: `enableAddon(sql, tenantIds, key)`; sửa int theo mô hình mới (fixture `contracts-*` + add-on; mọi nội bộ là người duyệt) | `packages/test-kit/src/builders.ts`, các `*.int.test.ts` community/seed/slot |

## Quyết định trong lúc làm
- Không backfill dữ liệu nghiệp vụ (memory `no-data-migration-yet`). Ngoại lệ tối thiểu: tenant đang có entitlement `community-read` được cấp entitlement `contracts-community` để máy dev/demo hiện có không mất Bảng tin; mọi thứ khác xoá.
- `deploy/tenants/*.yaml`: loader onboard (`tenant-onboard/adapters/onboard.schema.ts`) chỉ có `packs:` — KHÔNG có `addons`; không thêm (ADR: admin nền tảng bật add-on trong admin-web, mặc định tắt). Thêm khoá `addons` vào loader là lát riêng nếu cần.
- `GRANT EXECUTE packs.viewer_is_admin TO community_rw` (0002) để nguyên — vô hại, không còn policy dùng.
- `viewer.caps.contracts` của mặt Bảng tin luôn true với nội bộ (vì mặt chỉ mở cho người có quyền gói contracts): test COM-FR-43 đổi theo.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-12 (đợt cr132-wave)

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Bảng tin không còn gói/Group riêng — dữ liệu và seed theo gói Sổ Hợp Tác
Cơ sở dữ liệu không còn feature `community-read|write|admin` và Group `community-owner|editor|viewer`; Bảng tin bật bằng add-on `contracts-community` (công ty đang có Bảng tin giữ add-on), danh mục app Cộng đồng đòi add-on này. Mọi nhân viên nội bộ có quyền Sổ Hợp Tác là người duyệt. Seed/dev demo gán nhóm `contracts-*` và bật add-on.
- Kịch bản: khi chạy seed demo thì tenant có add-on `contracts-community` và nhân viên nằm trong nhóm `contracts-owner`/`contracts-editor` [test: tools/scripts/src/seed-community-demo.int.test.ts » com-c12 · seed-community-demo]
- Kịch bản: khi chạy seed fixture công ty thì chỉ có Group `contracts-*` [test: apps/hub-api/src/modules/seed/seed.tenant-fixtures.int.test.ts » seed.tenant-fixtures]
- Kịch bản: khi mẫu quy trình duyệt bài áp cho công ty thì nhóm duyệt `contracts-admin` khớp nhóm chủ gói `contracts-owner` [test: apps/hub-api/src/modules/processes/library/flow-templates.community.test.ts » công ty chỉ có nhóm chủ gói]
- Kịch bản: khi nhân viên nội bộ bất kỳ mở hàng đợi duyệt/đơn tham gia/báo cáo thì được xem [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » khe community.post-moderation]
- Kịch bản: khi công ty có gói và add-on thì khe duyệt bài gán được theo add-on [test: apps/hub-api/src/modules/processes/library/slot-assigned.int.test.ts » slotAssigned]

## Kiểm tra đỏ có sẵn (chạy trên ref 0a87ad46d, trước p3a, worktree tạm)
- `defs-flow.int.test.ts` 6 ca đỏ ⇒ **có sẵn** (POST /process-defs 403 — CR-127 E8 `tenantAdminReadOnly`), không do CR-130.
- `tools/scripts/src/tenant-purge.int.test.ts` TREO (kill sau 121 s) cả trên ref gốc ⇒ **có sẵn**; chưa điều tra (ngoài phạm vi).
- 2 unit `ADM-FR-72 · múi giờ tenant` (packages/contracts) đỏ — không liên quan lát này (không đụng timezone).

## Việc còn lại
- Test khoá cần qc: `tests/acceptance/com-c3/_support/cast.ts:80` vẫn `enablePack(sql,[A,B],"community")` (vô hại: không còn feature ⇒ chỉ tạo Group `community-*` rỗng; nên đổi sang `contracts` + `enableAddon`), các spec `com-c2`/`com-c3`/`NITI/onboard.int.test.ts` nhắc `community-*` hoặc `EXTERNAL_PACKS`.
- Web/admin-web (lát 4): `feature-meta.ts`, `feature-assign.test.ts`, `apps-table.test.ts`, `x3-approve-rules.test.ts`, `packages/i18n` còn nhắc `community-*`; `COMMUNITY_MANIFEST.levelFeatures` còn `community-*` (catalog cũ); `packages/db/src/feature-app-col.int.test.ts` giữ (hàm `feature_app_of` không đổi).
- ops-watch check «tenant có dữ liệu `community.*` mà add-on tắt / còn feature `community-*`» (ADR-0044 #6) — chưa làm.
