---
id: e2e-isolation
lát: e2e-isolation
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Làn e2e theo checkout (`.e2e-lane` + sổ toàn máy), mọi tài nguyên suy từ làn (`e2e-lane.rules.ts`), Redis thuê DB toàn máy, dọn cây tiến trình + `e2e:reap`.

## Làm
- [x] e2e-lane.rules.ts (+ test), e2e-lane.ts (I/O), e2e-lane.cli.ts (`e2e:lanes`, `e2e:reap`)
- [x] test-e2e-par + run-playwright dùng làn; slice:new cấp, slice:rm nhả; x2a/combine đọc E2E_PORT_SHIFT
- [x] docs WORKFLOW + CLAUDE.md 0c
- [~] Chứng minh 2 worktree song song: chạy được với cấu hình không DB (N1,contracts-web): làn 1 (cổng 6300/6310) + làn 2 (9300/9310) cùng lúc, ~290/310 s, 261 pass + 5 đỏ cũ y hệt ở cả hai, không còn cổng nghe. Phần DB/Redis CHƯA chạy: máy không có Postgres/Redis.

## Không làm / Chạm
Không đổi hành vi sản phẩm; chạm hạ tầng test e2e.

## Test tối thiểu
Unit e2e-lane.rules.test.ts (cấp làn, cổng, DB, Redis, reap).

## Quyết định trong lúc làm
- Redis: thuê DB toàn máy thay vì chia theo làn (không có redis-server riêng).
- Cổng: +3000/làn, tối đa 14 làn (< 49152).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
Không thay đổi hành vi (lý do: hạ tầng test e2e)