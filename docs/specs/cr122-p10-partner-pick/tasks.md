# CR-122 p10 — Ô Nhà cung cấp/Đối tác chọn từ sổ đối tác

Trạng thái gộp: chưa gộp
Làn: nhanh (không đổi RLS; chỉ đọc `partner_roles` ∪ `companies` dưới RLS M1 sẵn có; migration 0081 chỉ thêm index).

## Plan ngắn
- BE: `GET /pack/contracts/partners/search?q=&role=&limit=20` (chưa có, `partners/lookup` chỉ tra một tên). Một câu SQL, khớp TIỀN TỐ
  tên đã fold / tên ngắn / MST, lọc vai, `limit` 1…50. Index `text_pattern_ops` ở migration `0081_partner_pick_search_idx` (journal idx 77).
  Tenant lọc tường minh trong repo + RLS.
- FE (workspace-web, `features/contract-form`): `PartnerField` thành ô chọn (danh sách từ sổ theo vai của loại HĐ: Mua = NCC, Bán = Khách hàng,
  Giới thiệu = bên trả hoa hồng); chọn ⇒ tên + MST/CCCD lấy từ sổ, ô MST chỉ đọc; gõ tên mới ⇒ giữ "Đối tác mới · sẽ tạo khi lưu", nhập tay.
- AI đọc ra tên/MST (form có badge/unsure) ⇒ `suggestMatch`: MST trước rồi tên; chắc ⇒ chọn sẵn; mơ hồ ⇒ nút "Có phải <tên>?".

## Quyết định trong lúc làm
- Sổ chưa có cột "cá nhân"/CCCD: CCCD lưu chung `tax_id` (12 chữ số ⇒ nhãn "CCCD", còn lại "MST"); cá nhân không có số ⇒ để trống. Không thêm cột (một nguồn).
- Khớp tìm là tiền tố (tận dụng btree, không cần pg_trgm); gõ giữa tên không khớp.
- Số migration 0081 tự chọn (chưa được giao trước): điều phối đổi nếu trùng lát khác.

## testid mới cho qc
`partner-input`, `partner-options` (listbox), `partner-option`, `partner-maybe`, `partner-maybe-option`, `cf-partner_tax_id` (readonly khi đã chọn).

## Delta (so với docs/current)

Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### ADDED contracts/partner-pick.md
#### Yêu cầu: Tìm đối tác trong sổ có limit, index và cách ly tenant (nguồn: cr122-p10-partner-pick)
`GET /pack/contracts/partners/search` trả tối đa `limit` (mặc định 20, ≤ 50) đối tác của tenant người gọi, lọc theo vai và khớp tiền tố
tên/tên ngắn/MST; không bao giờ trả đối tác tenant khác; đầu vào sai ⇒ 400.
- Kịch bản: khi tìm "gsm" với vai NCC thì chỉ trả NCC của tenant mình, không trả khách hàng hay tenant khác [test: tests/acceptance/V2-C/partner-search.int.test.ts » lọc theo vai và tiền tố tên hoặc MST có limit và không lộ tenant khác]

### ADDED web/hop-dong-partner-pick.md
#### Yêu cầu: Ô đối tác chọn từ sổ, MST/CCCD lấy từ sổ và chỉ đọc (nguồn: cr122-p10-partner-pick)
Loại HĐ Mua/Bán/Giới thiệu lấy vai NCC/Khách hàng/Bên trả hoa hồng; chọn đối tác ⇒ ô MST (hoặc CCCD nếu số 12 chữ số) tự điền và chỉ đọc;
gõ tên chưa có ⇒ "Đối tác mới · sẽ tạo khi lưu" và nhập tay được.
- Kịch bản: khi loại HĐ là Mua thì vai tìm là NCC, Bán là Khách hàng, Giới thiệu là bên trả hoa hồng [test: apps/workspace-web/src/features/contract-form/lib/partner-match.test.ts » vai theo loại HĐ và nhãn MST hay CCCD]

#### Yêu cầu: AI đọc ra đối tác thì gợi ý khớp với sổ (nguồn: cr122-p10-partner-pick)
Khớp MST trước rồi tên; khớp chắc chắn ⇒ chọn sẵn; mơ hồ ⇒ "Có phải <tên>?" cho người dùng chọn.
- Kịch bản: khi MST của AI khớp đúng một đối tác thì chọn sẵn dù tên khác [test: apps/workspace-web/src/features/contract-form/lib/partner-match.test.ts » khớp MST trước thì đúng một là chắc dù tên khác]
- Kịch bản: khi tên khớp nhưng MST hai bên khác nhau hoặc chỉ gần giống thì hỏi "Có phải …?" [test: apps/workspace-web/src/features/contract-form/lib/partner-match.test.ts » chỉ gần giống thì mơ hồ, không có gì thì none]

## Việc còn lại
- e2e (qc, chạy một lần cuối CR): chọn đối tác từ danh sách ⇒ MST điền + chỉ đọc; gõ tên mới ⇒ nhãn "Đối tác mới" + MST nhập tay; upload HĐ AI đọc ⇒ chọn sẵn / "Có phải".
- Soát UI theo Luật gốc 3 (chưa chụp màn hình; chưa chạy stack).
