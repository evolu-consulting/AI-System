# ADR-0042 · Phông tiếng Việt cho PDF "Hồ sơ duyệt" (CR-127 U4b-3) — Accepted (2026-11-11)

## Bối cảnh
`pdf-lib` (ADR-0039, đã có ở hub-api) dựng PDF Hồ sơ duyệt. Phông chuẩn Helvetica chỉ in được WinAnsi: chữ Việt có dấu chồng (ệ, ử, ỡ…) KHÔNG in được. Repo không có tệp phông TTF/OTF trong `apps/hub-api`; `@fontsource/be-vietnam-pro` (woff/woff2) chỉ là phụ thuộc của admin-web; `@pdf-lib/fontkit` (bắt buộc để nhúng phông tuỳ chọn) chưa có.

## Lựa chọn
| | A. Bỏ dấu khi in (đang dùng) | B. `@pdf-lib/fontkit` + nhúng Be Vietnam Pro (subset) |
|---|---|---|
| Thư viện mới | không | `@pdf-lib/fontkit` (MIT, ~700 KB, thuần JS — chạy Bun/Node) |
| Chữ Việt | "Hop dong mua ban" (mất dấu) | đúng dấu |
| Kích thước PDF | ~3 KB/trang | + phông subset ~30–60 KB |
| Rủi ro | người dùng thấy tên không dấu | thêm tệp phông vào repo (OFL) + 1 phụ thuộc |

## Quyết định (2026-11-11, người dùng duyệt)
Chọn B. `@pdf-lib/fontkit@1.1.1` (MIT; phát hành 2021, ổn định) thêm vào `apps/hub-api`. Phông Be Vietnam Pro Regular + Bold (SIL OFL 1.1) đặt tại `apps/hub-api/src/modules/packs/contracts/adapters/fonts/` kèm `OFL.txt`; nguồn: https://github.com/bettergui/BeVietnamPro (`fonts/ttf/`). `approval-record.pdf.ts` nhúng subset, bỏ `foldVi`. Deploy: Dockerfile prod `COPY app/` cả cây mã nguồn và hub-api chạy từ mã nguồn Bun ⇒ tệp phông đi theo, không cần sửa.
