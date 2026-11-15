# cr151f-list-paging — CR-151 (mọi danh sách người dùng thấy phải tải dần hoặc phân trang, cả API lẫn UI) · lát f

## Plan
Bảng rà soát `docs/specs/cr151-list-paging/audit.md`. Lát này làm phần còn lại của mục 21 (mốc, phiên bản, sự kiện), một phần mục 22 (Lịch sử mua/bán của SP). Không đụng `features/partners/**` (lát cr151e) và `modules/community/**` (lát fix-269). Ngân sách 60 lần gọi công cụ nên làm theo thứ tự giá trị; phần chưa làm ghi ở «Việc còn lại».

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 21b-mốc | Không cắt im lặng: mốc bị chặn ở 200 ngay lúc ghi (`MILESTONES_PER_CONTRACT`, từ chối khi thêm vượt) nên chi tiết luôn trả đủ; không đổi | `milestones.usecase.ts` | [x] (đã đúng sẵn) |
| 21b-sự kiện | Chi tiết chỉ dùng sự kiện để tìm quyết định gần nhất (HeadBanner); danh sách đầy đủ là «Lịch sử thay đổi» đã tải dần ở cr151d. 50 mới nhất đủ dùng, không đổi | `head-banner.ts` | [x] (đã đúng sẵn) |
| 21b-phiên bản | Chuỗi dài hơn 100 bản: chi tiết trả 100 bản MỚI NHẤT (trước đây là 100 bản CŨ NHẤT, mất bản hiện hành); khối «Phiên bản hợp đồng» báo «còn N phiên bản cũ hơn» theo `versions_count` | `contracts.repo.ts`, `ContractBody`, `VersionsPanels`, `VersionsBlock`, `k3b.{vi,en}.json` | [x] |
| 22-lô/bán | `BizDetailOut` thêm `lots_total`, `sales_total`; «Lịch sử mua / bán» báo «Hiện N dòng mới nhất trong tổng M dòng» khi vượt 100 | `business.repo.ts`, `business.{ports,types}.ts`, `business.ts` (contracts), `ProductHistory.tsx`, `{vi,en}.json` | [x] |
| 22 còn lại, 23, 24 (tải dần thật), 25–29 | — | — | [ ] chưa làm |

## Quyết định trong lúc làm
- Mục 21b chọn «N mới nhất + tổng + thông báo» thay vì tách endpoint: mốc đã có trần ghi, sự kiện chỉ phục vụ banner, phiên bản ≤ 100 gần như luôn đủ; tách endpoint chưa đáng chi phí.
- Mục 22 lô/bán chỉ báo còn bao nhiêu dòng (chưa «Xem thêm»): cần endpoint riêng, để lại.
- Mục 24 đã có cờ `truncated` + dòng báo «contracts.work.truncated» (không còn cắt im lặng); chưa tải dần vì gom 8 nguồn.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/chung-tu.md

#### Yêu cầu: Chuỗi phiên bản dài hơn trần vẫn hiện bản mới nhất và báo còn bản cũ
- Kịch bản: khi chuỗi có hơn 100 phiên bản thì chi tiết trả 100 bản mới nhất theo thứ tự tăng dần, tổng số bản là `versions_count`, công ty khác không thấy [test: apps/hub-api/src/modules/packs/contracts/versions-newest.int.test.ts » chuỗi > trần: trả 100 bản mới nhất tăng dần, versions_count là tổng]
- Kịch bản: khi người dùng công ty khác mở chi tiết thì không thấy hợp đồng [test: apps/hub-api/src/modules/packs/contracts/versions-newest.int.test.ts » công ty khác không thấy HĐ]

## Số câu SQL mỗi trang
- Chi tiết HĐ: không thêm câu (chỉ đổi thứ tự trong subquery phiên bản). Chi tiết SP: thêm hai `count(*)` trên CTE có sẵn trong cùng câu.

## Việc còn lại
- Mục 22 còn lại (kho/lô StockPanel, khách dịch vụ, nguồn NCC, giá NCC), mục 23, mục 24 (tải dần thật), 25–29, và các mục Thấp 19 chưa làm (hết ngân sách gọi công cụ).
- Mục 22 lô/bán: Delta sp-va-gia chưa ghi vì chưa có test (kịch bản: vượt 100 dòng ⇒ «Hiện N dòng mới nhất trong tổng M»). QC bổ sung rồi ghi Delta.
- Test UI cho dòng báo (22, 21b) chưa có; int cho `lots_total`/`sales_total` chưa có. Ghi QC.
- e2e chưa chạy.
