# cr152e-seed-samples — CR-152 + CR-150: HĐ mẫu Nhượng quyền / Hợp tác cho UAT (seed stg-test)

id: cr152e-seed-samples · cr: CR-152 · làn: backend (script seed) · phụ thuộc: cr152a-kinds-api, cr152b-kinds-ui, seed-demo-partner

## Plan
Bước mới `kinds` (`seed-demo.sh --kinds-only`, không nằm trong mặc định) tạo 2 HĐ mẫu trên tenant **demo**, nhận diện theo tiêu đề, chạy lại không đôi, chỉ stg-test (guard `partnerGuard`).

## Làm
| # | Việc | File |
|---|---|---|
| 1 | Dữ liệu mẫu + kế hoạch idempotent + guard (luật thuần) | `tools/scripts/src/seed-kind-samples.data.ts` (+ `.data.test.ts`, 10 test) |
| 2 | IO: nháp → PUT kind-terms → tải PDF → Lưu → Gửi duyệt → (HĐ 1) duyệt thay + tải bản đã ký tới DONE | `tools/scripts/src/seed-kind-samples.ts` |
| 3 | Cờ `--kinds-only` | `deploy/stg-test/seed-demo.sh` |
| 4 | Ca UAT K01–K06 | `docs/uat/hop-dong-2-cong-ty.md` §10 |

HĐ 1 «Nhượng quyền Cà Phê Mẫu» (`cuong.le`): franchisor, phí ban đầu 300 triệu, 5% doanh thu/tháng, 3 năm từ ngày 1 tháng sau, DONE ⇒ hook sinh mốc kỳ. HĐ 2 «Thỏa thuận hợp tác Logistics miền Tây» (`dung.pham`): chia 60% lợi nhuận, đối soát quý, dừng ở «đang duyệt»; người duyệt `demo-owner` ≠ người tạo. Đối tác của cả hai = Evolu (đã trong sổ đối tác demo).

## Quyết định trong lúc làm
- **Không phụ thuộc AI đọc** (agent-runtime trên bản test đang `logged_out`): hàng HĐ tạo thẳng với `extract_state='ready'`, `status=draft` (đúng cách `seed-demo-org` «HĐ mẫu» làm), trường HĐ đặt ở bước Lưu (review) qua API; không có bước nào chờ AI.
- Hàng HĐ nháp tạo bằng SQL (đúng tiền lệ «HĐ mẫu» của `seed-demo-org`; `POST /contracts` multipart chạy AI đọc file, không ổn định cho seed); mọi bước sau đi API (kind-terms, files, review, submit, claim/approval, signed-upload). Không ghi thẳng trạng thái.
- Duyệt + ký bằng `demo-owner` (Toàn quyền, «duyệt thay» như `seed-cr113-samples`) thay vì từng người theo quy trình: không phụ thuộc quy trình demo khớp HĐ nào. Bước Bằng chứng: ý kiến + một hàng `hub.attachments` mẫu của chính người duyệt (như cr113).
- Chờ engine chuyển bước: vòng lặp ≤ 12 lần × 400 ms (như cr113 `until`); chưa có tín hiệu sự kiện phù hợp cho script ngoài.
- Đối tác HĐ 2 cũng là Evolu (sổ demo chỉ có Evolu).
- **Chưa chạy trên staging** (điều phối chạy). Chưa kiểm: bước Ký của quy trình demo nhận `signed-upload` từ `demo-owner`; nếu không, script báo rõ «chưa tới DONE» để sửa tiếp.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: dữ liệu seed UAT)

## Kết quả kiểm
- `bun test tools/scripts/src/seed-kind-samples.data.test.ts` → 10 pass.
