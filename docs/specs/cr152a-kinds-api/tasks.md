# cr152a-kinds-api — CR-152: hai loại HĐ «Nhượng quyền» + «Thỏa thuận hợp tác» (backend + contract zod, không UI)

id: cr152a-kinds-api · cr: CR-152 · làn: backend · migration: pack-contracts 0112 · phụ thuộc: bản mẫu `docs/specs/cr152-contract-kinds/prototype.json` · lát sau: cr152b (UI)

## Plan
`deal` thêm `franchise`, `cooperation` (CHỈ HĐ kinh tế; giao dịch giữ 3 loại). Trường riêng ở MỘT cột `contracts.kind_terms` (jsonb, RLS như HĐ). Bộ mốc sinh khi HĐ vào DONE (hook `ContractDoneHook`, một insert cho cả chuỗi kỳ, luật thuần). Kỳ doanh thu / đối soát nằm trên mốc (`obligations.period_key`, `period_figure`).

## Làm
| # | Việc | File |
|---|---|---|
| 1 | `CONTRACT_DEALS` 5 loại + `BASIC_CONTRACT_DEALS`; deals/manual dùng 3 loại | `packages/contracts/src/pack-contracts/milestones.ts:9`, `deals.ts:59`, `extract.ts` |
| 2 | «Bắt đầu khi» + manifest + Dify synonyms | `hub-admin/process-routing.ts:31`, `app-manifest/contracts.manifest.ts:20`, `pack-contracts/approval-flow.ts:70` |
| 3 | Contract trường riêng, kỳ, lỗi, AI | `packages/contracts/src/pack-contracts/kind-terms.ts` |
| 4 | Migration 0112 (CHECK deal, `kind_terms`, `period_key/figure`, HD7 bỏ qua, v2a_deal giữ loại) | `packages/db/migrations-pack-contracts/0112_cr152_contract_kinds.sql` |
| 5 | Luật thuần: chuỗi kỳ, bộ mốc, phí, chia, thiếu trường | `hub-api/.../domain/kind-schedule.rules.ts`, `kind-terms.rules.ts` (+ `kind-schedule.rules.test.ts`, 16 test xanh) |
| 6 | Hook DONE sinh mốc (2 câu SQL cố định) | `adapters/kind-schedule.hook.ts`, đăng ký `extraction.mount.ts` |
| 7 | API GET/PUT kind-terms, PUT periods/:key | `adapters/kind-terms.{repo,routes}.ts`, `application/kind-terms.usecase.ts`, `kind-terms.mount.ts`, `packs.mount.ts` |
| 8 | Review (Lưu): chặn thiếu trường `KIND_TERMS_INCOMPLETE`, hướng theo vai, không mốc mặc định | `domain/review.rules.ts`, `adapters/review.{repo,routes}.ts` |
| 9 | Hợp tác «không chia» loại khỏi doanh thu / business / giá-điểm đối tác | `adapters/kind-filter.sql.ts` (dùng ở `overview.repo.ts`, `business.repo.ts:167`, `partners-data.repo.ts:44,68`) |
| 10 | AI đọc file: `kind_terms` + `unsure` `terms.<khoá>`; AI không tự chốt Mua/Bán cho hai loại mới | `extract.ts` (`ExtractionOutputSchema.kind_terms`, `AiReadSchema.kind_terms`), `domain/extraction.rules.ts`, `application/run-extraction.usecase.ts` |
| 11 | Gia hạn / tạo lại sau từ chối chép `kind_terms` | `adapters/expiring-outcome.repo.ts`, `adapters/submissions.repo.ts` |

## Không làm / Chạm
UI web (cr152b), mẫu quy trình riêng, mẫu Word. Web còn gõ `Record<ContractDeal,…>` ⇒ `bun run typecheck` của `apps/workspace-web` có thể đỏ tới cr152b (chưa kiểm).

## Hợp đồng API cho lát UI (cr152b)
Prefix `/pack/contracts`. Đọc quyền `read`, ghi quyền `write` (như sửa mốc). HĐ không thấy/tenant khác ⇒ 404.
- `GET /contracts/:id/kind-terms` → `KindTermsView {deal, terms, missing[], periods[]}` (`kind-terms.ts` `KindTermsViewSchema`). Không phải hai loại ⇒ 422 `KIND_TERMS_NOT_APPLICABLE`.
- `PUT /contracts/:id/kind-terms` `{terms:{…}}` — khoá của `FranchiseTermsSchema` / `CooperationTermsSchema` (strict; `null` = xoá khoá); chỉ HĐ `draft` (409 `KIND_TERMS_LOCKED`); tự đặt `direction` theo vai (nhận quyền ⇒ purchase).
- `PUT /contracts/:id/periods/:key` `{figure}` (`PeriodRecordSchema`; key `YYYY-MM` | `YYYY-Qn` | `YYYY`) → `Period`. Nhượng quyền: tính phí kỳ = (cố định | % doanh thu) + % quảng cáo, ghi lên mốc thu/trả còn mở; Hợp tác: phần mình/đối tác. Mốc thu/trả kỳ đã xác nhận ⇒ 409 `PERIOD_LOCKED`; kỳ không có mốc báo cáo/đối soát ⇒ 422 `KIND_TERMS_NOT_APPLICABLE`.
- `POST /contracts/:id/review` (Lưu, không nháp) thiếu trường bắt buộc ⇒ 422 `KIND_TERMS_INCOMPLETE` (danh sách thiếu: `GET kind-terms` → `missing`).
- Chi tiết HĐ / ai_read: `ai_read.kind_terms` (gợi ý AI), `ai_read.unsure` chứa `terms.<khoá>` (tô vàng). Mã lỗi: `KIND_ERRORS` (`kind-terms.ts`).

## Quyết định trong lúc làm
- Hai loại chỉ cho `doc_type = contract` (CHECK DB + `deals.ts` giữ 3 loại).
- Trường riêng ở một cột jsonb trên `contracts` (không bảng/clone theo phiên bản); kỳ ghi trên mốc, không bảng kỳ riêng ⇒ mốc chuyển sang v(n+1) (K5) mang theo kỳ.
- Hạn mặc định: báo cáo = cuối kỳ + 5 ngày; thu/trả phí và đối soát = cuối kỳ + 10; phí ban đầu = ngày hiệu lực + 5; nhắc gia hạn = hết hạn − `notice_days` (mặc định 60). Trần 99 kỳ; không có ngày hết hạn ⇒ 12 kỳ đầu.
- Phí quảng cáo % gộp vào số tiền mốc phí của kỳ (một mốc); ký quỹ không sinh mốc.
- Hợp tác có chia: một mốc «Đối soát» mỗi kỳ (ghi số kỳ ⇒ phần mình/đối tác tính khi đọc, không mốc «Chia tiền» riêng).
- HD7 mặc định (một đợt toàn giá trị) bỏ qua hai loại mới; bộ mốc do hook DONE.
- Điểm uy tín: hai loại mới chưa có ô điểm (`rep_cell` null ⇒ không tính) — kể cả Hợp tác có chia. Cần ô thứ 6 + vai đối tác nếu muốn tính điểm (hỏi người dùng).
- q1/q2 mặc định: kế toán bên mình nhập doanh thu kỳ theo số đối tác báo; Thỏa thuận hợp tác chưa có bảng chi phí chung.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/chung-tu.md

#### Yêu cầu: Loại hợp đồng gồm Nhượng quyền và Thỏa thuận hợp tác
`deal` ∈ buy · sell · referral · franchise · cooperation, chỉ cho HĐ kinh tế (giao dịch vẫn 3 loại cơ bản). Dùng được trong «Bắt đầu khi». Hai loại không kho, không bảng sản phẩm.
- Kịch bản: khi chọn loại Nhượng quyền hoặc Hợp tác cho HĐ kinh tế thì lưu được, giao dịch thì không [test: thủ công — test contract chưa thêm, xem Việc còn lại]

### ADDED sht/loai-hd-nhuong-quyen-hop-tac.md

#### Yêu cầu: Bộ mốc tự sinh theo kỳ
Khi HĐ vào DONE: Nhượng quyền sinh thu/trả phí ban đầu, phí định kỳ mỗi kỳ (tháng/quý) tới hết hạn, mốc «Báo cáo doanh thu kỳ» trước mỗi mốc phí khi phí theo % (hoặc có phí quảng cáo), nhắc gia hạn; Hợp tác có chia sinh «Đối soát» mỗi kỳ + nhắc gia hạn; không chia chỉ nhắc gia hạn.
- Kịch bản: khi bên nhượng quyền, theo %, hằng tháng thì có phí ban đầu + báo cáo + phí mỗi tháng + nhắc gia hạn [test: apps/hub-api/src/modules/packs/contracts/domain/kind-schedule.rules.test.ts » bên nhượng quyền, theo %, hằng tháng: phí ban đầu + (báo cáo, phí) mỗi tháng + gia hạn]
- Kịch bản: khi bên nhận quyền thì mình trả và mình báo cáo [test: apps/hub-api/src/modules/packs/contracts/domain/kind-schedule.rules.test.ts » bên nhận quyền: mình trả, mình báo cáo]
- Kịch bản: khi phí cố định theo quý không quảng cáo thì không có mốc báo cáo, số tiền có sẵn [test: apps/hub-api/src/modules/packs/contracts/domain/kind-schedule.rules.test.ts » theo quý, phí cố định không quảng cáo: không có mốc báo cáo, số tiền có sẵn]
- Kịch bản: khi Hợp tác có chia thì đối soát mỗi kỳ và nhắc gia hạn [test: apps/hub-api/src/modules/packs/contracts/domain/kind-schedule.rules.test.ts » có chia: đối soát mỗi kỳ + nhắc gia hạn]
- Kịch bản: khi Hợp tác không chia tiền thì chỉ nhắc gia hạn và không tính doanh thu [test: apps/hub-api/src/modules/packs/contracts/domain/kind-schedule.rules.test.ts » không chia: chỉ nhắc gia hạn, và không tính doanh thu]
- Kịch bản: khi HĐ vào DONE thì mốc được ghi một lần, người được giao khác người tạo vẫn ghi được, tenant khác không thấy [test: thủ công — int `kind-terms.int.test.ts` chưa viết/chưa chạy (xem Việc còn lại)]

#### Yêu cầu: Ghi doanh thu kỳ / đối soát tính ra phí và phần chia
`PUT /contracts/:id/periods/:key {figure}`: nhượng quyền ⇒ phí kỳ = (cố định hoặc % doanh thu) + % quảng cáo làm tròn nửa lên tới đồng, ghi lên mốc thu/trả còn mở; hợp tác ⇒ phần mình theo % và phần đối tác = phần còn lại.
- Kịch bản: khi doanh thu 820.000.000 và phí 5% thì phí kỳ 41.000.000 [test: apps/hub-api/src/modules/packs/contracts/domain/kind-schedule.rules.test.ts » làm tròn nửa lên tới đồng]
- Kịch bản: khi lợi nhuận 500.000.000 và phần mình 60% thì mình 300.000.000, đối tác 200.000.000 [test: apps/hub-api/src/modules/packs/contracts/domain/kind-schedule.rules.test.ts » chia: phần mình + phần đối tác = đúng tổng]
- Kịch bản: khi mốc thu/trả của kỳ đã xác nhận thì ghi lại bị 409 PERIOD_LOCKED [test: thủ công — int `kind-terms.int.test.ts` chưa viết/chưa chạy (xem Việc còn lại)]

#### Yêu cầu: Gửi duyệt đòi đủ trường riêng của loại
Nhượng quyền cần vai, thương hiệu, cách tính phí (+ tỷ lệ/số tiền), kỳ; bên nhượng quyền nước ngoài cần «Đã đăng ký Bộ Công Thương». Hợp tác cần mục tiêu, cách chia (+ phần của mình, kỳ đối soát khi có chia). Lưu nháp không đòi.
- Kịch bản: khi thiếu trường bắt buộc thì danh sách thiếu đúng khoá [test: apps/hub-api/src/modules/packs/contracts/domain/kind-schedule.rules.test.ts » thiếu gì thì báo thiếu đó]

## Việc còn lại
- **Test int chưa viết, chưa chạy evotest** (hết ngân sách 60 lượt): `apps/hub-api/src/modules/packs/contracts/kind-terms.int.test.ts` — (1) người được giao (khác người tạo, N2) GET/PUT/ghi kỳ được, người không thấy HĐ ⇒ 404; (2) chéo tenant ⇒ 404; (3) hook DONE sinh đúng chuỗi mốc, không sinh lần hai, HD7 không sinh đợt thừa; (4) ghi doanh thu ⇒ mốc phí đúng số, `PERIOD_LOCKED` khi mốc phí xong; (5) Hợp tác không chia không vào overview/business; (6) migration 0112 chạy được (CHECK deal/direction, `v2a_deal` giữ loại khi đổi hướng). Lệnh: xem brief (PATH bỏ `Git\usr\bin`, `run-tests.ps1 -Step int -Filter "<file>" -Dirty`).
- Test contract: thêm vào `pack-contracts.test.ts` — `CONTRACT_DEALS` 5 loại, `deals.ts` chỉ 3 loại, `KindTermsPutSchema`/`PeriodKeySchema`.
- Chưa chạy: `bun run openspec:check cr152a-kinds-api`, `check:i18n-terms`, `depcruise:affected`; `bun run typecheck` workspace-web (nghi đỏ do `Record<ContractDeal,…>`: `contract-form/lib/deal.ts:8,15,29`, `partner-match.ts:7`) — sửa trong cr152b.
- Prompt AI chưa dạy `deal` franchise/cooperation + `kind_terms` (`domain/extract-prompt.rules.ts:22`) — thêm khi chạy thử với agent thật; Python `apps/agent-runtime` không chứa pipeline này (pipeline ở TS).
- Điểm uy tín cho hai loại mới (cần ô thứ 6) — chờ người dùng quyết.
- Pre-commit hook của `slice:new` báo `git: 'hook' is not a git command` (môi trường), worktree vẫn tạo được.
