# com-c7-save-quote — Lưu báo giá vào SP & Giá (CR-102b, ADR-0031)

Đọc: `docs/current/community/nghiep-vu.md` §8; `hien-thi.md` mục 5 (HT-60…68); ADR-0031; `suppliersUsecase.save` (`apps/hub-api/src/modules/packs/contracts/application/supplier-prices.usecase.ts`); migration `pack-contracts` 0031; `docs/current/sht` (SP & Giá).
| Lát | Làn | Model | Migration | Phụ thuộc |
|---|---|---|---|---|
| C7 | **Đầy đủ** (tiền/giá; security review riêng; phần UI form tách làn nhanh trong lát nếu cần) | Opus | contracts **0066** (không dùng lại khe 0058) | C3 |

## Phạm vi
Contracts 0066: cộng cột `vat_included`, `expires_on`, `replaced_at`, `removed_at`, `origin_ref` (id bài + mặt hàng) ở `product_supplier_prices`; gỡ mềm; giá mới cùng NCC + SP nguồn Báo giá ⇒ thay (cũ `replaced_at`, vào lịch sử); so sánh/chatbot bỏ giá hết hạn/gỡ/đã thay; màn SHT chỉ thêm nhãn "Đã hết hạn"/"Đã thay". Cổng `SupplierQuoteWriter` (community khai, contracts cung cấp, `packs.mount.ts` tiêm) gọi chung với tạo SP mới + tạo đối tác NCC MỚI. Form trong community-web: điền sẵn từ bài, gợi ý SP khớp (tìm chữ), "Tạo SP mới", so giá bằng/rẻ/đắt/giá đầu tiên, cảnh báo lệch > 30% và khác VAT, loại Mua mới/Gia hạn, nhiều mặt hàng ("Lưu thêm báo giá"), "đã lưu bởi … lúc …" lưu đè được, nút trên bình luận NCC, báo chủ quản khi NCC sửa giá (gọi sự kiện cho C9). **Không** lộ trạng thái lưu cho user ngoài (HT-64). Không đổi kho/giá vốn/điểm.

## Xong khi
Test phần giá **viết trước code** (làn đầy đủ): unit luật thay/hết hạn/30%/VAT; int đường chính cổng; một int chặn `kind=external` ở cổng; một test chặn đọc chéo tenant cho cột/bảng mới; HT-64 (JSON giống hệt trước/sau lưu). Chạy int của contracts supplier-prices bị chạm. Migration `when` journal giao trước.

## Quyết định trong lúc làm
<!-- agent điền; chốt nghiep-vu Chưa rõ #1 -->

## Delta (so với docs/current)
Gộp vào `current/community/nghiep-vu.md` §8 và `current/sht` (mục SP & Giá) cuối đợt.
