---
id: cr110-profile-api
lát: cr110-profile-api
cr: CR-110
fr: [COM-FR-37]
làn: đầy đủ (cách ly đối tác / visibility)
migration: không
phụ thuộc: cr110-ports
---
## API (UI slice cr110-profile-ui dựng từ đây)

`@ai/contracts/community` (strict zod, `pack-community/profile.ts`):

```ts
// GET /pack/community/profile/:orgId/media?limit=1..60 (mặc định 30)&cursor=<nextCursor>
// orgId = id tenant (chủ quản) | id công ty đối tác. Hồ sơ không được xem (đối tác xem đối tác khác, id lạ, tenant khác) ⇒ 404.
ProfileMedia = {                        // ProfileMediaSchema
  items: {                              // ProfileMediaItemSchema — mới nhất trước (giờ đăng bài desc), trong bài theo thứ tự đính kèm
    id: string, postId: string, postType: "sell"|"buy"|"note",
    kind: "image"|"video",              // đúng cột community.media (chưa có tệp/mime/size — xem Quyết định)
    label: string,                      // đã che liên hệ như nội dung bài
    url?: string,                       // http(s); vắng khi đính kèm chưa có url
    createdAt: string,                  // ISO, giờ đăng bài
  }[],
  nextCursor?: string,                  // opaque; vắng = hết
}
// GET /pack/community/partners?rep=1 — tab "Đối tác" (chỉ chủ quản render). PartnerOrg thêm:
reputation?: { band: "good"|"fair"|"watch"|"new"|null, score: number|null }   // PartnerReputationSchema
//   chỉ khi: người xem chủ quản + có quyền đọc gói contracts (cổng HostBookReader tự kiểm) + đối tác có partyKey (đã liên kết SHT)
//   Không `rep=1` ⇒ như cũ. Đối tác gọi ⇒ như cũ (chỉ công ty mình, không partyKey/reputation), không gọi cổng sổ.
```
Lỗi: 400 `VALIDATION_ERROR` (cursor/limit sai); 403 `PACK_DISABLED`/`PACK_FORBIDDEN`; 404 hồ sơ không được xem.

## Plan (ngắn)
- Không viết lại luật thấy bài: câu đọc chạy trong tx người xem (`PackUow`) ⇒ RLS `posts_visible` + `media_visible` (cùng luật
  bảng tin) lọc; câu chỉ thêm "bài của bên `org`" + con trỏ. Hồ sơ được xem = `profileTarget` dùng chung với `/profile/:orgId`.
- MỘT câu SQL mỗi trang (`adapters/media.sql.ts`), hai văn bản cố định (chủ quản `author_org is null` / công ty `= $org`).
- Uy tín: MỘT lời gọi `HostBookReader.read({hints: [], partyKeys})` theo tập khoá; `forbidden` ⇒ danh sách giữ nguyên.

## Làm
- [x] Contract `pack-community/profile.ts` (`ProfileMediaQuerySchema`, `ProfileMediaSchema`, `PartnerReputationSchema`) + `PartnerOrg.reputation?`
- [x] `media.sql.ts` + `org.service.media` + `profile.routes.ts` (route media, `profileTarget` chuyển sang đây, `withReputation`) + `/partners?rep=1`
- [x] Int `community/adapters/profile-media.int.test.ts` (viết trước code, đỏ 5/6 → xanh)

## Không làm / Chạm
Không UI (cr110-profile-ui), không migration, không endpoint partners mới (Q10), không đổi `/partners` khi không có `rep=1`.

## Test tối thiểu
Int: chủ quản thấy media bài đối tác (kể cả bài ẩn) không lẫn bên khác; đối tác A thấy media chủ quản đúng audience (không bài
audience B1, không bài lưu trữ) + của mình, `/profile/S2/media` ⇒ 404; chéo tenant (B chỉ thấy B; hồ sơ A ⇒ 404; token A mang tenant B ⇒ 403);
trang con trỏ (limit=1 đi hết = một trang lớn, mới nhất trước, không trùng; cursor hỏng ⇒ 400); `?rep=1` chủ quản có/không quyền, đối tác.

## Quyết định trong lúc làm
- Shape media theo bảng thật `community.media` (`kind image|video`, `label`, `url`): brief nêu `image|file, name, mime, size, thumb`
  nhưng GĐ này media chỉ là nhãn + url (tải tệp Filebox là lát sau) ⇒ không bịa trường; thêm trường khi có tệp thật (không đổi kiểu cũ).
- `createdAt` = giờ đăng bài (media không có cột giờ riêng). Con trỏ = (giờ bài ISO đủ micro giây, id bài, vị trí) base64url.
- Chủ quản thấy cả media bài ẩn/lưu trữ (giống bảng tin chủ quản); đối tác thấy bài mình kể cả ẩn (RLS hiện có, Chưa rõ #1 của C3).
- Tab Đối tác dùng lại `/partners` (Q10) + cờ `?rep=1` để feed/rail không trả phí gọi sổ SHT mỗi lần; đối tác giữ hành vi cũ (chỉ công ty
  mình — UI không render tab) thay vì 403, tránh vỡ client hiện dùng `/partners` cho đối tác.
- Uy tín tối đa `HOST_BATCH_MAX` khoá mỗi lần (giới hạn cổng); vượt ⇒ đối tác sau không có `reputation`.
- Perf (Luật 4c): 1 câu/trang; kế hoạch dự kiến `posts_author_org_idx (tenant_id, author_org, created_at desc)` (cả nhánh `is null`) +
  nested loop `media_post_idx (post_id, position)`; không cần index/migration mới. Chưa đo EXPLAIN trên dữ liệu lớn (không phải đường nóng có ngưỡng).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED community/hien-thi.md
#### Yêu cầu: Hồ sơ — tab "Ảnh & tệp" chỉ media bài người xem được thấy
`GET /pack/community/profile/:orgId/media` trả đính kèm của bài công ty `orgId` mà người xem được thấy theo luật bảng tin (RLS), mới nhất trước, phân trang con trỏ. Đối tác chỉ xem hồ sơ công ty mình + chủ quản; công ty khác ⇒ 404; không bao giờ lộ media bài đối tác khác.
- Kịch bản: chủ quản xem hồ sơ đối tác ⇒ mọi media bài của đối tác đó [test: apps/hub-api/src/modules/packs/community/adapters/profile-media.int.test.ts » [COM-FR-37] chủ quản thấy mọi đính kèm bài của công ty đối tác (kể cả bài ẩn), không lẫn bên khác]
- Kịch bản: đối tác xem chủ quản/chính mình/đối tác khác [test: apps/hub-api/src/modules/packs/community/adapters/profile-media.int.test.ts » [COM-FR-37] đối tác A thấy media chủ quản đúng audience + của mình; không bao giờ của đối tác B]
- Kịch bản: tenant khác bị chặn [test: apps/hub-api/src/modules/packs/community/adapters/profile-media.int.test.ts » [COM-FR-37] chặn chéo tenant: B chỉ thấy media B; hồ sơ tenant A ⇒ 404; user A mang tenant B ⇒ 403]
- Kịch bản: phân trang ổn định [test: apps/hub-api/src/modules/packs/community/adapters/profile-media.int.test.ts » [COM-FR-37] trang con trỏ ổn định: đi từng trang = một trang lớn, mới nhất trước, không trùng]

#### Yêu cầu: Hồ sơ — tab "Đối tác" có điểm uy tín chỉ cho chủ quản
`GET /pack/community/partners?rep=1` gắn `reputation` (qua cổng `HostBookReader`) cho đối tác đã liên kết SHT khi người xem là chủ quản có quyền đọc gói contracts; còn lại trả như cũ; đối tác không bao giờ nhận uy tín và không gọi cổng sổ.
- Kịch bản: chủ quản có quyền contracts ⇒ có uy tín [test: apps/hub-api/src/modules/packs/community/adapters/profile-media.int.test.ts » [COM-FR-37] chủ quản có quyền contracts: uy tín qua HostBookReader cho đối tác đã liên kết SHT]
- Kịch bản: chủ quản không quyền / đối tác ⇒ không uy tín [test: apps/hub-api/src/modules/packs/community/adapters/profile-media.int.test.ts » [COM-FR-37] chủ quản không quyền contracts / đối tác: không uy tín; đối tác không gọi cổng sổ]

## Việc còn lại
- cr110-profile-ui: `client.getProfileMedia(orgId, cursor)` + `getPartners({rep: caps.contracts})`; chỉ render tab Đối tác cho chủ quản.
- Cuối đợt: gộp Delta vào `docs/current/community/hien-thi.md`; ADR-0031 ghi `HostBookReader` dùng thêm cho uy tín tab Đối tác.
