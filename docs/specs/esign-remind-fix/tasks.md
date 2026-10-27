# esign-remind-fix — nhắc ký số đúng người theo lượt ký

Lỗi review [TB]: vòng nền esign-sweep luôn nhắc `esign_signer` "đang chờ bạn ký số" dù công ty đã ký hoặc chưa tới lượt
(`approvals.esign_status` vẫn `sent` tới khi cả phong bì xong).

## Plan / đã làm
- [x] `domain/esign-sweep.rules.ts`: `signerDone` + `remindTargetOf(signers)` — có người ký công ty chưa ký mà mọi người `order`
      nhỏ hơn đã ký ⇒ "signer"; ngược lại ⇒ "owner"; không có phong bì mở ⇒ "signer" (như cũ).
- [x] `adapters/esign-sweep.repo.ts`: CÙNG câu quét thêm `cross join lateral` tới phong bì mở của HĐ (`status in (sent, delivered)`,
      index một phần `esign_envelopes_open_uq`, chỉ khi `z.remind`) ⇒ cột `wait` ≡ `remindTargetOf = "owner"`. Số câu SQL mỗi lượt không đổi.
- [x] `application/esign-sweep.ts`: nhắc + `waitPartner` ⇒ chuông người phụ trách "Ký số HĐ … đang chờ đối tác ký" (vẫn theo
      `remind_every_h`, mốc `esign_reminded_at` như cũ); không thì chuông người ký công ty như cũ.
- [x] `domain/esign.anchor.ts`: comment `TEXT_TAB_OFFSET` — đã đo trên DocuSign thật 2026-10-27. `docs/current/sht/duyet-ky-so.md`
      không có ⚠ về offset ⇒ không sửa.
- [x] Test: unit `remindTargetOf` + chuông chờ đối tác; int `esign-sweep.repo.int.test.ts` thêm (a) công ty order 1 đã ký,
      (b) công ty order 2 đối tác chưa ký ⇒ chỉ chuông người phụ trách; (c) công ty order 1 chưa ký ⇒ chuông người ký; giữ assert số câu.

## Quyết định
- Trạng thái từng người ký lấy từ `esign_envelopes.signers` (jsonb: `order`, `status`, `signed_at`), do webhook / sync
  (`mergeSigners`) và pha sync nền esign-sweep2 (mỗi 15 phút) cập nhật. "Đã ký" = có `signed_at` hoặc `status` ∈ {completed, signed}.
  Có thể trễ tới một chu kỳ sync (vd công ty vừa ký mà chưa sync ⇒ có thể nhận thêm một lần nhắc) — chấp nhận được.
- Không migration.
