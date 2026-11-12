# CR-130 pha 1 — gộp Community vào Sổ Hợp Tác (làn nhanh)

## Khoảng cách thực tế (tra 2026-11-12)
| Mục Pha 1 | Hiện trạng | Việc |
|---|---|---|
| Một trợ lý | ĐÃ xong: `ChatDock` đã gỡ; `Shell`/`AssistantDock` dùng chung; `dockContext` gửi route `/feed`/`/profile` + từ khoá tìm (`setAssistantSelection` ở `community/application/ctx.tsx`); đối tác không có trợ lý (Hub chặn Chat AI) | Chỉ dọn comment test «ChatDock cũ». Khoá i18n `community.dock.searchContext` còn dùng ⇒ giữ |
| Một Cài đặt | ĐÃ xong: `SettingsDialog` có nhóm «Bảng tin» (`buildNavGroups`, `FeedNotifyPane`); `/community?settings=1` và `#/settings` chuyển vào ngăn `feed` | THIẾU: `/contracts/settings?sec=feed` rơi về mục «co» ⇒ thêm `navFromKey` |
| Cờ `community` | ĐÃ MỘT chỗ đọc: mọi nơi (Sidebar, UserMenu, SettingsDialog, PartnerDetail, CommunityRoute) qua `useShellPacks` ⇐ `useFeatures` (OpenFeature) — không còn đọc `packs.community` từ nguồn khác | Không đổi |
| Tắt cờ ⇒ ẩn menu + ngăn + vào URL | Menu/ngăn ẩn theo cờ (có test `buildNavGroups` mới); URL thẳng ⇒ `PackStatePage kind=disabled` | `EmptyState` (CR-131) CHƯA có trên platform/gd0 ⇒ giữ `PackStatePage`, ghi Việc còn lại |

## Quyết định
- Không đổi API hub, không thêm thư viện; trợ lý vẫn lazy.
- `?sec=feed` dùng hàm thuần `navFromKey` (mở rộng `sectionFromKey`, không đổi hành vi cũ).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Cài đặt Bảng tin nằm trong hộp thoại Cài đặt chung
Ngăn «Bảng tin ▸ Thông báo» là một nhóm của hộp thoại Cài đặt Sổ Hợp Tác; không có trang/nút cài đặt thứ hai. Link cũ `/community?settings=1` và `/contracts/settings?sec=feed` mở thẳng ngăn đó; tắt cờ `community` thì không có nhóm Bảng tin.
- Kịch bản: khi mở `?sec=feed` thì hộp thoại Cài đặt mở ở ngăn Bảng tin [test: apps/workspace-web/src/features/settings/lib/section-key.test.ts » navFromKey]
- Kịch bản: khi cờ community tắt thì menu Cài đặt không có nhóm Bảng tin [test: apps/workspace-web/src/features/settings/components/SettingsNav.test.ts » cờ community tắt]

## Việc còn lại
- Khi CR-131 gộp `packages/web-kit/src/ui/EmptyState.tsx`: `CommunityRoute` hiện `EmptyState kind="off"` thay `PackStatePage` khi cờ tắt.
- e2e có thể vỡ (không chạy): chưa phát hiện — thay đổi chỉ thêm đường `?sec=feed`.
