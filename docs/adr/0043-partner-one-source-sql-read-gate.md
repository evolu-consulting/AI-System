# ADR-0043 · Một nguồn đối tác ở gói contracts; cổng đọc SQL cho RLS Bảng tin — Accepted (2026-11-12, CR-130 pha 2; áp mặc định đề xuất theo Luật 2b)

Bổ sung ADR-0031 (cổng gói↔gói). Liên quan: `docs/specs/CR-130/design.md` §1–2, `docs/platform/pack-boundary.md`, contracts 0103.

## Bối cảnh
Đối tác đang có hai nguồn: SHT (`contracts.partner_roles`: vai NCC/khách; khoá `party_key`) và Bảng tin (`community.partner_companies`: nhãn `supplier|buyer`, nhóm hàng, khu vực, liên kết `party_key` tuỳ chọn). Luật GỐC 1 cấm hai nguồn. RLS của Bảng tin cần nhãn/nhóm hàng/tên của **người xem là đối tác** ngay trong SQL (`audience_ok`, join tác giả). ADR-0031 §4 chỉ cho port TS chạy với người nội bộ; user ngoài không tới được port, và việc nền cũng phải đọc được.

## Lựa chọn
| | Được | Mất |
|---|---|---|
| A. Giữ hai bảng, đồng bộ bằng code | Không đổi schema | Vi phạm Luật GỐC 1; lệch dữ liệu |
| B. Port TS (ADR-0031) + GUC nhãn đặt lúc vào request | Không có SQL gói-chéo | Hai nguồn trong một request; việc nền tự nạp; policy RLS không tự đủ |
| C. Đưa bảng đối tác lên lõi (`admin`/`packs`) | Mọi gói đọc được | Lõi chứa nghiệp vụ SHT (vai, nhóm hàng) |
| **D. Bảng hồ sơ ở contracts + MỘT hàm SQL đọc `SECURITY DEFINER` cho community** | Một nguồn; một câu SQL/lô; RLS gọi được; contracts vẫn là chủ dữ liệu | Thêm một ngoại lệ có kiểm soát trong `check:pack-sql` |

## Quyết định
Chọn **D**.
1. `contracts.partner_profiles` (0103): khoá `(tenant_id, party_key)`; `cats`, `area`, `ext_org_id` (UNIQUE theo tenant, không FK sang `admin`), `invited_at`. Vai vẫn ở `partner_roles` (`supplier`/`customer`; `buyer` ⇒ `customer`). RLS: đọc nội bộ theo luật thấy M1, đối tác chỉ hàng công ty mình; ghi chỉ quản trị gói/việc nền.
2. `contracts.community_partners(p_orgs uuid[]) → (ext_org_id, party_key, name, roles, cats, area)` — `SECURITY DEFINER`, `STABLE`, tenant **chỉ từ GUC `app.tenant_id`** (không từ tham số) + lọc tường minh `tenant_id`; chỉ hàng `ext_org_id = ANY(p_orgs)`; người xem là đối tác (`packs.viewer_ext_org()` ≠ NULL) chỉ nhận hàng của chính mình; thiếu GUC ⇒ 0 hàng. `REVOKE … FROM PUBLIC`; EXECUTE cho `contracts_rw` và `community_rw` (+ USAGE schema `contracts`, **không** quyền bảng).
3. `check:pack-sql`: `contracts`/`community`/`dlc` vào danh sách schema ngoài; danh sách `ALLOWED_CROSS_PACK_FNS` chỉ có `contracts.community_partners`. Bảng/view/hàm khác của gói khác vẫn cấm; thêm mục mới cần ADR/CR.
4. Cổng ghi giữ theo ADR-0031 (port TS, người nội bộ, int chặn `kind=external`): `PartnerLinker` (L2). Cài đặt (L2): hàm `contracts.community_link_partner(p_org, p_name, p_roles, p_party_key)` (contracts 0104 → sửa ở 0105 sau soát, `SECURITY DEFINER`, tenant từ GUC, viewer đối tác ⇒ 42501; `p_org` phải thuộc tenant ⇒ ORG_NOT_IN_TENANT; KHÔNG tự khớp đối tác theo tên — tên do công ty ngoài gõ ⇒ mạo danh: `p_party_key` do Admin chọn tường minh khi duyệt (đã gắn tài khoản khác ⇒ PARTNER_ALREADY_LINKED, không có ⇒ PARTNER_NOT_FOUND), NULL ⇒ luôn tạo đối tác mới; bỏ EXECUTE của `contracts_rw`) chạy TRONG tx duyệt của community — KHÔNG dùng `withPackRoleInTx` lồng (role `community_rw` không có EXECUTE `packs.scope_*` nên không đổi role được từ trong tx community). Vào `ALLOWED_CROSS_PACK_FNS` cùng `community_partners`; community 0012/0013 cấp EXECUTE (0012 là bản 3 tham số, nay là vỏ tương thích).
5. Không backfill (chưa có khách dùng thật); `community.partner_companies` gỡ ở L2 cùng việc chuyển mọi chỗ đọc (D6).
- Perf: một lệnh gọi hàm mỗi câu RLS/feed (`(SELECT …)`/mảng org gom một lần), tra qua UNIQUE `(tenant_id, ext_org_id)`; không gọi từng hàng.
- Bảo mật: DEFINER chạy bằng quyền chủ migration (bỏ RLS) ⇒ cách ly nằm ở thân hàm (GUC + lọc tenant + lọc người xem); int bắt buộc: chéo tenant (bảng + hàm), đối tác chỉ thấy hàng mình.
- `community_rw` do community 0001 tạo SAU contracts trên DB mới ⇒ contracts 0103 chỉ cấp khi role đã có; community 0011 (L2) cấp lại (idempotent).
- Rủi ro: hàm đổi chữ ký ⇒ phá RLS community ⇒ đổi qua migration có int; tách service riêng sau này ⇒ thay bằng bảng sao đọc/RPC (ADR mới).
- Chủ ý (soát L1): người nội bộ của chủ quản gọi `community_partners` thấy MỌI hồ sơ đối tác đã gắn tài khoản trong tenant mình (Bảng tin: chủ quản thấy mọi bạn bè), không áp M1 phòng ban của SHT; chỉ đối tác bị thu hẹp về công ty mình. Khoá bằng int.
