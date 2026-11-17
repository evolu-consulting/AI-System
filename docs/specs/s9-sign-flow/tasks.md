---
id: s9-sign-flow
lát: s9-sign-flow
cr: CR-181
làn: nhanh
migration: không
phụ thuộc: s6-sign-db, s8-sign-api (phần A)
---
## Plan (ngắn)
Nối «ký trên tài liệu» vào lượt chạy quy trình: `ondoc` (Q1), cổng lượt ký thật (BR-D1), bước Ký `ondoc` (BR-D3/C4, Q6/Q8/Q9), Đạt cần ký đủ (BR-D2/Q3/Q4), Trả lại/Từ chối bỏ bản ký của lượt (Q17/BR-L2), chặn Gửi (BR-T2/C3).

## Làm
- [x] Q1 · `ESIGN_NODE_ONDOC` (`esign-node.ts`), validator lúc lưu không đòi nhà cung cấp (`esign-node.usecase.ts`), nhãn panel + i18n vi/en.
- [x] Lõi: `processes/runs/pack-record-step.ts` (`packRecordStepOf`, 1 câu) + `public.ts`; `FlowAvailability.stagesFor` (`flow-engine.ts`, 2 câu); `ProcessDeps.packBeforePass` + cầu `PackRunsBridge.beforePass`; `gates.service #assertEvidence` ⇒ 409 `SIGN_REQUIRED {files}`; `evidenceCheck.signedOnDoc`.
- [x] Gói: luật thuần `domain/sign-turn.rules.ts` (`signTurnOf`, `ondocStepAt`, `needsOnDoc`, `signBlockOf`, `ondocDone`) + test; cổng gắn muộn `application/sign-flow.hooks.ts`.
- [x] Lắp ráp `packs/packs.sign-doc.ts`: `signFlowOf(db)` ⇒ `turn` thật, `onDocSigned(ctx, contractId, runId)`, kiểm Đạt, chặn Gửi; `companySigners` theo lượt đang mở / quy trình mà Gửi sẽ chọn.
- [x] Tool `contracts-esign-send`: `ondoc` ⇒ không phong bì, `awaiting_ondoc`, ô Bên A đã ký đủ ⇒ bắn `esign.completed` (Q8).
- [x] Q17 · `contract-flow.repo applyQ`: Trả lại/Từ chối ⇒ `voidByRun(engine run)` cùng tx.
- [x] BR-T2/C3 · `submit_block` thêm `sign_no_files`, `sign_missing_fields`; lệnh Gửi ⇒ 422 `SIGN_NOT_READY`.

## Không làm / Chạm
Web màn ký, Hồ sơ duyệt PDF (s10), đối tác ký qua link. Chạm lõi `processes` (gates, flow-engine, ports) — cần soát Opus.

## Test tối thiểu
- `bun test apps/hub-api/src/modules/packs/contracts/domain/sign-turn.rules.test.ts` (+ evidence.rules, detail-submit-block, esign-node.validator) → 27 pass.
- Int evotest: CHƯA chạy (xem Việc còn lại).

## Quyết định trong lúc làm
- `sign_versions.run_id` = id lượt chạy engine (`hub.process_runs.id`), không phải `contracts.approvals.id`: cổng lượt ký, kiểm Đạt và `voidByRun` (OutcomeInput.runId) cùng một khoá; Gửi lại tạo lượt mới ⇒ ký lại từ đầu.
- Bước đang mở của HĐ tìm qua `process_runs.pack_key/pack_record_id` (index `process_runs_pack_ref_idx`), một câu system.
- Q4 tạm: công ty bật + đã Lưu chữ ký trên mọi tệp cần ký ⇒ coi là chứng cứ chữ ký (`signedOnDoc`), không đòi ảnh vẽ tay; CHƯA chép PNG «Chữ ký của tôi» vào `hub.attachments`.
- Kiểm Đạt hỏi gói trên kết nối riêng khi đang giữ khoá run (chỉ đọc, 2 câu cố định).
- `ondoc` đã ký đủ lúc tool chạy ⇒ bắn `esign.completed` không chờ (signalEvent ghi sự kiện trước, bước chờ mở sau vẫn nhận) — tránh chờ khoá run của tool.
- Cổng gói ↔ lắp ráp qua `signFlowHooks` gắn muộn (như `registerContractDoneHook`), vì gói không import module hub.
- Bước Ký `ondoc` = stage chờ `esign.completed` ngay sau tool Ký số `provider=ondoc` gần nhất.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Lượt ký theo bước đang mở (BR-D1)
Chỉ người được giao / đã nhận / thuộc Group của bước duyệt có bằng chứng (hoặc Toàn quyền) hoặc người ký công ty của bước Ký `ondoc` có lượt ký.
- Kịch bản: khi người ngoài nhóm bước mở màn ký thì không có lượt [test: apps/hub-api/src/modules/packs/contracts/domain/sign-turn.rules.test.ts » thành viên Group duyệt ⇒ approve; người ngoài ⇒ không]
- Kịch bản: khi người ký công ty mở bước Ký trên tài liệu thì được ký [test: apps/hub-api/src/modules/packs/contracts/domain/sign-turn.rules.test.ts » bước Ký ondoc: người ký (user / thành viên Group) ⇒ sign]
#### Yêu cầu: Bước Ký trên tài liệu (BR-D3, BR-C4, Q6, Q8)
Bước Ký `ondoc` không gửi phong bì; xong khi mọi chỗ ký Bên A của người ký công ty đã ký; Bên B không chặn; đã ký đủ từ bước duyệt ⇒ xong ngay.
- Kịch bản: khi còn ô Bên A chưa ký thì bước chưa xong [test: apps/hub-api/src/modules/packs/contracts/domain/sign-turn.rules.test.ts » BR-D3/C4 · xong khi có ô Bên A và tất cả đã ký]
#### Yêu cầu: Chặn Gửi duyệt khi thiếu tệp hoặc chỗ ký (BR-T2, BR-C3)
- Kịch bản: khi quy trình có bước ký trên tài liệu mà thiếu tệp cần ký thì Gửi bị chặn với lý do sign_no_files [test: apps/hub-api/src/modules/packs/contracts/domain/sign-turn.rules.test.ts » BR-C3 · lý do chặn]
- Kịch bản: khi quy trình chỉ có bước chỉ ý kiến thì không bắt tệp cần ký [test: apps/hub-api/src/modules/packs/contracts/domain/sign-turn.rules.test.ts » BR-T2 · Q3: chỉ khi có bước Ký ondoc hoặc duyệt có bằng chứng]

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Đạt bước duyệt có bằng chứng khi công ty bật ký trên tài liệu (BR-D2, Q3, Q4)
Đạt cần ý kiến và mỗi tệp cần ký có bản chưa bỏ do chính người duyệt Lưu trong lượt; thiếu ⇒ 409 SIGN_REQUIRED kèm danh sách tệp. Công ty tắt ⇒ như cũ. Trả lại / Từ chối bỏ các bản đã ký của lượt và mở lại chỗ ký (Q17).
- Kịch bản: khi người duyệt chưa ký đủ mà bấm Đạt thì bị chặn [test: thủ công — int evotest chưa chạy trong lát]
- Kịch bản: khi chọn Ký qua là ký trên tài liệu thì lưu quy trình không đòi nhà cung cấp ký số [test: thủ công — int evotest chưa chạy trong lát]

## Việc còn lại
- Int evotest cho D1/D2/D3/Q8/Q17/T2/ondoc lưu/hồi quy công ty TẮT — chưa viết, chưa chạy (hết ngân sách lượt gọi).
- Gọi `onDocSigned` từ đường Lưu (`application/sign-doc.usecase.ts`, s8 phần B) khi phần B gộp: `signFlowOf(db).onDocSigned` cần truyền vào `signDocModule` (packs.contracts-attachments.ts đã có `signFlow`).
- Q4 đầy đủ: chép PNG «Chữ ký của tôi» vào `hub.attachments` + đặt `signature_attachment_id` cho bằng chứng.
- Web: `head-rule.ts` kiểu `submitBlock` chỉ `"no_flow"` ⇒ cần nhận `sign_no_files`/`sign_missing_fields` (+ nhãn; mã lỗi `SIGN_NOT_READY`, `SIGN_REQUIRED`).
