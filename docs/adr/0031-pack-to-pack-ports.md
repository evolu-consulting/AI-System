# ADR-0031 · Cổng gói↔gói: gói khai port, `packs.mount.ts` tiêm usecase gói kia

Trạng thái: **Accepted** (người dùng, 2026-10-28, CR-102; Intake M5 `docs/intake/community/2026-10-28-intake.md`). Liên quan: `docs/platform/pack-boundary.md`, ADR-0023 (clean architecture), ADR-0030, `docs/current/community/nghiep-vu.md` §8–9.

## Bối cảnh
Gói `community` phải (a) **ghi** một giá vào SP & Giá của gói `contracts` qua đúng flow "Lưu báo giá" (`suppliersUsecase.save`, nguồn `quote`, tạo SP/đối tác MỚI) và (b) **đọc** hàng đang giữ, giá vốn bình quân, giá đã ghi nhận, điểm uy tín (chỉ chủ quản). `pack-boundary.md` cấm gói import gói khác (`pack-no-cross-pack`) để mỗi gói tách được thành service riêng. Cần cổng không phá luật đó, không nhân đôi nghiệp vụ SHT (D5: chỉ một cổng ghi).

## Lựa chọn
| Phương án | Được | Mất |
|---|---|---|
| A. community import contracts | Ít code | Phá `pack-no-cross-pack`; không tách service được |
| B. community ghi thẳng bảng `contracts.*` | Không cần port | Hai gói chung schema/RLS, nhân đôi luật giá (VAT, thay giá, MỚI); check:pack-sql đỏ |
| **C. Port do gói cần khai; `packs.mount.ts` tiêm usecase gói cung cấp** | Giữ depcruise cấm import; một luật giá ở contracts; thay được bằng HTTP/RPC khi tách service | Thêm adapter ở mount; mỗi port phải bảo trì hợp đồng kiểu |
| D. Qua HTTP nội bộ giữa gói | Tách sẵn | Chậm, thêm hạ tầng/auth nội bộ không cần ở GĐ1 |

## Quyết định
Chọn **C**.
1. Gói cần khai port trong `application/*.ports.ts` của chính nó, kiểu thuần tự khai (DTO riêng, không import kiểu gói kia): `SupplierQuoteWriter` (community khai; contracts cung cấp, lát C7), `HostBookReader` (lát C8).
2. `packs.mount.ts` là chỗ **duy nhất** thấy cả hai gói: dựng usecase contracts, bọc adapter thoả port, tiêm vào community. Platform được import `packs/<gói>/**` ở đây như hiện nay (`platform-no-pack-internals` đã miễn `packs.mount.ts`).
3. depcruise: giữ `pack-no-cross-pack`; thêm luật "chỉ `packs.mount.ts` import hai gói"; không ngoại lệ trong code gói.
4. Cung cấp: usecase gói kia chạy trong **transaction và GUC của người gọi** (cùng `PackUow`/`withPackScope`), tự kiểm quyền (người gọi `kind=internal`, có quyền ghi giá); port không bao giờ nhận user ngoài. Một int mỗi port chặn `kind=external`.
5. Port ghi chỉ có **một** (Lưu báo giá); thêm port ghi khác cần ADR/CR mới. Port đọc chỉ trả dữ liệu chủ quản được thấy.
6. Mở rộng cho cặp gói khác theo cùng mẫu, mỗi port ghi trong bảng port ở `pack-boundary.md` khi có code.

## Hệ quả
- Cột mới ở `product_supplier_prices` (CR-102b, contracts 0066) nằm trong gói contracts; community không biết cột, chỉ biết DTO port.
- Test: unit cho adapter mount; int chặn user ngoài mỗi port; không test lặp luật giá ở community (đã ở contracts).
- Rủi ro: lệch hợp đồng kiểu giữa hai gói ⇒ kiểm ở typecheck của `packs.mount.ts`; rủi ro rò dữ liệu ghi vào gói kia ⇒ làn đầy đủ cho C7 (Opus, security review).
