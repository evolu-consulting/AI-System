---
id: cr122-w1-flag-off
lát: cr122-w1-flag-off
cr: CR-122
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Wave cuối CR-122 đỏ 5 ca nghi hồi quy đường cờ `FLOW_TRIGGERS` TẮT (prod lúc deploy). Chạy lại 2 file int, phân loại từng ca, sửa hồi quy
sản phẩm, thêm 1 int chứng minh cờ tắt ⇒ đường khe/engine cũ mở lượt + finalize như trước.

## Làm
- [x] `approval-engine-card.usecase.ts` · `engineAct`/`noteOverride`: hai lần bấm Đạt SONG SONG của cùng chủ gói — lần chèn bản ghi
  "duyệt thay" thua đua (giữ chỗ `pending_links`) xoá bản ghi (bù trừ) trong khi lần trùng (không chèn) thắng ⇒ quyết duyệt thay mất
  audit. Sửa: `noteOverride` trả `{id}` (id null = trùng nhưng VẪN là duyệt thay); lần trùng thắng ⇒ ghi lại sau khi engine nhận (idempotent).
- [x] Int mới `tests/acceptance/CF/flag-off-legacy.int.test.ts` (cờ tắt ⇒ run engine mở ngay, bản xuất bản hiện hành, thẻ có bước mở,
  Đạt bước 0 ⇒ Đã duyệt + khoá).

## Không làm / Chạm
Không sửa test acceptance/e2e đã khoá. Không đụng migration 0111.

## Test tối thiểu
`run-tests.ps1 -Step int -Dirty -Filter "CF/approval-engine CF/owner-override CF/flag-off-legacy"` → 7 pass, 2 đỏ (approval-engine, test cũ — xem dưới).

## Quyết định trong lúc làm
- approval-engine.int "mở cấp 1 … flow v1": nhận `flow_version` 2. KHÔNG phải hồi quy: hub 0111 (CR-122 M1, ADR-0038) cố ý tạo release
  MỚI `max+1` cho def Thư viện có khe (chép nguyên `slot_body` ⇒ đường cũ cùng bước, chỉ khác số bản). Ca "Đạt bước 0 … finalize" đỏ
  dây chuyền (biến `run` chưa gán vì ca trước dừng ở expect ⇒ `not_open`). ⇒ qc sửa test: kỳ vọng `flow_version` = `published_version`
  của def mặc định khe (không cố định 1).
- e2e approval.ja.ts ›3 và cr121-d-journey ›3: bước 0 "Xác nhận hợp đồng" vẫn mở, thẻ hiện "Bước duyệt đã thay đổi … đã tải trạng thái
  mới" ⇒ lần bấm "Xác nhận và lưu" bị chặn APPROVAL_NOT_OPEN (thẻ đã cũ lúc bấm: HĐ ĐẦU TIÊN của công ty sau khi gán ⇒ ensureDef lần đầu,
  cửa sổ máy-cũ-level1 → run gắn → s0 mở dài hơn). Đích đúng (lượt engine, bước 0 mở, Đạt sau đó chạy); HĐ thứ hai cùng công ty (ca 4)
  xanh. Không phải hồi quy đường cờ tắt ⇒ qc: trong `uploadAndOpen`/`submit` chờ `approval-step-0` `data-status=open` trước khi bấm
  (hoặc bấm lại khi thấy câu "đã tải trạng thái mới"). Theo dõi UX: nút xác nhận hiện trên thẻ sắp đổi (hàng chờ sau deploy).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Cờ flow theo sự kiện tắt giữ đường duyệt cũ
Công ty chưa bật `FLOW_TRIGGERS`: AI đọc xong ⇒ lượt duyệt mở run engine ngay theo quy trình khe (bản xuất bản hiện hành), thẻ duyệt có
bước mở, Đạt đủ bước ⇒ HĐ Đã duyệt + khoá, như trước CR-122.
- Kịch bản: khi cờ tắt và AI đọc xong HĐ dưới ngưỡng thì lượt mở run engine, thẻ có bước 0 mở, Đạt bước 0 ⇒ Đã duyệt + khoá [test: tests/acceptance/CF/flag-off-legacy.int.test.ts » cờ tắt ⇒ AI đọc xong mở run engine như cũ (bản xuất bản hiện hành, thẻ có bước mở) · Đạt bước 0 ⇒ Đã duyệt + khoá]
#### Yêu cầu: Duyệt thay ghi đúng một lần khi bấm trùng
Chủ gói bấm Đạt nhiều lần (kể cả song song) ở bước không thuộc Group của mình ⇒ đúng một bản ghi "duyệt thay", không mất khi lần bấm ghi
bản ghi thua đua.
- Kịch bản: khi chủ gói bấm Đạt hai lần song song thì có đúng 1 dòng duyệt thay và thẻ hiện owner_override [test: tests/acceptance/CF/owner-override.int.test.ts » review · H bấm Đạt hai lần liên tiếp (song song + lần nữa) ⇒ đúng 1 dòng duyệt thay]

## Việc còn lại
- qc: sửa `approval-engine.int.test.ts` (flow_version theo release hiện hành) + 2 ca e2e journey (chờ bước 0 mở trước khi bấm); relock.
