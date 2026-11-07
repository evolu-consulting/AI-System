---
id: cr123-u8-arrow-drag
lát: cr123-u8-arrow-drag
cr: CR-123
làn: nhanh
migration: không
phụ thuộc: u5 (đã gộp)
---
## Plan (ngắn)
Người dùng báo "không kéo mũi tên sang node khác được". Tái hiện bằng chuột thật trên stack (xem "Quyết định") rồi sửa để người không rành kỹ thuật kéo được.

## Làm
1. Cổng ra to và dễ nắm: chấm 18px (≥ 14px khi thu nhỏ), hover to lên + đổi màu, vùng bắt chuột rộng thêm 10px mỗi phía; viên thuốc đầu ra (Ký xong…/Đúng/Sai) có hover; "Bắt đầu khi" có cổng ra dùng được (kéo tới node đứng riêng ⇒ thành bước đầu tiên).
2. Dây nối đang kéo đi theo chuột (màu chính, nét đậm), bắt dính cổng trong 28px, node dưới con trỏ viền đậm = đích thả được; thả sai luật ⇒ toast lý do (từ u5).
3. Ngăn chi tiết (đè lên canvas) KHÔNG tự mở khi thả node; trong lúc kéo dây ngăn mờ + không bắt chuột để thả được tới node nằm dưới ngăn.
4. Kéo mũi tên tới node đứng riêng nằm chưa sau nguồn ⇒ node tự thành bước mới ngay sau nguồn (`placeAfterSource`) rồi nối (một bước hoàn tác).
5. Thả node không còn xen vào giữa cụm Ký số (gửi + chờ) làm cụm bị tách (`safeDropStep`).
6. e2e hành trình: thả Duyệt đứng riêng → kéo "Ký xong" tới nó → kéo từ nó tới Kết thúc · Đã duyệt → Lưu và áp dụng (`cr123-arrow-drag.spec.ts`); sửa ca đỏ `cr122-editor.spec.ts › 3`.

## Không làm / Chạm
- Không engine / hub-api / migration; không CR-124; không tooling depcruise.

## Test tối thiểu
Unit `lib/u8-arrow-drag.test.ts`; e2e `cr123-arrow-drag.spec.ts` + `cr122-editor.spec.ts` (xanh trên server, 3 pass).

## Quyết định trong lúc làm
- Nguyên nhân (tái hiện bằng chuột thật): (a) ngăn chi tiết đè lên canvas và TỰ MỞ khi thả node ⇒ cổng ra / node đích nằm dưới ngăn, chuột rơi vào ngăn ⇒ không bắt đầu / không thả được dây; (b) canvas tự fit lại (zoom tối thiểu 0.8) mỗi lần thêm node ⇒ nguồn / đích nằm ngoài khung nhìn; (c) cổng ra chỉ 10px khi thu nhỏ, không phản hồi hover; (d) "Bắt đầu khi" không có cổng ra; (e) thả node vào cột của Ký số xen giữa cụm ⇒ cụm tách, mất đầu ra "Ký xong". Kéo từ cổng thường tới node ĐÃ hiển thị vẫn chạy (không phải lỗi kéo của xyflow).
- Ca đỏ `cr122-editor › 3` (đỏ cả trên base): Ký số cần bước duyệt ngay trước ⇒ chèn ở cuối flow (sau Kết thúc) bị chặn và ca không có node Ký số; ca nay có sẵn bước Duyệt và chèn bằng nút "+" trên cạnh đi ra từ Duyệt.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-web.md
#### Yêu cầu: Kéo mũi tên nối bước dễ và không bị che (nguồn: CR-123 FLOW3-FR-04/05 u8)
Cổng ra của bước, đầu ra của Ký số (Ký xong, Từ chối, Hết hạn) và "Bắt đầu khi" kéo được bằng chuột: cổng đủ lớn, hover phản hồi, dây nối đi theo chuột, node dưới con trỏ viền đậm. Ngăn chi tiết không tự mở khi thả node và không che đích khi đang kéo. Kéo tới node đứng riêng nằm chưa sau nguồn thì node thành bước mới ngay sau nguồn. Thả node không xen vào giữa cụm Ký số.
- Kịch bản: khi kéo mũi tên tới node đứng riêng chưa sau nguồn thì node thành bước mới ngay sau nguồn và hết đứng riêng [test: apps/admin-web/src/features/processes/lib/u8-arrow-drag.test.ts » node đứng riêng nằm chưa sau nguồn ⇒ thành bước mới ngay sau nguồn, nối xong hết đứng riêng]
- Kịch bản: khi thả node vào cột của Ký số thì dời ra sau cụm [test: apps/admin-web/src/features/processes/lib/u8-arrow-drag.test.ts » cột của cụm ⇒ dời ra sau cụm, cột ngoài cụm giữ nguyên]
- Kịch bản: khi kéo từ Bắt đầu khi tới node đứng riêng thì node thành bước đầu tiên [test: apps/admin-web/src/features/processes/lib/u8-arrow-drag.test.ts » tới node đứng riêng ⇒ thành bước đầu tiên và hết đứng riêng]
- Kịch bản: khi thả Duyệt, kéo Ký xong tới nó, kéo từ nó tới Kết thúc thì Lưu và áp dụng thành công [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U8 · thả Duyệt đứng riêng, kéo mũi tên 'Ký xong' tới nó, kéo từ nó tới Kết thúc · Đã duyệt, Lưu và áp dụng thành công]

## Việc còn lại
- Thu phóng tự động tới node khi bấm lỗi; tự mở rộng khung canvas khi nhiều node (hiện phải thu nhỏ bằng nút −).