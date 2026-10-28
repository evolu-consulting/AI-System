# com-c6-threads-ui — Luồng bình luận riêng bài × đối tác (D3)

Đọc: `docs/current/community/nghiep-vu.md` §6; `hien-thi.md` mục 3 (HT-40…50).
| Lát | Làn | Model | Migration | Phụ thuộc |
|---|---|---|---|---|
| C6 | Nhanh | Sonnet | — | C3, C4 |

## Phạm vi
UI + API mỏng phía `community-web` cho luồng riêng: chủ quản thấy danh sách luồng theo công ty trên bài; đối tác thấy một luồng của công ty mình (mọi nhân viên cùng luồng); viết/sửa/xoá bình luận của mình; chủ quản ẩn bình luận; hiện bản masked cho đối tác (C4). RLS đã ở C3 — lát này không đổi RLS. Nút Lưu báo giá trên bình luận NCC do C7 gắn.

## Xong khi
Unit logic thuần; một int mỗi endpoint mới (đường chính); e2e viết không chạy.

## Quyết định trong lúc làm
- Route mới (pack community): `PATCH|DELETE /posts/:id/comments/:cid` (chỉ người viết, RLS + `author_user_id`), `POST .../:cid/hide {hidden}` (chủ quản, chỉ bài chủ quản; bài đối tác ⇒ 404). Trả `Thread`. Không đổi RLS/migration; chỉ cập nhật text/hits/hidden nên qua trigger `comments_fixed` của C3.
- HT-46 chốt: bình luận ẩn không dấu vết với đối tác (RLS C3), chủ quản thấy `hidden`. Sửa không có cờ "đã sửa" (bảng comments không có cột).
- "Nhắn riêng": UI liệt kê công ty trong audience chưa có luồng (`lib/thread.ts`); server chặn công ty ngoài audience (C3 `orgMaySee` ⇒ 404).
- Móc thông báo: `adapters/comment-notify.hook.ts` (stub no-op, gọi sau thêm/sửa/xoá/ẩn) — C9 thay thân.
- UI: `CommentItem` có prop `action` (ReactNode) cho nút Lưu báo giá của C7b.
- e2e: chưa viết (không chạy trong lát).

## Delta (so với docs/current)
Gộp vào `current/community/nghiep-vu.md` §6 cuối đợt.
