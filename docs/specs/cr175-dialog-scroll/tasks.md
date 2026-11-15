# cr175-dialog-scroll — CR-175 (dialog có thanh cuộn riêng, gom hộp tự dựng về dialog shadcn)

## Plan
`DialogContent` cao tối đa ~90vh (màn nhỏ ~100dvh), cột flex: `DialogHeader` + `DialogFooter` cố định (`shrink-0`), `DialogBody` (mới) là phần DUY NHẤT cuộn (`overflow-y-auto`); Radix Modal khoá cuộn nền (`data-scroll-locked`). Nội dung không bọc Body vẫn tương thích: Content tự `overflow-y-auto`. Áp cho 4 bản chép shadcn (workspace/admin/chat/studio-web) — cùng khung, có test canh đồng bộ. Không đưa vào web-kit: web-kit không có Tailwind/token shadcn, mỗi app có alias + nhãn đóng khác nhau (ghi nhận G1: 4 bản, 1 khung, test `dialog.test.tsx` canh lệch).

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Dialog: Content max-h + flex-col, `DialogBody`, Header/Footer `shrink-0`, `showCloseButton` (workspace) | `apps/{workspace,admin,chat,studio}-web/src/components/ui/dialog.tsx` | [x] |
| 2 | Gom 5 hộp tự dựng (div role=dialog) + 4 `<dialog class=sheet>` + ReasonDialog community về dialog shadcn; gỡ CSS `.dlg*`, `dialog.sheet` còn dùng thì giữ | xem bảng kiểm kê | [x] |
| 3 | Dialog nội dung dài dùng `DialogBody` (bỏ `max-h`/`overflow` rời) | xem bảng kiểm kê | [x] |
| 4 | Unit cấu trúc + e2e dialog dài trên màn thấp | `apps/workspace-web/src/components/ui/dialog.test.tsx`, `e2e/contracts-web/cr175-dialog-scroll.cw.ts` | [x] |

## Kiểm kê hộp (role=dialog / aria-modal / `<dialog` / Dialog shadcn)
| Chỗ | Trước | Quyết định |
|---|---|---|
| contract-milestones/FulfillDialog | div tự dựng, tự cuộn cả lớp phủ | ĐỔI → shadcn + Body |
| contract-review/AskDialog | div tự dựng | ĐỔI → shadcn + Body |
| contract-versions/UploadVersionPanel | div tự dựng | ĐỔI → shadcn + Body |
| contracts-list/ExtractDialog (tiến độ AI; «Ẩn» = đóng) | div tự dựng | ĐỔI → shadcn (Esc/nền = «Ẩn») |
| contracts-list/UploadTypeDialog | div tự dựng | ĐỔI → shadcn + Body |
| product-suppliers/{Search,Quote,ManualPrice}Dialog, products/AddProductDialog | `<dialog class=sheet>` + ref `showModal()` | ĐỔI → shadcn (`open`/`onOpenChange`; cha SupplierPricesTab, ProductList giữ state) |
| modules/community/flows/parts.tsx `ReasonDialog` | div `.dlg` riêng + Esc tự bắt | ĐỔI → shadcn (bọc `data-mod=community` như CategoryDialog); gỡ CSS `.dlg*` ở `shell.css` |
| product-links/ProductLinkDialog («Gắn sản phẩm»), contract-approval/EvidenceDialog, EsignSendDialog, MilestoneDialog, PeriodDialog, frame-panel/AttachDialog, PromoteDeal, org-chart/DeptMembersDialog, partners/ConnectSearchDialog; admin processes/DlcStepDialog | shadcn, danh sách tự `max-h`/`overflow` | ĐỔI dùng `DialogBody`, bỏ `max-h` rời |
| partners/AddCompanyDialog, chat-web InputsForm, DeleteContractDialog, QuotaDialog, EsignPanel/MethodDialog, ReextractButton, AdminList detail, MentionPicker, CategoryDialog, settings-layout, dialog-host | shadcn, ngắn/khung riêng (form bọc ngoài, footer có điều kiện) | GIỮ — Content tự cuộn (fallback), không cần Body |
| FileViewerDialog, OriginalFileDialog, FileRecordDrawer | shadcn, khung cao cố định / drawer | GIỮ — khung riêng |
| web-kit `NotificationBell` (`role=dialog` panel) | popover neo chuông | GIỮ — popover, không modal |
| workspace-web shell `DockSheet` | sheet bên | GIỮ — sheet |
| admin-web sources/CredentialDialog | panel nội tuyến (không modal) | GIỮ — không phải hộp |
| `reference/mgmt-app-contracts`, `tools/prototype/render.ts` | tham chiếu / bản mẫu | GIỮ — ngoài sản phẩm |

Tổng: 10 hộp tự dựng gom về shadcn (5 div + 4 `<dialog>` + ReasonDialog); 11 dialog shadcn có sẵn thêm `DialogBody`; GIỮ 17 chỗ (popover/sheet/panel/khung riêng/ngắn/tham chiếu).

## Quyết định trong lúc làm
- Gom về MỘT control, 4 bản chép giữ cùng khung (web-kit không có Tailwind ⇒ không đặt Dialog ở đó); test canh lệch.
- Hộp đã có nút Hủy/Đóng riêng ⇒ `showCloseButton={false}` để không thêm nút «Đóng» thứ hai (giữ nhãn e2e cũ).
- Esc / bấm nền = Hủy (hành vi Radix) cho các hộp vừa gom.

## Việc còn lại
- Không có.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED web/web-hop-nhat.md
#### Yêu cầu: Hộp thoại có thanh cuộn riêng (CR-175)
Mọi hộp thoại modal dùng MỘT dialog chung (shadcn/Radix). Hộp cao tối đa khoảng 90% khung nhìn (màn nhỏ gần như đầy màn); tiêu đề và hàng nút luôn nằm trong khung nhìn, chỉ phần thân có thanh cuộn riêng; trang nền bị khoá cuộn khi hộp mở. Popover (chuông) và sheet bên không thuộc quy tắc này.
- Kịch bản: khi hộp thoại dài hơn khung nhìn thì thân có thanh cuộn riêng, tiêu đề và nút Lưu vẫn trong khung nhìn, nền khoá cuộn [test: e2e/contracts-web/cr175-dialog-scroll.cw.ts » CR175 · hộp dài: thân cuộn riêng, tiêu đề + nút Lưu vẫn trong khung nhìn, nền khoá cuộn]
- Kịch bản: khi dùng DialogHeader, DialogBody, DialogFooter thì header và footer không co lại, chỉ body cuộn [test: apps/workspace-web/src/components/ui/dialog.test.tsx » Header + Footer không co lại, Body là phần duy nhất overflow-y-auto]
- Kịch bản: khi bốn app có bản chép dialog thì cùng khung cao tối đa và có DialogBody [test: apps/workspace-web/src/components/ui/dialog.test.tsx » bốn bản chép dialog cùng khung: cao tối đa 90vh, cột flex, có DialogBody]
