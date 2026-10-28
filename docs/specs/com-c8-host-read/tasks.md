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
- **Làn nhanh, một agent.** Port + usecase + repo ở **gói contracts** (`application/host-book.{ports,usecase}.ts`, `adapters/host-book.repo.ts`, `domain/host-book.rules.ts`, `host-book.mount.ts::hostBookModule`). **Chưa nối Community / chưa sửa `packs.mount.ts`**; community khai lại cùng hình dạng DTO ở `application/*.ports.ts` của nó khi nối (không import kiểu contracts).
- **Khớp tên không AI:** `pickMatch` thuần — id thắng; tên: khoá `foldVi` (≡ `contracts.fold` = `name_key`) khớp đúng, rồi tiền tố (ngắn nhất thắng). SQL chỉ lấy ≤ 5 ứng viên mỗi gợi ý (lateral qua index `(tenant_id,name_key)`); TS chọn.
- **Số câu SQL cố định = 2** trong một tx của người gọi (ứng viên; kho/giá vốn/giá ghi nhận) + uy tín qua `supplierScores` (engine hiện hành, theo tập, không theo cỡ lô; bỏ qua nếu không có `partyKeys`). Lô ≤ 50 (`too_many`), `productId` phải là uuid (`invalid`).
- **Kho / giá vốn:** của THÀNH PHẦN CHÍNH (ord nhỏ nhất `mode <> 'none'`, như tab NCC & giá); SP không theo dõi kho ⇒ `onHand/avgCost = null`. Giá ghi nhận: 10 dòng mới nhất mỗi SP từ `product_supplier_prices` — CHỈ cột sẵn có (supplier, price, unit, source, seen_on); **lọc hết hạn/gỡ/đã thay chưa làm — chờ cột C7a (0066)**, thêm điều kiện vào `host-book.repo.ts` khi cột có.
- **Chỉ chủ quản:** `HostCaller = PackWho & { kind?: "internal"|"external" }` — C1 chưa thêm `kind` vào `PackWho` nên khai tạm ở port; `external` ⇒ `HostBookError("forbidden")`, `kind` vắng ⇒ coi nội bộ (token người dùng). Thêm: phải có việc `read` của gói contracts (`packActionsFor`), kiểm TRƯỚC khi mở tx. Khi C1 xong: đổi `HostCaller` thành `PackWho`.
- **Band uy tín:** `good|fair|watch|new`; khoá không có điểm ⇒ `band: null`.
- Test: unit `domain/host-book.rules.test.ts`; int `adapters/host-book.int.test.ts` (đường chính, chặn external/không quyền/>50/id sai, đếm câu SQL lô 1 vs 50).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-28 (đợt Community)
Gộp vào `current/community/nghiep-vu.md` §9 cuối đợt.

- Cổng `HostBookReader` (contracts cung cấp): lô ≤ 50 gợi ý (id/tên) ⇒ SP khớp (đúng→tiền tố) + tồn + BQ + giá ghi nhận + band uy tín; chỉ `kind=internal` có quyền đọc gói. Nối ở `packs.mount.ts` ở lát C-wire.

