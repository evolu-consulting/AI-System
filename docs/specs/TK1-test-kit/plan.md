---
id: TK1-test-kit
---

# Plan · TK1

1. **Gói**: `packages/test-kit` (`@ai/test-kit`, `exports "./*": "./src/*.ts"`, như web-kit). Phụ thuộc `@ai/db`, `postgres`; dev `@types/bun`.
   Cần entry workspace (bun.lock) — nếu import `@ai/test-kit/*` từ tests cần symlink `node_modules/@ai/test-kit` -> một lần `bun install` ở checkout này, rồi kiểm lefthook.
   depcruise: thêm luật `test-kit-no-apps` (kit không import `apps/**`) cạnh `web-kit-no-apps`.
2. **Thiết kế tách lớp**: kit không biết hub-api/admin-api. `bootStack` nhận `createApp` do test truyền vào (injection) -> không vòng phụ thuộc.
   Fake transport dùng kiểu cấu trúc tối thiểu (`sendBatch(msgs) -> results`), khớp ports N3 mà không import chúng.
3. **Bọc, không viết lại**: `cloneDb` = `cloneMigratedTestDb` (đã có template + advisory lock + GC). Phần #208: kit thêm `retry` ngắn cho 55006/57P03,
   và `bootStack` mở pool nhỏ (max theo tham số), đóng toàn bộ trong `close()` kể cả khi `boot` lỗi giữa chừng (không rò kết nối khi chạy song song).
4. **Builders**: mọi hàm nhận `Sql` owner và mảng/số lượng; một `INSERT … SELECT … FROM generate_series/unnest` mỗi bảng; id tất định `uuid(ns, n)`.
5. **RLS suite**: bộ sinh ca từ khai báo; chạy bằng `hub_api` + `set_config('role', …)` (đúng `withPackScope`).
6. **Di cư** (sau "gate done"): thứ tự ưu tiên theo trùng lặp thật: (i) `inPack`/`pgCode`/`percentile` trong N1/N3/HD1 `_support` -> re-export từ kit;
   (ii) `_fixtures` M1–M4 (`makeClock`, `doCall`) ; (iii) `_stack`/`_local` nếu khớp. Mỗi suite: chạy `test:int:par` trước/sau, so số pass.
7. **Cổng**: typecheck, depcruise, check:fn, test đơn vị kit, `test:int:par` suite đã di cư + int kit, perf kit, `test:lock:verify`.
