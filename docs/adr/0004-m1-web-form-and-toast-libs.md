# ADR-0004 · Thư viện web M1: toast (sonner) và resolver form (@hookform/resolvers)

Trạng thái: **Accepted** (2026-10-01, người dùng duyệt tại Gate M1) · Ngày: 2026-10-01 · Tác giả: frontend-lead

## Bối cảnh
- ADR-0001 đã Accepted `react-hook-form` + `zod` (form dùng chung schema với API) nhưng **chưa** nêu gói nối hai thứ này, cũng chưa chọn thành phần Toast. M1 là mốc đầu tiên có form và toast (Đăng nhập, Tenant, User).
- `ui-admin.md` §6 yêu cầu Toast góc dưới phải: thành công tự ẩn 4 giây, lỗi phải bấm mới đóng.
- Đã Accepted, không cần ADR: `react-hook-form`, `zod`, `radix-ui` (Dialog, Sheet, Select, Tabs…), TanStack Query/Router. Phiên bản `react-hook-form` ghi vào bảng ADR-0001 khi cài: 7.89.0 (peer `react ^16.8 || ^17 || ^18 || ^19`).
- **Không** đề xuất `@tanstack/react-table` ở M1: bảng M1 phân trang phía server (≤ 50 dòng), không sort/filter phía client → dùng `Table` của shadcn + định nghĩa cột tự viết. Đề xuất lại ở M2 (Commands cần sort/lọc client); khi đó bản `9.x` có API khác `8.x`, phải xác minh lại.

## Lựa chọn — Toast
| Tiêu chí | `sonner` 2.0.8 | Radix Toast (trong `radix-ui` 1.6.7) | Tự viết (~60 dòng + context) |
|---|---|---|---|
| Kích thước gzip | 9,4 KB (bundlephobia, 2026-10-01) | ≈ 0 thêm (đã trong `radix-ui`, nhưng chỉ vùng kéo theo Dismiss/Viewport) | ≈ 1 KB |
| shadcn hiện sinh sẵn | Có (`shadcn add sonner`) | Không (shadcn bỏ Toast Radix, dùng Sonner) | Không |
| A11y (`role=status`/`alert`, pause khi hover, bàn phím) | Có sẵn | Có | Phải tự làm và tự kiểm |
| Toast lỗi không tự ẩn + nút đóng | `duration: Infinity` + `closeButton` | Có | Phải tự làm |
| Peer React 18 | `^18 \|\| ^19` ✓ | ✓ | — |
| Rủi ro | Tự chèn CSS runtime (nằm trong chunk, không tính vào CSS ban đầu) | shadcn không cập nhật component nữa | Bảo trì và lỗi a11y là của dự án |

Nạp lười: `<Toaster />` đặt trong layout `_authed` và trang login (cả hai là chunk route), **không** nằm trong bundle ban đầu.

## Lựa chọn — Resolver
| Tiêu chí | `@hookform/resolvers` 5.9.1 (`zodResolver`) | Tự viết `standardSchemaResolver` (~25 dòng) |
|---|---|---|
| Kích thước | ước ≈ 1–2 KB gzip cho riêng `zod` resolver (chưa đo được: bundlephobia chặn 429 lúc tra; đo bằng `rsbuild build` ở BUILD) | ≈ 0,5 KB |
| Hỗ trợ zod 4.6.5 | Có (v5 dùng Standard Schema; peer `react-hook-form ^7.55`) | Có (zod 4 hiện thực Standard Schema) |
| Bảo trì | Thư viện chính chủ react-hook-form | Dự án tự giữ, phải test ánh xạ `path` → tên field |

## Quyết định
- Dùng **`sonner` 2.0.8** (chuẩn shadcn, a11y có sẵn) và **`@hookform/resolvers` 5.9.1**. Ghi phiên bản vào bảng ADR-0001 khi Accepted. Tra lại `npm view` ngày BUILD; nếu khác thì ghi chênh lệch vào "Quyết định trong lúc làm".
- Tổng thêm ≈ 25 KB gzip (`react-hook-form` 14,8 + `sonner` 9,4 + resolver ước ≈ 1–2) **chỉ vào chunk route đăng nhập/shell**, không vào JS ban đầu (ngân sách 150 KB của `check:bundle`). Số đo thật ghi ở "Quyết định trong lúc làm" sau `rsbuild build`.
- Nếu một chunk route vượt 50 KB gzip (ngân sách M0 §6) thì tách vendor chung bằng `performance.chunkSplit` và ghi `docs/TECH-DEBT.md`; không nới ngân sách ban đầu.

## Hệ quả
- Thêm 2 dependency vào `apps/admin-web/package.json`, ghim chính xác.
- Nguồn: npm registry (`npm view <pkg> version peerDependencies`, 2026-10-01); bundlephobia API (`react-hook-form@7.89.0` gzip 14.775 B, `sonner@2.0.8` gzip 9.408 B).
- Không đổi dòng Accepted nào của ADR-0001; chỉ bổ sung.
