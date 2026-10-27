# Kiểm bố cục trang ký DocuSign (không gửi email)

Đo vị trí thật của ô ký/ngày trên trang ký HTML (`signaturePageHtml` + `SIGN_TAB_OFFSET` trong
`apps/hub-api/src/modules/packs/contracts/domain/esign.rules.ts`) bằng phong bì **nháp** (`status: created` ⇒ DocuSign không gửi
email), lấy ảnh trang 72 dpi + toạ độ tab đã giải anchor, vẽ đè, rồi chuyển nháp vào thùng rác.

```
bun tools/scripts/src/esign-layout-gen.ts <thư mục ra>            # sinh sign.html + offset.json từ code hiện tại
scp server-check.ts run-remote.sh <ra>/sign.html <ra>/offset.json evoc@<máy chủ>:/tmp/lc/
ssh evoc@<máy chủ> "bash /tmp/lc/run-remote.sh" > out.txt          # chạy trong hub-api (env DOCUSIGN_*)
python -I overlay.py out.txt <thư mục ra>                          # overlay.png: đỏ = ô ký, xanh = ô ngày
```

**Chế độ anchor trong văn bản (esign-anchor):** `bun tools/scripts/src/esign-layout-gen.ts <ra> text` sinh `sign.html` = HĐ mẫu
có khối "ĐẠI DIỆN BÊN A / ĐẠI DIỆN BÊN B" (HTML làm document 1 — repo không có thư viện tạo PDF) + `offset.json`
`{mode:"text", sign, date, anchors}` (cụm do `pickAnchors` chọn, offset = `TEXT_TAB_OFFSET` trong `domain/esign.anchor.ts`).
Các bước scp/ssh/overlay giữ nguyên; `server-check.ts` đặt tab theo cụm (nguyên từ, không phân biệt hoa thường) và chụp trang
có ô ký đầu tiên. Đạt khi ô ký đỏ nằm ngay dưới dòng "(Ký, ghi rõ họ tên…)" của đúng cột, không đè chữ; lệch ⇒ sửa
`TEXT_TAB_OFFSET` rồi đo lại. Chưa đo (điều phối chạy).

Kết quả 2026-10-27 (sign y=32, date y=8): ô ký nằm trong khung hàng (hàng 1: 187–252, ô 201–245; hàng 2: 253–318, ô 267–311).
Lưu ý PowerShell 5.1: đọc/ghi file UTF-8 bằng `[IO.File]::ReadAllText(..., UTF8)`, không dùng `Get-Content` mặc định (hỏng dấu).
