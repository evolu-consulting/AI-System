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
<!-- agent điền; chốt hien-thi Chưa rõ #2 -->

## Delta (so với docs/current)
Gộp vào `current/community/nghiep-vu.md` §6 cuối đợt.
