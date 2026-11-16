# Nút trợ lý nổi không che nội dung (CR-177 · nguồn: cr177-w4-fixes, cr180-fix-rest)

#### Yêu cầu: Nút trợ lý nổi không che nội dung
Vùng nội dung chính chừa đệm đáy bằng chiều cao nút nổi + lề (biến `--fab-safe`, cộng safe-area trên điện thoại) ở mọi trang; hàng phân trang chừa lề phải cho nút nổi. Luật điện thoại chung: [mobile.md](mobile.md).
- Kịch bản: khi cuộn tới cuối danh sách HĐ ở 1280x720 và 390x844 thì phân trang không bị nút nổi đè [test: e2e/contracts-web/cr177-w4-fab-safe.cw.ts » CR177-W4 · danh sách HĐ]
