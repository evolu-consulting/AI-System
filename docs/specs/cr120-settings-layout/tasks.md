---
id: cr120-settings-layout
slice: cr120-settings-layout
cr: CR-120
lane: nhanh
migration: không
phụ thuộc: cr120-one-shell
---
## Plan (ngắn)
Một bố cục Cài đặt chung (`apps/workspace-web/src/shared/ui/settings-layout.tsx`): khung hộp thoại, menu trái (tab ngang trên mobile),
mục = tiêu đề + mô tả một dòng, hàng = nhãn/mô tả trái + ô điều khiển phải, công tắc và ô chọn dùng chung. Cài đặt Sổ Hợp Tác và Cài đặt
chung của Community dùng cùng bố cục.

## Làm
- Thêm `SettingsDialogFrame/SettingsLayout/SettingsSection/SettingsGroup/SettingsRow/SettingsSwitch/SettingsSeg`.
- Cài đặt Sổ Hợp Tác: bỏ khung/menu/Panel/Row/Switch/Seg riêng (controls.tsx chỉ còn ô nhập), nút lưu ở đầu hộp thoại giữ nguyên.
- Cài đặt chung Community: bỏ hộp thoại tự vẽ + CSS `.setdlg/.wsside/.setbody/.row/.sw/.swatch`; dùng khung chung.

## Không làm / Chạm
Không đổi hành vi, API, quyền. Không đụng DLC. Không request mới; hộp thoại Sổ Hợp Tác vẫn nạp lười.

## Test tối thiểu
unit: bun test apps/workspace-web/src (595 xanh); e2e community-web (settings.cm.ts), contracts-web (v2l-settings, approval-current).

## Quyết định trong lúc làm
- admin-web không có bố cục Cài đặt để tái dùng (chỉ PageHeader/EditorSaveBar) ⇒ rút mẫu từ hộp thoại Sổ Hợp Tác (menu trái + nội dung) làm chuẩn.
- Một kiểu lưu mỗi mục: mục dùng bản nháp ⇒ nút Lưu ở đầu hộp thoại; mục tự lưu (Community) ⇒ ghi chú "tự lưu" dưới tiêu đề.
- Các ngăn Sổ Hợp Tác có tiêu đề/mô tả riêng (kèm testid) giữ nguyên; chỉ mục Công ty dùng `SettingsSection`.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED web/web-hop-nhat.md
#### Yêu cầu: MỘT bố cục Cài đặt cho mọi module (CR-120 §settings-layout)
Cài đặt Sổ Hợp Tác và Cài đặt chung của Community dùng cùng một khung: menu trái (tab ngang trên mobile), mỗi mục có tiêu đề và mô tả một dòng,
mỗi hàng có nhãn/mô tả bên trái và ô điều khiển bên phải; màu theo token của shell. Nhãn theo ngôn ngữ nghiệp vụ.
- Kịch bản: khi đối tác mở Cài đặt chung thì chỉ có nhóm Cá nhân trong menu trái [test: e2e/community-web/settings.cm.ts » đối tác: chỉ nhóm Cá nhân, không có Sổ Hợp Tác / Công ty trong DOM]
- Kịch bản: khi Admin chọn từng mục Sổ Hợp Tác thì mục hiện trong cùng hộp thoại, URL không đổi [test: e2e/community-web/settings.cm.ts » Admin: mục Sổ Hợp Tác nằm trong dialog Cài đặt, không đổi URL ngoài ?settings=]
- Kịch bản: khi chọn English ở mục Ngôn ngữ thì ngôn ngữ đổi và được lưu [test: e2e/community-web/settings.cm.ts » ngôn ngữ: chọn English đổi nhãn và lưu ai.locale]
- Kịch bản: khi mở Cài đặt Sổ Hợp Tác và chọn Quy trình duyệt thì chỉ xem, không có nút Lưu [test: e2e/contracts-web/approval-current.cw.ts » Cài đặt hiện quy trình đang dùng, không có form sửa]