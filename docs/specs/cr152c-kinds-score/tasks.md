# cr152c-kinds-score — CR-152: điểm uy tín cho Nhượng quyền + Hợp tác có chia tiền (gỡ TECH-DEBT #268)

id: cr152c-kinds-score · cr: CR-152 · làn: backend + web Cài đặt/Đối tác · migration: pack-contracts 0113 · phụ thuộc: cr152a (mốc kỳ) · song song: cr152b (không đụng form/chi tiết HĐ)

## Plan
Thêm 3 ô vào V2-E (8 ô): `franchise:franchisee` «Bên nhận quyền» (đối tác khi mình nhượng quyền, `direction = sale`), `franchise:franchisor` «Bên nhượng quyền» (mình nhận quyền, `purchase`), `cooperation:cooperator` «Đối tác hợp tác» (CHỈ khi `split_basis` ∈ profit|revenue; «không chia» ⇒ không ô, không vai). Ô của HĐ = cột sinh sẵn `contracts.rep_cell` (một nguồn cho bảng đối tác, gợi ý, Tổng quan). Nguồn sự kiện = xác nhận mốc kỳ: `m:report` (báo cáo doanh thu / đối soát) và `m:payment` (thu-trả phí); trễ lỗi đối tác trừ `late_per_day`/ngày như ô cũ.

## Làm
| # | Việc | File |
|---|---|---|
| 1 | Migration 0113: `rep_cell_of`, dựng lại `rep_cell`, `partner_role_of` 3 vai mới, nới CHECK (partner_roles/events, ratings, locks, config scope) | `packages/db/migrations-pack-contracts/0113_cr152c_kinds_score.sql` |
| 2 | 8 ô, tiêu chí mặc định `report_on_time` + `fee_on_time` (50/50), `scoreSource` (một luật cho SQL + xem trước MS-impact) | `domain/rep-config.rules.ts`, `domain/obligation-impact.rules.ts` |
| 3 | SQL tính điểm theo tập: `m:report`, `CELL_OF` 8 ô, chi tiết góp điểm; mốc mang `period_key` | `adapters/rep.sql.ts`, `obligation-impact.repo.ts`, `ledger-write.repo.ts` |
| 4 | HD8: hai vai Khách hàng / Nhà cung cấp (`hd8RoleOf`) | `domain/rep-current.rules.ts`, `rep-current.mount.ts` |
| 5 | Contract zod: nhóm/vai/mốc `report` | `packages/contracts/src/pack-contracts/{reputation,partner-roles,obligation-impact}.ts` |
| 6 | UI Cài đặt › Điểm uy tín (+2 nhóm, 3 ô, mốc «Báo cáo / đối soát») + vai mới ở bảng đối tác, i18n vi/en | `settings/lib/rep-types.ts`, `RepPane.tsx`, `CritTab.tsx`, `partners/lib/partner-v2.ts`, `rep3.*.json`, `v2i.*.json` |

## Không làm / Chạm
Form / chi tiết / mẫu HĐ hai loại (cr152b). Bên nhượng quyền (mình nhận quyền): mọi mốc là việc của mình nên chưa có điểm từ mốc, chỉ từ sao / việc ghi tay / tiêu chí tự thêm.

## Quyết định trong lúc làm
- Hợp tác: «Đối soát» do mình ghi (owner `ours`) vẫn tính là việc chung ⇒ nguồn `m:report` cho đối tác (chỉ ô 8); trễ chỉ trừ điểm khi người xác nhận chọn lỗi «đối tác».
- Không có mốc «phần chia» riêng ở Hợp tác (cr152a) ⇒ tiêu chí «Trả phí / phần chia đúng hạn» chưa có dữ liệu thì bị bỏ khỏi điểm (luật có sẵn), điểm = tiêu chí báo cáo / đối soát.
- HD8: vai theo chiều tiền của mốc (`roleOf(direction)`) đã đúng ⇒ chỉ thêm `hd8RoleOf` cho gợi ý / xem trước chuyển engine.
- `rep_cell` dựng lại bằng DROP/ADD COLUMN (PG16 chưa có `SET EXPRESSION`), không backfill dữ liệu cũ.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/doi-tac-uy-tin.md

#### Yêu cầu: Điểm uy tín V2-E có thêm nhóm Nhượng quyền và Hợp tác
Ngoài service/goods/referral, V2-E có nhóm `franchise` «Nhượng quyền» (vai Bên nhận quyền, Bên nhượng quyền) và `cooperation` «Hợp tác» (vai Đối tác hợp tác, CHỈ HĐ có chia tiền; không chia ⇒ không tính như HĐ nguyên tắc). Cài đặt › Điểm uy tín có thêm 3 ô (Tiêu chí · Thời gian · Loại việc, tự thêm ≤ 8 tiêu chí). Tiêu chí mặc định «Báo cáo doanh thu / đối soát đúng hạn», «Trả phí / phần chia đúng hạn». Điểm hiện hành đọc cùng một nguồn cho bảng đối tác, gợi ý và Tổng quan.
- Kịch bản: khi có 8 ô thì mặc định hợp lệ với hai tiêu chí tổng 100 [test: apps/hub-api/src/modules/packs/contracts/domain/rep-kinds.rules.test.ts » 8 ô: 6–7 Nhượng quyền, 8 Hợp tác, mặc định hợp lệ, hai tiêu chí tổng 100]
- Kịch bản: khi HĐ Nhượng quyền hoặc Hợp tác có chia vào DONE thì ô và vai đối tác đúng chiều tiền, không chia thì không ô không vai, tenant khác không thấy [test: apps/hub-api/src/modules/packs/contracts/kinds-score.int.test.ts » Hợp tác có chia: đối soát đúng hạn + trễ lỗi đối tác ⇒ điểm, «không chia» không vai, không ô, tenant khác không thấy]

#### Yêu cầu: Xác nhận mốc kỳ tính điểm đúng hạn hay trễ
Mốc kỳ đã xác nhận là nguồn điểm: báo cáo doanh thu / đối soát ⇒ `m:report`, thu-trả phí ⇒ `m:payment`. Đúng hạn ⇒ 100; trễ lỗi đối tác trừ 2 điểm mỗi ngày; trễ lỗi mình không trừ. Bên nhận quyền: mốc của đối tác; Hợp tác: «Đối soát» do mình ghi vẫn tính cho đối tác; mình báo cáo / mình trả phí (đối tác là bên nhượng quyền) chỉ đếm giao dịch. Hộp xác nhận mốc hiện tiêu chí và điểm trước → sau theo cùng luật.
- Kịch bản: khi báo cáo đúng hạn thì 100, trễ lỗi đối tác thì trừ theo ngày, lỗi mình thì không trừ [test: apps/hub-api/src/modules/packs/contracts/domain/rep-kinds.rules.test.ts » đúng hạn ⇒ điểm việc 100, trễ lỗi đối tác ⇒ trừ 2 điểm/ngày, trễ lỗi mình ⇒ không trừ]
- Kịch bản: khi mốc do đối tác hoặc do mình ghi thì nguồn điểm đúng vai [test: apps/hub-api/src/modules/packs/contracts/domain/rep-kinds.rules.test.ts » Hợp tác: Đối soát do mình ghi vẫn tính cho đối tác (ô 8), mốc không phải mốc kỳ thì không]
- Kịch bản: khi người được giao (khác người tạo) xác nhận báo cáo đúng hạn và phí trễ lỗi đối tác thì Bên nhận quyền được 96, mình nhận quyền thì chưa có điểm [test: apps/hub-api/src/modules/packs/contracts/kinds-score.int.test.ts » Nhượng quyền (mình nhượng quyền): đối tác = Bên nhận quyền, báo cáo đúng hạn + phí trễ lỗi đối tác ⇒ 96, mình nhận quyền ⇒ chưa có điểm]

#### Yêu cầu: HD8 tính hai vai cho hai loại mới
Khi cờ `hd8` (mặc định): bên trả tiền cho mình (bên nhận quyền, đối tác hợp tác chuyển phần chia) tính như Khách hàng; mình trả tiền cho đối tác (bên nhượng quyền) tính như Nhà cung cấp.
- Kịch bản: khi đối tác trả mình thì Khách hàng, mình trả thì Nhà cung cấp [test: apps/hub-api/src/modules/packs/contracts/domain/rep-kinds.rules.test.ts » bên nhận quyền, đối tác hợp tác, bên trả hoa hồng ⇒ Khách hàng, bên nhượng quyền ⇒ Nhà cung cấp]

## Việc còn lại
- E2E Cài đặt › Điểm uy tín 8 ô chưa viết/chạy (chờ e2e cuối đợt, cùng cr152b). Soát UI góc người dùng chưa làm.
- Chưa đo số câu thật của `GET /reputation/partners`: SQL vẫn hai câu cố định (A)+(B), mảng tham số 8 phần tử thay 5 (int kiểm số câu = 2).

## Kết quả kiểm
- Unit: rep-kinds 10 + rep-score/obligation-impact/rep-current/dto-mirror xanh. int evotest: kinds-score + kind-terms 9 pass / 0 fail. `tsc` hub-api, contracts, workspace-web xanh.
