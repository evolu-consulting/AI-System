---
id: ADM-F00-slug
title: <Tên feature>
milestone: M1
status: draft            # draft → ready → approved → in-progress → done
requirements: [ADM-FR-00]
design: [docs/design/admin/ba-admin.md#..., docs/design/admin/ui-admin.md#..., canvas: <artboard>]
owner: backend-lead + frontend-lead
---

# <Tên feature>

## 1. Phạm vi
**Làm:** …
**Không làm:** …

## 2. Nghiệp vụ
Trỏ link tới BA, không chép. Chỉ ghi phần **cụ thể hoá** BA chưa nói (điều kiện if/else, con số, edge case).

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|

## 3. Contract (backend-lead)
File: `packages/contracts/src/<module>.ts`

| Method | Path | Role | Request | Response | Lỗi (HTTP · code) |
|---|---|---|---|---|---|

Sự kiện / NOTIFY: tên · payload · khi nào gửi.

## 4. Dữ liệu (backend-lead)
| Bảng | Cột | Kiểu | Null | Default | Ràng buộc / index | RLS |
|---|---|---|---|---|---|---|

Migration: … · Seed: …

## 5. UI (frontend-lead)
Artboard: … · Màn thiếu artboard: mô tả theo mẫu nào.

| Màn / thành phần | Trạng thái (tải · rỗng · lỗi · không quyền) | Câu chữ VI | Câu chữ EN | Role + nhãn cho e2e |
|---|---|---|---|---|

Validate: trường · luật · câu lỗi VI/EN nguyên văn.

## 6. Hiệu năng
Ngân sách riêng (nếu siết hơn `CONVENTIONS.md` §6): …

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|

Env mới: tên · giá trị dev.

## 8. Tiêu chí nghiệm thu (qc)
| AC | Given / When / Then (dữ liệu cụ thể) | Test |
|---|---|---|

Lệnh xong: `bun run typecheck && bun test && bunx playwright test <feature>`

## 9. Quyết định
### Trước Gate (đã chốt với người dùng)
- …
### Trong lúc làm (agent tự quyết theo Luật 2)
- <ngày> · <agent> · chọn … vì …

## 10. Tranh chấp test
- (không)
