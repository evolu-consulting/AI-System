---
cr: CR-130
pha: 2 — một nguồn đối tác + một chuông
trạng thái: Thiết kế (backend-lead, 2026-11-12), chờ duyệt
liên quan: ADR-0031, CR-129 (pha kế), `docs/platform/pack-boundary.md`
---
# CR-130 pha 2 — Một nguồn đối tác, một chuông

Ràng buộc: chưa có khách dùng thật ⇒ **không backfill**; drop/tạo lại + seed lại demo. D6 vẫn áp: chuyển mọi chỗ đọc + gỡ cái cũ trong cùng đợt.

## 1. Mô hình đích

| Khái niệm | Nguồn duy nhất | Ghi chú |
|---|---|---|
| Đối tác (công ty) | SHT, khoá `(tenant_id, party_key)` (`tax:<MST>` / `name:<fold>`) — gói **contracts** sở hữu | Danh sách hiện có = `cks_customers` ∪ `partner_roles` (giữ) |
| Vai NCC / người mua | `contracts.partner_roles` (`supplier`, `customer`) | **Bỏ** `labels` của community. `buyer` ⇒ `customer` (một tên: «Khách hàng» như SHT) |
| Nhóm hàng, khu vực, tài khoản đăng nhập của đối tác | **Bảng mới** `contracts.partner_profiles` | Một hàng mỗi đối tác (tạo khi sửa hồ sơ hoặc mời) |
| Tài khoản công ty đối tác | `admin.external_orgs` (lõi, giữ) | Đối tác ↔ tài khoản: `partner_profiles.ext_org_id` (UNIQUE theo tenant). Lõi không biết `party_key` |
| Tên hiển thị | Tên đối tác SHT (`partner_roles.name` mới nhất / `cks_customers`) | `external_orgs.name` chỉ là tên tài khoản ở Admin, đặt bằng tên đối tác lúc mời |

`contracts.partner_profiles` (contracts **0103**): `tenant_id uuid NN` · `party_key text NN` (1–300) · `cats text[] NN '{}'` (≤ 50) · `area text NN ''` (≤ 100) · `ext_org_id uuid NULL` · `invited_at timestamptz NULL` · `updated_at timestamptz NN now()` · `updated_by uuid`. PK `(tenant_id, party_key)`; UNIQUE `(tenant_id, ext_org_id)`; index GIN không cần (lọc theo `ext_org_id`/PK). Không FK sang `admin` (luật pack-sql) — usecase kiểm `ext_org_id` thuộc tenant + còn hiệu lực qua `ExtDirectory` (kit) trước khi ghi.
RLS: `packs.secure_table('contracts','partner_profiles')` + RESTRICTIVE: đọc — người nội bộ theo luật thấy M1 như `partner_roles_visible`; đối tác (viewer_ext_org ≠ NULL) chỉ hàng `ext_org_id = viewer`; ghi — chỉ nội bộ có quyền quản trị gói (`packs.viewer_is_admin('contracts')`) hoặc việc nền.

**Trang quản lý duy nhất:** SHT › Đối tác › chi tiết: vai (đã có `RoleSeg`), thêm «Nhóm hàng», «Khu vực», thẻ «Bảng tin»: trạng thái (Chưa mời / Đã mời — tài khoản X) + nút «Mời vào Bảng tin» / «Gỡ». Community bỏ mục quản lý đối tác (trỏ link sang SHT).

## 2. Ranh giới gói + thay đổi theo file

**Cổng đọc cho RLS (ADR-0043 Proposed, bổ sung ADR-0031):** RLS community cần nhãn/nhóm hàng của *người xem đối tác* ngay trong SQL — port TS không dùng được (ADR-0031 §4: user ngoài không tới port). Chọn: contracts cung cấp **một** hàm SQL `contracts.community_partners(p_orgs uuid[]) RETURNS TABLE(ext_org_id uuid, party_key text, name text, roles text[], cats text[], area text)` — `SECURITY DEFINER`, tenant lấy từ `app.tenant_id` (không từ tham số), chỉ hàng có `ext_org_id = any(p_orgs)`; người xem là đối tác ⇒ chỉ trả hàng của chính mình. GRANT EXECUTE cho `community_rw`. **Chủ ý (soát L1):** người nội bộ của chủ quản thấy MỌI hồ sơ đã gắn tài khoản trong tenant qua hàm này (không áp M1 phòng ban; chỉ đối tác bị thu hẹp). `check:pack-sql`: thêm danh sách hàm gói-chéo được phép (`community → contracts.community_partners`). Phương án loại: (b) port TS + GUC nhãn đặt lúc vào request — hai nguồn trong một request, việc nền phải tự nạp; (c) đưa bảng lên lõi `packs`/`admin` — lõi chứa nghiệp vụ SHT.
**Cổng ghi (TS, ADR-0031):** `PartnerLinker.link({tenantId, extOrgId, roles})` — community khai, contracts cung cấp ở `packs.mount.ts`; dùng khi duyệt yêu cầu tham gia (tạo `partner_roles` manual + `partner_profiles` với `party_key = name:<fold(external_orgs.name)>` nếu chưa có hàng nào trỏ `ext_org_id`). Một int chặn `kind=external`.

| Vùng | File | Thay đổi |
|---|---|---|
| DB contracts | `migrations-pack-contracts/0103_cr130_partner_profiles.sql` | bảng + RLS + hàm `community_partners` + grant |
| DB community | `migrations-pack-community/0011_cr130_drop_partner_companies.sql` | `DROP TABLE partner_companies CASCADE`; viết lại `viewer_labels()`/`viewer_cats()` gọi hàm trên (một lần/câu qua `(SELECT …)`); `audience_ok`: `'buyer'`⇒`'customer'`; CHECK `aud_mode` giữ `buyers` (tên chế độ) |
| hub community | `adapters/org.repo.ts` | `partnerRows`/`catList` đọc `contracts.community_partners(...)`; **gỡ** `upsertPartner` |
| | `comment.repo.ts` L49, `thread.repo.ts` L91, `notify.repo.ts` L48, `post.sql.ts` L101, `quote.repo.ts` L25 | `left join community.partner_companies` ⇒ `left join contracts.community_partners(<mảng org của câu>)`; `post.sql` bỏ subquery từng hàng, gom mảng `author_org` một lần |
| | `flow-events.repo.ts` L160 + service | bỏ CTE insert; gọi `PartnerLinker` sau khi `join_requests` = approved, cùng uow |
| | `org.routes.ts`, `org.service.ts` | gỡ `PUT /partners/:orgId`; `GET /partners` giữ (đọc qua hàm, cho chọn audience) |
| hub contracts | `adapters/partner-profile.repo.ts` (mới) + routes partners | `GET/PUT /pack/contracts/partners/:key/profile` {cats ≤50, area ≤100}; `PUT …/community` {extOrgId: uuid\|null} (409 nếu tài khoản đã gắn đối tác khác); `GET …/community/candidates` (ext org chưa gắn, qua `ExtDirectory`, limit 100) |
| contracts pkg | `packages/contracts/src/pack-contracts` (+ `pack-community/viewer.ts`, `profile.ts`) | schema profile/community; `labels` ⇒ `roles: ('supplier'\|'customer')[]` |
| web | `features/partners` (OverviewTab, PartnerHeader, api, hooks) · `modules/community` (`ui/settings/CompanySections.tsx`, `adapters/http.ts`, `application/host.ts`, `domain/audience.ts`, mock) | thêm hồ sơ + thẻ Bảng tin ở SHT; community bỏ màn quản lý đối tác, nhãn theo i18n SHT |
| seed/test | `tools/scripts/src/seed-community-demo*.ts`; int `community.*.int.test.ts`, `visibility.rls`, `profile-media`, `community-flow-events` | seed tạo đối tác SHT + vai + profile + ext org; int sửa fixture. `tests/acceptance/com-c3/_support/cast.ts` ⇒ **qc** sửa (khoá) |

Cách ly tenant: hàm DEFINER lấy tenant từ GUC + lọc `tenant_id` tường minh; int mới: (1) tenant A không đọc `partner_profiles` của B (đường contracts_rw), (2) `community_partners` gọi dưới tenant A không trả hàng B dù truyền `ext_org_id` của B, (3) đối tác chỉ thấy hàng của mình.
Perf: feed/bình luận/chuông giữ số câu hiện có (thay join, không thêm câu); hàm dùng PK/UNIQUE; không gọi hàm từng hàng.

## 3. Chuông — một nguồn
Hiện trạng: **lưu trữ đã một nguồn** (`hub.notifications`, community ghi qua `notify.enqueue` nguồn `community`). Trùng ở **giao diện**: chuông riêng của Bảng tin (`TopBar.Bell` + `NotifPop`, `GET/POST /pack/community/notifications*`) và chuông shell (`ConnectedBell`, ẩn khi `inCommunity`, chỉ hiện khi `packs.contracts`).
Quyết định: giữ **chuông shell** (`/notifications` hub). Gỡ `Bell`/`NotifPop`, port `listNotifications/markRead`, 2 route community, `d.bell` trong `CommunityDeps`. `Header.tsx`: hiện `ConnectedBell` cho mọi người đã đăng nhập (kể cả đối tác, kể cả trong Bảng tin). `link` của thông báo community phải là đường dẫn trong app tới bài (`bellView` ⇒ kiểm lúc gỡ). Tuỳ chọn: kênh (email/push) ở `hub.notify_prefs`, bật/tắt theo loại sự kiện Bảng tin ở `community.settings.notify` — hai chiều khác nhau, không trùng; cả hai hiện trong trang Cài đặt chung (pha 1).

## 4. Lát

| # | Lát | Model | File chính | Test | Phụ thuộc |
|---|---|---|---|---|---|
| L1 | Bảng `partner_profiles` + hàm `community_partners` + RLS + pack-sql allowlist + ADR-0043 | Sonnet high → Opus low soát | contracts 0103, `check-pack-sql.ts`, `docs/adr/0043-*` | int: chặn đọc chéo tenant (bảng + hàm), đối tác chỉ hàng mình | — |
| L2 | Community chuyển nguồn: 0011 + 6 repo + gỡ PUT partners + `PartnerLinker` | Sonnet high → Opus low soát (RLS) | mục 2 hàng hub community | sửa int có sẵn; 1 int linker chặn external | L1 |
| L3 | API SHT hồ sơ + mời/gỡ | Sonnet | `partner-profile.repo.ts`, routes, contracts pkg | 1 int đường chính mỗi endpoint | L1 |
| L4 | Web: SHT hồ sơ + thẻ Bảng tin; community bỏ màn đối tác | Sonnet | `features/partners/*`, `modules/community/*` | unit; viết e2e hành trình «mời đối tác → đối tác đăng nhập thấy bài» (không chạy) | L2, L3 |
| L5 | Một chuông | Sonnet | `Header.tsx`, community `TopBar/NotifPop/http/ports`, `org.routes.ts`, `community-deps.ts` | unit; int `notify.int` giữ xanh | — (song song L1) |
| L6 | Seed demo + reseed + qc sửa `cast.ts` | Sonnet (+ qc Haiku relock) | `seed-community-demo*.ts` | `seed-community-demo.int` | L2, L3 |

Thứ tự gộp: L1 → L5 ∥ → L2 → L3 → L4 → L6. L2 và L3 chạm `packs.mount.ts` ⇒ nối tiếp.

**Phục vụ CR-129:** @ trong bình luận = `community_partners` lọc `ext_org_id` có tài khoản (+ chủ quản), tên theo SHT; thấy bình luận theo bạn bè dựa trên `ext_org_id` (khoá ổn định của đối tác có tài khoản) — bảng bạn bè/tag sau này tham chiếu `ext_org_id`, không cần nguồn đối tác thứ hai.

## 5. Câu hỏi (có mặc định — không chặn)
1. **Gỡ vai:** `partner_roles` chỉ thêm (không xoá/sửa). Mặc định: pha 2 không gỡ vai được (vai là sự thật từ hợp đồng/khai tay); cần gỡ ⇒ CR sau.
2. **«Mời vào Bảng tin» khi đối tác chưa có tài khoản:** hub không tạo được `external_orgs`/user (thuộc admin-api). Mặc định: hộp thoại chọn tài khoản công ty đã có (chưa gắn); chưa có ⇒ nút «Tạo tài khoản đối tác» mở trang Admin với tên điền sẵn, quay lại chọn.
3. **`buyer` ⇒ `customer`:** chế độ audience «Người mua» đổi nhãn thành «Khách hàng» cho khớp SHT. Mặc định: đổi.
