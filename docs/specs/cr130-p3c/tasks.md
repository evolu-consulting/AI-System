---
id: cr130-p3c
lát: cr130-p3c (CR-130 pha 3 · lát 4: web/admin gộp Bảng tin vào gói contracts — ADR-0044)
cr: CR-130
làn: nhanh
migration: không (lát 2/3 ở agent khác: migration/seed/`app-catalog.seed.ts`/hub — KHÔNG sửa ở đây)
phụ thuộc: cr130-p3a (hub guard, khoá add-on `contracts-community`)
---
## Plan (ngắn)
Gỡ mọi chỗ UI/luật web nói «gói/quyền Community»: Bảng tin = add-on `contracts-community` của Sổ Hợp Tác, **chỉ admin nền tảng bật** (mặc định tắt), không còn mức Xem/Sửa/Quản trị hay vai riêng.

| Vùng | Đã làm |
|---|---|
| admin-web · tính năng | `feature-meta.ts`: bỏ `community-read/write/admin`, đăng ký `contracts-community` là tính năng thêm (KNOWN addon); app `community` `levels:false` (không còn thanh mức). Nhãn «Bảng tin» + mô tả nghiệp vụ ở i18n `featmeta.f.contracts-community.*` (vi/en) |
| admin-web · công tắc | không thêm màn mới: add-on hiện ở danh sách tính năng thêm của thẻ Sổ Hợp Tác (`AddonList`/`TenantFeaturesTab`); tab đã `readOnly` với mọi vai ≠ `platform_admin` (kiểm quyền có sẵn) ⇒ quản trị công ty chỉ xem, không bật được |
| admin-web · ứng dụng/vai | `AppCardMeta` bỏ cảnh báo Community + số đối tác (`use-apps-tab` bỏ query đối tác, `TenantFeaturesTab` bỏ prop); `RoleBlock` bỏ ghi chú vai Community; `levels.ts` bỏ `community` khỏi gói có vai; i18n gỡ `tenants.apps.community*`, `appRoles.note.community`, `appRoles.pack.community` |
| admin-api | `packs.{rules,service,repo}.ts` sinh feature/Group THEO KHOÁ GÓI (không có `community` cứng) ⇒ không cần sửa; `EXTERNAL_APPS` giữ `community` (mặt Bảng tin) + ghi chú phải trùng `EXTERNAL_SURFACES` của hub (không import chéo app) |
| workspace-web | `COMMUNITY_PACK` ⇒ `COMMUNITY_FLAG` (cờ `community` do Hub tính từ add-on, không phải gói); `CommunityRoute` cờ tắt ⇒ `EmptyState kind="off"` «Bảng tin chưa được bật cho công ty — liên hệ quản trị nền tảng»; `PackStatePage` bỏ nhánh `pack="community"` (và i18n `packState.communityOff` đổi câu); mock `seed.ts` bỏ `host_admin` (hai persona chủ quản đều `host_member`, vào được SHT) |
| packages | `COMMUNITY_ROLES` bỏ `host_admin`; `community.manifest.ts` mức = `contracts-read/write/admin` (không còn feature `community-*`); test `preview`, `template-readiness` cập nhật |

## Quyết định trong lúc làm
- Cột `app` của feature `contracts-community` do migration lát 2 quyết; web chịu được cả hai: `contracts` ⇒ nằm ở thẻ Sổ Hợp Tác; `community` ⇒ thẻ dạng danh sách một công tắc (vì `levels:false`).
- Không gỡ `community.*` khỏi `flow-rows.ts`/`library-view.ts`: đó là KHE quy trình (tên module tính năng), giữ theo ADR-0044 mục 5; không có chỗ hiện Group community ở web (Group `community-*` chỉ ở seed/hub).
- Câu «Bảng tin chưa được bật…» dùng một câu theo yêu cầu; không nút (người bị chặn không tự bật được).
- `FEATURE_APP_IDS`/`TENANT_APP_IDS` (packages/contracts/light) giữ `community` để khớp CHECK cột DB cho tới khi lát 2 đổi.

## Test
unit: admin-web `feature-meta.test` (đăng ký add-on, bỏ `community-*`, thứ tự nhóm), `feature-assign.test` (add-on nằm ở thẻ Sổ Hợp Tác, không thẻ mức riêng); contracts `preview.test`, `template-readiness.test`; workspace-web (không đổi hành vi test nào ngoài `logic.test` đổi vai). Đã chạy: `bun test src` admin-web 1202 xanh · workspace-web 861 + 1 đỏ có sẵn (`attach.test.ts`) · contracts 609 + 2 đỏ có sẵn (múi giờ tenant); tsc admin-web/workspace-web sạch, tsc admin-api/contracts chỉ lỗi `BodyInit` có sẵn ở file hub; biome; `i18n:check`; workspace-web `check:bundle` OK (js 145.0 KB). admin-web `check:bundle` đỏ có sẵn (chunk `l2` 63.6 KB > 50 KB, không do lát này). Int admin-api (`packs.first-admin.int.test.ts`…) cần DB — không chạy.

## e2e khoá có thể vỡ (qc sửa cuối đợt; lát này không sửa `e2e/**`)
- `e2e/feature-ui.spec.ts:15` — danh sách khoá đăng ký còn `community-read`.
- `e2e/pm-checklist/admin-cr112.pm.ts:27` — vòng `["contracts", "community"]` mong thẻ app Community ở tab Ứng dụng.
- e2e hành trình mới (admin nền tảng bật «Bảng tin» → đối tác đăng bài): thuộc lát 5.

## Việc còn lại
Lát 2/3 (catalog + seed) đổi cột `app`/Group; sau đó kiểm lại thẻ Bảng tin trên admin-web bằng ảnh chụp cuối đợt; `app-catalog.seed.ts` còn `requiredFeature: "community-read"` (lát 2).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-12 (đợt cr132-wave)
### ADDED admin/bang-tin-add-on.md
#### Yêu cầu: Bảng tin là tính năng thêm của Sổ Hợp Tác, chỉ quản trị nền tảng bật (nguồn: CR-130, ADR-0044)
Màn công ty của quản trị nền tảng có công tắc «Bảng tin» trong danh sách tính năng thêm của Sổ Hợp Tác (mặc định tắt). Không còn mức Xem/Sửa/Quản trị riêng cho Bảng tin, không còn vai hay Group Bảng tin; quản trị công ty chỉ xem trạng thái, không bật được.
- Kịch bản: khi tải danh sách tính năng thì «Bảng tin» là tính năng thêm đã đăng ký của Sổ Hợp Tác và các khoá `community-read/write/admin` không còn được đăng ký [test: apps/admin-web/src/features/features/lib/feature-meta.test.ts » metaOf]
- Kịch bản: khi dựng thẻ ứng dụng thì «Bảng tin» nằm trong tính năng thêm của thẻ Sổ Hợp Tác, thẻ này chỉ có mức theo khoá `contracts-*` [test: apps/admin-web/src/features/tenants/lib/feature-assign.test.ts » ADR-0044]
#### Yêu cầu: Mặt Bảng tin của app dùng mức quyền Sổ Hợp Tác (nguồn: CR-130, ADR-0044)
Xem trước quyền của app Bảng tin tính theo `contracts-read/write/admin`; node «Hiện bài» của quy trình cần tính năng `contracts-community`.
- Kịch bản: khi bật `contracts-read` và `contracts-write` thì xem trước app Bảng tin cho mức Sửa [test: packages/contracts/src/app-manifest/preview.test.ts » previewApp]
- Kịch bản: khi công ty chưa bật tính năng `contracts-community` thì mẫu quy trình có node «Hiện bài» chưa sẵn sàng, nêu đúng tính năng và bước [test: packages/contracts/src/modules/template-readiness.test.ts » templateReadiness]
### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Bảng tin chưa bật thì nói rõ vì sao và ai bật (nguồn: CR-130, ADR-0044)
Người dùng mở `/community` khi công ty chưa được bật Bảng tin thấy câu «Bảng tin chưa được bật cho công ty — liên hệ quản trị nền tảng», không phải trang trắng và không nhắc «gói Cộng đồng». Chủ quản không còn vai quản trị riêng: mọi nhân viên nội bộ là thành viên chủ quản.
- Kịch bản: khi chủ quản dùng dữ liệu mẫu thì cả hai nhân viên chủ quản đều là thành viên và đều vào được Sổ Hợp Tác [test: apps/workspace-web/src/modules/community/domain/logic.test.ts » audience]
