---
id: cr121-c17-editor
lát: cr121-c17-editor
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c, c9, c9b, c11, c15
---
## Plan (ngắn)
Trình sửa quy trình đối chiếu artboard `Tpl-Editor` (đối chiếu `Tpl-Run`), spec R8 + Q1/Q9/Q11. Trọng tâm: (1) quy trình THƯ VIỆN mở từ Công ty › Quy trình = CHỈ XEM + "Sao chép cho công ty này"; (2) bản riêng sửa và LƯU THEO ĐƯỜNG KHE (bẫy c9b); (3) công tắc Sơ đồ/Danh sách dùng chung `view-mode.ts`; (4) 2 mã lỗi mới.

## Làm
- Hub `DefsService.update`: bản riêng của công ty (sao từ thư viện, có `slot_body`, `slot` null theo CHECK) đi `slotDraft` với khe lấy từ def nguồn (`repo.sourceSlotOf`) ⇒ `slot_body` thắng/được dựng lại từ `stages` (fromStages), `stages` biên dịch lại, `slot_body` được GIỮ (trước đây `updateDef` ghi `slot_body = null` ⇒ launch mất bước). Kiểm tham chiếu theo kiểu def thư viện (stage dùng khoá nhóm/tool của khe).
- Trang chỉ-xem `LibraryReadOnlyView` (`processes/components/library/`): "Quy trình dùng chung — chỉ xem." + sơ đồ/danh sách bước + nút "Sao chép cho công ty này" ⇒ `POST clone-for-company` (201 mới / 200 đã có ⇒ mở bản riêng; lần sau nút thành "Mở bản riêng"); lỗi qua `processErrorSpec` ⇒ "Không sao chép được: <lý do>". Vào bằng `/processes/$id?company=<tid>` (link "Mở trang chi tiết" ở ngăn Công ty › Quy trình) hoặc tenant_admin mở thẳng (Hub 404 ⇒ đọc chỉ-xem theo công ty mình).
- Bản riêng mở sửa: dòng "Sao từ thư viện: <gốc> · vN" dưới tên.
- `ViewModeToggle` (một component) thay `ModeToggle` riêng của ngăn c11; dùng `useViewMode` (canvas mặc định).
- Lỗi `NOT_LIBRARY_DEF`, `SLOT_GONE` vào `lib/errors.ts` + i18n vi/en (kể cả `use-flow-assign` dùng `processErrorSpec`).
- Từ c15: đếm "N quy trình" trên bảng Thư viện (`LibraryCount`).

## Không làm / Chạm
Không làm (khác biệt với artboard, ghi dưới): tab "Các bước" riêng cho bản riêng với "Chỉ chạy khi"/bộ đếm n/20/"Thêm bước"/"Xem trước bằng HĐ mẫu"/"Xuất bản vN+1"/"X công ty đang dùng vN" cho BẢN RIÊNG; tab Lượt chạy trên trang chỉ-xem. Packages/flow-canvas không đổi.
Perf: không chạm đường nóng; thêm 1 tra PK (`sourceSlotOf`) mỗi lần lưu bản riêng; trang chỉ-xem đọc 1 lần `process-library/:id`.

## Test tối thiểu
- unit: `lib/errors.test.ts » CR-121 c17 · mã lỗi Sao chép…`.
- int (evotest, 6/6 xanh): `clone-for-company.int.test.ts » CR-121 c17 · sửa bản riêng lưu theo đường khe`.
- e2e viết, không chạy: `e2e/P-a/pf4/library-readonly-copy.pa.ts`.

## Đối chiếu artboard Tpl-Editor (bằng code; ảnh chụp do điều phối ở UAT)
Khớp: tên + "Loại: …", dòng "Sao từ thư viện: … · vN", chỉ-xem + "Quy trình dùng chung — chỉ xem" + "Sao chép cho công ty này", công tắc Danh sách/Sơ đồ (icon, nhãn khi rê chuột, nhớ lựa chọn, canvas mặc định), thông báo "Đã sao chép và gán cho công ty này" / "Không sao chép được: …".
Khác biệt còn lại (chờ điều phối duyệt/giao lát sau):
1. Bản riêng mở trình sửa chung hiện có (Cấu hình/Lượt chạy, canvas giai đoạn), CHƯA có tab "Các bước" dọc kiểu artboard với vùng "Chỉ chạy khi", bộ đếm "n/20", "Thêm bước" theo loại ứng dụng, "Xem trước bằng HĐ mẫu".
2. Bản riêng chưa có "Xuất bản vN+1", "Sẵn sàng xuất bản", "<Công ty> đang dùng vN" (bản riêng lưu là dùng ngay, không qua xuất bản); trình sửa thư viện của platform (Xuất bản/Gán/Lịch sử/Xem trước đường đi) giữ nguyên.
3. Trang chỉ-xem không có tab "Lượt chạy" (dữ liệu `runs` của API chưa hiển thị).
4. Sửa bản riêng qua canvas giai đoạn: chỉ lưu được dạng tuần tự của khe (song song/If ⇒ 422 `SLOT_SHAPE_UNSUPPORTED`).

## Quyết định trong lúc làm
- Sửa ở Hub (không chỉ web) vì `updateDef` ghi đè `slot_body` bằng null cho bản riêng — đúng bẫy c9b.
- Số lượt evotest: 4 (hai lượt đầu do sai tham số/dữ liệu test: nhóm phòng ban, catalog tool giả) — vượt hạn mức 2.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/trinh-sua-quy-trinh-chi-xem.md
#### Yêu cầu: Quy trình thư viện mở từ Công ty chỉ xem, sao chép thành bản riêng sửa được (CR-121 R8)
Mở quy trình thư viện từ Công ty › Quy trình hiện "Quy trình dùng chung — chỉ xem." với sơ đồ (mặc định) hoặc danh sách bước, không có sửa/Xuất bản, và nút "Sao chép cho công ty này" tạo bản riêng tự gán thay bản cũ; bấm lần hai mở lại cùng bản. Bản riêng ghi "Sao từ thư viện: <gốc> · vN" và lưu theo đường khe (bước được giữ để chạy). Lỗi sao chép nói lý do bằng ngôn ngữ nghiệp vụ.
- Kịch bản: sửa bản riêng rồi lưu thì `slot_body` được dựng lại và giữ, khe vẫn null [test: apps/hub-api/src/modules/processes/library/clone-for-company.int.test.ts » CR-121 c17 · sửa bản riêng lưu theo đường khe]
- Kịch bản: NOT_LIBRARY_DEF và SLOT_GONE có câu riêng [test: apps/admin-web/src/features/processes/lib/errors.test.ts » CR-121 c17 · mã lỗi Sao chép cho công ty này]
- Kịch bản: mặc định canvas, nhớ lựa chọn danh sách, lỗi storage về canvas [test: apps/admin-web/src/features/processes/lib/view-mode.test.ts » mặc định canvas khi chưa lưu, không có kho, hoặc giá trị lạ]
- Kịch bản: chỉ xem ⇒ Sao chép ⇒ bản riêng sửa được ⇒ sao lần hai trả 200 cùng bản [test: thủ công — e2e/P-a/pf4/library-readonly-copy.pa.ts viết, chạy một lần cuối đợt]

## Việc còn lại
- Điều phối: chụp UAT đối chiếu artboard; chạy e2e `library-readonly-copy.pa.ts`; quyết định lát cho 4 khác biệt trên (tab Các bước dọc + Chỉ chạy khi + Xem trước cho bản riêng).