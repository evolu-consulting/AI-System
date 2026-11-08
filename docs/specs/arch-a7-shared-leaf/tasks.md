---
id: arch-a7-shared-leaf
lát: arch-a7-shared-leaf
cr:
làn: nhanh
migration: không
phụ thuộc: arch-a2-public-gates
---
## Plan (ngắn)

Dọn các cạnh import chéo module còn lại trong baseline sau arch-a2: đổi sang `public.ts`; chỗ đổi sẽ sinh vòng thì chuyển phần thuần cần dùng ra lá chung `apps/hub-api/src/shared/` (không import module), file cũ giữ shim `export *` / re-export để mọi import nội bộ + test giữ nguyên.

## Làm

- Lá chung mới `src/shared/`: `job-event.rules` (isJobTerminal, syntheticFailed, ZERO_USAGE…), `chunk-text` (chunkText), `file-ext` (splitExt), `run-files.rules`, `agent-access.rules`, `catalog.types`, `command-access.rules`, `template.rules`, `agent-stage.rules` (runsAsAgent/agentIdOf/HandoffShape cho kh).
- Importer đổi: stream, usage/chat-token-gate, config (catalog.rules, config.rules), commands.service, runner/job/*, runs/* → lá chung; mcp, kh, knowledge, processes/core/ports, runner/job, runs/create-run|runs.service|sse-writer → `public.ts` (thêm tên export còn thiếu).
- `attachments/autofix-files.rules` canReadAutofixFile nhận `T | null` (bỏ import kiểu RunAccess từ processes, cắt vòng).
- Baseline `.dependency-cruiser-known-violations.json`: 43 → 15 mục ranh giới.

## Không làm / Chạm

- Không đụng `modules/packs/**`, `modules/ops`, admin-web, test khoá.
- Còn trong baseline (15): 10 mục `packs/dlc -> packs/kit` (deep) + 2 `packs.filebox -> attachments` (flat) + 3 `seed -> packs/contracts/domain` — đều gắn với `packs/**` (m2/CR-124 đang sửa), xử lý sau khi packs xong.

## Test tối thiểu

tsc hub-api (0 lỗi) · unit hub-api (2429 pass; đỏ có sẵn seed.processes K1 T5g) · depcruise --all (0 mới, 0 vòng) · check:boundaries 15/15 · test mới `processes/nodes/agent-stage.shared.test.ts` (shared khớp registry) · int server các module chạm.

## Quyết định trong lúc làm

- Lá chung đặt `src/shared/` (ngoài `modules/` nên không bị luật ranh giới); file cũ thành shim để không đổi import test.
- `runsAsAgent`/`agentIdOf` cho kh nhân bản quy tắc "chỉ node agent có agentId" vào lá chung; test khớp registry chặn lệch.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt CR-125 cuoi dot)

Không thay đổi hành vi (lý do: refactor ranh giới module, chỉ dời hàm/kiểu thuần và đổi specifier import)

## Việc còn lại

15 mục baseline gắn `packs/**` (xem trên).
