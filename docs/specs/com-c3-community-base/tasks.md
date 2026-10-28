# com-c3-community-base — Gói community: bảng, RLS, GUC (CR-102)

Đọc: `docs/current/community/nghiep-vu.md` §3–6; `hien-thi.md` (toàn bộ, mục 1–3, 6); `docs/platform/pack-boundary.md`; mẫu gói `contracts` (`packs.install`, `withPackScope`).
| Lát | Làn | Model | Migration | Phụ thuộc |
|---|---|---|---|---|
| C3 | **Đầy đủ** (RLS/tenant; security review riêng) | Opus | kit **0006**, community **0001** | C1 |

## Phạm vi
`packs.install('community')` + `EXTERNAL_PACKS`. Bảng (schema `community`): `partner_companies` (ext_org_id, nhãn `supplier|buyer|both`, nhóm hàng, `party_key` liên kết đối tác SHT), `posts` (loại, trạng thái active/archived/done/hidden/deleted, hạn 30 ngày, edited), `post_items` (nhiều mặt hàng), `audience` (D2: all/supplier/buyer/nhóm hàng/công ty; trần = bạn bè), `threads` (bài × `ext_org_id`, D3), `comments`, `media`. Kit 0006: GUC `app.ext_org_id` trong `withPackScope` (+ `kind`). RLS: chủ quản thấy hết; đối tác theo audience/bài của mình/luồng của công ty mình. API cơ bản (CRUD bài, luồng) đủ để int chạy; UI ở C5/C6. Che liên hệ ở C4 (cột raw+masked chừa sẵn ở C4, không làm ở đây).

## Xong khi
Unit: tính audience (D2) thuần. Int: **một int RLS tham số theo từng dòng HT-01…HT-49, HT-70…HT-76 của `hien-thi.md`** (người xem × nội dung × kết quả) + một test chặn đọc chéo tenant mỗi bảng mới. Không e2e.

## Quyết định trong lúc làm
- **Người xem trong RLS = `packs.viewer_ext_org()`** (kit 0006, SECURITY DEFINER): NULL = chủ quản/việc nền, uuid = công ty đối tác, nil = bị từ chối (user lạ / vô hiệu / công ty rời ⇒ fail-closed, có hiệu lực ngay câu kế — HT-12/32/85). Sau merge C2: `withPackScope` đặt `app.ext_org_id` (qua `packs.scope_ext_org`, đọc DB) trong CÙNG câu với `app.user_kind`; hàm đọc GUC, vắng GUC (test-kit) thì tra DB. `check-pack-sql` cho phép `packs.viewer_ext_org`.
- **Audience động, không bảng `audience` riêng:** cột `aud_mode/aud_cats/aud_orgs` trên `posts`, luật D2 trong hàm SQL `community.audience_ok` (trùng `domain/audience.rules.ts`) ⇒ đổi nhãn/nhóm hàng của đối tác có hiệu lực ngay, không "đóng băng" người nhận lúc đăng.
- Chưa rõ hien-thi #1 (HT-30): đối tác **thấy** bài mình bị ẩn, JSON không có `hidden`. #2 (HT-46): bình luận ẩn **không** thấy. nghiep-vu Chưa rõ #2: Thông báo + "chỉ NCC" hợp lệ. #4 (C4): tên công ty khác = mọi `admin.external_orgs` của tenant trừ công ty người viết.
- Che liên hệ (C4) làm luôn ở đây lúc ghi: `title/body/fields` raw + masked + `hits` (offset trên NFKC); đối tác đọc chỉ cột masked (cả người đăng — HT-52); người đăng lấy raw để sửa qua `GET /posts/:id/source` (chỉ chính user đăng). Nhắc HT-54 = header `X-Contact-Detected: 1` (PostView strict, không thêm trường).
- Contract đổi tối thiểu: `GET /viewer` thay `/me` (kit `/pack/:k/me` đã chiếm); thêm `PostSourceSchema`, `PartnerUpdateInputSchema` + `PartnerOrg.partyKey` (chủ quản); client + mock + http cập nhật.
- Quyền: nội bộ theo Group như mọi gói; Admin chủ quản (HT-82) = `tenant_admin` hoặc Group `community-admin`; đối tác read+write, không admin (C2 `EXTERNAL_PACKS`).
- Xoá bài = xoá cứng (cascade luồng/bình luận/mặt hàng/media); bỏ lưu trữ gia hạn 30 ngày. Hết hạn = trạng thái tính (`expired`), không job.
- Phiên community-web: sau C2 đối tác chỉ được cấp mã SSO cho app `community` ⇒ community-web dùng **app riêng `community`** (cookie `ai_rt_community`, `WEB_APPS` + hàng `admin.app_catalog` trong kit 0006 + `APP_URL_COMMUNITY`), đăng nhập chung qua AI System (sso-switch như contracts-web). Dev mặc định mock, build mặc định http (`PUBLIC_COMMUNITY_API`).
- T-DEP-1: route → `*.service.ts` → repo; fixture test ở `tests/acceptance/com-c3/_support/cast.ts` (qc ghi lock).

## Sửa sau security review (community 0002, kit 0007)
- TB1: raw/hits/audience chọn trong SQL theo `packs.viewer_ext_org()` (không theo token); `accessOf` từ chối khi kind/công ty trên token ≠ DB (danh bạ kit trả thêm `user`).
- TB2: url media chỉ `http(s)://` (service 400 + CHECK `media_url_scheme_ck`); nhãn media của đối tác che như nội dung.
- TB3: `comments_insert/update` đòi luồng khớp (thread_id ↔ post_id ↔ thread_org); trigger `comments_fixed` cấm đổi bài/luồng/tác giả. Bình luận ghi thành 2 câu (luồng rồi bình luận) vì policy không thấy luồng tạo trong cùng câu.
- Thấp1: chủ quản mở luồng chỉ cho công ty trong audience (bài chủ quản) hoặc chính bên đăng (bài đối tác). Thấp2: bài đối tác chỉ người đăng sửa (đồng nghiệp: không `edit`, PATCH 404). Thấp3: ghi `partner_companies` ở DB đòi `packs.viewer_is_admin('community')` (kit 0007).
- Thấp4 (ghi nhận): `packs.scope_ext_org(tenant, user)` cấp EXECUTE cho `hub_api` = tra được kind/công ty của user bất kỳ — chấp nhận vì `hub_api` là role máy chủ tin cậy (đã đọc `admin.users`); role gói không có quyền này.

## Việc còn lại
- Seed demo (bật gói community + công ty đối tác trên tenant `demo`); route ẩn/xoá bình luận (C6); thông báo (C9); Lưu báo giá (C7b), gợi ý SHT (C8); tải media (Filebox).
- qc: ghi lock cho `tests/acceptance/com-c3/_support/cast.ts`. `check:fn` còn báo hàm dài ở test + `mock.ts` (C5, có sẵn).

## Delta (so với docs/current)
Gộp vào `current/community/nghiep-vu.md` §3–6 và `hien-thi.md` cuối đợt:
- hien-thi HT-01…50, HT-70…73 có int RLS (`visibility.rls.int.test.ts`); Chưa rõ #1/#2 chốt như trên.
- nghiep-vu §5: audience tính động lúc đọc (đổi nhãn ⇒ đổi người xem ngay). §7: cả trường form (giá, SL…) của đối tác cũng được che.
- §2/§13: đối tác vào community-web bằng SSO app `community` (không dùng phiên Sổ Hợp Tác).
