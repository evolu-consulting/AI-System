# app events

Cập nhật: 2026-11-08 · Nguồn: cr122-f0-flowdef-contract. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: App khai sự kiện trong manifest, kiểm bằng check:app-events (FLOW2-FR-17/18)
Mỗi app khai `events[] {key,label,facts[],outcomes[],decides,required}`; contracts: `contract.submitted` (decides + required), `contract.uploaded`, `contract.approved`; community: `post.created`, `partner.join_requested`, `report.created`. `bun run check:app-events` đỏ khi app không có sự kiện hoặc khai sai; sự kiện required thiếu flow mặc định trong seed hiện chỉ cảnh báo.
- Kịch bản: khi manifest thật được kiểm thì không lỗi và đúng danh mục [test: packages/contracts/src/app-manifest/events.rules.test.ts » manifest thật (contracts, community) không lỗi, đúng danh mục mục C]
- Kịch bản: khi app không có sự kiện thì đỏ [test: packages/contracts/src/app-manifest/events.rules.test.ts » app không có sự kiện ⇒ no_events]
- Kịch bản: khi sự kiện required thiếu flow mặc định thì cảnh báo, chế độ strict thì đỏ [test: packages/contracts/src/app-manifest/events.rules.test.ts » required thiếu flow mặc định / không có trong seed ⇒ cảnh báo (mặc định), lỗi khi strict]
