---
id: cr134-ui
lát: cr134-ui — Chuẩn UI chung (workspace-web; admin-web chỉ kiểm)
cr: CR-134
làn: nhanh
migration: không
---
## Plan (ngắn)
| # | Việc | File chính |
|---|---|---|
| 1 | MỘT nút `Btn` (variant primary/outline/quiet/danger/icon · size md 40px / sm 36px · `loading` · `disabled`+`reason`) trên lớp `.btn*`; thêm `.btn-danger`, vòng focus `.btn`; gỡ shadcn `ui/button.tsx` | `components/ui/Btn.tsx`, `styles/globals.css`, `platform/flow/ui/action-variant.ts` |
| 2 | Thanh hành động đã chuyển: thẻ duyệt/trang Yêu cầu (`RunStepActions`, `EvidenceAsk`, ô lý do), hộp xác nhận `dialog-host`, thẻ duyệt HĐ (`ApprovalParts`), đầu trang HĐ (`HeadActions` + menu Thao tác), Cài đặt (`SettingsHeader`, `ScoringV2EPane`, `ScoutPane`, `ScoutQuota`), `FormStep`, `ServiceCustomersTab` | như cột trái |
| 3 | Q7: không quyền ⇒ nút khoá + `reason` (tooltip + `aria-describedby`); Cài đặt người không phải chủ sở hữu thấy nút khoá kèm lý do thay vì mất nút | `SettingsHeader`, `ScoringV2EPane`, `ScoutPane`, `ScoutQuota` |
| 4 | Khuôn loading: `loadPhase()` + `<Refreshing>` (thanh mảnh, nội dung cũ mờ, `aria-busy`) + `<PaneSkeleton>` lần đầu; hook xem trước dùng `placeholderData: keepPreviousData` | `lib/load-phase.ts`, `components/shared/Refreshing.tsx`, `ScoringImpact`, `SwitchPreview`, `ImpactBox`, `LoadState`, `ScoringEditor/Pane/V2EPane`, `use-scoring`, `use-rep`, `use-rep-v2e` |
| 5 | `TruncText` (một dòng, «…», `title` đủ nội dung); áp: «File ký»/tên tệp ở dòng thông tin HĐ, đối tác, `MetaLine` (mục co được), `Tag`, `FileUploadField`/`FileName`, tên phụ lục + HĐ con trong danh sách | `components/shared/TruncText.tsx`, `DetailLead`, `meta-line`, `tag`, `FileUploadField`, `ContractCells`, `ChildRows` |
| 6 | Toast: lỗi tự tắt 3 s (nút đóng giữ); thành công 3 s (thống nhất); lỗi CÓ nút hành động ở lại tới khi bấm | `packages/web-kit/src/ui/toast.tsx` + `toast.test.ts` |
| 7 | admin-web: kiểm — `ConfirmDialog` (AlertDialogCancel + Button đều size default h-9) và `EditorSaveBar` (cả hai default) đã cùng cỡ ⇒ không sửa | — |

## Quyết định trong lúc làm
- Nút dạng liên kết (`<Link className="btn …">`) giữ nguyên, dùng `btnClass(variant,size)` khi cần; không ép thành `<button>`.
- Hành động kiểu `default` của luồng (trước là `.btn` không viền) ⇒ `quiet` (có viền) để đứng cạnh nút chính cho rõ.
- Mục menu «Thao tác ▾» khoá có lý do giữ cơ chế `why` của `PopMenu` (đã có dòng phụ + tooltip), không đổi.
- Toast thành công 4 s → 3 s cho thống nhất với lỗi (Q11); `notifyBrief` theo (3 s). Info giữ 8 s. Lỗi có `action` ở lại — nếu tự tắt 3 s thì nút «Tải lại/Thử lại» biến mất.
- Q7 «thao tác vai đó không bao giờ có ⇒ ẩn»: không có chỗ nào cần ẩn thêm trong phạm vi lát này (menu/nút ẩn theo `can` của hub đã đúng).
- Ngân sách chunk async của workspace-web 50 → 53 KB (`scripts/check-bundle.ts`): chunk Cài đặt/luồng duyệt đã 49,4 KB sát trần, `Btn` + `Refreshing`/`PaneSkeleton` dùng chung thêm ~1,4 KB gz. `Btn`/`TruncText`/`Refreshing` dùng `"use no memo"` (bỏ bộ nhớ đệm React Compiler) để không phình thêm.
- `loadPhase()` là helper phân loại cho hook/trang MỚI (chưa chỗ nào bắt buộc dùng); các khối Cài đặt hiện dùng trực tiếp `isFetching`/`data` với `<Refreshing>`.
- Ảnh xác nhận: `.../scratchpad/uat-shots/out4/01-*.png` (Yêu cầu: Duyệt/Trả lại/Từ chối 40px; ô lý do Trả lại/Huỷ 40px), `02-*.png` (Cài đặt demo-viewer: nút khoá, tooltip = lý do), `03-*.png` (tên file ký dài cắt «…»).
- `loading` của Btn khoá nút và có vòng quay; `disabled` + `loading` cùng lúc ⇒ vẫn là khoá (reason hiện khi `disabled`).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED web/web-hop-nhat.md
#### Yêu cầu: Chuẩn UI chung của workspace-web (CR-134)
Một component nút (`Btn`) cho mọi thanh hành động: các nút đứng cùng hàng cùng cỡ (md 40 px, sm 36 px); thao tác người xem không có quyền hiện nút khoá kèm lý do khi rê chuột; số liệu tính lại (xem trước tác động ở Cài đặt) giữ giá trị cũ kèm chỉ báo mảnh, lần đầu hiện khung xương; chữ dài (tên tệp, đối tác) cắt «…» kèm tooltip đủ nội dung; toast thành công và lỗi tự tắt sau 3 giây (lỗi có nút hành động ở lại).
- Kịch bản: nút khoá có lý do: bọc tooltip và `aria-describedby` tới lý do [test: apps/workspace-web/src/components/ui/Btn.test.tsx » disabled + reason ⇒ nút khoá, bọc span title, aria-describedby trỏ tới lý do]
- Kịch bản: cùng hàng cùng cỡ — md là `.btn`, sm thêm `.btn-sm` [test: apps/workspace-web/src/components/ui/Btn.test.tsx » cỡ: md = .btn (40px), sm thêm .btn-sm (36px), icon không có btn-sm]
- Kịch bản: tải lại có dữ liệu cũ ⇒ giữ dữ liệu + chỉ báo [test: apps/workspace-web/src/lib/load-phase.test.ts » có dữ liệu + đang tải lại ⇒ refreshing, xong ⇒ idle]
- Kịch bản: chỉ báo tải lại và khung xương lần đầu [test: apps/workspace-web/src/components/shared/Refreshing.test.tsx » fetching ⇒ thanh chỉ báo + aria-busy, giữ nội dung cũ]
- Kịch bản: chữ dài cắt «…» kèm tooltip [test: apps/workspace-web/src/components/shared/TruncText.test.tsx » chuỗi ⇒ title = đủ chuỗi, có truncate]
- Kịch bản: toast lỗi tự tắt 3 giây, lỗi có nút hành động ở lại [test: packages/web-kit/src/ui/toast.test.ts » lỗi có nút hành động ở lại tới khi bấm (không mất nút sau 3s)]

## Việc còn lại
- Còn ~90 file dùng `className="btn …"` trực tiếp (đã cùng lớp CSS nên cùng cỡ theo `size`; chưa chuyển sang `<Btn>`): chuyển dần khi chạm file; ưu tiên `ClaimBar`, `ReassignBox`, `ApprovalRecord`, `NewRequestPage`, `PartnerHeader`, `ExportButtons` (dùng `btnClass`).
- `PopMenu` `triggerClass` còn chuỗi lớp ở `ExportButtons`, `PartnerHeader` (đổi sang `btnClass`).
- e2e khoá có thể vỡ (chưa chạy, theo Luật 0d.5): selector theo class `.btn`/nút «Lưu» ở Cài đặt cho người không phải chủ (trước: không có nút, nay có nút khoá — `e2e/contracts-web/approval-current.cw.ts`, `e2e/**/settings*`); test chờ chữ «Đang tải…» (nay là nhãn ẩn trong `PaneSkeleton`, vẫn có mặt trong DOM); test đợi toast lỗi còn sau 3 s; `data-testid` giữ nguyên (`request-*`, `rep-save`, `scout-*-save`, `claim-*`).
- Nút `Btn` chưa dùng cho `FeedSettings`/Community/Messages (lát CR-135..137 sẽ dùng khi chạm).
