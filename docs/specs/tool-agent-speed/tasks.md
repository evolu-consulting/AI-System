---
id: tool-agent-speed
lát: tool-agent-speed
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Bỏ các điểm mất thời gian lặp lại của agent: hook format tự sửa, bộ helper e2e dùng chung, e2e không phụ thuộc thứ tự file.

## Làm
- `lefthook.yml`: biome `--write` + `stage_fixed: true` (chỉ file đã stage); lỗi không tự sửa được vẫn chặn commit.
- `e2e/_kit/` (`api.ts`, `ui.ts`, `unique.ts`, README): đăng nhập API, gán quy trình, đặt luật, bật tính năng, tạo tenant/user/phòng ban riêng, tải lại an toàn.
- `journey-approval/_journey.ts` và `community-web/flows.cs.ts` chuyển sang kit; `z-flows.cs.ts` đổi lại thành `flows.cs.ts`, ca 3 tự đăng bài riêng.

## Không làm / Chạm
Không đụng `deploy/evotest/**`. Không đổi hành vi sản phẩm.

## Test tối thiểu
`bun test tools/scripts/src/e2e-kit-unique.test.ts`; e2e `journey-approval`, `community-web-stack` một lượt trên evotest.

## Quyết định trong lúc làm
- Test unit của helper thuần đặt ở `tools/scripts/src` vì `bunfig.toml` bỏ qua `e2e/**`.
- Helper API (`createIsolated*`, `grantFeature`) chưa có spec nào dùng, chưa được chạy thật; hai spec hiện tại chỉ dùng phần UI + `safeReload`.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: lát công cụ test/hook; hành vi sản phẩm giữ nguyên. Hook pre-commit nay tự sửa format file đã stage, e2e dùng helper chung `e2e/_kit`).

## Việc còn lại
- Chuyển dần các spec khác sang `e2e/_kit` khi chạm tới.
- Khi bật duyệt bài, bài của chính chủ quản cũng phải duyệt — cần PM xác nhận có miễn duyệt cho chủ quản không
