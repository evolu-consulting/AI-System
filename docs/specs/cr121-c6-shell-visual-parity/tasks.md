---
id: cr121-c6-shell-visual-parity
lát: cr121-c6-shell-visual-parity
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Một khung nhìn cho mọi module: Sidebar ép cỡ icon, Header có cụm nút phải cố định (testid), một nút trợ lý nổi dùng chung, khoảng đệm nội dung do `<main>` của shell cấp.

## Làm
Bảng trước → sau (đo từ điều phối trên localhost:3300):

| Điểm | Trước (Sổ Hợp Tác / Community) | Sau (cả hai) |
|---|---|---|
| Icon menu | 20 px, nét 1.8, chữ x=54 / 24 px, nét 2, chữ x=58 | Sidebar ép 20 px, nét 1.8 (`NavIcon`), chữ cùng x |
| Cụm nút Header | chuông+chat, không ô tìm / ô tìm + 3 nút (nút 44 px, badge 18 px) | `topbar-search` (khe chung, module khai báo), `topbar-actions` > `topbar-apps`, `topbar-bell`, `topbar-feedback`; nút 40 px, badge 16 px |
| Nút trợ lý | tròn chỉ icon 48 px / nút dài "Hỏi trợ lý giá" | `AssistantFab` (`~/shared/ui`), tròn 48 px, testid `assistant-fab`, tooltip "Hỏi trợ lý AI" |
| Đệm vùng nội dung | `<main>` px-7 py-7 / `<main>` + `.page` thêm 24/20/48 px (đệm kép), max 1280 | `.page` về 0: chỉ `<main>` cấp đệm, bề rộng theo khoang `wide` (1560) |
| Tiêu đề trang, breadcrumb | tiêu đề do trang tự vẽ (đã dùng token chung từ C-1..C-5); không có breadcrumb ở cả hai | không đổi (không lệch) |

File: `features/shell/components/{Sidebar,Header}.tsx`, `features/shell/pages/Shell.tsx`, `shared/ui/AssistantFab.tsx`, `modules/community/ui/{ChatDock.tsx,styles/mockup.css}`, i18n `contracts.shell.askAssistant`, `community.dock.fab`.

## Không làm / Chạm
Không đổi nội dung trang, route, quyền, API; không đụng admin-web, DLC. Perf: không (bundle `check:bundle` OK 130.4 KB js).

## Test tối thiểu
- unit `features/shell/components/shell-parity.test.tsx` (NavIcon ép 20/1.8; AssistantFab testid + tooltip) xanh; `bun test src/modules/community src/features/shell` 114 pass.
- typecheck + biome sạch. e2e `e2e/community-web/sidebar-one.cm.ts` thêm 1 test (chỉ viết, chưa chạy).

## Quyết định trong lúc làm
- Ô tìm: giữ khe `topbar-search` đã có (Community vẽ vào), gắn testid; Sổ Hợp Tác chưa khai báo ô tìm nên khe trống.
- Nhãn nút trợ lý Community đổi "Hỏi trợ lý giá" → "Hỏi trợ lý AI" (vi) / "Ask AI assistant" (en) theo yêu cầu điều phối; aria-label giữ nhãn riêng của từng module để e2e cũ không vỡ.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Khung nhìn thống nhất giữa các module
Biểu tượng menu trái cùng cỡ 20 px/nét 1.8 do Sidebar quyết định; thanh trên có cụm nút phải cố định (ô tìm theo khe, chuông kèm badge, góp ý) cùng testid ở mọi module; chỉ một nút trợ lý nổi dạng tròn, tooltip "Hỏi trợ lý AI"; đệm vùng nội dung do khung cấp.
- Kịch bản: khi chuyển Community ↔ Sổ Hợp Tác thì icon menu cùng cỡ, cụm nút Header và nút trợ lý cùng testid [test: e2e/community-web/sidebar-one.cm.ts » Community và Sổ Hợp Tác: icon menu cùng cỡ, cụm nút Header cùng testid, nút trợ lý cùng testid]
- Kịch bản: khi icon module mặc định 24 px thì Sidebar vẫn vẽ 20 px nét 1.8 [test: apps/workspace-web/src/features/shell/components/shell-parity.test.tsx » NavIcon ép 20 px, nét 1.8 dù icon (lucide) mặc định 24 px / 2]

## Việc còn lại
- Chạy e2e sidebar-one.cm.ts cuối đợt; soát mắt Header Community (ô tìm + nút 40 px) trên trình duyệt.