# com-c4-masking — Dò và che liên hệ lúc ghi (D4)

Đọc: `docs/current/community/nghiep-vu.md` §7; `hien-thi.md` mục 4 (HT-51…55).
| Lát | Làn | Model | Migration | Phụ thuộc |
|---|---|---|---|---|
| C4 | **Đầy đủ** (lộ danh tính = rủi ro lõi; security review riêng) | Opus | community **0002** | C3 |

## Phạm vi
Dò SĐT (VN: 0xx, +84, có dấu cách/chấm), email, link Zalo/Facebook, website, MST (10/13 số), tên công ty khác (so danh sách `external_orgs`/đối tác, trừ chính công ty người viết). Ghi **raw + masked** lúc ghi (`posts`, `comments`); đường đọc của user ngoài chỉ select cột masked (không có raw trong JSON/SQL); chủ quản đọc raw. Nhắc người đăng (cờ `contactDetected` ở phản hồi ghi, không chặn). Dò theo tập (thuần, không gọi mạng). Không làm kiểm ảnh (C11).

## Xong khi
Unit: bảng mẫu dò/che (đa dạng định dạng, false-positive cơ bản như số lượng/giá không bị che). Int: HT-51…55 (một int tham số). Không e2e.

## Quyết định trong lúc làm
<!-- agent điền; chốt Chưa rõ nghiep-vu #4 (nguồn danh sách tên công ty) -->

## Delta (so với docs/current)
Gộp vào `current/community/nghiep-vu.md` §7 cuối đợt.
