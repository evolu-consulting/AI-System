# cr170-approve-evidence-ux — «Bấm Duyệt ở đầu trang ⇒ thấy ngay ô bằng chứng»

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Bấm Duyệt khi bước đòi bằng chứng thì đưa người dùng tới ô bằng chứng
Bước duyệt vẫn bắt buộc ý kiến (và chữ ký hoặc tệp nếu bước đòi). Bấm «Duyệt» (hoặc Trả lại/Từ chối dùng cùng ô) ở đầu trang HĐ ⇒ trang cuộn mượt tới ô bằng chứng (tức thì nếu người dùng giảm chuyển động), con trỏ vào ô ý kiến, ô nổi viền vài giây, có câu «Ghi ý kiến và đính chữ ký hoặc tệp để duyệt». Nút xác nhận «Duyệt» (chính) tách khỏi «Huỷ». Thiếu bằng chứng mà bấm «Duyệt» ⇒ câu lỗi tại chỗ nói thiếu gì. Không đổi luật hay API.
- Kịch bản: khi mở ô bằng chứng thì cuộn tới ô và đặt con trỏ vào ô ý kiến [test: apps/workspace-web/src/platform/flow/lib/reveal.test.ts » cuộn mượt tới giữa khung nhìn và focus ô ý kiến]
- Kịch bản: khi người dùng giảm chuyển động thì cuộn tức thì [test: apps/workspace-web/src/platform/flow/lib/reveal.test.ts » giảm chuyển động ⇒ cuộn tức thì]
- Kịch bản: khi bấm Duyệt ở đầu trang thì ô bằng chứng trong khung nhìn, thiếu ý kiến báo thiếu, đủ thì duyệt xong [test: e2e/cr127/j11-nhan-viec-tat-ca.spec.ts » CR-170: Duyệt ở đầu trang ⇒ ô bằng chứng trong khung nhìn, con trỏ ở ô ý kiến, thiếu ý kiến báo thiếu, đủ thì duyệt xong]

## Tasks
- [x] `platform/flow/lib/reveal.ts` + `EvidenceAsk` prop `reveal` (cuộn, focus, nổi ô, câu hướng dẫn) · i18n `askHint`/`askHintReason`
- [x] `use-approval-ui.tsx` bật `reveal`, `key={ev}`
- [x] e2e j11 ca CR-170

## Quyết định trong lúc làm
- Ca e2e dùng bước «Cần tất cả» (chế độ chỉ ý kiến); ca «ý kiến + chữ ký/tệp» (opinion_plus) chưa có e2e, issue `proof` đã có sẵn từ CR-127.
