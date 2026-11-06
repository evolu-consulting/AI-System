# P3 · Hồ sơ kiểu Facebook

Thuộc `index.md` (CR-106). Mã: **COM-FR-35…37**. Áp cho cả chủ quản và đối tác; **đối tác không có mục SHT** (Q6, I1).

## 1. Mục tiêu
Hồ sơ công ty gồm cover + logo lớn + tên + số liệu + hàng tab mục, với mô hình section khai báo để thêm mục sau không sửa trang.

## 2. Mock
Artifact https://claude.ai/artifact/QWj14SrNPkErSZU2FC6GWQ — mục: Hồ sơ (cover · biglogo · tên · hstats · hàng tab [Giới thiệu, Bài đăng, Đối tác, Attachment]).

## 3. Nghiệp vụ

### 3.1 Hero + số liệu — COM-FR-35
| # | Nội dung | Nhãn | Nguồn |
|---|---|---|---|
| H1 | Cover (cao 90) + `biglogo` + tên + dòng phụ (chủ quản: `blurb`; đối tác: "Nhà cung cấp · Người mua" + khu vực) | Giữ; biglogo: Đổi sang ảnh logo brand nếu có, không thì chữ cái đầu | `Profile.tsx:22-31,92-105` |
| H2 | Tag "đối tác đã rời" | Giữ | `Profile.tsx:105` |
| H3 | `hstats`: Bài đang đăng · Đã lưu trữ · Bình luận nhận được · Bạn bè (chỉ khi `stats.friends` có) | Giữ | `Profile.tsx:108-127` |
| H4 | Màu cover theo accent brand công ty đang được xem; chưa có brand ⇒ accent `indigo` (P0 D5) | Đổi | P0 Q3 |

### 3.2 Mô hình section + hàng tab — COM-FR-36
| # | Nội dung | Nhãn | Nguồn |
|---|---|---|---|
| S1 | Hàng tab dưới hero: **Giới thiệu · Bài đăng · Đối tác · Attachment**; mặc định "Bài đăng" | Mới | hiện chỉ có `FeedList` (`Profile.tsx:130-135`) |
| S2 | Mô hình section = mảng khai báo `{ id, labelVi, labelEn, canView(viewer, target), source }`; trang chỉ render từ mảng; thêm mục = thêm một phần tử + component | Mới | — |
| S3 | `canView` bắt buộc; mục không qua `canView` **không render** (không "bản khoá"), kể cả tab | Mới | I1, I3 |
| S4 | Đồng bộ URL: `#/profile[/orgId][/section]`; section lạ ⇒ "Bài đăng" | Mới | `ctx.tsx:46-51` (`parseHash`) |

Khai báo ban đầu:
| id | VI / EN | Ai xem | Nguồn dữ liệu |
|---|---|---|---|
| `about` | Giới thiệu / About | mọi người xem được hồ sơ (theo D2–D4) | `profile.org` (`blurb`, `labels`, `cats`, `area`) — `viewer.ts:55-67` (`ProfileSchema`), `:32-43` (`PartnerOrgSchema`) |
| `posts` | Bài đăng / Posts | như hiện tại (chủ quản thấy bài đối tác theo D2; đối tác chỉ thấy bài mình) | `FeedList fixed={mine|authorOrgId}` `Profile.tsx:131` |
| `partners` | Đối tác / Partners | công ty bạn bè của hồ sơ đang xem (Q4); cột uy tín **chỉ chủ quản** | `api.listPartners()` hoặc endpoint mới (§5); điểm uy tín từ SHT qua port (P5) |
| `files` | Attachment / Attachments | như `posts` | `GET /profile/:orgId/media` — gom ảnh/tệp từ bài người xem được thấy (Q5); shape `ProfileMediaSchema` ở §5.1 |
Không có `sht` hay mục nào dẫn vào dữ liệu SHT cho đối tác.

### 3.3 Nội dung mục — COM-FR-37
| # | Mục | Nhãn | Chi tiết |
|---|---|---|---|
| A1 | Giới thiệu | Mới | Mô tả (blurb), loại (Chủ quản / NCC / Người mua), khu vực, nhóm hàng. Chỉ đọc; **không** chứa hợp đồng hoa hồng (từ điển P0 "Giới thiệu"). Mô tả chỉ đọc trong CR-106; sửa mô tả ngoài phạm vi (P0 D17) |
| A2 | Bài đăng | Giữ | Composer (chỉ hồ sơ của mình) + `FeedList` tab Tất cả / Đã lưu trữ — `Profile.tsx:129-137` |
| A3 | Đối tác | Mới | Danh sách công ty bạn bè: tên, nhãn, khu vực, "đã rời"; bấm ⇒ `profile/<orgId>`. Cột "Điểm uy tín": chỉ chủ quản đủ quyền contracts (I3); đối tác không có cột |
| A4 | Attachment | Mới | Lưới ảnh/tệp từ các bài **người xem được phép thấy** (cùng bộ lọc D2–D4; thông tin liên hệ bị che giữ che); bấm mở bài |
| A5 | Danh sách "Đối tác" trong `.wsside` của Hồ sơ | Đổi | chuyển thành nhóm trong sidebar P1 (`Profile.tsx:71-84` bỏ) |

## 4. Điều hướng & trạng thái
Route `profile` (+`orgId`, +`section`). Mỗi mục: tải · rỗng · lỗi · không quyền (mục ẩn). Rỗng: "Chưa có bài đăng." / "Chưa có đối tác." / "Chưa có ảnh hay tệp." Chưa tải: `aria-busy` (`Profile.tsx:21`).

## 5. Dữ liệu / Contract
| Điểm | Nội dung | Trạng thái |
|---|---|---|
| `Profile` | hiện: `org`, `stats{active,archived,comments,friends?}`, `shtUrl?` (`pack-community/viewer.ts`) | Giữ; `shtUrl` bỏ khỏi hồ sơ (nhóm SHT sang sidebar, URL từ `VITE_CONTRACTS_URL`); kiểm không còn nơi dùng khi code |
| Bạn bè của hồ sơ đích | `GET /pack/community/profile/:orgId/partners` — công ty bạn bè của `orgId` (theo quyền người xem); shape ở §5.1 | **Đã chốt (backend-lead)** |
| Attachment | `GET /pack/community/profile/:orgId/media` — ảnh/tệp gom từ các bài của `orgId` mà người xem được thấy; shape ở §5.1 | **Đã chốt (backend-lead)** |
| Điểm uy tín (cột ở mục Đối tác) | đọc qua port **có sẵn** `HostBookReader.read(who, { hints: [], partyKeys })` → `partners[{ partyKey, band, score }]` (`pack-ports.ts:94-104`, ADR-0031); user ngoài ⇒ không gọi port ⇒ cột vắng (HT-71/75/76) | **Đã chốt (backend-lead)** |

### 5.1 Shape chốt (backend-lead) — partners + media + điểm uy tín
Zod ở `packages/contracts/src/pack-community/viewer.ts` (dùng lại `MediaItemSchema` của `post.ts`); endpoint ở `org.routes.ts` (cạnh `GET /profile/:orgId`, qua `profileTarget()` để áp HT-72/73/74); điểm uy tín qua port **có sẵn** (không thêm port mới).

**(3a) `GET /pack/community/profile/:orgId/partners`** — bạn bè của `orgId`, không phân trang (giới hạn theo thư mục đối tác đã nạp `a.dir.orgs`; server cắt tối đa 500).
```ts
export const ProfilePartnerSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  labels: z.array(z.enum(PARTNER_LABELS)),
  area: z.string().optional(),
  left: z.boolean().optional(),                 // chủ quản: đối tác đã rời
  /** Cột "Điểm uy tín" — CHỈ chủ quản đủ quyền đọc contracts; đối tác/không quyền ⇒ vắng (I3, HT-71). */
  rep: z.strictObject({
    band: z.enum(["good", "fair", "watch", "new"]).nullable(),
    score: z.number().nullable(),
  }).optional(),
});
export const ProfilePartnersSchema = z.strictObject({ items: z.array(ProfilePartnerSchema) });
```
- **Bạn bè của `orgId`:** `orgId` = chủ quản ⇒ mọi công ty đối tác đang hoạt động; `orgId` = một đối tác ⇒ chỉ gồm chủ quản (đồ thị sao host↔đối tác). Dựng từ `a.dir.orgs`.
- **Quyền + cách ly (HT-70–75):** người xem đối tác (`kind=external`) chỉ xem hồ sơ của chính mình hoặc chủ quản (`profileTarget()` 404 nếu khác); với cả hai ⇒ `items = []` cho mục bạn bè (HT-71: đối tác không thấy danh sách bạn bè của chủ quản) và **không có** `rep`. Mặc định chốt (P3 §10): **ẩn danh sách bạn bè với đối tác**. Chủ quản ⇒ danh sách đầy đủ.
- **`rep` (điểm uy tín):** chỉ thêm khi `isHost(viewer)` **và** `caps.contracts !== "none"`. Gọi **một lần** `HostBookReader.read(who, { hints: [], partyKeys: <partyKey các đối tác có liên kết SHT> })`; ánh xạ `partner.partyKey → { band, score }`. Đối tác không có `partyKey` ⇒ `rep.band=null, score=null`. Không vòng theo từng đối tác (Luật 4c — số câu cố định do port đã gom).

**(3b) `GET /pack/community/profile/:orgId/media`** — ảnh/tệp gom từ các bài của `orgId` mà người xem được phép thấy; phân trang con trỏ (nhiều bài).
```ts
export const ProfileMediaItemSchema = MediaItemSchema.extend({  // { id, kind: "image"|"video", label, url? }
  postId: z.string(),
  postedAt: z.string(),   // ISO
});
export const ProfileMediaSchema = z.strictObject({
  items: z.array(ProfileMediaItemSchema),     // server cắt ≤ 48 mỗi trang
  nextCursor: z.string().nullable(),           // null = hết
});
```
- Query `?cursor=<opaque>` tuỳ chọn; mặc định trang đầu 48 phần tử, sắp theo `postedAt` giảm dần.
- **Quyền + cách ly (D2–D4, HT-64/68):** chỉ gồm media của bài người xem được thấy — cùng bộ lọc với `FeedList fixed=authorOrgId` (chủ quản thấy bài đối tác theo D2; đối tác chỉ thấy bài của chính mình). URL media đi qua che liên hệ D4; **không** kèm `savedQuote`/gợi ý/điểm uy tín (HT-64/68). Bấm phần tử ⇒ mở bài `postId`.

## 6. Quyền & cách ly
Mục `about`/`posts`/`partners`/`files` theo RLS community (D2–D4). Cột uy tín: `isHostViewer` **và** quyền đọc gói contracts. HT-75 (hồ sơ S1: thấy, không có SHT) phải giữ; thêm: đối tác xem hồ sơ của mình không có mục/cột SHT.

## 7. Nhãn VI / EN (đề xuất dịch, chờ duyệt)
| VI (verbatim nếu có nguồn) | EN đề xuất |
|---|---|
| Giới thiệu · Bài đăng · Đối tác · Ảnh & tệp (mock ghi "Attachment"; chốt VI "Ảnh & tệp", P0 D14) | About · Posts · Partners · Photos & files |
| Bài đang đăng · Đã lưu trữ · Bình luận nhận được · Bạn bè | Active posts · Archived · Comments received · Friends |
| Nhà cung cấp · Người mua | Supplier · Buyer |
| đối tác đã rời | partner has left |
| Admin · Thành viên · Đối tác (vai) | Admin · Member · Partner |
| Điểm uy tín (cột) | Reputation score |
| Chưa có bài đăng. · Chưa có đối tác. · Chưa có ảnh hay tệp. | No posts yet. · No partners yet. · No photos or files yet. |

## 8. Tiêu chí chấp nhận
| AC | FR | Nội dung |
|---|---|---|
| P3-AC01 | 35 | Hồ sơ hiện cover, logo lớn, tên, dòng phụ, 3 chỉ số (+ Bạn bè khi có); "đối tác đã rời" hiện tag. |
| P3-AC02 | 36 | Chủ quản và đối tác đều thấy 4 tab; đối tác không có mục/chữ nào về SHT. |
| P3-AC03 | 36 | Thêm section mới = thêm một phần tử khai báo + component (unit: `canView=false` ⇒ không render tab lẫn nội dung). |
| P3-AC04 | 36 | `#/profile/<id>/files` mở đúng mục; section lạ về "Bài đăng". |
| P3-AC05 | 37 | Mục Đối tác liệt kê công ty bạn bè; cột "Điểm uy tín" chỉ chủ quản đủ quyền contracts, đối tác DOM không có cột. |
| P3-AC06 | 37 | Attachment chỉ gồm media của bài người xem được thấy; không lộ media bài "Chỉ chủ quản" cho đối tác. |
| P3-AC07 | 37 | Composer chỉ hiện ở hồ sơ của mình. |

## 9. Mã truy vết
COM-FR-35 Hero + số liệu · COM-FR-36 Mô hình section + tab · COM-FR-37 Nội dung 4 mục.

## 10. Việc còn mở
Đã chốt: màu cover (P0 D5), endpoint partners/media + shape mặc định (D6), cột uy tín qua port có sẵn (D7), nhãn "Ảnh & tệp" và nhãn rỗng (D14), mô tả chỉ đọc (D17). **Backend-lead đã chốt (§5.1):** (1) shape `ProfilePartnersSchema` + `ProfileMediaSchema`; (2) điểm uy tín qua port **có sẵn** `HostBookReader.read` (không thêm port mới); (3) đối tác xem hồ sơ chủ quản ⇒ **ẩn danh sách bạn bè** (`items=[]`, HT-71).
