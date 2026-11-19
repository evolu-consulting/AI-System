---
id: qc-cr187-e2e-prep
lát: qc-cr187-e2e-prep
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Chuẩn bị lượt e2e cuối đợt CR-187..192: gắn spec mới vào việc (job) sẵn có, sửa e2e khoá vỡ do spec đổi (ô đăng bài «Viết bài…» CR-191, cột trái Tin nhắn CR-190).

## Làm
- Đăng ký: `e2e/cr190/*.spec.ts` ⇒ việc `cr127` (testMatch); `e2e/cr187/*.spec.ts` ⇒ việc `cr169` (testMatch). Không tạo stack mới.
- Helper mới `e2e/community-web/_composer.ts` (`openComposer`, `openMentionFromBody`).
- Lý do sửa từng file (test sai so với spec mới `docs/specs/CR-187/nghiep-vu.md` + CR-190/191):
  - `cr145-post-mention.cs.ts`: ô soạn là hộp «Viết bài…»; «Nhắc tên» mở bằng gõ «@» trong thân bài (BR-191-8), không còn nút riêng/`.ctype`.
  - `cr186-composer.cm.ts`: bỏ ca «ô dính thu gọn» (không còn `data-compact`); ca 390px đo trong hộp thoại; «Nhắc tên» mở bằng «@».
  - `cr147-feed.cm.ts`: bỏ ca nút thu gọn (`composer-collapse` đã xoá); ca «Nhắc tên» mở bằng «@», không còn nút riêng; mở ô soạn qua hộp thoại.
  - `feed.cm.ts`: mở ô soạn qua hộp thoại; «Chọn người xem»/«Chỉ nhà cung cấp» → ô «Ai thấy bài» + «n/N công ty đối tác thấy bài» (BR-191-6).
  - `cr129-media.cm.ts`, `flows.cs.ts`, `roles.cs.ts`: mở ô soạn qua «Viết bài…» (nút «Cần bán»/«đang có hàng» ở thanh đầu đã bỏ); ô «Hàng hoá» chọn theo `goods-input`.
  - `cr129-mention.cs.ts`: như trên; «Chọn người xem»/«Theo nhóm hàng» → combobox «Ai thấy bài».
  - `cr186-mention-store.cm.ts`, `fix-cr186-ui.cm.ts`: kiểm lại, KHÔNG đổi (nút «Nhắc tên» của bình luận còn; không đụng ô đăng).
  - `cr161/ket-noi-cong-ty.spec.ts`, `cr169/tin-nhan-cong-ty.spec.ts`, `smoke-journey/smoke-journey.smoke.ts`: «Đối tác ▾» (`tab-partner`/`partner-item`) đã bỏ ⇒ nhóm công ty `dir-group-head` ở cột trái (CR-190); `person-row` ⇒ `conv-row`; `conv-company` ⇒ `conv-company-line`.
- Không sửa: dữ liệu giả web (`adapters/mock.ts`) chưa trả `moderate` cho bình luận — là code sản phẩm; e2e cm không có ca bấm «Ẩn bình luận» (chỉ `cr169/binh-luan-cheo-cr191.spec.ts` trên stack thật, máy chủ báo `moderate`).

## Không làm / Chạm
`e2e/**` (+ `tests/.lock`). Không chạy e2e (điều phối chạy cuối đợt).

## Test tối thiểu
`bun run test:lock:verify`; `bunx tsc` phần e2e.

## Quyết định trong lúc làm
- `journey-approval/cr187-members.spec.ts` (và `cr139d-org-tree.spec.ts` cũ) chạy trên công ty `demo` có sẵn, không thuộc config nào ⇒ chạy tay (`DEMO_OWNER_PW`, `CR187_PARTNER_NAME`, `JA_CW_URL`), không đưa vào job.
- `cr189-admin-org-ui.spec.ts` ở gốc `e2e/` ⇒ đã thuộc việc `root` (gom `e2e/*.spec.ts`).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: cập nhật e2e theo spec CR-187..192)

## Việc còn lại
Điều phối chạy các việc ở báo cáo; xem kết quả thật rồi sửa tiếp (các sửa trên viết theo spec/UI, CHƯA chạy).
