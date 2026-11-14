# cr158-tenant-favicon — CR-158 (icon tab trình duyệt theo logo công ty)

## Plan
`useBrandSync` (shell, đã đọc `brand.logo` từ query công ty có sẵn) thêm một effect gọi `applyFavicon(logo)`. Không gọi API thêm, không sửa từng trang.

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | `applyFavicon` + effect ở `useBrandSync` | `settings/lib/brand.ts`, `settings/hooks/use-settings.ts` | [x] |
| 2 | Test | `settings/lib/favicon.test.ts`, `e2e/contracts-web/cr158-tenant-favicon.cw.ts` (viết, chưa chạy) | [x] |

## Quyết định trong lúc làm
- `index.html` không có `<link rel="icon">` ⇒ không có logo thì gỡ link do ta tạo (trình duyệt về mặc định); nếu có link sẵn thì nhớ và trả href gốc.
- Logo là URL cùng origin hoặc data URI; trình duyệt gửi cookie cho favicon cùng origin nên hiển thị được. Logo khác origin cần CORS/ảnh công khai — chưa kiểm trên trình duyệt thật.

## Việc còn lại
- admin-web và chat-web chưa theo logo công ty.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/ten-cong-ty-mot-nguon.md

#### Yêu cầu: Icon tab trình duyệt theo logo công ty
- Kịch bản: khi công ty có logo thì icon tab dùng logo đó, đổi logo thì icon đổi theo [test: apps/workspace-web/src/features/settings/lib/favicon.test.ts » logo: tạo link icon theo logo, đổi logo thì thay href, hết logo thì gỡ]
- Kịch bản: khi công ty không có logo hoặc chưa đăng nhập thì giữ icon mặc định [test: apps/workspace-web/src/features/settings/lib/favicon.test.ts » chưa đăng nhập, không logo: không đụng gì]
- Kịch bản: khi mở Sổ Hợp Tác của công ty có logo thì icon tab là logo [test: e2e/contracts-web/cr158-tenant-favicon.cw.ts » Công ty có logo: icon tab dùng logo đó]
