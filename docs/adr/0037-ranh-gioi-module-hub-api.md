# ADR-0037 · Ranh giới module hub-api: một cửa `public.ts`, baseline chỉ co lại

Trạng thái: **Accepted** (người dùng, 2026-11-05 — CR-121 phần B). Liên quan: ADR-0023 (Clean Architecture bốn lớp),
`docs/CHANGE-REQUESTS.md` (CR-121), `docs/specs/cr121-b1-boundaries/tasks.md`.

## Bối cảnh
hub-api có 959 import xuyên module: 517 "sâu" (vào `adapters/application/domain` của module khác, 458 trong số đó vào `packs/kit`) và
442 "phẳng" (vào ruột module chưa chia lớp). Không có cửa công khai ⇒ đổi ruột một module làm vỡ nơi khác, không thay được bản giả
khi test, và `test:affected` không có ranh giới để dựa vào.

## Quyết định
1. **Một cửa:** mỗi module có `modules/<m>/public.ts` — chỉ xuất **cổng (port), kiểu và hàm dựng mount**, theo tên, **không** `export *`.
   Module khác (và `packs/<gói>` khác) chỉ được import `modules/<other>/public.ts`. Đơn vị module là `modules/<m>/`; riêng
   `modules/packs/<gói>/` (kit, community, contracts…) mỗi gói là một module.
2. **Miễn:** `app.ts`, `*.mount.ts` (gồm `packs.mount.ts`) và file test (`*.test.ts`, `*.int.test.ts`) — nơi nối module.
3. **Bản giả ở `modules/<m>/testing/`:** fake/stub dùng chung cho test; code production không import `testing/`
   (luật `no-prod-import-testing`), test thì được.
4. **Luật máy kiểm:** dependency-cruiser `cross-module-deep`, `cross-module-flat`, `no-prod-import-testing`
   (`.dependency-cruiser.cjs`). Vi phạm cũ nằm trong `.dependency-cruiser-known-violations.json` (`--ignore-known`),
   **chỉ được co lại**: `bun run check:boundaries` (quét regex < 1 s, trong pre-commit và `bun run check`/CI) đỏ khi xuất hiện vi phạm
   mới (kể cả khi tổng không tăng vì một vi phạm cũ đã hết), in số đếm theo module đích; `--write` co baseline và từ chối nếu có vi phạm mới.
5. **Chuyển dần theo module, không dời file:** pilot `knowledge` (đã chia lớp), rồi `config`, `kit`… Mỗi lát tạo `public.ts`, chuyển
   importer, baseline của module về 0. Chuyển module chưa chia lớp không bắt buộc dời file (tránh vỡ khoá test `tests/.lock`).

## Hệ quả
- Đổi ruột module không động tới module khác; thay bản giả trong test bằng `testing/` thay vì mock đường dẫn.
- Thêm module = thêm `public.ts`; import xuyên mới bị chặn ngay từ commit đầu.
- Hai thực thi cùng luật (depcruise đầy đủ ~30 s trên hub-api; quét nhanh cho hook) — `check-boundaries.test.ts` giữ phân loại
  đồng bộ với `.dependency-cruiser.cjs`.
