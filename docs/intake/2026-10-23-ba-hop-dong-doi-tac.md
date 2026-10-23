---
id: intake-ba-hd-doi-tac-2026-10-23
title: Intake Đầy đủ — "Sổ Hợp Tác — BA & Đặc tả UI/UX (Hợp đồng · Đối tác)" (2026-10-23, 7 trang)
by: intake-analyst (chỉ đọc)
base: platform/gd0 · gói contracts (H = apps/hub-api/src/modules/packs/contracts, MG = packages/db/migrations-pack-contracts 0001–0047, W = apps/contracts-web/src)
status: chờ người dùng trả lời một lượt (mục Câu hỏi). Chưa sửa spec/code. CR kế tiếp: CR-097. Migration gói kế tiếp: 0048.
not-analysed: UI tweak E1–E5 + app switcher theo quyền (đang làm); contract-flow S1a/S3a (tạm dừng) chỉ xét như xung đột.
---
# Intake — BA "Hợp đồng · Đối tác" (bản 2026-10-23)

Bối cảnh: app đang chạy theo BA v2 (CR-096, `docs/platform/ba-v2/intake.md`, lát V2-A…O đã merge). BA mới **đảo lại** một phần CR-096:
(a) HĐ bắt buộc có văn bản + khoá cứng + chuỗi phiên bản; (b) nhập tay chuyển sang thực thể mới **Giao dịch**; (c) điểm uy tín quay về
kiểu mgmt (= engine HD8 `H/domain/scoring*.rules.ts` đang bị tắt 410), bỏ sao, thêm cờ đỏ + "MỚI · tạm tính".

## Tóm tắt: 47 ý · Đã có 8 · Có một phần 7 · Mâu thuẫn 15 · Mới 13 · Mơ hồ 3 · Ngoài phạm vi 1

## Bảng ý
| R | Trích (BA) | Loại | Đối chiếu (mã / file:dòng) | Ghi chú |
|---|---|---|---|---|
| R1 | "bản ghi tổ chức khác trả 404… thiếu quyền ghi trả 403" | Đã có | RLS `packs.secure_table`; PackGuard read/write/admin; test chéo tenant mỗi bảng (V2-*) | — |
| R2 | "AI chỉ diễn đạt, mọi con số do hệ thống tính sẵn" | Đã có | `H/adapters/assistant.tools.ts` (đọc số đã tính); điểm/sổ tính ở domain | — |
| R3 | Ngoài phạm vi: Trợ lý AI, So sánh giá, đọc văn bản đã ký, nhắc hạn email | Ngoài phạm vi | `assistant.mount.ts`, `price-scout.mount.ts`, `cks/adapters/signed.routes.ts`, HD4 reminders | Đã có, giữ nguyên, không gỡ |
| R4 | "Cấu hình điểm uy tín: chỉ chủ sở hữu được sửa" | Đã có | V2-L: `PUT /reputation/config/*` guard admin = `contracts-owner` | — |
| R5 | "Mở lại HĐ đã khóa… chỉ chủ sở hữu, có ghi log" | Mâu thuẫn | `H/domain/approval-edit.rules.ts:4-5,56-57` D3-13: MỌI người có quyền ghi đổi trường tiền/bên ⇒ tự `reopen` về `needs_review` | Không có thao tác "Mở lại" riêng, không giới hạn owner |
| R6 | Owner thấy mọi HĐ; editor: mình phụ trách + cấp dưới + HĐ chưa giao do mình tải lên; viewer như editor | Đã có | `MG/0009_m1_visibility.sql:60-63` (`sees_all`, `org_owner_ids`, `owner_user_id IS NULL AND created_by = me`) | Chỉ đúng khi tenant ở chế độ `org` (0010: tenant mới mặc định `org`) |
| R7 | "chỉ ghi/sửa trong phạm vi hợp đồng mình được thấy" | Đã có | policy RESTRICTIVE SELECT lọc cả UPDATE/DELETE (0009:2-4) | — |
| R8 | "Hợp đồng luôn có văn bản… Bắt buộc có văn bản (upload)" | Mâu thuẫn | `H/application/create-manual.usecase.ts`, `H/domain/manual.rules.ts:1` (HD-FR-26), CR-096 HD-01 | HĐ nhập tay đang là luồng chính (V2-F) |
| R9 | Giao dịch nhập tay; "liên kết tới một Hợp đồng… (contract_id)… không bắt buộc" | Mới | không có thực thể; gần nhất `cks_lots.purchase_contract_id` (0009:85-89), `partner_events.contract_id` null được (0008:78) | Đề xuất GD-FR-01 MUST |
| R10 | "Cả hai đều sinh nghĩa vụ, chiếu giá/danh mục và sự kiện điểm uy tín" | Có một phần | HĐ: obligations (0008), product-links (products-confirm), partner_events | Phía Giao dịch chưa có; `obligations.contract_id NOT NULL` (0008:21) |
| R11 | "tải lên → AI trích xuất kèm trích dẫn → duyệt" (Chờ duyệt) | Đã có | HD2/V2-G: `upload-contract.usecase.ts`, `run-extraction.usecase.ts`, trường `{value,quote,verified}`, status `needs_review` | — |
| R12 | HD-FR-01 "Xác nhận → confirmed, khóa trường pháp lý" (khóa cứng) | Mâu thuẫn | `approval-edit.rules.ts:50-62`: sau duyệt sửa trường thường = `ok`, trường tiền/bên = `reopen`; V2-F chi tiết vẫn PATCH ô đã đổi | Hiện không có khoá cứng |
| R13 | "status=confirmed" | Mơ hồ | `H/domain/status.rules.ts:4-14` (active/expiring/expired/renewed/terminated) | (a) thêm trạng thái mới; (b) "confirmed" = nhóm `CONFIRMED_STATUSES` + cờ khoá — mặc định (b) |
| R14 | HD-FR-02 "Cập nhật = upload văn bản mới → phiên bản v(n+1), nháp (Chờ duyệt)" | Mới | `MG/0001_init.sql:66-67,107-108` chỉ `kind contract|appendix` + `parent_id` | Đề xuất HD-FR-101 MUST |
| R15 | HD-FR-03 "Xác nhận v2 → v1 superseded, giữ ngày hiệu lực gốc" | Mơ hồ | không có `superseded`; tenure dùng `first_start` (`scoring.rules.ts:74-83`) | Câu 5 |
| R16 | HD-FR-04 "nghĩa vụ v1 open đáo hạn ≥ ngày hiệu lực v2 → cancelled; đã xong giữ; v2 sinh nghĩa vụ từ ngày hiệu lực" | Mới | `obligations_status_ck` đã có `cancelled` (0008:46); không có logic cutover | Đụng kho (`milestone_items`, V2-D) + `service_customers` (V2-H) |
| R17 | UC-01/02 actor editor "Xác nhận (khóa)" — một bước | Mâu thuẫn | HD3 máy 2 cấp `approval-machine.rules.ts`; cờ tenant `approval_on()` (V2-A, tắt cho nitigroup/demo: "Lưu" = active, `review.rules.ts:144`); contract-flow nhiều phòng (0047, S2/S5 đã merge, chưa deploy) | Câu 2 |
| R18 | "Chỉ hiện bản hiện hành; bản superseded ẩn… badge vN nếu >1" | Mới | `list-contracts.usecase.ts`, `W/features/contracts-list` | Cần index "bản hiện hành" giữ p95 facets (HD1 R-01) |
| R19 | "Upload hợp đồng (chính). Không có Nhập tay cho Hợp đồng" | Mâu thuẫn | `W/features/contracts-list/pages/ContractsListPage.tsx:2` nút "Thêm thủ công" (V2-F) | — |
| R20 | "Lọc theo loại/danh mục; tìm theo tên, đối tác, số HĐ" | Đã có | HD5 facets `get-facets.usecase.ts`, `list-contracts.usecase.ts`; e2e `hd5-list.cw.ts` | Cột bảng (V2-F) khớp, thiếu badge vN (R18) |
| R21 | Chờ duyệt: form sửa; banner "Chưa xác nhận"; nút "Xác nhận và khóa"; ô AI chưa chắc tô nền + nhãn | Có một phần | tô vàng + nhãn: `W/features/contract-form/components/FieldsGrid.tsx:22-24`, `lib/review-model.ts:72`; nút "Lưu nháp"/"Xác nhận" `contract-review/lib/review.ts:22` | Thiếu banner + nhãn nút mới |
| R22 | Đã khóa: facts grid chỉ đọc + 🔒; banner "Đã xác nhận — đã khóa", "Tải bản cập nhật", link owner "Mở lại…"; phụ trách/nhắc hạn/ghi chú vẫn chỉnh | Có một phần | `contract-review/components/InfoPanel.tsx` (sửa được sau duyệt); `contract-deadline` (nhắc), owner HĐ (M1) | UI chỉ đọc + banner mới |
| R23 | Đã thay thế: banner "Đã thay thế bởi Phiên bản N" + "Mở bản hiện hành"; chỉ đọc | Mới | — | HD-FR-102 |
| R24 | Khối "Phiên bản hợp đồng" v1..vN (đã thay thế/nháp/hiện hành, số, hiệu lực, giá trị, Xem); UC-04 "so sánh" | Mới | — | "so sánh" = diff trường? (mặc định: diff trường pháp lý cạnh nhau) |
| R25 | Panel "Tải bản cập nhật": "phải là văn bản đã ký, không nhập tay" → tạo nháp v(n+1) | Mới | dùng lại pipeline upload/extract (`upload.routes.ts`) | — |
| R26 | Diễn biến: mốc tự sinh; "Ghi việc với đối tác" kể cả khi HĐ đã khóa, gắn contract_id | Đã có | `W/features/contract-milestones`; `POST /partner-events` `ledger.routes.ts:136`, `POST /reputation/jobs` `reputation.routes.ts:84` | Giữ mở khi khoá |
| R27 | Giao dịch = "Lô mua CKS, đơn bán lẻ, nghĩa vụ lẻ" | Mâu thuẫn | CKS ghi ⇒ 410 cho nitigroup/demo (V2-H H5, `0036_v2o_cks_readonly`); CR-096 5.4d bán lẻ = một HĐ bán/tháng nhiều mốc thu | Câu 7 |
| R28 | "Trạng thái: nháp → đã ghi sổ… Nháp: sửa/xoá tự do" | Mới | — | GD-FR-01 |
| R29 | GD-FR-02 "Ghi sổ: sinh nghĩa vụ, cập nhật tồn lô, sự kiện tính điểm" | Mới | dùng lại `applyDelivery` (V2-D), `stock_moves` (V2-B), `partner_events` | Tiền/kho ⇒ làn đầy đủ |
| R30 | Sau ghi sổ: "Mô tả (ghi chú, người giữ, nhãn lô) → sửa trực tiếp" | Mới | — | GD-FR-03 |
| R31 | "Số liệu → tạo điều chỉnh có lý do; tồn kho & điểm tính lại; bản ghi cũ giữ lại" | Mới | mẫu có sẵn: `stock-reversal.rules.ts`, `partner_event_voids` + lý do (0044) | GD-FR-04 |
| R32 | "Huỷ… hoàn tồn/hoàn nghĩa vụ; không xoá hẳn — huỷ là ghi thêm một sự kiện huỷ" | Mới | — | GD-FR-05; khác V2-M (xoá HĐ hẳn) — xem Câu 8 |
| R33 | "Điểm… 0–100 cho mỗi vai trò (khách hàng / nhà cung cấp)" | Mâu thuẫn | live V2-E: đối tác × 3 vai (thêm `commission_payer`) × nhóm SP, `rep-config.rules.ts` 5 ô; HD8 2 vai (`scoring-config.rules.ts`) đang 410 | Câu 3 |
| R34 | "engine.score(events, config, today) thuần… trung bình theo trọng số… chuẩn hoá lại khi tắt bớt" | Mâu thuẫn | đúng nguyên văn HD8 `scoring.rules.ts:160-193` (đang tắt, parity test HD8 đã gỡ ở V2-E); live V2-E `rep-score.rules.ts` công thức khác | Đảo CR-096 C1 |
| R35 | "ngoài window_months bỏ; trong recency_months nhân recency_boost (×2)" | Mâu thuẫn | HD8 `scoring-config.rules.ts:17-18,43-44` ✓; live V2-E bậc thang 100/50/20% | — |
| R36 | "Dưới min_events → null" ↔ "đối tác mới… điểm thấp (vd 20) kèm nhãn MỚI · tạm tính" (UT-FR-10/12) | Mơ hồ | HD8 `scoring.rules.ts:171`; `partner-roles.rules.ts:22` `is_new = events < min` ⇒ điểm null | Hai câu BA trái nhau — Câu 4 |
| R37 | "manual_adjust cộng thẳng, kẹp ±10… lý do bắt buộc… ghi log" | Mâu thuẫn | HD7/HD8 có: `ledger.usecase.ts:42-45` (±10 + ghi chú bắt buộc), `scoring.rules.ts:168`; CR-096 C10 bỏ chỉnh tay, V2-E không dùng | — |
| R38 | "Band: ≥ good_from (80) Tốt · ≥ fair_from (60) Khá · còn lại Chú ý" | Mâu thuẫn | HD8 80/60 ✓; live V2-E 85/70 (BA v2 5.1g) | — |
| R39 | Cờ cảnh báo đỏ tách khỏi điểm, hiện bất kể min_events (không giao, gian lận) | Mới | `partner_events_type_ck` (0028:54-56) không có loại nghiêm trọng | UT-FR-13 MUST — Câu 6 |
| R40 | UT-FR-11 "đánh giá = ghi sự kiện" (trả/thu đúng-trễ, giao, giữ/lỡ hẹn, khiếu nại) feed engine | Có một phần | loại sự kiện 0008:88-90 ✓; V2-E thêm `job` + danh mục Loại việc (khác bộ BA) | — |
| R41 | "Không có ô 'cho X sao' chủ quan thay cho điểm tính toán" | Mâu thuẫn | V2-E sao 1–5 trộn s=20% (`score_ratings` 0028, `POST /reputation/ratings`); V2-I tab "Đánh giá & ghi chú"; HD8 tiêu chí `manual` (`scoring.rules.ts:145-154`) | Dữ liệu sao đã nhập của NitiGroup/demo |
| R42 | Tín hiệu ngoài: tra MST → tình trạng, tuổi DN, ngành — ngữ cảnh, không thành điểm | Có một phần | `POST /companies/refresh` `companies.routes.ts:50` (Cục Thuế); "Tìm trên internet" V2-I | Tuổi DN/ngành: cần kiểm có trong bản ghi tra cứu |
| R43 | Lý do một dòng theo mẫu ("Đúng hạn 11/12 đợt", "Gia hạn trễ 6 ngày → 40", "Phải nhắc 5 lần", kept/(kept+postponed+missed), "2 khiếu nại"); score = 100×đúng hạn/tổng − 2×số ngày trễ TB | Mâu thuẫn | HD8 ✓ `scoring.rules.ts:52-71,93-140`; live V2-E lý do/công thức khác | Có sẵn khi quay lại HD8 |
| R44 | 8.3 Hồ sơ: huy hiệu band (xanh/xám/cam/"–") + "MỚI · tạm tính" + cờ đỏ; lý do; sổ sự kiện chỉ thêm + "Chỉnh tay ±10"; link "Cách tính điểm" | Có một phần | `W/features/partners` (V2-I, 3 tab, chạy trên V2-E) | Bố cục đổi theo R33–R41 |
| R45 | 8.4 Cấu hình: tab Khách hàng / Nhà cung cấp; bật/tắt + trọng số, tổng = 100 (khác → 422); good_from, fair_from, min_events, window_months, recency_boost, manual_adjust | Mâu thuẫn | HD8 ✓ `scoring-config.rules.ts:191-205` (tổng 100); live V2-L 5 ô × 3 tab (`W/features/settings`, `rep-config.rules.ts:230`) | — |
| R46 | "Lưu & tính lại → preview 'N khách đổi mức'… lưu tăng version + ghi history" | Có một phần | HD8 `POST /scoring/:role/preview` `partners.routes.ts:114`, `version` (`scoring-config.rules.ts:23`), `score_snapshots` (0015); V2-L "Ảnh hưởng tới đối tác" | History UI chưa có |
| R47 | Mã HD-FR-01…05, GD-FR-02, UT-FR-10 | Mâu thuẫn | HD-FR-01…97 đã dùng (HD1 spec, HD3 31–36, HD5 51–56, HD9 91–97) | Đổi mã: HD-FR-100…104; GD-FR-01…05; UT-FR-10…13 |

## Ảnh hưởng
| R | Spec | Đã qua Gate? | Test khoá | Artboard | Code | Mốc |
|---|---|---|---|---|---|---|
| R5,R12,R13,R17,R21,R22 | HD3 spec, M3-decouple, V2-A/V2-G tasks | HD3 done; V2 không Gate (Luật 0b) | `tests/acceptance/HD3` (8), `HD1` (19, phần sửa sau duyệt), e2e `hd3-flow`, `v2g-review`, `products-confirm` | mock BA (artifact khách) | `approval-edit.rules.ts`, `patch-fields.usecase.ts`, `review.rules.ts`, `approval.usecase.ts`, `W/features/contract-review` | CR-097 đợt 1 |
| R14–R16,R18,R23–R25 | mới `docs/specs/K2-versions/tasks.md` | — | mới; `HD1` list/facets (perf R-01) | mock BA | migration 0049, `upload-contract*`, `list-contracts*`, `ledger*` (cutover), `W/features/contracts-list`, `contract-review` | đợt 1–2 |
| R8,R19 | HD1 (HD-FR-26), V2-F | HD1 done | `HD1` manual, `V2-F` int, e2e `v2f-form/list` | — | `create-manual.usecase.ts`, `contract-new`, `contract-form` | đợt 1 |
| R9,R10,R27–R32 | mới `docs/specs/GD-transactions/tasks.md` | — | mới; `HD9`, `V2-D`, `V2-H` (CKS 410) xét lại | mock BA (thiếu màn Giao dịch) | migration 0050 (`transactions`, dòng, sự kiện; `obligations.contract_id` nullable + `transaction_id`), `applyDelivery`, partner_events | đợt 2 |
| R33–R46 | HD8 spec, V2-E, V2-I, V2-L | HD8 done | `HD8` (6, parity đã gỡ) phải dựng lại; `V2-E` (6) đổi/khoá chỉ đọc; e2e `v2i-partners`, `v2l-settings`, `overview` | mock BA | `scoring*.rules.ts` (bật lại), `rep-*.rules.ts` (đóng băng), `partners.routes.ts` (bỏ 410), `reputation.routes.ts`, `W/features/partners`, `settings`, `overview` (khối đối tác cần xem lại) | đợt 2–3 |
| R39 | mới | — | mới | mock BA | migration 0051 (loại sự kiện nghiêm trọng / `severity`) | đợt 3 |
| R47 | TRACE | — | — | — | `bun run trace` | đợt 1 |
| Dữ liệu khách | niti-import/niti-import2, seed-demo-v2 | — | `tests/acceptance/NITI` | — | backfill `version_no=1`; HĐ nhập tay cũ (`file_id` null); sao đã nhập (`partner_events.rating`, `score_ratings`); `legacy_records` cấu hình mgmt | mọi đợt |

**Dữ liệu thật NitiGroup:** 11 HĐ + sổ của chị Tiên (niti-import, bước 5 "chạy trên máy chủ" — cần xác nhận đã chạy) + phần thêm (niti-import2: CKS, báo giá, lịch sử cấu hình điểm vào `legacy_records`). Mọi migration phải chỉ cộng thêm + backfill rẻ; không đổi điểm hiển thị âm thầm (đổi engine ⇒ điểm khách thấy sẽ khác — cần báo trước).

## Mâu thuẫn với hành vi / quyết định trước
| # | BA mới | Hiện tại / quyết định trước | Mặc định đề xuất |
|---|---|---|---|
| X1 | HĐ chỉ từ văn bản (R8, R19) | CR-096 HD-01 + V2-F "Thêm thủ công"; HD-FR-26 | Chặn tạo HĐ nhập tay mới; nút đổi thành "Ghi giao dịch"; HĐ nhập tay cũ giữ, nhãn "Chưa có văn bản" (đã có nguồn 5.9f "Thiếu file"); gắn văn bản sau ⇒ v2 qua luồng duyệt |
| X2 | Khóa cứng sau xác nhận; chỉ owner mở lại có log (R5, R12) | D3-13 `reopen` tự động khi sửa tiền/bên, ai có quyền ghi cũng sửa được trường thường | Chính sách `lock` (đã có sẵn trong `ConfirmedEditPolicy`) cho trường pháp lý; trường vận hành (phụ trách, nhắc hạn, ghi chú, danh mục/nhãn) vẫn sửa; `POST /contracts/:id/reopen` (owner, lý do, `contract_events`) |
| X3 | "Lưu nháp" vs "Xác nhận và khóa" (R17, R21) | tenant tắt duyệt: "Lưu" = `active` ngay (`review.rules.ts:144`); review-ux: "Lưu nháp" khi bật duyệt | Luôn tách: "Lưu nháp" (giữ Chờ duyệt) + "Xác nhận và khóa" (= finalize); tenant bật duyệt ⇒ khoá khi luồng duyệt xong |
| X4 | Không nói tới duyệt nhiều cấp | HD3 2 cấp + contract-flow nhiều phòng (S2/S5 merge, chưa deploy; S1a/S3a dừng) | Giữ contract-flow dừng; nếu sau bật, v(n+1) đi cùng luồng duyệt như v1 |
| X5 | Giao dịch không xoá, huỷ = sự kiện | V2-M + products-confirm: xoá HĐ hẳn (owner) | Giữ xoá HĐ cho HĐ một phiên bản; trong chuỗi chỉ xoá được bản nháp mới nhất (= bỏ bản cập nhật); bản đã xác nhận trong chuỗi ⇒ 409 |
| X6 | Uy tín kiểu mgmt (R33–R46) | CR-096 C1: thay HD8 bằng V2-E; C10: bỏ chỉnh tay; V2-I sao | Bật lại engine HD8 làm điểm hiện hành; V2-E + `score_ratings` chỉ đọc; sao không còn tính |
| X7 | Lô CKS / đơn bán lẻ là Giao dịch (R27) | V2-H: CKS chỉ đọc, "khách đang dùng" chung; 5.4d bán lẻ = HĐ tháng | Giao dịch dùng danh mục SP + kho lô chung (V2-B/D); CKS chỉ là một SP; không mở lại module HD9 |
| X8 | Phiên bản (R14) | Phụ lục (`kind=appendix`, giá phụ lục HD-FR-55), gia hạn = HĐ mới nối tiếp (V2-H) | Ba khái niệm riêng: phụ lục giữ; gia hạn giữ là HĐ mới; phiên bản = văn bản ký lại thay toàn bộ |

## Rủi ro
- Đảo hai quyết định vừa làm xong (C1 uy tín, HD-01 nhập tay) ⇒ bỏ phần V2-E/V2-I/V2-L đã đầu tư; demo seed v2 có sao/điểm v2 phải nạp lại.
- Điểm khách NitiGroup thấy sẽ đổi khi đổi engine + bỏ sao — cần preview "N đổi mức" trước khi bật.
- Cutover trong cùng tx với xác nhận v2 (và finalize của luồng duyệt / gắn SP products-confirm): khoá HĐ → mốc → thành phần; mốc giao đã giao một phần + `service_customers` + điểm đã chốt (`score_locks`) dễ lệch.
- RLS chuỗi phiên bản: v2 do editor khác tải lên phải kế thừa `owner_user_id` của v1, nếu không editor mất thấy bản hiện hành; `visible_party_keys` chỉ lấy HĐ đã duyệt (0016 A-2) phải coi bản superseded.
- Danh sách lọc "bản hiện hành" phải giữ ngưỡng facets p95 ≤ 50 ms (HD1 R-01) — cần cột/partial index, không subquery theo hàng.
- Test khoá churn lớn: HD1, HD3, HD8 (dựng lại), V2-E, V2-F, V2-I, V2-L + e2e tương ứng; qc relock.
- Xung đột merge với việc đang chạy (E1–E5, app switcher) và nhánh dừng `slice/cf-s1a`, `cf-s3a` (cùng chạm `approval.usecase.ts`, `contract-review`).

## Kế hoạch lát đề xuất (Luật 0b; migration giao trước)
| Đợt | Lát | Làn | Phạm vi | Phụ thuộc | Migration |
|---|---|---|---|---|---|
| 1 | K1 Khóa + mở lại | đầy đủ (Opus: quyền, audit) | R5, R12, R13, R17, X2, X3; R47 đổi mã | — | 0048 `locked_at/locked_by`, sự kiện reopen |
| 1 | K2 Chuỗi phiên bản + cutover | đầy đủ (Opus: tiền/kho, RLS) | R14–R16, R18 (API), X5, X8; perf danh sách | K1 | 0049 `root_id, version_no, supersedes_id, superseded_at` + backfill v1 + index bản hiện hành |
| 1 | K3 UI HĐ | nhanh (Sonnet) | R18–R25, X1 (bỏ "Thêm thủ công"), e2e viết | K1, K2 API | — |
| 2 | G1 Giao dịch backend | đầy đủ (Opus: tiền/kho) | R9, R10, R27–R32 | K1 | 0050 `transactions`, `transaction_lines`, `transaction_events` (chỉ thêm); `obligations.transaction_id`, `contract_id` nullable + CHECK một trong hai |
| 2 | G2 Giao dịch UI | nhanh | màn Giao dịch (danh sách, form, ghi sổ, điều chỉnh có lý do, huỷ), liên kết HĐ | G1 | — |
| 2 | U1 Uy tín theo BA | đầy đủ (perf đường nóng, thay test) | R33–R38, R40, R41, R43, X6; bật lại HD8, V2-E chỉ đọc, test bảng engine | — | — |
| 3 | U2 Cờ đỏ + MỚI tạm tính | đầy đủ (bảng/loại mới) | R36, R39 | U1 | 0051 |
| 3 | U3 UI Đối tác + Cấu hình | nhanh | R44–R46, overview "đối tác cần xem lại" | U1, U2 | — |
| 3 | D1 Dữ liệu NitiGroup + demo | đầy đủ (dữ liệu khách) | backfill, nhãn HĐ thiếu văn bản, nạp lại demo, preview đổi mức trước bật | K2, U1 | — |
Cuối đợt 3: review + security gộp, e2e + `test:all` + UAT một lần. Đường găng K1 → K2 → K3; G1 ∥ U1.

## CR đề xuất
| CR | R | Tóm tắt thay đổi | Tài liệu cần sửa |
|---|---|---|---|
| CR-097 | R8–R32, R47 | HĐ chỉ từ văn bản, khoá cứng, owner mở lại có log, chuỗi phiên bản + cutover; thực thể Giao dịch (nháp → ghi sổ, điều chỉnh/huỷ có vết) | `CHANGE-REQUESTS.md`, HD1/HD3 spec (D3-13 ⇒ lock, HD-FR-26 ngừng), `specs/K*/G*/tasks.md`, `ROADMAP.md`, `STATE.md`, TRACE |
| CR-097a | R33–R46 | Uy tín quay về engine HD8 (2 vai, 80/60, ×2, ±10), bỏ sao, thêm cờ đỏ + MỚI tạm tính — đảo CR-096 C1/C10 | `platform/ba-v2/intake.md` (ghi chú đảo), HD8/V2-E/V2-I/V2-L tasks, `platform/modules.md` |
| CR-097b | X5 | Xoá HĐ chỉ cho bản không có lịch sử phiên bản đã xác nhận | V2-M, products-confirm tasks |

## Quyết định
2026-10-23: người dùng chốt **cả 10 câu theo mặc định bên dưới**; ghi CR-097 / CR-097a; bắt đầu đợt 1 (K1 → K2 → K3). Không deploy khi người dùng chưa xác nhận.

## Câu hỏi (một lượt)
1. HĐ nhập tay đang có (NitiGroup thật + demo, `file_id` null) và nút "Thêm thủ công" — mặc định: **chặn tạo mới; HĐ cũ giữ nguyên, nhãn "Chưa có văn bản"; gắn văn bản sau = tạo v2 qua Chờ duyệt**; không tự chuyển sang Giao dịch.
2. "Xác nhận và khóa" với duyệt HD3 / contract-flow — mặc định: **tenant tắt duyệt ⇒ editor bấm một lần là khoá; tenant bật duyệt ⇒ khoá khi duyệt xong; contract-flow vẫn dừng**.
3. Uy tín: BA mới = engine mgmt/HD8, trái CR-096 C1 (V2-E đang chạy) — mặc định: **BA mới thắng: bật lại HD8 làm điểm hiện hành, V2-E + sao chỉ đọc (không xoá), vai "bên trả hoa hồng" tính như Khách hàng, bỏ chia theo nhóm SP**.
4. Trái nhau "dưới min_events → null" và "MỚI · tạm tính (vd 20)" — mặc định: **0 sự kiện ⇒ "– · Chưa đủ dữ liệu"; 1…min_events−1 ⇒ engine trả `score: null` + `provisional` (điểm tạm), UI hiện điểm tạm + "MỚI · tạm tính"; ≥ min_events ⇒ điểm thường**.
5. HD-FR-03 "giữ ngày hiệu lực gốc" — mặc định: **v1 giữ nguyên ngày của nó (không ghi đè); "hợp tác từ"/tenure của chuỗi = ngày bắt đầu v1; v2 hiệu lực theo ngày trên văn bản v2**.
6. Cờ đỏ — mặc định: **2 loại sự kiện nghiêm trọng mới (`no_delivery`, `fraud`) do editor ghi có lý do bắt buộc; cờ hiện khi còn sự kiện nghiêm trọng trong window_months; chỉ owner gỡ, có log**.
7. Lô CKS / đơn bán lẻ / nghĩa vụ lẻ khi module CKS đang chỉ đọc — mặc định: **Giao dịch dùng danh mục SP + kho lô chung (CKS là một SP); không mở lại HD9; HĐ bán theo tháng đã có giữ nguyên, bán lẻ mới đi qua Giao dịch**.
8. Xoá HĐ (V2-M) khi có chuỗi phiên bản — mặc định: **xoá được HĐ một phiên bản (như nay); trong chuỗi chỉ xoá bản nháp mới nhất; bản đã xác nhận ⇒ 409**.
9. Phiên bản vs phụ lục vs gia hạn — mặc định: **ba khái niệm riêng; "Tải bản cập nhật" chỉ cho văn bản ký lại thay toàn bộ HĐ**; UC-04 "so sánh" = bảng diff trường pháp lý giữa hai phiên bản.
10. Mã truy vết — mặc định: **HD-FR-100…104 (thay HD-FR-01…05 của BA, tránh trùng), GD-FR-01…05, UT-FR-10…13**; BA thiếu màn Giao dịch ⇒ UI Giao dịch theo khuôn danh sách/form hiện có, không chờ mock.
