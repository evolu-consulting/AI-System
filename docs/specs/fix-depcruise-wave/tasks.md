---
id: fix-depcruise-wave
lát: fix-depcruise-wave
cr: CR-187..192
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
`bun run depcruise` đỏ 6 lỗi. Hai lỗi do đợt này (CR-188 `sig-docs.rules` import zod; CR-181 `approval-record.usecase` import logger) sửa thật; bốn lỗi còn lại đã có trên `main` (CR-169 `partner.repo`/`partner.rules`, CR-146 `receive-flow.repo`, CR-161 `connect.codec`) vào baseline đã biết.

## Làm
- [x] `domain/sig-docs.rules.ts`: bỏ `zod`, kiểm UUID bằng regex RFC (cùng luật `z.uuid()`).
- [x] `application/approval-record.usecase.ts`: bỏ `lib/logger`, ghi log qua cổng `warn?` của deps (`recordDeps` ở `approval-record-save.mount.ts` truyền `logger.warn`).
- [x] `.dependency-cruiser-known-violations.json`: thêm 4 vi phạm có từ trước (hub-scope ×2, zod trong domain ×2); ghi `docs/TECH-DEBT.md` #305.

## Không làm / Chạm
- Chạm: `apps/hub-api/src/modules/packs/contracts/{domain,application}`, `approval-record-save.mount.ts`, file baseline.
- Không làm: gỡ 4 vi phạm cũ (ngoài phạm vi, không đổi hành vi).

## Test tối thiểu
`domain/sig-docs.rules.test.ts` (xanh), `bun run depcruise` (0 lỗi), `tsc` gói hub-api.

## Quyết định trong lúc làm
- Làm thẳng trên `staging` (làn nhanh, không worktree).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
Không thay đổi hành vi (lý do: sửa vi phạm kiến trúc)

## Việc còn lại
- Gỡ 4 vi phạm đã vào baseline (TECH-DEBT #305).
