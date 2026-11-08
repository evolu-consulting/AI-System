---
id: tool-knownred-fixture
lát: tool-knownred-fixture
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Fixture `int-recap.log` bị `.gitignore` (`*.log`) chặn nên không vào commit ⇒ `known-red.recap.test.ts` ENOENT. Đổi sang `int-recap.txt`.

## Làm
Tạo `tools/scripts/src/__fixtures__/int-recap.txt` (trích từ log evotest thật) + đổi đường dẫn trong test.

## Không làm / Chạm
Chỉ fixture + một dòng trong test.

## Test tối thiểu
`bun test tools/scripts/src/known-red`.

## Quyết định trong lúc làm
Đuôi `.txt` (không bị ignore; `git check-ignore` thoát 1).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: fixture của unit test công cụ dev)

## Việc còn lại
