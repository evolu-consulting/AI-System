# Luật điện thoại (≤ 640px) và khung chung (CR-180)

Nguồn: cr180-mobile-base, cr180-pages-a, cr180-fix-rest. Luật cho người code: `packages/web-kit/src/ui/kit/RULES.md` (mục Mobile). Kiểm tự động: [mobile-kiem-tu-dong.md](mobile-kiem-tu-dong.md). Trang Đối tác/Sản phẩm/Thông báo/Thành viên/Sơ đồ: [mobile-trang.md](mobile-trang.md). Khung dùng chung ở `apps/workspace-web/src/components/shared/` (`PageHeader`, `FilterBar`, `MetaList`).

## Bốn luật
#### Yêu cầu: Vùng bấm ≥ 44px, chữ ≥ 12px, nút trợ lý không che, không tràn ngang
Ở ≤ 640px mọi nút, link, tab, mục nhóm chuyển, ô chọn, ô nhập, mục menu (cả thanh đầu trang, ô ngày, ô chọn loại HĐ, tab Tin nhắn, CSS Community) cao ≥ 44px (lớp `max-sm:min-h-11` trong Button/Input/Tabs/ToggleGroup/Select); desktop giữ nguyên. Chữ ≥ 12px (thanh điều hướng dưới 12px; số trong badge tròn nhỏ ≥ 11px). Nút trợ lý nổi không che phần tử bấm được; hàng phân trang chừa lề phải. Trang không tràn ngang. Ngoại lệ chỉ ở bảng tên trong `e2e/_kit/mobile-rules.ts` (vd `zoomCanvas` cho sơ đồ).
- Kịch bản: khi render Button/Input/Tabs/ToggleGroup/Select thì có lớp `max-sm:min-h-11` [test: apps/workspace-web/src/components/shared/mobile-kit.test.tsx » cỡ chạm ≥ 44px trên điện thoại]
- Kịch bản: khi mở các màn Sổ Hợp Tác ở 390px thì không có vi phạm vùng bấm/chữ/che [test: e2e/contracts-web/mobile-rules.cw.ts]
- Kịch bản: khi mở Bảng tin, Hồ sơ, Yêu cầu tham gia ở 390px thì không có vi phạm [test: e2e/community-web/mobile-rules.cm.ts]
- Kịch bản: khi danh sách HĐ ở 390px kéo tới cuối thì «Trang sau» không bị nút nổi đè [test: e2e/contracts-web/cr177-w4-fab-safe.cw.ts » phân trang cuối không bị nút nổi đè]

#### Yêu cầu: Nút nổi và lề trang
Mọi vùng cuộn chính chừa đáy `--fab-safe`; lề ngang điện thoại 16px do shell cấp, trang con không lồng lề thêm (xem [nut-noi.md](nut-noi.md)).
- Kịch bản: khi mở trang Thông báo ở điện thoại thì lề trái 16px, không thụt thêm [test: e2e/contracts-web/mobile-rules.cw.ts » Thông báo]

## Khung dùng chung
#### Yêu cầu: Đầu trang dùng chung (`PageHeader`)
Điện thoại: tiêu đề một hàng, nút chính rộng hết bên dưới, nút phụ trong menu «⋯». Desktop: nút phụ + nút chính bên phải tiêu đề.
- Kịch bản: khi có nút phụ thì điện thoại hiện «⋯», desktop hiện nút [test: apps/workspace-web/src/components/shared/mobile-kit.test.tsx » PageHeader]

#### Yêu cầu: Khung bộ lọc dùng chung (`FilterBar`)
Điện thoại: chip một hàng cuộn ngang, bộ lọc nâng cao trong nút «Lọc» mở từ dưới lên. Desktop như cũ.
- Kịch bản: khi có bộ lọc nâng cao thì điện thoại ẩn chúng và hiện nút «Lọc» [test: apps/workspace-web/src/components/shared/mobile-kit.test.tsx » FilterBar]

#### Yêu cầu: Dòng «nhãn: giá trị» (`MetaList`)
Desktop một hàng «A · B · C» không dấu «·» đầu/cuối; điện thoại mỗi mục một dòng (tự thêm «:» sau nhãn, nên nhãn không mang «:» đuôi); mục rỗng bị bỏ.
- Kịch bản: khi có mục rỗng thì bị bỏ và dấu «·» chỉ giữa các mục [test: apps/workspace-web/src/components/shared/mobile-kit.test.tsx » MetaList]

## Trang hợp đồng
#### Yêu cầu: Danh sách, chi tiết, tạo HĐ, Việc của tôi, Tổng quan theo luật mobile
Dùng PageHeader/FilterBar/MetaList; danh sách HĐ ở 390px: Xuất/Thêm giao dịch trong «⋯», chip cuộn ngang, nút xem/xoá trong «⋯» của thẻ. Dòng thông tin chi tiết HĐ không còn «·» lơ lửng; mục «File ký» chỉ hiện khi HĐ có chứng từ (HĐ nguyên tắc chỉ hiện khi đã có tệp).
- Kịch bản: khi HĐ nguyên tắc chưa có tệp thì không có mục «File ký» [test: apps/workspace-web/src/features/contract-review/lib/lead-items.test.ts » showFileItem: HĐ nguyên tắc không có mục File ký trừ khi đã có tệp]
- Kịch bản: khi xem chi tiết HĐ có chứng từ thì dòng thông tin hiện «File ký» [test: e2e/contracts-web/doc-frame.cw.ts » File ký]
- Kịch bản: khi xem danh sách HĐ ở 390px thì 4 luật đạt [test: e2e/contracts-web/mobile-rules.cw.ts » Danh sách HĐ]

## Sửa cùng đợt (nguồn: cr180-fix-rest)
- Chủ sở hữu vào trang công ty từ hồ sơ thì đổi được ảnh bìa. [test: e2e/community-web/cr147b-people.cs.ts » chủ sở hữu đổi ảnh bìa công ty ngay ở trang công ty]
- Hộp xem trước tệp không đổi cỡ lúc tải xong. [test: e2e/cr179/khung-tep-co-dinh.spec.ts » hộp nền đen giữ nguyên kích thước trước và sau khi tải xong]
