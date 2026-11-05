# ADR-0034 · Web gộp workspace-web: shell + module manifest + Clean Architecture boundaries + OpenFeature FeatureGate + flow runtime

Trạng thái: **Accepted** (người dùng chốt 2026-11-04, CR-118: 26 câu theo mặc định + N1–N3). Liên quan: ADR-0023 (Clean Architecture), ADR-0031 (cổng gói↔gói), ADR-0030 (duyệt HĐ trên engine), ADR-0033, `docs/specs/CR-118/spec.md`.

## Bối cảnh
Community (`apps/community-web`, 9,1k dòng, hash routing, không react-query, CSS riêng, phiên `ai_rt_community`) và Sổ Hợp Tác (`apps/contracts-web`, 30,9k dòng, TanStack Router/Query, phiên `ai_rt_contracts`) là hai web; chuyển qua lại phải tải lại + hand-off SSO. Hai bộ i18n/CSS trùng tên khác nghĩa (`--accent`). Quyền bật/tắt app nằm ở ai-admin (CR-111/112) nhưng web không có điểm đọc chung; luồng nghiệp vụ trong web phần lớn hardcode dù engine + thư viện quy trình (CR-105) đã cấu hình được.

## Quyết định
1. **Một web**: `git mv apps/contracts-web apps/workspace-web` (`@ai/workspace-web`, giữ lịch sử, cổng 3300); community-web nhập thành module rồi xoá. Một shell/router/phiên (`X-App: contracts`); route SHT giữ nguyên ở gốc, Community dưới `/community/*`; host chính `sohoptac.<d>`.
2. **Module + manifest**: mỗi module `modules/<m>/manifest.ts` là hợp đồng duy nhất với shell (nav, requires, settings, notification, assistant, i18n, slots); shell lọc bằng FeatureGate; module tắt = không DOM/route/chunk.
3. **Clean Architecture cho web, cưỡng chế bằng depcruise** (6 luật, mức error): không import chéo module · shell chỉ đọc manifest · domain thuần · ui không gọi adapters · FeatureGate chỉ qua `platform/features/index.ts` · không import web khác. Contracts giữ `features/<f>/{lib,hooks,api.ts,components,pages}` ánh xạ lớp bằng luật; community tổ chức lại `domain/application/adapters/ui`.
4. **FeatureGate chuẩn OpenFeature** (`@openfeature/web-sdk`, `@openfeature/react-sdk`) với provider mỏng đọc `GET /pack/me` (ConfigCache, 0 SQL nóng, ETag `"<config>.<hub_config>"`/304); cập nhật tức thời bằng event `config.changed` trên `/me/stream` (SSE có sẵn), dự phòng refetch khi focus/403/60 s. Server vẫn fail-closed.
5. **Flow runtime (đợt 2)**: cổng `FlowRuntime`/`FlowDefinitionReader` + registry renderer theo loại bước (thiếu loại ⇒ lỗi typecheck); endpoint flow chung ở packs/kit qua `SlotAdapter` của gói; thêm node engine `form` (cộng thêm, không sửa lõi, không mở route đóng băng). Trạng thái vòng đời thực thể và màn hình giữ trong mã (mức 2). Read-model năng lực dựng từ ConfigCache, không bảng binding mới, không migration.
6. **React 19.2.9 + React Compiler 1.0** cho web gộp (N1); các web khác giữ React 18 tới CR sau.

Phiên bản (npm, kiểm 2026-11-04): `react`/`react-dom` 19.2.9 (2026-10-14), `babel-plugin-react-compiler` 1.0.0, `@openfeature/web-sdk` 1.10.0 (2026-07-28), `@openfeature/react-sdk` 1.4.1 (2026-06-19). ADR-0035/0036 do intake đề xuất tách flow và năng lực nay **gộp vào ADR này**.

## Phương án đã so sánh
- **A. Giữ hai web, chỉ chia sẻ web-kit** (ít churn nhất): vẫn tải lại + SSO hand-off, trùng shell/i18n/CSS (~2,0k dòng), không có điểm gate chung. Loại.
- **B. Module Federation / micro-frontend**: build độc lập nhưng thêm runtime chia sẻ React, 2 router, phiên/CSS vẫn tách; chi phí vận hành lớn hơn lợi ích với 2 module cùng đội. Loại.
- **C. Một app + module lazy + manifest (chọn)**: một router/phiên, tách chunk theo module, ranh giới bằng depcruise; rủi ro: git mv lớn, cách ly đối tác trong app chung (giảm bằng gate manifest + `beforeLoad` + server external-deny + e2e chunk).
- FeatureGate tự viết (không OpenFeature): ít phụ thuộc nhưng phát minh API riêng, khó thay provider; chọn OpenFeature (spec chuẩn, provider mỏng 1 file).

## Hệ quả
- Một bề mặt web nghiệp vụ; bỏ ≈ 2,0k dòng TS (≈ 2,8k sau CSS giai đoạn 2); `community.<d>` thành 301.
- Thêm 2 thư viện web (OpenFeature) + 1 plugin build (React Compiler) ⇒ ADR này là điểm duyệt thư viện (Stack ADR-0001).
- Phiên community đổi app (đối tác đăng nhập lại 1 lần); không đổi admin-api; `/sso` giữ cho admin/chat.
- Đợt 2 chạm engine "đang dùng (nội bộ)": chỉ cộng thêm node `form` + endpoint kit, chạy `test:frozen` và `dlc:check`; DLC (Rowan) không đụng.
- Phải có số đo `/pack/me` và capabilities (baseline `perf/baseline/platform.*.json`), ngân sách bundle riêng chunk community.
- CSS Community giữ `mockup.css` (scope `[data-mod=community]`, `--cm-*`); chuyển sang token/shadcn = nợ ghi TECH-DEBT.
