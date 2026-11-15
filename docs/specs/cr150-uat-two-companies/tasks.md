# cr150-uat-two-companies — CR-150 · UAT hợp đồng 2 công ty (demo gửi → evolu nhận)

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
Không thay đổi hành vi (lý do: chỉ thêm dữ liệu mẫu bản test (`seed-demo-partner.ts`, bước `partner` của `seed-demo.sh`), sửa kiểm của seed `demo:org`, tài liệu UAT và e2e; sản phẩm không đổi).

## Plan
Seed bản test để người dùng tự UAT mọi use case hợp đồng giữa tenant `demo` (bên gửi) và `evolu` (đối tác). Ngoại lệ người dùng cho phép: tạo dữ liệu trên evolu, CHỈ THÊM + idempotent.

## Làm
| Việc | File | Trạng thái |
|---|---|---|
| Luật thuần: guard stack, kế hoạch evolu chỉ thêm, 3 quy trình demo, quy trình Nhận HĐ evolu | `tools/scripts/src/seed-demo-partner.data.ts` + `.data.test.ts` (10 test xanh) | xong |
| Script seed (hồ sơ/tính năng/cho phép tìm thấy, người + nhóm UAT evolu, quy trình, dòng đối tác) | `tools/scripts/src/seed-demo-partner.ts` | xong (chưa chạy trên staging) |
| `--partner-only` + mật khẩu `UAT_EVOLU.pw` tự sinh | `deploy/stg-test/seed-demo.sh` | xong |
| Kiểm `--org-only` chịu HĐ mẫu đã bị thao tác | `tools/scripts/src/seed-demo-org.ts` (`touched`) | xong |
| Testcase | `docs/uat/hop-dong-2-cong-ty.md` | xong |
| e2e hành trình 2 công ty | `e2e/journey-approval/cr150-two-companies.spec.ts` | viết, chưa chạy |

## Không làm
Deploy, chạy seed trên staging, sửa code tính năng.

## Test tối thiểu
`bun test tools/scripts/src/seed-demo-partner.data.test.ts` (guard stack; planEvolu chỉ create/add, lần 2 rỗng, không đụng người/nhóm có sẵn, thiếu nhóm gói ⇒ báo không tạo; hình quy trình).

## Quyết định trong lúc làm
- Điều kiện «Bắt đầu khi» của 3 quy trình demo chỉ dùng dữ kiện luôn có (giá trị, phòng người tạo), không dùng `deal` (HĐ tạo bằng SQL mẫu không có cột này). Người duyệt đầu của 4 HĐ mẫu `demo:org` không đổi (≥500tr → A: em.hoang; Mua hàng → B: phuc.do; Kinh doanh → C: binh.tran/demo-owner).
- Quy trình UAT của demo được GHI ĐÈ khi chạy lại (như seed-cr128); quy trình Nhận HĐ của evolu KHÔNG ghi đè, thứ tự quy trình evolu KHÔNG đổi (chỉ cảnh báo nếu có quy trình Nhận HĐ khác đứng trước).
- Mật khẩu người UAT evolu chỉ đặt cho người MỚI tạo; người có sẵn không đụng. Chỉ BẬT `flow_triggers` (không tắt).
- Chọn đối tác: nhóm Pháp chế (`pb-phap-che`, huy.dang) làm; người thêm đối tác vào sổ = `ha.ly` (G3). Ký: «Ký qua» = `upload`, người ký = nhóm `nguoi-ky-hd` (demo) / `uat-nhan-ky` (evolu).

- (fix-review-r3) Seed bật «cho phép tìm thấy» (`directory_listed`) bằng SQL trực tiếp nên KHÔNG ghi audit; rào an toàn chỉ ở stg-test (`partnerGuard` của seed). Không chạy được trên prod/môi trường khác.

## Việc còn lại
1. HĐ mẫu + ca cho 2 loại CR-152 (`franchise`/`cooperation`): enum chưa có trên nhánh này (grep rỗng) — thêm khi CR-152 vào.
2. e2e: spec ở `e2e/journey-approval/` nhưng cần stack cặp d5a→d5b của `e2e/cr127/_cr127-stack.ts` — phải thêm vào `testMatch` của `playwright.cr127.config.ts` (testDir `.` không với tới thư mục khác); selector `partner-status`, `[data-approval=return|reject]`, ô lý do chưa đối chiếu với UI thật. `_cr127-stack.ts` flow Nhận HĐ vẫn thiếu bước Ký (nợ cr146b).
3. Chưa chạy seed trên staging (điều phối): `push.ps1 -Ref <nhánh>` → ssh `~/workspace/sohoptac2-staging`: `bash build.sh && bash up.sh` → `bash seed-demo.sh --org-only` rồi `bash seed-demo.sh --partner-only` (nếu image chưa có file mới: chép `seed-demo-partner.ts`, `seed-demo-partner.data.ts`, `seed-demo-org.ts` vào `./seed-src/`).
4. Chưa chạy trên evotest (script cần admin-api + hub thật; phần thuần đã có unit).
