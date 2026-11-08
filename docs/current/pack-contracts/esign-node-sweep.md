# esign node sweep

Cập nhật: 2026-11-08 · Nguồn: cr122-e5c-esign-sweep. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Vòng quét nhắc và hết hạn theo phong bì của node Ký số
Phong bì mở của node Ký số (không có bước Ký số kiểu cũ) được nhắc đúng chu kỳ, không nhắc trùng, và quá hạn thì bị huỷ và bắn esign.voided cho lượt đang chờ.
- Kịch bản: khi đủ chu kỳ nhắc thì nhắc một lần và ghi mốc nhắc, chưa đủ chu kỳ thì không nhắc [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-sweep-node.int.test.ts » nhắc đúng MỘT lần mỗi chu kỳ (nhắc mỗi 2h, hạn 48h)]
- Kịch bản: khi quét hai lần liền nhau cùng thời điểm thì không nhắc và không chuông trùng [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-sweep-node.int.test.ts » quét hai lần liền nhau cùng thời điểm ⇒ không nhắc / chuông trùng]
- Kịch bản: khi quá hạn thì huỷ phong bì và bắn esign.voided một lần, quét lại không lặp [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-sweep-node.int.test.ts » quá hạn ⇒ huỷ phong bì + bắn esign.voided cho lượt, chuông một lần, quét lại không lặp]
