# CR-130 pha 3 · lát 1 — kit/guard/quyền hub-api theo ADR-0044 (làn nhanh, bản cơ bản: Bảng tin không quyền riêng)

## Kế hoạch (đã làm)
| Việc | File chính |
|---|---|
| `PACK_SURFACES` (surface `community` → gói `contracts` + add-on), `EXTERNAL_SURFACES` (đổi tên từ `EXTERNAL_PACKS`) | `kit/domain/pack-surface.rules.ts`, `kit/domain/external-access.rules.ts` |
| Guard: `packAccessInput`/`packEnabled` ánh xạ surface → gói chủ ∧ add-on; nội bộ có quyền gói ⇒ read+write, không admin; đối tác chỉ `EXTERNAL_SURFACES`, không bao giờ quyền `contracts` | `kit/adapters/pack-guard.middleware.ts` |
| `/pack/me`: `community` không còn trong `packs`; cờ tính ra từ `packAccessInput("community")` | `capabilities/capabilities.{rules,service}.ts` |
| Community: bỏ `isAdmin`/`tenantAdmin`; duyệt đơn/ẩn bài đối tác/báo cáo = mọi nội bộ (`reviewer = org === null`); viewer.role nội bộ = `host_member`; ẩn bình luận = chủ bài (SQL `author_user_id`) | `community/adapters/{community-access,flow-slots,flows.service,org.routes,comment.service,comment.repo}.ts`, `community-flow.mount.ts` |
| Vòng nền + người nhận thông báo theo gói chủ ∧ add-on | `community.mount.ts` `communityTenants`, `kit/adapters/pack-hosts.ts` |
| Manifest/node: `show-post` feature → `contracts-community`; mục `moderate` mức Sửa, không `company_admin` | `packages/contracts/src/app-manifest/community.manifest.ts`, `modules/community/show-post/node.ts` |

## Quyết định trong lúc làm
- **Khoá add-on = `contracts-community`, KHÔNG phải `contracts.community` như ADR-0044/brief**: DB `admin.features.key` có CHECK `^[a-z0-9-]{2,32}$` (migration 0001) — không lưu được dấu chấm (insert fixture báo `features_key_check`); `contracts-export` là add-on có sẵn cùng kiểu. Một hằng (`PACK_SURFACES.community.addon`) + `show-post` node. Nếu muốn giữ dấu chấm: lát 2 nới CHECK rồi đổi hằng. **ADR-0044 cần sửa chữ cho khớp.**
- Add-on tắt ⇒ giữ đúng hành vi gói tắt hiện có: **403 `PACK_DISABLED`** (không phải 404) — "cùng câu như gói tắt" theo code hiện tại.
- `installedPacks` vẫn liệt kê `community-*` cũ cho view admin (`tenantCapabilities`); chỉ `shellMe` lọc mặt API (`surfaceOf`) — lát 2/4 gỡ cùng migration.
- `viewer.role`: enum `host_admin` vẫn trong contract (`COMMUNITY_ROLES`) nhưng server không còn trả; lát 4 gỡ khỏi contract + mock web (`apps/workspace-web/.../community/adapters/seed.ts`).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-12 (đợt cr132-wave)

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Bảng tin bản cơ bản — quyền theo gói Sổ Hợp Tác, không quyền riêng
Mặt `/pack/community/*` bật khi công ty có gói Sổ Hợp Tác ∧ add-on `contracts-community`. Mọi nhân viên có quyền gói Sổ Hợp Tác xem/đăng bài/bình luận, duyệt đơn tham gia, ẩn bài của đối tác; chỉ người đăng bài ẩn được bình luận trên bài đó. Đối tác dùng đúng mặt Bảng tin (đọc, bình luận, đăng) và không vào được `/pack/contracts/*`.
- Kịch bản: khi nhân viên chỉ có quyền Sửa Sổ Hợp Tác (không Group community) thì đăng bài được và thấy hàng duyệt đơn/báo cáo [test: apps/hub-api/src/modules/packs/community/adapters/community.surface-access.int.test.ts » nội bộ chỉ có contracts-write]
- Kịch bản: khi người dùng là đối tác thì đọc/bình luận Bảng tin được nhưng không vào hàng duyệt [test: apps/hub-api/src/modules/packs/community/adapters/community.surface-access.int.test.ts » đối tác: đọc + bình luận]
- Kịch bản: khi người không phải chủ bài (kể cả quản trị công ty) ẩn bình luận thì nhận 404, chủ bài thì được [test: apps/hub-api/src/modules/packs/community/adapters/community.surface-access.int.test.ts » ẩn bình luận = CHỈ chủ bài]
- Kịch bản: khi add-on Bảng tin tắt thì cả nhân viên lẫn đối tác nhận 403 PACK_DISABLED [test: apps/hub-api/src/modules/packs/community/adapters/community.surface-access.int.test.ts » add-on contracts-community tắt]
- Kịch bản: khi đối tác gọi quyền gói Sổ Hợp Tác thì không có quyền nào và mặt community không bao giờ có admin [test: apps/hub-api/src/modules/packs/kit/adapters/external-access.test.ts » ADR-0044 · đối tác]
- Kịch bản: khi đối tác gọi `/pack/contracts/*` thì bị tường lửa chặn 403 [test: apps/hub-api/src/modules/packs/kit/adapters/external-deny.int.test.ts » mọi bề mặt ngoài gói]

## Việc còn lại (cho lát 2+)
- Lát 2 (SQL): `partner_companies` RLS còn `viewer_is_admin('community')` (0002, bảng không còn ghi từ CR-130 — thay bằng `viewer_ext_org() IS NULL`); Group/feature `community-*` + template flow `group_key: "community-admin"` (`flow-slots.rules.ts:111`, `flow-templates.community.ts`, `slot-generic.fixture.ts`, `readiness` groupMap); seed feature `contracts-community` vào catalog admin.
- Chưa sửa (vẫn `community-*`, chạy vì fixture riêng): `seed.tenant-fixtures*.ts`, `chat-gate.int.test.ts`, `community-{flow-events,flow-launch,ports,quota,wire}.int.test.ts`, `community.{flows,flows-nav}.int.test.ts`, `community-files.int.test.ts`, `notify.int.test.ts`, `profile-media.int.test.ts`, `visibility.rls.int.test.ts` — chưa chạy lại; có thể đỏ do fixture gán `community-*` (lát 3 seed/fixture).
- `defs-flow.int.test.ts` 6 đỏ (POST /process-defs ⇒ 403): nghi đỏ có sẵn do CR-127 E8 (`tenantAdminReadOnly`), chưa xác minh trên ref gốc.
- Test khoá `tests/acceptance/**`/`e2e/**` chưa sửa: `tests/acceptance/com-c3/_support/cast.ts` (seed Group `community-*` — int tin vào `roles.owner/editor/viewer`, vẫn chạy), các spec `com-c2/com-c3` nhắc `EXTERNAL_PACKS`/`community-admin` cần qc rà.
- evotest từ worktree không chạy được (thiếu khoá SSH `F:/workspace/id_evoc_key`) ⇒ int chạy bằng `test:int:par` cục bộ.
