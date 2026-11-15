---
id: fix-community-delete
lát: fix-community-delete
cr: CR-175
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Lỗi bản test: xoá bài xong bài vẫn hiện tới khi tải lại (danh sách giữ "đuôi" bài đã tải dần, nạp lại trang đầu không đụng tới). Xác nhận xoá bài nằm inline trong thẻ bài.

## Làm
- `ctx` thêm `gone` + `dropPost`; `useFeed` lọc `withoutGone` ⇒ bài mất ngay ở mọi danh sách (bảng tin, hồ sơ, «Bài của tôi» đều qua `useFeed`); xoá lỗi ⇒ khôi phục + toast.
- Xoá bài và xoá bình luận (Thread) qua `confirmDialog` dùng chung (role dialog, nút Xoá đỏ, Huỷ cạnh); bỏ khối `.confirm` inline + CSS.
- admin-web `DeptCard`: `window.confirm` → `ConfirmDialog` (alertdialog).

## Kiểm kê xác nhận (workspace-web, messages-web, chat-web, admin-web, studio-web)
| Chỗ | Trước | Sau |
|---|---|---|
| community PostCard xoá bài | inline `.confirm` | confirmDialog (ĐỔI) |
| community Thread xoá bình luận | không hỏi | confirmDialog (ĐỔI) |
| admin DeptCard xoá khỏi sơ đồ | window.confirm | ConfirmDialog (ĐỔI) |
| partners DisconnectButton, NotesPanel, ContractFilesPanel, messages GroupMembersSheet | confirmDialog | giữ |
| contract-delete DeleteContractButton, admin Command/Trello/Run/Secret/Source/User/Tenant/Import, studio ProfileDelete/KhDelete/Secrets | Dialog/AlertDialog | giữ |
| overview InboxDecisionRow (Trả lại/Từ chối) | khối nhập lý do inline | giữ: form nhập lý do, không phải Có/Không |

## Không làm / Chạm
Không đổi contract/API. Chạm: modules/community, admin-web DeptCard, i18n community.

## Test tối thiểu
`feed-merge.test.ts`, e2e `community-web/feed.cm.ts`.

## Quyết định trong lúc làm
Dùng `gone` ở ctx (không refetch) vì bài ở trang tải dần không nằm trong cửa sổ nạp lại trang đầu.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Xoá bài đăng
- Kịch bản: khi xoá bài ở trang đã tải dần thì bài mất ngay, không cần tải lại [test: apps/workspace-web/src/modules/community/domain/feed-merge.test.ts » withoutGone]
- Kịch bản: khi bấm Xoá bài thì hiện hộp thoại xác nhận, Huỷ giữ bài, Xoá làm bài mất ngay [test: e2e/community-web/feed.cm.ts » chủ quản: đăng Cần bán, sửa (đã sửa), lưu trữ, xoá có xác nhận]
