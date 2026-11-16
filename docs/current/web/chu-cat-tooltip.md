# Chữ cắt có tooltip đủ chữ (CR-179 · nguồn: cr179-msg-text)

Code: `TruncText` của kit (`packages/web-kit/src/ui/kit/`); bản dùng ở workspace-web `apps/workspace-web/src/components/shared/TruncText`.

#### Yêu cầu: Chữ cắt có tooltip đủ chữ
Chữ có thể dài hơn khung dùng `TruncText`: cắt «…» (1 hoặc 2 dòng); CHỈ khi thật sự tràn mới hiện tooltip đủ chữ khi rê chuột/focus và cho focus bàn phím; không tràn thì không tooltip, không thêm tab stop.
- Kịch bản: đo tràn một dòng theo bề ngang, nhiều dòng theo bề cao [test: packages/web-kit/src/ui/kit/trunc-text.test.tsx » isOverflowing]
- Kịch bản: chữ ngắn ⇒ không tooltip, không thêm tab stop [test: apps/workspace-web/src/components/shared/TruncText.test.tsx » kit render tĩnh]
- Kịch bản: tên HĐ dài ở danh sách HĐ ⇒ rê chuột hiện tooltip đủ chữ [test: e2e/contracts-web/cr179-trunc-tooltip.cw.ts » CR179 · danh sách HĐ: tên HĐ dài bị cắt, rê chuột hiện tooltip đủ chữ]

Nợ: `title=` còn ở Tag/Sidebar/RepBadge… (xem [giao-dien-chung.md](giao-dien-chung.md)).
