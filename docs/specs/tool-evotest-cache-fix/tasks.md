---
id: tool-evotest-cache-fix
lát: tool-evotest-cache-fix
cr:
làn: nhanh
migration: không
phụ thuộc: tool-evotest-cache
---
## Plan (ngắn)
Đỏ mới trên gd0 da1e39cb ở evotest: `packages/db/src/packs-install.int.test.ts` 0 pass / 2 fail trong 0,3 s (42P01/3F000, thiếu schema `packs`), làn `s1-serial`.
Nghi do cache mẫu DB của tool-evotest-cache. **Kết luận sau khi tái hiện: KHÔNG phải cache.** File này (nằm trong `INT_SERIAL`, chạy sau cùng trên ô đầu) dùng DB Hub
`ai_system_s1_h1_test` mà không tự dựng — nó trông vào file int chạy TRƯỚC trong cùng ô worker đã `prepareDb` (clone mẫu `full`). Khi ô đầu không có file nào chạy trước
(lượt chia nhỏ/chia slot, `-Filter` chỉ file này) DB còn rỗng ⇒ lỗi. Tái hiện bằng ref da1e39cb: `-NoCache` cũng đỏ y hệt (0 pass / 2 fail, 0,3 s); có file hub chạy trước (cả có/không cache) xanh.

## Làm
- [x] `packages/db/src/packs-install.int.test.ts`: `beforeAll` tự `cloneMigratedTestDb(OWNER, { key: "full", migrate: migrateFullTest })` (cùng khoá `full` với `prepareDb` của H1/test-kit ⇒ dùng chung mẫu, ~0,1–0,3 s).

## Không làm / Chạm
Không đổi cache/hạ tầng evotest. Các file `INT_SERIAL` khác (`migrate-lock`, `test-db-template`, `N1/migrate`) tự dựng DB riêng nên không dính cùng lỗi (xem kết quả chạy).

## Test tối thiểu
evotest `-Step int -All -Filter packages/db/src/packs-install.int.test.ts` (một mình) + cùng ô với file khác.

## Quyết định trong lúc làm
- Sửa ở test (tự đủ điều kiện tiền đề) thay vì ép thứ tự file: chia ô/slot sẽ lặp lại lỗi với bất kỳ file nào trông vào trạng thái file khác.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: chỉ sửa điều kiện tiền đề của một file int; không đổi mã sản phẩm hay hành vi hệ thống).

## Việc còn lại
Rà các int khác dùng `HUB_TEST_DATABASE_URL`/`TEST_DATABASE_URL` mà không `prepareDb`/`cloneDb` (cùng kiểu phụ thuộc thứ tự) trước khi chia int theo đường dẫn.
