---
id: cr118-home-fix
lát: cr118-home-fix
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: cr118-fg-home
---
## Plan (ngắn)
e2e `sohoptac-web-stack` "thành viên SHT" đỏ: `/pack/me` của demo-owner trả `packs.contracts.enabled=false`, `apps=["community"]`, `home="community"`
(stack chỉ bật gói community) nên web gộp (đọc apps/home từ /pack/me) đúng thiết kế đưa về /community. Không phải lỗi fallback của `homeFor`
(đã kiểm bằng response thật). Sửa seed của stack: bật gói contracts cho tenant demo.

## Làm
- `tools/scripts/src/seed-community-demo.dev-fixture.ts`: `ensureContractsPack(db)`; `e2e/community-web/_cs-stack.ts` gọi sau seed community (nhóm contracts-owner do enablePack tạo, demo-owner vào ở bước seed fixture sau đó).
- unit `login-machine.test.ts`: ca thành viên SHT (home trống hoặc contracts ra /overview) và tenant chưa bật contracts ra /community.

## Không làm / Chạm
Không sửa `e2e/sohoptac-web/auth.ss.ts`, server, DLC.

## Test tối thiểu
- unit `apps/sohoptac-web/src/platform/auth/domain/login-machine.test.ts`; e2e `-Filter sohoptac-web-stack`.

## Quyết định trong lúc làm
Test e2e đúng (thành viên SHT vào /overview); lỗi nằm ở dữ liệu seed stack, lộ ra khi feature-gate nối `apps` từ /pack/me.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa seed e2e stack và test; hành vi home đã mô tả ở sht/home-default-app.md).