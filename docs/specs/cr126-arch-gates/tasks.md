---
id: cr126-arch-gates
lát: cr126-arch-gates
cr: CR-126
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Đưa cổng kiến trúc (depcruise, check:fn, check:pack-sql, check:size) về không vi phạm MỚI do CR-124/125/126; nợ cũ giữ nguyên.

## Làm
- depcruise: ReviewChecklist dùng `useTenantPacks` qua `hooks/use-tenant-api`.
- check:fn: tách hàm/describe, tham số thừa gom thành rest-tuple; nợ lõi engine + 5 int test dài vào allowlist (CR-126 nợ, tách sau demo).
- check:pack-sql: KNOWN_DEBT cho migration trước CR-124 (TECH-DEBT #264).

## Không làm / Chạm
Không sửa migration đã áp dụng (contracts 0085/0087 của CR-124 còn đỏ, báo điều phối).

## Test tối thiểu
Unit của file đổi; tsc các gói đổi.

## Quyết định trong lúc làm
Rest-tuple để không đổi chỗ gọi.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: refactor cấu trúc để qua cổng kiến trúc, không đổi hành vi)

## Việc còn lại
Tách 5 int test dài trong allowlist; contracts 0085/0087 pack-sql.
