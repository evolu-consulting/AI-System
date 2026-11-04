---
id: cr118-bundle
lát: cr118-bundle
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: cr118-move
---
## Plan (ngắn)
`check:bundle` đỏ sau React 19 (+ React Compiler cho sohoptac-web). Luật 4c: cắt trước, đo, rồi mới nới đúng phần runtime React.

## Làm
1. Đo bằng stats rspack (script tạm, không commit) + baseline React 18 build ở commit be538523 (trước cr118-move).
2. Cắt lười (JS ban đầu, gzip KB):
   - sohoptac-web: `DialogHost` + `Toaster`(sonner) lazy ở `__root.tsx`, `toast()` import sonner lười (trả `Promise<void>`); `SettingsDialogLazy` (hộp Cài đặt chỉ nạp khi mở lần đầu); `dialog-bus.expectHost` (confirm/prompt gọi sớm xếp hàng chờ DialogHost thay vì trả false); `splitChunks.contractDetailParts` (tách duyệt/mốc/ký số/phiên bản của trang chi tiết HĐ ra chunk song song) để chunk route < 50 KB sau khi bật Compiler.
   - chat-web, studio-web: `Toaster` lazy ở `__root.tsx`, toast phiên hết hạn import sonner lười.
   - admin-web: đã lười từ trước (initial chỉ còn hạ tầng) — không cắt thêm được; community-web: 149,7 đạt 150, không đổi.
3. Nới ngưỡng JS chỉ phần React 19 còn lại sau khi cắt; `check-bundle.ts` bỏ chuỗi cứng `> 150 KB` (dùng hằng), `check-bundle.test.ts` suy fixture từ `JS_BUDGET_BYTES`.

## Không làm / Chạm
- Không đổi ngưỡng CSS/chunk; không đổi hành vi. Không tách zod/router/query/i18next (hạ tầng bắt buộc ở trang đầu).

## Số đo (gzip KB, JS tải ban đầu)
| web | React 18 (be538523) | React 19 (a9e947bf) | sau cắt | ngưỡng cũ → mới |
|---|---|---|---|---|
| sohoptac-web | 171,7 (đã đỏ) | 196,4 (có Compiler) | 161,5 | 150 → 162 |
| admin-web | 141,7 | 165,2 | 165,2 | 150 → 174 |
| chat-web | 143,4 | 166,8 | 156,1 | 150 → 163 |
| studio-web | 153,2 | 176,6 | 167,3 | 160 → 175 |
| community-web | 126,3 | 149,7 | 149,7 | 150 (giữ) |
- Runtime React 19 (`lib-react`): 44,4 → 67,9 = +23,5 KB gzip cho mọi web (không cắt được).
- Chunk route sohoptac-web: Compiler đẩy 2 chunk lên 65,2 / 64,4 KB (> 50); sau tách (settings lười + cacheGroup contract-detail-parts): lớn nhất ngoài canvas 44,5 KB (≤ 50), canvas-xyflow 55,6 (≤ 80). Ngưỡng chunk giữ 50.
- Công thức nới: ngưỡng mới = ngưỡng cũ + phần tăng còn lại so với React 18 sau khi cắt (admin +23,5; chat +12,7; studio +14,1; sohoptac: còn vượt 150 là 11,5 ⇒ 162, vốn đã đỏ 171,7 trước React 19).

## Test tối thiểu
- build + check:bundle 5 web OK; typecheck 5 web = 0 lỗi; unit: sohoptac 412, admin 700, chat 459, studio 134, community 88 xanh.
- e2e contracts-web chạy MỘT lần trên evotest (kết quả ở báo cáo lát).

## Quyết định trong lúc làm
- Đã thử React.lazy cho các bảng phụ của trang chi tiết HĐ (Frame/Esign/Versions/Timeline…) nhưng e2e `scenes.cw` (khoá, đọc chữ ngay sau tải) đỏ 7 ca vì bảng hiện trễ ⇒ BỎ, thay bằng splitChunks (cùng thời điểm render). Bài học: không lười hoá thứ mà test khoá đọc ngay.
- Lười mức component/route-chung, không lười hàm: `toast()` chờ import sonner (cùng chunk với Toaster) nên toast bắn trước khi Toaster mount có thể mất — chỉ xảy ra trong vài chục ms đầu, mọi toast hiện nay do thao tác người dùng/hết phiên.
- `DialogHost` lười: test `v2i-partners` (gỡ cờ, dùng promptDialog) đỏ khi host chưa mount ⇒ dialog-bus xếp hàng yêu cầu tới khi host đăng ký (`expectHost`, có unit); host tải lỗi ⇒ trả mặc định (false/null).
- Không tách zod (360 KB thô, lõi parse) vì `@ai/contracts` cần ngay ở trang đầu (auth/pack-state/route validateSearch).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ đổi thời điểm tải mã (lazy chunk) và ngưỡng ngân sách bundle; giao diện/luồng giữ nguyên)

## Việc còn lại
- Cắt thêm sohoptac-web xuống 150: schema `@ai/contracts` (~61 KB thô) kéo vào ban đầu qua `validateSearch`/pack-state; zod 4 `toJSONSchema` không tree-shake.
