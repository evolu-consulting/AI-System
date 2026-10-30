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
- [x] Chứng minh thật (PG16+Redis7.4 bật bằng scripts/dev-db.ps1): `test:e2e:par --jobs=2 --only=fnr-showcase,P-d` từ 2 worktree cùng lúc (làn 1 + 2): mỗi bên 30 pass / 0 fail, ~130 s / ~140 s, không còn cổng nghe. N1+contracts-web: 5 đỏ y hệt trên platform/gd0 (có từ trước). x1 + community-web stack nay theo làn; còn cổng cố định: studio PUBLIC_ADMIN_WEB_URL=3000 (chỉ build env), DEAD 3399 (cổng chết cố ý).

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