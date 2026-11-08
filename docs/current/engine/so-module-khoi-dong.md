# Sổ module tính năng (CR-125)

Nguồn: lát `cr125-m2-registry`, `cr125-m3-tooling`; kiến trúc: [platform/architecture.md](../../platform/architecture.md). Code: `packages/contracts/src/modules/**`, `apps/hub-api/src/modules/packs/kit/adapters/module-registry.ts`, `apps/hub-api/src/modules/packs/packs.modules-check.ts`, `tools/scripts/src/{module-index,module-new,check-modules,modules-tool.rules}.ts`.

## Kiểm module lúc khởi động
Khi hub khởi động, sau khi gắn mọi gói, sổ module đối chiếu khai báo node/sự kiện (`MODULES`) với xử lý máy chủ đã đăng ký; có bất kỳ lỗi nào thì hub không lên, nêu số lỗi và từng câu tiếng Việt kèm cách khắc phục.
- Binding Ký số hoặc xử lý sự kiện bị gỡ ⇒ khởi động ném «Khởi động dừng: N lỗi module» kèm câu `MOD_UNBOUND` [test: `apps/hub-api/src/modules/packs/packs.mount.test.ts`]
- Đủ binding ⇒ không lỗi, không ném [test: `kit/adapters/module-registry.test.ts`]
- Gắn gói thật (contracts, community): `MODULES` × binding thật không có lỗi giả [test: `packs/packs.module-registry.int.test.ts`]
- Chỉ gắn một phần app ⇒ khai báo và binding của app không gắn bị bỏ qua
- `bindEvent`/`bindNode` chuyển nguyên đối tượng cho `flowPortRegistry`/`nodeConfigRegistry`; `bindNode` lặp thì gộp tool
- Binding cho khoá node không có dấu chấm ⇒ lỗi `MOD_ORPHAN_BINDING` ghi app «unknown» [test: `modules.rules.test.ts`]
- Tín hiệu chờ ký số không có node nào chờ ⇒ `MOD_SIGNAL_ORPHAN`; có node chờ thì không cần binding hay dữ kiện
- Mã lỗi khác: `MOD_DUP`, `MOD_TOOL_MISSING`, `MOD_PORT_MISMATCH`, `MOD_EVENT_UNBOUND`, `MOD_OUTCOME_UNBOUND`, `MOD_OUTPUT_UNBOUND` (CR-125 m8: cổng ra thiếu binding)

## Công cụ
- `bun run module:index` sinh `packages/contracts/src/modules/index.generated.ts` từ `modules/<app>/<node>/node.ts`, thứ tự cố định (core, contracts, rồi bảng chữ cái); chạy lại không đổi; đầu vào đảo/trùng không đổi kết quả.
- `bun run check:modules` báo `MOD_INDEX_STALE` («Danh sách module tự sinh đã cũ — chạy bun run module:index rồi commit.») khi index cũ, app thiếu `module.ts`, hoặc `node.ts` chưa nằm trong `module.ts`; chạy `moduleIssues` các luật không cần hub. Chạy trong pre-commit (khi đụng `modules/**`), `bun run check`, và `slice:merge` (sau `check:boundaries`).
- `bun run module:new <app> <node>`: tạo `node.ts`, `node.test.ts`, tạo/cập nhật `module.ts`, in đường dẫn binding (hub-api) và panel tuỳ chọn (admin-web), chạy `module:index`. Tên sai bị từ chối; chạy lại không thêm trùng, không ghi đè node có sẵn.
