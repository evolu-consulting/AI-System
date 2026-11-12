---
id: pl-spec-find
lát: pl-spec-find
làn: nhanh
migration: không
---
## Plan (ngắn)
Bậc 1 của `docs/platform/dev-flow.md` §7: `bun run spec:find "<câu>" [--k 8] [--history] [--json]`. Chỉ mục BM25 dựng trong bộ nhớ mỗi lần gọi
(không file chỉ mục ⇒ không cũ): docs/current → Delta chưa gộp → CHANGE-REQUESTS → ADR (Quyết định) → TECH-DEBT; `docs/specs/**` chỉ với `--history`.
Bỏ dấu tiếng Việt + từ đồng nghĩa `docs/.index/synonyms.json`. `intake-analyst` + skill intake gọi lệnh này trước khi Grep.

Quyết định: không đánh chỉ mục persisted (kho nhỏ, dựng < 0.3 s); không embedding (Bậc 2 chỉ khi đo recall@8 < 90%).

## Không làm / Chạm
Không embedding, không dịch vụ, không code sản phẩm. Perf: một lần gọi ≤ 2 s.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: công cụ tra cứu spec)

## Việc còn lại
Bộ đo recall@8 (30 ý từ CR-110…126) chưa làm.
