---
slice: fix-int-r3
lane: nhanh (chỉ sửa test int lỗi thời; không đụng mã sản phẩm, RLS, quyền, migration)
---
# fix-int-r3 · int đỏ lượt toàn bộ 20261115-214319 (0f7b8d5c8)

## Phân loại
| Ca | Nguyên nhân | Commit gây ra | Xử lý |
|---|---|---|---|
| HD1/upload (3 ca), HD1/export (Markdown), HD1/hops (tải PDF 4 câu) | Stack int không có AI ⇒ từ `ready=false` lượt đọc đóng NGAY `extract_failed AGENT_UNAVAILABLE` (extract_state `failed`, error, version 2, +2 event, +1 giao dịch ~10 câu SQL) thay vì kẹt `reading` | c14b975ac (fix-ai-unready-msg) | Test lỗi thời theo hành vi đã chốt ⇒ sửa test |
| H4b1/boot A115, M2/concurrency M2-R27 | Chập chờn (không đụng đường mã đổi) | — | Chạy lại riêng xác nhận |

## Làm trong lát
- `upload.int.test.ts`, `export.int.test.ts`: kỳ vọng `failed` + `AGENT_UNAVAILABLE` + version 2; đếm event `uploaded` riêng; outbox `distinct`.
- `hops.int.test.ts`: đo giao dịch GHI của tải lên (đoạn trước `set_config('role'…)` thứ hai) = 4 câu; giao dịch đóng lượt đọc nằm ngoài.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ chỉnh test int theo hành vi đã chốt ở fix-ai-unready-msg; mã sản phẩm không đổi)

## Quyết định trong lúc làm
- Tải lên khi AI chưa sẵn sàng vẫn 201, HĐ hiện ra, trạng thái đọc `failed/AGENT_UNAVAILABLE` ⇒ test theo đó, không đổi mã.
