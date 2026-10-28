# com-c8-host-read — Gợi ý từ SHT dưới bài, chỉ chủ quản (D5)

Đọc: `docs/current/community/nghiep-vu.md` §9; `hien-thi.md` HT-67, HT-68; ADR-0031.
| Lát | Làn | Model | Migration | Phụ thuộc |
|---|---|---|---|---|
| C8 | Nhanh (+1 int chặn external) | Sonnet | — | C3 |

## Phạm vi
Cổng `HostBookReader` (community khai, contracts cung cấp, tiêm ở `packs.mount.ts`): đọc theo tập (một lô, số câu SQL cố định) hàng đang giữ, giá vốn bình quân, giá đã ghi nhận (bỏ hết hạn/gỡ/đã thay), điểm uy tín theo đối tác/SP. Gợi ý dưới bài trong community-web (chỉ chủ quản); Cần mua khớp sản phẩm đang có (nguồn cho thông báo C9). Chỉ đọc; không ghi SHT.

## Xong khi
Unit adapter; một int đường chính; **một int chặn `kind=external`** (JSON không có trường gợi ý, port không tới được). Không e2e chạy.

## Quyết định trong lúc làm
<!-- agent điền -->

## Delta (so với docs/current)
Gộp vào `current/community/nghiep-vu.md` §9 cuối đợt.
