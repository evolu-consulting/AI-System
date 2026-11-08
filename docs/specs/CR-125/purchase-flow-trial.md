# CR-125 · thử nghiệm: quy trình MUA HÀNG 11 bước trên engine flow

Ngày 2026-11-08 · lát `cr125-try-purchase-flow` · code thử: `tools/demo/purchase-flow*.ts` · ảnh: `docs/specs/CR-125/shots/purchase-flow/`.
Không sửa code sản phẩm. Dữ liệu hư cấu (công ty `muahang`, 12 người `@demo.local`, 11 nhóm).

## Kết luận ngắn
- **Dựng được: một phần («partly»).** Dòng nào cũng thành «Điền thông tin» (làm) + «Duyệt» (duyệt); Ký số, vòng «Trả lại» về bước trước, duyệt «một-trong-hai» đều có. Engine nhận và **xuất bản** flow 20 bước (UI: Xuất bản, Gán, Sao chép để sửa, mở canvas, Ngang/Dọc).
- **Chạy xong đầu-cuối: CÓ (hai lượt `done`).** Trên stack local (hub thật; chỉ CLI AI, FileBox bản giả): PDF hợp đồng tải lên → AI giả đọc → «Gửi duyệt» → bộ điều phối mở flow → 12 người lần lượt làm/duyệt qua `/me/review-tasks` → Ký số «Ký thử» (Giám đốc «Ký ngay») → nhận hàng → hóa đơn/thanh toán → Kết thúc · Đã duyệt (lượt `01a1bb43-0db5…`, ảnh `10-run-ok-done.png`).
- **Vòng lặp đã chạy:** Giám đốc «Trả lại» ở bước 4 (ngân sách) → quay về form «So sánh giá» + duyệt lại → Giám đốc duyệt → đi tiếp tới hết (lượt `01a1bb43-b4d2…`, ảnh `11-run-loop-done.png`).
- **Lưu ý khi thử:** HĐ mẫu `.md` làm Ký số lỗi `ESIGN_UNSUPPORTED_FILE` (chỉ nhận PDF); ở màn Lượt chạy chỉ hiện «Công cụ gặp lỗi, hãy kiểm tra kết nối» — mã thật chỉ có trong log hub (G12). Đổi sang PDF thì chạy.
- **Điểm vào:** flow chỉ khởi động bằng sự kiện hợp đồng (`contract.submitted` khi người tải bấm «Gửi duyệt»); không có điểm vào «đề xuất mua» độc lập (G2). Việc làm/duyệt hiện ở thẻ HĐ app Hợp đồng (workspace-web), không có hòm việc trong admin-web ⇒ ảnh từng thẻ/hòm việc theo vai chưa chụp (app đó không chạy trong stack này); chỉ có ảnh trang Lượt chạy của admin-web.
- Canvas: 20 ô thành một hàng/cột; ảnh «vừa khung» rất nhỏ, khó đọc (xem 02, 03).

## Bảng ánh xạ (dòng · node · người làm · người duyệt)
Nhóm = mã nhóm (`admin.groups.key`) trong công ty `muahang`. «+ nhóm» = `also_group_keys` (một người của MỘT trong các nhóm là đủ).

| # | Dòng bảng | Node làm (Điền thông tin) | Node duyệt | Ghi chú / lệch so với bảng |
|---|---|---|---|---|
| 1 | Đề xuất nhu cầu mua | form · `nhan-vien-phong-ban` (nội dung, SL, dự toán, tệp) | Duyệt · `truong-bo-phan` | khớp |
| 2 | Tìm NCC, báo giá | form · `mua-hang` (NCC, giá, tệp báo giá) | Duyệt · `truong-mua-hang` | khớp |
| 3 | So sánh giá, đề xuất | form · `mua-hang` (NCC đề xuất, giá, bảng so sánh) | Duyệt · `truong-bo-phan` + `tai-chinh` | **«Trưởng bộ phận + Tài chính» thành một-trong-hai**, không đủ cả hai (G3) |
| 4 | Duyệt ngân sách, phương án | **bỏ form** (hết trần 20 bước) | Duyệt · `giam-doc` (gồm cả người ủy quyền); **Trả lại → quay về bước 3** (`back_to_steps`) | thiếu việc «KTQT/Tài chính trình ngân sách» (G1); từ chối thẳng = kết thúc lượt |
| 5 | Tạo PO | form · `mua-hang` (số PO, giá trị, tệp) | Duyệt · `truong-bo-phan` | khớp |
| 6 | Soạn thảo hợp đồng | form · `phap-che` + `mua-hang` (số HĐ, tệp) | Duyệt · `phap-che` + `ke-toan` + `truong-bo-phan` | **«Pháp chế + Kế toán + Trưởng bộ phận» thành một-trong-ba** (G3) |
| 7 | Phê duyệt và ký HĐ | — | Duyệt · `giam-doc` (người ủy quyền chung nhóm) rồi **Ký số** (`contracts.esign`, 2 stage) | «Ký thử» đã chạy được (cần bật ký số cho công ty, người ký = nhóm Giám đốc id công ty — G11, PDF — G12) |
| 8 | Đặt hàng, nhận hàng, nghiệm thu | form · `mua-hang` + `kho` (ngày nhận, SL, biên bản) | Duyệt · `truong-bo-phan` + `kho` | «Trưởng bộ phận / Quản lý kho» = một-trong-hai: khớp ý bảng |
| 9+10 | Hóa đơn; Đề nghị + duyệt thanh toán | **một form gộp** · `ke-toan` (số HĐơn, số tiền, tệp) | Duyệt · `ke-toan-truong` + `giam-doc` | gộp 2 dòng, «Kế toán trưởng + Người có thẩm quyền» thành một-trong-hai (G1, G3) |
| 11 | Thanh toán, hạch toán, lưu hồ sơ | form · `thu-quy` + `ke-toan` (ngày chi, chứng từ) | **bỏ bước Kế toán trưởng xác nhận** (hết trần) | khác bảng (G1) |
| — | Kết thúc | Kết thúc · Đã duyệt | | Từ chối = `reject_step null` (kết thúc lượt, không node «Từ chối» riêng) |

Cấu hình thật: `tools/demo/purchase-flow-def.ts` (đúng hình `ProcessStageDef` mà canvas lưu). 20 bước = trần cứng.

## Khoảng trống (gap) — mỗi dòng một điều
- **G1. Trần 20 bước/flow (`FLOW_STEPS_MAX`, hằng số trong code, không phải cài đặt).** Bảng cần ~29 (11 làm + ~15 duyệt + Ký số 2 + kết thúc); phải gộp/bỏ 3 việc (xem bảng). `process.stages_max` (mặc định 22, trần 50) nâng được qua API nhưng bị 20 bước chặn lại.
- **G2. Không có điểm khởi động «đề xuất mua».** Trigger chỉ là sự kiện app (`contract.submitted/uploaded/approved/received`, community); không có nút «Bắt đầu quy trình» thủ công cho flow; mua hàng buộc phải bám vào bản ghi hợp đồng.
- **G3. Không có duyệt «đủ cả hai» / song song.** `also_group_keys` = một-trong-các-nhóm; node Duyệt bắt buộc đứng một mình trong bước (`APPROVE_INVALID`) nên không chia nhánh duyệt song song; «A + B» chỉ biểu diễn được bằng 2 node nối tiếp (tốn thêm bước, đụng G1).
- **G4. «Từ chối → quay lại bước trước» không có trên node Duyệt.** `reject_step`/`return_step` chỉ chỉ tới bước SAU; quay lại phải dùng «Trả lại» + `back_to_steps` của cổng cũ — **chạy được qua API** (đã kiểm) nhưng người dùng phải chọn «Trả lại + bước quay về» chứ không phải «Từ chối»; «Từ chối» (reject) kết thúc cả lượt, không quay lại; UI canvas chưa kiểm cách đặt `back_to_steps`.
- **G11. Người ký công ty của node Ký số cần id nhóm CỦA CÔNG TY** (`group:<uuid>`): flow Thư viện không ghi được (Thư viện dùng mã nhóm), nên mẫu Thư viện thiếu người ký (`NO_SIGNER_SELECTED`) và phải chỉnh lại ở bản công ty.
- **G12. Lỗi của node công cụ không nói nguyên nhân:** Ký số với HĐ không phải PDF báo chung «Công cụ gặp lỗi, hãy kiểm tra kết nối rồi chạy thêm một lượt» (mã `ESIGN_UNSUPPORTED_FILE` chỉ ở log hub) ⇒ admin không tự sửa được; đồng thời flow cho đi tới Ký số khi HĐ không ký được, không cảnh báo sớm.
- **G13. Tên bước đánh số theo «bước» engine (1..20) trộn với số dòng bảng** (tên tôi đặt «2 Trưởng mua hàng…» hiện cạnh số bước 4) ⇒ hai hệ số cùng hiện, dễ nhầm.
- **G5. Không có «người được ủy quyền».** Không có ủy quyền theo thời hạn/phạm vi; chỉ cho người đó vào cùng nhóm `giam-doc` (mất vết «ai ủy quyền cho ai», không tắt được theo ngày).
- **G6. Quản trị công ty không thêm được bước «Điền thông tin» (form).** Menu «+ Thêm bước» của công ty chỉ có Duyệt/Nếu/Ký số/Gửi đối tác/Thông báo/Kết thúc (kiểm bằng e2e `cr122-editor`); form chỉ có ở menu «Nâng cao» của quản trị nền tảng ⇒ flow mua hàng phải do nền tảng dựng trong Thư viện rồi công ty «Sao chép để sửa»; quản trị công ty không tự dựng được bước «làm việc».
- **G7. Không có đính kèm nhiều tệp / hồ sơ lưu:** form chỉ có ô `file_ref` (id tệp, một ô một tệp); không có thư mục hồ sơ cho bước 11.
- **G8. Flow Thư viện bị chặn bởi flow mặc định:** «Quy trình HĐ mặc định» (`contract.submitted`, khớp mọi HĐ) đứng trước nên flow mua hàng hiện «Không bao giờ chạy: quy trình phía trên khớp mọi trường hợp»; quản trị phải tắt/sắp thứ tự (không làm trong thử nghiệm này).
- **G9. Canvas 20 ô không đọc được ở «vừa khung»** (chữ nhỏ); không có nhóm/ngăn theo dòng bảng (đếm theo «bước» 1..20 thay vì 1..11).
- **G10. Tạo flow mới trong UI Thư viện bắt đầu từ MẪU** («Dùng mẫu này»), không có nút «Quy trình trống»; bước hàng loạt phải dựng bằng API (xem phần cách làm).

## Cách làm thật sự (trung thực)
- Công ty, nhóm, người: API quản trị (`purchase-flow-setup.ts`). UI quản trị nền tảng: mở mẫu «Duyệt 2 cấp» → Dùng mẫu này → **đổi toàn bộ bước bằng API `PUT /process-defs/:id`** (cùng payload canvas lưu; kéo-thả 20 ô + cấu hình nhóm từng ô qua UI không kịp 75 phút) → Xuất bản (UI) → Gán cho công ty (UI) → quản trị công ty «Sao chép để sửa» (UI) → mở canvas, chụp Ngang/Dọc.
- Mẫu chạy lại: `UAT_PORT_BASE=3800 bun --env-file=.env.local tools/demo/purchase-flow.ts build`. Stack: `tools/hub-dev/src/uat-stack.ts` với `LOGIN_IP_MAX_ATTEMPTS=100000` (giới hạn đăng nhập theo IP chặn kịch bản nhiều người).
- Chạy: `UAT_PORT_BASE=3800 [PATCH_COPY=1] bun --env-file=.env.local tools/demo/purchase-flow-run.ts ok|loop` — áp dụng bản công ty, tắt flow mặc định (G8), bật ký số «Ký thử», đưa 12 người vào vai gói Hợp đồng, rồi tải HĐ + «Gửi duyệt» + từng vai làm/duyệt bằng API hub. Hub phải chạy với `AI_PROVIDER=subscription AI_SUB_CLI_PATH=<CLI giả> ESIGN_PROVIDERS=selfsign HUB_ATTACH_DRIVER=filebox` + FileBox giả (như `e2e/journey-approval/_ja-stack.ts`); stack `uat-stack.ts` mặc định KHÔNG có (tải HĐ báo 503 `FILE_STORAGE_UNAVAILABLE`). Ảnh lượt chạy: `purchase-flow.ts shots <contractId> <tên>`.
- Cái KHÔNG làm đúng yêu cầu: (1) dựng 20 bước bằng payload API, không kéo-thả canvas (xem trên); (2) chạy bằng API hub (đăng nhập từng người, nhưng không qua trình duyệt) vì app Hợp đồng không dựng trong stack ⇒ không có ảnh hòm việc/thẻ theo vai; (3) chưa chạy kiểu «Từ chối» kết thúc lượt (chỉ vòng «Trả lại»); (4) bản công ty phải chỉnh lại bằng `PATCH_COPY=1` (người ký Ký số = id nhóm công ty, G11) — chạy lần đầu có `PATCH_COPY=1`. Còn lại trong DB UAT 3800 (bỏ được): vài bản nháp Thư viện «Quy trình mua hàng …» sinh ra khi thử.
