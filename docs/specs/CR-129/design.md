---
id: CR-129
title: Bảng tin — bình luận mở theo bạn bè, @nhắc đối tác, composer, hồ sơ cá nhân
status: design (PLAN, backend-lead 2026-11-12)
nguồn: docs/CHANGE-REQUESTS.md dòng CR-129 · nghiep-vu.md §3, §6 (D3), §10 · hien-thi.md §3 (HT-40…50) · CR-130 design §1–4, ADR-0043
---
# CR-129 — Thiết kế

## 1. Mô hình dữ liệu (phương án đơn giản nhất)
**Hiện nay:** `community.threads` (một hàng mỗi bài × công ty đối tác, D3) + `community.comments` (`thread_id`, `thread_org` chép của luồng, `author_org`). RLS: đối tác chỉ `thread_org = mình`. Không có bảng bạn bè: chủ quản↔đối tác là bạn khi đối tác còn hiệu lực (R11, `admin.users kind=external` + `admin.external_orgs.active`, đọc qua `packs.viewer_ext_org()` / `dir.orgs`); đối tác↔đối tác không tồn tại.

**Đích (bỏ khái niệm luồng — mỗi bài một danh sách bình luận phẳng):**
| Thay đổi | Chi tiết |
|---|---|
| `DROP TABLE community.threads` | gỡ luôn (D6), không backfill (chưa có khách) |
| `comments` bỏ `thread_id`, `thread_org`, `comments_author_ck`, `comments_thread_idx`, `comments_post_idx` | |
| `comments.mention_orgs uuid[] NOT NULL DEFAULT '{}'` + `CHECK (cardinality(mention_orgs) <= 10)` | **thay bảng mention**: một nguồn, ghi một câu, policy đọc ngay trong hàng (không join, không đệ quy policy giữa 2 bảng); tag theo **công ty đối tác** (`ext_org_id` — khoá ổn định CR-130). Không bảng mới ⇒ không cần int chéo tenant mới (bảng `comments` đã có). |
| Index `comments_post_at_idx (post_id, created_at, id)` | phân trang theo bài |
| Trigger `comments_fixed` (0002) thêm `mention_orgs` vào danh sách bất biến | sửa bình luận không đổi tag ⇒ không phát chuông lại |
| Hàm `community.sides_friend(a uuid, b uuid) RETURNS boolean LANGUAGE sql IMMUTABLE` = `a IS NOT DISTINCT FROM b OR a IS NULL OR b IS NULL` | "bên" = `ext_org_id`, NULL = chủ quản. Cùng bên hoặc một phía là chủ quản ⇒ bạn (mạng sao). Mở kết bạn đối tác↔đối tác sau: thêm bảng `community.org_friends` + đổi thân hàm (STABLE), policy/luật không đổi. |
Migration: `packages/db/migrations-pack-community/0015_cr129_open_comments.sql`, journal idx 14, `when` **1807000304000**.

## 2. RLS (mô tả vị từ; `v` = `(SELECT packs.viewer_ext_org())`, một lần mỗi câu)
| Policy | Vị từ |
|---|---|
| `comments_visible` SELECT | `v IS NULL` (chủ quản/việc nền: tất cả, kể cả `hidden`) OR (`NOT hidden` AND EXISTS bài `p` thấy được [RLS posts] với `p.id = post_id` AND (`community.sides_friend(author_org, v)` OR `p.author_org = v` OR `v = ANY(mention_orgs)`)) |
| `comments_insert` | việc nền OR (`author_org IS NOT DISTINCT FROM v` AND bài thấy được AND `NOT EXISTS (SELECT 1 FROM unnest(mention_orgs) m WHERE NOT community.sides_friend(author_org, m))`) — đối tác hôm nay không tag được ai (sao) |
| `comments_update`/`_delete` | giữ 0002 nhưng bỏ điều kiện luồng: chủ quản (ẩn/sửa của mình), đối tác chỉ hàng `author_org = v AND author_user_id = app.user_id` |
Hệ quả (= yêu cầu c): đối tác thấy bình luận của công ty mình + của chủ quản + mọi bình luận trên bài chính mình + bình luận tag mình; không thấy đối tác khác. **Đổi hành vi lớn: câu trả lời của chủ quản cho S2 nay S1 cũng thấy** (HT-44). Dưới mạng sao, tag chỉ còn tác dụng chuông (bình luận chủ quản vốn đã công khai với người thấy bài).

Luật thuần (QC viết test trước) — `apps/hub-api/src/modules/packs/community/domain/comment-visibility.rules.ts`:
```ts
type Side = string | null; // null = chủ quản
isFriend(a: Side, b: Side): boolean
canSeeComment(viewer: Side, c: { authorOrg: Side; postAuthorOrg: Side; mentions: readonly string[]; hidden: boolean }): boolean
mentionAllowed(writer: Side, target: string, activeOrgs: readonly string[]): boolean // bạn + công ty còn hiệu lực
```
**Test HT phải đổi** (không file nào thuộc `tests/.lock`): `visibility.rls.int.test.ts` §3 (HT-40…50 viết lại: HT-44 thành "Thấy", HT-48/49 bỏ "luồng"; thêm HT-51 S1 thấy bình luận tag S1, HT-52 S1 không chèn được `mention_orgs=[S2]` → 42501); `comments.routes.int.test.ts` (bỏ "Nhắn riêng"); `community.routes.int.test.ts`, `community.review.int.test.ts`, `community.rls-tenant.int.test.ts`, `notify.int.test.ts`, `notify.rules.test.ts` (bỏ `threads`/`thread_org`). **File khoá cần qc:** `e2e/community-web/roles.cs.ts` (tab công ty/luồng riêng L56–67), `e2e/community-web/feed.cm.ts` (bình luận); e2e hành trình mới `cr129-mention.cs.ts` (0d.10, viết không chạy trong lát).

## 3. API (`/pack/community`, contract `packages/contracts/src/pack-community/thread.ts` → đổi tên `comment.ts`)
| Endpoint | Request | Response | Lỗi |
|---|---|---|---|
| `GET /posts/:id/comments` (thay `/threads`, `/threads/:orgId`) | `cursor?` (≤200, `createdAt|id`), `limit` 1–100 mặc định 50 | `{ comments: CommentView[], nextCursor? }` cũ→mới, RLS lọc | bài không thấy ⇒ 404 |
| `GET /posts/:id/mentionables` | `q?` trim ≤60 (ilike tên), `limit` 1–20 mặc định 8 | `[{ orgId, name }]` = công ty còn hiệu lực, `isFriend(người viết, org)`, `audience_ok` bài (bài đối tác: chỉ công ty đăng); tên từ `contracts.community_partners(dir.orgs active)`. Đối tác hôm nay ⇒ `[]` | quyền `read`; bài không thấy ⇒ 404 |
| `POST /posts/:id/comments` | `{ text: 1–2000, mentions: uuid[] ≤10, mặc định [] }` (bỏ `orgId`) | 201 `CommentView` vừa tạo | `mentions` ngoài tập mentionables ⇒ **422 `MENTION_NOT_ALLOWED`** "Không nhắc được công ty này trên bài này"; 42501 ⇒ 404 |
| `PATCH` / `DELETE` / `POST …/:cid/hide` | như cũ | `CommentView` / 204 | như cũ |
`CommentView` bỏ quan hệ luồng; thêm `mentions: [{ orgId, name }]` (đối tác chỉ nhận phần tử là công ty mình). Một tx ghi = 3 câu cố định (trạng thái bài · kiểm mentions theo mảng · insert). Lời nhắc được kiểm ở service **và** RLS.

**Chuông:** kind mới `mention` (`NOTIFY_KIND_LIST`, bell `community.mention`, mặc định Bật, có ở Cài đặt). Phát trong `emitComment` SAU commit (không khi gõ). Người nhận = user còn hiệu lực của `mention_orgs` thấy bài, trừ người viết; một người một chuông/bình luận, ưu tiên `mention` > `comment` > `reply`; dedup `c:<commentId>:mention`; link `/community?post=<id>&comment=<cid>` (bỏ `&thread=`). `reply` đổi nghĩa: người từng bình luận trên bài **và** `canSeeComment` bình luận mới. Thêm cổng kit `ExternalOrgResolver.orgMembers(tenantId, orgIds[]) → Map<orgId, userId[]>` (MỘT câu, chỉ user active).

**Hồ sơ (e):** `FeedQuerySchema` thêm `authorUserId?: uuid` (lọc `p.author_user_id`, RLS giữ nguyên). Không endpoint mới.

**Hiệu năng:** không đường nóng có ngưỡng ⇒ không perf test. Đọc 1 câu/trang (index `comments_post_at_idx`, policy dùng `v` initplan + EXISTS bài theo PK + `= ANY` trong hàng); mentionables 1 câu (`community_partners(array)` + `audience_ok`); chuông: 1 lời gọi `orgMembers` + số câu cố định trong tx hệ thống.

## 4. Lát + model
| Lát | Việc | Model | File chính | Test tối thiểu | Phụ thuộc |
|---|---|---|---|---|---|
| L1 | Migration 0015 + rules thuần + repo/service/route bình luận + contract + quote.repo | Sonnet high → **Opus low soát** (RLS + mentions) | xem Bản đồ | unit rules; int `visibility.rls` §3 (luật thấy); int 3 endpoint (GET, mentionables, POST 422) | — |
| L2 | Chuông `mention` + `reply` theo luật mới + `orgMembers` | Sonnet high (soát gộp cùng L1) | notify.*, kit ext-org | unit `commentRecipients`; int `notify.int` 1 ca mention | L1 |
| L3 | Web bình luận: bỏ tab công ty/Nhắn riêng, danh sách phẳng, ô @ gợi ý | Sonnet | Thread.tsx, CommentItem, http/ports/mock | unit domain mention | L1 |
| L4 | Composer gọn + hộp thoại «Nhóm hàng» | Sonnet (cùng agent L3, nối tiếp) | Composer.tsx, mới `CategoryDialog.tsx`, feed.css | unit nếu có logic | — |
| L5 | Hồ sơ cá nhân + tab «Bài đăng của tổ chức» | Sonnet (cùng agent UI) | Profile.tsx, profile-sections.ts, sections.tsx, FeedQuery, post.sql.ts | unit sections; int feed `authorUserId` | L1 |
| L6 | qc: sửa e2e khoá + `cr129-mention.cs.ts` + relock | Sonnet (qc) | roles.cs.ts, feed.cm.ts | chạy 1 lần cuối CR | L1–L5 |
Cuối CR: docs-architect sửa `nghiep-vu.md` §6/§10, `hien-thi.md` §3 + Hồ sơ.

## 5. Bản đồ file
| Lát | File · hàm · điểm chạm |
|---|---|
| L1 | `packages/db/migrations-pack-community/0015_cr129_open_comments.sql` (mới) + `meta/_journal.json` · `apps/hub-api/src/modules/packs/community/adapters/thread.repo.ts` → `comment-list.repo.ts`: bỏ `threadSummaries`, `threadComments`→`listComments(tx, postId, page)`, `insertComment` (1 câu, `mention_orgs`), bỏ `orgMaySee`, thêm `mentionables(tx, postId, orgs, q, limit)` · `thread.service.ts` → `comment-list.service.ts` (`add`: bỏ `threadOrg`/`THREAD_REQUIRED`) · `threads.routes.ts` → `comments.routes.ts` (đăng ký ở router gói) · `comment.repo.ts` (`returning thread_org` → `returning id`, bỏ `mayStartThread`) · `comment.service.ts` · `quote.repo.ts` L24–25 (`coalesce(c.author_org, p.author_org)`) · `domain/comment-visibility.rules.ts` (+ `.test.ts`) · `packages/contracts/src/pack-community/thread.ts` → `comment.ts` + `index.ts` · int: `visibility.rls.int.test.ts`, `comments.routes.int.test.ts`, `community.routes.int.test.ts`, `community.review.int.test.ts`, `community.rls-tenant.int.test.ts` |
| L2 | `domain/notify.rules.ts` (`NOTIFY_KIND_LIST` + `mention`, `commentRecipients(cands, {actorOrg, postAuthorOrg, mentions}, actor)`, `bellText` case `mention`, link) · `adapters/notify.repo.ts` `commentCandidates` (bỏ `thread_org`, thêm `author_org`, `mention_orgs`) · `adapters/notify.events.ts` `emitComment` (bỏ `threadOrg`, thêm `commentId`/mentions) · `packs/kit/application/ext-org.ports.ts` + `kit/adapters/ext-org.pg.ts` (`orgMembers`) · cài đặt chuông (danh sách kind web `ui/settings`) |
| L3 | `apps/workspace-web/src/modules/community/ui/Thread.tsx` (đổi thành danh sách phẳng + ô @), `ui/CommentItem.tsx`, `domain/thread.ts` (bỏ "Nhắn riêng"; thêm luật token @), `application/ports.ts`, `adapters/http.ts` L84–85, `adapters/mock.ts`, `mock-comments.ts`, `seed.ts`, `useFeed.ts`/`Shell.tsx` (param `comment=` thay `thread=`) |
| L4 | `ui/Composer.tsx` (345 dòng — tách hàng nút + `CategoryDialog.tsx`), `ui/DraftFields.tsx`, `ui/styles/feed.css`, `ui/icons.tsx` (nút đính kèm chỉ icon + `aria-label`) |
| L5 | `ui/Profile.tsx`, `domain/profile-sections.ts` (+test), `ui/profile/sections.tsx`, `packages/contracts/src/pack-community/feed.ts` (`authorUserId`), `apps/hub-api/.../adapters/post.sql.ts` (lọc ~L119) |
| L6 | `e2e/community-web/roles.cs.ts` L56–67, `e2e/community-web/feed.cm.ts`, mới `e2e/community-web/cr129-mention.cs.ts`, `tests/.lock` |

## 6. Câu hỏi (có mặc định — không chặn)
1. Chủ quản tag S1 và S2 trong **một** bình luận ⇒ S1 đọc thấy chữ "@S2" (S2 cũng vậy) — lộ đối tác cho nhau. **Mặc định:** chấp nhận (nội dung chủ quản không che, như HT-55); `mentions` trả về đối tác chỉ chứa công ty mình; ô @ hiện nhắc "Mọi đối tác thấy bài sẽ đọc được bình luận này".
2. Đối tác gõ @ hôm nay không có ai để nhắc (sao). **Mặc định:** không hiện danh sách; không cho nhắc chủ quản (chủ quản đã nhận chuông `comment`/thấy mọi bình luận).
3. Bình luận bị chủ quản ẩn: chính người viết còn thấy? **Mặc định:** giữ HT-46 (không thấy).
