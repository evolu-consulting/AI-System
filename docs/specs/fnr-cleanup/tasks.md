---
id: fnr-cleanup
lát: fnr-cleanup
cr: CR-103
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Gỡ vòng import `nodes/registry → nodes/*/node → nodes/types → defs/def.rules → nodes/registry` (depcruise `no-circular`) và qc khoá test CR-103.

## Làm
- Tách kiểu `DefRefs`/`RefKind`/`RefMiss` sang module lá `defs/def-refs.ts`; `def.rules.ts` re-export; `nodes/*` + `teams.repo.ts` import từ `def-refs`.
- qc: cập nhật PD2-C01 (enum nối cuối `set`,`if` / `SET_INVALID`,`IF_INVALID`) + `findE2eConfigs` (21 cấu hình, thêm fnr-showcase); `test:lock:write`.

## Không làm / Chạm
Không đổi hành vi. Chạm: apps/hub-api processes (defs, nodes), tests/acceptance/P-d/rules/d2/contracts-pd2.test.ts, tools/scripts/src/test-all.discover.test.ts, tests/.lock.

## Test tối thiểu
`bun test` hai file test đã sửa; `bun run depcruise`; `bun run test:lock:verify`.

## Quyết định trong lúc làm
- Đã kiểm enum CR-103 chỉ nối cuối (không chèn giữa) ⇒ giữ nguyên ý định test.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
Không thay đổi hành vi (lý do: gỡ vòng import + qc khoá test CR-103)

## Việc còn lại
Không.