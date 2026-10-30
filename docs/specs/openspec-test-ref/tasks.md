---
id: openspec-test-ref
lát: openspec-test-ref
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Mỗi `- Kịch bản:` (ADDED/MODIFIED, lát "chưa gộp") phải kèm `[test: <path> » <tiêu đề>]` hoặc `[test: thủ công — <lý do>]`; `openspec:check` kiểm file + tiêu đề tồn tại (không chạy test).

## Làm
`validateTestRefs` (openspec.rules.ts) + nối vào `checkSlice` (openspec.ts); cập nhật ADR-0032, docs/current/README, WORKFLOW, CLAUDE.md Luật 0b, khuôn slice:new.

## Không làm / Chạm
Không chạy test; lát "đã gộp" không kiểm lại.

## Test tối thiểu
Unit openspec.rules.test.ts + openspec.test.ts.

## Quyết định trong lúc làm
Tiêu đề tìm bằng văn bản thường, phân biệt hoa/thường.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
Không thay đổi hành vi (lý do: công cụ kiểm tài liệu)

## Việc còn lại
