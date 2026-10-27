---
id: MS-impact
lát: B3 (backend + UI hộp xác nhận)
cr: CR-101b (Intake 2026-10-27 R18, R19, R34; Câu 11)
làn: đầy đủ (ngưỡng perf, đọc điểm khách)
migration: 0059_ms_impact (journal idx 55, when 1799300000000 — điều phối giao, REP-v3 không dùng): chỉ mục mốc đã xong theo đối tác
phụ thuộc: REP-v3 đã merge (engine hiện hành); DOC-legal đã merge (cùng `todo.repo.ts`)
---
# MS-impact — Xác nhận mốc hiện tác động thật

## Plan (ngắn)
Hộp xác nhận mốc hiện tiêu chí trước → sau và điểm trước → sau do MÁY CHỦ tính (xem trước, không ghi); lưu delta thật trên sự kiện khi xác nhận; dòng thời gian đọc delta thật ("uy tín X: a → b"). Bỏ ước lượng client `points.ts`. Lỗi "Chưa rõ": chưa tính điểm + việc "Xác minh lỗi mốc trễ" vào Cần xử lý sau 3 ngày (Câu 11, theo tiền lệ mock bổ sung).

## Làm
| # | Việc |
|---|---|
| 1 | API `GET /obligations/:id/impact?fault=&actual_on=` — một đối tác × một vai, p95 ≤ 100 ms, không quét toàn bộ đối tác, số câu SQL cố định |
| 2 | Lưu delta thật vào sự kiện khi xác nhận mốc (cột/payload hiện có trước; migration chỉ khi bắt buộc) |
| 3 | Nguồn Cần xử lý "Xác minh lỗi mốc trễ" (hàm riêng trong `todo.repo.ts`, sau DOC-legal/REP-v3) |
| 4 | UI `contract-milestones/components/ConfirmBox.tsx` đọc impact thật; bỏ `lib/points.ts`; dòng thời gian đọc delta |

## Không làm
Đổi engine điểm, đổi luật lỗi trễ (chỉ lỗi đối tác trừ điểm — đã có), biểu đồ đối tác.

## Chạm
`H/application/obligation-impact*` (mới), `obligations` xác nhận (ghi delta), `todo.repo.ts` (hàm mới), `W/features/contract-milestones/**` (ConfirmBox, points, timeline), `locales/contracts/ms.*.json`.

## Test tối thiểu
Unit tính delta từ trạng thái trước/sau; một int preview (không ghi) + xác nhận (delta khớp preview); perf p95 ≤ 100 ms đo thật; test chéo tenant endpoint mới. e2e viết không chạy.

## Quyết định trong lúc làm (2026-10-27)
- **API** `GET /pack/contracts/obligations/:id/impact?fault=partner|ours|unknown&actual_on=YYYY-MM-DD` (guard `read`, strict; tenant khác/HĐ không thấy ⇒ 404; đợt đã xong ⇒ 409 `OBLIGATION_DONE`) ⇒ `{obligation_id, at, late, fault, reputation:{engine, role, party, before{score,level}, after, counted, pending_fault}|null, stock:[{component_id,name,before,after}], debt:{direction,before,after}|null}` (`@ai/contracts` `ObligationImpactSchema`). Không ghi.
- **Không công thức riêng**: dựng đúng phần `settle` sẽ ghi rồi để engine hiện hành chấm lại — V2-E: thêm một việc vào nguồn `m:<loại>`/`tx` của ô `rep_cell` (≡ `rep.sql.ts` ms0) rồi `board`; HD8: `addGroup` dòng `delivered|received|paid` + bớt dòng "Quá hạn" treo của đợt khỏi `pend` (≡ `pendJson`) rồi `partnersOf` (thêm `partners.usecase.editedScore`, tham số `aggs` tuỳ chọn của `partners()`). Luật: `domain/obligation-impact.rules.ts`.
- **Câu SQL**: 5 cố định mỗi engine (múi giờ + đầu đợt một câu [đợt + công nợ mở + quá hạn treo, chỉ mục `obligation_idx`] + engine: V2-E cấu hình + 2 câu lọc MỘT đối tác; HD8 3 câu song song của `partners.one` lọc theo vai) + 2 câu kho khi mốc giao.
- **Perf (đo thật, nền V2-E 1.000 đối tác × 3 vai × 5 mốc, acme + beta)**: V2-E p50 6,6 / p95 19,1 ms; HD8 p50 48,1 / p95 83,1 ms (đạt ≤ 100 ms). HD8 vẫn đọc sổ/HĐ/giá cả tenant theo vai (không lọc đối tác — kiến trúc `partners.one` sẵn có; nợ, xem dưới).
- **Lưu delta**: `partner_events.data.impact = {engine, role, before, after}` cùng câu ghi `settle` (cột có sẵn). Delta tính trong tx xác nhận (xem mục "Sửa" dưới). **Chỉ khi cờ `v2e`**: HD8 đặt trên đường xác nhận phá ngưỡng V2-D (`confirm.perf` p95 ≤ 50 ms, không Seq Scan) ⇒ cờ `hd8` không lưu (dòng thời gian không hiện số; hộp xác nhận vẫn xem trước). Đo lại V2-D confirm (hd8): p95 44,4 / 30,9 ms (trước/sau ANALYZE) — xanh.
- **Sửa (điều phối, sau rebase doc-ui-list)**: delta V2-E tính TRONG tx `settle` (cùng kết nối, tuần tự, sau khoá đợt; đầu mốc lấy từ câu khoá — `lockObligation` thêm `owner`, `rep_cell`): 3 câu (cấu hình + 2 câu chấm lọc một đối tác) bọc `plan_cache_mode = force_generic_plan` (`set_config` cục bộ, bật/tắt quanh đoạn chấm — lập kế hoạch câu gom ~28 ms > chạy ~4 ms). Bản đầu (tx đọc song song ngoài tx xác nhận) mở thêm kết nối ⇒ driver dò `pg_type` + Seq Scan. MG `0059_ms_impact` (idx 55, when 1799300000000): `obligations_party_done_idx (tenant_id, party_key, done_at) WHERE status = 'done'`. V2-D `confirm.perf` (p95 trước/sau ANALYZE, không Seq Scan): `v2e` 66,6 / 59,7 ms đỏ (+ Seq Scan) → 43,5 / 32,5 và 37,8 / 25,0 ms xanh; `hd8` 44,4 / 30,9 → 39,3 / 20,7 ms xanh.
- Lỗi SQL khi chấm delta trong tx ⇒ huỷ cả lệnh xác nhận (tx Postgres đã hỏng, không nuốt được) — chấp nhận: câu đọc theo chỉ mục, cùng văn bản với bảng điểm.
- **Dòng thời gian**: `Milestone.rep_delta` (đọc `data->'impact'` của dòng sổ xong đợt chưa huỷ, sub-select trong `msJson`, chỉ mốc `done`); UI hiện "a → b". Bỏ `lib/points.ts` (ước lượng client) + test của nó.
- **Lỗi "Chưa rõ"**: engine KHÔNG đổi (V2-E coi = 100, không trừ) ⇒ xem trước `pending_fault: true` + câu "chưa trừ điểm; nhắc xác minh sau 3 ngày". Câu 11: nguồn mới `vf` trong `todo.repo.ts` (hàm `verifyFaultSource`, không sửa `lg`): mốc `done`, `fault = 'unknown'`, xong ≥ 3 ngày và ≤ 90 ngày; `kind = verify_fault` (nhãn "Xác minh lỗi mốc trễ"), hạn = ngày xong + 3, khoá `verify_fault:<id>:<ngày xong + 3>`. Xử lý = Bỏ qua/Đã xong (đổi lỗi mốc đã xác nhận: huỷ dòng sổ rồi xác nhận lại — đã có).
- **REP-v3 mục 7** (làm ở đây): khôi phục nguyên văn nguồn "Đánh giá đối tác" V2-K (`rating` sau HĐ, `rating_quarter` sau quý; hàm `ratingSources`) bật theo cờ `v2e` (`TodoWindow.rating`, `overviewUsecase.engine`); thêm loại trừ HĐ NT. Cờ `hd8` ⇒ tắt (ghi sao 410).
- **Phụ DOC-legal**: `contract-review/components/LegalBanner.tsx` (chuỗi `contracts.legal.{title,reason,accountantNote}` có sẵn + ngưỡng) — chỉ cảnh báo.
- Chuỗi mới `locales/contracts/msimpact.{vi,en}.json` (`contracts.msimpact.*`, chèn trước `docframe`, tuple Parts +1); `kind.verify_fault` thêm vào vi/en.json.
- Test: unit `domain/obligation-impact.rules.test.ts`; int `tests/acceptance/MS-impact/impact.int.test.ts` (xem trước không ghi, settle lưu delta = xem trước, bảng điểm = "sau", chi tiết đọc `rep_delta`, 409, 400, chéo tenant 404, Câu 11, rating theo cờ); perf `MS-impact/perf/impact.perf.int.test.ts`; e2e `e2e/contracts-web/ms-impact.cw.ts` (2/2 xanh). Không bảng mới ⇒ không test RLS bảng. Ảnh nền `v2f-detail-confirm-box` sẽ đổi (thêm dòng tác động) — chụp lại ở e2e cuối đợt.

## Việc còn lại
- [x] 1–4 · Câu 11 · REP-v3 mục 7 · banner pháp lý.
- [x] V2-D confirm.perf xanh với cả `hd8` và `v2e` (0059 + chấm trong tx + kế hoạch chung).
- [ ] Chụp lại baseline `v2f-detail-confirm-box` (e2e cuối đợt).
