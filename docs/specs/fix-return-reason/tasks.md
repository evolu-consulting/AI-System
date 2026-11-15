# fix-return-reason — «Băng đầu trang hiện lý do Trả lại / Từ chối»

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Băng đầu trang HĐ nói rõ ai trả lại / từ chối và vì sao
Băng đầu trang (`head-banner`) khi HĐ về Nháp hoặc «Từ chối» hiện người làm, lúc làm và LÝ DO của bước quyết. Một nguồn mỗi loại: lý do người duyệt nhập nằm ở sự kiện `stage_decided`; ý kiến đi theo bằng chứng (`opinion_plus`) hub đưa sẵn ở `return_reason` của chi tiết HĐ (đã lọc BR-26, cho cả Trả lại lẫn Từ chối); lời đối tác nằm ở `partner_replied.reason`. Quyết định của đối tác hiện tên công ty đối tác, không lộ người bên kia, không dùng `return_reason` của vòng nội bộ cũ. «Lịch sử thay đổi» cũng kèm lý do dưới dòng Trả lại / Từ chối / đối tác trả lời.
- Kịch bản: khi trưởng phòng Trả lại với ý kiến đi theo bằng chứng thì băng hiện người quyết và lý do hub đưa sẵn [test: apps/workspace-web/src/features/contract-review/lib/head-banner.test.ts » nội bộ: sự kiện kết cục không có lý do]
- Kịch bản: khi trưởng phòng Từ chối thì băng cũng hiện lý do [test: apps/workspace-web/src/features/contract-review/lib/head-banner.test.ts » nội bộ: Từ chối cũng hiện lý do]
- Kịch bản: khi người duyệt tự nhập lý do thì lý do đó thắng return_reason [test: apps/workspace-web/src/features/contract-review/lib/head-banner.test.ts » lý do người duyệt nhập]
- Kịch bản: khi đối tác Trả lại thì băng hiện tên công ty đối tác và lý do đối tác nêu [test: apps/workspace-web/src/features/contract-review/lib/head-banner.test.ts » đối tác trả lại]
- Kịch bản: khi đối tác Từ chối thì băng hiện từ chối kèm lý do đối tác [test: apps/workspace-web/src/features/contract-review/lib/head-banner.test.ts » đối tác từ chối]
- Kịch bản: khi kết cục mới không có nguồn thì không mượn lý do của vòng cũ [test: apps/workspace-web/src/features/contract-review/lib/head-banner.test.ts » không ăn lý do của vòng cũ]
- Kịch bản: khi xem lịch sử thì dòng Trả lại / Từ chối / đối tác trả lời kèm lý do [test: apps/workspace-web/src/features/contract-review/lib/manage.test.ts » dòng kèm lý do]
- Kịch bản: khi HĐ bị Từ chối thì hub trả lý do của lần Từ chối (kể cả ý kiến ở bằng chứng) và chỉ người trong quy trình đọc được [test: apps/hub-api/src/modules/packs/contracts/adapters/expiry-outcome.int.test.ts » Từ chối ⇒ return_reason]
- Kịch bản: khi mở HĐ vừa bị Trả lại / Từ chối / đối tác trả lại thì băng đầu trang hiện lý do [test: e2e/contracts-web/fix-return-reason.cw.ts » Trưởng phòng Trả lại]

## Quyết định trong lúc làm
- Nguyên nhân thật: (1) web chỉ đọc `feedback/note/reason` của sự kiện, mà `eventDataOut` lược `feedback` khi quyết đi theo bằng chứng (BR-26) và hub đã có `return_reason` (SG1) nhưng web không dùng; (2) sự kiện kết cục `returned`/`rejected` (id lớn hơn) che `stage_decided` và không mang lý do; (3) hub chỉ tính `return_reason` cho Trả lại (DRAFT), thiếu Từ chối; (4) quyết của đối tác chỉ là `partner_replied` (actor null) mà web không nhận ra ⇒ «người khác».
- G1: không thêm trường contract; mở rộng cách tính `return_reason` (cùng nguồn, cùng lọc BR-26). Chỉ sửa chú thích, shape không đổi.
- Không có: ý kiến bằng chứng của bước quyết nội bộ trong «Lịch sử thay đổi» (BR-26: nằm ở Hồ sơ duyệt).
- Việc dở: chạy lại flows3 (FL3-5a/5b/5c) sau khi gộp lát này vào `slice/e2e-tenant-flows`.
