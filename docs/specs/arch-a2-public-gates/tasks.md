---
id: arch-a2-public-gates
lát: arch-a2-public-gates
cr:
làn: nhanh
migration: không
phụ thuộc: arch-a1-depcruise
---
## Plan (ngắn)

Lát 1–3 của `docs/specs/arch-a1-depcruise/tasks.md` § "Kế hoạch dọn": mọi import chéo module trong hub-api đi qua `modules/<m>/public.ts`.

## Làm

- Thêm `public.ts` (export theo tên, không `export *`) cho processes, runs, commands, runner, orchestrator, internal, attachments, dify, agents, studio, mention, kh, stream, secrets, artifacts, conversations, mcp, rooms, usage, agent-grants, chat-gate, sources, agent-hooks, agent-settings.
- Đổi specifier import chéo module sang `public` (tool `codemod-module-public` + sinh `public.ts` từ các tên được import).
- Co baseline `.dependency-cruiser-known-violations.json` 519 → 273 mục.

## Không làm / Chạm

- Không đụng `modules/packs/**`, `modules/ops/**`, admin-web, admin-api, test khoá. File ngoài `modules/` (app*.ts, config/, test-support) không bị luật này nên giữ nguyên (đổi sang public.ts chỉ tạo vòng).
- Cạnh còn trong baseline vì đổi sang `public.ts` sinh vòng import (cần tách kiểu/hàm thuần ra lá chung): `stream -> runner/orchestrator`, `config/catalog.rules -> commands`, `usage/chat-token-gate -> runner`, và ~19 cạnh vào attachments/kh/mcp/agents/artifacts (processes/core/ports, runner/job/*, runs/*, commands.service, knowledge/kh.source, config.rules).

## Test tối thiểu

Không đổi hành vi: tsc hub-api, `check:boundaries`, `depcruise`, unit các module chạm.

## Quyết định trong lúc làm

- `*.mount.ts` làm importer được miễn nên không bị đổi.
- Vòng sinh ra khi `public.ts` gom file nặng: gỡ cạnh gây vòng (giữ import sâu, vẫn trong baseline) thay vì đổi hành vi.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: refactor ranh giới module)

## Việc còn lại

Cạnh còn lại trong baseline (xem "Không làm / Chạm"); lát 4+ của arch-a1.
