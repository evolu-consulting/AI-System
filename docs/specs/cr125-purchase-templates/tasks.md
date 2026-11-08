---
id: cr125-purchase-templates
lát: cr125-purchase-templates
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: cr125-subprocess-engine, cr125-subprocess-ui (chỉ cho mẫu cha «Quy trình mua hàng»; chưa làm)
---
## Plan (ngắn)
Biến «Quy trình mua hàng» (11 dòng, `docs/specs/CR-125/purchase-flow-trial.md`) thành 3 mẫu Thư viện dựng BẰNG UI quản trị nền tảng, công ty sao chép
và chạy thật bằng UI. Sau khi trần bước lên 50 (gd0 5c79d1517) không còn gộp/bỏ dòng: đủ 11 dòng, kể cả bước «Trình ngân sách và phương án» (Tài chính),
«Kế toán trưởng duyệt/xác nhận» và hóa đơn / đề nghị thanh toán tách riêng.
- Phần 1 «Đề xuất → Đặt hàng» (dòng 1–5, 12 bước, Giám đốc «Trả lại» về bước so sánh giá) · Phần 2 «Hợp đồng» (dòng 6–7: soạn → Pháp chế → Kế toán →
  Trưởng bộ phận → Giám đốc/người được ủy quyền → Ký số) · Phần 3 «Nhận hàng → Thanh toán» (dòng 8–11).
- «A + B» = hai bước Duyệt nối tiếp; «Giám đốc hoặc người được ủy quyền» = MỘT nhóm `giam-doc` chứa cả hai; việc làm = bước Điền thông tin (form) có «Tệp đính kèm».
- Nhóm theo MÃ (`group_key`): `nhan-vien-phong-ban, truong-bo-phan, mua-hang, truong-mua-hang, tai-chinh, giam-doc, phap-che, ke-toan, ke-toan-truong, kho, thu-quy`.

## Làm
- `tools/demo/purchase-templates.def.ts` (mô tả 3 Phần) · `purchase-templates.ts` (build = lái trình sửa canvas/danh sách bước ở admin-web: dùng mẫu → thêm bước → tên → nhóm →
  trường form → Trả lại → Lưu → Xuất bản → gán công ty → công ty Sao chép để sửa → (Phần 2) chọn người ký = Giám đốc → Lưu và áp dụng; `export` ghi JSON cho seed;
  `run` = chạy Phần 1–3) · `purchase-templates.run.ts` · `purchase-templates.kit.ts` · `purchase-templates-stack.ts` (stack local: Ký thử + FileBox giả + CLI AI giả + Sổ Hợp Tác).
- Seed: `seed.cr125-config.ts` thêm 10 nhóm vào `TEMPLATE_GROUPS` + thành viên giả (người dùng @demo.local có sẵn của evolu/demo) + 3 mẫu vào `libraryRows()`
  (`processes/library/purchase-templates.ts` + `.data.ts` tự sinh bởi `export`). Công ty fixture đủ nhóm ⇒ `templateReadiness` xanh cả 3 mẫu.
- Sửa sản phẩm nhỏ (admin-web, UI/ánh xạ) vì chặn dựng bằng UI: (1) canvas Thư viện chọn người duyệt/người làm theo MÃ nhóm (`after.group_key`) — trước đó ô chọn chỉ ra id nhóm của
  công ty khác ⇒ lưu 422 `PROCESS_REF_INVALID`, mở mẫu thì mất mã; (2) mẫu Thư viện lưu được node Ký số (bỏ kiểm «tool bật cho công ty» ở máy khách khi không có công ty; Hub vẫn kiểm bằng `libraryRefs`).

## Không làm / Chạm
- Không đụng engine, DLC, migration. Không `slice:merge`. Mẫu cha «Quy trình mua hàng» (3 node «Quy trình con») CHƯA làm — chờ `cr125-subprocess-*` merge (xem Việc còn lại).

## Test tối thiểu
unit: `purchase-templates.test.ts` (4) · `stage-convert.group-key.test.ts` (2) · int: `seed-cr125-config.int.test.ts` (5 xanh, 16 s) · UI thật: `purchase-templates.ts run` (ảnh ở `shots/`).

## Quyết định trong lúc làm
- Phần 2/3 giữ sự kiện «Gửi duyệt hợp đồng» như Phần 1 (UI chưa có «không sự kiện»); công ty chỉ Bật MỘT Phần mỗi lúc (script `selectPhase` tắt Phần khác) — mỗi Phần chạy trên một hợp đồng riêng. Khi có «Quy trình con», Phần 2/3 chỉ chạy dưới mẫu cha.
- Mẫu Thư viện bắt đầu từ «Dùng mẫu này» (Duyệt 2 cấp) rồi xoá hết bước (UI chưa có «quy trình trống» — G10).
- «Bí danh nhóm» (c5b): hiện chỉ có `<app>-admin → <app>-owner` (`mapGroupKey`); mã nhóm mua hàng trùng mã giữa mẫu và công ty ⇒ không cần bí danh. Công ty đặt tên nhóm khác ⇒ bước mở «Chọn người duyệt» (không đoán).
- Bước form chạy bằng API Hub (`POST /review-tasks/:id/form`) trong `run`: thẻ Sổ Hợp Tác chưa vẽ bước form (xem Việc còn lại 1); duyệt / Trả lại / Ký ngay / Gửi duyệt / tải lên đều là UI.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-templates.md
#### Yêu cầu: Thư viện có sẵn 3 mẫu «Quy trình mua hàng» (Phần 1 Đề xuất → Đặt hàng, Phần 2 Hợp đồng, Phần 3 Nhận hàng → Thanh toán)
Seed ghi 3 mẫu đã xuất bản v1 (sự kiện «Gửi duyệt hợp đồng», app Sổ Hợp Tác), đủ 11 dòng của quy trình mua hàng, mỗi mẫu dưới trần bước; người duyệt/người làm theo MÃ nhóm; Phần 1 có «Trả lại» từ bước Giám đốc duyệt ngân sách về bước lập bảng so sánh giá.
- Kịch bản: khi nạp 3 mẫu mua hàng thì mỗi mẫu là FlowDef hợp lệ, đủ dòng 1–11, Phần 1 Trả lại về bước so sánh giá [test: apps/hub-api/src/modules/processes/library/purchase-templates.test.ts » 3 mẫu, mỗi mẫu là FlowDef hợp lệ (parse + sự kiện của app)]
- Kịch bản: khi seed chạy trên công ty fixture (evolu, demo) thì 3 mẫu có trong Thư viện và `templateReadiness` ready, mọi nhóm của mẫu có thành viên [test: tools/scripts/src/seed-cr125-config.int.test.ts » 3 mẫu «Quy trình mua hàng» có trong Thư viện và templateReadiness ready cho công ty demo + evolu (đủ nhóm, có thành viên)]
- Kịch bản: khi công ty sao chép 3 mẫu rồi mỗi vai đăng nhập tải phiếu / duyệt / trả lại / ký thì cả 3 Phần chạy tới «done» [test: thủ công — `UAT_PORT_BASE=3800 bun --env-file=.env.local tools/demo/purchase-templates.ts run`, ảnh docs/specs/cr125-purchase-templates/shots/ (bước form gửi bằng API, xem Việc còn lại 1)]

### MODIFIED engine/flow-def-save.md
#### Yêu cầu: Quản trị nền tảng sửa mẫu Thư viện chọn nhóm duyệt theo mã và lưu được node Ký số
Ở trình sửa của mẫu Thư viện (không có công ty), ô «Ai duyệt» / «Phòng ban duyệt» liệt kê nhóm theo mã (một mã một dòng, bỏ nhóm kỹ thuật) và lưu `after.group_key` (`group_id` rỗng); mở lại thấy đúng mã. Máy khách không kiểm «tool bật cho công ty» với mẫu Thư viện.
- Kịch bản: khi nháp có `groupKey` thì lưu ra `after.group_key` + `group_id: null` và nạp lại giữ mã; flow công ty vẫn lưu `group_id` [test: apps/admin-web/src/features/processes/lib/stage-convert.group-key.test.ts » đặt groupKey ⇒ after.group_key và group_id null, nạp lại giữ mã]
- Kịch bản: khi quản trị nền tảng dựng Phần 2 bằng canvas có node Ký số thì Lưu được (không 422/«tính năng chưa bật cho công ty») [test: thủ công — `purchase-templates.ts build` (REBUILD=1)]

## Việc còn lại
Chặn / khoảng trống (không sửa vì >30 dòng hoặc ngoài phạm vi UI/ánh xạ):
1. **Thẻ hợp đồng của Sổ Hợp Tác không vẽ bước «Điền thông tin» (form).** Hub chiếu mọi bước chờ người thành «review» (`approval-flow-view.rules.ts` `stepOf`, kind form → review) nên người nhóm làm chỉ thấy Duyệt/Trả lại/Từ chối, không có ô nhập và không đính kèm tệp; `platform/flow/ui/FormStep.tsx` có sẵn nhưng thẻ HĐ không dùng FlowPanel. ⇒ quy trình mua hàng KHÔNG chạy trọn bằng UI; `run` gửi form bằng API. Cần: chiếu `kind: "form"` + trường + task `form` ở Hub, và nối FormStep vào thẻ (+ ô tải tệp cho `file_ref`). Đây là việc số 1 để «quy trình mua hàng chạy thật».
2. **Mẫu cha «Quy trình mua hàng» (3 node «Quy trình con»)**: chờ `cr125-subprocess-engine` + `cr125-subprocess-ui` merge, rồi rebase và thêm bằng UI (script: thêm `buildParent()` vào `purchase-templates.ts`). Đến lúc đó Phần 2/3 nên bỏ sự kiện khởi động riêng.
3. **Ký số**: mẫu Thư viện không ghi được người ký công ty (G11) ⇒ công ty phải chọn «Người ký phía công ty» ở bản sao (script chọn nhóm Giám đốc). Khi Phần 2 đi tới Ký số thì chỉ nhận PDF (`ESIGN_UNSUPPORTED_FILE` với .md).
4. **Một sự kiện, nhiều mẫu**: cả 3 Phần khởi động bằng «Gửi duyệt hợp đồng» (G2/G8) ⇒ phải Bật một Phần mỗi lúc; các Phần khác báo «Không bao giờ chạy». Thao tác Bật/Tắt có độ trễ (script chờ API xác nhận đúng một bản Bật).
5. Bí danh nhóm chỉ có `<app>-admin → <app>-owner`; công ty không đặt mã nhóm giống mẫu thì từng bước phải chọn người duyệt tay (không có bảng ánh xạ mã tuỳ ý).
6. Bước «Trả lại» của node Duyệt chỉ đặt được ở «Nâng cao» (hộp đánh dấu theo bước), không kéo cổng trên canvas (cổng «Trả lại» kéo nối chỉ có cho bước DLC).
7. Người dùng @demo.local của fixture chỉ 3 người/công ty ⇒ nhóm mua hàng của `evolu`/`demo` xoay vòng cùng người (đủ cho readiness, không đủ cho chạy nhiều vai — chạy thật dùng công ty `muahang` do script dựng bằng API).
8. Chờ điều phối báo 3 UI đã gộp (gd0 đã có engine): đổi «A + B» của dòng 3, 6, 10 sang duyệt song song `after.parallel {groups, rule}`; Phần 1 khởi động từ form «Đề xuất mua hàng» (`core.start-form` / «Tạo yêu cầu») thay cho tải «Phiếu đề xuất mua» + «Gửi duyệt»; thêm mẫu cha «Quy trình mua hàng» với 3 «Quy trình con». Giữ nối tiếp tới lúc đó.
9. Rebase lên gd0 (5c79d1517 nâng trần 50) làm khi gộp; `dist-pt3800-*` (ảnh dựng web của stack) không commit.
