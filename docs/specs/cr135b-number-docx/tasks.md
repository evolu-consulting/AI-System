---
id: cr135b-number-docx
lát: cr135b-number-docx — số HĐ nguyên văn (Q3) + docx làm tệp chính khi không ký số (Q4)
cr: CR-135
làn: nhanh
migration: không
---
## Plan (ngắn)
| # | Việc | File chính |
|---|---|---|
| 1 | Q3: số chứng từ giữ nguyên văn — chỉ NFC + cắt 2 đầu, ≤ 50 ký tự, cấm ký tự điều khiển/xuống dòng; server 422 path `number` khi sai; web bỏ chuẩn hoá/«gợi ý bản cũ»; placeholder «Nhập số hợp đồng» | `packages/contracts/src/pack-contracts/doc-number.ts`, `FieldsGrid.tsx`, `review-model.ts`, `blocker.ts`, `v2f.{vi,en}.json` |
| 2 | Q3: tìm theo số — `searchKey`/`likePattern` đã fold + không đặc biệt hoá «/» ⇒ không đổi code, thêm unit khoá hành vi | `domain/contracts-domain.test.ts` |
| 3 | Q4: MỘT luật `esignRequiresPdf = enabled && configured` (contracts) dùng ở hub (cổng tải lên) và web (lọc khi chọn tệp). Hub: `UploadContractDeps.esignOn` (nối ở `packs.mount.ts` từ `esign.settings` — cùng nguồn với màn Cài đặt/gửi ký) ⇒ ký số bật + tệp không phải PDF ⇒ 422 `ESIGN_NEEDS_PDF` TRƯỚC quota/FileBox/HĐ; ký số tắt ⇒ docx (và ảnh/văn bản) làm tệp chính như cũ; áp cả «Tải bản cập nhật» (cùng use case); `prefill` (HĐ từ bước quy trình) không qua cổng | `upload-contract.usecase.ts`, `upload.mount.ts`, `packs.mount.ts`, `upload.routes.ts`, `esign.ts` |
| 3b | Q4 web: lọc chỉ khi ký số THẬT SỰ bật (có nhà cung cấp), câu báo dẫn tới «Tài liệu kèm»; lỗi 422 từ hub (kể cả tải bản cập nhật) hiện cùng câu | `use-pdf-gate.ts`, `list-upload-error.ts`, `versions.ts`, `vi/en/k3b.*.json` |

## Quyết định trong lúc làm
- «Ký số bật» = `enabled && configured` (không chỉ cờ `enabled`): công ty bật cờ mà máy chủ chưa có nhà cung cấp thì không thể gửi ký (`ESIGN_DISABLED`) nên không ép PDF — đây là nguyên nhân người dùng vẫn gặp «Ký số cần tệp PDF» ở web khi chỉ cờ bật (cũ: web chỉ đọc `enabled`).
- Cổng hub chặn MỌI tệp không phải PDF (khớp luật web cũ «chỉ nhận PDF»), không riêng docx; mã chung `ESIGN_NEEDS_PDF` (422), khoá i18n `contracts.list.upload.esignNeedsPdf` + `contracts.versions.err.esignNeedsPdf`.
- Bước Ký số với HĐ có tệp chính docx (công ty vừa bật ký số sau khi HĐ tạo): giữ chốt chặn có sẵn `ESIGN_UNSUPPORTED_FILE` (422, câu rõ «Chỉ hỗ trợ ký tệp PDF…»; thẻ duyệt đã có hướng dẫn tải bản PDF), không thêm đường mới; không 500.
- Duyệt với tệp chính docx: không đổi — bằng chứng duyệt (CR-127) độc lập với loại tệp chính.
- AI trích xuất: giá trị `number` lưu nguyên như AI trả (không chuẩn hoá phía hub); form xác nhận chỉ NFC + cắt 2 đầu.
- Số cũ đã lưu: không backfill (chưa có khách); số cũ chưa sửa vẫn không bị chặn lưu.
- Bỏ khoá i18n `numberSuggest`/`numberUse` (nút «Dùng» gợi ý chuẩn hoá) — không còn bản chuẩn hoá để gợi ý.

## Test đã chạy
- unit: `packages/contracts/src/pack-contracts/doc-number.test.ts`, `apps/workspace-web/src/features/contract-form/lib/review-model.test.ts`, `apps/hub-api/src/modules/packs/contracts/domain/contracts-domain.test.ts`, `apps/hub-api/src/modules/packs/contracts/application/upload-esign-gate.test.ts` (992 pass trên các thư mục chạm).
- int (evotest): `tests/acceptance/CR-135/docx-esign-number.int.test.ts` (2 pass); hồi quy `tests/acceptance/HD1/upload.int.test.ts` + `patch.int.test.ts` (47 pass).
- tsc: packages/contracts, apps/hub-api, apps/workspace-web: sạch.

## Việc còn lại (cho qc — test khoá cũ liên quan)
- `e2e/contracts-web/v2g-review.cw.ts` dòng 76 + 114: kỳ vọng số đã chuẩn hoá `01-2026-HDMB-PN` (từ AI đọc `01/2026/HĐMB-PN`) ⇒ nay giữ `01/2026/HĐMB-PN`; sửa 2 chỗ (viết lại, chạy cuối đợt).
- Không có int/acceptance cũ nào khẳng định 422 cho số có «/» (đã rà `tests/acceptance`, `apps/**/*.int.test.ts`).
- e2e hành trình (viết, chạy cuối đợt): công ty tắt ký số tải docx → tạo HĐ → gửi duyệt → duyệt bằng ý kiến; công ty bật ký số chọn docx → thấy câu dẫn tới «Tài liệu kèm».

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Số chứng từ không ký tự đặc biệt
Số chứng từ giữ nguyên văn người nhập hoặc AI đọc ra (cho «/», chữ có dấu, khoảng trắng giữa, hoa/thường); chỉ cắt khoảng trắng hai đầu, dựng sẵn Unicode (NFC), tối đa 50 ký tự, không chứa ký tự điều khiển hay xuống dòng. Web không chuẩn hoá khi gõ/dán/AI đọc; server chặn 422 path `number` khi quá dài hoặc có ký tự điều khiển; tìm theo số vẫn khớp dù có «/» hoặc dấu.
- Kịch bản: số «  HĐ/2026/001 » giữ nguyên «HĐ/2026/001», chỉ cắt hai đầu [test: packages/contracts/src/pack-contracts/doc-number.test.ts » giữ nguyên văn]
- Kịch bản: tạo tay / PATCH với số có «/» được nhận; số có xuống dòng hoặc quá 50 ký tự ⇒ lỗi path number [test: packages/contracts/src/pack-contracts/doc-number.test.ts » schema]
- Kịch bản: AI đọc số có «/» và dấu ⇒ form xác nhận điền đúng số đó (chỉ cắt hai đầu) [test: apps/workspace-web/src/features/contract-form/lib/review-model.test.ts » CR-135 Q3]
- Kịch bản: số «HĐ/2026/001» lưu nguyên văn qua PATCH và tìm được bằng «hd/2026/001» [test: tests/acceptance/CR-135/docx-esign-number.int.test.ts » PATCH number]

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Tải hợp đồng lên khi đã bật ký số (nguồn: cr125-ux-s4-contract-card)
Chỉ khi công ty đang ký số (bật VÀ máy chủ có nhà cung cấp) mới bắt tệp chính là PDF — web giữ tệp lại kèm câu dẫn tới «Tài liệu kèm», máy chủ trả 422 `ESIGN_NEEDS_PDF` (cả «Tải bản cập nhật»); công ty không ký số tải Word (docx) làm tệp chính được và đi quy trình duyệt thường với bằng chứng duyệt như mọi HĐ.
- Kịch bản: khi ký số bật và chọn tệp .md thì tệp không đi tiếp và hiện câu cần PDF [test: apps/workspace-web/src/features/contracts-list/lib/pdf-gate.test.ts » ký số bật ⇒ tệp không phải PDF bị giữ lại, PDF đi tiếp]
- Kịch bản: ký số tắt ⇒ tải docx tạo HĐ; ký số bật ⇒ tải docx 422 ESIGN_NEEDS_PDF và không tạo HĐ, tải PDF vẫn được [test: tests/acceptance/CR-135/docx-esign-number.int.test.ts » tắt ký số ⇒ docx 201]
- Kịch bản: luật cổng theo cờ ký số (bật + không PDF chặn; tắt/không cờ/prefill qua) [test: apps/hub-api/src/modules/packs/contracts/application/upload-esign-gate.test.ts » cổng ký số của tải lên]
