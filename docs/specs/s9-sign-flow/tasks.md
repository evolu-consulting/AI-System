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
- Unit `sign-turn.rules.test.ts` + `evidence.rules.test.ts` → xanh.
- Int evotest `apps/hub-api/src/modules/packs/sign-flow.int.test.ts` → 8 pass (lượt 2; lượt 1 đỏ do fixture `parts` rỗng + kiểm Đạt tra HĐ qua `approvals`).
- Int evotest `sign-save.int.test.ts`, `sign-on-doc.int.test.ts`, khoá `tests/acceptance/CR-127/X3/evidence-file.int.test.ts` → xanh (lượt 1).
- `test:lock:verify` đỏ sẵn (83 mục e2e/cr181 + deployed, không do lát này — lát không chạm `e2e/`, `tests/`).

- [x] s8B · Lưu: kiểm lại lượt SAU `lockDoc` (TOCTOU), `markSigned` ≠ số chỗ ⇒ `stale`, `run_id` của bản = `turn.run_id` (lượt engine), gọi `onDocSigned` sau COMMIT.
- [x] Q4 · công ty bật: máy chủ chép PNG «Chữ ký của tôi» vào `hub.attachments` (của người duyệt) + đặt `signature_attachment_id` cho bằng chứng (`gates.service #withEvidence`).

## Quyết định trong lúc làm
- `sign_versions.run_id` = id lượt chạy engine (`hub.process_runs.id`), không phải `contracts.approvals.id`: cổng lượt ký, kiểm Đạt và `voidByRun` (OutcomeInput.runId) cùng một khoá; Gửi lại tạo lượt mới ⇒ ký lại từ đầu.
- Bước đang mở của HĐ tìm qua `process_runs.pack_key/pack_record_id` (index `process_runs_pack_ref_idx`), một câu system.
- Q4: công ty bật + đã Lưu chữ ký trên mọi tệp cần ký ⇒ đủ chứng cứ chữ ký (`signedOnDoc`); bằng chứng gửi kèm chưa có chữ ký ⇒ máy chủ chép «Chữ ký của tôi» (kho trước, rồi INSERT hàng của người duyệt; lỗi ⇒ không gắn, vẫn Đạt). Chưa có chữ ký đang dùng ⇒ không gắn.
- Kiểm Đạt tra HĐ của lượt bằng `process_runs.pack_record_id` (không qua `contracts.approvals.engine_run_id`).
- Kiểm lại lượt trong tx Lưu gọi cổng hub trên kết nối riêng (chỉ đọc) khi đang giữ khoá `sign_docs`.
- Kiểm Đạt hỏi gói trên kết nối riêng khi đang giữ khoá run (chỉ đọc, 2 câu cố định).
- `ondoc` đã ký đủ lúc tool chạy ⇒ bắn `esign.completed` không chờ (signalEvent ghi sự kiện trước, bước chờ mở sau vẫn nhận) — tránh chờ khoá run của tool.
- Cổng gói ↔ lắp ráp qua `signFlowHooks` gắn muộn (như `registerContractDoneHook`), vì gói không import module hub.
- Bước Ký `ondoc` = stage chờ `esign.completed` ngay sau tool Ký số `provider=ondoc` gần nhất.

- Bước Duyệt quyết qua form (`/review-tasks/:id/form`, node `form`) bỏ qua BR-D2 và kiểm bằng chứng như cũ (form không mang bằng chứng — CR-118).
- Soát Opus s9: (#1) Q8 không bắn sự kiện từ tool nữa — engine hỏi gói `signWaitReady` TRONG tx mở stage chờ, đủ ô ⇒ ghi sự kiện ⇒ hẹn tới hạn ngay; (#2) tự phục hồi: mỗi lần mở phiên ký ở bước Ký ⇒ `onDocSigned` kiểm lại; (#3) không có tệp cần ký ⇒ `onDoc=false` (luật CR-170); (#4) kiểm bằng chứng TRƯỚC, chép chữ ký bằng CHÍNH tx quyết định (`gates/sign-evidence.ts`), không mở kết nối khác; (#5) «Chưa đạt» ⇒ `signOnBack` void bản của run trong tx quyết định.
- Blob PNG chữ ký ghi kho trước INSERT trong tx quyết định: tx rollback ⇒ blob mồ côi (không có hàng), không có hàng rác DB.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Lượt ký theo bước đang mở (BR-D1)
Chỉ người được giao / đã nhận / thuộc Group của bước duyệt có bằng chứng (hoặc Toàn quyền) hoặc người ký công ty của bước Ký `ondoc` có lượt ký.
- Kịch bản: khi người được giao khác người tạo HĐ mở màn ký thì có lượt [test: apps/hub-api/src/modules/packs/sign-flow.int.test.ts » D1 · người được giao khác người tạo có lượt, người ngoài nhóm bị từ chối]
- Kịch bản: khi người ngoài nhóm bước mở màn ký thì không có lượt [test: apps/hub-api/src/modules/packs/contracts/domain/sign-turn.rules.test.ts » thành viên Group duyệt ⇒ approve, người ngoài ⇒ không]
- Kịch bản: khi người ký công ty mở bước Ký trên tài liệu thì được ký [test: apps/hub-api/src/modules/packs/contracts/domain/sign-turn.rules.test.ts » bước Ký ondoc: người ký (user / thành viên Group) ⇒ sign]
#### Yêu cầu: Bước Ký trên tài liệu (BR-D3, BR-C4, Q6, Q8)
Bước Ký `ondoc` không gửi phong bì; xong khi mọi chỗ ký Bên A của người ký công ty đã ký; Bên B không chặn; đã ký đủ từ bước duyệt ⇒ xong ngay.
- Kịch bản: khi đủ ô Bên A thì bước Ký xong dù ô Bên B chưa ký [test: apps/hub-api/src/modules/packs/sign-flow.int.test.ts » D3/C4 · bước Ký ondoc xong khi đủ ô Bên A, ô Bên B không chặn]
- Kịch bản: khi người duyệt kiêm người ký đã ký ở bước duyệt thì bước Ký tự xong [test: apps/hub-api/src/modules/packs/sign-flow.int.test.ts » Q8 · người duyệt kiêm người ký đã ký ô ở bước duyệt thì bước Ký tự xong]
- Kịch bản: khi còn ô Bên A chưa ký thì bước chưa xong [test: apps/hub-api/src/modules/packs/contracts/domain/sign-turn.rules.test.ts » BR-D3/C4 · xong khi có ô Bên A và tất cả đã ký]
#### Yêu cầu: Chặn Gửi duyệt khi thiếu tệp hoặc chỗ ký (BR-T2, BR-C3)
- Kịch bản: khi thiếu chỗ ký hoặc tệp cần ký thì Gửi duyệt bị chặn đúng lý do [test: apps/hub-api/src/modules/packs/sign-flow.int.test.ts » T2/C3 · Gửi duyệt bị chặn đúng lý do]
- Kịch bản: khi quy trình có bước ký trên tài liệu mà thiếu tệp cần ký thì Gửi bị chặn với lý do sign_no_files [test: apps/hub-api/src/modules/packs/contracts/domain/sign-turn.rules.test.ts » BR-C3 · lý do chặn]
- Kịch bản: khi quy trình chỉ có bước chỉ ý kiến thì không bắt tệp cần ký [test: apps/hub-api/src/modules/packs/contracts/domain/sign-turn.rules.test.ts » BR-T2 · Q3: chỉ khi có bước Ký ondoc hoặc duyệt có bằng chứng]

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Đạt bước duyệt có bằng chứng khi công ty bật ký trên tài liệu (BR-D2, Q3, Q4)
Đạt cần ý kiến và mỗi tệp cần ký có bản chưa bỏ do chính người duyệt Lưu trong lượt; thiếu ⇒ 409 SIGN_REQUIRED kèm danh sách tệp. Máy chủ gắn «Chữ ký của tôi» vào bằng chứng. Công ty tắt ⇒ như cũ. Trả lại / Từ chối bỏ các bản đã ký của lượt và mở lại chỗ ký (Q17).
- Kịch bản: khi người duyệt chưa ký đủ mà bấm Đạt thì bị chặn [test: apps/hub-api/src/modules/packs/sign-flow.int.test.ts » D2 · công ty bật, Đạt khi chưa ký thì thiếu tệp, ký đủ trong lượt thì không thiếu]
- Kịch bản: khi công ty tắt thì quyết định duyệt với chữ ký vẽ tay như cũ [test: apps/hub-api/src/modules/packs/sign-flow.int.test.ts » công ty TẮT thì không áp, quyết định với chữ ký vẽ tay như cũ]
- Kịch bản: khi Trả lại thì các bản đã ký của lượt bị bỏ và ô mở lại [test: apps/hub-api/src/modules/packs/sign-flow.int.test.ts » Q17 · Trả lại thì các bản của lượt void và ô mở lại]
- Kịch bản: khi Chưa đạt quay lại bước trước cùng lượt thì phải ký lại [test: apps/hub-api/src/modules/packs/sign-flow.int.test.ts » Q17 · Chưa đạt quay lại bước trước cùng run thì bỏ bản đã ký của run]
- Kịch bản: khi HĐ không có tệp cần ký thì áp luật bằng chứng cũ [test: apps/hub-api/src/modules/packs/sign-flow.int.test.ts » D2 · HĐ không có tệp cần ký thì không coi là đã ký, áp luật bằng chứng cũ]
- Kịch bản: khi chọn Ký qua là ký trên tài liệu thì lưu quy trình không đòi nhà cung cấp ký số [test: apps/hub-api/src/modules/packs/sign-flow.int.test.ts » Q1 · lưu quy trình có Ký qua ondoc không đòi nhà cung cấp ký số]

## Việc còn lại
- Web (`submitBlock` mới, nhãn `SIGN_NOT_READY`/`SIGN_REQUIRED`) — giao s13.
- Ca 409 qua HTTP thật của `/review-tasks/:id/decision` chưa có int (kiểm ở cổng gói + luật thuần `evidenceCheck`); e2e cuối đợt nên phủ.
