---
id: cr125-fix-int-app
lát: cr125-fix-int-app
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Phân loại các ca int đỏ của đợt cuối CR-125 (qc log `20261108-160017-3396-int`) thành "test lỗi thời" (stale) hoặc "lỗi sản phẩm" (bug) bằng git log từ e232e5ef0, sửa đúng bên.

## Làm
| Ca | Loại | Nguyên nhân + sửa |
|---|---|---|
| esign-flow ×2 (chuông người ký) | stale | Link chuông "Mời ký" nay là `/contracts/c/<id>?ky=1#esign-panel` (x12/`signInviteLink`); test so `link = '/contracts/c/<id>'`. Đổi sang `like '/contracts/c/<id>%'`. Luật lượt ký không liên quan (test không ký). |
| CR-122 intakeWiring chuông | stale | Cùng link `?ky=1#esign-panel`; sửa link kỳ vọng trong `esign-node.int.test.ts`. |
| fnr-canvas ui.y | stale | CR-123 u13 cho phép `ui.x` (vị trí kéo tay) nên `{y:1,x:2}` hợp lệ ⇒ 201 đúng. Đổi ca xấu thành `{y:1,z:2}`, `{y:1,x:1e9}`, `{}`. |
| defs-flow N1/N2 (500) | stale (cô lập test) | 500 là `CONNECTION_ENDED`: `packs.module-registry.int` (cùng process) `mountPacks` đăng ký validator Ký số vào `nodeConfigRegistry` (singleton) giữ DB đã đóng. Sản phẩm đúng (mỗi process một DB). `defs-flow` gỡ validator Ký số trước khi chạy (`nodeConfigRegistry.clear`). |
| W1-NFR /my-work (3 câu) | bug (perf) | x1 thêm `signing()` thành câu SQL thứ 3. Gộp vào CTE `sg` của câu danh sách (jsonb `signing`), use case đọc `raw.signing`; `signing()` giữ cho int/perf riêng. Về 2 câu (đặt phạm vi + 1 nghiệp vụ), ngưỡng giữ nguyên. |
| K1 A50 (KH_UNAVAILABLE) | stale (đua mock) | Mock `_khfake` ghi lời gọi SAU khi trả lời; kịch bản `timeout` ngủ 2,5 s ⇒ lời gọi của A49 lọt vào A50 sau `reset()`. Ghi lời gọi lúc tới, điền status sau. Sản phẩm không đổi (log hub: cả hai lần `disabled`, không gọi KH). |

## Không làm / Chạm
Không chạm migration/RLS/purge, DLC. esign-multi đã sửa trên gd0; L1 là flake tải.

## Test tối thiểu
Một lượt evotest int `-Dirty` đúng các file trên; openspec:check; tsc hub-api.

## Quyết định trong lúc làm
- Sửa test khoá (`tests/acceptance/**`) vì lỗi thời; relock.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa 5 test lỗi thời + gộp câu SQL "chờ bạn ký" vào câu danh sách /my-work, kết quả trả về y nguyên).

## Việc còn lại
