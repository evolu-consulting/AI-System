# ADR-0044 · Gộp gói `community` vào gói `contracts` (Bảng tin là mảng con của Sổ Hợp Tác) — Accepted (2026-11-12, CR-130 pha 3; người dùng chốt 2026-11-12)

Bổ sung ADR-0031 (cổng gói↔gói), ADR-0043 (một nguồn đối tác). Sửa `docs/platform/modules.md` (dòng CR-102 «gói mới `community`»). Liên quan: `docs/specs/CR-130/`.

## Bối cảnh — còn hai nơi sau pha 1–2
Pha 1–2 đã có: một trợ lý, một Cài đặt, một chuông, một nguồn đối tác (`contracts.partner_profiles` + `contracts.community_partners()`). Người dùng vẫn thấy «Bảng tin» là một phần của Sổ Hợp Tác, nhưng nền tảng còn coi là **hai gói**:

| Khái niệm | Nơi 1 (contracts) | Nơi 2 (community) | Chỗ trong code |
|---|---|---|---|
| Bật/tắt + entitlement | feature `contracts-read/write/admin` | `community-read/write/admin` | `capabilities.rules.ts` `installedPacks`, `HOME_ORDER`; admin catalog; `deploy/tenants/*.yaml` (`packs: [contracts]`), `tools/hub-dev/src/demo-packs.ts` |
| Quyền/Group | `contracts-owner/editor/…` | `community-owner/editor` | `seed.tenant-fixtures.ts` `OWNER_GROUPS`, `seed-community-demo*.ts`, `deploy/stg-*/stg-seed.ts`, flow template (`flow-slots.rules.ts`) — 42 file nhắc khoá `community-read/write/admin` |
| Cờ quyền admin trong RLS | `packs.viewer_is_admin('contracts')` | `packs.viewer_is_admin('community')` | `migrations-pack-community/0002` |
| Manifest web | `modules/contracts/manifest.ts` | `modules/community/manifest.ts` (`COMMUNITY_PACK`) | shell `useShellPacks`, `PackStatePage pack="community"` |
| Prefix API | `/pack/contracts/*` | `/pack/community/*` | `community.mount.ts`; 12 file web/e2e/tools gọi |
| Cửa đối tác (user ngoài) | — | `EXTERNAL_PACKS = { community: [read, write] }` | `kit/domain/external-access.rules.ts`, `pack-guard.middleware.ts` `externalGrant`, `capabilities.rules.ts` `DEFAULT_EXTERNAL` |

Admin công ty phải bật hai gói, gán hai bộ Group cho cùng một sản phẩm ⇒ vi phạm Luật GỐC 1–3 (hai nguồn cho «ai dùng được Sổ Hợp Tác», hai control, lộ khái niệm «gói Cộng đồng»).

## Ràng buộc
- Luật GỐC 1–3; D6 (chuyển mọi chỗ đọc + gỡ cái cũ cùng thay đổi).
- Chưa có khách thật ⇒ **không backfill**; migration thẳng, dữ liệu community/feature/Group xoá-tạo-lại được (memory `no-data-migration-yet`).
- **Hàng rào đối tác không được rộng ra:** user ngoài hiện bị chặn theo **khoá gói trong đường dẫn** (`externalPathAllowed`: `/pack/<k>` với `k ∈ EXTERNAL_PACKS`). Nếu đối tác nhận quyền ở gói `contracts` theo cách hiện tại thì sẽ vào được mọi `/pack/contracts/*` (HĐ, quy trình) ⇒ bất kỳ phương án nào cũng phải giữ cửa đối tác **theo mặt API**, không theo gói.
- Giữ schema `community` + role `community_rw` + RLS riêng: **được và nên giữ** — schema là ranh giới dữ liệu/role DB, không phải khái niệm người dùng thấy; ADR-0043 đã cho RLS Bảng tin đọc `contracts.community_partners()`.

## Lựa chọn
| | Cách làm | Được | Mất |
|---|---|---|---|
| **A. Gộp đủ, đổi prefix** | Một gói `contracts`; Bảng tin = mảng con, bật bằng add-on `contracts.community`; quyền = `contracts-read/write/admin`; Group chỉ `contracts-*`; một manifest; API `/pack/contracts/community/*`; cửa đối tác đổi sang khoá theo prefix con | Một tên ở mọi tầng | Đổi prefix ⇒ 12 file web/e2e/tools + khoá test; hàng rào đối tác viết lại trên chính đường `/pack/contracts` (dễ hở nhất); `community.mount` phải nằm dưới mount contracts |
| **B. Giữ hai gói, chỉ gộp manifest/UI** | Một manifest web, ẩn gói community trong admin; vẫn hai entitlement + hai bộ Group | Ít sửa nhất | Không bỏ được hai nguồn quyền (Luật GỐC 1); admin vẫn gán hai Group — chỉ giấu vấn đề |
| **C. Một gói quyền, giữ mặt API `community` (đã chọn)** | Như A về **quyền/entitlement/Group/manifest/cờ**; nhưng giữ `/pack/community/*` làm **mặt API** (surface) do gói `contracts` sở hữu: guard ánh xạ surface `community` → quyền gói `contracts` ∧ add-on `contracts.community`; cửa đối tác giữ theo surface (`EXTERNAL_SURFACES = { community: [read, write] }`) | Một nguồn quyền + một bật/tắt; hàng rào đối tác giữ nguyên hình dạng (không đụng `/pack/contracts`); không đổi URL ⇒ web/e2e gần như không đổi | Còn tên `community` ở tầng kỹ thuật (prefix, schema, role) — không lộ cho người dùng, chấp nhận theo Luật GỐC 2 (khái niệm người dùng thấy chỉ còn «Sổ Hợp Tác › Bảng tin») |

## Quyết định: C (người dùng chốt 2026-11-12)
1. **Kit:** thêm bảng thuần `PACK_SURFACES: { community: { pack: "contracts", addon: "contracts.community" } }` (`kit/domain`); `packAccessInput` đổi khoá surface → khoá gói trước khi tra feature/Group; add-on tắt ⇒ như gói tắt (404 cùng câu). `EXTERNAL_PACKS` đổi tên `EXTERNAL_SURFACES` (khoá = surface), đối tác **không** bao giờ nhận quyền `contracts` ngoài surface này.
2. **Quyền — Bảng tin bản CƠ BẢN, không có quyền nào (kể cả quản lý); quyền sẽ định nghĩa sau, đúng action khi cần:** (a) xem/đăng bài/bình luận = mọi user nội bộ vào được Sổ Hợp Tác (surface `community` nhận `read` + `write` khi user có bất kỳ quyền `contracts`); ai thấy bài nào vẫn theo RLS audience/bạn bè hiện có (không đổi). (b) Ẩn bình luận trên một bài = người đăng bài đó. (c) Ẩn bài/báo cáo của đối tác = mọi user nội bộ của công ty (không kiểm admin). **Cập nhật chốt B (2026-11-12, sau security review): duyệt ĐƠN THAM GIA cần quyền QUẢN TRỊ Sổ Hợp Tác (`contracts-admin`) vì ghi hồ sơ đối tác ở SHT — thống nhất với `PUT /partners/community/account`; người không đủ quyền không thấy hàng (403 danh sách, `joinReview=false`, không mục menu) và 403 khi quyết.** Guard không còn action `admin` cho surface `community`; RLS bỏ `packs.viewer_is_admin('community')`, thay bằng điều kiện «user nội bộ của tenant» (`packs.viewer_ext_org() IS NULL`) — **không** đổi thành `'contracts'`. Bỏ hẳn feature `community-read/write/admin` và Group `community-owner/editor` (migration pack-community mới, thay policy thẳng).
3. **`/pack/me`:** `packs` chỉ còn `contracts`; cờ `community` vẫn có trong `flags` nhưng **tính ra** (= add-on bật ∧ đọc được surface), không phải nguồn riêng ⇒ `useShellPacks().community` giữ nguyên. `HOME_ORDER`/`DEFAULT_EXTERNAL` đổi theo surface; trang chủ đối tác = `/community`.
4. **Web:** manifest community thành manifest con nạp từ manifest contracts (một điểm vào cho shell); bỏ `COMMUNITY_PACK`, `PackStatePage pack="community"` đổi sang «Bảng tin chưa bật» dưới gói contracts.
5. **Giữ:** schema `community`, `community_rw`, RLS, `packs.install('community')` (đăng ký schema), khoá node/khe `community.*` của flow (tên module tính năng, không phải gói) — chỉ đổi Group trong template sang `contracts-*`.
6. **Bật Bảng tin:** **admin nền tảng** bật add-on `contracts.community` cho công ty (admin-web nền tảng, không phải Cài đặt của quản trị công ty); mặc định **tắt**. URL web giữ `/community`. Onboarding: `deploy/tenants/*.yaml` khai `addons: [contracts.community]` khi cần; `demo-packs.ts`, `seed-community-demo*`, `stg-seed.ts` gán `contracts-*`; ops-watch thêm check «tenant có dữ liệu `community.*` mà add-on tắt / còn feature `community-*`».

## Kế hoạch lát (≤ 60 phút/lát, nối tiếp vì chung vùng kit/seed)
| # | Lát | Model | Soát |
|---|---|---|---|
| 0 | Bản đồ file (42 file khoá `community-*`, 12 file prefix, seed/deploy) vào `tasks.md` | Explore Haiku | — |
| 1 | Kit: `PACK_SURFACES` (surface `community` → gói `contracts`: nội bộ có quyền `contracts` ⇒ read+write, không có `admin`), `EXTERNAL_SURFACES`, guard + `capabilities.rules` (cờ `community` tính ra); route quản lý (duyệt đơn, ẩn bài) đổi điều kiện từ admin sang «nội bộ», ẩn bình luận = chủ bài + unit + int «đối tác không vào `/pack/contracts/*`», «add-on tắt ⇒ 404», «nhân viên thường đăng bài + duyệt đơn được», «đối tác không duyệt/ẩn được» | Sonnet high | **Opus low** (quyền, hàng rào đối tác) |
| 2 | Migration: admin catalog (xoá feature + Group `community-*`, thêm add-on `contracts.community` chỉ admin nền tảng bật), RLS thay `viewer_is_admin('community')` bằng `viewer_ext_org() IS NULL`, ẩn bình luận theo chủ bài, Group template flow → `contracts-*` + int chéo tenant | Sonnet high | **Opus low** (RLS) |
| 3 | Seed/onboarding: `seed.tenant-fixtures`, `seed-community-demo*`, `demo-packs.ts`, `deploy/tenants/*.yaml`, `stg-seed.ts` + ops-watch check | Sonnet | — |
| 4 | Web: manifest con, bỏ `COMMUNITY_PACK`, `PackStatePage` («Bảng tin chưa bật — liên hệ quản trị nền tảng»); admin-web nền tảng: công tắc add-on `contracts.community`, bỏ gói community khỏi catalog | Sonnet | — |
| 5 | `docs/platform/modules.md`, `pack-boundary.md`, `docs/current`; e2e hành trình (admin bật Bảng tin → đối tác đăng bài) viết, chạy cuối đợt | Sonnet (+ qc cho e2e khoá) | review cuối CR |

## Rủi ro
- Hở hàng rào đối tác nếu guard tra quyền theo gói trước khi xét surface ⇒ int bắt buộc ở lát 1, Opus soát.
- **Mọi nhân viên duyệt được đối tác / ẩn bài đối tác** (không còn vai kiểm duyệt; người dùng chấp nhận cho bản cơ bản). Hướng mở rộng: khi cần, thêm quyền đúng action (vd `contracts.community-moderate`) vào gói `contracts` — guard + RLS chỉ thay điều kiện «nội bộ» ở đúng các chỗ đó; ADR mới.
- Còn sót đọc khoá `community-*` (42 file) ⇒ check grep trong lát 3 (`check` từ chối khoá cũ).

## Đã chốt (người dùng 2026-11-12)
1. Bảng tin bản cơ bản, không quyền riêng: mọi user nội bộ vào được Sổ Hợp Tác ⇒ xem/đăng/bình luận, duyệt đơn tham gia, ẩn bài đối tác; ẩn bình luận = chủ bài. Quyền định nghĩa sau khi cần.
2. Giữ URL `/community`.
3. Admin nền tảng bật add-on `contracts.community`, mặc định tắt.
