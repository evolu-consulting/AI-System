---
id: cr110-sso
lát: cr110-sso
cr: CR-110
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
`openContracts` (community-web) xin mã SSO app `contracts` rồi đi `<contracts>/sso#code=…&next=<path>`; lỗi ⇒ URL thẳng.

## Làm
- `apps/community-web/src/lib/contracts-link.ts` (+ test); Sidebar truyền `allowed: caps.contracts`.

## Không làm / Chạm
- Server không đổi: `POST /auth/sso/code` dựa catalog (app mở được + có SSO), không phụ thuộc app nguồn.

## Test tối thiểu
- unit contracts-link: có mã, rơi về, guard caps.

## Quyết định trong lúc làm
- Cùng tab (như trước). `grant` nạp lười `api/session` để unit test không cần `import.meta.env`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Chuyển sang Sổ Hợp Tác bằng SSO một lần
Bấm link Sổ Hợp Tác xin mã SSO một lần và mở `<contracts>/sso#code=…&next=<đường dẫn>`; lỗi thì mở URL thẳng (contracts-web tự hiện đăng nhập); không có quyền contracts thì không làm gì.
- Kịch bản: khi xin mã được thì điều hướng tới /sso#code kèm next [test: apps/community-web/src/lib/contracts-link.test.ts » có mã: đi tới <target_url>/sso#code=…&next=<path> (giữ ?sec=)]
- Kịch bản: khi xin mã lỗi thì điều hướng URL thẳng [test: apps/community-web/src/lib/contracts-link.test.ts » lỗi xin mã (401/403/mạng): rơi về contractsUrl + path]

## Việc còn lại
