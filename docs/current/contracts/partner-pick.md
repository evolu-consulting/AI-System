# partner pick

Cập nhật: 2026-11-08 · Nguồn: cr122-p10-partner-pick. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Tìm đối tác trong sổ có limit, index và cách ly tenant (nguồn: cr122-p10-partner-pick)
`GET /pack/contracts/partners/search` trả tối đa `limit` (mặc định 20, ≤ 50) đối tác của tenant người gọi, lọc theo vai và khớp tiền tố
tên/tên ngắn/MST; không bao giờ trả đối tác tenant khác; đầu vào sai ⇒ 400.
- Kịch bản: khi tìm "gsm" với vai NCC thì chỉ trả NCC của tenant mình, không trả khách hàng hay tenant khác [test: tests/acceptance/V2-C/partner-search.int.test.ts » lọc theo vai và tiền tố tên hoặc MST có limit và không lộ tenant khác]
