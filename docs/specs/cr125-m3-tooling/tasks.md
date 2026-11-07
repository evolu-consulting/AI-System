---
id: cr125-m3-tooling
lát: cr125-m3-tooling
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: m1
---
## Plan (ngắn)
Công cụ sổ module: `module:index` (sinh index.generated.ts), `check:modules` (kiểm tĩnh), `module:new` (scaffold). Luật thuần ở `tools/scripts/src/modules-tool.rules.ts`.

## Làm
- `module-index.ts`, `check-modules.ts`, `module-new.ts`, `modules-tool.fs.ts` (I/O mỏng), `modules-tool.rules.ts` + test.
- Nối `check:modules` vào `check`, `slice:merge` (POST_REBASE_GATES), lefthook (glob `packages/contracts/src/modules/**`).

## Không làm / Chạm
Không chạm hub-api, admin-web, `modules.rules.ts`. Kiểm tĩnh chỉ chạy `moduleIssues` với binding dễ tính (chỉ MOD_DUP), vì binding thật nằm ở hub (m2/m4).

## Test tối thiểu
Unit `modules-tool.rules.test.ts`, `slice-rebase.test.ts`. Perf: `check:modules` ≤ 2 s (đo 0,24 s).

## Quyết định trong lúc làm
- Thứ tự app trong sổ: `core`, `contracts`, rồi bảng chữ cái (khớp sổ m1).
- `module:new` cũng tạo/cập nhật `<app>/module.ts` để node vào sổ ngay.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/platform/module-tooling.md
#### Yêu cầu: Sinh sổ module từ thư mục
`bun run module:index` sinh `packages/contracts/src/modules/index.generated.ts` từ các thư mục `modules/<app>/<node>/node.ts`, thứ tự cố định (core, contracts, rồi bảng chữ cái); chạy lại không đổi gì.
- Kịch bản: khi chạy module:index với cùng tập thư mục thì file sinh giống từng byte và không đổi thứ tự [test: tools/scripts/src/modules-tool.rules.test.ts » thứ tự cố định core contracts rồi bảng chữ cái]
- Kịch bản: khi đầu vào đảo thứ tự hoặc trùng thì kết quả không đổi [test: tools/scripts/src/modules-tool.rules.test.ts » tất định: thứ tự đầu vào và trùng không đổi kết quả]

#### Yêu cầu: Kiểm tĩnh sổ module
`bun run check:modules` báo MOD_INDEX_STALE khi index tự sinh cũ, hoặc khi app thiếu module.ts / node.ts chưa nằm trong module.ts; chạy `moduleIssues` với các luật không cần hub.
- Kịch bản: khi index cũ thì báo «Danh sách module tự sinh đã cũ — chạy bun run module:index rồi commit.» [test: tools/scripts/src/modules-tool.rules.test.ts » MOD_INDEX_STALE khi index cũ, câu tiếng Việt theo spec]
- Kịch bản: khi thiếu module.ts hoặc node chưa liệt kê thì báo lỗi [test: tools/scripts/src/modules-tool.rules.test.ts » thiếu module.ts hoặc node chưa liệt kê thì lỗi]
- Kịch bản: khi chỉ có node.ts hợp lệ thì sạch [test: tools/scripts/src/modules-tool.rules.test.ts » sạch khi index mới và module.ts đủ]
- Kịch bản: khi chạy slice:merge thì cổng check:modules chạy sau check:boundaries [test: tools/scripts/src/slice-rebase.test.ts » mặc định chạy check:boundaries rồi check:modules, xanh thì ok]

#### Yêu cầu: Dựng node mới
`bun run module:new <app> <node>` tạo node.ts, node.test.ts, tạo hoặc cập nhật module.ts, in đường dẫn binding (hub-api) và panel tuỳ chọn (admin-web), rồi chạy module:index. Tên sai bị từ chối; chạy lại không thêm trùng.
- Kịch bản: khi tên app hoặc node sai định dạng thì từ chối [test: tools/scripts/src/modules-tool.rules.test.ts » nameError từ chối tên xấu]
- Kịch bản: khi thêm node vào module.ts có sẵn thì thêm import và nodes[], chạy lại không đổi [test: tools/scripts/src/modules-tool.rules.test.ts » addNodeToModule thêm import + nodes[], idempotent]

## Việc còn lại
Không.
