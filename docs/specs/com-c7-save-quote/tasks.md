# com-c7-save-quote — Lưu báo giá vào SP & Giá (CR-102b, ADR-0031)

Đọc: `docs/current/community/nghiep-vu.md` §8; `hien-thi.md` mục 5 (HT-60…68); ADR-0031; `suppliersUsecase.save` (`apps/hub-api/src/modules/packs/contracts/application/supplier-prices.usecase.ts`); migration `pack-contracts` 0031; `docs/current/sht` (SP & Giá).
| Lát | Làn | Model | Migration | Phụ thuộc |
|---|---|---|---|---|
| C7 | **Đầy đủ** (tiền/giá; security review riêng; phần UI form tách làn nhanh trong lát nếu cần) | Opus | contracts **0066** (không dùng lại khe 0058) | C3 |

## Phạm vi
Contracts 0066: cộng cột `vat_included`, `expires_on`, `replaced_at`, `removed_at`, `origin_ref` (id bài + mặt hàng) ở `product_supplier_prices`; gỡ mềm; giá mới cùng NCC + SP nguồn Báo giá ⇒ thay (cũ `replaced_at`, vào lịch sử); so sánh/chatbot bỏ giá hết hạn/gỡ/đã thay; màn SHT chỉ thêm nhãn "Đã hết hạn"/"Đã thay". Cổng `SupplierQuoteWriter` (community khai, contracts cung cấp, `packs.mount.ts` tiêm) gọi chung với tạo SP mới + tạo đối tác NCC MỚI. Form trong community-web: điền sẵn từ bài, gợi ý SP khớp (tìm chữ), "Tạo SP mới", so giá bằng/rẻ/đắt/giá đầu tiên, cảnh báo lệch > 30% và khác VAT, loại Mua mới/Gia hạn, nhiều mặt hàng ("Lưu thêm báo giá"), "đã lưu bởi … lúc …" lưu đè được, nút trên bình luận NCC, báo chủ quản khi NCC sửa giá (gọi sự kiện cho C9). **Không** lộ trạng thái lưu cho user ngoài (HT-64). Không đổi kho/giá vốn/điểm.

## Xong khi
Test phần giá **viết trước code** (làn đầy đủ): unit luật thay/hết hạn/30%/VAT; int đường chính cổng; một int chặn `kind=external` ở cổng; một test chặn đọc chéo tenant cho cột/bảng mới; HT-64 (JSON giống hệt trước/sau lưu). Chạy int của contracts supplier-prices bị chạm. Migration `when` journal giao trước.

## Tiến độ
- [x] **C7a (phía contracts)** — nhánh `slice/com-c7a-save-quote`: migration 0066 (`when` 1800000000000, idx 62); luật thuần `domain/supplier-quote.rules.ts` (test viết trước); cổng `application/supplier-quote.ports.ts` + `save-quote.usecase.ts` + `adapters/supplier-quote.repo.ts`; gỡ mềm ở `supplier-prices.repo.ts::remove`; `buildOverview` tách `rows`/`history`; price-scout bỏ giá gỡ/thay/hết hạn; nhãn ở `ComparePanel` + `PriceHistory.tsx`. Test: `supplier-quote.rules.test.ts` (unit), `tests/acceptance/com-c7/save-quote.int.test.ts` (int).
- [ ] Chạy int `tests/acceptance/com-c7/save-quote.int.test.ts` + `V2-J2/suppliers.int.test.ts` (lúc làm C7a Postgres test kẹt "starting up" — chưa chạy được).
- [ ] C7b: nối `packs.mount.ts` (dựng `saveQuoteUsecase` với `canWrite` từ `PackAccessView`, tiêm vào community khi gói community có port tự khai); form community-web; HT-64; sự kiện C9.

## Quyết định trong lúc làm
- D1 Kiểu cổng `SupplierQuoteWriter` khai tạm ở contracts (`supplier-quote.ports.ts`) vì gói community chưa có trên nhánh này; community tự khai kiểu cùng hình (ADR-0031 §1), mount typecheck bắt lệch. Cổng có `preview` (không ghi) + `save`.
- D2 "Thay" (R22) = cùng SP + cùng khoá NCC + **cùng loại** (Mua mới ≠ Gia hạn) + nguồn `quote`, chưa thay/chưa gỡ; giá hết hạn của cùng NCC cũng bị thay. Giá nguồn market/manual không bị thay.
- D3 Đồng thời (R28): khoá tư vấn `pg_advisory_xact_lock` theo (tenant, SP, NCC, loại) trước khi đọc + thay ⇒ không còn hai giá Báo giá đang dùng. Không thêm unique index (dữ liệu cũ có thể trùng; nguồn quote cũ qua `/supplier-prices` vẫn cộng thêm như trước).
- D4 So giá (R18) = với giá **đã lưu** rẻ nhất còn hiệu lực cùng loại + cùng đơn vị (đơn vị null = đơn vị SP; so chữ fold). Chưa có ⇒ "giá đầu tiên". Lệch dùng % có dấu, cảnh báo khi |%| > 30 (đúng 30 không cảnh báo). Khác VAT chỉ cảnh báo khi giá so có `vat_included` rõ. Giá nhập kho/HĐ chưa đưa vào so (form chỉ cần giá đã ghi nhận ở bảng giá; thêm sau nếu cần).
- D5 NCC mới (R24): thêm vai `partner_roles` (`supplier`, `created_from='manual'`) trong CÙNG câu lưu, `on conflict do nothing`; điểm MỚI tự có (chưa có sự kiện). Không gọi `companies` (tra Cục Thuế gọi mạng, ngoài tx) — danh bạ thêm sau bằng nút "Thêm vào Đối tác" sẵn có.
- D6 SP mới: dùng lại `ProductsRepo.create` + `productPlan` trong cùng tx; trùng tên ⇒ `exists`.
- D7 Gỡ (R21): route DELETE cũ nay đặt `removed_at`; ai gỡ được giữ như policy DELETE 0031 (người tạo hoặc người thấy hết) bằng điều kiện tường minh. RLS: `GRANT UPDATE (replaced_at, removed_at)` + policy RESTRICTIVE UPDATE (thấy hết / người tạo / nguồn `quote` — để người sau thay giá Báo giá của người trước, R28). Các cột khác vẫn không sửa được.
- D8 Hiển thị SHT: `rows` = còn hiệu lực + hết hạn (nhãn "Đã hết hạn"); `history` (mới, tuỳ chọn) = đã thay/đã gỡ, hiện thu gọn dưới bảng ("Lịch sử giá"). Tóm tắt NCC, gợi ý, giá thấp nhất chỉ tính giá còn hiệu lực. Nhãn VAT theo `vat_included`.
- D9 Người gọi: `QuoteCaller.kind='external'` ⇒ `forbidden` trước mọi câu SQL; quyền ghi giá qua dep `canWrite` (mount tiêm). Kiểm thân trong usecase (cổng nội bộ, không qua zod route).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-28 (đợt Community)
Gộp vào `current/community/nghiep-vu.md` §8 và `current/sht` (mục SP & Giá) cuối đợt.
- SHT SP & Giá: giá đã lưu có VAT (gồm/chưa), hạn, nhãn "Đã hết hạn"; giá đã thay / đã gỡ chuyển xuống "Lịch sử giá" (nhãn "Đã thay"/"Đã gỡ"); nút Xoá trên dòng giá = gỡ mềm. So sánh/gợi ý/dò giá bỏ giá hết hạn/thay/gỡ.
- Community §8: R18 so với giá đã lưu rẻ nhất cùng loại + đơn vị (D4); R22 thay theo NCC + loại (D2); R24 vai NCC `manual` (D5).

## C7b + C8-wire (slice `com-c7b-save-quote-ui`)
- [x] Nối `packs.mount.ts` → `packs/community-wire.mount.ts` (`communityPorts`: `saveQuoteUsecase` + `hostBookModule`, ADR-0031; community khai kiểu ở `community/application/pack-ports.ts`, typecheck bắt lệch). Route `POST /posts/:id/quote/preview`, `POST /posts/:id/quote`, `GET /quote/match`; gợi ý `hostHint` + `quotes` ở feed (chỉ chủ quản). Migration community `0004_quote_saves` (`when` 1800400000000; 0002 review_fixes C3, 0003 notify C9). community-web: `QuoteForm`, hint box, banner "đã lưu", `Thread` prop `actions`.
- [ ] Chưa chạy e2e (Luật 0b); chưa có nút "Xem" (đích SHT chưa rõ); C9 đã nối: `savedBy` (quote_saves, cờ notify) + `stockMatch` (HostBookReader hỏi từng chủ quản, ≤ 50) ở `community.mount.ts`.
- Test: int `packs/community-wire.int.test.ts` (lưu từ bài, từ bình luận, 403 đối tác, JSON đối tác y hệt trước/sau lưu, một lời gọi đọc mỗi trang); unit `community/domain/quote.rules.test.ts`, `community-web/src/lib/quote.test.ts`.

### Quyết định
- D10 Dấu "đã lưu" = bảng `community.quote_saves` (RLS RESTRICTIVE chỉ `viewer_ext_org() IS NULL`) + JSON chỉ thêm khi SQL nói là chủ quản (`quotes`, `party_key` dùng cùng check như C3). Đối tác không bao giờ ghi/đọc.
- D11 "Bài sửa sau khi lưu" / "NCC sửa giá": cột `posts.edited_at`, `posts.price_edited_at` (bên đăng ghi dưới RLS của mình); chủ quản so với `quote_saves.saved_at`. C9: gửi chuông khi `price_edited_at` đổi và có `quote_saves.notify_price_edit` (đọc bằng việc nền/chủ quản).
- D12 NCC do server suy từ nguồn (công ty đăng bài / công ty luồng + `party_key` đã liên kết), không tin client. Nguồn hợp lệ: Cần bán của đối tác; bình luận đối tác trên Cần mua của chủ quản (khác ⇒ 422).
- D13 Lưu đè (R28): khoá `(post, item_idx, comment)`; preview trả `existing {by, at}`. Cổng ghi và dấu lưu là hai tx (giá có trước dấu; lưu lại an toàn nhờ R22).
- D14 Gợi ý: một `HostBookReader.read` mỗi trang feed (bài đối tác Cần bán/Cần mua); không quyền đọc contracts ⇒ bỏ gợi ý, không lỗi. VAT mặc định form = "đã gồm VAT"; `item_idx` mặc định 0, "Lưu và thêm báo giá khác" tăng 1.