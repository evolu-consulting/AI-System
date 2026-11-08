---
id: cr123-u15-bool-one-form
lát: cr123-u15-bool-one-form
cr: CR-123
làn: nhanh
migration: không
phụ thuộc: u14 (đã gộp)
---
## Plan (ngắn)
Luật GỐC 1: vế Có/Không của node Nếu có HAI dạng — editor gửi chuỗi "true", validator Hub bị nới nhận "true"/"false", schema tạo def từ chối boolean `true` (400 `invalid_union` ở `conds.N.value`), còn "Bắt đầu khi" gửi boolean thật. Chốt MỘT dạng: **boolean thật** end to end.

## Làm
1. Contracts: `CondSchema.value` = chuỗi | số | **boolean**; `canonicalCondValue` + `.transform`: "true"/"false" của def cũ ở vế `fact` ⇒ boolean khi đọc (đường API/parse); vế `input`/`field` giữ chuỗi. Gỡ nới `ifBoolOk` ở `ifFactIssues`: dữ kiện boolean dùng đúng `condOk` như "Bắt đầu khi" (chuỗi lạ / số / phép thứ tự ⇒ `FLOW_WHEN_INVALID`).
2. Editor: `CondDraft.type` thêm "boolean"; `draftToIf` gửi boolean thật (UI vẫn chọn Có/Không); `ifToDraft` đọc def cũ (chuỗi) thành Có/Không (lưu lại là boolean) — không cần migration.
3. Engine: `compareFact`/`evaluateWhen` so boolean thật (và chuỗi cũ cho cùng kết quả); `step.repo.ifOf` ánh xạ snapshot cũ bằng `canonicalCondValue` khi đọc.
4. Không migration: ánh xạ khi đọc (snapshot / def cũ vẫn chạy); def lưu lại từ editor là boolean.

## Không làm / Chạm
- Không đổi vế `field`/`input`; không đổi dạng giá trị `set` ("true"/"false" chuỗi của field kiểu bool — khái niệm khác: field output, không phải điều kiện).

## Test tối thiểu
Unit: contracts `process-if-bool.test.ts` (schema + validator), `finish.rules.test.ts` (compare), `if-boolean-when.test.ts` (editor, 2 ca mới); int `flow-bool-one-form.int.test.ts` (tạo def qua API với boolean `true` ⇒ 201, lưu boolean, chạy thật rẽ đúng nhánh — evotest xanh); tsc contracts + admin-web + hub-api sạch.

## Quyết định trong lúc làm
- Chuẩn hoá ở schema (`transform`) + `canonicalCondValue` cho đường đọc JSON thô của engine (snapshot) thay vì UPDATE jsonb lồng nhau.
- Chuỗi "true"/"false" ở vế dữ kiện KHÔNG phải boolean (dữ kiện kiểu chuỗi) cũng bị đổi: chấp nhận (không có dữ kiện chuỗi nào nhận "true"/"false" trong manifest).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/flow-web.md
#### Yêu cầu: Vế Có/Không của node Nếu là boolean thật ở mọi nơi (nguồn: CR-123 u15)
Điều kiện trên dữ kiện Có/Không lưu, truyền và so sánh bằng boolean thật (như "Bắt đầu khi"); def cũ lưu chuỗi "true"/"false" được đọc thành boolean; luật lưu chỉ nhận boolean + "là / không là".
- Kịch bản: khi tạo def qua API với vế Có/Không là boolean `true` thì lưu được và chạy rẽ đúng nhánh [test: apps/hub-api/src/modules/processes/triggers/flow-bool-one-form.int.test.ts » tạo def qua API với boolean thật ⇒ 201 và lưu đúng boolean]
- Kịch bản: khi def cũ có chuỗi "true" ở vế dữ kiện thì đọc thành boolean, vế input giữ chuỗi [test: packages/contracts/src/hub-admin/process-if-bool.test.ts » "true"/"false" của def cũ ở vế dữ kiện ⇒ boolean khi đọc, vế input/field giữ chuỗi]
- Kịch bản: khi dữ kiện boolean so với chuỗi lạ, số hoặc phép thứ tự thì luật lưu từ chối [test: packages/contracts/src/hub-admin/process-if-bool.test.ts » chuỗi khác / số / phép thứ tự trên dữ kiện boolean ⇒ FLOW_WHEN_INVALID]
- Kịch bản: khi editor lưu điều kiện Có/Không thì gửi boolean thật [test: apps/admin-web/src/features/processes/lib/if-boolean-when.test.ts » CR-123 u15 · editor phát boolean THẬT (cùng dạng với Bắt đầu khi), đọc lại giữ đúng]
- Kịch bản: khi engine so dữ kiện boolean với boolean thật hoặc chuỗi cũ thì cùng kết quả [test: apps/hub-api/src/modules/processes/domain/runs/finish.rules.test.ts » CR-123 u15 · dữ kiện boolean so với boolean THẬT (và chuỗi cũ 'true'/'false' cho cùng kết quả)]

## Việc còn lại
- Không.