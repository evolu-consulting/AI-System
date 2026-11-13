---
id: cr143-ux-fixes
lát: cr143-ux-fixes
cr: CR-143
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa UX nhỏ theo phản hồi: bỏ mô tả thừa ở Bảng tin quản trị, mở app khác ở tab mới, sửa màu chữ banner duyệt, gọn Cài đặt «Ký & đối tác».

## Làm
- Community: `FlowPage.intro` tuỳ chọn; bỏ `introHost`, `reports.intro` (giữ `introPartner`).
- web-kit `auth/open-tab.ts` (`openInNewTab`): mở tab ngay lúc bấm, điều hướng sau khi xin mã SSO; bị chặn ⇒ cùng tab. Dùng ở AppSwitcher, tài khoản, mở Quy trình/Sơ đồ/Quản trị đối tác.
- `AttentionBanner`, `ApprovalParts`, `use-approval-ui`: `text-muted` ⇒ `text-dim`; `border-line` ⇒ `border-rule` (banner).
- Cài đặt: ký số chỉ hiện nhà cung cấp/ảnh trang đầu khi bật; «Thời gian tự trả việc» sang «Quy trình duyệt»; đổi nhãn «Gửi và nhận hợp đồng với đối tác»; mô tả ngưỡng + người phụ trách.

## Không làm / Chạm
Không đổi API/contract, 2FA, Composer, ApprovalRecord, sơ đồ tổ chức.

## Test tối thiểu
`packages/web-kit/src/auth/open-tab.test.ts`, `packages/i18n/src/cr143-copy.test.ts`, `attention-tokens.test.ts`.

## Quyết định trong lúc làm
- Khung trạng thái đối tác: một dòng «Đang bật · còn thiếu: … · ai làm», danh sách chỉ liệt kê mục chưa xong.
- `missing` dùng `{{what}}`/`{{who}}` (bản cũ `{count}` một ngoặc không nội suy được).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md

#### Yêu cầu: Màn «Yêu cầu tham gia» và «Báo cáo vi phạm» của quản trị không có đoạn mô tả đầu trang
- Kịch bản: khi quản trị mở hai màn này thì chỉ thấy tiêu đề, còn đối tác vẫn thấy hướng dẫn gửi yêu cầu [test: packages/i18n/src/cr143-copy.test.ts » Bảng tin quản trị bỏ mô tả đầu trang, giữ hướng dẫn cho đối tác]

### MODIFIED sht/gui-doi-tac-dieu-kien-bat.md

#### Yêu cầu: Nhãn «Gửi và nhận hợp đồng với đối tác» thống nhất giữa Cài đặt và Quản trị nền tảng
- Kịch bản: khi xem Cài đặt công ty hoặc thẻ đối tác ở admin thì cùng một nhãn [test: packages/i18n/src/cr143-copy.test.ts » Gửi và nhận hợp đồng với đối tác: cùng một nhãn ở workspace và admin]

### MODIFIED sht/cai-dat-va-quyen.md

#### Yêu cầu: Mô tả Cài đặt «Ký & đối tác» nói đúng tác động
- Kịch bản: khi quản trị đọc Ký số, Nhóm Người ký HĐ, ngưỡng Quan trọng, Người phụ trách thì mỗi mục có đúng một câu mô tả đã chốt [test: packages/i18n/src/cr143-copy.test.ts » Mô tả cài đặt Ký & đối tác đúng lời đã chốt]

### MODIFIED sht/duyet-ky-so.md

#### Yêu cầu: Banner cần chú ý và ghi chú duyệt đọc được
- Kịch bản: khi hiện banner cần chú ý thì chữ phụ dùng màu chữ nhạt (không phải màu nền) [test: apps/workspace-web/src/features/contract-approval/components/attention-tokens.test.ts » Banner cần chú ý và ghi chú duyệt dùng token chữ đọc được]

#### Yêu cầu: Mở app khác ở tab mới
- Kịch bản: khi bấm mở app khác thì tab mới mở ngay lúc bấm và được điều hướng sau khi có mã SSO [test: packages/web-kit/src/auth/open-tab.test.ts » mở tab ngay lúc bấm rồi gán URL cho tab đó]
- Kịch bản: khi trình duyệt chặn tab mới thì chuyển trong tab hiện tại [test: packages/web-kit/src/auth/open-tab.test.ts » popup bị chặn (null) ⇒ điều hướng tab hiện tại]

## Việc còn lại
Đổi sang test e2e hành trình cuối đợt (điều phối chạy). `e2e/contracts-web/esign-multi.cw.ts` (khoá) vẫn tìm tab «Quy trình duyệt» cho khối nhà cung cấp ký số, không do lát này.
