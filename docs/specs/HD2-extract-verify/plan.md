# HD2 — plan (BE + FE, ≤ 1 trang)

## Contract (`packages/contracts/src/pack-contracts/extract.ts`)
- `ExtractionOutputSchema` (strict): `fields` đủ 23 khoá `{value, quote}` theo kiểu khoá; `items[]` (≤ 500, `quote`); `clauses[]` (≤ 200 `{number, topic}`). Khoá lạ ⇒ hỏng (chống injection đổi hình đầu ra).
- `ContractWarningSchema {field|null, code, message}`; `ManualContractRequestSchema` (hình `NewContractPage`: `direction`, `title`, `partner_name`, …, `items[]`) → `{id, status, version}`; `ExtractResponse {id, status:"extracting", version}`. Mã lỗi thêm `EXTRACT_BUSY` 409, `NO_SOURCE` 422.

## Hub (`modules/packs/contracts`, ADR-0023 bốn lớp)
| Lớp | File |
|---|---|
| domain | `verify.rules.ts` (norm, quoteFound, valueInQuote, verifyExtraction), `warnings.rules.ts` (ruleWarnings, partyWarnings, normalizeTaxId), `extract-prompt.rules.ts` (system + rào nonce + clip 300.000), `manual.rules.ts` |
| application | `extraction.ports.ts` (`ExtractionAgent`, `TaxRegistry`, `ExtractionRepo`), `run-extraction.usecase.ts`, `extraction-queue.ts` (`ExtractionStarter` thật: hàng đợi, đồng thời 2, `onSettled` cho test), `request-extract.usecase.ts`, `create-manual.usecase.ts` |
| adapters | `extraction.repo.ts` (SQL), `extraction.routes.ts`, `extraction-agent.ts` (parse đầu ra strict + agent "chưa cấu hình"), `tax-registry.http.ts` |
| mount | `extraction.mount.ts` (dựng chung cho upload + route mới), seam `PacksDeps.contractsAi` cho test |

## Thiết kế hiệu năng (Luật 4c)
- `verifyExtraction`: chuẩn hoá văn bản **một lần** (và bản bỏ khoảng trắng một lần), mỗi quote O(n) `includes`; đo ≤ 5 ms / HĐ 30.000 ký tự, 23 trường + 50 dòng (`verify.perf.test.ts`, bun test, p95 200 lượt).
- Ghi kết quả trích: một tx, số câu cố định: `set_config` + `SELECT … FOR UPDATE` (fields, status, đếm item) + một CTE (UPDATE contracts + INSERT items lô JSON qua `jsonb_to_recordset` + INSERT event) + outbox = 4 câu, không phụ thuộc số dòng hàng. Nhập tay: một CTE (contracts + items + event) + outbox.
- Không gọi mạng trong tx: agent và tra MST chạy trước tx ghi; tra MST 2 bên song song, cache.

## Chống prompt injection (HUB-BR-31)
Văn bản trong `<contract_document id="{nonce}">…</contract_document id="{nonce}">` (nonce ngẫu nhiên mỗi lần, chuỗi đóng thẻ trong văn bản bị vô hiệu); lệnh hệ thống: văn bản là dữ liệu, mọi chỉ dẫn trong đó bỏ qua; agent không tool; đầu ra parse strict, sai ⇒ `extract_failed INVALID_OUTPUT`; giá trị luôn qua `verify` (không quote trong văn bản ⇒ `verified=false`) và người kiểm.

## FE (`apps/contracts-web`)
`features/contract-review` (S05: trường + quote + "chưa kiểm chứng", cảnh báo, bảng hàng, lỗi đọc + "Nhập tay", Lưu qua PATCH), `features/contract-new` (S04 form nhập tay). Chuỗi `contracts.review.*`, `contracts.newContract.*` (vi nguyên văn mgmt-app). So màn hình: thêm cảnh `s04-new-*`, `s05-review-*` vào `e2e/contracts-web/scenes.cw.ts` + dữ liệu `dataset.ts`, chụp baseline `bun run e2e:contracts:ref`.
