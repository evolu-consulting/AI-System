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
<!-- agent điền; chốt Chưa rõ hien-thi #1, #2 theo mặc định đề xuất -->

## Delta (so với docs/current)
Gộp vào `current/community/nghiep-vu.md` §3–6 và `hien-thi.md` cuối đợt.
