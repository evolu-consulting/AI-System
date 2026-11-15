# cr151e-partners-paging — CR-151 mục 4 (danh sách Đối tác phân trang ở máy chủ, cả hai engine)

## Plan
Mục 4 của `docs/specs/cr151-list-paging/audit.md` (người dùng 2026-11-14 «cần làm»). Trước đây `PartnersPage` tải hai danh sách theo vai (HD8) hoặc cả bảng V2-E, ghép vai và cắt trang ở trình duyệt. Nay máy chủ trả MỘT TRANG đã gộp vai, có điểm, cờ đỏ, số HĐ.

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Luật thuần dùng chung máy chủ và web (G1, một nguồn): `ScoreRow`, `badgeOf`, `worstOf`, `flagsOf`, `fromRep`, `partiesOf`, `filterParties`, `sortParties`, `pageParties`, `PartyPageQuerySchema` (limit mặc định 20, trần 200) | `packages/contracts/src/pack-contracts/partner-party.ts` (+ `.test.ts`); web `partner-score.ts` chỉ còn re-export | [x] |
| 2 | `GET /pack/contracts/partners/page?filter&sort&q&limit&offset` ⇒ `{items,total,next_offset}`; điểm lấy từ `repCurrent.scoreRows` (cùng nguồn `supplierScores`/`scoreOf`, đúng cờ `REPUTATION_ENGINE`); số HĐ chỉ cho đối tác trong trang (1 câu, tham số JSON) | `partner-page.routes.ts`, `partner-page.usecase.ts`, `rep-current.mount.ts` (`scoreRows`), `partners.mount.ts`, `partner-roles.{repo,ports,usecase}.ts` (`contractCountsOf`) | [x] |
| 3 | `PartnersPage` gọi máy chủ: `usePartyPage`, tìm gõ trễ 250 ms, lọc vai/CHÚ Ý/cờ đỏ, `Pager` phía máy chủ; bỏ lượt gọi `contract-counts` riêng của trang này | `PartnersPage.tsx`, `use-partner-scores.ts`, `api.ts` | [x] |
| 4 | int 1.000 đối tác × cả hai engine (trang 2, điểm = điểm toàn bộ, sắp theo điểm, trần, N2, chéo tenant, số câu SQL) | `apps/hub-api/src/modules/packs/contracts/partners-page.int.test.ts` | [x] |

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/doi-tac-uy-tin.md

#### Yêu cầu: Danh sách Đối tác phân trang ở máy chủ cho cả hai engine
- Kịch bản: khi xem trang 2 thì ra đúng các đối tác kế tiếp không trùng trang 1, có total và next_offset, người đọc khác người tạo HĐ vẫn thấy [test: apps/hub-api/src/modules/packs/contracts/partners-page.int.test.ts » trang 2 đúng: total, next_offset, không trùng, quá cuối rỗng, người đọc khác người tạo (N2)]
- Kịch bản: khi xem một trang thì điểm từng vai bằng điểm engine tính toàn bộ, ở cả HD8 và V2-E [test: apps/hub-api/src/modules/packs/contracts/partners-page.int.test.ts » điểm trên trang = điểm engine tính toàn bộ (cùng dữ liệu, cùng nguồn)]
- Kịch bản: khi sắp theo điểm thì tăng dần theo điểm thấp nhất các vai và đối tác chưa có điểm ở cuối, lọc vai và cờ đỏ và tìm tên chạy ở máy chủ [test: apps/hub-api/src/modules/packs/contracts/partners-page.int.test.ts » sắp theo điểm tăng dần, chưa có điểm ở cuối, lọc vai và cờ đỏ, tìm tên kèm số HĐ]
- Kịch bản: khi xin limit 201 thì bị từ chối, limit 200 ra đủ 200 dòng [test: apps/hub-api/src/modules/packs/contracts/partners-page.int.test.ts » trần limit=200 ra 200 dòng, limit=201 bị 400 không cắt im lặng, sort và filter lạ bị 400]
- Kịch bản: khi không có quyền đọc gói thì bị từ chối, khi là tenant khác thì không thấy đối tác [test: apps/hub-api/src/modules/packs/contracts/partners-page.int.test.ts » quyền và chéo tenant: không có quyền đọc bị 403, tenant khác không thấy đối tác của tenant A]
- Kịch bản: khi gộp hai vai thì một đối tác là một dòng và cờ đỏ lên đầu [test: packages/contracts/src/pack-contracts/partner-party.test.ts » hai vai gộp một dòng, cờ đỏ trước rồi tên]
- Kịch bản: khi tìm theo tên thì khớp không dấu, không phân biệt hoa thường, mọi từ phải có [test: packages/contracts/src/pack-contracts/partner-party.test.ts » tìm không dấu, không phân biệt hoa thường, mọi từ phải khớp]
- Kịch bản: khi cắt trang thì next_offset rỗng ở trang cuối và quá cuối ra danh sách rỗng [test: packages/contracts/src/pack-contracts/partner-party.test.ts » trang 2, total, next_offset, trang cuối null, quá cuối rỗng]

## Số câu SQL và thời gian mỗi trang (1.000 đối tác, 300 đối tác hai vai, evotest)
| Engine | Số câu SQL / trang (4 truy vấn: trang 1, offset 400, lọc cờ đỏ limit 200, sắp điểm + tìm) | ms |
|---|---|---|
| HD8 | 8, 8, 8, 8 (cố định; gồm `set_config` mỗi giao dịch) | 62, 73, 55, 72 |
| V2-E | 10, 10, 10, 10 | 20, 22, 18, 23 |
Cũ: HD8 = hai lần tải toàn bộ + `contract-counts` toàn tenant (3 yêu cầu), V2-E = tải toàn bộ + `contract-counts`.

## Quyết định trong lúc làm
- Sắp theo điểm, lọc «CHÚ Ý» (mức xấu nhất) và cờ đỏ cần điểm của MỌI đối tác ⇒ engine vẫn chấm cả tenant MỘT lần mỗi yêu cầu (số câu SQL cố định, tính trong bộ nhớ từ các câu gom theo tập), rồi lọc/sắp/cắt trang ở máy chủ và chỉ trả trang. Không chọn `score_locks`: bảng điểm chốt hằng tháng chỉ có ở V2-E, cũ so với điểm hiện hành, sẽ làm điểm trang khác điểm chi tiết/gợi ý (vi phạm G1). Không viết lại engine sang window/CTE (đề xuất audit: «KHÔNG làm lại engine»). Chi phí còn lại: CPU chấm cả tenant mỗi trang (HD8 ≈ 60–70 ms với 1.000 đối tác). Về sau (CR riêng): cache điểm theo tenant (đề xuất 5 của audit).
- Chỉ số HĐ tra theo trang (`contractCountsOf`, `partner_key in (json)`), không còn tải số HĐ cả tenant ở trang này.
- Tìm `q` khớp TÊN đối tác (không dấu, mọi từ); không khớp theo nhãn vai như bản cũ (nhãn vai là chuỗi i18n của trình duyệt) — vai lọc bằng chip.
- Tham số `filter` là MỘT chip (all | vai | watch | flag) đúng như UI hiện có (G2); `sort` có `attention` (mặc định: cờ đỏ rồi tên), `name`, `score_asc`, `score_desc`. UI chưa thêm ô chọn sắp xếp (giữ đơn giản).
- Tổng quan (`PartnersBlock`, `TopPartnersBlock`) và `PartnerDetailPage` giữ `usePartnerRows` (cả danh sách) như cũ.

## Việc còn lại
- e2e CHƯA sửa (khoá, việc của QC): các mock của trang Đối tác phải trả `GET /pack/contracts/partners/page` (`{items,total,next_offset}`, mỗi item = dòng đã gộp vai, `contracts` sẵn): `e2e/contracts-web/v2i-partners.cw.ts`, `rep3-engine.cw.ts`, `gap-d2.cw.ts`, `dataset-partners.ts`. Chip lọc đổi ⇒ gọi lại máy chủ; tìm trễ 250 ms.
- Hộp chọn công ty ở Composer vẫn gọi `listPartners()` đầy đủ; `PartnerDetailPage` vẫn tải cả danh sách chỉ để lấy một dòng (nên có `GET /partners/page?party=` hoặc dùng `/reputation/partner` — để CR riêng).
- Cache điểm theo tenant (đề xuất 5 của audit) nếu số đối tác vượt vài nghìn.
