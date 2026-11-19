---
id: cr191-join-requests
lát: cr191-join-requests
cr: CR-191
làn: nhanh
migration: không
phụ thuộc: cr191-partner-connect
---
## Plan (ngắn)
BR-191-10 / Q4 CR-189: «Yêu cầu tham gia» (duyệt / từ chối kèm lý do, «Tạo đối tác mới» / «Gắn với đối tác có sẵn») chuyển từ Community sang Sổ Hợp Tác › Đối tác, cạnh «Yêu cầu kết nối». Cơ chế duyệt, quyền xem/duyệt (`flows/nav.joinReview`, máy chủ quyết) giữ nguyên. Tách phần phụ thuộc `useApp` thành ngữ cảnh mỏng `FlowEnv` (API luồng, làm mới, toast, màu nhấn) dùng chung cho cả hai nơi (G1, không chép).

## Làm
- [x] `application/flow-env.ts` (`FlowEnv`), `AppProvider` cấp; `parts`, `AdminList`, `JoinApprove`, `JoinReview` đọc `useFlowEnv` thay `useApp`.
- [x] `ui/embed/JoinReviewPane.tsx` + `loadJoinReviewPane` (manifest) + `features/partners/components/JoinRequestsPanel.tsx` gắn vào `PartnersPage`.
- [x] Mục «Yêu cầu tham gia» của Community chỉ còn cho người không duyệt (`hideWithCap: community.reports`); route `/community/join`: người duyệt ⇒ chuyển hướng (thay mục lịch sử) sang `/contracts/partners`; đối tác vẫn thấy form gửi yêu cầu.
- [x] unit (`manifest.test.ts`, `use-flow-caps.test.ts`); e2e: sửa CR130-J2 (duyệt từ trang Đối tác), thêm CR191-J8 (chuyển hướng + menu).

## Không làm / Chạm
Không đổi quyền/máy chủ/hợp đồng API. Không đổi CSS Community. Không chạm `tests` của lát khác ngoài `use-flow-caps.test.ts` (nghĩa đổi, xem Delta).

## Test tối thiểu
`bun test` file sửa; e2e viết, KHÔNG chạy trong lát.

## Quyết định trong lúc làm
- Điều phối chốt: đối tác vẫn có mục menu tới form; người duyệt không thấy. Phân biệt bằng khoá `community.reports` (máy chủ chỉ cấp cho người duyệt), không đổi máy chủ.
- Chuyển hướng dùng `openContracts(path, { replace: true })` (mở rộng cổng host, không thêm phụ thuộc).
- Khối nhúng tự kiểm quyền bằng `flows/nav.joinReview` và cờ gói `community`; không đủ ⇒ không vẽ gì.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/ket-noi-doi-tac.md
#### Yêu cầu: «Yêu cầu tham gia» nằm ở Sổ Hợp Tác › Đối tác
Người quản trị Sổ Hợp Tác thấy khối «Yêu cầu tham gia» trên trang Đối tác (cạnh «Yêu cầu kết nối»), duyệt hoặc từ chối như trước; Community chỉ còn mục này cho đối tác (người duyệt không thấy) và link cũ `/community/join` chuyển sang trang Đối tác. Người không có quyền duyệt không thấy khối.
- Kịch bản: khi người duyệt mở trang Đối tác thì duyệt được từ đó (CR130-J2 sửa theo chỗ mới), và khi mở link cũ thì sang trang Đối tác, menu Community ẩn mục này với người duyệt [test: e2e/community-web/cr130-journey.cs.ts » CR191-J8 · người duyệt mở link cũ /community/join ⇒ chuyển sang Sổ Hợp Tác › Đối tác, thấy khối «Yêu cầu tham gia», menu Community ẩn mục này với người duyệt]
- Kịch bản: khi xem manifest Community thì mục /join ẩn với người duyệt và khối nhúng nạp lười [test: apps/workspace-web/src/modules/community/manifest.test.ts » menu Community: mục Yêu cầu tham gia ẩn với người duyệt, route /join giữ để chuyển hướng]
- Kịch bản: khi người dùng là đối tác thì thấy mục, người duyệt thì không [test: apps/workspace-web/src/shell/use-flow-caps.test.ts » CR-191 · «Yêu cầu tham gia» chỉ còn cho đối tác, người duyệt không thấy (đã chuyển sang Sổ Hợp Tác › Đối tác)]

## Việc còn lại
- e2e chưa chạy (điều phối chạy cuối đợt); chưa soát UI góc người dùng (G4): kiểu Community (`data-mod`) trong trang Tailwind cần nhìn thực tế.
