---
id: fix-e2e-web
lát: fix-e2e-web (sửa lỗi sản phẩm vùng web do e2e cuối đợt tìm ra — CR-130/131/132)
cr: CR-130
làn: nhanh
migration: không
phụ thuộc: cr130-p3c, cr132-w3
---
## Plan (ngắn)
| Mục | Kết luận | Sửa |
|---|---|---|
| b | lỗi sản phẩm | `CONTRACTS_PAGES` thêm `messages` ⇒ `/contracts/messages` không còn thành `/contracts/c/messages` |
| g | lỗi sản phẩm | `/contracts/{login,sso,privacy,terms}` (đích của SSO/đăng xuất cũ: web-kit `sso.ts` ghép `<url app>/login?sso=none…`, `/sso#code=…`) nay chuyển về route gốc cùng tên, GIỮ `?query#hash` (mã SSO ở hash) — không còn «Không tìm thấy». Không có code web nào tự sinh URL này (chỉ bookmark/catalog cũ) |
| c | lỗi sản phẩm (bản mock) | bản mock không có `/pack/me` ⇒ cờ `community` rơi về false trước khi trang Community kịp báo nhân vật ⇒ luôn «chưa bật». `shell/mock-flag.ts` (một nguồn cờ mock) + `PACK_FALLBACKS` bật sẵn `community` CHỈ khi dựng mock; bản thật không đổi |
| d | lỗi sản phẩm | `CreateFlowDialog`: app chọn được = gói bật + «Bảng tin» khi gói contracts bật ∧ add-on `contracts-community` được cấp (`flows/lib/flow-apps.ts`, đọc entitlement công ty) |
| e | lỗi sản phẩm | `assistantVisible(role, kind)`: user ngoài (`kind = external`, vai thật không phải `partner`) không có nút/khoang trợ lý; `Shell` truyền `user.kind` |
| f | lỗi sản phẩm (không phải thời điểm test) | bấm thông báo từ chuông web-kit là điều hướng TRONG app (`router.navigate`), khi đã ở `/community` thẻ bài không dựng lại nên `open` (khởi tạo từ `location.search` lúc mount) và cuộn tới `[data-comment-id]` không chạy lại. Ctx Community thêm `urlSearch` (cập nhật theo router); `PostCard` mở bình luận khi `?post&comment` đổi, `Thread`/`useFocusPost` cuộn lại theo `urlSearch` |

## Quyết định trong lúc làm
- (g) chuyển hướng ở bảng `LEGACY_EXACT` (đã được root `beforeLoad` gọi) thay vì thêm route `/contracts/login`; `safeNext` vẫn từ chối `next=/contracts/login` (không trở lại trang đăng nhập).
- (c) không đụng `guard.ts`/`adapters/index.ts` (đã tự kiểm `__COMMUNITY_MOCK__`); chỉ gom thêm MỘT hằng cho shell.
- (e) giữ nhánh `role === "partner"` cho nhân vật mock.
- Không sửa `e2e/**` (qc giữ). Mục (c)/(f) chưa chạy lại e2e trong lát.

## Test
unit: `legacy-routes.test.ts` (b, g), `shell/mock-flag.test.ts` (c: bản thường không bật sẵn), `tenants/flows/lib/flow-apps.test.ts` (d), `chat.rules.test.ts` (e), `community/domain/search-hint.test.ts` » opensCommentThread (f). Đã chạy: workspace-web 870 xanh + 1 đỏ có sẵn (`attach.test.ts`); tsc workspace-web + admin-web sạch; biome; workspace-web `build` + `check:bundle` OK (js 145.1 KB).

## Việc còn lại
qc chạy lại e2e community-web (mock) + `cr129-mention.cs.ts` + `cr130-journey.cs.ts`; (c) chỉ xác nhận được bằng job mock.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-12 (đợt cr132-wave)
### ADDED shell/sua-loi-e2e-web.md
#### Yêu cầu: Đường cũ của Sổ Hợp Tác và trang «Tin nhắn» không dẫn tới «Không tìm thấy» (nguồn: CR-130, CR-132)
`/contracts/messages` là trang Tin nhắn. Các đích cũ `/contracts/login`, `/contracts/sso`, `/contracts/privacy`, `/contracts/terms` (SSO, đăng xuất, bookmark) chuyển về trang cùng tên ở gốc và giữ nguyên query và hash.
- Kịch bản: khi mở `/contracts/messages` thì không bị đổi thành đường hợp đồng; khi mở `/contracts/login?sso=none#x` thì về `/login?sso=none#x` [test: apps/workspace-web/src/shared/kernel/legacy-routes.test.ts » route gốc của app]
#### Yêu cầu: Quy trình theo Bảng tin chọn được khi công ty đã bật Bảng tin; đối tác không có trợ lý AI; thông báo nhắc tên mở đúng bình luận (nguồn: CR-130)
Khi tạo quy trình công ty, «Bảng tin» là lựa chọn nếu công ty bật gói Sổ Hợp Tác và tính năng «Bảng tin». Người dùng đối tác không thấy nút hay khoang trợ lý AI. Bấm thông báo nhắc tên khi đang ở Bảng tin thì mở bình luận và cuộn tới đúng bình luận.
- Kịch bản: khi công ty bật add-on Bảng tin thì danh sách app có Bảng tin, tắt thì không, tắt gói Sổ Hợp Tác thì không [test: apps/admin-web/src/features/tenants/flows/lib/flow-apps.test.ts » flowAppsOf]
- Kịch bản: khi người dùng là đối tác (vai thật là thành viên, loại ngoài) thì trợ lý bị ẩn [test: apps/workspace-web/src/features/assistant/lib/chat.rules.test.ts » assistantVisible]
- Kịch bản: khi URL có ?post và ?comment đúng bài thì thẻ bài mở bình luận, bài khác hoặc thiếu comment thì không [test: apps/workspace-web/src/modules/community/domain/search-hint.test.ts » opensCommentThread]
- Kịch bản: khi bản dựng thường thì không có cờ mock bật sẵn Bảng tin [test: apps/workspace-web/src/shell/mock-flag.test.ts » bản dựng thường]
